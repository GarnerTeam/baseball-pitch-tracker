// Server-only: the Postgres implementation of every Apps Script action.
//
// Each read returns exactly the JSON shape the Apps Script returns for the
// same action, so API routes can switch stores without any client change.
// Each write applies the same rules (scoping, edit fields, merge guards).
import { createHash } from 'node:crypto';
import type { Db } from './client';

// ── Scope ──────────────────────────────────────────────────────────────────
// Same rule as the Apps Script rowMatchesScope(): a row with an org_id
// belongs to that organization; a legacy row with no org_id belongs to the
// user who recorded it.
export interface Scope { organizationId: string; userId: string }

const PITCH_SCOPE = `(org_id = $1 OR (org_id = '' AND user_id = $2))`;
const ROSTER_SCOPE = `(org_id = $1 OR (org_id = '' AND user_id = $2))`;

// ── Pitch rows: Sheet shape <-> Postgres columns ─────────────────────────────
type Kind = 'text' | 'int' | 'float' | 'ts';
/** [Sheet / API key, Postgres column, kind] — order follows the Sheet COLUMNS. */
const PITCH_FIELDS: [string, string, Kind][] = [
  ['gameId', 'game_id', 'text'], ['timestamp', 'ts', 'ts'],
  ['homeTeam', 'home_team', 'text'], ['visitingTeam', 'visiting_team', 'text'],
  ['pitcherNumber', 'pitcher_number', 'text'], ['pitcherName', 'pitcher_name', 'text'],
  ['batterNumber', 'batter_number', 'text'], ['batterName', 'batter_name', 'text'], ['batterHand', 'batter_hand', 'text'],
  ['lineupPosition', 'lineup_position', 'int'], ['atBatNumber', 'at_bat_number', 'int'], ['pitchNumber', 'pitch_number', 'int'],
  ['ballsBefore', 'balls_before', 'int'], ['strikesBefore', 'strikes_before', 'int'],
  ['pitchType', 'pitch_type', 'text'], ['pitchZone', 'pitch_zone', 'text'], ['pitchLocation', 'pitch_location', 'text'],
  ['action', 'action', 'text'], ['outcome', 'outcome', 'text'],
  ['ballsAfter', 'balls_after', 'int'], ['strikesAfter', 'strikes_after', 'int'],
  ['hitType', 'hit_type', 'text'], ['hitTypeName', 'hit_type_name', 'text'],
  ['hitResult', 'hit_result', 'text'], ['hitResultName', 'hit_result_name', 'text'],
  ['hitZone', 'hit_zone', 'text'], ['hitX', 'hit_x', 'float'], ['hitY', 'hit_y', 'float'],
  ['runner1B', 'runner_1b', 'text'], ['runner2B', 'runner_2b', 'text'], ['runner3B', 'runner_3b', 'text'],
  ['outsCount', 'outs_count', 'int'], ['baseState', 'base_state', 'text'],
  ['id', 'id', 'text'], ['userId', 'user_id', 'text'],
  ['rosterPlayerId', 'roster_player_id', 'text'], ['playerId', 'player_id', 'text'],
  ['organizationId', 'org_id', 'text'],
];

/** The Sheet COLUMNS list, in order — every pitch object carries all of them. */
export const SHEET_PITCH_KEYS = [
  'gameId', 'timestamp', 'homeTeam', 'visitingTeam',
  'pitcherNumber', 'pitcherName', 'batterNumber', 'batterName', 'batterHand',
  'lineupPosition', 'atBatNumber', 'pitchNumber',
  'ballsBefore', 'strikesBefore', 'pitchType', 'pitchZone', 'pitchLocation',
  'action', 'outcome', 'ballsAfter', 'strikesAfter',
  'hitType', 'hitTypeName', 'hitResult', 'hitResultName', 'hitZone', 'hitX', 'hitY',
  'runner1B', 'runner2B', 'runner3B', 'outsCount', 'baseState',
  'id', 'isEdit', 'userId', 'rosterPlayerId', 'playerId', 'organizationId',
];

