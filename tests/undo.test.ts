/**
 * Undo removes the pitch from the stored record too — including one that
 * was already uploaded — and an upload in flight can't swallow the removal.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — plain .mjs module
import { migrate } from '../db/migrate.mjs';
import type { Db } from '@/lib/db/client';
import * as store from '@/lib/db/store';
import { gameReducer, createInitialState } from '@/hooks/use-game';
import type { GameState, PitchRecord } from '@/types';

function startedGame(): GameState {
  let s = gameReducer(createInitialState(), { type: 'START_GAME', homeTeam: 'Rockets', visitingTeam: 'Eagles' });
  s = gameReducer(s, { type: 'ADD_BATTER', player: { id: 'PLR0001', name: 'Sam Smith', number: '7' } });
  s = gameReducer(s, { type: 'CHANGE_PITCHER', pitcher: { id: 'p', name: 'Ace', number: '22' } });
  return s;
}

function throwBall(s: GameState): GameState {
  s = gameReducer(s, { type: 'SET_PITCH_TYPE', pitchType: 'FB' });
  s = gameReducer(s, { type: 'SET_LOCATION', location: { row: 0, col: 0, zone: 'ball' } });
  s = gameReducer(s, { type: 'SET_SWING', swing: 'no-swing' });
  return gameReducer(s, { type: 'RECORD_PITCH' });
}

describe('undo pitch', () => {
  it('queues a removal for a pitch that was already uploaded', () => {
    let s = throwBall(startedGame());
    const [p] = s.syncQueue;
    s = gameReducer(s, { type: 'MARK_SYNCED', entries: [p] });
    expect(s.syncQueue).toHaveLength(0);
    s = gameReducer(s, { type: 'UNDO_PITCH' });
    expect(s.currentAtBat?.pitches).toHaveLength(0);
    expect(s.syncQueue).toEqual([expect.objectContaining({ id: p.id, isDelete: true, isEdit: false })]);
  });

  it('keeps the removal when the original upload finishes after the undo', () => {
    let s = throwBall(startedGame());
    const inFlight = [...s.syncQueue];         // upload started with this
    s = gameReducer(s, { type: 'UNDO_PITCH' });  // coach undoes meanwhile
    s = gameReducer(s, { type: 'MARK_SYNCED', entries: inFlight });
    expect(s.syncQueue).toEqual([expect.objectContaining({ id: inFlight[0].id, isDelete: true })]);
  });

  it('drops a waiting edit of the undone pitch', () => {
    let s = throwBall(startedGame());
    const [p] = s.syncQueue;
    s = gameReducer(s, { type: 'MARK_SYNCED', entries: [p] });
    s = gameReducer(s, { type: 'EDIT_PITCH', atBatId: s.currentAtBat!.id, pitchId: p.id, updates: { pitchType: 'SL' } });
    s = gameReducer(s, { type: 'UNDO_PITCH' });
    expect(s.syncQueue.map((q: PitchRecord) => [q.id, !!q.isEdit, !!q.isDelete])).toEqual([[p.id, false, true]]);
  });
});

describe('stored pitch removal', () => {
  async function freshDb(): Promise<Db> {
    const pg = new PGlite();
    const db: Db = { query: async (text, params = []) => (await pg.query(text, params)).rows as never[] };
    await migrate((t: string, p?: unknown[]) => db.query(t, p), () => {});
    return db;
  }
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'pitch-1', gameId: 'g1', timestamp: '2026-10-10T18:00:00.000Z', batterName: 'Sam', pitchType: 'FB',
    outcome: 'ball', organizationId: 'org_a', userId: 'u1', ...over,
  });

  it('deletes only within the organization, and handles insert + undo in one upload', async () => {
    const db = await freshDb();
    await store.writePitches(db, [row(), row({ id: 'pitch-2' })]);
    expect(await store.writePitches(db, [row({ isDelete: true, organizationId: 'org_b', userId: 'u9' })])).toMatchObject({ deleted: 0 });
    expect(await store.writePitches(db, [row({ isDelete: true })])).toMatchObject({ deleted: 1, newRows: 0 });
    // recorded and undone while offline: arrives together
    await store.writePitches(db, [row({ id: 'pitch-3' }), row({ id: 'pitch-3', isDelete: true })]);
    const ids = (await store.getGameScout(db, { organizationId: 'org_a', userId: 'u1' }, 'g1')).pitches.map(p => p.id);
    expect(ids).toEqual(['pitch-2']);
  });
});
