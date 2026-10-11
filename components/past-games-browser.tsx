'use client';
import { useEffect, useState, useCallback } from 'react';
import { GameState } from '@/types';
import { SheetRow, reconstructGame, buildFakeGameState } from '@/lib/game-reconstruct';
import { Matchup } from '@/components/matchup';

interface GameSummary {
  gameId: string;
  homeTeam: string;
  visitingTeam: string;
  firstTimestamp: string;
  lastTimestamp: string;
  pitchCount: number;
  /** 'active' = still open, 'final' = ended, '' = recorded before games were saved. */
  status?: string;
  weAreHome?: boolean | null;
}

interface PastGamesBrowserProps {
  webhookUrl: string;
  currentGameId?: string;
  onSelectGame: (state: GameState) => void;
  /** Reopens a game to keep tracking it; resolves to an error message or null. */
  onResumeGame: (gameId: string, status: string) => Promise<string | null>;
  onClose: () => void;
}

function formatDate(iso: string): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PastGamesBrowser({ webhookUrl, currentGameId, onSelectGame, onResumeGame, onClose }: PastGamesBrowserProps) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    if (!webhookUrl) {
      setError('Past games are not available right now.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sheets/games?${new URLSearchParams({ url: webhookUrl })}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      const list: GameSummary[] = (json.games ?? []).filter((g: GameSummary) => g.gameId !== currentGameId);
      setGames(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [webhookUrl, currentGameId]);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  async function handleResume(g: GameSummary) {
    setLoadingGameId(g.gameId);
    setError(null);
    const err = await onResumeGame(g.gameId, g.status ?? '');
    if (err) setError(err);
    setLoadingGameId(null);
  }

  async function handleSelect(gameId: string) {
    setLoadingGameId(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/sheets/scout?${new URLSearchParams({ url: webhookUrl, gameId })}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      const rows: SheetRow[] = json.pitches ?? [];
      if (rows.length === 0) { setError('No pitch data found for this game.'); return; }
      const game = reconstructGame(rows);
      const gameState = buildFakeGameState(game, webhookUrl);
      onSelectGame(gameState);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingGameId(null);
    }
  }

  return (
    <div className="fixed inset-0 h-dvh h-app bg-slate-950 text-slate-100 flex flex-col z-50">
      {/* Header — top padding cleared by env(safe-area-inset-top) so the
          Back button is never rendered under a mobile browser's own
          (still-animating) chrome. See hooks/use-viewport-height.ts and
          the .h-app class in globals.css for the companion dvh-lag fix.
          The 3.25rem floor is a deliberate hard minimum: in standalone
          PWA mode (no browser chrome to already push content down),
          env(safe-area-inset-top) has been observed reporting 0 on some
          iOS versions even though content is genuinely drawing under the
          Dynamic Island/notch — so we never rely on env() alone. */}
      <div
        className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: 'max(3.25rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-[24px] leading-none px-1"
        >
          ‹
        </button>
        <div className="flex-1">
          <p className="font-bold text-[21px]">Past Games</p>
          <p className="text-slate-500 text-[14px]">Tap a game to view it · ▶ to keep tracking</p>
        </div>
        <button
          onClick={fetchGames}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-[15px] font-medium border border-slate-700"
        >
          ↻
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && !games && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <p className="text-[18px]">Loading past games…</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 space-y-2">
            <p className="text-red-300 text-[16px] font-semibold">Couldn't load games</p>
            <p className="text-red-400/80 text-[14px]">{error}</p>
            <p className="text-slate-500 text-[13px]">
              Check your connection and try again.
            </p>
            <button
              onClick={fetchGames}
              className="mt-1 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[15px] border border-slate-700"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && games && games.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <span className="text-[48px]">📂</span>
            <p className="text-[18px] font-medium text-slate-300">No past games yet</p>
            <p className="text-[15px] text-center px-8">Completed games will show up here once you start a new game.</p>
          </div>
        )}

        {games && games.length > 0 && games.map(g => (
          <div
            key={g.gameId}
            className="w-full bg-slate-900 rounded-xl border border-slate-700 flex items-stretch overflow-hidden"
          >
            <button
              onClick={() => handleSelect(g.gameId)}
              disabled={loadingGameId !== null}
              className="flex-1 min-w-0 text-left p-4 active:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <Matchup myTeam={g.homeTeam} opponent={g.visitingTeam} weAreHome={g.weAreHome} />
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-slate-500 text-[14px]">{formatDate(g.lastTimestamp || g.firstTimestamp)}</span>
                <span className="text-slate-600 text-[14px]">·</span>
                <span className="text-slate-500 text-[14px]">{g.pitchCount} pitch{g.pitchCount !== 1 ? 'es' : ''}</span>
                {g.status === 'active' && (
                  <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-700/60">In progress</span>
                )}
                {g.status === 'final' && (
                  <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60">✓ Ended</span>
                )}
                {loadingGameId === g.gameId && <span className="text-slate-500 text-[14px]">Loading…</span>}
              </div>
            </button>
            <button
              onClick={() => handleResume(g)}
              disabled={loadingGameId !== null}
              className="flex-shrink-0 w-20 border-l border-slate-700 flex flex-col items-center justify-center gap-0.5 text-amber-300 hover:bg-slate-800 active:bg-slate-800 disabled:opacity-50"
              title="Resume tracking this game"
            >
              <span className="text-[20px] leading-none">▶</span>
              <span className="text-[13px] font-semibold">Resume</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