function toText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toTs(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Same text format the Apps Script uses for date cells. */
export function formatTs(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isEditRow(r: Record<string, unknown>): boolean {
  const v = r.isEdit;
  return v === true || v === 'true' || v === 'TRUE' || v === 1;
}

/** Stable id for an imported Sheet row that predates the `id` column. */
export function legacyPitchId(r: Record<string, unknown>): string {
  const key = ['gameId', 'timestamp', 'batterName', 'batterNumber', 'atBatNumber', 'pitchNumber', 'pitchType', 'pitchLocation', 'outcome']
    .map(k => toText(r[k])).join('|');
  return 'sheet-' + createHash('sha1').update(key).digest('hex').slice(0, 20);
}

function pitchValues(r: Record<string, unknown>): unknown[] {
  return PITCH_FIELDS.map(([key, , kind]) => {
    const v = key === 'id' ? (toText(r.id).trim() || legacyPitchId(r)) : r[key];
    if (kind === 'int') return toInt(v);
    if (kind === 'float') return toFloat(v);
    if (kind === 'ts') return toTs(v);
    return toText(v);
  });
}

/** A Postgres pitch row, in the exact shape the Apps Script returns. */
export function pitchRowToSheet(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, col, kind] of PITCH_FIELDS) {
    const v = row[col];
    if (kind === 'ts') out[key] = formatTs(v);
    else if (kind === 'int' || kind === 'float') out[key] = v === null || v === undefined ? '' : Number(v);
    else out[key] = toText(v);
  }
  out.isEdit = false;
  const ordered: Record<string, unknown> = {};
  for (const k of SHEET_PITCH_KEYS) ordered[k] = out[k] ?? '';
  return ordered;
}

const PITCH_COLS = PITCH_FIELDS.map(f => f[1]);

/**
 * Inserts new pitch rows and applies edit rows, mirroring the Apps Script
 * doPost(). New rows are idempotent by id (a retried sync is a no-op);
 * `refresh` (used by the Sheet import) overwrites existing rows instead.
 * Edits only change the five fields the Sheet edits, and only within the
 * editor's scope.
 */
export async function writePitches(
  db: Db,
  rows: Record<string, unknown>[],
  opts: { source?: 'app' | 'sheet_import'; refresh?: boolean } = {},
): Promise<{ newRows: number; edits: number }> {
  // One row per pitch id (the last one wins): a retried sync can leave the
  // same pitch on two Sheet rows, and Postgres refuses to upsert one id twice
  // in a single statement.
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows.filter(r => !isEditRow(r))) byId.set(toText(r.id).trim() || legacyPitchId(r), r);
  const fresh = [...byId.values()];
  const edits = rows.filter(r => isEditRow(r));
  const source = opts.source ?? 'app';

  const BATCH = 200;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const chunk = fresh.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = chunk.map(r => {
      const vals = [...pitchValues(r), source];
      const start = params.length;
      params.push(...vals);
      return '(' + vals.map((_, j) => `$${start + j + 1}`).join(',') + ')';
    });
    const cols = [...PITCH_COLS, 'source'];
    // A refresh (Sheet import) never blanks an identity field Postgres
    // already holds: an older Sheet layout can be missing those columns.
    const KEEP = new Set(['org_id', 'user_id', 'player_id', 'roster_player_id']);
    const conflict = opts.refresh
      ? `DO UPDATE SET ${PITCH_COLS.filter(c => c !== 'id').map(c => KEEP.has(c)
          ? `${c} = COALESCE(NULLIF(EXCLUDED.${c}, ''), pitches.${c})`
          : `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`
      : 'DO NOTHING';
    await db.query(`INSERT INTO pitches (${cols.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT (id) ${conflict}`, params);
  }

  for (const e of edits) {
    await db.query(
      `UPDATE pitches SET pitch_type = $3, pitch_zone = $4, pitch_location = $5, action = $6, outcome = $7, updated_at = now()
       WHERE id = $8 AND ${PITCH_SCOPE}`,
      [toText(e.organizationId), toText(e.userId), toText(e.pitchType), toText(e.pitchZone), toText(e.pitchLocation), toText(e.action), toText(e.outcome), toText(e.id)],
    );
  }
  return { newRows: fresh.length, edits: edits.length };
}

// ── Reads (Apps Script doGet actions) ─────────────────────────────────────────

const PITCH_ORDER = `COALESCE(ts, created_at), created_at, id`;

function normalizeName(s: unknown): string {
  return toText(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

function sortByAtBatThenPitch(list: Record<string, unknown>[]) {
  return list.sort((a, b) => {
    const abA = Number(a.atBatNumber) || 0, abB = Number(b.atBatNumber) || 0;
    if (abA !== abB) return abA - abB;
    return (Number(a.pitchNumber) || 0) - (Number(b.pitchNumber) || 0);
  });
}

/** action=history */
export async function getBatterHistory(
  db: Db, scope: Scope, q: { batterName: string; batterNum: string; playerId: string },
) {
  const p = [scope.organizationId, scope.userId];
  const [{ n: sheetRows }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pitches WHERE ${PITCH_SCOPE}`, p);

  if (q.playerId) {
    const rows = await db.query(
      `SELECT * FROM pitches WHERE ${PITCH_SCOPE} AND (roster_player_id = $3 OR player_id = $3) ORDER BY ${PITCH_ORDER}`,
      [...p, q.playerId],
    );
    const pitches = sortByAtBatThenPitch(rows.map(pitchRowToSheet));
    return { pitches, count: pitches.length, sheetRows };
  }

  const nameLower = normalizeName(q.batterName);
  if (!nameLower) return { pitches: [], count: 0, sheetRows };
  const rows = await db.query(
    `SELECT * FROM pitches
     WHERE ${PITCH_SCOPE} AND lower(regexp_replace(btrim(batter_name), '\\s+', ' ', 'g')) = $3
     ORDER BY ${PITCH_ORDER}`,
    [...p, nameLower],
  );
  // Same disambiguation as the Sheet: the jersey number only narrows the
  // result when this name has been recorded with more than one number.
  const nums = new Set(rows.map(r => toText(r.batter_number).trim()).filter(Boolean));
  const ambiguous = !!q.batterNum && nums.size > 1;
  let matched = rows.filter(r => !ambiguous || toText(r.batter_number).trim() === q.batterNum);
  if (matched.length === 0 && rows.length > 0) matched = rows;
  const pitches = sortByAtBatThenPitch(matched.map(pitchRowToSheet));
  return { pitches, count: pitches.length, sheetRows };
}

