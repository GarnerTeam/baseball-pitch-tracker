import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/sheets/players?url=<webhookUrl>
 * Returns every player in the coach's persistent batter database (scoped to
 * their account) — the full list, not a per-keystroke search — so the
 * Lineup tab's name autocomplete can filter client-side exactly like the
 * existing My Team / Opposing Team autocomplete. Dual-mode auth like
 * /api/sheets/roster: a real Clerk session always wins over any
 * client-supplied `owner` param (only relevant for unauthenticated Scout
 * contexts).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const webhookUrl = searchParams.get('url');
  // ?type=unlinked powers the Player Profile "Attach historical records"
  // screen — distinct (batterName, batterNumber) combos with no playerId
  // yet, scoped to this organization. Default (no type) returns the full
  // active player list, as before.
  const type = searchParams.get('type') ?? 'players';

  if (!webhookUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const { userId: sessionUserId, orgId: sessionOrgId } = await auth();
  const ownerParam = searchParams.get('owner') ?? '';
  // Players are scoped to the Organization, not the individual coach — any
  // authorized teammate in the same org sees the same batter database.
  const organizationId = sessionOrgId || sessionUserId || ownerParam;

  if (!organizationId) {
    return NextResponse.json({ error: 'Missing owner — no session and no owner parameter provided' }, { status: 400 });
  }

  try {
    if (type === 'unlinked') {
      const json = await fetchFromScript(webhookUrl, { action: 'unlinkedBatters', organizationId, userId: sessionUserId ?? '' });
      return NextResponse.json(json);
    }
    const json = await fetchPlayersFromScript(webhookUrl, organizationId);
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function fetchFromScript(webhookUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${webhookUrl}?${qs.toString()}`, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON: ${text.slice(0, 300)}`);
  }
}

async function fetchPlayersFromScript(webhookUrl: string, organizationId: string): Promise<Record<string, unknown>> {
  return fetchFromScript(webhookUrl, { action: 'players', organizationId });
}

/**
 * Follow all redirects as POST — mirrors the helper in /api/sheets/route.ts.
 * Google Apps Script has a 2-hop redirect chain and Node's fetch downgrades
 * POST -> GET on 302, which would silently drop the write.
 */
async function postFollowingRedirects(
  url: string,
  body: string,
  maxHops = 5
): Promise<{ status: number; text: string }> {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { status: res.status, text: '' };
      current = next;
      continue;
    }

    const text = await res.text();
    return { status: res.status, text };
  }
  return { status: 0, text: 'Too many redirects' };
}

/**
 * POST /api/sheets/players
 * Body: { webhookUrl, name, number, hand }
 * Creates a brand-new player in the persistent database and returns the
 * created record, including the backend-generated permanent Player ID
 * ("PLR0001" style). Unlike pitch syncing, this is a synchronous
 * request/response — the caller needs the generated ID back immediately to
 * tag it onto the lineup slot and every pitch recorded against it. Every
 * write is stamped with the AUTHENTICATED user's id server-side — never
 * trust a client-supplied userId here, same rule as every other write route.
 */
