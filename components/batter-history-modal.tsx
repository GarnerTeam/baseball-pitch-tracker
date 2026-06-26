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
  pitchZone?: string;      // "Strike" | "Ball"
  pitchLocation?: string;  // "Z1"–"Z9" | "B-Up" | "B-Low-In" | …
  action?: string;         // "Swing" | "Look"
  outcome?: string;        // "strike"|"ball"|"foul"|"foul-tip"|"in-play"|…
  hitResult?: string;
  hitType?: string;
  hitX?: number | string;
  hitY?: number | string;
  atBatNumber?: number | string;
}

interface CellStat { total: number; swings: number; contacts: number }

// ── Zone names (for quick-read cards) ────────────────────────────────────────
const ZONE_NAMES: Record<string, string> = {
  Z1:'Hi-In', Z2:'High',    Z3:'Hi-Out',
  Z4:'Mid-In', Z5:'Center', Z6:'Mid-Out',
  Z7:'Lo-In',  Z8:'Low',    Z9:'Lo-Out',
};

// ── Color helpers ─────────────────────────────────────────────────────────────
function swingBg(pct: number, total: number): string {
  if (total < 2) return '#1e293b';
  if (pct >= 75) return '#b91c1c';
  if (pct >= 55) return '#c2410c';
  if (pct >= 40) return '#a16207';
  if (pct >= 25) return '#1d4ed8';
  return '#1e3a8a';
}
function contactBg(pct: number, swings: number): string {
  if (swings < 1) return '#1e293b';
  if (pct >= 70) return '#b91c1c';
  if (pct >= 50) return '#c2410c';
  if (pct >= 35) return '#a16207';
  if (pct >= 20) return '#1d4ed8';
  return '#1e3a8a';
}
function textColor(bg: string): string {
  return bg === '#1e293b' ? '#475569' : bg === '#1e3a8a' ? '#93c5fd' : '#ffffff';
}

// ── 5×5 grid helpers ──────────────────────────────────────────────────────────
/**
 * Returns the pitchLocation key for a given (row, col) in the 5×5 grid.
 * Strike cells (1-3, 1-3) → "Z1"–"Z9"
 * Ball cells → the label that ballLocationLabel() would produce for this hand.
 */
function cellLocKey(row: number, col: number, h: 'R' | 'L'): string | null {
  // Strike zone inner 3×3
  if (row >= 1 && row <= 3 && col >= 1 && col <= 3) {
    return `Z${(row - 1) * 3 + (col - 1) + 1}`;
  }
  const r = h === 'R';
  const top = row === 0, bot = row === 4;
  const lft = col <= 1, rgt = col >= 3, mc = col === 2;

  if (top  && lft) return r ? 'B-Up-In'   : 'B-Up-Out';
  if (top  && mc)  return 'B-Up';
  if (top  && rgt) return r ? 'B-Up-Out'  : 'B-Up-In';

  if (bot  && lft) return r ? 'B-Low-In'  : 'B-Low-Out';
  if (bot  && mc)  return 'B-Low';
  if (bot  && rgt) return r ? 'B-Low-Out' : 'B-Low-In';

  if (lft && row === 1) return r ? 'B-In-Hi'  : 'B-Out-Hi';
  if (lft && row === 2) return r ? 'B-In'     : 'B-Out';
  if (lft && row === 3) return r ? 'B-In-Lo'  : 'B-Out-Lo';

  if (rgt && row === 1) return r ? 'B-Out-Hi' : 'B-In-Hi';
  if (rgt && row === 2) return r ? 'B-Out'    : 'B-In';
  if (rgt && row === 3) return r ? 'B-Out-Lo' : 'B-In-Lo';

  return null;
}

/** Short label shown inside ball-zone cells. */
function cellLabel(row: number, col: number, h: 'R' | 'L'): string {
  if (row >= 1 && row <= 3 && col >= 1 && col <= 3) return '';
  const r = h === 'R';
  const top = row === 0, bot = row === 4;
  const lft = col <= 1, rgt = col >= 3, mc = col === 2;

  if (top  && lft) return r ? 'Hi-In'  : 'Hi-Out';
  if (top  && mc)  return 'Hi';
  if (top  && rgt) return r ? 'Hi-Out' : 'Hi-In';

  if (bot  && lft) return r ? 'Lo-In'  : 'Lo-Out';
  if (bot  && mc)  return 'Lo';
  if (bot  && rgt) return r ? 'Lo-Out' : 'Lo-In';

  if (lft && row === 1) return r ? 'In-Hi'  : 'Out-Hi';
  if (lft && row === 2) return r ? 'In'     : 'Out';
  if (lft && row === 3) return r ? 'In-Lo'  : 'Out-Lo';

  if (rgt && row === 1) return r ? 'Out-Hi' : 'In-Hi';
  if (rgt && row === 2) return r ? 'Out'    : 'In';
  if (rgt && row === 3) return r ? 'Out-Lo' : 'In-Lo';

  return '';
}

