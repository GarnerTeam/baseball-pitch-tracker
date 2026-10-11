'use client';
/**
 * Saved games on the client: the autosaved snapshot that powers Resume Game
 * and End Game (server side: app/api/games, lib/db/games.ts), plus rebuilding
 * a live game from its pitches for games recorded before snapshots existed.
 */
import { AtBat, BaseState, GameState, PitchRecord, Player } from '@/types';
import { DEFAULT_WEBHOOK_URL } from './sheets';
import { SheetRow, sheetRowToPitchRecord, reconstructGame, buildFakeGameState } from './game-reconstruct';

export type SavedGameStatus = 'active' | 'final';

export interface SavedGameSummary {
  gameId: string;
  homeTeam: string;
  visitingTeam: string;
  status: SavedGameStatus;
  pitchCount: number;
  updatedAt: string;
  endedAt: string;
  weAreHome?: boolean | null;
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * The part of the live game worth saving: everything except what's only
 * about this screen right now (a toast, the half-entered pitch). Unsynced
 * pitches are kept, so a resumed game finishes uploading them.
 */
export function snapshotOf(state: GameState): GameState {
  return {
    ...state,
    notification: null,
    pendingPitch: { pitchType: state.pendingPitch.pitchType, location: null, swing: null, contact: null },
    phase: state.phase === 'hit-mode' ? 'pitching' : state.phase,
  };
}

export function pitchCountOf(state: GameState): number {
  return state.allAtBats.reduce((n, ab) => n + ab.pitches.length, 0) + (state.currentAtBat?.pitches.length ?? 0);
}

export function atBatCountOf(state: GameState): number {
  return state.allAtBats.filter(ab => ab.pitches.length > 0).length
    + (state.currentAtBat && state.currentAtBat.pitches.length > 0 ? 1 : 0);
}

/**
 * Fills in defaults for fields added in later releases. Used for the copy
 * kept on this device and for snapshots loaded from the cloud.
 */
export function normalizeGameState(parsed: GameState): GameState {
  return {
    ...parsed,
    // Always sync through the app's server.
    sheetsWebhookUrl: DEFAULT_WEBHOOK_URL,
    homeTeam:                   parsed.homeTeam                   ?? '',
    visitingTeam:               parsed.visitingTeam               ?? '',
    lineup:                     parsed.lineup                     ?? [],
    allAtBats:                  parsed.allAtBats                  ?? [],
    currentAtBat:               parsed.currentAtBat               ?? null,
    pendingPitch:               parsed.pendingPitch               ?? { pitchType: null, location: null, swing: null, contact: null },
    baseState:                  parsed.baseState                  ?? { first: false, second: false, third: false },
    outsCount:                  parsed.outsCount                  ?? 0,
    batterHand:                 parsed.batterHand                 ?? null,
    overlayEnabled:             parsed.overlayEnabled             ?? true,
    overlayFilter:              parsed.overlayFilter              ?? 'all',
    syncQueue:                  parsed.syncQueue                  ?? [],
    pitcherHistory:             parsed.pitcherHistory             ?? [],
    lastCompletedAtBatSnapshot: parsed.lastCompletedAtBatSnapshot ?? undefined,
    notification:               parsed.notification               ?? null,
  };
}

// ── API calls ────────────────────────────────────────────────────────────────

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function saveGameSnapshot(
  state: GameState, status: SavedGameStatus, opts: { reopen?: boolean; keepalive?: boolean } = {},
): Promise<{ status: SavedGameStatus; stale: boolean; storedPitches: number }> {
  const body = JSON.stringify({ gameId: state.id, snapshot: snapshotOf(state), status, reopen: !!opts.reopen });
  const res = await fetch('/api/games', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    // keepalive lets a save finish while the page is closing (bodies ≤ 64 KB only)
    keepalive: !!opts.keepalive && body.length < 60_000,
  });
  return json(res);
}

export async function fetchActiveGames(): Promise<SavedGameSummary[]> {
  return (await json<{ games: SavedGameSummary[] }>(await fetch('/api/games'))).games ?? [];
}

export async function markGameEnded(gameId: string): Promise<void> {
  await json(await fetch('/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'end', gameId }),
  }));
}

