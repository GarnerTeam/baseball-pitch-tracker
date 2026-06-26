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

interface CellStat { total: number; swings: number; contacts: number }

// ── Zone names ────────────────────────────────────────────────────────────────
const ZONE_NAMES: Record<string, string> = {
  Z1:'Hi-In', Z2:'High',    Z3:'Hi-Out',
  Z4:'Mid-In', Z5:'Center', Z6:'Mid-Out',
  Z7:'Lo-In',  Z8:'Low',    Z9:'Lo-Out',
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

// ── Spray chart SVG constants ─────────────────────────────────────────────────
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

  // ── Predominant hand ──────────────────────────────────────────────────────
  const handCounts = { R: 0, L: 0 };
  for (const p of pitches) {
    if (p.batterHand === 'R') handCounts.R++;
    else if (p.batterHand === 'L') handCounts.L++;
  }
  const gridHand: 'R' | 'L' = handCounts.L > handCounts.R ? 'L' : 'R';

  // ── Build per-location stats (normalize Left/Right → In/Out) ──────────────
  const locStats: Record<string, CellStat> = {};
  let totalPitches = 0, totalSwings = 0, ballPitches = 0, ballSwings = 0;

  for (const p of pitches) {
    const rawLoc = (p.pitchLocation ?? '').trim();
    if (!rawLoc) continue;
    const pitchHand = (p.batterHand === 'L' || p.batterHand === 'R') ? p.batterHand : gridHand;
    const loc = normalizeLocation(rawLoc, pitchHand);

    if (!locStats[loc]) locStats[loc] = { total: 0, swings: 0, contacts: 0 };
    const isSwing   = p.action === 'Swing';
    const isContact = isSwing && ['foul','foul-tip','in-play'].includes(p.outcome ?? '');
    locStats[loc].total++;
    if (isSwing)   { locStats[loc].swings++;   totalSwings++; }
    if (isContact)   locStats[loc].contacts++;
    totalPitches++;
    if (p.pitchZone === 'Ball') { ballPitches++; if (isSwing) ballSwings++; }
  }

  // ── Quick-read (strike zone only, min 2 pitches) ──────────────────────────
  const rankedZones = Object.keys(ZONE_NAMES)
    .map(z => {
      const s = locStats[z] ?? { total: 0, swings: 0, contacts: 0 };
      return {
        zone: z, name: ZONE_NAMES[z], ...s,
        swingPct: s.total  >= 2 ? Math.round(s.swings   / s.total  * 100) : -1,
        missPct:  s.swings >= 2 ? Math.round((s.swings - s.contacts) / s.swings * 100) : -1,
      };
    });

  const zonesWithData  = rankedZones.filter(z => z.swingPct >= 0);
  const hotZone  = [...zonesWithData].sort((a,b) => b.swingPct - a.swingPct)[0];
  const coldZone = [...zonesWithData].sort((a,b) => a.swingPct - b.swingPct)[0];
  const kZone    = rankedZones.filter(z => z.missPct >= 0).sort((a,b) => b.missPct - a.missPct)[0];

  // ── Ball-zone directional chase ───────────────────────────────────────────
  type Dir = 'High' | 'Low' | 'In' | 'Out';
  const dirKeys: Record<Dir, string[]> = {
    High: ['B-Up', 'B-Up-In', 'B-Up-Out'],
    Low:  ['B-Low', 'B-Low-In', 'B-Low-Out'],
    In:   gridHand === 'R'
            ? ['B-In-Hi', 'B-In', 'B-In-Lo']
            : ['B-Out-Hi', 'B-Out', 'B-Out-Lo'],
    Out:  gridHand === 'R'
            ? ['B-Out-Hi', 'B-Out', 'B-Out-Lo']
            : ['B-In-Hi', 'B-In', 'B-In-Lo'],
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
  const overallSwingPct = totalPitches > 0 ? Math.round(totalSwings / totalPitches * 100) : 0;
  const chaseRate       = ballPitches  > 0 ? Math.round(ballSwings  / ballPitches  * 100) : 0;

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

            {/* ══════════ HEAT MAP ══════════ */}
            {view === 'heatmap' && (
              <div className="px-4 space-y-5">

                {/* 5×5 grid */}
                <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800">
                  <p className="text-slate-500 text-[11px] uppercase tracking-widest mb-2 text-center">Swing% per Zone — count / swing%</p>

                  {/* Top axis */}
                  <div className="grid mb-0.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                    {[gridHand === 'R' ? 'In' : 'Out', '', 'High', '', gridHand === 'R' ? 'Out' : 'In'].map((l, i) => (
                      <p key={i} className="text-center text-slate-600 font-semibold leading-none" style={{ fontSize: 10 }}>{l}</p>
                    ))}
                  </div>

                  {/* Grid */}
                  <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    {Array.from({ length: 5 }).flatMap((_, row) =>
                      Array.from({ length: 5 }).map((_, col) => {
                        const isStrike = row >= 1 && row <= 3 && col >= 1 && col <= 3;
                        const zn  = isStrike ? (row - 1) * 3 + (col - 1) + 1 : null;
                        const key = cellLocKey(row, col, gridHand);
                        const s   = key ? (locStats[key] ?? { total:0, swings:0, contacts:0 }) : { total:0, swings:0, contacts:0 };
                        const swPct = s.total > 0 ? Math.round(s.swings / s.total * 100) : null;
                        const bg  = swingBg(swPct ?? 0, s.total);
                        const fg  = textColor(bg);
                        const lbl = cellLabel(row, col, gridHand);

                        return (
                          <div
                            key={`${row}-${col}`}
                            className="flex flex-col items-center justify-center relative select-none rounded-sm"
                            style={{
                              background: bg, color: fg,
                              aspectRatio: '1', minHeight: 58,
                              outline: isStrike ? '1.5px solid rgba(148,163,184,0.35)' : 'none',
                            }}
                          >
                            {zn && <span className="absolute top-[2px] left-[3px] font-bold leading-none opacity-40" style={{ fontSize: 9 }}>{zn}</span>}
                            {!isStrike && lbl && <span className="absolute top-[2px] inset-x-0 text-center leading-none opacity-40" style={{ fontSize: 8 }}>{lbl}</span>}

                            {s.total > 0 ? (
                              <>
                                <span className="font-black leading-none" style={{ fontSize: 20 }}>{s.total}</span>
                                <span className="font-bold leading-none mt-[2px]" style={{ fontSize: 13 }}>
                                  {swPct !== null ? `${swPct}%` : '—'}
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

                  {/* Bottom axis */}
                  <div className="grid mt-0.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                    {[gridHand === 'R' ? 'In' : 'Out', '', 'Low', '', gridHand === 'R' ? 'Out' : 'In'].map((l, i) => (
                      <p key={i} className="text-center text-slate-600 font-semibold leading-none" style={{ fontSize: 10 }}>{l}</p>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#1e3a8a'}} /><span className="text-slate-500 text-[11px]">Takes (&lt;20%)</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#a16207'}} /><span className="text-slate-500 text-[11px]">40–55%</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{background:'#b91c1c'}} /><span className="text-slate-500 text-[11px]">Attacks (&gt;75%)</span></div>
                  </div>
                  <p className="text-center text-slate-700 text-[10px] mt-1.5">outlined = strike zone · outer = ball zone</p>
                </div>

                {/* ── GAME PLAN ── */}
                <div>
                  <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-2">Game Plan</p>

                  {/* 4 action cards */}
                  <div className="grid grid-cols-2 gap-2 mb-2">

                    {/* Pitch Here */}
                    <div className="rounded-xl p-3 border" style={{ background: '#0a2a12', borderColor: '#166534' }}>
                      <p className="text-green-400 text-[11px] font-bold uppercase tracking-wide mb-1">🎯 Pitch Here</p>
                      {hotZone ? (
                        <>
                          <p className="text-white font-black text-[22px] leading-none">{hotZone.name}</p>
                          <p className="text-green-300 text-[13px] font-semibold mt-0.5">{hotZone.swingPct}% swing</p>
                          <p className="text-green-800 text-[11px]">{hotZone.total} pitches</p>
                        </>
                      ) : <p className="text-green-900 text-[13px] mt-1">Not enough data</p>}
                    </div>

                    {/* K-Zone */}
                    <div className="rounded-xl p-3 border" style={{ background: '#1a0a2e', borderColor: '#4a1d8a' }}>
                      <p className="text-purple-400 text-[11px] font-bold uppercase tracking-wide mb-1">⚡ K-Zone</p>
                      {kZone ? (
                        <>
                          <p className="text-white font-black text-[22px] leading-none">{kZone.name}</p>
                          <p className="text-purple-300 text-[13px] font-semibold mt-0.5">{kZone.missPct}% miss</p>
                          <p className="text-purple-800 text-[11px]">{kZone.swings} swings</p>
                        </>
                      ) : <p className="text-purple-900 text-[13px] mt-1">Not enough swings</p>}
                    </div>

                    {/* Chase bait */}
                    <div className="rounded-xl p-3 border" style={{ background: '#1c1000', borderColor: '#78350f' }}>
                      <p className="text-amber-400 text-[11px] font-bold uppercase tracking-wide mb-1">🎣 Chase Bait</p>
                      {bestChaseDir && bestChaseDir.pct > 0 ? (
                        <>
                          <p className="text-white font-black text-[22px] leading-none">{bestChaseDir.d}</p>
                          <p className="text-amber-300 text-[13px] font-semibold mt-0.5">{bestChaseDir.pct}% chase</p>
                          <p className="text-amber-800 text-[11px]">{dirChase[bestChaseDir.d as Dir].total} pitches</p>
                        </>
                      ) : <p className="text-amber-900 text-[13px] mt-1">Not enough data</p>}
                    </div>

                    {/* Takes */}
                    <div className="rounded-xl p-3 border" style={{ background: '#0c1a2e', borderColor: '#1e3a5f' }}>
                      <p className="text-blue-400 text-[11px] font-bold uppercase tracking-wide mb-1">👁 Takes</p>
                      {coldZone ? (
                        <>
                          <p className="text-white font-black text-[22px] leading-none">{coldZone.name}</p>
                          <p className="text-blue-300 text-[13px] font-semibold mt-0.5">{coldZone.swingPct}% swing</p>
                          <p className="text-blue-800 text-[11px]">{coldZone.total} pitches</p>
                        </>
                      ) : <p className="text-blue-900 text-[13px] mt-1">Not enough data</p>}
                    </div>
                  </div>

                  {/* Hit zones — where he does damage */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                    <p className="text-slate-600 text-[10px] uppercase tracking-widest mb-2 text-center">Where He Does Damage (Hits)</p>
                    <div className="grid grid-cols-4 gap-0">
                      {(['High','Low','In','Out'] as Dir[]).map((dir, i) => {
                        const { hits, inPlay } = hitDirs[dir];
                        const hitPct = inPlay >= 2 ? Math.round(hits / inPlay * 100) : null;
                        const danger = hits >= 2;
                        const arrows: Record<Dir, string> = { High:'↑', Low:'↓', In:'←', Out:'→' };
                        return (
                          <div key={dir} className={`text-center ${i < 3 ? 'border-r border-slate-800' : ''}`}>
                            <p className={`font-black text-[20px] leading-none ${danger ? 'text-green-400' : 'text-slate-500'}`}>
                              {hits > 0 ? hits : '—'}
                            </p>
                            <p className="text-slate-500 text-[11px] mt-0.5">{arrows[dir]} {dir}</p>
                            <p className="text-slate-700 text-[10px]">
                              {hitPct !== null ? `${hitPct}% BA` : inPlay > 0 ? `${inPlay} AB` : '0 AB'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
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
                  {[{color:'#22c55e',label:'Hit'},{color:'#ef4444',label:'Out'},{color:'#eab308',label:'HR'},{color:'#f97316',label:'Error'}].map(({ color, label }) => (
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