// ── Spray chart SVG constants (same as lineup-panel) ─────────────────────────
const SW=400,SH=390,SHX=200,SHY=365;
const SR_FENCE=270,SR_WARN=220;
const SLFPX=9,SLFPY=174,SRFPX=391,SRFPY=174;
const SB1X=271,SB1Y=294,SB2X=200,SB2Y=224,SB3X=129,SB3Y=294;
const SMX=200,SMY=298;
const SWARN_LX=44,SWARN_LY=209,SWARN_RX=356,SWARN_RY=209;

function hitDotColor(r: string) {
  if (r === 'out')      return '#ef4444';
  if (r === 'home-run') return '#eab308';
  if (r === 'error')    return '#f97316';
  return '#22c55e';
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  playerName: string;
  playerNumber: string;
  webhookUrl: string;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function BatterHistoryModal({ playerName, playerNumber, webhookUrl, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pitches, setPitches] = useState<PitchRow[]>([]);
  const [view, setView] = useState<'heatmap' | 'spray'>('heatmap');
  const [mapMode, setMapMode] = useState<'swing' | 'contact'>('swing');

  // ── Fetch history ──────────────────────────────────────────────────────────
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
        setPitches(d.pitches ?? []);
      })
      .catch(e => setFetchError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [playerName, playerNumber, webhookUrl]);

  // ── Determine predominant batter hand ─────────────────────────────────────
  const handCounts = { R: 0, L: 0 };
  for (const p of pitches) {
    if (p.batterHand === 'R') handCounts.R++;
    else if (p.batterHand === 'L') handCounts.L++;
  }
  const gridHand: 'R' | 'L' = handCounts.L > handCounts.R ? 'L' : 'R';

  // ── Build per-location stats ───────────────────────────────────────────────
  const locStats: Record<string, CellStat> = {};
  let totalSwings = 0, totalPitches = 0, ballPitches = 0, ballSwings = 0;

  for (const p of pitches) {
    const loc = (p.pitchLocation ?? '').trim();
    if (!loc) continue;
    if (!locStats[loc]) locStats[loc] = { total: 0, swings: 0, contacts: 0 };
    const isSwing   = p.action === 'Swing';
    const isContact = isSwing && ['foul','foul-tip','in-play'].includes(p.outcome ?? '');
    locStats[loc].total++;
    if (isSwing)   { locStats[loc].swings++;   totalSwings++; }
    if (isContact)   locStats[loc].contacts++;
    totalPitches++;
    if (p.pitchZone === 'Ball') { ballPitches++; if (isSwing) ballSwings++; }
  }

  // ── Quick-read cards from strike zones ────────────────────────────────────
  const rankedZones = Object.keys(ZONE_NAMES)
    .map(z => {
      const s = locStats[z] ?? { total: 0, swings: 0, contacts: 0 };
      return {
        zone: z,
        name: ZONE_NAMES[z],
        ...s,
        swingPct: s.total  >= 3 ? Math.round(s.swings / s.total  * 100) : -1,
        missPct:  s.swings >= 2 ? Math.round((s.swings - s.contacts) / s.swings * 100) : -1,
      };
    })
    .filter(z => z.swingPct >= 0);

  const hotZone  = [...rankedZones].sort((a,b) => b.swingPct - a.swingPct)[0];
  const coldZone = [...rankedZones].sort((a,b) => a.swingPct - b.swingPct)[0];
  const kZone    = [...rankedZones].filter(z => z.missPct >= 0).sort((a,b) => b.missPct - a.missPct)[0];

  const uniqueGames      = new Set(pitches.map(p => p.gameId).filter(Boolean)).size;
  const overallSwingPct  = totalPitches > 0 ? Math.round(totalSwings / totalPitches * 100) : 0;
  const chaseRate        = ballPitches  > 0 ? Math.round(ballSwings  / ballPitches  * 100) : 0;

  // ── Spray hits ────────────────────────────────────────────────────────────
  const hits = pitches.filter(p =>
    p.hitResult &&
    p.hitX !== '' && p.hitX !== undefined && !isNaN(Number(p.hitX)) &&
    p.hitY !== '' && p.hitY !== undefined && !isNaN(Number(p.hitY))
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-[26px] leading-none w-8 flex-shrink-0">←</button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-[20px] leading-tight truncate">
            #{playerNumber} {playerName}
          </p>
          <p className="text-slate-500 text-[13px]">
            {loading ? 'Loading…' : `${totalPitches} pitches · ${uniqueGames} game${uniqueGames !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-700 flex-shrink-0">
          <button
            onClick={() => setView('heatmap')}
            className={`px-3 py-1.5 text-[14px] font-semibold ${view === 'heatmap' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            🗺 Map
          </button>
          <button
            onClick={() => setView('spray')}
            className={`px-3 py-1.5 text-[14px] font-semibold ${view === 'spray' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            🏟 Field
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-[16px]">Fetching history from spreadsheet…</p>
          </div>
        )}

        {/* Error */}
        {!loading && fetchError && (
          <div className="m-4 p-4 bg-red-950 border border-red-800 rounded-xl space-y-2">
            <p className="text-red-300 font-bold text-[18px]">Could not load history</p>
            <p className="text-red-400 text-[15px]">{fetchError}</p>
            <p className="text-slate-500 text-[13px] pt-1 border-t border-red-900">
              Make sure your Apps Script has been updated with the <code className="bg-slate-800 px-1 rounded">doGet()</code> function and redeployed as a new version.
            </p>
          </div>
        )}

        {/* Empty */}
        {!loading && !fetchError && totalPitches === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-slate-400 text-[18px]">No history found</p>
            <p className="text-slate-600 text-[15px]">for {playerName} #{playerNumber}</p>
          </div>
        )}

        {/* Data */}
        {!loading && !fetchError && totalPitches > 0 && (
          <div className="pb-8 space-y-4">

            {/* ── Overall stats strip ── */}
            <div className="grid grid-cols-3 gap-0 border-b border-slate-800">
              {[
                { label: 'Swing%',  value: `${overallSwingPct}%` },
                { label: 'Chase%',  value: `${chaseRate}%` },
                { label: 'Pitches', value: totalPitches },
              ].map(({ label, value }) => (
                <div key={label} className="py-3 text-center border-r border-slate-800 last:border-r-0">
                  <p className="text-white font-black text-[22px] leading-none">{value}</p>
                  <p className="text-slate-500 text-[12px] mt-0.5 uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>

            {/* ── Quick read cards ── */}
            <div className="px-4">
              <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-2">Quick Read — Game Time</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl p-3 text-center border" style={{ background: '#3b0000', borderColor: '#7f1d1d' }}>
                  <p className="text-[11px] text-red-400 uppercase tracking-wide mb-1">🔥 Swings</p>
                  {hotZone ? (
                    <>
                      <p className="text-white font-black text-[24px] leading-none">{hotZone.swingPct}%</p>
                      <p className="text-red-300 text-[13px] font-semibold mt-0.5">{hotZone.name}</p>
                      <p className="text-red-700 text-[11px]">{hotZone.total}p</p>
                    </>
                  ) : <p className="text-red-800 text-[13px] mt-1">—</p>}
                </div>
                <div className="rounded-xl p-3 text-center border" style={{ background: '#0c1a2e', borderColor: '#1e3a5f' }}>
                  <p className="text-[11px] text-blue-400 uppercase tracking-wide mb-1">👁 Takes</p>
                  {coldZone ? (
                    <>
                      <p className="text-white font-black text-[24px] leading-none">{coldZone.swingPct}%</p>
                      <p className="text-blue-300 text-[13px] font-semibold mt-0.5">{coldZone.name}</p>
                      <p className="text-blue-800 text-[11px]">{coldZone.total}p</p>
                    </>
                  ) : <p className="text-blue-800 text-[13px] mt-1">—</p>}
                </div>
                <div className="rounded-xl p-3 text-center border" style={{ background: '#1a0a2e', borderColor: '#4a1d8a' }}>
                  <p className="text-[11px] text-purple-400 uppercase tracking-wide mb-1">⚡ K-Zone</p>
                  {kZone ? (
                    <>
                      <p className="text-white font-black text-[24px] leading-none">{kZone.missPct}%</p>
                      <p className="text-purple-300 text-[13px] font-semibold mt-0.5">{kZone.name}</p>
                      <p className="text-purple-800 text-[11px]">miss rate</p>
                    </>
                  ) : <p className="text-purple-800 text-[13px] mt-1">Not enough swings</p>}
                </div>
              </div>
            </div>

            {/* ══════════════════════════ HEAT MAP VIEW ══════════════════════════ */}
            {view === 'heatmap' && (
              <div className="px-4 space-y-4">

                {/* Mode toggle */}
                <div className="flex items-center justify-between">
                  <p className="text-slate-500 text-[12px] uppercase tracking-widest">Zone Heat Map</p>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600 text-[11px] bg-slate-800 px-2 py-0.5 rounded">
                      {gridHand}HB view
                    </span>
                    <div className="flex rounded-lg overflow-hidden border border-slate-700">
                      <button
                        onClick={() => setMapMode('swing')}
                        className={`px-3 py-1 text-[13px] font-semibold transition-colors ${mapMode === 'swing' ? 'bg-orange-700 text-white' : 'bg-slate-800 text-slate-400'}`}
                      >
                        Swing %
                      </button>
                      <button
                        onClick={() => setMapMode('contact')}
                        className={`px-3 py-1 text-[13px] font-semibold transition-colors ${mapMode === 'contact' ? 'bg-green-700 text-white' : 'bg-slate-800 text-slate-400'}`}
                      >
                        Contact %
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── 5×5 grid ── */}
                <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800">

                  {/* Axis labels: top row outside */}
                  <div className="grid mb-0.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                    {[
                      gridHand === 'R' ? 'In' : 'Out',
                      '',
                      'High',
                      '',
                      gridHand === 'R' ? 'Out' : 'In',
                    ].map((lbl, i) => (
                      <p key={i} className="text-center text-slate-600 font-semibold leading-none" style={{ fontSize: 10 }}>{lbl}</p>
                    ))}
                  </div>

                  {/* Grid */}
                  <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    {Array.from({ length: 5 }).flatMap((_, row) =>
                      Array.from({ length: 5 }).map((_, col) => {
                        const isStrike = row >= 1 && row <= 3 && col >= 1 && col <= 3;
                        const zn = isStrike ? (row - 1) * 3 + (col - 1) + 1 : null;
                        const key = cellLocKey(row, col, gridHand);
                        const s = key ? (locStats[key] ?? { total: 0, swings: 0, contacts: 0 }) : { total: 0, swings: 0, contacts: 0 };

                        // Always compute pct — show for any cell with ≥1 pitch
                        const swingPct  = s.total  > 0 ? Math.round(s.swings   / s.total  * 100) : null;
                        const contactPct = s.swings > 0 ? Math.round(s.contacts / s.swings * 100) : null;
                        const pct = mapMode === 'swing' ? swingPct : contactPct;
                        const sampleN = mapMode === 'swing' ? s.total : s.swings;

                        const bg = mapMode === 'swing'
                          ? swingBg(swingPct ?? 0, s.total)
                          : contactBg(contactPct ?? 0, s.swings);
                        const fg = textColor(bg);
                        const lbl = cellLabel(row, col, gridHand);

                        return (
                          <div
                            key={`${row}-${col}`}
                            className="flex flex-col items-center justify-center relative select-none rounded-sm"
                            style={{
                              background: bg,
                              color: fg,
                              aspectRatio: '1',
                              minHeight: 58,
                              outline: isStrike ? '1.5px solid rgba(148,163,184,0.35)' : 'none',
                            }}
                          >
                            {/* Zone number — top-left micro text */}
                            {zn && (
                              <span className="absolute top-[2px] left-[3px] font-bold leading-none opacity-40" style={{ fontSize: 9 }}>
                                {zn}
                              </span>
                            )}
                            {/* Ball zone label — top center */}
                            {!isStrike && lbl && (
                              <span className="absolute top-[2px] inset-x-0 text-center leading-none opacity-40" style={{ fontSize: 8 }}>
                                {lbl}
                              </span>
                            )}

                            {s.total > 0 ? (
                              <>
                                {/* Count — primary large number */}
                                <span className="font-black leading-none" style={{ fontSize: 20 }}>
                                  {s.total}
                                </span>
                                {/* Swing % or Contact % — secondary line */}
                                <span className="font-bold leading-none mt-[2px]" style={{ fontSize: 13 }}>
                                  {pct !== null ? `${pct}%` : mapMode === 'swing' ? '—' : 'n/a'}
                                </span>
                              </>
                            ) : (
                              <span className="font-black opacity-15" style={{ fontSize: 14 }}>—</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Axis labels: bottom */}
                  <div className="grid mt-0.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                    {[
                      gridHand === 'R' ? 'In' : 'Out',
                      '',
                      'Low',
                      '',
                      gridHand === 'R' ? 'Out' : 'In',
                    ].map((lbl, i) => (
                      <p key={i} className="text-center text-slate-600 font-semibold leading-none" style={{ fontSize: 10 }}>{lbl}</p>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
                    {mapMode === 'swing' ? (
                      <>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#1e3a8a'}} /><span className="text-slate-500 text-[11px]">Takes (&lt;25%)</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#a16207'}} /><span className="text-slate-500 text-[11px]">Borderline</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#b91c1c'}} /><span className="text-slate-500 text-[11px]">Attacks (&gt;75%)</span></div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#1e3a8a'}} /><span className="text-slate-500 text-[11px]">Misses (&lt;20%)</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#a16207'}} /><span className="text-slate-500 text-[11px]">50% contact</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#b91c1c'}} /><span className="text-slate-500 text-[11px]">Solid (&gt;70%)</span></div>
                      </>
                    )}
                  </div>

                  {/* Strike zone outline note */}
                  <p className="text-center text-slate-700 text-[10px] mt-2">
                    ░ outlined = strike zone · outer cells = ball zones
                  </p>
                </div>

                {/* ── Out-of-zone chase summary ── */}
                <div>
                  <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-2">Ball-Zone Chase Rate</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { dir: 'High',   locs: ['B-Up','B-Up-In','B-Up-Out'] },
                      { dir: 'Low',    locs: ['B-Low','B-Low-In','B-Low-Out'] },
                      { dir: gridHand === 'R' ? 'Inside' : 'Outside',  locs: ['B-In-Hi','B-In','B-In-Lo','B-Out-Hi','B-Out','B-Out-Lo'].filter(l => (gridHand === 'R') === l.startsWith('B-In')) },
                      { dir: gridHand === 'R' ? 'Outside' : 'Inside', locs: ['B-In-Hi','B-In','B-In-Lo','B-Out-Hi','B-Out','B-Out-Lo'].filter(l => (gridHand === 'R') !== l.startsWith('B-In')) },
                    ] as { dir: string; locs: string[] }[]).map(({ dir, locs }) => {
                      const agg = locs.reduce((acc, l) => {
                        const s = locStats[l];
                        if (s) { acc.total += s.total; acc.swings += s.swings; }
                        return acc;
                      }, { total: 0, swings: 0 });
                      const pct = agg.total >= 2 ? Math.round(agg.swings / agg.total * 100) : null;
                      const hot = pct !== null && pct >= 35;
                      return (
                        <div key={dir} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 flex items-center justify-between">
                          <span className="text-slate-400 text-[16px]">{dir}</span>
                          <div className="text-right">
                            <p className={`font-bold text-[20px] leading-none ${hot ? 'text-orange-400' : 'text-blue-400'}`}>
                              {pct !== null ? `${pct}%` : '—'}
                            </p>
                            <p className="text-slate-600 text-[11px]">{agg.total}p</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <span className="text-slate-300 text-[16px] font-medium">Overall Chase</span>
                    <span className={`font-bold text-[20px] ${chaseRate >= 35 ? 'text-orange-400' : 'text-blue-400'}`}>
                      {chaseRate > 0 ? `${chaseRate}%` : '—'}
                    </span>
                  </div>
                </div>

              </div>
            )}

            {/* ══════════════════════════ SPRAY VIEW ══════════════════════════ */}
            {view === 'spray' && (
              <div className="px-4">
                <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-3">
                  Spray Chart — All Hits ({hits.length})
                </p>
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
                      <rect x={x-9} y={y-9} width="18" height="18"
                        fill={l==='H'?'#d4c5a0':'white'} rx="2"
                        transform={rotate?`rotate(45 ${x} ${y})`:undefined} />
                      <text x={x} y={y+4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#0a140a">{l}</text>
                    </g>
                  ))}
                  {hits.length === 0 ? (
                    <text x={SW/2} y={SH/2} textAnchor="middle" fontSize="18" fill="#475569">No hit data yet</text>
                  ) : (
                    hits.map((p, i) => {
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
                  )}
                </svg>
                <div className="mt-2 flex gap-4 flex-wrap items-center">
                  {[
                    { color:'#22c55e', label:'Hit' },
                    { color:'#ef4444', label:'Out' },
                    { color:'#eab308', label:'HR' },
                    { color:'#f97316', label:'Error' },
                  ].map(({ color, label }) => (
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