/** action=scout */
export async function getGameScout(db: Db, scope: Scope, gameId: string) {
  const p = [scope.organizationId, scope.userId];
  let target = gameId;
  if (!target) {
    const latest = await db.query<{ game_id: string }>(
      `SELECT game_id FROM pitches WHERE ${PITCH_SCOPE} AND game_id <> ''
       ORDER BY COALESCE(ts, created_at) DESC, created_at DESC LIMIT 1`, p,
    );
    target = latest[0]?.game_id ?? '';
  }
  if (!target) return { pitches: [], count: 0, gameId: '' };
  const rows = await db.query(
    `SELECT * FROM pitches WHERE ${PITCH_SCOPE} AND game_id = $3 ORDER BY ${PITCH_ORDER}`, [...p, target],
  );
  const pitches = rows.map(pitchRowToSheet);
  return { pitches, count: pitches.length, gameId: target };
}

/** action=games */
export async function getGamesList(db: Db, scope: Scope) {
  const rows = await db.query<{
    game_id: string; home_team: string | null; visiting_team: string | null;
    first_ts: unknown; last_ts: unknown; pitch_count: number;
  }>(
    `SELECT game_id,
            -- the most recently recorded non-blank name (names can be filled in mid-game)
            (array_agg(home_team ORDER BY COALESCE(ts, created_at) DESC, created_at DESC) FILTER (WHERE home_team <> ''))[1] AS home_team,
            (array_agg(visiting_team ORDER BY COALESCE(ts, created_at) DESC, created_at DESC) FILTER (WHERE visiting_team <> ''))[1] AS visiting_team,
            min(ts) AS first_ts, max(ts) AS last_ts, count(*)::int AS pitch_count
     FROM pitches WHERE ${PITCH_SCOPE} AND game_id <> ''
     GROUP BY game_id
     ORDER BY max(ts) DESC NULLS LAST`,
    [scope.organizationId, scope.userId],
  );
  const games = rows.map(r => ({
    gameId: r.game_id,
    homeTeam: r.home_team ?? '',
    visitingTeam: r.visiting_team ?? '',
    firstTimestamp: formatTs(r.first_ts),
    lastTimestamp: formatTs(r.last_ts),
    pitchCount: Number(r.pitch_count),
  }));
  return { games, count: games.length };
}

