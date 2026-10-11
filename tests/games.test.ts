/**
 * Saved games (Resume Game / End Game) and the team shown in player
 * suggestions: the Postgres layer, the /api/games route, and rebuilding a
 * live game from stored pitches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — plain .mjs module
import { migrate } from '../db/migrate.mjs';
import type { Db } from '@/lib/db/client';
import * as store from '@/lib/db/store';
import * as games from '@/lib/db/games';
import { liveStateFromRows, snapshotOf, pitchCountOf } from '@/lib/games';
import type { SheetRow } from '@/lib/game-reconstruct';
import type { GameState } from '@/types';

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'u1', orgId: 'org_a' }) }));
let testDb: Db;
vi.mock('@/lib/db/client', async (orig) => {
  const mod = await orig<typeof import('@/lib/db/client')>();
  return { ...mod, getDb: () => testDb };
});

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
  homeTeam: 'Rockets', visitingTeam: 'Eagles', pitcherName: 'Ace', pitcherNumber: '22',
  batterName: 'Sam Smith', batterNumber: '7', batterHand: 'R', lineupPosition: 1, atBatNumber: 1, pitchNumber: 1,
  ballsBefore: 0, strikesBefore: 0, ballsAfter: 1, strikesAfter: 0, pitchType: 'FB', pitchZone: 'Ball', pitchLocation: 'B-Up-In',
  action: 'Look', outcome: 'ball', hitX: '', hitY: '', runner1B: 'No', runner2B: 'No', runner3B: 'No', outsCount: 0, baseState: 'Empty',
  isEdit: false, rosterPlayerId: '', playerId: '', organizationId: A.organizationId, userId: A.userId, ...over,
});

function snap(id: string, over: Partial<GameState> = {}): Record<string, unknown> {
  return {
    id, phase: 'pitching', homeTeam: 'Rockets', visitingTeam: 'Eagles', lineup: [], currentBatterIndex: 0,
    currentAtBat: { id: 'ab', batterIndex: 0, atBatNumber: 1, pitches: [{ id: 'p1' }], balls: 1, strikes: 0, isComplete: false, startedAt: '' },
    allAtBats: [{ id: 'ab0', pitches: [{ id: 'p0' }, { id: 'p00' }] }], ...over,
  } as Record<string, unknown>;
}

describe('saved games (Postgres)', () => {
  let db: Db;
  beforeEach(async () => { db = await freshDb(); n = 0; });

  it('autosaves, lists in-progress games per organization, and loads the snapshot', async () => {
    await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1'), status: 'active' });
    await games.saveGame(db, B, { gameId: 'g2', snapshot: snap('g2'), status: 'active' });
    const list = await games.listActiveGames(db, A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ gameId: 'g1', homeTeam: 'Rockets', visitingTeam: 'Eagles', status: 'active', pitchCount: 3 });
    const g = await games.getSavedGame(db, A, 'g1');
    expect(g?.snapshot?.id).toBe('g1');
    expect(await games.getSavedGame(db, B, 'g1')).toBeNull();
  });

  it('End Game is final: later autosaves are ignored unless the game is reopened', async () => {
    await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1'), status: 'active' });
    expect(await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1'), status: 'final' })).toEqual({ status: 'final', stale: false });
    expect(await games.listActiveGames(db, A)).toHaveLength(0);
    // a stale device keeps autosaving
    expect(await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1', { homeTeam: 'Old' }), status: 'active' })).toEqual({ status: 'final', stale: true });
    expect((await games.getSavedGame(db, A, 'g1'))?.homeTeam).toBe('Rockets');
    // Resume on an ended game reopens it
    expect(await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1'), status: 'active', reopen: true })).toEqual({ status: 'active', stale: false });
    expect((await games.getSavedGame(db, A, 'g1'))?.endedAt).toBe('');
  });

  it('dismissing from the resume list ends the game', async () => {
    await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1'), status: 'active' });
    expect(await games.endGame(db, B, 'g1')).toBe(false);
    expect(await games.endGame(db, A, 'g1')).toBe(true);
    expect(await games.listActiveGames(db, A)).toHaveLength(0);
  });

  it('counts stored pitches and shows each game\'s status in Past Games', async () => {
    await store.writePitches(db, [pitch(), pitch(), pitch({ gameId: 'g2' }), pitch({ gameId: 'g3' })]);
    await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1'), status: 'final' });
    await games.saveGame(db, A, { gameId: 'g2', snapshot: snap('g2'), status: 'active' });
    expect(await games.storedPitchCount(db, A, 'g1')).toBe(2);
    expect(await games.storedPitchCount(db, B, 'g1')).toBe(0);
    const list = (await store.getGamesList(db, A)).games;
    expect(Object.fromEntries(list.map(g => [g.gameId, g.status]))).toEqual({ g1: 'final', g2: 'active', g3: '' });
  });

  it('player suggestions carry the teams he batted for, most recent first, then rosters', async () => {
    const p = await store.createPlayer(db, { ...A, name: 'Ken Nagaishi', number: '70', hand: 'R' });
    await store.writePitches(db, [
      pitch({ playerId: p.id, visitingTeam: 'Savage Eagles 16U' }),
      pitch({ playerId: p.id, visitingTeam: 'Savage Eagles 17U' }),
      pitch({ playerId: p.id, visitingTeam: 'savage eagles 17u ' }),
    ]);
    await store.saveRoster(db, [{ ...A, teamName: 'Fall Ball', playerId: p.id, name: 'Ken Nagaishi', number: '70' }]);
    const [rec] = (await store.getPlayersList(db, A)).players;
    expect(rec.teams?.map(t => t.toLowerCase())).toEqual(['savage eagles 17u', 'savage eagles 16u', 'fall ball']);
    const other = await store.createPlayer(db, { ...A, name: 'New Kid', number: '1', hand: '' });
    expect((await store.getPlayersList(db, A)).players.find(x => x.id === other.id)?.teams).toEqual([]);
  });
});

describe('/api/games', () => {
  beforeEach(async () => {
    testDb = await freshDb();
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    vi.stubEnv('DATA_STORE', 'database');
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  const put = (body: unknown) => new Request('http://localhost/api/games', { method: 'PUT', body: JSON.stringify(body) }) as never;

  it('saves, lists, loads and ends a game for the signed-in organization', async () => {
    const route = await import('@/app/api/games/route');
    const saved = await (await route.PUT(put({ gameId: 'g1', snapshot: snap('g1'), status: 'active' }))).json();
    expect(saved).toEqual({ status: 'active', stale: false, storedPitches: 0 });
    const list = await (await route.GET(new Request('http://localhost/api/games') as never)).json();
    expect(list.games.map((g: { gameId: string }) => g.gameId)).toEqual(['g1']);
    const one = await (await route.GET(new Request('http://localhost/api/games?gameId=g1') as never)).json();
    expect(one.game.snapshot.homeTeam).toBe('Rockets');
    const ended = await route.POST(new Request('http://localhost/api/games', { method: 'POST', body: JSON.stringify({ action: 'end', gameId: 'g1' }) }) as never);
    expect(await ended.json()).toEqual({ ended: true });
  });

  it('rejects a snapshot that does not match its game id', async () => {
    const route = await import('@/app/api/games/route');
    expect((await route.PUT(put({ gameId: 'g1', snapshot: snap('other'), status: 'active' }))).status).toBe(400);
    expect((await route.PUT(put({ gameId: 'g1', snapshot: snap('g1'), status: 'paused' }))).status).toBe(400);
  });

  it('is unavailable without the database', async () => {
    vi.stubEnv('DATA_STORE', 'sheets');
    const route = await import('@/app/api/games/route');
    expect((await route.GET(new Request('http://localhost/api/games') as never)).status).toBe(503);
  });
});

describe('rebuilding a live game from its pitches', () => {
  const row = (over: Record<string, unknown>) => pitch(over) as unknown as SheetRow;

  it('picks up mid at-bat with the count, lineup links and pitcher', () => {
    n = 0;
    const rows = [
      row({ batterName: 'Sam Smith', batterNumber: '7', lineupPosition: 1, playerId: 'PLR0001', outcome: 'swinging-strike', ballsAfter: 0, strikesAfter: 1, action: 'Swing' }),
      row({ batterName: 'Sam Smith', batterNumber: '7', lineupPosition: 1, playerId: 'PLR0001', outcome: 'strikeout', pitchNumber: 2, ballsBefore: 0, strikesBefore: 1, ballsAfter: 0, strikesAfter: 2 }),
      row({ batterName: 'Joe Lee', batterNumber: '4', lineupPosition: 2, outcome: 'ball', ballsAfter: 1, strikesAfter: 0, outsCount: 1, pitcherName: 'Reliever', pitcherNumber: '9' }),
      row({ batterName: 'Joe Lee', batterNumber: '4', lineupPosition: 2, outcome: 'ball', pitchNumber: 2, ballsBefore: 1, ballsAfter: 2, strikesAfter: 0, outsCount: 1, pitcherName: 'Reliever', pitcherNumber: '9', runner1B: 'Yes' }),
    ];
    const g = liveStateFromRows(rows);
    expect(g.id).toBe('g1');
    expect(g.lineup.map(p => [p.name, p.id])).toEqual([['Sam Smith', 'PLR0001'], ['Joe Lee', expect.stringContaining('resumed-4')]]);
    expect(g.allAtBats).toHaveLength(1);
    expect(g.allAtBats[0]).toMatchObject({ result: 'strikeout', batterIndex: 0, playerId: 'PLR0001' });
    expect(g.allAtBats[0].pitches.map(p => p.id)).toEqual(['pitch-1', 'pitch-2']);
    expect(g.allAtBats[0].pitches[0].lineupPosition).toBe(0);
    expect(g.currentBatterIndex).toBe(1);
    expect(g.currentAtBat).toMatchObject({ batterIndex: 1, balls: 2, strikes: 0, isComplete: false });
    expect(g.currentAtBat?.pitches).toHaveLength(2);
    expect(g.pitcher).toMatchObject({ name: 'Reliever', number: '9' });
    expect(g.pitcherHistory.map(p => p.name)).toEqual(['Ace']);
    expect(g.outsCount).toBe(1);
    expect(g.baseState.first).toBe(true);
    expect(pitchCountOf(g)).toBe(4);
    expect(g.syncQueue).toEqual([]);
  });

  it('after a finished at-bat, moves to the next batter and counts the out', () => {
    n = 0;
    const rows = [
      row({ lineupPosition: 1, batterName: 'A', outcome: 'ball' }),
      row({ lineupPosition: 2, batterName: 'B', outcome: 'in-play', hitResult: 'out', hitType: 'fly-ball', outsCount: 2 }),
    ];
    const g = liveStateFromRows(rows);
    // the first at-bat never finished (coach moved on) — kept as an ended at-bat
    expect(g.allAtBats.map(ab => ab.result)).toEqual(['manual-end', 'in-play']);
    expect(g.currentBatterIndex).toBe(0);
    expect(g.currentAtBat).toMatchObject({ batterIndex: 0, atBatNumber: 2, pitches: [] });
    // 3rd out: side retired
    expect(g.outsCount).toBe(0);
  });

  it('snapshots drop the toast and half-entered pitch but keep unsynced pitches', () => {
    n = 0;
    const g = liveStateFromRows([row({ outcome: 'ball' })]);
    const live: GameState = {
      ...g,
      notification: { message: 'hi', type: 'info' },
      pendingPitch: { pitchType: 'CB', location: { row: 1, col: 1, zone: 'strike', zoneNumber: 5 }, swing: 'swing', contact: null },
      syncQueue: g.currentAtBat!.pitches,
    };
    const s = snapshotOf(live);
    expect(s.notification).toBeNull();
    expect(s.pendingPitch).toEqual({ pitchType: 'CB', location: null, swing: null, contact: null });
    expect(s.syncQueue).toHaveLength(1);
  });
});

describe('test-game cleanup and home/away', () => {
  it('lists and deletes only games with 4 or fewer pitches, with a backup', async () => {
    const db = await freshDb();
    n = 0;
    await store.writePitches(db, [
      ...Array.from({ length: 4 }, () => pitch({ gameId: 'tiny' })),
      ...Array.from({ length: 5 }, () => pitch({ gameId: 'real' })),
      pitch({ gameId: 'other-org', organizationId: 'org_b', userId: 'u9' }),
    ]);
    await games.saveGame(db, A, { gameId: 'tiny', snapshot: snap('tiny'), status: 'active' });
    const small = await store.listSmallGames(db, 4);
    expect(small.map(g => [g.gameId, g.pitches])).toEqual([['tiny', 4], ['other-org', 1]]);
    const r = await store.deleteGames(db, small.map(g => g.gameId));
    expect(r.pitches).toHaveLength(5);
    expect(r.savedGames).toBe(1);
    expect((await store.getGamesList(db, A)).games.map(g => g.gameId)).toEqual(['real']);
  });

  it('Past Games and the resume list know whether we were home or away', async () => {
    const db = await freshDb();
    n = 0;
    await store.writePitches(db, [pitch({ gameId: 'g1' }), pitch({ gameId: 'g2' })]);
    await games.saveGame(db, A, { gameId: 'g1', snapshot: snap('g1', { weAreHome: false }), status: 'active' });
    const list = (await store.getGamesList(db, A)).games;
    expect(Object.fromEntries(list.map(g => [g.gameId, g.weAreHome]))).toEqual({ g1: false, g2: null });
    expect((await games.listActiveGames(db, A))[0].weAreHome).toBe(false);
  });
});
