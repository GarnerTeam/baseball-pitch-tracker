'use client';
import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PitchRow {
  gameId?: string;
  timestamp?: string;
  batterName?: string;
  batterNumber?: string;
  batterHand?: string;
  pitchType?: string;
  pitchZone?: string;
  pitchLocation?: string;
  action?: string;
  outcome?: string;
  hitResult?: string;
  hitType?: string;
  hitX?: number | string;
  hitY?: number | string;
  atBatNumber?: number | string;
}

interface CellStat {
  total: number; swings: number; contacts: number; inPlay: number;
  types:      Record<string, number>;
  typeSwings: Record<string, number>;
  typeMisses: Record<string, number>;
}

// ── Zone names (static RHB defaults — overridden inside component by gridHand) ──
const ZONE_NAMES_RHB: Record<string, string> = {
  Z1:'Hi-In',  Z2:'High',    Z3:'Hi-Out',
  Z4:'Mid-In', Z5:'Center',  Z6:'Mid-Out',
  Z7:'Lo-In',  Z8:'Low',     Z9:'Lo-Out',
};
const ZONE_NAMES_LHB: Record<string, string> = {
  Z1:'Hi-Out', Z2:'High',    Z3:'Hi-In',
  Z4:'Mid-Out',Z5:'Center',  Z6:'Mid-In',
  Z7:'Lo-Out', Z8:'Low',     Z9:'Lo-In',
};

// ── Color scale ───────────────────────────────────────────────────────────────
function swingBg(pct: number, total: number): string {
  if (total < 1) return '#1e293b';
  if (pct >= 75) return '#b91c1c';
  if (pct >= 55) return '#c2410c';
  if (pct >= 40) return '#a16207';
  if (pct >= 20) return '#1d4ed8';
  return '#1e3a8a';
}
function textColor(bg: string): string {
  return bg === '#1e293b' ? '#475569' : bg === '#1e3a8a' ? '#93c5fd' : '#ffffff';
}

