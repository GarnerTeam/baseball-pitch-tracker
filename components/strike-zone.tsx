'use client';
import { PitchLocation, PitchRecord } from '@/types';
import { PITCH_TYPE_COLORS } from '@/types';

interface StrikeZoneProps {
  selected: PitchLocation | null;
  onSelect: (loc: PitchLocation) => void;
  currentAtBatPitches: PitchRecord[];
  historicalPitches: PitchRecord[];
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
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity }}>
      {isFoul
        ? <span className="text-[8px] font-bold" style={{ color }}>{pitch.outcome === 'foul-tip' ? '▲' : 'F'}</span>
        : <div className="rounded-full" style={{ width: 7, height: 7, background: pitch.swing ? color : 'transparent', border: `2px solid ${color}`, boxShadow: `0 0 4px ${color}` }} />
      }
    </div>
  );
}

export function StrikeZone({ selected, onSelect, currentAtBatPitches, historicalPitches }: StrikeZoneProps) {
  return (
    <div className="mx-auto" style={{ width: '80%', maxWidth: 205 }}>
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
            return (
              <button
                key={`${row}-${col}`}
                onClick={() => onSelect({ row, col, zone, zoneNumber: zn })}
                className={`relative flex items-center justify-center transition-all active:scale-95 ${
                  isSelected
                    ? 'bg-blue-600 ring-1 ring-blue-400 ring-offset-1 ring-offset-slate-900'
                    : zone === 'strike'
                    ? 'bg-slate-700 hover:bg-slate-600'
                    : 'bg-slate-800'
                }`}
                style={{ aspectRatio: '1' }}
              >
                {!isSelected && zn && <span className="text-slate-500 font-medium" style={{ fontSize: 8 }}>{zn}</span>}
                {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                {hist.map(p => <PitchDot key={p.id} pitch={p} opacity={0.72} />)}
                {cur.map(p => <PitchDot key={p.id} pitch={p} opacity={0.95} />)}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
