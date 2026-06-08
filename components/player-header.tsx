'use client';
import { Player } from '@/types';

interface PlayerHeaderProps { pitcher: Player; batter: Player; atBatNumber: number; }

export function PlayerHeader({ pitcher, batter, atBatNumber }: PlayerHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-blue-400 text-xs font-bold uppercase">P</span>
        <span className="bg-blue-900 text-blue-200 text-xs font-bold px-1.5 py-0.5 rounded">#{pitcher.number}</span>
        <span className="text-slate-200 text-sm font-medium truncate">{pitcher.name}</span>
      </div>
      <div className="text-slate-500 text-xs px-2">vs</div>
      <div className="flex items-center gap-2 flex-1 justify-end">
        <span className="text-slate-200 text-sm font-medium truncate text-right">{batter.name}</span>
        <span className="bg-slate-700 text-slate-200 text-xs font-bold px-1.5 py-0.5 rounded">#{batter.number}</span>
        <span className="text-slate-500 text-xs">AB{atBatNumber}</span>
      </div>
    </div>
  );
}