async function fetchGameRows(gameId: string): Promise<SheetRow[]> {
  const res = await fetch(`/api/sheets/scout?${new URLSearchParams({ url: DEFAULT_WEBHOOK_URL, gameId })}`);
  return (await json<{ pitches?: SheetRow[] }>(res)).pitches ?? [];
}

/** A finished game for the read-only Past Games view. */
export async function loadReadOnlyGame(gameId: string): Promise<GameState | null> {
  const rows = await fetchGameRows(gameId);
  if (rows.length === 0) return null;
  return buildFakeGameState(reconstructGame(rows), DEFAULT_WEBHOOK_URL);
}

export interface ResumableGame {
  state: GameState;
  status: SavedGameStatus | '';
  /** True when rebuilt from pitches (no saved snapshot) — outs/runners are a best guess. */
  rebuilt: boolean;
}

/** Loads a game to keep tracking: its saved snapshot, or a rebuild from its pitches. */
export async function loadResumableGame(gameId: string): Promise<ResumableGame> {
  const { game } = await json<{ game: (SavedGameSummary & { snapshot: GameState | null }) | null }>(
    await fetch(`/api/games?${new URLSearchParams({ gameId })}`),
  );
  if (game?.snapshot) {
    return { state: normalizeGameState(game.snapshot), status: game.status, rebuilt: false };
  }
  const rows = await fetchGameRows(gameId);
  if (rows.length === 0) throw new Error('No saved data found for this game.');
  return { state: liveStateFromRows(rows), status: game?.status ?? '', rebuilt: true };
}

// ── Rebuild a live game from its pitch rows ──────────────────────────────────

