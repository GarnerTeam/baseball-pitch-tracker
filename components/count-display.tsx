'use client';

interface CountDisplayProps { balls: number; strikes: number; pitchNumber: number; }

export function CountDisplay({ balls, strikes, pitchNumber }: CountDisplayProps) {
  return (
    <div className="flex items-center justify-between px-1">
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${i < balls ? 'bg-green-500 border-green-400' : 'bg-transparent border-slate-600'}`} />
          ))}
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${i < strikes ? 'bg-red-500 border-red-400' : 'bg-transparent border-slate-600'}`} />
          ))}
        </div>
      </div>
      <div className="text-slate-300 text-sm font-mono">
        <span className="text-green-400 font-bold">{balls}</span>
        <span className="text-slate-500">-</span>
        <span className="text-red-400 font-bold">{strikes}</span>
        <span className="text-slate-500 text-xs ml-2">#{pitchNumber}</span>
      </div>
    </div>
  );
}