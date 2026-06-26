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
  pitchLocation?: string;  // "Z1"–"Z9" | "B-Up" | "B-Low" | "B-In-Hi" | …
  action?: string;         // "Swing" | "Look"
  outcome?: string;        // "strike"|"ball"|"foul"|"foul-tip"|"in-play"|"swinging-strike"|"strikeout"|"walk"
  hitResult?: string;
  hitType?: string;
  hitX?: number | string;
  hitY?: number | string;
  atBatNumber?: number | string;
}

interface ZoneStat { total: number; swings: number; contacts: number }
type BallDir = 'UP' | 'LOW' | 'IN' | 'OUT';

// ── Zone mappings ─────────────────────────────────────────────────────────────
const ZONES = ['Z1','Z2','Z3','Z4','Z5','Z6','Z7','Z8','Z9'] as const;
const ZONE_NAMES: Record<string, string> = {
  Z1:'Hi-In', Z2:'High',    Z3:'Hi-Out',
  Z4:'Mid-In', Z5:'Center', Z6:'Mid-Out',
  Z7:'Lo-In',  Z8:'Low',    Z9:'Lo-Out',
};

// ── Color helpers ─────────────────────────────────────────────────────────────
function swingBg(pct: number, total: number): string {
  if (total < 3) return '#1e293b';
  if (pct >= 75) return '#b91c1c';
  if (pct >= 55) return '#c2410c';
  if (pct >= 40) return '#a16207';
  if (pct >= 25) return '#1d4ed8';
  return '#1e3a8a';
}
function contactBg(pct: number, swings: number): string {
  if (swings < 2) return '#1e293b';
  if (pct >= 70) return '#b91c1c';
  if (pct >= 50) return '#c2410c';
  if (pct >= 35) return '#a16207';
  if (pct >= 20) return '#1d4ed8';
  return '#1e3a8a';
}
function textColor(bg: string): string {
  return bg === '#1e293b' ? '#475569' : '#ffffff';
}

