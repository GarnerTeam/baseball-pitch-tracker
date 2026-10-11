// Server-only: saved games (see db/migrations/002_games.sql).
import type { Db } from './client';
import type { Scope } from './store';

export type GameStatus = 'active' | 'final';

export interface SavedGameSummary {
  gameId: string;
  homeTeam: string;
  visitingTeam: string;
  status: GameStatus;
  pitchCount: number;
  updatedAt: string;
  endedAt: string;
  weAreHome: boolean | null;
}

interface GameRow {
  game_id: string; home_team: string; visiting_team: string; status: string;
  pitch_count: number; updated_at: unknown; ended_at: unknown; snapshot?: unknown; we_are_home?: string | null;
}

function iso(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function summary(r: GameRow): SavedGameSummary {
  return {
    gameId: r.game_id,
    homeTeam: r.home_team,
    visitingTeam: r.visiting_team,
    status: r.status === 'final' ? 'final' : 'active',
    pitchCount: Number(r.pitch_count) || 0,
    updatedAt: iso(r.updated_at),
    endedAt: iso(r.ended_at),
    weAreHome: r.we_are_home === 'true' ? true : r.we_are_home === 'false' ? false : null,
  };
}

/** Pitches the game snapshot holds (finished at-bats + the one in progress). */
export function snapshotPitchCount(snapshot: Record<string, unknown>): number {
  const abs = Array.isArray(snapshot.allAtBats) ? snapshot.allAtBats : [];
  let n = 0;
  for (const ab of abs) n += Array.isArray((ab as { pitches?: unknown[] })?.pitches) ? (ab as { pitches: unknown[] }).pitches.length : 0;
  const cur = snapshot.currentAtBat as { pitches?: unknown[] } | null | undefined;
  if (cur && Array.isArray(cur.pitches)) n += cur.pitches.length;
  return n;
}

/**
 * Saves the live game. An autosave ('active') never reopens a game that was
 * already ended — that only happens with `reopen` (the coach tapped Resume
 * on an ended game). Returns the status the game has afterwards; `stale`
 * means the save was ignored because the game had been ended.
 */
export async function saveGame(
  db: Db, scope: Scope,
  g: { gameId: string; snapshot: Record<string, unknown>; status: GameStatus; reopen?: boolean },
): Promise<{ status: GameStatus; stale: boolean }> {
  const s = g.snapshot;
  const rows = await db.query<{ status: string }>(
    `INSERT INTO games (org_id, game_id, user_id, home_team, visiting_team, status, pitch_count, snapshot, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, CASE WHEN $6 = 'final' THEN now() END)
     ON CONFLICT (org_id, game_id) DO UPDATE SET
       user_id = EXCLUDED.user_id, home_team = EXCLUDED.home_team, visiting_team = EXCLUDED.visiting_team,
       status = EXCLUDED.status, pitch_count = EXCLUDED.pitch_count, snapshot = EXCLUDED.snapshot,
       updated_at = now(),
       ended_at = CASE WHEN EXCLUDED.status = 'final' THEN COALESCE(games.ended_at, now()) ELSE NULL END
     WHERE NOT (games.status = 'final' AND EXCLUDED.status = 'active' AND NOT $9::boolean)
     RETURNING status`,
    [
      scope.organizationId, g.gameId, scope.userId,
      String(s.homeTeam ?? ''), String(s.visitingTeam ?? ''),
      g.status, snapshotPitchCount(s), JSON.stringify(s), !!g.reopen,
    ],
  );
  if (rows.length) return { status: rows[0].status as GameStatus, stale: false };
  return { status: 'final', stale: true };
}

/** Marks a game ended without changing its snapshot (e.g. dismissed from the resume list). */
export async function endGame(db: Db, scope: Scope, gameId: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE games SET status = 'final', ended_at = COALESCE(ended_at, now()), updated_at = now()
     WHERE org_id = $1 AND game_id = $2 RETURNING game_id`,
    [scope.organizationId, gameId],
  );
  return rows.length > 0;
}

/** Games still in progress, most recently touched first. */
export async function listActiveGames(db: Db, scope: Scope): Promise<SavedGameSummary[]> {
  const rows = await db.query<GameRow>(
    `SELECT game_id, home_team, visiting_team, status, pitch_count, updated_at, ended_at, snapshot->>'weAreHome' AS we_are_home
     FROM games WHERE org_id = $1 AND status = 'active'
     ORDER BY updated_at DESC LIMIT 20`,
    [scope.organizationId],
  );
  return rows.map(summary);
}

/** One saved game with its snapshot, or null. */
export async function getSavedGame(db: Db, scope: Scope, gameId: string) {
  const [r] = await db.query<GameRow>(
    `SELECT game_id, home_team, visiting_team, status, pitch_count, updated_at, ended_at, snapshot, snapshot->>'weAreHome' AS we_are_home
     FROM games WHERE org_id = $1 AND game_id = $2`,
    [scope.organizationId, gameId],
  );
  if (!r) return null;
  const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
  return { ...summary(r), snapshot: (snap ?? null) as Record<string, unknown> | null };
}

/** Pitches stored for a game in this scope — what "saved" actually means. */
export async function storedPitchCount(db: Db, scope: Scope, gameId: string): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pitches
     WHERE (org_id = $1 OR (org_id = '' AND user_id = $2)) AND game_id = $3`,
    [scope.organizationId, scope.userId, gameId],
  );
  return Number(r?.n) || 0;
}
