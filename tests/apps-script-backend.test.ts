/**
 * Runs docs/apps-script.js against a tiny in-memory mock of the Google Apps
 * Script services, to check the security behaviour of the deployed backend:
 * the shared-secret gate and the tenant check on pitch edits.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Row = unknown[];

function makeEnv(props: Record<string, string>) {
  const sheets: Record<string, Row[]> = {};
  const makeSheet = (name: string) => {
    sheets[name] = sheets[name] ?? [];
    const rows = sheets[name];
    const range = (r: number, c: number, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals: Row[]) => vals.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] ?? []; v.forEach((x, j) => { (rows[r - 1 + i] as Row)[c - 1 + j] = x; }); }),
      setValue: (x: unknown) => { rows[r - 1] = rows[r - 1] ?? []; (rows[r - 1] as Row)[c - 1] = x; },
      setBackground: () => range(r, c, nr, nc), setFontColor: () => range(r, c, nr, nc), setFontWeight: () => range(r, c, nr, nc),
      setNumberFormat: () => range(r, c, nr, nc), setHorizontalAlignment: () => range(r, c, nr, nc), merge: () => range(r, c, nr, nc), setValueAt: () => {},
    });
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(r => r.length)),
      getRange: range,
      setFrozenRows: () => {}, autoResizeColumns: () => {}, insertRowBefore: () => {}, getName: () => name,
    };
  };
  const ss = { getSheetByName: (n: string) => (sheets[n] ? makeSheet(n) : null), insertSheet: (n: string) => makeSheet(n) };
  let locked = false;
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ alert: () => {} }) },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => ({ text: t }) }), MimeType: { JSON: 'json' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { locked = true; }, releaseLock: () => { locked = false; } }) },
    Logger: { log: () => {} },
    Utilities: { formatDate: (d: Date) => d.toISOString() },
    Session: { getScriptTimeZone: () => 'UTC' },
  } as Record<string, unknown>;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../docs/apps-script.js'), 'utf8'), ctx);
  const call = (fn: string, e: unknown) => JSON.parse((ctx[fn] as (e: unknown) => { text: string })(e).text);
  return { sheets, ctx, call, isLocked: () => locked };
}

const pitch = (over: Record<string, unknown>) => ({
  gameId: 'g1', timestamp: '2026-10-10T12:00:00Z', pitcherName: 'Ace', batterName: 'B1', pitchType: 'FB',
  outcome: 'ball', id: 'pitch-1', isEdit: false, ...over,
});

describe('Apps Script shared secret', () => {
  it('refuses GET and POST without the key once API_SECRET is set', () => {
    const env = makeEnv({ API_SECRET: 'abc123' });
    expect(env.call('doGet', { parameter: { action: 'games', organizationId: 'org_a' } }).error).toBe('Unauthorized');
    const post = env.call('doPost', { parameter: {}, postData: { contents: JSON.stringify([pitch({ organizationId: 'org_a', userId: 'u1' })]) } });
    expect(post.message).toBe('Unauthorized');
    expect(env.sheets.Pitches).toBeUndefined();
  });

  it('refuses a wrong key', () => {
    const env = makeEnv({ API_SECRET: 'abc123' });
    expect(env.call('doGet', { parameter: { key: 'abc124', action: 'games', organizationId: 'org_a' } }).error).toBe('Unauthorized');
  });

  it('accepts the right key, and releases the write lock afterwards', () => {
    const env = makeEnv({ API_SECRET: 'abc123' });
    const post = env.call('doPost', { parameter: { key: 'abc123' }, postData: { contents: JSON.stringify([pitch({ organizationId: 'org_a', userId: 'u1' })]) } });
    expect(post.status).toBe('ok');
    expect(env.sheets.Pitches.length).toBe(2); // header + 1 row
    expect(env.isLocked()).toBe(false);
    const games = env.call('doGet', { parameter: { key: 'abc123', action: 'games', organizationId: 'org_a', userId: 'u1' } });
    expect(games.games).toHaveLength(1);
  });

  it('still works with no API_SECRET configured (safe rollout)', () => {
    const env = makeEnv({});
    expect(env.call('doGet', { parameter: { action: 'games', organizationId: 'org_a' } }).error).not.toBe('Unauthorized');
  });
});

describe('Apps Script edit scoping', () => {
  let env: ReturnType<typeof makeEnv>;
  const post = (rows: unknown[]) => env.call('doPost', { parameter: { key: 'k' }, postData: { contents: JSON.stringify(rows) } });

  beforeEach(() => {
    env = makeEnv({ API_SECRET: 'k' });
    post([pitch({ id: 'pitch-A', organizationId: 'org_a', userId: 'ua', pitchType: 'FB' })]);
  });

  const pitchTypeOf = (id: string) => {
    const rows = env.sheets.Pitches;
    const header = rows[0] as string[];
    const idIdx = header.indexOf('Row ID');
    const ptIdx = header.indexOf('Pitch Type');
    return rows.find(r => r[idIdx] === id)?.[ptIdx];
  };

  it('applies an edit from the same organization', () => {
    post([{ id: 'pitch-A', isEdit: true, pitchType: 'CB', organizationId: 'org_a', userId: 'ua2' }]);
    expect(pitchTypeOf('pitch-A')).toBe('CB');
  });

  it('refuses an edit from another organization', () => {
    post([{ id: 'pitch-A', isEdit: true, pitchType: 'SL', organizationId: 'org_b', userId: 'ub' }]);
    expect(pitchTypeOf('pitch-A')).toBe('FB');
  });
});

describe('Apps Script additions for the Postgres move', () => {
  it('export is refused until a secret is configured, then pages through rows', () => {
    const open = makeEnv({});
    expect(open.call('doGet', { parameter: { action: 'export' } }).error).toMatch(/disabled/);

    const env = makeEnv({ API_SECRET: 'k' });
    const rows = Array.from({ length: 5 }, (_, i) => pitch({ id: `p${i}`, organizationId: i < 3 ? 'org_a' : 'org_b', userId: 'u' }));
    env.call('doPost', { parameter: { key: 'k' }, postData: { contents: JSON.stringify(rows) } });
    const first = env.call('doGet', { parameter: { key: 'k', action: 'export', offset: '0', limit: '3' } });
    expect(first.total).toBe(5);
    expect(first.pitches.map((p: { id: string }) => p.id)).toEqual(['p0', 'p1', 'p2']);
    expect(first.players).toEqual([]);
    const second = env.call('doGet', { parameter: { key: 'k', action: 'export', offset: '3', limit: '3' } });
    expect(second.pitches.map((p: { id: string }) => p.id)).toEqual(['p3', 'p4']);
    expect(second.players).toBeUndefined();
  });

  it('export reads columns by position, even with no header text over them', () => {
    const env = makeEnv({ API_SECRET: 'k' });
    env.call('doPost', { parameter: { key: 'k' }, postData: { contents: JSON.stringify([pitch({ id: 'p1', organizationId: 'org_a', userId: 'u', playerId: 'PLR0007' })]) } });
    const header = env.sheets.Pitches[0] as string[];
    header.splice(header.indexOf('Player ID')); // an old sheet: no labels on the newer columns
    const out = env.call('doGet', { parameter: { key: 'k', action: 'export' } });
    expect(out.pitches[0]).toMatchObject({ id: 'p1', organizationId: 'org_a', playerId: 'PLR0007', userId: 'u' });
  });

  it('attachHistory can match an exact number and the batter team', () => {
    const env = makeEnv({ API_SECRET: 'k' });
    const post = (body: unknown) => env.call('doPost', { parameter: { key: 'k' }, postData: { contents: JSON.stringify(body) } });
    post([
      pitch({ id: 'a', batterName: 'White', batterNumber: '', visitingTeam: 'Hawks', organizationId: 'org_a', userId: 'u' }),
      pitch({ id: 'b', batterName: 'White', batterNumber: '', visitingTeam: 'Tigers', organizationId: 'org_a', userId: 'u' }),
      pitch({ id: 'c', batterName: 'White', batterNumber: '3', visitingTeam: 'Hawks', organizationId: 'org_a', userId: 'u' }),
    ]);
    const r = post({ _kind: 'attachHistory', organizationId: 'org_a', userId: 'u', playerId: 'PLR0001', batterName: 'white', batterNumber: '', exactNumber: true, visitingTeam: 'hawks' });
    expect(r.attached).toBe(1);
    const legacy = post({ _kind: 'attachHistory', organizationId: 'org_a', userId: 'u', playerId: 'PLR0002', batterName: 'White', batterNumber: '' });
    expect(legacy.attached).toBe(2); // old behaviour unchanged: blank number = any number, any team
  });

  it('createPlayer keeps a requested free PLR id, and generates one otherwise', () => {
    const env = makeEnv({ API_SECRET: 'k' });
    const create = (extra: Record<string, unknown>) => env.call('doPost', {
      parameter: { key: 'k' },
      postData: { contents: JSON.stringify({ _kind: 'createPlayer', organizationId: 'org_a', userId: 'u', name: 'Kid', ...extra }) },
    }).player.id;
    expect(create({ playerId: 'PLR0042' })).toBe('PLR0042');
    expect(create({ playerId: 'PLR0042' })).toBe('PLR0043'); // taken -> next
    expect(create({ playerId: 'not-an-id' })).toBe('PLR0044');
    expect(create({})).toBe('PLR0045');
  });
});
