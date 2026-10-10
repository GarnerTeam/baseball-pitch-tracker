import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { scriptErrorBody } from '@/lib/apps-script';
import { db, mirror, mirrorToSheet, mode, readAction, sheetWrite, scriptUrlFor } from '@/lib/backend';
import * as store from '@/lib/db/store';

/**
 * GET /api/sheets/players?url=<webhookUrl>[&type=unlinked]
 * Every active player in the coach's organization (the Lineup tab filters
 * it client-side for autocomplete), or with type=unlinked the distinct
 * (batterName, batterNumber) combos that have no player id yet (Player
 * Profile → "Attach historical records"). Dual-mode auth: a real Clerk
 * session always wins over a client-supplied `owner`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'players';

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  const organizationId = sessionOrgId || sessionUserId || ownerParam;
  const userId = sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    const url = scriptUrlFor(searchParams.get('url'));
    const json = await readAction(url, type === 'unlinked' ? 'unlinkedBatters' : 'players', { organizationId, userId });
    return NextResponse.json(json);
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST /api/sheets/players
 * Body: { webhookUrl, action?, ... } — `action` picks the write:
 *
 *   create (default) { name, number, hand }  → { player }   new PLR id
 *   attach  { playerId, batterName, batterNumber? }        → { attached }
 *   merge   { sourcePlayerId, targetPlayerId }             → { merged, … }
 *   update  { playerId, patch: { name?, number?, hand?, notes?, verified?, isActive? } } → { player }
 *
 * Every write is stamped with the AUTHENTICATED user's organization —
 * never a client-supplied one.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const organizationId = orgId || userId;
    const scope = { organizationId, userId };

    const body = await req.json();
    const { action = 'create' } = body as { action?: string };
    const url = scriptUrlFor((body as { webhookUrl?: string }).webhookUrl);

    if (action === 'attach') {
      const playerId = String(body.playerId ?? '').trim();
      const batterName = String(body.batterName ?? '').trim();
      const batterNumber = String(body.batterNumber ?? '').trim();
      if (!playerId || !batterName) {
        return NextResponse.json({ error: 'Missing playerId or batterName' }, { status: 400 });
      }
      const payload = { _kind: 'attachHistory', organizationId, userId, playerId, batterName, batterNumber };
      return synchronousWrite(url, payload, 'attached',
        () => store.attachHistory(db(), scope, { playerId, batterName, batterNumber }));
    }

    if (action === 'merge') {
      const src = String(body.sourcePlayerId ?? '').trim();
      const tgt = String(body.targetPlayerId ?? '').trim();
      if (!src || !tgt) {
        return NextResponse.json({ error: 'Missing sourcePlayerId or targetPlayerId' }, { status: 400 });
      }
      const payload = { _kind: 'mergePlayers', organizationId, userId, sourcePlayerId: src, targetPlayerId: tgt };
      return synchronousWrite(url, payload, 'merged', () => store.mergePlayers(db(), scope, src, tgt));
    }

    if (action === 'update') {
      const playerId = String(body.playerId ?? '').trim();
      const patch = body.patch as Record<string, unknown> | undefined;
      if (!playerId || !patch || typeof patch !== 'object') {
        return NextResponse.json({ error: 'Missing playerId or patch' }, { status: 400 });
      }
      const payload = { _kind: 'updatePlayer', organizationId, userId, playerId, patch };
      return synchronousWrite(url, payload, 'player',
        async () => ({ player: await store.updatePlayer(db(), scope, playerId, patch) }));
    }

    // ── create ──
    const name = String(body.name ?? '').trim();
    const number = String(body.number ?? '').trim();
    const hand = String(body.hand ?? '');
    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    if (mode() === 'database') {
      const player = await store.createPlayer(db(), { organizationId, userId, name, number, hand });
      // The Sheet copy keeps the same PLR id (see createPlayerRecord).
      mirrorToSheet('createPlayer', url, { _kind: 'createPlayer', organizationId, userId, name, number, hand, playerId: player.id });
      return NextResponse.json({ player });
    }

    const player = await createPlayerInSheet(url, { organizationId, userId, name, number, hand });
    if (!player) {
      return NextResponse.json(
        { error: 'Player may have been created, but the server did not confirm it. Please check the autocomplete list and try again.' },
        { status: 502 },
      );
    }
    if (mode() === 'dual') {
      await mirror('createPlayer', () => store.createPlayer(db(), {
        organizationId, userId, name, number, hand, id: String(player.id),
      }));
    }
    return NextResponse.json({ player });
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * Creates a player in the Sheet and returns the record with its new PLR id.
 * Known Apps Script quirk: doPost() can run but the final redirect hop
 * answers 405 with no body, so the id can't be read from the reply. Then
 * the player list is re-read and the newest exact name+number match used.
 */
async function createPlayerInSheet(
  url: string,
  p: { organizationId: string; userId: string; name: string; number: string; hand: string },
): Promise<Record<string, unknown> | null> {
  const r = await sheetWrite(url, { _kind: 'createPlayer', ...p });
  if (!r.ok) throw new Error(r.error);
  if (r.body.player) return r.body.player as Record<string, unknown>;
  const list = await readAction(url, 'players', { organizationId: p.organizationId, userId: p.userId });
  const players = (list.players as Array<Record<string, unknown>> | undefined) ?? [];
  const matches = players.filter(x =>
    String(x.name ?? '').trim().toLowerCase() === p.name.toLowerCase() && String(x.number ?? '').trim() === p.number,
  );
  return matches[matches.length - 1] ?? null;
}

/**
 * attach / merge / update: run against the primary store and copy to the
 * other. The Sheet path keeps the 405 quirk handling (the write ran; the
 * reply body is just unreadable), answering { ok: true } so the client
 * refetches to see the result.
 */
async function synchronousWrite(
  url: string,
  payload: Record<string, unknown>,
  hint: string,
  writeDb: () => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  if (mode() === 'database') {
    const result = await writeDb();
    mirrorToSheet(String(payload._kind), url, payload);
    return NextResponse.json({ status: 'ok', ...result });
  }
  const r = await sheetWrite(url, payload);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  if (mode() === 'dual') await mirror(String(payload._kind), writeDb);
  if (r.status === 405) {
    return NextResponse.json({ ok: true, note: `${hint} (unconfirmed response body due to known redirect quirk — refetch to verify)` });
  }
  return NextResponse.json(r.body);
}
