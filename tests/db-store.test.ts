import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — plain .mjs module
import { migrate } from '../db/migrate.mjs';
import type { Db } from '@/lib/db/client';
import * as store from '@/lib/db/store';

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = { query: async (text, params = []) => (await pg.query(text, params)).rows as never[] };
  await migrate((t: string, p?: unknown[]) => db.query(t, p), () => {});
  return db;
}

const A = { organizationId: 'org_a', userId: 'u1' };
const B = { organizationId: 'org_b', userId: 'u9' };
let n = 0;
const pitch = (over: Record<string, unknown> = {}) => ({
  id: `pitch-${++n}`, gameId: 'g1', timestamp: new Date(Date.UTC(2026, 9, 1, 18, 0, n)).toISOString(),
  homeTeam: 'Home', visitingTeam: 'Away', pitcherName: 'Ace', pitcherNumber: '22',
  batterName: 'Sam Smith', batterNumber: '7', batterHand: 'R', lineupPosition: 1, atBatNumber: 1, pitchNumber: 1,
  ballsBefore: 0, strikesBefore: 0, ballsAfter: 1, strikesAfter: 0, pitchType: 'FB', pitchZone: 'Ball', pitchLocation: 'B-Up-In',
  action: 'Look', outcome: 'ball', hitX: '', hitY: '', runner1B: 'No', runner2B: 'No', runner3B: 'No', outsCount: 0, baseState: 'Empty',
  isEdit: false, rosterPlayerId: '', playerId: '', organizationId: A.organizationId, userId: A.userId, ...over,
});

