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
 * Each unlinked (name, jersey number) group is linked to an existing active
 * player with the same name and number if there is one, otherwise a new
 * player is created. Writes go through the same Sheet/Postgres path as the
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
      return NextResponse.json({ dataStore: mode(), ...plan, groups: plan.groups.length, preview: plan.groups });
    }

    const limit = Math.min(Math.max(Number(sp.get('limit')) || 5, 1), 25);
    const url = resolveScriptUrl();
    const done: Array<Record<string, unknown>> = [];
    for (const g of plan.groups.slice(0, limit)) {
      let playerId = g.existingPlayerId;
      if (!playerId) {
        playerId = await createPlayer(url, scope, g);
      }
      await attach(url, scope, playerId, g.name, g.number);
      done.push({ name: g.name, number: g.number, playerId, created: !g.existingPlayerId, pitches: g.pitchCount });
    }
    const remaining = plan.groups.length - done.length;
    return NextResponse.json({ processed: done, remaining, done: remaining <= 0 });
  } catch (err) {
    const { body, status } = scriptErrorBody(err);
    return NextResponse.json(body, { status });
  }
}

async function createPlayer(url: string, scope: store.Scope, g: store.BackfillGroup): Promise<string> {
  const p = { organizationId: scope.organizationId, userId: scope.userId, name: g.name, number: g.number, hand: g.hand ?? '' };
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
    // 405 redirect quirk: the write ran but the reply is unreadable. The
    // newest exact match in Postgres can't be used yet (not copied), so ask
    // the Sheet for its player list.
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

async function attach(url: string, scope: store.Scope, playerId: string, batterName: string, batterNumber: string) {
  const payload = { _kind: 'attachHistory', organizationId: scope.organizationId, userId: scope.userId, playerId, batterName, batterNumber };
  if (mode() === 'database') {
    await store.attachHistory(getDbOrThrow(), scope, { playerId, batterName, batterNumber });
    const r = await sheetWrite(url, payload);
    if (!r.ok) console.error('[backfill] sheet copy of attach failed:', r.error);
    return;
  }
  const r = await sheetWrite(url, payload);
  if (!r.ok) throw new Error(r.error);
  if (mode() === 'dual') await store.attachHistory(getDbOrThrow(), scope, { playerId, batterName, batterNumber });
}
