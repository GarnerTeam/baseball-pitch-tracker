'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { BatterHistoryModal } from '@/components/batter-history-modal';
import { LineupPanel } from '@/components/lineup-panel';
import { PitchRowLite } from '@/lib/sheets';
import {
  GameState, Player, AtBat, PitchRecord,
  PitchType, PitchOutcome, PitchLocation, HitData,
  BaseState, ContactType,
} from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SheetRow {
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

interface ScoutPitcher { name: string; number: string; }

interface ScoutAtBat {
  atBatNumber: number;
  pitches: SheetRow[];
  finalOutcome: string;
  hitResult: string;
}

interface ScoutBatter {
  name: string; number: string; hand: string;
  lineupPos: number;
  atBats: ScoutAtBat[];
}

interface ScoutGame {
  gameId: string; homeTeam: string; visitingTeam: string;
  pitchers: ScoutPitcher[];
  batters: ScoutBatter[];
  allRows: SheetRow[];
}

// ── Reconstruction ────────────────────────────────────────────────────────────
function reconstructGame(rows: SheetRow[]): ScoutGame {
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

// ── SheetRow → PitchRecord conversion ────────────────────────────────────────

/**
 * Reverse-maps a pitchLocation string (e.g. "Z5", "B-Up-In") back to a PitchLocation
 * object that PitchRow / pitchLocLabel can render identically to the original.
 *
 * For strike zones (Z1–Z9) the mapping is exact.
 * For ball zones we replay the same getBallLabel() logic used at recording time
 * across all valid outer-grid cells and return the first cell whose label matches.
 * This guarantees pitchLocLabel will reproduce the original string.
 */
function parsePitchLocation(
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

function sheetRowToPitchRecord(row: SheetRow, pitchIndex: number): PitchRecord {
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

function scoutAbResult(ab: ScoutAtBat): AtBat['result'] {
  if (ab.finalOutcome === 'strikeout') return 'strikeout';
  if (ab.finalOutcome === 'walk')      return 'walk';
  if (ab.hitResult || ab.finalOutcome === 'in-play') return 'in-play';
  return 'manual-end';
}

/**
 * Convert a reconstructed ScoutGame into a minimal GameState that
 * LineupPanel (readOnly=true) can render identically to the main app.
 */
function buildFakeGameState(game: ScoutGame, webhookUrl: string): GameState {
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

// ── Stats helpers (for the stats tab — unchanged) ─────────────────────────────
const PT_COLOR: Record<string, string> = { FB: '#ef4444', CB: '#22c55e', SL: '#8b5cf6', CH: '#f97316' };
const OUTCOME_COLOR: Record<string, string> = {
  'called-strike': '#ef4444', 'swinging-strike': '#ef4444', strikeout: '#ef4444',
  walk: '#22c55e', 'in-play': '#3b82f6', foul: '#f97316', ball: '#64748b',
};
const OUTCOME_LABEL: Record<string, string> = {
  'called-strike': 'K', 'swinging-strike': 'K', strikeout: 'K',
  walk: 'BB', 'in-play': '●', foul: 'F', 'foul-tip': 'FT', ball: 'B',
};
const HIT_COLOR: Record<string, string> = {
  out: '#ef4444', error: '#f97316', single: '#22c55e', double: '#22c55e',
  triple: '#22c55e', 'home-run': '#eab308',
};
const HIT_LABEL: Record<string, string> = {
  out: 'Out', error: 'Err', single: '1B', double: '2B', triple: '3B', 'home-run': 'HR',
};

function abResultLabel(ab: ScoutAtBat) {
  if (ab.hitResult) return HIT_LABEL[ab.hitResult] ?? ab.hitResult;
  if (ab.finalOutcome === 'strikeout') return 'K';
  if (ab.finalOutcome === 'walk') return 'BB';
  return ab.finalOutcome ? (OUTCOME_LABEL[ab.finalOutcome] ?? ab.finalOutcome) : '—';
}
function abResultColor(ab: ScoutAtBat) {
  if (ab.hitResult) return HIT_COLOR[ab.hitResult] ?? '#94a3b8';
  return OUTCOME_COLOR[ab.finalOutcome] ?? '#94a3b8';
}

// ── Swipe hook ────────────────────────────────────────────────────────────────
function useSwipe(onLeft: () => void, onRight: () => void) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.targetTouches[0].clientX;
      startY.current = e.targetTouches[0].clientY;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (startX.current === null || startY.current === null) return;
      const dx = startX.current - e.changedTouches[0].clientX;
      const dy = startY.current - e.changedTouches[0].clientY;
      startX.current = null; startY.current = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onLeft();
      if (dx < 0) onRight();
    },
  };
}

const URL_KEY = 'scout-webhook-url';
const NOOP = () => {};

// ── Main ──────────────────────────────────────────────────────────────────────
export function ScoutClient() {
  const searchParams = useSearchParams();
  const DEFAULT_URL = process.env.NEXT_PUBLIC_SCOUT_WEBHOOK_URL ?? '';

  const [webhookUrl, setWebhookUrl] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_URL;
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('url');
    if (paramUrl) {
      try { localStorage.setItem(URL_KEY, paramUrl); } catch {}
      return paramUrl;
    }
    try { return localStorage.getItem(URL_KEY) ?? DEFAULT_URL; } catch { return DEFAULT_URL; }
  });
  const [urlInput, setUrlInput] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_URL;
    const params = new URLSearchParams(window.location.search);
    return params.get('url') ?? ((() => { try { return localStorage.getItem(URL_KEY) ?? DEFAULT_URL; } catch { return DEFAULT_URL; } })());
  });
  const [game, setGame]               = useState<ScoutGame | null>(null);
  const [loading, setLoading]         = useState(false);
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tab, setTab]                 = useState<'lineup' | 'stats'>('lineup');

  // Keep in sync if the URL param changes while mounted
  useEffect(() => {
    const paramUrl = searchParams?.get('url');
    if (paramUrl && paramUrl !== webhookUrl) {
      try { localStorage.setItem(URL_KEY, paramUrl); } catch {}
      setWebhookUrl(paramUrl);
      setUrlInput(paramUrl);
    }
  }, [searchParams]);

  const fetchGame = useCallback(async (url: string) => {
    if (!url) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res  = await fetch(`/api/sheets/scout?${new URLSearchParams({ url })}`);
      const json = await res.json();
      if (json.error) { setFetchError(json.error); return; }
      const rows: SheetRow[] = json.pitches ?? [];
      setGame(reconstructGame(rows));
      setLastRefresh(new Date());
    } catch (e) { setFetchError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!webhookUrl) return;
    fetchGame(webhookUrl);
    const id = setInterval(() => fetchGame(webhookUrl), 30_000);
    return () => clearInterval(id);
  }, [webhookUrl, fetchGame]);

  // Stats-tab pitcher navigation (swipe)
  const [statsPitcherIdx, setStatsPitcherIdx] = useState(0);
  const statsSwipe = useSwipe(
    () => statsPitchers.length > 0 && setStatsPitcherIdx(i => Math.min(i + 1, statsPitchers.length - 1)),
    () => setStatsPitcherIdx(i => Math.max(i - 1, 0)),
  );

  // ── URL setup ─────────────────────────────────────────────────────────────
  if (!webhookUrl) {
    return (
      <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-5 p-8">
        <span className="text-6xl">⚾</span>
        <p className="text-2xl font-bold">Scout View</p>
        <p className="text-slate-400 text-center">Enter your Google Sheets webhook URL to view live game data.</p>
        <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)}
          placeholder="https://script.google.com/macros/s/…/exec" rows={3}
          className="w-full max-w-md rounded-xl bg-slate-800 border border-slate-600 text-slate-100 text-sm p-3 outline-none focus:border-blue-500 font-mono" />
        <button disabled={!urlInput.trim()}
          onClick={() => { const u = urlInput.trim(); localStorage.setItem(URL_KEY, u); setWebhookUrl(u); }}
          className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-lg font-semibold">
          Connect
        </button>
      </div>
    );
  }

  if (loading && !game) return (
    <div className="fixed inset-0 bg-slate-950 text-slate-400 flex items-center justify-center text-xl">Loading…</div>
  );

  if (fetchError && !game) return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <p className="text-red-400 text-lg font-semibold">Failed to load data</p>
      <p className="text-slate-500 text-sm text-center">{fetchError}</p>
      <p className="text-slate-600 text-xs text-center">Make sure the Apps Script has been updated with the new doGet() and redeployed.</p>
      <button onClick={() => fetchGame(webhookUrl)} className="px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-base font-medium">Retry</button>
      <button onClick={() => { localStorage.removeItem(URL_KEY); setWebhookUrl(''); }} className="text-slate-600 text-sm underline mt-2">Change URL</button>
    </div>
  );

  if (!game || game.allRows.length === 0) return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <span className="text-5xl">⚾</span>
      <p className="text-xl font-bold text-slate-300">No game data yet</p>
      <p className="text-slate-500 text-center">Waiting for pitches to sync from the recording device.</p>
      <button onClick={() => fetchGame(webhookUrl)} className="mt-2 px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-base">Refresh</button>
    </div>
  );

  const timeStr = lastRefresh?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '';

  // Build the fake GameState for LineupPanel (lineup tab)
  const fakeState = buildFakeGameState(game, webhookUrl);

  // Stats tab: pitcher data (unchanged logic)
  const statsPitchers = [...game.pitchers].reverse(); // current first
  const safeStatsIdx = Math.min(statsPitcherIdx, Math.max(0, statsPitchers.length - 1));
  const statsPitcher = statsPitchers[safeStatsIdx] ?? null;
  const isCurrentPitcher = safeStatsIdx === 0;

  const pitcherRows = statsPitcher
    ? game.allRows.filter(r => String(r.pitcherName) === statsPitcher.name && String(r.pitcherNumber) === statsPitcher.number)
    : game.allRows;
  const pitcherBatters = statsPitcher
    ? game.batters.map(b => ({
        ...b,
        atBats: b.atBats.map(ab => ({
          ...ab,
          pitches: ab.pitches.filter(p => String(p.pitcherName) === statsPitcher.name && String(p.pitcherNumber) === statsPitcher.number),
        })).filter(ab => ab.pitches.length > 0),
      })).filter(b => b.atBats.length > 0)
    : game.batters;

  const totalP     = pitcherRows.length;
  const strikes    = pitcherRows.filter(p => ['called-strike','swinging-strike','foul','foul-tip','in-play','strikeout'].includes(String(p.outcome))).length;
  const walks      = pitcherRows.filter(p => String(p.outcome) === 'walk').length;
  const strikeouts = pitcherRows.filter(p => String(p.outcome) === 'strikeout').length;
  const inPlay     = pitcherRows.filter(p => String(p.outcome) === 'in-play').length;
  const strikePct  = totalP > 0 ? Math.round((strikes / totalP) * 100) : 0;
  const ptCounts: Record<string, number> = {};
  for (const p of pitcherRows) { const t = String(p.pitchType || '?').toUpperCase(); ptCounts[t] = (ptCounts[t] ?? 0) + 1; }
  const ptEntries = Object.entries(ptCounts).sort((a, b) => b[1] - a[1]);
  const outcomeCounts: Record<string, number> = {};
  for (const p of pitcherRows) { const o = String(p.outcome || '?'); outcomeCounts[o] = (outcomeCounts[o] ?? 0) + 1; }

  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">

      {/* Header */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between">
        <div>
          <p className="text-slate-100 font-bold text-lg leading-tight">
            {game.homeTeam || 'Home'} vs {game.visitingTeam || 'Away'}
          </p>
          <p className="text-slate-500 text-xs">View only · {timeStr}{loading ? ' · refreshing…' : ''}</p>
        </div>
        <button onClick={() => fetchGame(webhookUrl)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-medium border border-slate-700">↻</button>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex bg-slate-900 border-b border-slate-800">
        {(['lineup', 'stats'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-base font-semibold tracking-wide transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
            {t === 'lineup' ? '👥 Lineup' : '📊 Stats'}
          </button>
        ))}
      </div>

      {/* ── LINEUP TAB: exact carbon copy of LineupPanel in readOnly mode ── */}
      {tab === 'lineup' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <LineupPanel
            state={fakeState}
            readOnly={true}
            onNextBatter={NOOP}
            onPrevBatter={NOOP}
            onEndAtBat={NOOP}
            onChangePitcher={NOOP}
            onAddBatter={NOOP}
            onRemoveBatter={NOOP}
            onSetBatterAt={NOOP}
            onReorderBatter={NOOP}
            onEditPitch={NOOP}
            onUndoLastEnd={NOOP}
            onSetWebhookUrl={NOOP}
          />
        </div>
      )}

      {/* ── STATS TAB ── */}
      {tab === 'stats' && (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* Pitcher header with swipe */}
          <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800" {...statsSwipe}>
            <div className="flex items-center gap-3 px-4 pt-3 pb-2">
              <span className="bg-blue-600 text-white text-[21px] font-bold px-2.5 py-0.5 rounded-lg flex-shrink-0">
                #{statsPitcher?.number || '—'}
              </span>
              <span className="font-semibold text-[22px] text-slate-100 truncate flex-1">
                {statsPitcher?.name || 'No Pitcher'}
              </span>
              <span className="text-[15px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full"
                style={{ background: isCurrentPitcher ? '#166534' : 'transparent', color: isCurrentPitcher ? '#fff' : '#64748b' }}>
                {isCurrentPitcher ? 'Current' : 'Previous'}
              </span>
            </div>
            {statsPitchers.length > 1 && (
              <div className="flex items-center justify-center gap-2 pb-2">
                <button onClick={() => safeStatsIdx > 0 && setStatsPitcherIdx(safeStatsIdx - 1)} disabled={safeStatsIdx === 0}
                  className="text-slate-500 disabled:opacity-20 text-[21px] px-1">‹</button>
                {statsPitchers.map((_, i) => (
                  <button key={i} onClick={() => setStatsPitcherIdx(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${i === safeStatsIdx ? 'bg-blue-400' : 'bg-slate-700'}`} />
                ))}
                <button onClick={() => safeStatsIdx < statsPitchers.length - 1 && setStatsPitcherIdx(safeStatsIdx + 1)} disabled={safeStatsIdx === statsPitchers.length - 1}
                  className="text-slate-500 disabled:opacity-20 text-[21px] px-1">›</button>
              </div>
            )}
          </div>

          <div className="p-4 space-y-4">

            {/* ── Batters Faced / Strikeouts / Walks bar chart ── */}
            {(() => {
              const chartBars = [
                { line1: 'Batters', line2: 'Faced', value: pitcherBatters.length, color: '#3b82f6' },
                { line1: 'Strike',  line2: 'outs',  value: strikeouts,             color: '#ef4444' },
                { line1: 'Walks',   line2: '',       value: walks,                  color: '#22c55e' },
              ];
              const maxVal = Math.max(...chartBars.map(b => b.value), 1);
              return (
                <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
                  <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Performance</p>
                  {/* Chart area: fixed height, Y axis labels on left, bars fill remaining width */}
                  <div className="flex gap-2 items-end" style={{ height: 140 }}>
                    {/* Y-axis */}
                    <div className="flex flex-col justify-between h-full pb-7 flex-shrink-0 w-5 text-right">
                      <span className="text-slate-500 text-[11px] leading-none">{maxVal}</span>
                      <span className="text-slate-500 text-[11px] leading-none">{Math.round(maxVal / 2)}</span>
                      <span className="text-slate-500 text-[11px] leading-none">0</span>
                    </div>
                    {/* Bars */}
                    <div className="flex flex-1 gap-3 items-end h-full">
                      {chartBars.map(bar => {
                        const pct = maxVal > 0 ? (bar.value / maxVal) * 100 : 0;
                        return (
                          <div key={bar.line1} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                            {/* Value above bar */}
                            <span className="text-white text-[15px] font-bold leading-none flex-shrink-0">{bar.value}</span>
                            {/* Bar column */}
                            <div className="w-full flex items-end flex-1 relative">
                              {/* Grid lines */}
                              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                                <div className="border-t border-slate-800" />
                                <div className="border-t border-slate-800" />
                                <div className="border-t border-slate-700" />
                              </div>
                              {/* Bar */}
                              <div
                                className="w-full rounded-t-md"
                                style={{ height: `${Math.max(pct, 2)}%`, backgroundColor: bar.color, opacity: 0.9 }}
                              />
                            </div>
                            {/* Labels below */}
                            <span className="text-slate-400 text-[11px] leading-tight text-center flex-shrink-0">{bar.line1}</span>
                            {bar.line2 ? <span className="text-slate-400 text-[11px] leading-tight text-center flex-shrink-0 -mt-0.5">{bar.line2}</span> : <span className="text-[11px] flex-shrink-0">&nbsp;</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Strike %', value: `${strikePct}%` },
                { label: 'Total Pitches', value: totalP },
                { label: 'Strikeouts', value: strikeouts },
              ].map(c => (
                <div key={c.label} className="bg-slate-900 rounded-xl border border-slate-700 p-3 text-center">
                  <p className="text-slate-400 text-[13px] uppercase tracking-wide mb-1">{c.label}</p>
                  <p className="text-white font-black text-[28px] leading-none">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Walks', value: walks },
                { label: 'In Play', value: inPlay },
                { label: 'Batters Faced', value: pitcherBatters.length },
              ].map(c => (
                <div key={c.label} className="bg-slate-900 rounded-xl border border-slate-700 p-3 text-center">
                  <p className="text-slate-400 text-[13px] uppercase tracking-wide mb-1">{c.label}</p>
                  <p className="text-white font-black text-[28px] leading-none">{c.value}</p>
                </div>
              ))}
            </div>

            {/* Pitch mix */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Pitch Mix</p>
              <div className="space-y-2">
                {ptEntries.map(([pt, cnt]) => {
                  const pct = Math.round((cnt / totalP) * 100);
                  const color = PT_COLOR[pt] ?? '#94a3b8';
                  return (
                    <div key={pt} className="flex items-center gap-3">
                      <span className="w-8 font-bold text-[16px] flex-shrink-0" style={{ color }}>{pt}</span>
                      <div className="flex-1 bg-slate-800 rounded-full h-3 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <span className="text-slate-300 text-[15px] w-14 text-right flex-shrink-0">{cnt} · {pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Outcomes */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Outcomes</p>
              <div className="space-y-1.5">
                {Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1]).map(([oc, cnt]) => (
                  <div key={oc} className="flex items-center justify-between text-[16px]">
                    <span className="capitalize text-slate-300">{oc.replace(/-/g, ' ')}</span>
                    <span className="font-bold" style={{ color: OUTCOME_COLOR[oc] ?? '#94a3b8' }}>{cnt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-batter vs this pitcher */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Batters Faced</p>
              <div className="space-y-2">
                {pitcherBatters.map((b, idx) => {
                  const pc = b.atBats.reduce((s, ab) => s + ab.pitches.length, 0);
                  const lastAB = b.atBats[b.atBats.length - 1];
                  return (
                    <div key={`${b.number}|${b.name}`} className="flex items-center gap-2 text-[16px]">
                      <span className="text-slate-600 w-5 text-right font-mono">{idx + 1}.</span>
                      <span className="text-slate-500 font-bold w-8 flex-shrink-0">#{b.number}</span>
                      <span className="flex-1 text-slate-300 truncate">{b.name}</span>
                      <span className="text-slate-500 text-[14px] flex-shrink-0">{pc}p</span>
                      {lastAB && (
                        <span className="font-bold text-[15px] flex-shrink-0 w-8 text-right" style={{ color: abResultColor(lastAB) }}>
                          {abResultLabel(lastAB)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button onClick={() => { localStorage.removeItem(URL_KEY); setWebhookUrl(''); setGame(null); }}
              className="w-full py-2 rounded-xl border border-slate-800 text-slate-700 hover:text-slate-500 text-sm">
              Change Sheets URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
