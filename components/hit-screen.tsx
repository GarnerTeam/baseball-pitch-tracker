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

export function HitScreen({ onRecord, onCancel }: { onRecord: (h: HitData) => void; onCancel: () => void }) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [hitType, setHitType] = useState<HitType | null>(null);
  const [hitResult, setHitResult] = useState<HitResult | null>(null);
  const canRecord = coords !== null && hitType !== null && hitResult !== null;

  // SVG dimensions and key coordinates (90-degree fair territory, home at apex)
  const W = 400; const H = 380;
  // Home plate at bottom center (apex of 90-degree fair territory)
  const HX = 200; const HY = 360;
  // Bases at 45-degree angles from home (equal dx and dy)
  const B1X = 271; const B1Y = 289; // 1B: 71px right, 71px up
  const B2X = 200; const B2Y = 219; // 2B: straight up, sqrt(2)*71 ≈ 141px
  const B3X = 129; const B3Y = 289; // 3B: 71px left, 71px up
  // Foul poles at exactly 45 degrees, radius 276 from home
  const LFPX = 5;   const LFPY = 165; // Left foul pole: 195px left, 195px up
  const RFPX = 395; const RFPY = 165; // Right foul pole: 195px right, 195px up
  // Pitching mound: ~67px above home (60.5ft/127.3ft * 141px ≈ 67px)
  const MX = 200; const MY = 293;

  const dotX = coords ? (coords.x / 100) * W : null;
  const dotY = coords ? (coords.y / 100) * H : null;
  const markerColor = (r: HitResult | null) => r ? (HIT_RESULTS.find(x => x.value === r)?.color ?? '#94a3b8') : '#94a3b8';

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({
      x: Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10,
      y: Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0">
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-100 text-sm">&larr; Cancel</button>
        <h2 className="font-bold">Ball In Play</h2>
        <div className="w-16" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3">
          <p className="text-slate-400 text-xs text-center mb-1">Tap to mark where the ball landed</p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full rounded-xl border border-slate-700 cursor-crosshair"
            style={{ maxHeight: 270, background: '#0f1a0f' }}
            onClick={handleClick}
          >
            {/* Fair territory: 90-degree sector, home at apex, foul poles at ±45° */}
            {/* Path: home → LFP (left foul line) → arc through CF → RFP → close (right foul line) */}
            <path
              d={`M ${HX} ${HY} L ${LFPX} ${LFPY} A 276 276 0 0 0 ${RFPX} ${RFPY} Z`}
              fill="#1a4a12"
              opacity="0.85"
            />

            {/* Infield grass (darker square) */}
            <path
              d={`M ${HX} ${HY} L ${B1X} ${B1Y} L ${B2X} ${B2Y} L ${B3X} ${B3Y} Z`}
              fill="#16401a"
              opacity="0.9"
            />

            {/* Infield dirt (lighter inner square) */}
            <path
              d={`M ${HX} ${HY} L ${B1X} ${B1Y} L ${B2X} ${B2Y} L ${B3X} ${B3Y} Z`}
              fill="#8B5E3C"
              opacity="0.35"
            />

            {/* Foul lines */}
            <line x1={HX} y1={HY} x2={LFPX} y2={LFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
            <line x1={HX} y1={HY} x2={RFPX} y2={RFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />

            {/* Foul line extended markers (base lines) */}
            <line x1={HX} y1={HY} x2={B1X} y2={B1Y} stroke="#ffffff" strokeWidth="0.75" opacity="0.3" />
            <line x1={HX} y1={HY} x2={B3X} y2={B3Y} stroke="#ffffff" strokeWidth="0.75" opacity="0.3" />

            {/* Pitching mound */}
            <circle cx={MX} cy={MY} r="9" fill="#9B6E4C" opacity="0.8" />
            <circle cx={MX} cy={MY} r="2" fill="#bbb" opacity="0.9" />

            {/* Bases — diamond squares */}
            {([
              [HX, HY, 'H'],
              [B1X, B1Y, '1'],
              [B2X, B2Y, '2'],
              [B3X, B3Y, '3'],
            ] as [number, number, string][]).map(([x, y, l]) => (
              <g key={l}>
                <rect x={x - 9} y={y - 9} width="18" height="18"
                  fill={l === 'H' ? '#d4c5a0' : 'white'}
                  rx="2"
                  transform={l !== 'H' ? `rotate(45 ${x} ${y})` : undefined}
                />
                <text x={x} y={y + 4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0f1a0f">{l}</text>
              </g>
            ))}

            {/* Hit location marker */}
            {dotX !== null && dotY !== null && (
              <g>
                <circle cx={dotX} cy={dotY} r="11" fill={markerColor(hitResult)} opacity="0.88" />
                <circle cx={dotX} cy={dotY} r="11" fill="none" stroke="white" strokeWidth="1.5" />
                <text x={dotX} y={dotY + 4} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">
                  {hitResult ? HIT_RESULTS.find(r => r.value === hitResult)?.label : '?'}
                </text>
              </g>
            )}
          </svg>
        </div>

        <div className="px-3 pt-3">
          <p className="text-slate-400 text-xs mb-2">Hit Type</p>
          <div className="grid grid-cols-4 gap-2">
            {HIT_TYPES.map(ht => (
              <button key={ht.value} onClick={() => setHitType(ht.value)}
                className={`py-3 rounded-xl text-xs font-medium text-center ${hitType === ht.value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                <div className="text-base mb-0.5">{ht.icon}</div>{ht.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 pt-3 pb-4">
          <p className="text-slate-400 text-xs mb-2">Result</p>
          <div className="grid grid-cols-3 gap-2">
            {HIT_RESULTS.map(r => (
              <button key={r.value} onClick={() => setHitResult(r.value)}
                className={`py-3 rounded-xl text-base font-bold ${hitResult === r.value ? 'text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                style={hitResult === r.value ? { backgroundColor: r.color } : {}}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 pb-4 pt-2 flex-shrink-0">
        <button
          onClick={() => { if (canRecord) onRecord({ x: coords!.x, y: coords!.y, type: hitType!, result: hitResult! }); }}
          disabled={!canRecord}
          className={`w-full h-14 rounded-xl text-lg font-bold ${canRecord ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
        >
          ✓ Record Hit
        </button>
      </div>
    </div>
  );
}
