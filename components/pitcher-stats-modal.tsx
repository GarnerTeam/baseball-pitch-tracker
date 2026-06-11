'use client';
import { Player, PitchRecord, AtBat } from '@/types';
import { PitchTypeBarChart, buildPitchTypeStats } from '@/components/pitch-type-chart';

interface PitcherStatsModalProps {
  pitcher: Player;
  allAtBats: AtBat[];
  currentAtBat: AtBat | null;
  onClose: () => void;
}

export function PitcherStatsModal({ pitcher, allAtBats, currentAtBat, onClose }: PitcherStatsModalProps) {
  const allPitches: PitchRecord[] = [
    ...allAtBats.flatMap(ab => ab.pitches),
    ...(currentAtBat?.pitches ?? []),
  ].filter(p => p.pitcherName === pitcher.name && p.pitcherNumber === pitcher.number);

  const total     = allPitches.length;
  const strikes   = allPitches.filter(p =>
    ['called-strike', 'swinging-strike', 'foul', 'foul-tip', 'strikeout', 'in-play'].includes(p.outcome)
  ).length;
  const bip       = allPitches.filter(p => p.outcome === 'in-play').length;
  const strikePct = total > 0 ? Math.round((strikes / total) * 100) : 0;
  const typeStats = buildPitchTypeStats(allPitches, true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 rounded-t-2xl border-t border-slate-700 p-5 pb-8 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-blue-600 text-white text-[21px] font-bold px-2 py-0.5 rounded-lg">
              #{pitcher.number || '—'}
            </span>
            <span className="font-semibold text-slate-100 text-[24px]">{pitcher.name}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-[30px] leading-none px-2"
          >✕</button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Pitches',  value: total },
            { label: 'Strikes',  value: strikes },
            { label: 'Strike%',  value: `${strikePct}%` },
            { label: 'In Play',  value: bip },
          ].map(s => (
            <div key={s.label} className="bg-slate-800 rounded-xl py-3 flex flex-col items-center gap-0.5">
              <span className="text-slate-100 text-[27px] font-bold leading-tight">{s.value}</span>
              <span className="text-slate-500 text-[15px] uppercase tracking-wide">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Pitch type breakdown */}
        {typeStats.length > 0 ? (
          <div>
            <p className="text-slate-500 text-[15px] uppercase tracking-wider mb-2">By Pitch Type</p>
            <PitchTypeBarChart stats={typeStats} height={150} />
          </div>
        ) : (
          <p className="text-slate-600 text-[21px] text-center py-2">No pitches recorded yet.</p>
        )}
      </div>
    </div>
  );
}
