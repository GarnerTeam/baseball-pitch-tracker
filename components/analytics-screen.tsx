'use client';
import { useState, useEffect, useRef } from 'react';
import { GameState, PitchRecord, Player } from '@/types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PitchTypeBarChart, buildPitchTypeStats } from '@/components/pitch-type-chart';

const OUTCOME_COLORS: Record<string, string> = {
  ball:'#22c55e','called-strike':'#ef4444','swinging-strike':'#dc2626',
  foul:'#f97316','foul-tip':'#fb923c','in-play':'#3b82f6',walk:'#10b981',strikeout:'#7f1d1d',
};

// ── Field geometry ─────────────────────────────────────────────────────────────
const W=400; const H=390; const HX=200; const HY=365;
const R_FENCE=270; const R_WARN=220; const R_SHALLOW=155;
const LFPX=9; const LFPY=174; const RFPX=391; const RFPY=174;
const ZONE_L_X=129; const ZONE_L_Y=96; const ZONE_R_X=271; const ZONE_R_Y=96;
const B1X=271; const B1Y=294; const B2X=200; const B2Y=224; const B3X=129; const B3Y=294;
const MX=200; const MY=298;
const WARN_LX=44; const WARN_LY=209; const WARN_RX=356; const WARN_RY=209;
const SH_LX=90; const SH_LY=255; const SH_RX=310; const SH_RY=255;

function hitColor(result: string) {
  if (result === 'out')      return '#ef4444';
  if (result === 'home-run') return '#eab308';
  if (result === 'error')    return '#f97316';
  return '#22c55e';
}