/** action=roster */
export async function getRoster(db: Db, scope: Scope, teamName: string) {
  const rows = await db.query<{ player_id: string; name: string; number: string; hand: string }>(
    `SELECT player_id, name, number, hand FROM rosters
     WHERE ${ROSTER_SCOPE} AND lower(btrim(team_name)) = lower(btrim($3)) ORDER BY seq`,
    [scope.organizationId, scope.userId, teamName],
  );
  const players = rows.map(r => ({ id: r.player_id, name: r.name, number: r.number, hand: r.hand || null }));
  return { players, count: players.length };
}

interface PlayerRow {
  id: string; name: string; number: string; hand: string; notes: string;
  verified: boolean; is_active: boolean; first_seen: unknown; last_seen: unknown;
  games_seen: number | null; pitches_seen: number | null; last_pitch: unknown;
}

const PLAYER_SELECT = `
  SELECT p.*, s.games_seen, s.pitches_seen, s.last_pitch
  FROM players p
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT game_id)::int AS games_seen, count(*)::int AS pitches_seen, max(ts) AS last_pitch
    FROM pitches WHERE player_id = p.id
  ) s ON true`;

function playerRecord(r: PlayerRow) {
  const stored = r.last_seen ? new Date(String(r.last_seen instanceof Date ? r.last_seen.toISOString() : r.last_seen)) : null;
  const pitched = r.last_pitch ? new Date(String(r.last_pitch instanceof Date ? r.last_pitch.toISOString() : r.last_pitch)) : null;
  const last = stored && pitched ? (stored > pitched ? stored : pitched) : (stored ?? pitched);
  return {
    id: r.id,
    name: r.name,
    number: r.number,
    hand: r.hand || null,
    firstSeen: r.first_seen ? new Date(String(r.first_seen instanceof Date ? r.first_seen.toISOString() : r.first_seen)).toISOString() : '',
    lastSeen: last ? last.toISOString() : '',
    gamesSeen: Number(r.games_seen) || 0,
    pitchesSeen: Number(r.pitches_seen) || 0,
    notes: r.notes,
    verified: !!r.verified,
    isActive: !!r.is_active,
  };
}

/** action=players — every active player in scope, oldest first. */
export async function getPlayersList(db: Db, scope: Scope) {
  const rows = await db.query<PlayerRow>(
    `${PLAYER_SELECT} WHERE (p.org_id = $1 OR (p.org_id = '' AND p.created_by = $2)) AND p.is_active
     ORDER BY p.created_at, p.id`,
    [scope.organizationId, scope.userId],
  );
  const players = rows.map(playerRecord);
  return { players, count: players.length };
}

/** action=unlinkedBatters */
export async function getUnlinkedBatters(db: Db, scope: Scope) {
  const rows = await db.query<{ name: string; number: string; pitch_count: number; game_count: number }>(
    `SELECT (array_agg(btrim(batter_name) ORDER BY ${PITCH_ORDER}))[1] AS name,
            btrim(batter_number) AS number,
            count(*)::int AS pitch_count,
            count(DISTINCT NULLIF(game_id, ''))::int AS game_count,
            min(COALESCE(ts, created_at)) AS first_at
     FROM pitches
     WHERE ${PITCH_SCOPE} AND player_id = '' AND btrim(batter_name) <> ''
     GROUP BY lower(btrim(batter_name)), btrim(batter_number)
     ORDER BY count(*) DESC, min(COALESCE(ts, created_at))`,
    [scope.organizationId, scope.userId],
  );
  const batters = rows.map(r => ({ name: r.name, number: r.number, pitchCount: Number(r.pitch_count), gameCount: Number(r.game_count) }));
  return { batters, count: batters.length };
}

// ── Writes (Apps Script doPost kinds) ─────────────────────────────────────────

/** Rosters upsert by (scope, playerId), like saveRosterPlayers(). */
export async function saveRoster(db: Db, items: Record<string, unknown>[]) {
  let saved = 0;
  for (const it of items) {
    const org = toText(it.organizationId).trim();
    const user = toText(it.userId).trim();
    const pid = toText(it.playerId).trim();
    if ((!org && !user) || !pid) continue;
    await db.query(
      `INSERT INTO rosters (org_id, user_id, team_name, player_id, name, number, hand, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
       ON CONFLICT (scope_key, player_id) DO UPDATE SET
         user_id = EXCLUDED.user_id, team_name = EXCLUDED.team_name, name = EXCLUDED.name,
         number = EXCLUDED.number, hand = EXCLUDED.hand, updated_at = EXCLUDED.updated_at`,
      [org, user, toText(it.teamName), pid, toText(it.name), toText(it.number), toText(it.hand), toTs(it.updatedAt)],
    );
    saved++;
  }
  return { saved };
}

