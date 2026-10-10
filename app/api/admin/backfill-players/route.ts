import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveScriptUrl, scriptErrorBody } from '@/lib/apps-script';
import { db as getDbOrThrow, mode, sheetWrite } from '@/lib/backend';
import { getDb } from '@/lib/db/client';
import * as store from '@/lib/db/store';
import { hasImportToken, isAdmin } from '@/lib/admin';

export const maxDuration = 60;

/**
 * One-time backfill: give every batter recorded before Player Identity a
 * Players record, and link their past pitches to it.
 *
 *   GET ?organizationId=…&userId=…           → preview (changes nothing)
 *   GET ?organizationId=…&userId=…&run=1&limit=N → process the next N batters
 *
 * Records are grouped into players by the coach's rule — last name, first
 * name, jersey number, then team (lib/player-match.ts); a group joins an
 * existing player when one matches, otherwise a new player is created. Writes go through the same Sheet/Postgres path as the
 * app (DATA_STORE), so both stores stay in step. Admin session or the
 * one-time ADMIN_IMPORT_TOKEN required.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  if (!hasImportToken(sp.get('token'))) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await isAdmin(userId))) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }
  const database = getDb();
  if (!database) return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 });

  const organizationId = (sp.get('organizationId') ?? '').trim();
  const userId = (sp.get('userId') ?? '').trim();
  if (!organizationId || !userId) {
    return NextResponse.json({ error: 'organizationId and userId are required' }, { status: 400 });
  }
  const scope = { organizationId, userId };

  try {
    const plan = await store.planPlayerBackfill(database, scope);
    if (sp.get('run') !== '1') {
      // Compact preview: one line per player, with who would join it.
      const preview = plan.clusters.map(c => ({
        player: c.playerId || 'NEW',
        name: c.name, number: c.number, teams: c.teams, pitches: c.pitchCount,
        records: c.members.map(m => `${m.name} #${m.number || '-'} (${m.team || 'no team'}): ${m.pitchCount}`),
        ...(c.crossTeam ? { crossTeam: true } : {}),
        ...(c.fillsMissingNumber ? { fillsMissingNumber: true } : {}),
      }));
      return NextResponse.json({
        dataStore: mode(), toCreate: plan.toCreate, toLinkToExisting: plan.toLinkToExisting,
        pitchesToLink: plan.pitchesToLink, skipped: plan.skipped.map(r => `${r.name} (${r.team}): ${r.pitchCount}`),
        players: preview,
      });
    }

    const limit = Math.min(Math.max(Number(sp.get('limit')) || 15, 1), 30);
    const url = resolveScriptUrl();
    const done: Array<Record<string, unknown>> = [];
    // Each Sheet write takes a few seconds and grows with the Sheet, so stop
    // starting new players once 35s have passed (the function limit is 60s).
    const started = Date.now();
    for (const c of plan.clusters.slice(0, limit)) {
      if (Date.now() - started > 35_000) break;
      const playerId = c.playerId || await createPlayer(url, scope, { name: c.name, number: c.number, hand: c.hand ?? '' });
      let linked = 0;
      for (const m of c.members) linked += await attach(url, scope, playerId, m.name, m.number, m.team);
      done.push({ name: c.name, number: c.number, playerId, created: !c.playerId, linked });
    }
    const remaining = plan.clusters.length - done.length;
    return NextResponse.json({ processed: done, remaining, done: remaining <= 0 });
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

async function createPlayer(url: string, scope: store.Scope, g: { name: string; number: string; hand: string }): Promise<string> {
  const p = { organizationId: scope.organizationId, userId: scope.userId, name: g.name, number: g.number, hand: g.hand };
  if (mode() === 'database') {
    const rec = await store.createPlayer(getDbOrThrow(), p);
    const r = await sheetWrite(url, { _kind: 'createPlayer', ...p, playerId: rec.id });
    if (!r.ok) console.error('[backfill] sheet copy of player failed:', r.error);
    return rec.id;
  }
  const r = await sheetWrite(url, { _kind: 'createPlayer', ...p });
  if (!r.ok) throw new Error(r.error);
  let id = String((r.body.player as { id?: string } | undefined)?.id ?? '');
  if (!id) {
    // 405 redirect quirk: the write ran but the reply is unreadable — read
    // the Sheet's player list and take the newest exact match.
    const { readAction } = await import('@/lib/backend');
    const list = await readAction(url, 'players', scope);
    const matches = ((list.players as Array<{ id: string; name: string; number: string }>) ?? [])
      .filter(x => x.name.trim().toLowerCase() === g.name.toLowerCase() && String(x.number).trim() === g.number);
    id = matches[matches.length - 1]?.id ?? '';
  }
  if (!id) throw new Error(`Could not confirm the new player id for ${g.name} #${g.number}`);
  if (mode() === 'dual') await store.createPlayer(getDbOrThrow(), { ...p, id });
  return id;
}

async function attach(
  url: string, scope: store.Scope, playerId: string, batterName: string, batterNumber: string, visitingTeam: string,
): Promise<number> {
  const item = { playerId, batterName, batterNumber, exactNumber: true, visitingTeam };
  const payload = { _kind: 'attachHistory', organizationId: scope.organizationId, userId: scope.userId, ...item };
  if (mode() === 'database') {
    const { attached } = await store.attachHistory(getDbOrThrow(), scope, item);
    const r = await sheetWrite(url, payload);
    if (!r.ok) console.error('[backfill] sheet copy of link failed:', r.error);
    return attached;
  }
  const r = await sheetWrite(url, payload);
  if (!r.ok) throw new Error(r.error);
  if (mode() === 'dual') return (await store.attachHistory(getDbOrThrow(), scope, item)).attached;
  return 0;
}
