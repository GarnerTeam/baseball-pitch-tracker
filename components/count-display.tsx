'use client';

interface CountDisplayProps {
  balls: number;
  strikes: number;
  pitchNumber: number;
  canUndo?: boolean;
  onUndo?: () => void;
}

export function CountDisplay({ balls, strikes, canUndo, onUndo }: CountDisplayProps) {
  return (
    <div className="flex items-center justify-between px-1">
      {/* Ball and strike dot indicators only — no numeric labels */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${
                i < balls ? 'bg-green-500 border-green-400' : 'bg-transparent border-slate-600'
              }`}
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${
                i < strikes ? 'bg-red-500 border-red-400' : 'bg-transparent border-slate-600'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Undo — same height as bottom-row buttons */}
      {onUndo !== undefined && (
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`h-9 px-4 rounded-lg text-[21px] font-medium transition-colors ${
            canUndo
              ? 'bg-slate-800 hover:bg-amber-900 text-amber-400'
              : 'bg-slate-900 text-slate-700 cursor-not-allowed'
          }`}
        >
          ↩ Undo
        </button>
      )}
    </div>
  );
}
