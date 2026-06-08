'use client';
import { PitchRecord } from '@/types';
import { PITCH_TYPE_COLORS } from '@/types';

const OUTCOME_SYM: Record<string, string> = { ball:'B','called-strike':'Kc','swinging-strike':'Ks',foul:'F','foul-tip':'FT','in-play':'IP',walk:'BB',strikeout:'K' };
const OUTCOME_COL: Record<string, string> = { ball:'#22c55e','called-strike':'#ef4444','swinging-strike':'#dc2626',foul:'#f97316','foul-tip':'#fb923c','in-play':'#3b82f6',walk:'#10b981',strikeout:'#7f1d1d' };

export function PitchHistoryStrip({ pitches }: { pitches: PitchRecord[] }) {
  const last5 = pitches.slice(-5);
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {last5.map((p) => {
        const sym = OUTCOME_SYM[p.outcome] ?? p.outcome;
        const col = OUTCOME_COL[p.outcome] ?? '#64748b';
        const typeCol = PITCH_TYPE_COLORS[p.pitchType];
        return (
          <div key={p.id} className="flex-shrink-0 rounded-lg px-2 py-1 text-center min-w-[44px]" style={{ background: col + '22', border: `1px solid ${col}55` }}>
            <div className="text-xs font-bold" style={{ color: typeCol }}>{p.pitchType}</div>
            <div className="text-xs font-bold" style={{ color: col }}>{sym}</div>
            <div className="text-slate-500 text-[10px]">{p.ballsAfter}-{p.strikesAfter}</div>
          </div>
        );
      })}
    </div>
  );
}