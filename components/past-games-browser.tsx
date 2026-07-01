'use client';
import { useEffect, useState, useCallback } from 'react';
import { GameState } from '@/types';
import { SheetRow, reconstructGame, buildFakeGameState } from '@/lib/game-reconstruct';

interface GameSummary {
  gameId: string;
  homeTeam: string;
  visitingTeam: string;
  firstTimestamp: string;
  lastTimestamp: string;
  pitchCount: number;
}

interface PastGamesBrowserProps {
  webhookUrl: string;
  currentGameId?: string;
  onSelectGame: (state: GameState) => void;
  onClose: () => void;
}

function formatDate(iso: string): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PastGamesBrowser({ webhookUrl, currentGameId, onSelectGame, onClose }: PastGamesBrowserProps) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    if (!webhookUrl) {
      setError('No Google Sheets connection configured. Connect a sheet on the Setup screen first.');
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
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col z-50">
      {/* Header */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-[24px] leading-none px-1"
        >
          ‹
        </button>
        <div className="flex-1">
          <p className="font-bold text-[21px]">Past Games</p>
          <p className="text-slate-500 text-[14px]">Tap a game to view read-only</p>
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
              Make sure the Apps Script has been updated with the "games" action and redeployed.
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
          <button
            key={g.gameId}
            onClick={() => handleSelect(g.gameId)}
            disabled={loadingGameId !== null}
            className="w-full text-left bg-slate-900 rounded-xl border border-slate-700 p-4 active:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-[19px] text-slate-100">
                <span className="text-emerald-300">{g.homeTeam || 'Home'}</span>
                <span className="text-slate-600 mx-1.5">vs</span>
                <span className="text-blue-300">{g.visitingTeam || 'Away'}</span>
              </p>
              {loadingGameId === g.gameId && (
                <span className="text-slate-500 text-[14px]">Loading…</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-slate-500 text-[14px]">{formatDate(g.lastTimestamp || g.firstTimestamp)}</span>
              <span className="text-slate-600 text-[14px]">·</span>
              <span className="text-slate-500 text-[14px]">{g.pitchCount} pitch{g.pitchCount !== 1 ? 'es' : ''}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
