/**
 * Shared game-state reconstruction logic — converts flat Google Sheets pitch
 * rows back into a full GameState (Player/AtBat/PitchRecord tree) so any
 * screen (Scout view, Past Games browser) can render real game data through
 * the same components used for live games (LineupPanel, AnalyticsScreen, GameLog).
 *
 * Originally built for the Scout page; extracted here so Past Games reuses
 * the exact same, already-tested conversion logic instead of duplicating it.
 */
import {
  GameState, Player, AtBat, PitchRecord,
  PitchType, PitchOutcome, PitchLocation, HitData,
  BaseState, ContactType,
} from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface SheetRow {
  gameId: string; timestamp: string;
  homeTeam: string; visitingTeam: string;
  pitcherNumber: string; pitcherName: string;
  batterNumber: string; batterName: string; batterHand: string;
  lineupPosition: string | number; atBatNumber: string | number; pitchNumber: string | number;
  pitchType: string; pitchZone: string; pitchLocation: string;
  action: string; outcome: string;
  hitType: string; hitResult: string; hitZone: string;
  hitX: string | number; hitY: string | number;
  outsCount: string | number; baseState: string;
  ballsBefore: string | number; strikesBefore: string | number;
  ballsAfter: string | number; strikesAfter: string | number;
  [key: string]: unknown;
}

export interface ScoutPitcher { name: string; number: string; }

export interface ScoutAtBat {
  atBatNumber: number;
  pitches: SheetRow[];
  finalOutcome: string;
  hitResult: string;
}

export interface ScoutBatter {
  name: string; number: string; hand: string;
  lineupPos: number;
  atBats: ScoutAtBat[];
}

export interface ScoutGame {
  gameId: string; homeTeam: string; visitingTeam: string;
  pitchers: ScoutPitcher[];
  batters: ScoutBatter[];
  allRows: SheetRow[];
}

// ── Reconstruction ─────────────────────────────────────────────────────────────────────
export function reconstructGame(rows: SheetRow[]): ScoutGame {
  if (!rows.length) return { gameId: '', homeTeam: '', visitingTeam: '', pitchers: [], batters: [], allRows: [] };
  const first = rows[0];

  const pitcherSeen = new Set<string>();
  const pitchers: ScoutPitcher[] = [];
  for (const row of rows) {
    const key = `${row.pitcherNumber}|${row.pitcherName}`;
    if (row.pitcherName && !pitcherSeen.has(key)) {
      pitcherSeen.add(key);
      pitchers.push({ name: String(row.pitcherName), number: String(row.pitcherNumber ?? '') });
    }
  }

  const batterMap = new Map<string, ScoutBatter>();
  const batterOrder: string[] = [];
  for (const row of rows) {
    const key = `${row.batterNumber}|${row.batterName}`;
    if (!batterMap.has(key)) {
      batterMap.set(key, {
        name: String(row.batterName ?? ''), number: String(row.batterNumber ?? ''),
        hand: String(row.batterHand ?? ''), lineupPos: Number(row.lineupPosition) || 999,
        atBats: [],
      });
      batterOrder.push(key);
    }
    const batter = batterMap.get(key)!;
    const abNum = Number(row.atBatNumber) || 0;
    let ab = batter.atBats.find(a => a.atBatNumber === abNum);
    if (!ab) {
      ab = { atBatNumber: abNum, pitches: [], finalOutcome: '', hitResult: '' };
      batter.atBats.push(ab);
    }
    ab.pitches.push(row);
    if (row.outcome)   ab.finalOutcome = String(row.outcome);
    if (row.hitResult) ab.hitResult    = String(row.hitResult);
  }

  const batters = batterOrder
    .map(k => batterMap.get(k)!)
    .sort((a, b) => a.lineupPos - b.lineupPos);
  for (const b of batters) {
    b.atBats.sort((a, b2) => a.atBatNumber - b2.atBatNumber);
    for (const ab of b.atBats) ab.pitches.sort((a, b2) => Number(a.pitchNumber) - Number(b2.pitchNumber));
  }

  return {
    gameId: String(first.gameId ?? ''),
    homeTeam: String(first.homeTeam ?? ''),
    visitingTeam: String(first.visitingTeam ?? ''),
    pitchers, batters, allRows: rows,
  };
}

// ── SheetRow → PitchRecord conversion ──────────────────────────────────────

/**
 * Reverse-maps a pitchLocation string (e.g. "Z5", "B-Up-In") back to a PitchLocation
 * object that PitchRow / pitchLocLabel can render identically to the original.
 *
 * For strike zones (Z1–Z9) the mapping is exact.
 * For ball zones we replay the same getBallLabel() logic used at recording time
 * across all valid outer-grid cells and return the first cell whose label matches.
 * This guarantees pitchLocLabel will reproduce the original string.
 */