function BaseballField({ hits }: { hits: PitchRecord[] }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl" style={{ background: '#0a140a' }}>
      <path d={`M ${HX} ${HY} L ${LFPX} ${LFPY} A ${R_FENCE} ${R_FENCE} 0 0 1 ${RFPX} ${RFPY} Z`} fill="#7a5c3a" />
      <path d={`M ${HX} ${HY} L ${WARN_LX} ${WARN_LY} A ${R_WARN} ${R_WARN} 0 0 1 ${WARN_RX} ${WARN_RY} Z`} fill="#173d10" />
      <path d={`M ${HX} ${HY} L ${B1X} ${B1Y} L ${B2X} ${B2Y} L ${B3X} ${B3Y} Z`} fill="#1e5216" />
      <path d={`M ${HX} ${HY} L ${B1X} ${B1Y} L ${B2X} ${B2Y} L ${B3X} ${B3Y} Z`} fill="#7a5230" opacity="0.45" />
      <path d={`M ${SH_LX} ${SH_LY} A ${R_SHALLOW} ${R_SHALLOW} 0 0 1 ${SH_RX} ${SH_RY}`} fill="none" stroke="#ffffff" strokeWidth="0.8" strokeDasharray="5 4" opacity="0.25" />
      <path d={`M ${LFPX} ${LFPY} A ${R_FENCE} ${R_FENCE} 0 0 1 ${RFPX} ${RFPY}`} fill="none" stroke="#e5a020" strokeWidth="2.5" opacity="0.85" />
      <line x1={HX} y1={HY} x2={ZONE_L_X} y2={ZONE_L_Y} stroke="#ffffff" strokeWidth="0.7" strokeDasharray="6 5" opacity="0.2" />
      <line x1={HX} y1={HY} x2={ZONE_R_X} y2={ZONE_R_Y} stroke="#ffffff" strokeWidth="0.7" strokeDasharray="6 5" opacity="0.2" />
      <line x1={HX} y1={HY} x2={LFPX} y2={LFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
      <line x1={HX} y1={HY} x2={RFPX} y2={RFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
      <text x="62"  y="178" textAnchor="middle" fontSize="13" fill="#94a3b8" opacity="0.7" fontWeight="500">Deep</text>
      <text x="62"  y="188" textAnchor="middle" fontSize="13" fill="#94a3b8" opacity="0.7" fontWeight="500">Left</text>
      <text x="200" y="138" textAnchor="middle" fontSize="13" fill="#94a3b8" opacity="0.7" fontWeight="500">Deep Center</text>
      <text x="338" y="178" textAnchor="middle" fontSize="13" fill="#94a3b8" opacity="0.7" fontWeight="500">Deep</text>
      <text x="338" y="188" textAnchor="middle" fontSize="13" fill="#94a3b8" opacity="0.7" fontWeight="500">Right</text>
      <text x="100" y="242" textAnchor="middle" fontSize="12" fill="#64748b" opacity="0.65">Shallow</text>
      <text x="100" y="251" textAnchor="middle" fontSize="12" fill="#64748b" opacity="0.65">Left</text>
      <text x="200" y="210" textAnchor="middle" fontSize="12" fill="#64748b" opacity="0.65">Shallow Ctr</text>
      <text x="300" y="242" textAnchor="middle" fontSize="12" fill="#64748b" opacity="0.65">Shallow</text>
      <text x="300" y="251" textAnchor="middle" fontSize="12" fill="#64748b" opacity="0.65">Right</text>
      <circle cx={MX} cy={MY} r="9" fill="#9B6E4C" opacity="0.8" />
      <circle cx={MX} cy={MY} r="2" fill="#ccc" opacity="0.9" />
      {([
        [HX, HY, 'H', false],
        [B1X, B1Y, '1', true],
        [B2X, B2Y, '2', true],
        [B3X, B3Y, '3', true],
      ] as [number, number, string, boolean][]).map(([x, y, l, rotate]) => (
        <g key={l}>
          <rect x={x-9} y={y-9} width="18" height="18"
            fill={l==='H'?'#d4c5a0':'white'} rx="2"
            transform={rotate?`rotate(45 ${x} ${y})`:undefined} />
          <text x={x} y={y+4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#0a140a">{l}</text>
        </g>
      ))}
      {hits.map((p, i) => {
        const h = p.hitData!;
        const x = (h.x / 100) * W; const y = (h.y / 100) * H;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="7" fill={hitColor(h.result)} opacity="0.85" />
            <circle cx={x} cy={y} r="7" fill="none" stroke="white" strokeWidth="1.5" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Per-pitcher stats page ─────────────────────────────────────────────────────
function PitcherStatsPage({ pitches, pitcher, isCurrent }: {
  pitches: PitchRecord[];
  pitcher: Player | null;
  isCurrent: boolean;
}) {
  const total   = pitches.length;
  const strikes = pitches.filter(p => ['called-strike','swinging-strike','foul','foul-tip','strikeout','in-play'].includes(p.outcome)).length;
  const strikePct = total > 0 ? Math.round((strikes / total) * 100) : 0;
  const inPlay  = pitches.filter(p => p.outcome === 'in-play').length;

  const typeData = buildPitchTypeStats(pitches);

  const oc: Record<string, number> = {};
  pitches.forEach(p => { oc[p.outcome] = (oc[p.outcome] ?? 0) + 1; });
  const outcomeData = Object.entries(oc).map(([name, count]) => ({ name, count }));

  const hm: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  pitches.forEach(p => { if (p.location) hm[p.location.row][p.location.col]++; });
  const maxH = Math.max(...hm.flat(), 1);

  const bStats: Record<string, { name: string; pitches: number; k: number; bb: number }> = {};
  pitches.forEach(p => {
    if (!bStats[p.batterNumber]) bStats[p.batterNumber] = { name: p.batterName, pitches: 0, k: 0, bb: 0 };
    bStats[p.batterNumber].pitches++;
    if (p.outcome === 'strikeout') bStats[p.batterNumber].k++;
    if (p.outcome === 'walk') bStats[p.batterNumber].bb++;
  });

  const hits = pitches.filter(p => p.hitData);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2">
        <p className="text-[21px]">No pitches recorded</p>
        <p className="text-[18px] text-slate-600">for this pitcher yet</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Summary Cards ── */}
      <div className="px-3 pt-3 grid grid-cols-4 gap-2">
        {[
          { l: 'Pitches',  v: String(total),      c: 'text-slate-100' },
          { l: 'Strikes',  v: String(strikes),     c: 'text-red-400'   },
          { l: 'Strike%',  v: `${strikePct}%`,     c: 'text-amber-400' },
          { l: 'In Play',  v: String(inPlay),      c: 'text-blue-400'  },
        ].map(x => (
          <div key={x.l} className="bg-slate-900 rounded-xl p-2 text-center border border-slate-700">
            <div className={`text-[30px] font-bold ${x.c}`}>{x.v}</div>
            <div className="text-slate-500 text-[15px] mt-0.5">{x.l}</div>
          </div>
        ))}
      </div>

      {/* ── Pitch Types ── */}
      {typeData.length > 0 && (
        <div className="px-3 pt-5">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">Pitch Types</p>
          <PitchTypeBarChart stats={typeData} height={160} />
        </div>
      )}

      {/* ── Outcomes ── */}
      {outcomeData.length > 0 && (
        <div className="px-3 pt-4">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">Outcomes</p>
          <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={outcomeData} layout="vertical" margin={{ top: 4, right: 30, left: 60, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 15 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 15 }} width={70} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {outcomeData.map(e => <Cell key={e.name} fill={OUTCOME_COLORS[e.name] ?? '#64748b'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Pitch Heat Map ── */}
      <div className="px-3 pt-4">
        <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">Pitch Heat Map</p>
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
          <div className="mx-auto" style={{ maxWidth: 200 }}>
            {hm.map((row, ri) => (
              <div key={ri} className="flex">
                {row.map((count, ci) => {
                  const intensity = count / maxH;
                  const isStrike = ri >= 1 && ri <= 3 && ci >= 1 && ci <= 3;
                  return (
                    <div key={ci}
                      className="flex-1 flex items-center justify-center text-[18px] font-bold border border-slate-700"
                      style={{
                        aspectRatio: '1',
                        background: count > 0 ? `rgba(239,68,68,${0.2 + intensity * 0.8})` : isStrike ? '#1e3a2e' : '#0f172a',
                        color: intensity > 0.5 ? 'white' : '#94a3b8',
                      }}
                    >
                      {count > 0 ? count : ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Batter Stats ── */}
      {Object.keys(bStats).length > 0 && (
        <div className="px-3 pt-4">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">Batter Matchups</p>
          <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
            <div className="grid grid-cols-4 text-[15px] text-slate-500 px-3 py-2 border-b border-slate-700 bg-slate-800/50">
              <span>Batter</span>
              <span className="text-center">P</span>
              <span className="text-center">K</span>
              <span className="text-center">BB</span>
            </div>
            {Object.entries(bStats).map(([num, s]) => (
              <div key={num} className="grid grid-cols-4 text-[18px] px-3 py-2.5 border-b border-slate-800 last:border-0">
                <span className="text-slate-200 font-medium text-[15px]">#{num} {s.name}</span>
                <span className="text-center text-slate-300">{s.pitches}</span>
                <span className="text-center text-red-400 font-bold">{s.k}</span>
                <span className="text-center text-green-400 font-bold">{s.bb}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Spray Chart ── */}
      {hits.length > 0 && (
        <div className="px-3 pt-4">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">Spray Chart</p>
          <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
            <div className="flex gap-3 justify-center mb-2">
              {[['#22c55e','Hit'],['#eab308','HR'],['#ef4444','Out'],['#f97316','Error']].map(([col, lbl]) => (
                <div key={lbl} className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full" style={{ background: col as string }} />
                  <span className="text-slate-400 text-[15px]">{lbl}</span>
                </div>
              ))}
            </div>
            <BaseballField hits={hits} />
          </div>
        </div>
      )}

      <div className="h-8" />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function getAllPitches(state: GameState): PitchRecord[] {
  return [...state.allAtBats.flatMap(ab => ab.pitches), ...(state.currentAtBat?.pitches ?? [])];
}

export function AnalyticsScreen({ state }: { state: GameState }) {
  const pitcherHistory = state.pitcherHistory ?? [];

  // Pages: current pitcher first, then previous pitchers (most recent → oldest)
  const pitchers: (Player | null)[] = [
    state.pitcher,
    ...[...pitcherHistory].reverse(),
  ];
  // Always show at least one page even if pitcher has no name
  const pageCount = pitchers.length;

  const [pageIdx, setPageIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Reset to current pitcher page whenever the active pitcher changes
  const prevPitcherIdRef = useRef(state.pitcher?.id);
  useEffect(() => {
    if (state.pitcher?.id !== prevPitcherIdRef.current) {
      setPageIdx(0);
      prevPitcherIdRef.current = state.pitcher?.id;
    }
  }, [state.pitcher?.id]);

  // Clamp page index in case pitcherHistory shrinks
  const safeIdx = Math.min(pageIdx, pageCount - 1);

  const selectedPitcher = pitchers[safeIdx] ?? null;
  const allPitches = getAllPitches(state);

  // Filter pitches to the selected pitcher (if named), else show all
  const pitcherPitches = selectedPitcher?.name?.trim()
    ? allPitches.filter(p =>
        p.pitcherName === selectedPitcher.name &&
        p.pitcherNumber === selectedPitcher.number
      )
    : allPitches;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    touchStartX.current = null;
    touchStartY.current = null;
    // Only register as a horizontal swipe if dx dominates dy and meets threshold
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0 && safeIdx < pageCount - 1) setPageIdx(safeIdx + 1);  // swipe left → older pitcher
    if (dx < 0 && safeIdx > 0)             setPageIdx(safeIdx - 1);  // swipe right → newer pitcher
  };

  const pitcherName   = selectedPitcher?.name?.trim()  || 'No Pitcher Set';
  const pitcherNumber = selectedPitcher?.number?.trim() || '—';
  const isCurrent     = safeIdx === 0;

  return (
    <div
      className="flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Pitcher header (sticky) ── */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800">

        {/* Pitcher name + badge */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="bg-blue-600 text-white text-[21px] font-bold px-2.5 py-0.5 rounded-lg flex-shrink-0">
            #{pitcherNumber}
          </span>
          <span className="font-semibold text-[24px] text-slate-100 truncate">{pitcherName}</span>
          {isCurrent
            ? <span className="ml-auto flex-shrink-0 text-[15px] font-bold bg-green-700 text-white px-2 py-0.5 rounded-full">Current</span>
            : <span className="ml-auto flex-shrink-0 text-[15px] text-slate-500">Previous</span>
          }
        </div>

        {/* Page dots + swipe hint (only when multiple pitchers) */}
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 pb-2">
            {/* Left arrow */}
            <button
              onClick={() => safeIdx > 0 && setPageIdx(safeIdx - 1)}
              disabled={safeIdx === 0}
              className="text-slate-500 disabled:opacity-20 text-[21px] px-1"
            >‹</button>

            {/* Dots */}
            {pitchers.map((_, i) => (
              <button
                key={i}
                onClick={() => setPageIdx(i)}
                className={`w-2 h-2 rounded-full transition-colors ${i === safeIdx ? 'bg-blue-400' : 'bg-slate-700'}`}
              />
            ))}

            {/* Right arrow */}
            <button
              onClick={() => safeIdx < pageCount - 1 && setPageIdx(safeIdx + 1)}
              disabled={safeIdx === pageCount - 1}
              className="text-slate-500 disabled:opacity-20 text-[21px] px-1"
            >›</button>
          </div>
        )}
      </div>

      {/* ── Stats for selected pitcher ── */}
      <PitcherStatsPage
        key={safeIdx}
        pitches={pitcherPitches}
        pitcher={selectedPitcher}
        isCurrent={isCurrent}
      />
    </div>
  );
}