/** Sort a pitchType→count map descending and return top N as [type, count] pairs. */
function topTypes(map: Record<string, number>, n = 2): [string, number][] {
  return Object.entries(map ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Best pitch type label from a miss-count map: e.g. "SL ×4" */
function bestPitch(map: Record<string, number>): string | null {
  const top = topTypes(map, 1);
  return top.length > 0 ? `${top[0][0]} ×${top[0][1]}` : null;
}

// ── Pitch-type colour maps (match pitch page) ────────────────────────────────
// Display label (Ch not CH) and colours from PITCH_TYPE_COLORS in types/index.ts
const PT_LABEL: Record<string, string> = { FB:'FB', CB:'CB', SL:'SL', CH:'Ch' };
const PT_COLOR: Record<string, string> = {
  FB: '#ef4444',  // red
  CB: '#22c55e',  // green
  SL: '#8b5cf6',  // purple
  CH: '#f97316',  // orange
};
// Dark cell background tinted by pitch type
const PT_BG: Record<string, string> = {
  FB: '#2d0707',
  CB: '#072d07',
  SL: '#10062d',
  CH: '#2d1207',
};

// ── Location normalizer ───────────────────────────────────────────────────────
// When batter hand was null at record time, ballLocationLabel() falls back to
// "Left"/"Right"/"L"/"R" instead of "In"/"Out". We remap using the pitch's own
// hand (or gridHand as fallback) so every pitch lands in a grid cell.
function normalizeLocation(loc: string, hand: 'R' | 'L'): string {
  if (!loc.startsWith('B-')) return loc;
  const ins  = hand === 'R' ? 'In'  : 'Out';
  const outs = hand === 'R' ? 'Out' : 'In';
  return loc
    .replace('Left',  ins)
    .replace('Right', outs)
    // Up-L / Low-L / Up-R / Low-R
    .replace(/-L$/, `-${ins}`)
    .replace(/-R$/, `-${outs}`);
}

// ── 5×5 grid helpers ──────────────────────────────────────────────────────────
function cellLocKey(row: number, col: number, h: 'R' | 'L'): string | null {
  if (row >= 1 && row <= 3 && col >= 1 && col <= 3) {
    return `Z${(row - 1) * 3 + (col - 1) + 1}`;
  }
  const r = h === 'R';
  const top = row === 0, bot = row === 4;
  const lft = col <= 1, rgt = col >= 3, mc = col === 2;

  if (top && lft)  return r ? 'B-Up-In'   : 'B-Up-Out';
  if (top && mc)   return 'B-Up';
  if (top && rgt)  return r ? 'B-Up-Out'  : 'B-Up-In';
  if (bot && lft)  return r ? 'B-Low-In'  : 'B-Low-Out';
  if (bot && mc)   return 'B-Low';
  if (bot && rgt)  return r ? 'B-Low-Out' : 'B-Low-In';
  if (lft && row === 1) return r ? 'B-In-Hi'  : 'B-Out-Hi';
  if (lft && row === 2) return r ? 'B-In'     : 'B-Out';
  if (lft && row === 3) return r ? 'B-In-Lo'  : 'B-Out-Lo';
  if (rgt && row === 1) return r ? 'B-Out-Hi' : 'B-In-Hi';
  if (rgt && row === 2) return r ? 'B-Out'    : 'B-In';
  if (rgt && row === 3) return r ? 'B-Out-Lo' : 'B-In-Lo';
  return null;
}

function cellLabel(row: number, col: number, h: 'R' | 'L'): string {
  if (row >= 1 && row <= 3 && col >= 1 && col <= 3) return '';
  const r = h === 'R';
  const top = row === 0, bot = row === 4;
  const lft = col <= 1, rgt = col >= 3, mc = col === 2;

  if (top && lft)  return r ? 'Hi-In'  : 'Hi-Out';
  if (top && mc)   return 'Hi';
  if (top && rgt)  return r ? 'Hi-Out' : 'Hi-In';
  if (bot && lft)  return r ? 'Lo-In'  : 'Lo-Out';
  if (bot && mc)   return 'Lo';
  if (bot && rgt)  return r ? 'Lo-Out' : 'Lo-In';
  if (lft && row === 1) return r ? 'In-Hi'  : 'Out-Hi';
  if (lft && row === 2) return r ? 'In'     : 'Out';
  if (lft && row === 3) return r ? 'In-Lo'  : 'Out-Lo';
  if (rgt && row === 1) return r ? 'Out-Hi' : 'In-Hi';
  if (rgt && row === 2) return r ? 'Out'    : 'In';
  if (rgt && row === 3) return r ? 'Out-Lo' : 'In-Lo';
  return '';
}

// ── Shadow cells ─────────────────────────────────────────────────────────────
// Corner pairs (0,1)/(0,0), (0,3)/(0,4), (4,1)/(4,0), (4,3)/(4,4) share the
// same pitchLocation key. The inner cell is a "shadow" — it shows the heat
// colour but no count, so the grid total matches the actual pitch count.
function isShadowCell(row: number, col: number): boolean {
  return (row === 0 || row === 4) && (col === 1 || col === 3);
}

// ── Vertical bat SVG ─────────────────────────────────────────────────────────
// Barrel at top, knob at bottom — placed left for RHB, right for LHB
function BatSVG() {
  return (
    <svg
      viewBox="0 0 20 300"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: 14, height: '100%', flexShrink: 0, display: 'block' }}
    >
      {/* Barrel */}
      <rect x="1" y="2"   width="18" height="130" rx="9"  fill="#a16207" />
      {/* Taper barrel → handle */}
      <polygon points="1,128 19,128 14,178 6,178" fill="#92400e" />
      {/* Handle */}
      <rect x="6" y="176" width="8"  height="106" rx="4"  fill="#78350f" />
      {/* Knob */}
      <ellipse cx="10" cy="287" rx="10" ry="7" fill="#6b2d0f" />
    </svg>
  );
}

// ── Spray chart SVG constants ─────────────────────────────────────────────────
const SW=400,SH=390,SHX=200,SHY=365;
const SR_FENCE=270,SR_WARN=220;
const SLFPX=9,SLFPY=174,SRFPX=391,SRFPY=174;
const SB1X=271,SB1Y=294,SB2X=200,SB2Y=224,SB3X=129,SB3Y=294;
const SMX=200,SMY=298;
const SWARN_LX=44,SWARN_LY=209,SWARN_RX=356,SWARN_RY=209;