/** Keeps player_id_seq past every PLR id already stored. */
export async function syncPlayerIdSequence(db: Db) {
  await db.query(
    `SELECT setval('player_id_seq', m, true) FROM (
       SELECT GREATEST(
         (SELECT COALESCE(max(substring(id from 4)::bigint), 0) FROM players WHERE id ~ '^PLR[0-9]+$'),
         (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM player_id_seq)) AS m
     ) x WHERE m > 0`,
  );
}

/**
 * Creates a player (createPlayerRecord). With `id` (copying a player the
 * Sheet already created) the same id is kept; otherwise the next PLR id.
 */
export async function createPlayer(
  db: Db,
  item: { organizationId: string; userId: string; name: string; number?: string; hand?: string; id?: string; firstSeen?: string },
) {
  const name = item.name.trim();
  const org = item.organizationId.trim() || item.userId.trim();
  if (!org || !name) throw new Error('createPlayer requires organizationId (or userId) and name');
  let id = (item.id ?? '').trim();
  if (!id) {
    await syncPlayerIdSequence(db);
    const [{ n }] = await db.query<{ n: string }>(`SELECT nextval('player_id_seq')::text AS n`);
    id = 'PLR' + n.padStart(4, '0');
  }
  const seen = toTs(item.firstSeen) ?? new Date().toISOString();
  await db.query(
    `INSERT INTO players (id, org_id, created_by, name, number, hand, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (id) DO NOTHING`,
    [id, org, item.userId.trim(), name, toText(item.number), toText(item.hand), seen],
  );
  if (item.id) await syncPlayerIdSequence(db);
  const [row] = await db.query<PlayerRow>(`${PLAYER_SELECT} WHERE p.id = $1`, [id]);
  return playerRecord(row);
}

/** Attaches unlinked history rows to a player (attachHistoricalRecords). */
export async function attachHistory(
  db: Db, scope: Scope, item: { playerId: string; batterName: string; batterNumber?: string },
) {
  const rows = await db.query<{ id: string }>(
    `UPDATE pitches SET player_id = $3, updated_at = now()
     WHERE ${PITCH_SCOPE} AND player_id = '' AND lower(btrim(batter_name)) = lower(btrim($4))
       AND ($5 = '' OR btrim(batter_number) = $5)
     RETURNING id`,
    [scope.organizationId, scope.userId, item.playerId.trim(), item.batterName, toText(item.batterNumber).trim()],
  );
  return { attached: rows.length };
}

/** Merges a duplicate player into a primary one (mergePlayers). */
export async function mergePlayers(db: Db, scope: Scope, sourcePlayerId: string, targetPlayerId: string) {
  const src = sourcePlayerId.trim(), tgt = targetPlayerId.trim();
  if (!src || !tgt) throw new Error('mergePlayers requires sourcePlayerId and targetPlayerId');
  if (src === tgt) throw new Error('sourcePlayerId and targetPlayerId must be different');
  const both = await db.query<{ id: string; org_id: string }>(`SELECT id, org_id FROM players WHERE id IN ($1, $2)`, [src, tgt]);
  if (both.length < 2) throw new Error('Could not find both players — check the ids');
  if (both.some(p => p.org_id !== scope.organizationId)) {
    throw new Error('Both players must belong to the requesting organization');
  }
  const moved = await db.query<{ id: string }>(
    `UPDATE pitches SET player_id = $2, updated_at = now() WHERE player_id = $1 RETURNING id`, [src, tgt],
  );
  // A roster that already lists the target keeps that row; the duplicate goes.
  await db.query(
    `DELETE FROM rosters r WHERE r.player_id = $1
       AND EXISTS (SELECT 1 FROM rosters t WHERE t.scope_key = r.scope_key AND t.player_id = $2)`, [src, tgt],
  );
  const rosters = await db.query<{ seq: string }>(
    `UPDATE rosters SET player_id = $2, updated_at = now() WHERE player_id = $1 RETURNING seq`, [src, tgt],
  );
  await db.query(`UPDATE players SET is_active = false, merged_into = $2, updated_at = now() WHERE id = $1`, [src, tgt]);
  const [t] = await db.query<PlayerRow>(`${PLAYER_SELECT} WHERE p.id = $1`, [tgt]);
  const target = playerRecord(t);
  return {
    merged: true,
    sourcePlayerId: src,
    targetPlayerId: tgt,
    pitchesReassigned: moved.length,
    rostersReassigned: rosters.length,
    target: { id: tgt, gamesSeen: target.gamesSeen, pitchesSeen: target.pitchesSeen, lastSeen: target.lastSeen },
  };
}

