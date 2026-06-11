'use client';
import { PitchLocation, PitchRecord, SwingResult } from '@/types';
import { PITCH_TYPE_COLORS } from '@/types';

interface StrikeZoneProps {
  selected: PitchLocation | null;
  onSelect: (loc: PitchLocation) => void;
  currentAtBatPitches: PitchRecord[];
  historicalPitches: PitchRecord[];
  batterHand: 'L' | 'R' | null;
  onSetBatterHand: (h: 'L' | 'R' | null) => void;
  swing: SwingResult | null;
  onSetSwing: (s: SwingResult) => void;
}

function cellZone(row: number, col: number): 'strike' | 'ball' {
  return row >= 1 && row <= 3 && col >= 1 && col <= 3 ? 'strike' : 'ball';
}
function zoneNumber(row: number, col: number): number | undefined {
  if (row >= 1 && row <= 3 && col >= 1 && col <= 3) return (row - 1) * 3 + (col - 1) + 1;
  return undefined;
}

function PitchDot({ pitch, opacity }: { pitch: PitchRecord; opacity: number }) {
  const color = PITCH_TYPE_COLORS[pitch.pitchType];
  const isFoul = pitch.outcome === 'foul' || pitch.outcome === 'foul-tip';

  return isFoul ? (
    // Foul indicators: same 11×11 footprint as the pitch dots
    <div
      className="flex-shrink-0 flex items-center justify-center rounded font-black"
      style={{
        width: 11,
        height: 11,
        color,
        opacity,
        fontSize: 14,
        border: `1.5px solid ${color}`,
        backgroundColor: color + '30',
      }}
    >
      {pitch.outcome === 'foul-tip' ? '▲' : 'F'}
    </div>
  ) : (
    <div
      className="rounded-full flex-shrink-0"
      style={{
        width: 11,
        height: 11,
        background: pitch.swing ? color : 'transparent',
        border: `2px solid ${color}`,
        boxShadow: `0 0 3px ${color}`,
        opacity,
      }}
    />
  );
}

function BatterIcon({ hand, selected, onClick }: { hand: 'L' | 'R'; selected: boolean; onClick: () => void }) {
  const flip = hand === 'L';
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-1 py-1 rounded-lg transition-all"
      style={{ opacity: selected ? 1 : 0.2 }}
    >
      <svg
        viewBox="0 0 28 50"
        width="44"
        height="76"
        style={{ transform: flip ? 'scaleX(-1)' : 'none' }}
        className={selected ? 'text-blue-300' : 'text-slate-400'}
        fill="currentColor"
        stroke="currentColor"
        strokeLinecap="round"
      >
        <circle cx="14" cy="6" r="5.5" strokeWidth="0" />
        <rect x="8" y="4" width="8" height="4" rx="1" fill="currentColor" />
        <rect x="10" y="11" width="8" height="13" rx="2" strokeWidth="0" />
        <line x1="10" y1="15" x2="1" y2="3" strokeWidth="2.5" fill="none" />
        <line x1="18" y1="14" x2="22" y2="18" strokeWidth="2" fill="none" />
        <line x1="10" y1="14" x2="6" y2="11" strokeWidth="2" fill="none" />
        <line x1="12" y1="24" x2="8" y2="42" strokeWidth="2.5" fill="none" />
        <line x1="16" y1="24" x2="20" y2="42" strokeWidth="2.5" fill="none" />
        <line x1="8" y1="42" x2="4" y2="44" strokeWidth="2" fill="none" />
        <line x1="20" y1="42" x2="24" y2="44" strokeWidth="2" fill="none" />
      </svg>
      <span className={`text-[14px] font-bold leading-none ${selected ? 'text-blue-300' : 'text-slate-500'}`}>
        {hand}HB
      </span>
    </button>
  );
}

export function StrikeZone({ selected, onSelect, currentAtBatPitches, historicalPitches, batterHand, onSetBatterHand, swing, onSetSwing }: StrikeZoneProps) {
  return (
    <div className="flex items-center justify-center gap-1">

      {/* Left column: RHB icon + Swing button (25% larger, amber accent) */}
      <div className="flex flex-col items-center gap-1.5">
        <BatterIcon hand="R" selected={batterHand === 'R'} onClick={() => onSetBatterHand(batterHand === 'R' ? null : 'R')} />
        <button
          onClick={() => onSetSwing('swing')}
          className={`w-[70px] py-2.5 rounded-xl text-[21px] font-black tracking-wide transition-all shadow-md ${
            swing === 'swing'
              ? 'bg-amber-500 text-slate-900 shadow-amber-500/40'
              : 'bg-amber-900/50 border border-amber-700 text-amber-300 hover:bg-amber-800/60'
          }`}
        >
          ● Swing
        </button>
      </div>

      {/* Strike zone grid */}
      <div className="flex-1" style={{ maxWidth: 205 }}>
        <div
          className="grid gap-0.5 p-0.5 bg-slate-900 rounded-xl border border-slate-700"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}
        >
          {Array.from({ length: 5 }).flatMap((_, row) =>
            Array.from({ length: 5 }).map((_, col) => {
              const zone = cellZone(row, col);
              const zn = zoneNumber(row, col);
              const isSelected = selected?.row === row && selected?.col === col;
              const cur = currentAtBatPitches.filter(p => p.location?.row === row && p.location?.col === col);
              const hist = historicalPitches.filter(p => p.location?.row === row && p.location?.col === col);
              const allDots = [
                ...hist.map(p => ({ pitch: p, opacity: 0.65 as const })),
                ...cur.map(p => ({ pitch: p, opacity: 1.0 as const })),
              ];
              return (
                <button
                  key={`${row}-${col}`}
                  onClick={() => onSelect({ row, col, zone, zoneNumber: zn })}
                  className={`flex flex-wrap content-center items-center justify-center gap-[1.5px] p-[1px] transition-all active:scale-95 overflow-hidden ${
                    isSelected
                      ? 'bg-blue-600 ring-1 ring-blue-400 ring-offset-1 ring-offset-slate-900'
                      : zone === 'strike'
                      ? 'bg-slate-700 hover:bg-slate-600'
                      : 'bg-slate-800'
                  }`}
                  style={{ aspectRatio: '1' }}
                >
                  {allDots.length === 0 ? (
                    <>
                      {!isSelected && zn && <span className="font-bold" style={{ fontSize: 24, color: '#e2e8f0' }}>{zn}</span>}
                      {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                    </>
                  ) : (
                    allDots.map(({ pitch, opacity }, i) => (
                      <PitchDot key={`${pitch.id}-${i}`} pitch={pitch} opacity={opacity} />
                    ))
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right column: LHB icon + Looking button (25% larger, blue accent) */}
      <div className="flex flex-col items-center gap-1.5">
        <BatterIcon hand="L" selected={batterHand === 'L'} onClick={() => onSetBatterHand(batterHand === 'L' ? null : 'L')} />
        <button
          onClick={() => onSetSwing('no-swing')}
          className={`w-[70px] py-2.5 rounded-xl text-[21px] font-black tracking-wide transition-all shadow-md ${
            swing === 'no-swing'
              ? 'bg-amber-500 text-slate-900 shadow-amber-500/40'
              : 'bg-amber-900/50 border border-amber-700 text-amber-300 hover:bg-amber-800/60'
          }`}
        >
          ○ Look
        </button>
      </div>

    </div>
  );
}
