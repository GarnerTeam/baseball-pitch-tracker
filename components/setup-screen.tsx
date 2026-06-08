'use client';
import { useState } from 'react';
import { Player } from '@/types';

interface SetupScreenProps { onStart: (pitcher: Player, lineup: Player[]) => void; }
function emptyPlayer(): Player { return { id: crypto.randomUUID(), name: '', number: '' }; }

export function SetupScreen({ onStart }: SetupScreenProps) {
  const [pitcher, setPitcher] = useState<Player>(emptyPlayer());
  const [lineup, setLineup] = useState<Player[]>([emptyPlayer(), emptyPlayer(), emptyPlayer()]);
  const updateP = (f: keyof Player, v: string) => setPitcher(p => ({ ...p, [f]: v }));
  const updateB = (idx: number, f: keyof Player, v: string) => setLineup(l => l.map((b, i) => i === idx ? { ...b, [f]: v } : b));
  const canStart = pitcher.name.trim() && pitcher.number.trim() && lineup.length > 0 && lineup.every(b => b.name.trim() && b.number.trim());
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 pb-8 overflow-y-auto">
      <div className="max-w-md mx-auto space-y-5">
        <div className="text-center pt-6 pb-2">
          <div className="text-4xl mb-2">⚾</div>
          <h1 className="text-2xl font-bold">Pitch Tracker</h1>
          <p className="text-slate-400 text-sm mt-1">Set up your game to get started</p>
        </div>
        {/* Pitcher card */}
        <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-3">Pitcher</p>
          <div className="flex gap-3">
            <input value={pitcher.number} onChange={e => updateP('number', e.target.value)} placeholder="#" maxLength={3}
              className="w-16 h-12 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 text-center text-lg font-bold outline-none focus:border-blue-500 flex-shrink-0" />
            <input value={pitcher.name} onChange={e => updateP('name', e.target.value)} placeholder="Pitcher name"
              className="flex-1 h-12 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500" />
          </div>
        </div>
        {/* Lineup card */}
        <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-3">Batting Lineup</p>
          <div className="space-y-2">
            {lineup.map((b, idx) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="text-slate-500 text-sm w-5 text-right">{idx + 1}.</span>
                <input value={b.number} onChange={e => updateB(idx, 'number', e.target.value)} placeholder="#" maxLength={3}
                  className="w-14 h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 text-center font-bold outline-none focus:border-blue-500 flex-shrink-0" />
                <input value={b.name} onChange={e => updateB(idx, 'name', e.target.value)} placeholder={`Batter ${idx + 1}`}
                  className="flex-1 h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500" />
                {lineup.length > 1 && <button onClick={() => setLineup(l => l.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-red-400 text-xl w-8 flex-shrink-0">&times;</button>}
              </div>
            ))}
          </div>
          <button onClick={() => setLineup(l => [...l, emptyPlayer()])} className="mt-3 w-full h-10 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300 text-sm transition-colors">
            + Add Batter
          </button>
        </div>
        <button onClick={() => canStart && onStart({ ...pitcher, name: pitcher.name.trim(), number: pitcher.number.trim() }, lineup.map(b => ({ ...b, name: b.name.trim(), number: b.number.trim() })))} disabled={!canStart}
          className={`w-full h-14 rounded-2xl text-lg font-bold transition-all ${canStart ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
          ⚾ Start Game
        </button>
      </div>
    </div>
  );
}