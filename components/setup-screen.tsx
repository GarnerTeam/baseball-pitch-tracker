'use client';
import { UserButton } from '@clerk/nextjs';
import { useState, useEffect, useRef } from 'react';

interface SetupScreenProps {
  onStart: (homeTeam: string, visitingTeam: string) => void;
  webhookUrl: string;
  onViewPastGames: () => void;
}

/**
 * Text input with an autocomplete dropdown of previously used team names
 * (pulled from every game recorded this season). Typing filters
 * the list; tapping a suggestion fills the field. Falls back to a plain
 * text input with no dropdown if no team names are known yet.
 */
function TeamNameInput({
  value, onChange, placeholder, knownTeams, accentColor, onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  knownTeams: string[];
  accentColor: 'emerald' | 'blue';
  onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matches = knownTeams.filter(t =>
    t.toLowerCase().includes(value.trim().toLowerCase())
  );
  const showDropdown = open && knownTeams.length > 0 && matches.length > 0;
  const focusBorder = accentColor === 'emerald' ? 'focus:border-emerald-500' : 'focus:border-blue-500';

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        className={`w-full h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-4 text-[21px] font-medium outline-none ${focusBorder} transition-colors placeholder:text-slate-600`}
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-slate-800 border border-slate-600 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {matches.map(team => (
            <button
              key={team}
              type="button"
              onClick={() => { onChange(team); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-[18px] text-slate-200 hover:bg-slate-700 active:bg-slate-700 transition-colors border-b border-slate-700/60 last:border-0"
            >
              {team}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SetupScreen({ onStart, webhookUrl, onViewPastGames }: SetupScreenProps) {
  const [home, setHome]         = useState('');
  const [visiting, setVisiting] = useState('');
  const [knownTeams, setKnownTeams] = useState<string[]>([]);

  const canStart    = home.trim().length > 0 && visiting.trim().length > 0;

  // Pull every team name seen across the season (both home and away) from
  // past games, so coaches can pick from a list instead of retyping names.
  useEffect(() => {
    if (!webhookUrl) { setKnownTeams([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sheets/games?${new URLSearchParams({ url: webhookUrl })}`);
        const json = await res.json();
        if (cancelled || json.error) return;
        const games: { homeTeam?: string; visitingTeam?: string }[] = json.games ?? [];
        const seen = new Set<string>();
        const names: string[] = [];
        for (const g of games) {
          for (const raw of [g.homeTeam, g.visitingTeam]) {
            const name = (raw ?? '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (!seen.has(key)) { seen.add(key); names.push(name); }
          }
        }
        names.sort((a, b) => a.localeCompare(b));
        setKnownTeams(names);
      } catch { /* silent — autocomplete is a nice-to-have, not critical */ }
    })();
    return () => { cancelled = true; };
  }, [webhookUrl]);

  function handleStart() {
    if (!canStart) return;
    onStart(home.trim(), visiting.trim());
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">

        {/* ── Header ── */}
        <div className="text-center pb-1">
          <div className="text-[60px] mb-2">⚾</div>
          <h1 className="text-[39px] font-bold tracking-tight">On the Bump</h1>
          <p className="text-slate-400 text-[18px] mt-1">Coach's pitch tracking tool</p>
        </div>

        {/* ── Team Entry Card ── */}
        {/* overflow-visible (not hidden) — the Opposing Team autocomplete
            dropdown must be able to extend past this card's bottom edge */}
        <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-visible">

          <div className="px-4 pt-4 pb-3">
            <label className="block text-[16px] font-bold uppercase tracking-widest text-emerald-400 mb-2">
              🏠 My Team
            </label>
            <TeamNameInput
              value={home}
              onChange={setHome}
              placeholder="e.g. Rockets"
              knownTeams={knownTeams}
              accentColor="emerald"
            />
          </div>

          <div className="flex items-center px-4 py-1">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-600 text-[16px] px-3">vs</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          <div className="px-4 pt-1 pb-4">
            <label className="block text-[16px] font-bold uppercase tracking-widest text-blue-400 mb-2">
              ✈ Opposing Team Name
            </label>
            <TeamNameInput
              value={visiting}
              onChange={setVisiting}
              placeholder="Opposing team name"
              knownTeams={knownTeams}
              accentColor="blue"
              onEnter={() => { if (canStart) handleStart(); }}
            />
          </div>
        </div>

        {/* Preview */}
        {canStart && (
          <p className="text-center text-slate-400 text-[18px]">
            <span className="text-emerald-300 font-semibold">{home.trim()}</span>
            <span className="text-slate-600 mx-2">vs</span>
            <span className="text-blue-300 font-semibold">{visiting.trim()}</span>
          </p>
        )}

        {/* Start button */}
        <div className="space-y-2">
          <button
            onClick={handleStart}
            disabled={!canStart}
            className={`w-full h-13 rounded-2xl text-[24px] font-bold transition-all py-3 ${
              !canStart
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/40'
            }`}
          >
            ⚾ Start Game
          </button>
        </div>

        <button
          onClick={onViewPastGames}
          className="w-full h-11 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[17px] font-medium transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-[19px]">📂</span> View Past Games
        </button>

        <p className="text-center text-slate-600 text-[15px]">
          Pitcher and batting lineup are added on the Lineup tab
        </p>

      </div>
    </div>
  );
}