const ENDS_AT_BAT: Record<string, AtBat['result']> = {
  strikeout: 'strikeout', walk: 'walk', 'in-play': 'in-play', 'hit-by-pitch': 'hit-by-pitch',
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function yes(v: unknown): boolean {
  return str(v).toLowerCase() === 'yes';
}

function handOf(v: unknown): 'L' | 'R' | null {
  const h = str(v).toUpperCase();
  return h === 'L' || h === 'R' ? h : null;
}

/**
 * Turns a game's stored pitches (oldest first, as /api/sheets/scout returns
 * them) back into a live game positioned where it left off: same lineup
 * order and player links, the pitcher on the mound, the at-bat in progress
 * with its count, and the outs/runners as of the last pitch. Pitch ids are
 * kept, so editing a pitch after resuming updates the stored row.
 */
export function liveStateFromRows(rows: SheetRow[]): GameState {
  if (rows.length === 0) throw new Error('No pitches to rebuild from');
  const gameId = str(rows[0].gameId);
  const last = rows[rows.length - 1];

  // Lineup: the most recent batter in each batting-order spot (subs replace starters).
  const idFor = (r: SheetRow) =>
    str(r.playerId) || str(r.rosterPlayerId) || `resumed-${str(r.batterNumber)}-${str(r.batterName).toLowerCase().replace(/\s+/g, '-')}`;
  const bySpot = new Map<number, Player>();
  let maxSpot = 0;
  for (const r of rows) {
    const spot = Math.min(16, Math.max(1, Number(r.lineupPosition) || 1));
    maxSpot = Math.max(maxSpot, spot);
    bySpot.set(spot, { id: idFor(r), name: str(r.batterName), number: str(r.batterNumber), hand: handOf(r.batterHand) });
  }
  const lineup: Player[] = [];
  for (let s = 1; s <= maxSpot; s++) {
    lineup.push(bySpot.get(s) ?? { id: `empty-${s - 1}-${gameId}`, name: '', number: '' });
  }

  // At-bats, in the order they happened.
  const groups: { key: string; rows: SheetRow[] }[] = [];
  for (const r of rows) {
    const key = `${Number(r.lineupPosition) || 1}|${Number(r.atBatNumber) || 0}|${str(r.batterName).toLowerCase()}|${str(r.batterNumber)}`;
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.rows.push(r);
    else groups.push({ key, rows: [r] });
  }

  const toPitch = (r: SheetRow, i: number): PitchRecord => {
    const base = sheetRowToPitchRecord(r, Number(r.pitchNumber) || i + 1);
    const bs: BaseState = { first: yes(r.runner1B), second: yes(r.runner2B), third: yes(r.runner3B) };
    return {
      ...base,
      id: str(r.id) || base.id,
      gameId,
      lineupPosition: Math.max(0, (Number(r.lineupPosition) || 1) - 1),
      baseState: bs,
      playerId: str(r.playerId) || undefined,
      rosterPlayerId: str(r.rosterPlayerId) || undefined,
    };
  };

  const atBats: AtBat[] = groups.map((g, gi) => {
    const pitches = g.rows.map(toPitch);
    const lastPitch = pitches[pitches.length - 1];
    const result = ENDS_AT_BAT[lastPitch.outcome];
    const first = g.rows[0];
    return {
      id: `${gameId}-ab-resumed-${gi}`,
      batterIndex: Math.max(0, (Number(first.lineupPosition) || 1) - 1),
      playerId: idFor(first),
      atBatNumber: Number(first.atBatNumber) || 1,
      pitches,
      balls: lastPitch.ballsAfter,
      strikes: lastPitch.strikesAfter,
      result: result ?? 'manual-end',
      isComplete: true,
      startedAt: pitches[0].timestamp,
      completedAt: lastPitch.timestamp,
    };
  });

  // Where we left off.
  const lastAb = atBats[atBats.length - 1];
  const lastPitch = lastAb.pitches[lastAb.pitches.length - 1];
  const finished = !!ENDS_AT_BAT[lastPitch.outcome];
  let outs = Number(last.outsCount) || 0;
  let bases: BaseState = lastPitch.baseState ?? { first: false, second: false, third: false };
  let currentAtBat: AtBat;
  let currentBatterIndex: number;
  const allAtBats = finished ? atBats : atBats.slice(0, -1);

  if (finished) {
    const wasOut = lastPitch.outcome === 'strikeout' || (lastPitch.outcome === 'in-play' && lastPitch.hitData?.result === 'out');
    if (wasOut) outs += 1;
    if (lastPitch.outcome === 'walk' || lastPitch.outcome === 'hit-by-pitch') bases = { ...bases, first: true };
    if (outs >= 3) { outs = 0; bases = { first: false, second: false, third: false }; }
    currentBatterIndex = lineup.length > 1 ? (lastAb.batterIndex + 1) % lineup.length : lastAb.batterIndex;
    const done = allAtBats.filter(ab => ab.batterIndex === currentBatterIndex).length;
    currentAtBat = {
      id: `${gameId}-ab-resumed-next`,
      batterIndex: currentBatterIndex,
      playerId: lineup[currentBatterIndex]?.id,
      atBatNumber: done + 1,
      pitches: [],
      balls: 0,
      strikes: 0,
      isComplete: false,
      startedAt: new Date().toISOString(),
    };
  } else {
    currentBatterIndex = lastAb.batterIndex;
    currentAtBat = { ...lastAb, isComplete: false, result: undefined, completedAt: undefined };
  }

  // Pitchers in the order they appeared; the last one is on the mound.
  const pitchers: Player[] = [];
  for (const r of rows) {
    const name = str(r.pitcherName), number = str(r.pitcherNumber);
    if (!name && !number) continue;
    const i = pitchers.findIndex(p => p.name === name && p.number === number);
    if (i >= 0) pitchers.splice(i, 1);
    pitchers.push({ id: `pitcher-${number}-${name}`, name, number });
  }
  const pitcher = pitchers.pop() ?? { id: 'pitcher-none', name: '', number: '' };

  const latest = (k: 'homeTeam' | 'visitingTeam') => {
    for (let i = rows.length - 1; i >= 0; i--) if (str(rows[i][k])) return str(rows[i][k]);
    return '';
  };

  return normalizeGameState({
    id: gameId,
    phase: 'pitching',
    homeTeam: latest('homeTeam'),
    visitingTeam: latest('visitingTeam'),
    pitcher,
    pitcherHistory: pitchers,
    lineup,
    currentBatterIndex,
    currentAtBat,
    allAtBats,
    pendingPitch: { pitchType: lastPitch.pitchType ?? null, location: null, swing: null, contact: null },
    overlayEnabled: true,
    overlayFilter: 'all',
    activeTab: 'pitch',
    batterHand: lineup[currentBatterIndex]?.hand ?? null,
    notification: null,
    baseState: bases,
    outsCount: Math.min(2, outs) as 0 | 1 | 2,
    sheetsWebhookUrl: DEFAULT_WEBHOOK_URL,
    syncQueue: [],
  });
}
