'use client';
import { useState } from 'react';
import { HitType, HitResult, HitData } from '@/types';

const HIT_TYPES: { value: HitType; label: string; icon: string }[] = [
  { value: 'ground-ball', label: 'Ground', icon: '⬇' },
  { value: 'line-drive', label: 'Line', icon: '→' },
  { value: 'fly-ball', label: 'Fly', icon: '⬆' },
  { value: 'pop-up', label: 'Pop Up', icon: '↑↑' },
];
const HIT_RESULTS: { value: HitResult; label: string; color: string }[] = [
  { value: 'out', label: 'Out', color: '#ef4444' },
  { value: 'error', label: 'Err', color: '#f97316' },
  { value: 'single', label: '1B', color: '#22c55e' },
  { value: 'double', label: '2B', color: '#3b82f6' },
  { value: 'triple', label: '3B', color: '#8b5cf6' },
  { value: 'home-run', label: 'HR', color: '#eab308' },
];

// ── SVG field dimensions ──────────────────────────────────────────────────────
const W = 400; const H = 390;
const HX = 200; const HY = 365;      // Home plate
const R_FENCE   = 270;               // HR fence radius
const R_WARN    = 220;               // Warning track inner edge
const R_SHALLOW = 155;               // Outfield/infield boundary arc

// Foul poles at exactly 45°
const LFPX = Math.round(HX - R_FENCE * Math.sin(Math.PI / 4));  // 9
const LFPY = Math.round(HY - R_FENCE * Math.cos(Math.PI / 4));  // 174
const RFPX = Math.round(HX + R_FENCE * Math.sin(Math.PI / 4));  // 391
const RFPY = LFPY;

// Zone dividers at ±15° from vertical (30-degree sector boundaries)
const ZONE_L_X = Math.round(HX - R_FENCE * Math.sin(Math.PI / 12)); // 129
const ZONE_L_Y = Math.round(HY - R_FENCE * Math.cos(Math.PI / 12)); // 96
const ZONE_R_X = Math.round(HX + R_FENCE * Math.sin(Math.PI / 12)); // 271
const ZONE_R_Y = ZONE_L_Y;

// Base positions (45° geometry)
const B1X = 271; const B1Y = 294;
const B2X = 200; const B2Y = 224;
const B3X = 129; const B3Y = 294;
const MX  = 200; const MY  = 298;  // mound

function arcPt(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = angleDeg * Math.PI / 180;
  return [Math.round(cx + r * Math.sin(a)), Math.round(cy - r * Math.cos(a))];
}

const [WARN_LX, WARN_LY] = arcPt(HX, HY, R_WARN, -45);
const [WARN_RX, WARN_RY] = arcPt(HX, HY, R_WARN, 45);
const [SH_LX, SH_LY]     = arcPt(HX, HY, R_SHALLOW, -45);
const [SH_RX, SH_RY]     = arcPt(HX, HY, R_SHALLOW, 45);
// Center-line endpoint at the R_SHALLOW arc, 0° (straight ahead)
const CTR_END_Y = HY - R_SHALLOW; // = 210

// ── Infield position label coordinates ───────────────────────────────────────
// SS: between 3B and 2B, in left-of-center zone (-15° to 0°)
const SS_LX = Math.round(HX + 105 * Math.sin(-7.5 * Math.PI / 180)); // ~186
const SS_LY = Math.round(HY - 105 * Math.cos(-7.5 * Math.PI / 180)); // ~261
// 2B fielder indicator: between 2B and 1B (0° to +15°)  — 2nd base marker already labels this
const IF2B_X = Math.round(HX + 105 * Math.sin(7.5 * Math.PI / 180)); // ~214
const IF2B_Y = SS_LY; // same depth