describe('Postgres store', () => {
  let db: Db;
  beforeEach(async () => { db = await freshDb(); n = 0; });

  it('migrations are idempotent', async () => {
    const again = await migrate((t: string, p?: unknown[]) => db.query(t, p), () => {});
    expect(again).toEqual([]);
  });

  it('writes pitches idempotently and returns the Sheet shape', async () => {
    const p1 = pitch({ hitX: 12.5, hitY: 40 });
    await store.writePitches(db, [p1]);
    await store.writePitches(db, [p1]); // retried sync
    const { pitches } = await store.getGameScout(db, A, 'g1');
    expect(pitches).toHaveLength(1);
    expect(Object.keys(pitches[0])).toEqual(store.SHEET_PITCH_KEYS);
    expect(pitches[0]).toMatchObject({ id: p1.id, batterName: 'Sam Smith', lineupPosition: 1, hitX: 12.5, hitY: 40, isEdit: false, organizationId: 'org_a' });
    expect(pitches[0].timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it('keeps organizations apart and honours legacy user-scoped rows', async () => {
    await store.writePitches(db, [pitch(), pitch({ organizationId: 'org_b', userId: 'u9' }), pitch({ organizationId: '', userId: 'u1', gameId: 'g0' })]);
    expect((await store.getGamesList(db, A)).games.map(g => g.gameId).sort()).toEqual(['g0', 'g1']);
    expect((await store.getGamesList(db, B)).games).toHaveLength(1);
    expect((await store.getGamesList(db, { organizationId: 'org_c', userId: 'u1' })).games.map(g => g.gameId)).toEqual(['g0']);
  });

  it('applies edits only within scope', async () => {
    const p1 = pitch();
    await store.writePitches(db, [p1]);
    await store.writePitches(db, [{ ...p1, isEdit: true, pitchType: 'SL', organizationId: 'org_b', userId: 'u9' }]);
    expect((await store.getGameScout(db, A, 'g1')).pitches[0].pitchType).toBe('FB');
    await store.writePitches(db, [{ ...p1, isEdit: true, pitchType: 'CB' }]);
    expect((await store.getGameScout(db, A, 'g1')).pitches[0].pitchType).toBe('CB');
  });

  it('scout with no gameId returns the latest game', async () => {
    await store.writePitches(db, [pitch({ gameId: 'old' }), pitch({ gameId: 'new' })]);
    expect((await store.getGameScout(db, A, '')).gameId).toBe('new');
  });

  it('games list keeps the latest non-blank team names, newest game first', async () => {
    await store.writePitches(db, [
      pitch({ gameId: 'g1', homeTeam: '' }), pitch({ gameId: 'g1', homeTeam: 'Hawks' }), pitch({ gameId: 'g1', homeTeam: '' }),
      pitch({ gameId: 'g2' }),
    ]);
    const { games } = await store.getGamesList(db, A);
    expect(games.map(g => g.gameId)).toEqual(['g2', 'g1']);
    expect(games[1]).toMatchObject({ homeTeam: 'Hawks', pitchCount: 3 });
  });

  it('batter history: id fast path, name match, number disambiguation and fallback', async () => {
    await store.writePitches(db, [
      pitch({ batterName: 'Sam  Smith ', batterNumber: '7', atBatNumber: 2, pitchNumber: 1 }),
      pitch({ batterName: 'sam smith', batterNumber: '7', atBatNumber: 1, pitchNumber: 2 }),
      pitch({ batterName: 'Sam Smith', batterNumber: '12', atBatNumber: 1, pitchNumber: 1, playerId: 'PLR0003' }),
    ]);
    const byName = await store.getBatterHistory(db, A, { batterName: 'Sam Smith', batterNum: '7', playerId: '' });
    expect(byName.pitches.map(p => p.batterNumber)).toEqual(['7', '7']); // two numbers seen -> narrowed to #7
    expect(byName.pitches.map(p => p.atBatNumber)).toEqual([1, 2]);
    const fallback = await store.getBatterHistory(db, A, { batterName: 'Sam Smith', batterNum: '99', playerId: '' });
    expect(fallback.count).toBe(3); // nothing for #99 -> every name match
    const byId = await store.getBatterHistory(db, A, { batterName: '', batterNum: '', playerId: 'PLR0003' });
    expect(byId.count).toBe(1);
    expect(byId.sheetRows).toBe(3);
  });

  it('rosters upsert by player and keep their original order', async () => {
    const base = { organizationId: 'org_a', userId: 'u1', teamName: 'Tigers' };
    await store.saveRoster(db, [{ ...base, playerId: 'roster-1', name: 'One' }, { ...base, playerId: 'roster-2', name: 'Two' }]);
    await store.saveRoster(db, [{ ...base, playerId: 'roster-1', name: 'One Updated', userId: 'u2' }]);
    const { players } = await store.getRoster(db, A, ' tigers ');
    expect(players.map(p => p.name)).toEqual(['One Updated', 'Two']);
    expect((await store.getRoster(db, B, 'Tigers')).players).toHaveLength(0);
  });

  it('players: sequential ids continue after imported ids, with live stats', async () => {
    await store.importSheetPage(db, { players: [{ playerId: 'PLR0041', organizationId: 'org_a', playerName: 'Imported', jerseyNumber: '3', isActive: true, verified: true }] });
    const p = await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'New Kid', number: '5', hand: 'L' });
    expect(p.id).toBe('PLR0042');
    await store.writePitches(db, [pitch({ playerId: 'PLR0042', gameId: 'g1' }), pitch({ playerId: 'PLR0042', gameId: 'g2' })]);
    const { players } = await store.getPlayersList(db, A);
    expect(players.map(x => x.id)).toEqual(['PLR0041', 'PLR0042']);
    expect(players[1]).toMatchObject({ name: 'New Kid', hand: 'L', gamesSeen: 2, pitchesSeen: 2, isActive: true });
    expect((await store.getPlayersList(db, B)).players).toHaveLength(0);
    // copying a Sheet-created player keeps its id
    const copy = await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'From Sheet', id: 'PLR0050' });
    expect(copy.id).toBe('PLR0050');
    expect((await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'After' })).id).toBe('PLR0051');
  });

  it('the first player in an empty database is PLR0001', async () => {
    expect((await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'First' })).id).toBe('PLR0001');
    expect((await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'Second' })).id).toBe('PLR0002');
  });

  it('unlinked batters and attach', async () => {
    await store.writePitches(db, [pitch({ gameId: 'g1' }), pitch({ gameId: 'g2' }), pitch({ batterName: 'Lee', batterNumber: '4' })]);
    const { batters } = await store.getUnlinkedBatters(db, A);
    expect(batters[0]).toEqual({ name: 'Sam Smith', number: '7', pitchCount: 2, gameCount: 2 });
    const p = await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'Sam Smith', number: '7' });
    expect(await store.attachHistory(db, A, { playerId: p.id, batterName: 'sam smith', batterNumber: '7' })).toEqual({ attached: 2 });
    expect((await store.getUnlinkedBatters(db, A)).batters.map(b => b.name)).toEqual(['Lee']);
  });

  it('merge moves pitches and rosters, deactivates the source, refuses other orgs', async () => {
    const src = await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'Dupe' });
    const tgt = await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'Real' });
    const other = await store.createPlayer(db, { organizationId: 'org_b', userId: 'u9', name: 'Other' });
    await store.writePitches(db, [pitch({ playerId: src.id }), pitch({ playerId: tgt.id })]);
    const base = { organizationId: 'org_a', userId: 'u1', teamName: 'T' };
    await store.saveRoster(db, [{ ...base, playerId: src.id }, { ...base, playerId: tgt.id }]);
    await expect(store.mergePlayers(db, A, src.id, other.id)).rejects.toThrow(/organization/);
    const r = await store.mergePlayers(db, A, src.id, tgt.id);
    expect(r).toMatchObject({ merged: true, pitchesReassigned: 1, target: { pitchesSeen: 2 } });
    expect((await store.getPlayersList(db, A)).players.map(p => p.id)).toEqual([tgt.id]);
    expect((await store.getRoster(db, A, 'T')).players.map(p => p.id)).toEqual([tgt.id]);
  });

  it('update player is limited to the owning organization', async () => {
    const p = await store.createPlayer(db, { organizationId: 'org_a', userId: 'u1', name: 'Typo' });
    expect((await store.updatePlayer(db, A, p.id, { name: 'Fixed', verified: false })).name).toBe('Fixed');
    await expect(store.updatePlayer(db, B, p.id, { name: 'Hijack' })).rejects.toThrow(/not found/);
  });

  it('a page with the same pitch twice (a retried sync) imports one row', async () => {
    const p1 = pitch({ id: 'pitch-dup' });
    const r = await store.importSheetPage(db, { pitches: [p1, { ...p1, pitchType: 'CB' }, pitch()] });
    expect(r.pitches).toBe(3);
    const rows = await db.query<{ id: string; pitch_type: string }>(`SELECT id, pitch_type FROM pitches ORDER BY id`);
    expect(rows).toHaveLength(2);
    expect(rows.find(x => x.id === 'pitch-dup')?.pitch_type).toBe('CB');
  });

  it('a re-import never blanks the organization or player already in Postgres', async () => {
    await store.writePitches(db, [pitch({ id: 'pitch-live', organizationId: 'org_z', playerId: 'PLR0009' })]);
    await store.importSheetPage(db, { pitches: [pitch({ id: 'pitch-live', organizationId: '', playerId: '', pitchType: 'SL' })] });
    const [row] = await db.query<{ org_id: string; player_id: string; pitch_type: string }>(
      `SELECT org_id, player_id, pitch_type FROM pitches WHERE id = 'pitch-live'`);
    expect(row).toEqual({ org_id: 'org_z', player_id: 'PLR0009', pitch_type: 'SL' });
  });

  it('sheet import is repeatable, skips edit rows, and ids rows that had none', async () => {
    const legacy = { ...pitch(), id: '' };
    const page = { pitches: [pitch({ id: 'pitch-x' }), legacy, { ...pitch(), isEdit: 'TRUE' }] };
    expect((await store.importSheetPage(db, page)).pitches).toBe(2);
    await store.importSheetPage(db, page);
    const { totals } = await store.countsByScope(db);
    expect(totals.pitches).toBe(2);
    const ids = (await store.getGameScout(db, A, 'g1')).pitches.map(p => p.id);
    expect(ids.some(id => String(id).startsWith('sheet-'))).toBe(true);
  });
});