export function parsePitchLocation(
  pitchLocation: string,
  batterHand: 'L' | 'R' | null,
): PitchLocation | undefined {
  if (!pitchLocation) return undefined;

  // Strike zones Z1–Z9
  const zm = /^Z(\d)$/.exec(pitchLocation);
  if (zm) {
    const zn = parseInt(zm[1]);
    if (zn >= 1 && zn <= 9) {
      return { zone: 'strike', zoneNumber: zn, row: Math.floor((zn - 1) / 3), col: (zn - 1) % 3 };
    }
  }

  // Ball zones: "B-{label}"
  if (pitchLocation.startsWith('B-')) {
    const targetLabel = pitchLocation.slice(2);
    const hand = batterHand;

    // All outer-grid cells (ball zone positions on the 5×5 pitch grid)
    const outerCells: { row: number; col: number }[] = [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 },
      { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 },
      { row: 4, col: 0 }, { row: 4, col: 1 }, { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 4, col: 4 },
      { row: 1, col: 4 }, { row: 2, col: 4 }, { row: 3, col: 4 },
    ];

    for (const cell of outerCells) {
      // Replicate getBallLabel() logic from pitch-row.tsx
      const v = cell.row === 0 ? 'Up' : cell.row === 4 ? 'Low' : '';
      const getH = (c: number): string => {
        if (c === 0) return hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'Left';
        if (c === 4) return hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'Right';
        return '';
      };
      const h = getH(cell.col);
      let bl = '';
      if (v && h) {
        bl = `${v}-${h}`;
      } else if (v) {
        if (cell.col === 1) bl = `${v}-${hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'L'}`;
        else if (cell.col === 3) bl = `${v}-${hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'R'}`;
        else bl = v;
      } else if (h) {
        if (cell.row === 1) bl = `${h}-Hi`;
        else if (cell.row === 3) bl = `${h}-Lo`;
        else bl = h;
      } else {
        bl = '—';
      }

      if (bl === targetLabel) {
        return { zone: 'ball', row: cell.row, col: cell.col };
      }
    }

    // Fallback: return a generic ball-zone marker so PitchRow still renders
    return { zone: 'ball', row: 2, col: 0 };
  }

  return undefined;
}

export function sheetRowToPitchRecord(row: SheetRow, pitchIndex: number): PitchRecord {
  const hand = (row.batterHand === 'L' || row.batterHand === 'R') ? (row.batterHand as 'L' | 'R') : null;
  const location = parsePitchLocation(String(row.pitchLocation ?? ''), hand);

  const hitResult = String(row.hitResult ?? '');
  const hitData: HitData | undefined = hitResult
    ? {
        x:      row.hitX !== '' ? Number(row.hitX) : 0,
        y:      row.hitY !== '' ? Number(row.hitY) : 0,
        type:   String(row.hitType ?? '') as any,
        result: hitResult as any,
        zone:   String(row.hitZone ?? '') || undefined,
      }
    : undefined;

  const rawOutcome = String(row.outcome ?? '');
  // Normalise sheet outcome strings to PitchOutcome union values
  const outcomeMap: Record<string, PitchOutcome> = {
    'strikeout': 'strikeout',
    'called-strike': 'called-strike',
    'swinging-strike': 'swinging-strike',
    'foul': 'foul',
    'foul-tip': 'foul-tip',
    'in-play': 'in-play',
    'walk': 'walk',
    'ball': 'ball',
    'hit-by-pitch': 'hit-by-pitch',
  };
  const outcome: PitchOutcome = outcomeMap[rawOutcome] ?? 'ball';

  return {
    id:             `scout-${row.atBatNumber}-${pitchIndex}`,
    gameId:         String(row.gameId ?? ''),
    timestamp:      String(row.timestamp ?? ''),
    pitcherName:    String(row.pitcherName ?? ''),
    pitcherNumber:  String(row.pitcherNumber ?? ''),
    batterName:     String(row.batterName ?? ''),
    batterNumber:   String(row.batterNumber ?? ''),
    lineupPosition: Number(row.lineupPosition) || 0,
    atBatNumber:    Number(row.atBatNumber) || 0,
    pitchNumber:    pitchIndex,
    ballsBefore:    Number(row.ballsBefore) || 0,
    strikesBefore:  Number(row.strikesBefore) || 0,
    ballsAfter:     Number(row.ballsAfter) || 0,
    strikesAfter:   Number(row.strikesAfter) || 0,
    pitchType:      (String(row.pitchType ?? 'FB').toUpperCase() as PitchType) || 'FB',
    location:       location ?? { zone: 'ball', row: 2, col: 2 },
    swing:          String(row.action ?? '').toLowerCase() === 'swing',
    outcome,
    batterHand:     hand,
    hitData,
    outsCount:      (Number(row.outsCount) || 0) as 0 | 1 | 2,
    homeTeam:       String(row.homeTeam ?? ''),
    visitingTeam:   String(row.visitingTeam ?? ''),
  };
}

