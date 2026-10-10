/** Load Roster: saved roster, else the last game's batting order, else suggestions. */
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — plain .mjs module
import { migrate } from '../db/migrate.mjs';
import type { Db } from '@/lib/db/client';
import * as store from '@/lib/db/store';

const A = { organizationId: 'org_a', userId: 'u1' };
let n = 0;
const pitch = (over: Record<string, unknown> = {}) => ({
  id: `pitch-${++n}`, gameId: 'g1', timestamp: new Date(Date.UTC(2026, 8, 1, 18, 0, n)).toISOString(),
  homeTeam: 'Rockets', visitingTeam: 'Central MD Cyclones Vespa 16U', batterName: 'Sam Smith', batterNumber: '7',
  batterHand: 'R', lineupPosition: 1, atBatNumber: 1, pitchNumber: 1, pitchType: 'FB', outcome: 'ball',
  organizationId: A.organizationId, userId: A.userId, ...over,
});

describe('Load Roster', () => {
  let db: Db;
  beforeEach(async () => {
    const pg = new PGlite();
    db = { query: async (t, p = []) => (await pg.query(t, p)).rows as never[] };
    await migrate((t: string, p?: unknown[]) => db.query(t, p), () => {});
    n = 0;
  });

  it('with no saved roster, loads the batting order from the most recent game vs that team', async () => {
    const kid = await store.createPlayer(db, { ...A, name: 'Joe Lee', number: '4', hand: 'L' });
    await store.writePitches(db, [
      pitch({ gameId: 'old', batterName: 'Old Guy', lineupPosition: 1 }),
      pitch({ gameId: 'g2', batterName: 'Sam Smith', lineupPosition: 1, playerId: 'PLR0099' }),
      pitch({ gameId: 'g2', batterName: 'Joe Lee', batterNumber: '4', batterHand: 'L', lineupPosition: 2 }),
      pitch({ gameId: 'g2', batterName: 'Starter', batterNumber: '9', lineupPosition: 3 }),
      pitch({ gameId: 'g2', batterName: 'Sub Kid', batterNumber: '19', lineupPosition: 3 }),
      pitch({ gameId: 'other', visitingTeam: 'Somebody Else', lineupPosition: 1, batterName: 'Nope' }),
    ]);
    // spacing/case/punctuation differences still match
    const r = await store.getRoster(db, A, 'central md  cyclones-vespa 16u');
    expect(r.source).toBe('lastGame');
    expect(r.players.map(p => [p.name, p.id])).toEqual([
      ['Sam Smith', 'PLR0099'], ['Joe Lee', kid.id], ['Sub Kid', expect.stringMatching(/^lastgame-19-/)],
    ]);
    expect(r.players[1].hand).toBe('L');
  });

  it('a saved roster wins, and a player can be on two teams\' rosters', async () => {
    await store.writePitches(db, [pitch()]);
    await store.saveRoster(db, [
      { ...A, teamName: 'Central MD Cyclones Vespa 16U', playerId: 'PLR0001', name: 'Sam Smith', number: '7' },
      { ...A, teamName: 'Fall Ball', playerId: 'PLR0001', name: 'Sam Smith', number: '7' },
    ]);
    const r = await store.getRoster(db, A, 'Central MD Cyclones Vespa 16U');
    expect(r.source).toBe('saved');
    expect((await store.getRoster(db, A, 'fall ball')).players.map(p => p.id)).toEqual(['PLR0001']);
  });

  it('suggests similarly named teams when nothing matches', async () => {
    await store.writePitches(db, [pitch()]);
    const r = await store.getRoster(db, A, 'Cyclones 16U');
    expect(r.players).toEqual([]);
    expect(r.suggestions).toEqual(['Central MD Cyclones Vespa 16U']);
  });
});