/**
 * POST /api/sheets/players
 * Body: { webhookUrl, action?, ... }
 * `action` dispatches to one of four write kinds (default 'create' for
 * backward compatibility with the original Lineup-tab autocomplete):
 *
 *   action=create  { name, number, hand }
 *     Creates a brand-new player, returns the generated Player ID.
 *
 *   action=attach  { playerId, batterName, batterNumber? }
 *     Phase 2: attaches every unlinked historical Pitches row matching
 *     (batterName, batterNumber) in this organization to playerId.
 *
 *   action=merge  { sourcePlayerId, targetPlayerId }
 *     Phase 2: merges a duplicate player into a primary one — reassigns
 *     all Pitches/Rosters rows, deactivates (never deletes) the source.
 *
 *   action=update  { playerId, patch: { name?, number?, hand?, notes?, verified?, isActive? } }
 *     Phase 2: edits an existing player's profile fields.
 *
 * Every write is stamped with the AUTHENTICATED user's organization (or
 * personal id, for solo coaches) server-side — never trust a
 * client-supplied organizationId/userId here, same rule as every other
 * write route.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    // Player identity belongs to the coach's Organization (shared batter
    // intelligence), not their personal account — falls back to userId
    // for solo coaches with no Organization set up yet.
    const organizationId = orgId || userId;

    const body = await req.json();
    const { webhookUrl, action = 'create' } = body as { webhookUrl?: string; action?: string };

    if (!webhookUrl) {
      return NextResponse.json({ error: 'Missing webhookUrl' }, { status: 400 });
    }

    if (action === 'attach') {
      const { playerId, batterName, batterNumber } = body as { playerId?: string; batterName?: string; batterNumber?: string };
      const trimmedPlayerId = String(playerId ?? '').trim();
      const trimmedBatterName = String(batterName ?? '').trim();
      if (!trimmedPlayerId || !trimmedBatterName) {
        return NextResponse.json({ error: 'Missing playerId or batterName' }, { status: 400 });
      }
      const payload = {
        _kind: 'attachHistory', organizationId, userId,
        playerId: trimmedPlayerId, batterName: trimmedBatterName, batterNumber: String(batterNumber ?? '').trim(),
      };
      return handleSynchronousWrite(webhookUrl, payload, 'attached');
    }

    if (action === 'merge') {
      const { sourcePlayerId, targetPlayerId } = body as { sourcePlayerId?: string; targetPlayerId?: string };
      const src = String(sourcePlayerId ?? '').trim();
      const tgt = String(targetPlayerId ?? '').trim();
      if (!src || !tgt) {
        return NextResponse.json({ error: 'Missing sourcePlayerId or targetPlayerId' }, { status: 400 });
      }
      const payload = { _kind: 'mergePlayers', organizationId, userId, sourcePlayerId: src, targetPlayerId: tgt };
      return handleSynchronousWrite(webhookUrl, payload, 'merged');
    }

    if (action === 'update') {
      const { playerId, patch } = body as { playerId?: string; patch?: Record<string, unknown> };
      const trimmedPlayerId = String(playerId ?? '').trim();
      if (!trimmedPlayerId || !patch || typeof patch !== 'object') {
        return NextResponse.json({ error: 'Missing playerId or patch' }, { status: 400 });
      }
      const payload = { _kind: 'updatePlayer', organizationId, userId, playerId: trimmedPlayerId, patch };
      return handleSynchronousWrite(webhookUrl, payload, 'player');
    }

    // ── action === 'create' (default, original behavior) ──
    const { name, number, hand } = body as { name?: string; number?: string; hand?: string };
    const trimmedName = String(name ?? '').trim();
    const trimmedNumber = String(number ?? '').trim();

    if (!trimmedName) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    const payload = {
      _kind: 'createPlayer',
      organizationId,
      userId,
      name: trimmedName,
      number: trimmedNumber,
      hand: hand ?? '',
    };

    const { status, text } = await postFollowingRedirects(webhookUrl, JSON.stringify(payload));

    if (status >= 200 && status < 300) {
      let respBody: Record<string, unknown> = {};
      try { respBody = JSON.parse(text); } catch {
        return NextResponse.json({ error: `Apps Script returned non-JSON: ${text.slice(0, 300)}` }, { status: 502 });
      }
      if (respBody.status === 'error') {
        return NextResponse.json({ error: respBody.message }, { status: 500 });
      }
      if (respBody.player) {
        return NextResponse.json({ player: respBody.player });
      }
      // Fall through to the 405-style recovery below — doGet/doPost on this
      // webhook sometimes answers with a 2xx that has no usable body either.
    }

    // Known Apps Script web-app quirk: doPost() can run and persist the row
    // successfully, but the final redirect hop answers 405 with no body —
    // the write happened, we just can't read its return value directly.
    // Since player creation (unlike pitch/roster syncing) MUST hand the
    // caller back the backend-generated Player ID, recover by re-fetching
    // the full player list and picking out the record we just created
    // (exact name+number match, most recently created one if there are
    // several, which only happens if this exact name/number pair was
    // created before — astronomically unlikely to pick the wrong row).
    if (status === 405 || (status >= 200 && status < 300)) {
      try {
        const listJson = await fetchPlayersFromScript(webhookUrl, organizationId);
        const players = (listJson.players as Array<Record<string, unknown>> | undefined) ?? [];
        const candidates = players.filter(p =>
          String(p.name ?? '').trim().toLowerCase() === trimmedName.toLowerCase() &&
          String(p.number ?? '').trim() === trimmedNumber
        );
        const created = candidates[candidates.length - 1];
        if (created) {
          return NextResponse.json({ player: created });
        }
      } catch {
        // fall through to the error below
      }
      return NextResponse.json(
        { error: 'Player may have been created, but the server did not confirm it. Please check the autocomplete list and try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: `Unexpected status ${status}: ${text.slice(0, 200)}` },
      { status: 502 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Shared synchronous-write handler for the Phase 2 actions (attach / merge /
 * update) — same 405-empty-body quirk as createPlayer, but since these
 * don't need a freshly-generated id back (the id was already known by the
 * caller), the 405 recovery is simpler: the write already executed
 * server-side by the time the redirect chain answers 405, so we just
 * acknowledge success rather than needing to re-derive a result.
 */
async function handleSynchronousWrite(
  webhookUrl: string,
  payload: Record<string, unknown>,
  successKeyHint: string,
): Promise<NextResponse> {
  const { status, text } = await postFollowingRedirects(webhookUrl, JSON.stringify(payload));

  if (status >= 200 && status < 300) {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch {
      return NextResponse.json({ error: `Apps Script returned non-JSON: ${text.slice(0, 300)}` }, { status: 502 });
    }
    if (body.status === 'error') {
      return NextResponse.json({ error: body.message }, { status: 500 });
    }
    return NextResponse.json(body);
  }

  if (status === 405) {
    // The Apps Script side already executed (this is the documented
    // redirect-delivery quirk, not a failure) — acknowledge so the client
    // refetches the affected lists to see the updated state.
    return NextResponse.json({ ok: true, note: `${successKeyHint} (unconfirmed response body due to known redirect quirk — refetch to verify)` });
  }

  return NextResponse.json(
    { error: `Unexpected status ${status}: ${text.slice(0, 200)}` },
    { status: 502 }
  );
}