export function scoutAbResult(ab: ScoutAtBat): AtBat['result'] {
  if (ab.finalOutcome === 'strikeout') return 'strikeout';
  if (ab.finalOutcome === 'walk')      return 'walk';
  if (ab.hitResult || ab.finalOutcome === 'in-play') return 'in-play';
  return 'manual-end';
}

/**
 * Convert a reconstructed ScoutGame into a minimal GameState that
 * LineupPanel (readOnly=true) can render identically to the main app.
 */
export function buildFakeGameState(game: ScoutGame, webhookUrl: string): GameState {
  // Pitchers: sheet order is chronological; current = last
  const lastPitcher = game.pitchers[game.pitchers.length - 1];
  const pitcher: Player = lastPitcher
    ? { id: `${lastPitcher.number}|${lastPitcher.name}`, name: lastPitcher.name, number: lastPitcher.number }
    : { id: 'no-pitcher', name: '', number: '' };

  // pitcherHistory = all but last, in sheet order (oldest → newest)
  const pitcherHistory: Player[] = game.pitchers
    .slice(0, -1)
    .map(p => ({ id: `${p.number}|${p.name}`, name: p.name, number: p.number }));

  const lineup: Player[] = game.batters.map(b => ({
    id: `${b.number}|${b.name}`,
    name: b.name,
    number: b.number,
    hand: (b.hand === 'L' || b.hand === 'R') ? (b.hand as 'L' | 'R') : null,
  }));

  const allAtBats: AtBat[] = [];
  for (let bi = 0; bi < game.batters.length; bi++) {
    const batter = game.batters[bi];
    const playerId = `${batter.number}|${batter.name}`;
    for (const ab of batter.atBats) {
      const pitches = ab.pitches.map((row, i) => sheetRowToPitchRecord(row, i + 1));
      if (pitches.length === 0) continue;
      allAtBats.push({
        id:           `scout-${playerId}-ab${ab.atBatNumber}`,
        batterIndex:  bi,
        playerId,
        atBatNumber:  ab.atBatNumber,
        pitches,
        balls:        0,
        strikes:      0,
        result:       scoutAbResult(ab),
        isComplete:   true,
        startedAt:    '',
      });
    }
  }

  const emptyBase: BaseState = { first: false, second: false, third: false };

  return {
    id:                  game.gameId,
    phase:               'pitching',
    homeTeam:            game.homeTeam,
    visitingTeam:        game.visitingTeam,
    pitcher,
    pitcherHistory,
    lineup,
    currentBatterIndex:  -1,          // no active batter in scout/readOnly view
    currentAtBat:        null,
    allAtBats,
    pendingPitch:        { pitchType: null, location: null, swing: null, contact: null as unknown as ContactType },
    overlayEnabled:      false,
    overlayFilter:       'all',
    activeTab:           'lineup',
    batterHand:          null,
    notification:        null,
    baseState:           emptyBase,
    outsCount:           0,
    sheetsWebhookUrl:    webhookUrl,  // powers the "Full History" button
    syncQueue:           [],
  };
}

/**
 * Build a LIVE, continuable GameState from synced Sheet rows — used by the
 * "Resume Game" flow on the Setup screen when a coach switches device/browser
 * mid-game (e.g. iOS treats a home-screen PWA and an in-browser tab as
 * completely separate local storage, so the in-progress game recorded in one
 * never appears in the other, even for the same logged-in account).
 *
 * This is the "lighter" resume: it restores the lineup, pitcher/pitcher
 * history, and every pitch already recorded (so Analytics/Pitch Log/batter
 * history all have full insight into what happened before the switch) and
 * carries forward the actual outs/base-runner situation from the last synced
 * pitch — but it does NOT try to resume the exact interrupted at-bat's
 * in-progress ball/strike count. Instead it starts a fresh at-bat for the
 * NEXT batter in the order, mirroring what a coach would naturally do in the
 * moment (tap "Next Batter" and move on) rather than attempting a riskier
 * exact reconstruction of a count that was never fully synced as "complete".
 */
