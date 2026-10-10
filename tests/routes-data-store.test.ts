/**
 * The pitch-sync and player-create routes in each DATA_STORE mode, with
 * Clerk mocked, Postgres = in-process PGlite, and the Apps Script = a fake
 * fetch that records what it was sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — plain .mjs module
import { migrate } from '../db/migrate.mjs';
import type { Db } from '@/lib/db/client';

const afterQueue: (() => Promise<void>)[] = [];
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'u1', orgId: 'org_a' }) }));
vi.mock('next/server', async (orig) => {
  const mod = await orig<typeof import('next/server')>();
  return { ...mod, after: (fn: () => Promise<void>) => { afterQueue.push(fn); } };
});

let testDb: Db;
vi.mock('@/lib/db/client', async (orig) => {
  const mod = await orig<typeof import('@/lib/db/client')>();
  return { ...mod, getDb: () => testDb };
});

const SCRIPT = 'https://script.google.com/macros/s/TEST/exec';
let sheetPosts: unknown[] = [];
let sheetPlayers: Record<string, unknown>[] = [];

function fakeScript() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const u = new URL(input);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      sheetPosts.push(body);
      if (!Array.isArray(body) && body._kind === 'createPlayer') {
        const player = { id: body.playerId || `PLR${String(100 + sheetPlayers.length).padStart(4, '0')}`, name: body.name, number: body.number };
        sheetPlayers.push(player);
        return new Response(JSON.stringify({ status: 'ok', player }));
      }
      return new Response(JSON.stringify({ status: 'ok' }));
    }
    if (u.searchParams.get('action') === 'players') return new Response(JSON.stringify({ players: sheetPlayers }));
    return new Response(JSON.stringify({ games: [{ gameId: 'from-sheet' }] }));
  });
}

const req = (url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined) as never;

const pitch = { id: 'pitch-1', gameId: 'g1', timestamp: '2026-10-10T18:00:00.000Z', batterName: 'Sam', pitchType: 'FB', outcome: 'ball', organizationId: 'org_EVIL', userId: 'evil' };

async function flushAfter() { while (afterQueue.length) await afterQueue.shift()!(); }

describe('routes by DATA_STORE', () => {
  beforeEach(async () => {
    const pg = new PGlite();
    testDb = { query: async (t, p = []) => (await pg.query(t, p)).rows as never[] };
    await migrate((t: string, p?: unknown[]) => testDb.query(t, p), () => {});
    sheetPosts = []; sheetPlayers = []; afterQueue.length = 0;
    vi.stubEnv('SHEETS_WEBHOOK_URL', SCRIPT);
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    vi.stubGlobal('fetch', fakeScript());
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('sheets: writes only to the Sheet, with server-stamped identity', async () => {
    vi.stubEnv('DATA_STORE', '');
    const { POST } = await import('@/app/api/sheets/route');
    const res = await POST(req('/api/sheets', { webhookUrl: SCRIPT, pitches: [pitch] }));
    expect(await res.json()).toEqual({ synced: 1 });
    expect((sheetPosts[0] as Record<string, unknown>[])[0]).toMatchObject({ organizationId: 'org_a', userId: 'u1' });
    expect(await testDb.query('SELECT * FROM pitches')).toHaveLength(0);
  });

  it('dual: writes to the Sheet and copies to Postgres; reads stay on the Sheet', async () => {
    vi.stubEnv('DATA_STORE', 'dual');
    const { POST } = await import('@/app/api/sheets/route');
    await POST(req('/api/sheets', { webhookUrl: SCRIPT, pitches: [pitch] }));
    expect(sheetPosts).toHaveLength(1);
    const rows = await testDb.query<{ org_id: string; user_id: string }>('SELECT org_id, user_id FROM pitches');
    expect(rows).toEqual([{ org_id: 'org_a', user_id: 'u1' }]);
    const { GET } = await import('@/app/api/sheets/games/route');
    expect((await (await GET(req(`/api/sheets/games?url=${encodeURIComponent(SCRIPT)}`))).json()).games[0].gameId).toBe('from-sheet');
  });

  it('dual: a player created in the Sheet keeps its id in Postgres', async () => {
    vi.stubEnv('DATA_STORE', 'dual');
    const { POST } = await import('@/app/api/sheets/players/route');
    const { player } = await (await POST(req('/api/sheets/players', { webhookUrl: SCRIPT, name: 'Kid', number: '4' }))).json();
    expect(player.id).toBe('PLR0100');
    expect(await testDb.query('SELECT id, org_id FROM players')).toEqual([{ id: 'PLR0100', org_id: 'org_a' }]);
  });

  it('database: Postgres is primary, the Sheet gets a copy after the response; reads come from Postgres', async () => {
    vi.stubEnv('DATA_STORE', 'database');
    const { POST } = await import('@/app/api/sheets/route');
    await POST(req('/api/sheets', { webhookUrl: SCRIPT, pitches: [pitch] }));
    expect(await testDb.query('SELECT id FROM pitches')).toHaveLength(1);
    expect(sheetPosts).toHaveLength(0);
    await flushAfter();
    expect(sheetPosts).toHaveLength(1);
    const { GET } = await import('@/app/api/sheets/games/route');
    const games = (await (await GET(req(`/api/sheets/games?url=${encodeURIComponent(SCRIPT)}`))).json()).games;
    expect(games.map((g: { gameId: string }) => g.gameId)).toEqual(['g1']);
  });

  it('database: new players get a Postgres id and the Sheet copy is asked to keep it', async () => {
    vi.stubEnv('DATA_STORE', 'database');
    const { POST } = await import('@/app/api/sheets/players/route');
    const { player } = await (await POST(req('/api/sheets/players', { webhookUrl: SCRIPT, name: 'Kid', number: '4' }))).json();
    expect(player.id).toBe('PLR0001');
    await flushAfter();
    expect(sheetPosts[0]).toMatchObject({ _kind: 'createPlayer', playerId: 'PLR0001', organizationId: 'org_a' });
  });

  it('database + SHEETS_MIRROR=off: nothing is sent to the Sheet', async () => {
    vi.stubEnv('DATA_STORE', 'database');
    vi.stubEnv('SHEETS_MIRROR', 'off');
    const { POST } = await import('@/app/api/sheets/route');
    await POST(req('/api/sheets', { webhookUrl: SCRIPT, pitches: [pitch] }));
    await flushAfter();
    expect(sheetPosts).toHaveLength(0);
  });

  it('database only: works with no Sheet configured at all and the browser marker "app"', async () => {
    vi.stubEnv('DATA_STORE', 'database');
    vi.stubEnv('SHEETS_MIRROR', 'off');
    vi.stubEnv('SHEETS_WEBHOOK_URL', '');
    const { POST } = await import('@/app/api/sheets/route');
    expect(await (await POST(req('/api/sheets', { webhookUrl: 'app', pitches: [pitch] }))).json()).toEqual({ synced: 1 });
    const players = await import('@/app/api/sheets/players/route');
    const { player } = await (await players.POST(req('/api/sheets/players', { webhookUrl: 'app', name: 'Kid', number: '0' }))).json();
    expect(player).toMatchObject({ id: 'PLR0001', number: '0' });
    const games = await import('@/app/api/sheets/games/route');
    expect((await (await games.GET(req('/api/sheets/games?url=app'))).json()).games).toHaveLength(1);
    await flushAfter();
    expect(sheetPosts).toHaveLength(0);
  });

  it('DATA_STORE=database without DATABASE_URL falls back to the Sheet', async () => {
    vi.stubEnv('DATA_STORE', 'database');
    vi.stubEnv('DATABASE_URL', '');
    const { POST } = await import('@/app/api/sheets/route');
    await POST(req('/api/sheets', { webhookUrl: SCRIPT, pitches: [pitch] }));
    expect(sheetPosts).toHaveLength(1);
  });
});
