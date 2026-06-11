'use client';
import { Player } from '@/types';

interface PlayerHeaderProps {
  pitcher: Player;
  batter: Player;
  atBatNumber: number;
  onBatterClick?: () => void;
  onPitcherClick?: () => void;
}

export function PlayerHeader({ pitcher, batter, atBatNumber, onBatterClick, onPitcherClick }: PlayerHeaderProps) {
  const pitcherNum = pitcher.number?.trim() || '—';
  const batterNum  = batter.number?.trim()  || '—';

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">

      {/* Pitcher side — tappable to view pitcher stats */}
      <button
        onClick={onPitcherClick}
        disabled={!onPitcherClick}
        className="flex items-center gap-2 flex-1 min-w-0 active:opacity-70 transition-opacity disabled:cursor-default"
      >
        <span className="text-blue-400 text-[15px] font-bold uppercase tracking-wide flex-shrink-0">P</span>
        <span className="bg-blue-700 text-white text-[18px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0">
          #{pitcherNum}
        </span>
        <span className="text-slate-200 text-[21px] font-medium truncate">
          {pitcher.name || <span className="text-slate-500 italic">No pitcher</span>}
        </span>
        {onPitcherClick && pitcher.name?.trim() && (
          <span className="text-blue-600 text-[13px] flex-shrink-0">📊</span>
        )}
      </button>

      <div className="text-slate-600 text-[15px] px-2 flex-shrink-0">vs</div>

      {/* Batter side — tappable to view history */}
      <button
        onClick={onBatterClick}
        disabled={!onBatterClick}
        className="flex items-center gap-2 flex-1 justify-end min-w-0 active:opacity-70 transition-opacity disabled:cursor-default"
      >
        <span className="text-slate-200 text-[21px] font-medium truncate text-right">
          {batter.name && batter.name !== 'Add Batter'
            ? batter.name
            : <span className="text-slate-500 italic">Add Batter</span>
          }
        </span>
        {batter.name && batter.name !== 'Add Batter' && (
          <span className="bg-amber-600 text-white text-[18px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0">
            #{batterNum}
          </span>
        )}
        <span className="text-slate-500 text-[15px] flex-shrink-0">AB{atBatNumber}</span>
        {onBatterClick && <span className="text-slate-500 text-[15px] flex-shrink-0">▼</span>}
      </button>
    </div>
  );
}