/** Edits a player's profile fields (updatePlayerProfile). */
export async function updatePlayer(
  db: Db, scope: Scope, playerId: string,
  patch: { name?: unknown; number?: unknown; hand?: unknown; notes?: unknown; verified?: unknown; isActive?: unknown },
) {
  const sets: string[] = [];
  const params: unknown[] = [playerId.trim(), scope.organizationId];
  const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (patch.name !== undefined) add('name', toText(patch.name));
  if (patch.number !== undefined) add('number', toText(patch.number));
  if (patch.hand !== undefined) add('hand', toText(patch.hand));
  if (patch.notes !== undefined) add('notes', toText(patch.notes));
  if (patch.verified !== undefined) add('verified', !!patch.verified);
  if (patch.isActive !== undefined) add('is_active', !!patch.isActive);
  const found = await db.query<{ id: string }>(
    `UPDATE players SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING id`, params,
  );
  if (found.length === 0) throw new Error('Player not found in this organization');
  const [row] = await db.query<PlayerRow>(`${PLAYER_SELECT} WHERE p.id = $1`, [playerId.trim()]);
  return playerRecord(row);
}

// ── Sheet import ──────────────────────────────────────────────────────────────

export interface SheetExport {
  pitches?: Record<string, unknown>[];
  players?: Record<string, unknown>[];
  rosters?: Record<string, unknown>[];
}

/**
 * Upserts one page of the Sheet export. Safe to run again at any time:
 * pitches are keyed by id, players by PLR id, rosters by (scope, player).
 */
export async function importSheetPage(db: Db, page: SheetExport) {
  const pitches = (page.pitches ?? []).filter(r => !isEditRow(r) && toText(r.gameId).trim());
  await writePitches(db, pitches, { source: 'sheet_import', refresh: true });

  let players = 0;
  for (const p of page.players ?? []) {
    const id = toText(p.playerId).trim();
    if (!id) continue;
    await db.query(
      `INSERT INTO players (id, org_id, created_by, name, number, hand, first_seen, last_seen, notes, verified, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, created_by = EXCLUDED.created_by, name = EXCLUDED.name,
         number = EXCLUDED.number, hand = EXCLUDED.hand, first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
         notes = EXCLUDED.notes, verified = EXCLUDED.verified, is_active = EXCLUDED.is_active, updated_at = now()`,
      [
        id, toText(p.organizationId).trim(), toText(p.createdByUserId).trim(), toText(p.playerName).trim() || id,
        toText(p.jerseyNumber), toText(p.handedness), toTs(p.firstSeen), toTs(p.lastSeen), toText(p.notes),
        !(p.verified === false || toText(p.verified).toUpperCase() === 'FALSE'),
        !(p.isActive === false || toText(p.isActive).toUpperCase() === 'FALSE'),
      ],
    );
    players++;
  }
  if (players) await syncPlayerIdSequence(db);

  const { saved: rosters } = await saveRoster(db, page.rosters ?? []);
  return { pitches: pitches.length, players, rosters };
}

/** Row counts per scope, for checking the import against the Sheet. */
export async function countsByScope(db: Db) {
  const rows = await db.query<{ scope: string; pitches: number; games: number }>(
    `SELECT CASE WHEN org_id <> '' THEN org_id ELSE 'user:' || user_id END AS scope,
            count(*)::int AS pitches, count(DISTINCT game_id)::int AS games
     FROM pitches GROUP BY 1 ORDER BY 1`,
  );
  const [totals] = await db.query<{ pitches: number; players: number; rosters: number }>(
    `SELECT (SELECT count(*) FROM pitches)::int AS pitches, (SELECT count(*) FROM players)::int AS players,
            (SELECT count(*) FROM rosters)::int AS rosters`,
  );
  return { totals, byScope: rows };
}