// ── Ball direction classifier ────────────────────────────────────────────────
function ballDir(loc: string): BallDir | null {
  if (!loc.startsWith('B-')) return null;
  const s = loc.slice(2).toLowerCase();
  if (s.includes('up') || s.includes('hi')) return 'UP';
  if (s.includes('low') || s.includes('lo')) return 'LOW';
  if (s.includes('in')) return 'IN';
  if (s.includes('out')) return 'OUT';
  return null;
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

  // ── Compute stats ──────────────────────────────────────────────────────────
  const zoneStats: Record<string, ZoneStat> = {};
  ZONES.forEach(z => { zoneStats[z] = { total: 0, swings: 0, contacts: 0 }; });
  const bStats: Record<BallDir, ZoneStat> = {
    UP:  { total:0, swings:0, contacts:0 },
    LOW: { total:0, swings:0, contacts:0 },
    IN:  { total:0, swings:0, contacts:0 },
    OUT: { total:0, swings:0, contacts:0 },
  };

  let totalSwings = 0, totalBalls = 0, ballSwings = 0;

  for (const p of pitches) {
    const loc = (p.pitchLocation ?? '').trim();
    const isSwing   = p.action === 'Swing';
    const isContact = isSwing && ['foul','foul-tip','in-play'].includes(p.outcome ?? '');
    if (isSwing) totalSwings++;
    if (p.pitchZone === 'Ball') { totalBalls++; if (isSwing) ballSwings++; }

    if (zoneStats[loc]) {
      zoneStats[loc].total++;
      if (isSwing)   zoneStats[loc].swings++;
      if (isContact) zoneStats[loc].contacts++;
    } else {
      const d = ballDir(loc);
      if (d) {
        bStats[d].total++;
        if (isSwing)   bStats[d].swings++;
        if (isContact) bStats[d].contacts++;
      }
    }
  }

  const uniqueGames = new Set(pitches.map(p => p.gameId).filter(Boolean)).size;
  const overallSwingPct = pitches.length ? Math.round((totalSwings / pitches.length) * 100) : 0;
  const chaseRate = totalBalls > 0 ? Math.round((ballSwings / totalBalls) * 100) : 0;

  // Quick insight computations (min 3 pitches for swing, min 2 swings for K-zone)
  const rankedZones = ZONES
    .map(z => {
      const s = zoneStats[z];
      return {
        zone: z,
        name: ZONE_NAMES[z],
        ...s,
        swingPct:   s.total >= 3 ? Math.round((s.swings / s.total) * 100) : -1,
        missPct:    s.swings >= 2 ? Math.round(((s.swings - s.contacts) / s.swings) * 100) : -1,
        contactPct: s.swings >= 2 ? Math.round((s.contacts / s.swings) * 100) : -1,
      };
    })
    .filter(z => z.swingPct >= 0);

  const hotZone  = [...rankedZones].sort((a,b) => b.swingPct - a.swingPct)[0];
  const coldZone = [...rankedZones].sort((a,b) => a.swingPct - b.swingPct)[0];
  const kZone    = [...rankedZones].filter(z => z.missPct >= 0).sort((a,b) => b.missPct - a.missPct)[0];

  // Spray hits
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
            {loading ? 'Loading…' : `${pitches.length} pitches · ${uniqueGames} game${uniqueGames !== 1 ? 's' : ''}`}
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
        {!loading && !fetchError && pitches.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-slate-400 text-[18px]">No history found</p>
            <p className="text-slate-600 text-[15px]">for {playerName} #{playerNumber}</p>
          </div>
        )}

        {/* Data */}
        {!loading && !fetchError && pitches.length > 0 && (
          <div className="pb-8 space-y-4">

            {/* ── Overall stats strip ── */}
            <div className="grid grid-cols-3 gap-0 border-b border-slate-800">
              {[
                { label: 'Swing%', value: `${overallSwingPct}%` },
                { label: 'Chase%', value: `${chaseRate}%` },
                { label: 'Pitches', value: pitches.length },
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
                {/* Hot zone */}
                <div className="rounded-xl p-3 text-center border" style={{ background: '#3b0000', borderColor: '#7f1d1d' }}>
                  <p className="text-[11px] text-red-400 uppercase tracking-wide mb-1">🔥 Swings</p>
                  {hotZone ? (
                    <>
                      <p className="text-white font-black text-[24px] leading-none">{hotZone.swingPct}%</p>
                      <p className="text-red-300 text-[13px] font-semibold mt-0.5">{hotZone.name}</p>
                      <p className="text-red-700 text-[11px]">{hotZone.total}p</p>
                    </>
                  ) : (
                    <p className="text-red-800 text-[13px] mt-1">—</p>
                  )}
                </div>

                {/* Cold zone */}
                <div className="rounded-xl p-3 text-center border" style={{ background: '#0c1a2e', borderColor: '#1e3a5f' }}>
                  <p className="text-[11px] text-blue-400 uppercase tracking-wide mb-1">👁 Takes</p>
                  {coldZone ? (
                    <>
                      <p className="text-white font-black text-[24px] leading-none">{coldZone.swingPct}%</p>
                      <p className="text-blue-300 text-[13px] font-semibold mt-0.5">{coldZone.name}</p>
                      <p className="text-blue-800 text-[11px]">{coldZone.total}p</p>
                    </>
                  ) : (
                    <p className="text-blue-800 text-[13px] mt-1">—</p>
                  )}
                </div>

                {/* K zone */}
                <div className="rounded-xl p-3 text-center border" style={{ background: '#1a0a2e', borderColor: '#4a1d8a' }}>
                  <p className="text-[11px] text-purple-400 uppercase tracking-wide mb-1">⚡ K-Zone</p>
                  {kZone ? (
                    <>
                      <p className="text-white font-black text-[24px] leading-none">{kZone.missPct}%</p>
                      <p className="text-purple-300 text-[13px] font-semibold mt-0.5">{kZone.name}</p>
                      <p className="text-purple-800 text-[11px]">miss rate</p>
                    </>
                  ) : (
                    <p className="text-purple-800 text-[13px] mt-1">Not enough swings</p>
                  )}
                </div>
              </div>
            </div>

            {/* ══════════════════════════════════ HEAT MAP VIEW ══════════════════════════════════ */}
            {view === 'heatmap' && (
              <div className="px-4 space-y-4">

                {/* Mode toggle */}
                <div className="flex items-center justify-between">
                  <p className="text-slate-500 text-[12px] uppercase tracking-widest">Zone Heat Map</p>
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

                {/* ── 3×3 Strike zone grid ── */}
                <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
                  {/* Column labels */}
                  <div className="grid grid-cols-3 mb-1.5 text-center">
                    {['HI-IN','HIGH','HI-OUT'].map(l => (
                      <p key={l} className="text-slate-600 text-[10px] uppercase tracking-wide">{l}</p>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {ZONES.map(zone => {
                      const s = zoneStats[zone];
                      const pct = mapMode === 'swing'
                        ? (s.total   >= 3 ? Math.round((s.swings   / s.total)  * 100) : null)
                        : (s.swings  >= 2 ? Math.round((s.contacts / s.swings) * 100) : null);
                      const bg = mapMode === 'swing'
                        ? swingBg(pct ?? 0, s.total)
                        : contactBg(pct ?? 0, s.swings);
                      const fg = textColor(bg);
                      const sampleSize = mapMode === 'swing' ? s.total : s.swings;
                      return (
                        <div
                          key={zone}
                          className="rounded-xl flex flex-col items-center justify-center pt-3 pb-2 relative select-none"
                          style={{ background: bg, color: fg, minHeight: 80 }}
                        >
                          <span className="absolute top-1.5 left-2 text-[10px] opacity-50">{zone}</span>
                          {pct !== null ? (
                            <>
                              <span className="text-[28px] font-black leading-none">{pct}<span className="text-[16px]">%</span></span>
                              <span className="text-[11px] opacity-60 mt-0.5">{sampleSize} {mapMode === 'swing' ? 'seen' : 'swings'}</span>
                            </>
                          ) : (
                            <>
                              <span className="text-[22px] font-black opacity-30">—</span>
                              <span className="text-[11px] opacity-30">{sampleSize}</span>
                            </>
                          )}
                          <span className="text-[10px] opacity-40 mt-0.5">{ZONE_NAMES[zone]}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Row labels */}
                  <div className="grid grid-cols-3 mt-1.5 text-center">
                    {['LO-IN','LOW','LO-OUT'].map(l => (
                      <p key={l} className="text-slate-600 text-[10px] uppercase tracking-wide">{l}</p>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
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
                </div>

                {/* ── Out-of-zone chase rates ── */}
                <div>
                  <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-2">Out-of-Zone Chase Rate</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['UP','LOW','IN','OUT'] as BallDir[]).map(dir => {
                      const s = bStats[dir];
                      const pct = s.total >= 2 ? Math.round((s.swings / s.total) * 100) : null;
                      const arrows: Record<BallDir,string> = { UP:'↑ High', LOW:'↓ Low', IN:'← Inside', OUT:'→ Outside' };
                      const hot = pct !== null && pct >= 40;
                      return (
                        <div key={dir} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 flex items-center justify-between">
                          <span className="text-slate-400 text-[16px]">{arrows[dir]}</span>
                          <div className="text-right">
                            <p className={`font-bold text-[20px] leading-none ${hot ? 'text-orange-400' : 'text-blue-400'}`}>
                              {pct !== null ? `${pct}%` : '—'}
                            </p>
                            <p className="text-slate-600 text-[11px]">{s.total}p</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Overall chase */}
                  <div className="mt-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <span className="text-slate-300 text-[16px] font-medium">Overall Chase Rate</span>
                    <span className={`font-bold text-[20px] ${chaseRate >= 35 ? 'text-orange-400' : 'text-blue-400'}`}>
                      {chaseRate}%
                    </span>
                  </div>
                </div>

              </div>
            )}

            {/* ══════════════════════════════════ SPRAY VIEW ══════════════════════════════════ */}
            {view === 'spray' && (
              <div className="px-4">
                <p className="text-slate-500 text-[12px] uppercase tracking-widest mb-3">
                  Spray Chart — All Hits ({hits.length})
                </p>
                <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full rounded-2xl" style={{ background: '#0a140a' }}>
                  {/* Warning track */}
                  <path d={`M ${SHX} ${SHY} L ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY} Z`} fill="#7a5c3a" />
                  {/* Outfield */}
                  <path d={`M ${SHX} ${SHY} L ${SWARN_LX} ${SWARN_LY} A ${SR_WARN} ${SR_WARN} 0 0 1 ${SWARN_RX} ${SWARN_RY} Z`} fill="#173d10" />
                  {/* Infield dirt */}
                  <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#1e5216" />
                  <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#7a5230" opacity="0.45" />
                  {/* Fence */}
                  <path d={`M ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY}`} fill="none" stroke="#e5a020" strokeWidth="2.5" opacity="0.85" />
                  {/* Foul lines */}
                  <line x1={SHX} y1={SHY} x2={SLFPX} y2={SLFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
                  <line x1={SHX} y1={SHY} x2={SRFPX} y2={SRFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
                  {/* Mound */}
                  <circle cx={SMX} cy={SMY} r="9" fill="#9B6E4C" opacity="0.8" />
                  <circle cx={SMX} cy={SMY} r="2" fill="#ccc" opacity="0.9" />
                  {/* Bases */}
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
                {/* Legend */}
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