// ── Detect hit zone from tap (percentage) coordinates ────────────────────────
function getHitZone(xPct: number, yPct: number): string {
  const dx    = (xPct / 100) * W - HX;
  const dy    = HY - (yPct / 100) * H;   // flip y (SVG y grows down)
  const r     = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dx, dy) * 180 / Math.PI; // 0°=straight ahead, -=left, +=right

  // Out of fair territory
  if (Math.abs(angle) > 45) return 'Foul';
  // Home-run fence
  if (r > R_FENCE - 10) {
    // Directional HR zone based on the same ±15° sector boundaries
    if (angle < -15) return 'HR-Lft';
    if (angle <   0) return 'HR-LCtr';
    if (angle <  15) return 'HR-RCtr';
    return 'HR-Rt';
  }

  // ── Infield positions (inside R_SHALLOW arc) ──────────────────────────────
  if (r < R_SHALLOW) {
    // Catcher zone — very close to home plate
    if (r < 50) return 'C';
    // Left 30° sector: 3rd base territory
    if (angle < -15) return '3B';
    // Left half of middle sector: shortstop
    if (angle < 0)   return 'SS';
    // Right half of middle sector: second baseman
    if (angle < 15)  return '2B';
    // Right 30° sector: first base territory
    return '1B';
  }

  // ── Outfield zones (beyond R_SHALLOW) ────────────────────────────────────
  const depth = r < R_WARN ? 'Shallow' : 'Deep';
  if (angle < -15) return `${depth} Left`;
  if (angle > 15)  return `${depth} Right`;
  return `${depth} Center`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function HitScreen({ onRecord, onCancel }: { onRecord: (h: HitData) => void; onCancel: () => void }) {
  const [coords, setCoords]     = useState<{ x: number; y: number } | null>(null);
  const [hitType, setHitType]   = useState<HitType | null>(null);
  const [hitResult, setHitResult] = useState<HitResult | null>(null);
  const canRecord = coords !== null && hitType !== null && hitResult !== null;
  const hitZone = coords ? getHitZone(coords.x, coords.y) : null;

  const dotX = coords ? (coords.x / 100) * W : null;
  const dotY = coords ? (coords.y / 100) * H : null;
  const markerColor = (r: HitResult | null) =>
    r ? (HIT_RESULTS.find(x => x.value === r)?.color ?? '#94a3b8') : '#94a3b8';

  const handleFieldTap = (clientX: number, clientY: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    setCoords({
      x: Math.round(((clientX - rect.left) / rect.width) * 1000) / 10,
      y: Math.round(((clientY - rect.top) / rect.height) * 1000) / 10,
    });
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    handleFieldTap(e.clientX, e.clientY, e.currentTarget);
  };

  const handleTouch = (e: React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault(); // prevent ghost-click on mobile
    const touch = e.changedTouches[0];
    handleFieldTap(touch.clientX, touch.clientY, e.currentTarget);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0">
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-100 text-[21px]">&larr; Cancel</button>
        <div className="text-center">
          <h2 className="font-bold text-[21px]">Ball In Play</h2>
          {hitZone && <p className="text-[18px] font-semibold text-amber-400 mt-0.5">{hitZone}</p>}
        </div>
        <div className="w-16" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-2 pt-2">
          <p className="text-slate-400 text-[18px] text-center mb-1">Tap where the ball landed</p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full rounded-xl border border-slate-700 cursor-crosshair"
            style={{ maxHeight: 350, background: '#0a140a' }}
            onClick={handleClick}
            onTouchEnd={handleTouch}
          >
            {/* ── OUTFIELD GRASS ── */}
            <path d={`M ${HX} ${HY} L ${LFPX} ${LFPY} A ${R_FENCE} ${R_FENCE} 0 0 1 ${RFPX} ${RFPY} Z`} fill="#173d10" />

            {/* ── WARNING TRACK ── */}
            <path d={`M ${HX} ${HY} L ${LFPX} ${LFPY} A ${R_FENCE} ${R_FENCE} 0 0 1 ${RFPX} ${RFPY} Z`} fill="#7a5c3a" />
            <path d={`M ${HX} ${HY} L ${WARN_LX} ${WARN_LY} A ${R_WARN} ${R_WARN} 0 0 1 ${WARN_RX} ${WARN_RY} Z`} fill="#173d10" />

            {/* ── INFIELD GRASS ── */}
            <path d={`M ${HX} ${HY} L ${B1X} ${B1Y} L ${B2X} ${B2Y} L ${B3X} ${B3Y} Z`} fill="#1e5216" />

            {/* ── INFIELD DIRT ── */}
            <path d={`M ${HX} ${HY} L ${B1X} ${B1Y} L ${B2X} ${B2Y} L ${B3X} ${B3Y} Z`} fill="#7a5230" opacity="0.45" />

            {/* ── SHALLOW ARC (infield/outfield boundary) ── */}
            <path
              d={`M ${SH_LX} ${SH_LY} A ${R_SHALLOW} ${R_SHALLOW} 0 0 1 ${SH_RX} ${SH_RY}`}
              fill="none" stroke="#ffffff" strokeWidth="0.8" strokeDasharray="5 4" opacity="0.25"
            />

            {/* ── HR FENCE ── */}
            <path
              d={`M ${LFPX} ${LFPY} A ${R_FENCE} ${R_FENCE} 0 0 1 ${RFPX} ${RFPY}`}
              fill="none" stroke="#e5a020" strokeWidth="2.5" opacity="0.85"
            />

            {/* ── SECTOR DIVIDERS (±15° and 0° center) ── */}
            {/* Left boundary: 3B sector / SS sector (-45° to -15°) */}
            <line x1={HX} y1={HY} x2={ZONE_L_X} y2={ZONE_L_Y} stroke="#ffffff" strokeWidth="0.7" strokeDasharray="6 5" opacity="0.2" />
            {/* Right boundary: 2B sector / 1B sector (+15° to +45°) */}
            <line x1={HX} y1={HY} x2={ZONE_R_X} y2={ZONE_R_Y} stroke="#ffffff" strokeWidth="0.7" strokeDasharray="6 5" opacity="0.2" />
            {/* Center line: SS / 2B split (0° — home straight to 2B) */}
            <line x1={HX} y1={HY} x2={HX} y2={CTR_END_Y} stroke="#ffffff" strokeWidth="0.6" strokeDasharray="4 4" opacity="0.15" />

            {/* ── FOUL LINES ── */}
            <line x1={HX} y1={HY} x2={LFPX} y2={LFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
            <line x1={HX} y1={HY} x2={RFPX} y2={RFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />

            {/* ── OUTFIELD ZONE LABELS ── */}
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

            {/* ── PITCHING MOUND ── */}
            <circle cx={MX} cy={MY} r="9" fill="#9B6E4C" opacity="0.8" />
            <circle cx={MX} cy={MY} r="2" fill="#ccc" opacity="0.9" />

            {/* ── BASES ── */}
            {([
              [HX, HY,  'H', false],
              [B1X, B1Y, '1', true],
              [B2X, B2Y, '2', true],
              [B3X, B3Y, '3', true],
            ] as [number, number, string, boolean][]).map(([x, y, l, rotate]) => (
              <g key={l}>
                <rect
                  x={x - 9} y={y - 9} width="18" height="18"
                  fill={l === 'H' ? '#d4c5a0' : 'white'} rx="2"
                  transform={rotate ? `rotate(45 ${x} ${y})` : undefined}
                />
                <text x={x} y={y + 4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#0a140a">{l}</text>
              </g>
            ))}

            {/* ── INFIELD POSITION LABELS ── */}
            {/* SS — between 3B and 2B (left half of middle 30° sector) */}
            <text x={SS_LX} y={SS_LY} textAnchor="middle" fontSize="14" fontWeight="700"
              fill="#94a3b8" opacity="0.85">SS</text>
            {/* 2B fielder label — between 2B and 1B (right half of middle sector) */}
            <text x={IF2B_X} y={IF2B_Y} textAnchor="middle" fontSize="14" fontWeight="700"
              fill="#94a3b8" opacity="0.85">2B</text>
            {/* C (catcher) — near home plate */}
            <text x={HX} y={HY - 17} textAnchor="middle" fontSize="14" fontWeight="700"
              fill="#94a3b8" opacity="0.8">C</text>

            {/* ── HIT LOCATION MARKER ── */}
            {dotX !== null && dotY !== null && (
              <g>
                <circle cx={dotX} cy={dotY} r="12" fill={markerColor(hitResult)} opacity="0.85" />
                <circle cx={dotX} cy={dotY} r="12" fill="none" stroke="white" strokeWidth="2" />
                <text x={dotX} y={dotY + 4} textAnchor="middle" fontSize="14" fill="white" fontWeight="bold">
                  {hitResult ? HIT_RESULTS.find(r => r.value === hitResult)?.label : '?'}
                </text>
              </g>
            )}
          </svg>
        </div>

        <div className="px-3 pt-2">
          <p className="text-slate-400 text-[18px] mb-2">Hit Type</p>
          <div className="grid grid-cols-4 gap-2">
            {HIT_TYPES.map(ht => (
              <button key={ht.value} onClick={() => setHitType(ht.value)}
                className={`py-3 rounded-xl text-[18px] font-medium text-center ${hitType === ht.value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                <div className="text-[24px] mb-0.5">{ht.icon}</div>{ht.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 pt-2 pb-3">
          <p className="text-slate-400 text-[18px] mb-2">Result</p>
          <div className="grid grid-cols-3 gap-2">
            {HIT_RESULTS.map(r => (
              <button key={r.value} onClick={() => setHitResult(r.value)}
                className={`py-3 rounded-xl text-[24px] font-bold ${hitResult === r.value ? 'text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                style={hitResult === r.value ? { backgroundColor: r.color } : {}}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 pb-4 pt-2 flex-shrink-0">
        <button
          onClick={() => {
            if (canRecord) onRecord({
              x: coords!.x, y: coords!.y,
              type: hitType!, result: hitResult!,
              zone: hitZone ?? undefined,
            });
          }}
          disabled={!canRecord}
          className={`w-full h-14 rounded-xl text-[27px] font-bold ${canRecord ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
        >
          ✓ Record Hit{hitZone ? ` — ${hitZone}` : ''}
        </button>
      </div>
    </div>
  );
}