function hitDotColor(r: string) {
  if (r === 'out')      return '#64748b';
  if (r === 'home-run') return '#eab308';
  if (r === 'error')    return '#f59e0b';
  return '#14b8a6';
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  playerName: string;
  playerNumber: string;
  webhookUrl: string;
  /** The current game's ID — rows with this gameId are stripped from the API
   *  result so today's pitches come exclusively from currentGamePitches. */
  currentGameId?: string;
  /** Live pitches for this batter from the current game (app state, not sheet). */
  currentGamePitches?: PitchRow[];
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function BatterHistoryModal({
  playerName, playerNumber, webhookUrl,
  currentGameId, currentGamePitches = [],
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // histPitches = historical rows from the sheet (today's gameId excluded)
  const [histPitches, setHistPitches] = useState<PitchRow[]>([]);
  const [view, setView] = useState<'heatmap' | 'spray'>('heatmap');

  // ── Merge historical + current-game pitches ───────────────────────────────
  // currentGamePitches come from app state (always fresh); histPitches come from
  // the sheet with today's gameId stripped out — so no duplicates.
  const pitches: PitchRow[] = [...histPitches, ...currentGamePitches];

  useEffect(() => {
    if (!webhookUrl) {
      setFetchError('No Google Sheets URL configured. Set it on the Lineup page first.');
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams({ url: webhookUrl, batter: playerName, num: playerNumber });
    fetch(`/api/sheets/history?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        const allFromSheet: PitchRow[] = d.pitches ?? [];
        // Exclude today's game — those rows come from currentGamePitches prop
        const hist = currentGameId
          ? allFromSheet.filter(p => p.gameId !== currentGameId)
          : allFromSheet;
        setHistPitches(hist);
      })
      .catch(e => setFetchError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [playerName, playerNumber, webhookUrl]);

  // ── Predominant hand ──────────────────────────────────────────────────────
  const handCounts = { R: 0, L: 0 };
  for (const p of pitches) {
    if (p.batterHand === 'R') handCounts.R++;
    else if (p.batterHand === 'L') handCounts.L++;
  }
  const gridHand: 'R' | 'L' = handCounts.L > handCounts.R ? 'L' : 'R';

  // Zone name labels adjust In/Out based on batter handedness.
  // Z1 is the left column of the strike zone (from pitcher's POV):
  //   RHB → left = Inside  → Z1 = 'Hi-In'
  //   LHB → left = Outside → Z1 = 'Hi-Out'
  const ZONE_NAMES = gridHand === 'R' ? ZONE_NAMES_RHB : ZONE_NAMES_LHB;

  // ── Build per-location stats (normalize Left/Right → In/Out) ──────────────
  const locStats: Record<string, CellStat> = {};
  let totalPitches = 0, totalSwings = 0, ballPitches = 0, ballSwings = 0, inPlayCount = 0;

  for (const p of pitches) {
    const rawLoc = (p.pitchLocation ?? '').trim();
    if (!rawLoc) continue;
    const pitchHand = (p.batterHand === 'L' || p.batterHand === 'R') ? p.batterHand : gridHand;
    const loc = normalizeLocation(rawLoc, pitchHand);

    if (!locStats[loc]) locStats[loc] = { total: 0, swings: 0, contacts: 0, inPlay: 0, types: {}, typeSwings: {}, typeMisses: {} };
    const isSwing   = p.action === 'Swing';
    const isContact = isSwing && ['foul','foul-tip','in-play'].includes(p.outcome ?? '');
    const isInPlay  = isSwing && p.outcome === 'in-play';
    const isMiss    = isSwing && !isContact;
    const pt = (p.pitchType ?? '').toUpperCase() || '?';
    locStats[loc].total++;
    locStats[loc].types[pt]      = (locStats[loc].types[pt]      ?? 0) + 1;
    if (isSwing)   { locStats[loc].swings++;  totalSwings++;  locStats[loc].typeSwings[pt] = (locStats[loc].typeSwings[pt] ?? 0) + 1; }
    if (isMiss)    { locStats[loc].typeMisses[pt] = (locStats[loc].typeMisses[pt] ?? 0) + 1; }
    if (isContact)   locStats[loc].contacts++;
    if (isInPlay)    locStats[loc].inPlay++;
    totalPitches++;
    if (p.pitchZone === 'Ball') { ballPitches++; if (isSwing) ballSwings++; }
  }

  // ── Quick-read (strike zone only, min 2 pitches) ──────────────────────────
  const rankedZones = Object.keys(ZONE_NAMES)
    .map(z => {
      const s = locStats[z] ?? { total: 0, swings: 0, contacts: 0, inPlay: 0, types: {}, typeSwings: {}, typeMisses: {} };
      const misses = s.swings - s.contacts;
      return {
        zone: z, name: ZONE_NAMES[z], ...s,
        swingPct:    s.total  >= 2 ? Math.round(s.swings   / s.total   * 100) : -1,
        missPct:     s.swings >= 2 ? Math.round(misses      / s.swings  * 100) : -1,
        // whiffRate = misses per pitch thrown — best "pitch here" signal
        whiffRate:   s.total  >= 2 ? Math.round(misses      / s.total   * 100) : -1,
        // contactRate = contacts per pitch thrown — "danger zone" signal
        contactRate: s.total  >= 2 ? Math.round(s.contacts / s.total   * 100) : -1,
      };
    });

  const zonesWithData = rankedZones.filter(z => z.swingPct >= 0);

  // ── Pitch Here ─────────────────────────────────────────────────────────────
  // Best whiff rate (misses / total pitches). Min 2 pitches.
  const pitchHereZone = [...zonesWithData]
    .filter(z => z.whiffRate >= 0)
    .sort((a, b) => b.whiffRate - a.whiffRate)[0] ?? null;

  // ── K-Zone: "What PITCH TYPE gets him out?" ────────────────────────────────
  // Aggregate whiff counts by pitch type across ALL zones — this is a different
  // dimension from Pitch Here (which answers WHERE), so the two can never clash.
  const kPitchWhiffs: Record<string, number> = {};
  const kPitchSwings: Record<string, number> = {};
  for (const stat of Object.values(locStats)) {
    for (const [pt, n] of Object.entries(stat.typeMisses ?? {}))
      kPitchWhiffs[pt] = (kPitchWhiffs[pt] ?? 0) + n;
    for (const [pt, n] of Object.entries(stat.typeSwings ?? {}))
      kPitchSwings[pt] = (kPitchSwings[pt] ?? 0) + n;
  }
  const kPitchTop = topTypes(kPitchWhiffs, 1)[0] ?? null; // [pitchType, whiffCount]
  const kPitchMissPct = kPitchTop
    ? Math.round((kPitchTop[1] / (kPitchSwings[kPitchTop[0]] ?? 1)) * 100)
    : null;
  // Also find best zone for this pitch type (where it gets the most whiffs)
  const kPitchBestZone = kPitchTop
    ? Object.entries(locStats)
        .filter(([k]) => Object.keys(ZONE_NAMES).includes(k))
        .sort((a, b) => (b[1].typeMisses?.[kPitchTop[0]] ?? 0) - (a[1].typeMisses?.[kPitchTop[0]] ?? 0))[0]?.[0]
    : null;

  // ── Danger Zone ─────────────────────────────────────────────────────────────
  // Highest contact rate. Prefer a DIFFERENT zone than Pitch Here — only fall
  // back to the same zone if no other zone has contact data.
  const dangerCandidates = [...zonesWithData]
    .filter(z => z.contactRate >= 0 && z.contacts >= 1)
    .sort((a, b) => b.contactRate - a.contactRate);
  const dangerZone =
    dangerCandidates.find(z => z.zone !== pitchHereZone?.zone) ??
    dangerCandidates[0] ??
    null;

  // Takes = lowest swing% (kept for internal reference; not shown as its own card)
  const takesZone = [...zonesWithData].sort((a, b) => a.swingPct - b.swingPct)[0];

  // ── Ball-zone directional chase ───────────────────────────────────────────
  type Dir = 'High' | 'Low' | 'In' | 'Out';
  // Ball-zone labels are recorded batter-relative:
  //   B-In-Hi = inside-high to THIS batter (regardless of hand).
  // No swap needed — the correct keys are the same for RHB and LHB.
  const dirKeys: Record<Dir, string[]> = {
    High: ['B-Up', 'B-Up-In', 'B-Up-Out'],
    Low:  ['B-Low', 'B-Low-In', 'B-Low-Out'],
    In:   ['B-In-Hi', 'B-In', 'B-In-Lo'],
    Out:  ['B-Out-Hi', 'B-Out', 'B-Out-Lo'],
  };
  // Ball-zone chase (used for Chase Bait card only)
  const dirChase: Record<Dir, { total: number; swings: number }> = {
    High: {total:0,swings:0}, Low: {total:0,swings:0},
    In:   {total:0,swings:0}, Out: {total:0,swings:0},
  };
  for (const [dir, keys] of Object.entries(dirKeys) as [Dir, string[]][]) {
    for (const k of keys) {
      const s = locStats[k];
      if (s) { dirChase[dir].total += s.total; dirChase[dir].swings += s.swings; }
    }
  }
  const dirChasePct = (d: Dir) =>
    dirChase[d].total >= 1 ? Math.round(dirChase[d].swings / dirChase[d].total * 100) : null;

  const bestChaseDir = (['High','Low','In','Out'] as Dir[])
    .map(d => ({ d, pct: dirChasePct(d) ?? -1 }))
    .sort((a,b) => b.pct - a.pct)[0];

  // Hit zones — base hit or better per pitch direction (all zones, strike + ball)
  // A pitch can contribute to multiple direction buckets (e.g. Z1 = High + In)
  const hitDirs: Record<Dir, { hits: number; inPlay: number }> = {
    High: {hits:0,inPlay:0}, Low: {hits:0,inPlay:0},
    In:   {hits:0,inPlay:0}, Out: {hits:0,inPlay:0},
  };

  function getPitchDirs(loc: string, h: 'R' | 'L'): Dir[] {
    const dirs: Dir[] = [];
    const r = h === 'R';
    const up  = loc.startsWith('B-Up')  || /^Z[123]$/.test(loc);
    const low = loc.startsWith('B-Low') || /^Z[789]$/.test(loc);
    const ins = loc.includes('In')  || (r ? /^Z[147]$/.test(loc) : /^Z[369]$/.test(loc));
    const out = loc.includes('Out') || (r ? /^Z[369]$/.test(loc) : /^Z[147]$/.test(loc));
    if (up)  dirs.push('High');
    if (low) dirs.push('Low');
    if (ins) dirs.push('In');
    if (out) dirs.push('Out');
    return dirs;
  }

  for (const p of pitches) {
    const rawLoc  = (p.pitchLocation ?? '').trim();
    if (!rawLoc) continue;
    const ph      = (p.batterHand === 'L' || p.batterHand === 'R') ? p.batterHand : gridHand;
    const loc     = normalizeLocation(rawLoc, ph);
    const isHit   = ['single','double','triple','home-run'].includes(p.hitResult ?? '');
    const isInPlay = p.outcome === 'in-play' || isHit;
    if (!isInPlay) continue;
    for (const d of getPitchDirs(loc, ph)) {
      hitDirs[d].inPlay++;
      if (isHit) hitDirs[d].hits++;
    }
  }

  const uniqueGames     = new Set(pitches.map(p => p.gameId).filter(Boolean)).size;
  const overallSwingPct = totalPitches > 0 ? Math.round(totalSwings  / totalPitches * 100) : 0;
  const chaseRate       = ballPitches  > 0 ? Math.round(ballSwings   / ballPitches  * 100) : 0;
  const inPlayPct       = totalPitches > 0 ? Math.round(inPlayCount  / totalPitches * 100) : 0;

  // ── Spray hits ─────────────────────────────────────────────────────────────
  const hits = pitches.filter(p =>
    p.hitResult &&
    p.hitX !== '' && p.hitX !== undefined && !isNaN(Number(p.hitX)) &&
    p.hitY !== '' && p.hitY !== undefined && !isNaN(Number(p.hitY))
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-[26px] leading-none w-8 flex-shrink-0">←</button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-[20px] leading-tight truncate">#{playerNumber} {playerName}</p>
          <p className="text-slate-500 text-[13px]">
            {loading ? 'Loading…' : `${totalPitches} pitches · ${uniqueGames} game${uniqueGames !== 1 ? 's' : ''} · ${gridHand}HB`}
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-700 flex-shrink-0">
          <button onClick={() => setView('heatmap')} className={`px-3 py-1.5 text-[14px] font-semibold ${view === 'heatmap' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'}`}>🗺 Map</button>
          <button onClick={() => setView('spray')}   className={`px-3 py-1.5 text-[14px] font-semibold ${view === 'spray'   ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'}`}>🏟 Field</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-[16px]">Fetching history…</p>
          </div>
        )}

        {!loading && fetchError && (
          <div className="m-4 p-4 bg-red-950 border border-red-800 rounded-xl space-y-2">
            <p className="text-red-300 font-bold text-[18px]">Could not load history</p>
            <p className="text-red-400 text-[15px]">{fetchError}</p>
            <p className="text-slate-500 text-[13px] pt-1 border-t border-red-900">
              Make sure Apps Script has been updated with <code className="bg-slate-800 px-1 rounded">doGet()</code> and redeployed.
            </p>
          </div>
        )}

        {!loading && !fetchError && totalPitches === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-slate-400 text-[18px]">No history found</p>
            <p className="text-slate-600 text-[15px]">for {playerName} #{playerNumber}</p>
          </div>
        )}

        {!loading && !fetchError && totalPitches > 0 && (
          <div className="pb-8 space-y-4">

            {/* Stats strip */}
            <div className="grid grid-cols-4 gap-0 border-b border-slate-800">
              {[
                { label: 'Swing%',    value: `${overallSwingPct}%` },
                { label: 'Chase%',    value: `${chaseRate}%` },
                { label: 'In Play%',  value: `${inPlayPct}%` },
                { label: 'Pitches',   value: totalPitches },
              ].map(({ label, value }) => (
                <div key={label} className="py-3 text-center border-r border-slate-800 last:border-r-0">
                  <p className="text-white font-black text-[23px] leading-none">{value}</p>
                  <p className="text-slate-500 text-[12px] mt-0.5 uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {/* ══════════ HEAT MAP ══════════ */}
            {view === 'heatmap' && (
              <div className="px-4 space-y-5">

                {/* 5×5 grid */}
                <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800">
                  <p className="text-slate-500 text-[11px] uppercase tracking-widest mb-2 text-center">Pitch Types per Zone · outlined = strike zone</p>

                  {/* Grid + bat wrapper */}
                  <div className="flex items-stretch gap-1.5">

                    {/* RHB bat — left side (batter stands left from pitcher's view) */}
                    {gridHand === 'R' && (
                      <div className="flex items-stretch py-[14px]">
                        <BatSVG />
                      </div>
                    )}

                    {/* Grid column: top axis + cells + bottom axis */}
                    <div className="flex-1 min-w-0">

                      {/* Legend */}
                      <div className="flex items-center justify-center gap-3 mb-1.5">
                        {([['rgba(59,130,246,0.85)','Takes'],['rgba(127,29,29,0.85)','Swings'],['rgba(234,179,8,0.85)','In Play']] as [string,string][]).map(([c,l]) => (
                          <div key={l} className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ background: c }} />
                            <span className="text-slate-300 font-semibold" style={{ fontSize: 13 }}>{l}</span>
                          </div>
                        ))}
                      </div>

                      {/* Grid */}
                      <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                        {Array.from({ length: 5 }).flatMap((_, row) =>
                          Array.from({ length: 5 }).map((_, col) => {
                            const isStrike = row >= 1 && row <= 3 && col >= 1 && col <= 3;
                            const key = cellLocKey(row, col, gridHand);
                            const s   = key ? (locStats[key] ?? { total:0, swings:0, contacts:0, inPlay:0, types:{}, typeSwings:{}, typeMisses:{} }) : { total:0, swings:0, contacts:0, inPlay:0, types:{}, typeSwings:{}, typeMisses:{} };
                            // ── Swing / Take / In-Play heat map ──────────────
                            // Confidence fades from 0.25 (1 pitch) → 0.85 (4+ pitches)
                            const confidence = s.total === 0 ? 0
                              : s.total === 1 ? 0.28
                              : s.total === 2 ? 0.50
                              : s.total === 3 ? 0.68
                              : 0.85;
                            let cellBgColor = '#0f172a';
                            if (s.total > 0) {
                              const takes      = s.total - s.swings;
                              const swingNoIn  = s.swings - s.inPlay;
                              // Dominant of three categories determines color
                              if (s.inPlay > 0 && s.inPlay >= takes && s.inPlay >= swingNoIn) {
                                // Gold — puts ball in play most often
                                cellBgColor = `rgba(234,179,8,${confidence})`;
                              } else if (takes >= s.swings) {
                                // Blue — takes / looks
                                cellBgColor = `rgba(59,130,246,${confidence})`;
                              } else {
                                // Red — swings (misses / fouls dominant)
                                cellBgColor = `rgba(239,68,68,${confidence})`;
                              }
                            }
                            // Pitch type entries — scale font so they fit
                            const ptEntries  = topTypes(s.types, 4);
                            const ptCount    = ptEntries.length;
                            const ptFontSize = ptCount <= 1 ? 16 : ptCount === 2 ? 14 : 12;

                            return (
                              <div
                                key={`${row}-${col}`}
                                className="relative flex flex-col items-center justify-center select-none rounded-sm"
                                style={{
                                  background: cellBgColor,
                                  aspectRatio: '1', minHeight: 62,
                                  outline: isStrike ? '2px solid rgba(148,163,184,0.45)' : '1px solid rgba(255,255,255,0.06)',
                                }}
                              >
                                {/* Shadow cells: tint only, no content */}
                                {isShadowCell(row, col) ? null : s.total > 0 ? (
                                  <>
                                    {/* Total pitch count */}
                                    <span className="font-black leading-none text-white" style={{ fontSize: 16 }}>{s.total}</span>
                                    {/* Pitch types in their colours */}
                                    <div className="flex flex-wrap items-center justify-center mt-[3px] px-[2px]" style={{ gap: '2px 4px' }}>
                                      {ptEntries.map(([t, n]) => (
                                        <span key={t} className="font-black leading-none" style={{ fontSize: ptFontSize, color: PT_COLOR[t] ?? '#94a3b8' }}>
                                          {PT_LABEL[t] ?? t} {n}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                ) : (
                                  <span className="font-black" style={{ fontSize: 16, color: 'rgba(100,116,139,0.2)' }}>·</span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>



                    </div>{/* end grid column */}

                    {/* LHB bat — right side */}
                    {gridHand === 'L' && (
                      <div className="flex items-stretch py-[14px]">
                        <BatSVG />
                      </div>
                    )}

                  </div>{/* end grid + bat wrapper */}


                </div>

                {/* ── GAME PLAN ── */}
                <div>
                  <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-2">Game Plan</p>

                  {/* 4 action cards */}
                  <div className="grid grid-cols-2 gap-2 mb-2">

                    {/* Pitch Here — highest whiff rate: batter swings AND misses most */}
                    <div className="rounded-xl p-3 border" style={{ background: '#071a0f', borderColor: '#15803d' }}>
                      <p className="text-green-400 text-[11px] font-bold uppercase tracking-wide mb-1">🎯 Pitch Here</p>
                      {pitchHereZone ? (() => {
                        const bp = bestPitch(locStats[pitchHereZone.zone]?.typeMisses ?? {});
                        return (
                          <>
                            <p className="text-white font-black text-[22px] leading-none">{pitchHereZone.name}</p>
                            <p className="text-green-300 text-[13px] font-semibold mt-0.5">{pitchHereZone.whiffRate}% whiff · {pitchHereZone.swingPct}% sw</p>
                            {bp && <p className="text-green-500 text-[13px] font-bold mt-0.5">Best: {bp}</p>}
                            <p className="text-green-500 text-[13px] mt-0.5">{pitchHereZone.total} pitches</p>
                          </>
                        );
                      })() : <p className="text-green-900 text-[13px] mt-1">Not enough data</p>}
                    </div>

                    {/* K-Zone — WHAT PITCH gets him out? (pitch-type whiff leader) */}
                    <div className="rounded-xl p-3 border" style={{ background: '#0f0a1e', borderColor: '#5b21b6' }}>
                      <p className="text-violet-400 text-[11px] font-bold uppercase tracking-wide mb-1">⚡ K-Pitch</p>
                      {kPitchTop ? (
                        <>
                          <p className="text-white font-black text-[28px] leading-none">{kPitchTop[0]}</p>
                          <p className="text-violet-300 text-[13px] font-semibold mt-0.5">{kPitchTop[1]} whiffs · {kPitchMissPct}% miss/sw</p>
                          {kPitchBestZone && ZONE_NAMES[kPitchBestZone] && (
                            <p className="text-violet-500 text-[13px] mt-0.5">Best spot: {ZONE_NAMES[kPitchBestZone]}</p>
                          )}
                          <p className="text-violet-400 text-[13px] mt-0.5">{kPitchSwings[kPitchTop[0]] ?? 0} swings total</p>
                        </>
                      ) : <p className="text-violet-900 text-[13px] mt-1">Not enough swings</p>}
                    </div>

                    {/* Chase Bait — ball zone he chases most */}
                    <div className="rounded-xl p-3 border" style={{ background: '#1c1000', borderColor: '#b45309' }}>
                      <p className="text-amber-400 text-[11px] font-bold uppercase tracking-wide mb-1">🎣 Chase Bait</p>
                      {bestChaseDir && bestChaseDir.pct > 0 ? (
                        <>
                          <p className="text-white font-black text-[22px] leading-none">{bestChaseDir.d}</p>
                          <p className="text-amber-300 text-[13px] font-semibold mt-0.5">{bestChaseDir.pct}% chase</p>
                          <p className="text-amber-400 text-[13px] mt-0.5">{dirChase[bestChaseDir.d as Dir].total} ball pitches</p>
                        </>
                      ) : <p className="text-amber-900 text-[13px] mt-1">Not enough data</p>}
                    </div>

                    {/* Danger Zone — highest contact rate: DO NOT THROW HERE */}
                    <div className="rounded-xl p-3 border" style={{ background: '#1c0505', borderColor: '#b91c1c' }}>
                      <p className="text-red-400 text-[11px] font-bold uppercase tracking-wide mb-1">🚨 Danger Zone</p>
                      {dangerZone ? (() => {
                        const bp = bestPitch(locStats[dangerZone.zone]?.typeSwings ?? {});
                        return (
                          <>
                            <p className="text-white font-black text-[22px] leading-none">{dangerZone.name}</p>
                            <p className="text-red-300 text-[13px] font-semibold mt-0.5">{dangerZone.contactRate}% contact</p>
                            {bp && <p className="text-red-500 text-[13px] font-bold mt-0.5">Avoid: {bp}</p>}
                            <p className="text-red-500 text-[13px] mt-0.5">{dangerZone.contacts} contacts · {dangerZone.total} pitches</p>
                          </>
                        );
                      })() : <p className="text-red-900 text-[13px] mt-1">Not enough data</p>}
                    </div>
                  </div>

                  {/* Where He Does Damage — 3×3 strike zone (in-play counts) */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                    <p className="text-slate-500 text-[11px] uppercase tracking-widest mb-2.5 text-center">Where He Does Damage</p>
                    <div className="rounded-lg border border-slate-600 overflow-hidden">
                      <div className="grid grid-cols-3" style={{ gap: 0 }}>
                      {[1,2,3,4,5,6,7,8,9].map(n => {
                        const zk = `Z${n}`;
                        const s = locStats[zk] ?? { total:0, swings:0, contacts:0, inPlay:0, types:{} as Record<string,number>, typeSwings:{} as Record<string,number>, typeMisses:{} as Record<string,number> };
                        const ip = s.inPlay;
                        const conf = ip === 0 ? 0 : ip === 1 ? 0.30 : ip === 2 ? 0.50 : ip === 3 ? 0.70 : 0.90;
                        const bg = ip > 0 ? `rgba(234,179,8,${conf})` : '#0f172a';
                        const topType = Object.entries(s.types).sort((a,b) => b[1]-a[1])[0];
                        const isRightCol = n % 3 === 0;
                        const isBottomRow = n > 6;
                        return (
                          <div key={zk}
                            className="flex flex-col items-center justify-center select-none"
                            style={{ background: bg, aspectRatio:'1', minHeight: 58,
                              borderRight:  isRightCol  ? 'none' : '1px solid rgba(148,163,184,0.3)',
                              borderBottom: isBottomRow ? 'none' : '1px solid rgba(148,163,184,0.3)' }}>
                            {ip > 0 ? (
                              <>
                                <span className="text-white font-black leading-none" style={{ fontSize: 22 }}>{ip}</span>
                                {topType && (
                                  <span className="font-bold leading-none mt-0.5" style={{ fontSize: 13, color: PT_COLOR[topType[0]] ?? '#94a3b8' }}>
                                    {PT_LABEL[topType[0]] ?? topType[0]}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span style={{ fontSize: 14, color: 'rgba(100,116,139,0.2)' }}>·</span>
                            )}
                          </div>
                        );
                      })}
                      </div>
                    </div>
                    <p className="text-slate-700 text-[10px] text-center mt-2">balls put in play per zone · gold = damage</p>
                  </div>
                </div>

              </div>
            )}

            {/* ══════════ SPRAY VIEW ══════════ */}
            {view === 'spray' && (
              <div className="px-4">
                <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-3">Spray Chart — All Hits ({hits.length})</p>
                <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full rounded-2xl" style={{ background: '#0a140a' }}>
                  <path d={`M ${SHX} ${SHY} L ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY} Z`} fill="#7a5c3a" />
                  <path d={`M ${SHX} ${SHY} L ${SWARN_LX} ${SWARN_LY} A ${SR_WARN} ${SR_WARN} 0 0 1 ${SWARN_RX} ${SWARN_RY} Z`} fill="#173d10" />
                  <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#1e5216" />
                  <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#7a5230" opacity="0.45" />
                  <path d={`M ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY}`} fill="none" stroke="#e5a020" strokeWidth="2.5" opacity="0.85" />
                  <line x1={SHX} y1={SHY} x2={SLFPX} y2={SLFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
                  <line x1={SHX} y1={SHY} x2={SRFPX} y2={SRFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
                  <circle cx={SMX} cy={SMY} r="9" fill="#9B6E4C" opacity="0.8" />
                  <circle cx={SMX} cy={SMY} r="2" fill="#ccc" opacity="0.9" />
                  {([
                    [SHX, SHY, 'H', false],
                    [SB1X, SB1Y, '1', true],
                    [SB2X, SB2Y, '2', true],
                    [SB3X, SB3Y, '3', true],
                  ] as [number, number, string, boolean][]).map(([x, y, l, rotate]) => (
                    <g key={l}>
                      <rect x={x-9} y={y-9} width="18" height="18" fill={l==='H'?'#d4c5a0':'white'} rx="2" transform={rotate?`rotate(45 ${x} ${y})`:undefined} />
                      <text x={x} y={y+4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#0a140a">{l}</text>
                    </g>
                  ))}
                  {hits.length === 0
                    ? <text x={SW/2} y={SH/2} textAnchor="middle" fontSize="18" fill="#475569">No hit data yet</text>
                    : hits.map((p, i) => {
                        const x = (Number(p.hitX) / 100) * SW;
                        const y = (Number(p.hitY) / 100) * SH;
                        const c = hitDotColor(p.hitResult ?? '');
                        return (
                          <g key={i}>
                            <circle cx={x} cy={y} r="10" fill={c} opacity="0.8" />
                            <circle cx={x} cy={y} r="10" fill="none" stroke="white" strokeWidth="1.5" opacity="0.6" />
                          </g>
                        );
                      })
                  }
                </svg>
                <div className="mt-2 flex gap-4 flex-wrap items-center">
                  {[{color:'#14b8a6',label:'Hit'},{color:'#64748b',label:'Out'},{color:'#eab308',label:'HR'},{color:'#f59e0b',label:'Error'}].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                      <span className="text-slate-400 text-[13px]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
