'use client';
import { Player } from '@/types';

interface PlayerHeaderProps {
  pitcher: Player;
  onPitcherClick?: () => void;
}

export function PlayerHeader({ pitcher, onPitcherClick }: PlayerHeaderProps) {
  const pitcherNum = pitcher.number?.trim() || '—';

  return (
    <div className="flex items-center px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">

      {/* Pitcher row — full width, tappable */}
      <button
        onClick={onPitcherClick}
        disabled={!onPitcherClick}
        className="flex items-center gap-2 w-full min-w-0 active:opacity-70 transition-opacity disabled:cursor-default"
      >
        <span className="text-blue-400 text-[15px] font-bold uppercase tracking-wide flex-shrink-0">P</span>
        <span className="bg-blue-700 text-white text-[18px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0">
          #{pitcherNum}
        </span>
        <span className="text-slate-200 text-[21px] font-medium truncate">
          {pitcher.name || <span className="text-slate-500 italic">No pitcher</span>}
        </span>
        {pitcher.hand && (
          <span className={`text-[13px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
            pitcher.hand === 'R' ? 'bg-blue-900 text-blue-300' : 'bg-amber-900 text-amber-300'
          }`}>
            {pitcher.hand === 'R' ? 'RHP' : 'LHP'}
          </span>
        )}
        {onPitcherClick && pitcher.name?.trim() && (
          <span className="text-blue-600 text-[13px] flex-shrink-0 ml-auto">📊</span>
        )}
      </button>
    </div>
  );
}
