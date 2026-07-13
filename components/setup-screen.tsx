'use client';
import { UserButton } from '@clerk/nextjs';
import { useState, useEffect, useRef } from 'react';
import { GameState } from '@/types';
import { reconstructGame, buildResumableGameState } from '@/lib/game-reconstruct';

interface SetupScreenProps {
  onStart: (homeTeam: string, visitingTeam: string) => void;
  webhookUrl: string;
  onSetWebhookUrl: (url: string) => void;
  onViewPastGames: () => void;
  onResumeGame: (state: GameState) => void;
}

interface GameSummary {
  gameId: string;
  homeTeam: string;
  visitingTeam: string;
  lastTimestamp: string;
  pitchCount: number;
}

// Only offer to resume a game whose most recent pitch was synced within this
// window — old completed games the coach already finished shouldn't keep
// popping up as a "resume?" prompt every time Setup loads.
const RESUME_WINDOW_HOURS = 20;

/**
 * Text input with an autocomplete dropdown of previously used team names
 * (pulled from every game recorded in the Sheet this season). Typing filters
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

export function SetupScreen({ onStart, webhookUrl, onSetWebhookUrl, onViewPastGames, onResumeGame }: SetupScreenProps) {
  const [home, setHome]         = useState('');
  const [visiting, setVisiting] = useState('');
  const [urlInput, setUrlInput] = useState(webhookUrl ?? '');
  const [editingUrl, setEditingUrl] = useState(!webhookUrl);
  const [knownTeams, setKnownTeams] = useState<string[]>([]);
  const [resumeCandidate, setResumeCandidate] = useState<GameSummary | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const isConnected = !!webhookUrl?.trim();
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
        const games: GameSummary[] = json.games ?? [];
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

        // ── Resume Game candidate ─────────────────────────────────
        // games[] is already sorted most-recently-active first. Offer the
        // most recent one with pitches, as long as it's recent enough to
        // plausibly still be "in progress" rather than an already-finished
        // game from a previous session.
        const candidate = games.find(g => g.pitchCount > 0);
        if (candidate) {
          const last = new Date(candidate.lastTimestamp);
          const hoursSince = isNaN(last.getTime()) ? Infinity : (Date.now() - last.getTime()) / 36e5;
          if (hoursSince <= RESUME_WINDOW_HOURS) {
            setResumeCandidate(candidate);
          }
        }
      } catch { /* silent — autocomplete is a nice-to-have, not critical */ }
    })();
    return () => { cancelled = true; };
  }, [webhookUrl]);

  function handleSaveUrl() {
    const trimmed = urlInput.trim();
    onSetWebhookUrl(trimmed);
    setEditingUrl(false);
  }

  function handleStart() {
    if (!canStart) return;
    // Save any pending URL before starting
    if (urlInput.trim() !== webhookUrl) {
      onSetWebhookUrl(urlInput.trim());
    }
    onStart(home.trim(), visiting.trim());
  }

  // ── Resume Game ─────────────────────────────────────────────────────────────
  // Rebuilds a live, continuable GameState from every pitch already synced
  // for this game (lineup, pitcher history, full pitch log for insights) and
  // hands it to the real game reducer — see buildResumableGameState() for
  // exactly what is/isn't restored.
  async function handleResume() {
    if (!resumeCandidate || !webhookUrl) return;
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch(`/api/sheets/scout?${new URLSearchParams({ url: webhookUrl, gameId: resumeCandidate.gameId })}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const rows = json.pitches ?? [];
      if (rows.length === 0) throw new Error('No pitch data found for this game.');
      const game = reconstructGame(rows);
      const resumedState = buildResumableGameState(game, webhookUrl);
      onResumeGame(resumedState);
    } catch (e) {
      setResumeError(String(e instanceof Error ? e.message : e));
    } finally {
      setResuming(false);
    }
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

        {/* ── Resume Game banner ── */}
        {resumeCandidate && (
          <div className="rounded-2xl border border-blue-700 bg-blue-950/40 px-4 py-3 space-y-2">
            <p className="text-blue-300 text-[15px] font-bold uppercase tracking-wide">⏱ Continue Last Game?</p>
            <p className="text-[18px]">
              <span className="text-emerald-300 font-semibold">{resumeCandidate.homeTeam || 'Home'}</span>
              <span className="text-slate-600 mx-1.5">vs</span>
              <span className="text-blue-300 font-semibold">{resumeCandidate.visitingTeam || 'Away'}</span>
            </p>
            <p className="text-slate-500 text-[13px]">
              {resumeCandidate.pitchCount} pitch{resumeCandidate.pitchCount !== 1 ? 'es' : ''} recorded so far · lineup and pitcher are restored, picks up with the next batter
            </p>
            {resumeError && (
              <p className="text-red-400 text-[13px]">{resumeError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleResume}
                disabled={resuming}
                className="flex-1 h-10 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-[16px] font-semibold transition-colors"
              >
                {resuming ? 'Loading…' : 'Resume Game'}
              </button>
              <button
                onClick={() => setResumeCandidate(null)}
                disabled={resuming}
                className="px-4 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-[16px] transition-colors disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* ── Data Backup Section ── */}
        <div className={`rounded-2xl border ${isConnected && !editingUrl ? 'border-emerald-700 bg-emerald-950/40' : 'border-amber-700 bg-amber-950/30'} overflow-hidden`}>

          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[21px]">{isConnected && !editingUrl ? '✅' : '⚠️'}</span>
              <span className={`text-[18px] font-bold ${isConnected && !editingUrl ? 'text-emerald-300' : 'text-amber-300'}`}>
                {isConnected && !editingUrl ? 'Data Backup Connected' : 'Data Backup Required'}
              </span>
            </div>
            {isConnected && !editingUrl && (
              <button
                onClick={() => setEditingUrl(true)}
                className="text-slate-500 hover:text-slate-300 text-[15px] underline"
              >
                Change
              </button>
            )}
          </div>

          {/* Connected state — collapsed */}
          {isConnected && !editingUrl && (
            <div className="px-4 pb-3">
              <p className="text-emerald-400/80 text-[15px]">
                Every pitch saves automatically to your Google Sheet. Your data is safe even if your browser closes.
              </p>
            </div>
          )}

          {/* Not connected OR editing — show input */}
          {(!isConnected || editingUrl) && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-amber-200/80 text-[15px] leading-snug">
                Without this, game data is only stored on this device. A browser refresh or phone crash <span className="font-bold text-amber-300">will permanently erase your data.</span>
              </p>

              {/* PDF instructions link */}
              <a
                href="https://galaxy-prod.tlcdn.com/gen/user_36WGxyCD8MIKwlVSJacTZnpAQVO/07812bbc-6846-4ea8-9ec9-8980e8106254.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-400 text-[15px] font-medium hover:text-blue-300 transition-colors"
              >
                <span className="text-[18px]">📄</span>
                <span className="underline">Setup Instructions (PDF)</span>
              </a>

              {/* URL input */}
              <div className="space-y-2">
                <p className="text-slate-400 text-[15px]">Paste your Google Sheets webhook URL:</p>
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  className="w-full h-10 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-3 text-[13px] outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveUrl}
                    disabled={!urlInput.trim()}
                    className="flex-1 h-9 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[16px] font-semibold transition-colors"
                  >
                    Connect
                  </button>
                  {editingUrl && isConnected && (
                    <button
                      onClick={() => { setUrlInput(webhookUrl); setEditingUrl(false); }}
                      className="px-4 h-9 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-[16px] transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Skip warning */}
              {!isConnected && (
                <p className="text-slate-600 text-[13px] text-center">
                  You can still start a game without backup — at your own risk.
                </p>
              )}
            </div>
          )}
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
                : isConnected
                  ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/40'
                  : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40'
            }`}
          >
            {!canStart ? '⚾ Start Game' : isConnected ? '⚾ Start Game' : '⚠️ Start Without Backup'}
          </button>

          {!isConnected && canStart && (
            <p className="text-center text-amber-600/70 text-[13px]">
              Data will only be saved on this device
            </p>
          )}
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