export function buildResumableGameState(game: ScoutGame, webhookUrl: string): GameState {
  const base = buildFakeGameState(game, webhookUrl);

  // Find the chronologically last pitch (by at-bat then pitch number) to
  // determine who's up next and what the base/outs situation was.
  const sortedRows = [...game.allRows].sort((a, b) => {
    const abA = Number(a.atBatNumber) || 0, abB = Number(b.atBatNumber) || 0;
    if (abA !== abB) return abA - abB;
    return (Number(a.pitchNumber) || 0) - (Number(b.pitchNumber) || 0);
  });
  const lastRow = sortedRows[sortedRows.length - 1];

  // Resolve the last-active batter's index via the same lineup key used to
  // build base.lineup (`${number}|${name}`) — NOT the raw sheet
  // lineupPosition column, which uses a different (1-based) offset than the
  // in-app 0-based index and would silently produce the wrong "next batter".
  let lastBatterIdx = -1;
  if (lastRow) {
    const key = `${lastRow.batterNumber}|${lastRow.batterName}`;
    lastBatterIdx = base.lineup.findIndex(p => p.id === key);
  }
  const lineupLen = base.lineup.length;
  const nextBatterIdx = lineupLen > 0
    ? (lastBatterIdx >= 0 ? (lastBatterIdx + 1) % lineupLen : 0)
    : 0;

  const nextAtBatNumber = base.allAtBats
    .filter(ab => ab.batterIndex === nextBatterIdx && ab.isComplete)
    .length + 1;
  const nextPlayerId = base.lineup[nextBatterIdx]?.id;

  const gameId = game.gameId || `game-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const newAtBat: AtBat = {
    id: `${gameId}-ab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    batterIndex: nextBatterIdx,
    playerId: nextPlayerId,
    atBatNumber: nextAtBatNumber,
    pitches: [],
    balls: 0,
    strikes: 0,
    isComplete: false,
    startedAt: new Date().toISOString(),
  };

  // Base/outs situation is already stored per-pitch (baseState/outsCount
  // columns) — cheap to carry forward so the resumed game doesn't silently
  // reset runners/outs to zero mid-inning.
  function parseBaseState(s: string): BaseState {
    if (s === 'Loaded') return { first: true, second: true, third: true };
    return {
      first:  s.includes('1B'),
      second: s.includes('2B'),
      third:  s.includes('3B'),
    };
  }
  const baseState: BaseState = lastRow
    ? parseBaseState(String(lastRow.baseState ?? ''))
    : { first: false, second: false, third: false };
  const outsCount = (lastRow ? (Number(lastRow.outsCount) || 0) : 0) as 0 | 1 | 2;

  return {
    ...base,
    id: gameId,
    phase: 'pitching',
    activeTab: 'pitch',
    currentBatterIndex: nextBatterIdx,
    currentAtBat: newAtBat,
    baseState,
    outsCount,
    batterHand: base.lineup[nextBatterIdx]?.hand ?? null,
    syncQueue: [],
  };
}

// ── Per-pitcher filtering (for pitcher-swipe views) ─────────────────────────────

/**
 * Returns the full list of pitchers who appeared in a reconstructed game,
 * in chronological order (starting pitcher first, most recent last) — the
 * order a coach reviewing a completed game actually wants, as opposed to
 * the "current pitcher first" ordering used for live-game screens.
 */
export function chronologicalPitchers(state: GameState): Player[] {
  const list = [...(state.pitcherHistory ?? [])];
  if (state.pitcher && state.pitcher.name.trim()) list.push(state.pitcher);
  return list;
}

/**
 * Derives a GameState scoped to a single pitcher's outing — every AtBat's
 * pitches are filtered down to just the pitches that pitcher threw, and
 * AtBats where that pitcher never threw a pitch are dropped entirely.
 * Used to power a pitcher-swipe view on the Lineup tab for past games, so
 * "viewing a previous pitcher" actually shows the lineup/at-bats that
 * pitcher faced, instead of just a static stats popup.
 */
export function filterGameStateByPitcher(state: GameState, pitcher: Player | null): GameState {
  if (!pitcher || !pitcher.name.trim()) return state;

  const matches = (p: PitchRecord) =>
    p.pitcherName === pitcher.name && p.pitcherNumber === pitcher.number;

  const allAtBats: AtBat[] = state.allAtBats
    .map(ab => ({ ...ab, pitches: ab.pitches.filter(matches) }))
    .filter(ab => ab.pitches.length > 0);

  return {
    ...state,
    pitcher,
    pitcherHistory: [], // suppress LineupPanel's own "Previous" list — the
                         // pitcher-swipe header above it already covers this
    allAtBats,
    currentAtBat: null,
  };
}
