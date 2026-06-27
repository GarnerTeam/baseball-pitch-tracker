'use client';
import { useEffect, useState, useCallback } from 'react';
import { GameState } from '@/types';
import { LineupPanel } from '@/components/lineup-panel';
import { AnalyticsScreen } from '@/components/analytics-screen';

const STORAGE_KEY = 'baseball-pitch-tracker-v1';

function noop() {}
function noopP(_: unknown) {}

type Tab = 'lineup' | 'stats';

export function ScoutClient() {
  const [state, setState] = useState<GameState | null>(null);
  const [tab, setTab] = useState<Tab>('lineup');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as GameState;
        setState(parsed);
        setLastRefresh(new Date());
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Initial load + auto-refresh every 15 s
  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  // ── No data yet ────────────────────────────────────────────────────────────
  if (!state || state.phase === 'setup') {
    return (
      <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
        <span className="text-6xl">⚾</span>
        <p className="text-2xl font-bold text-slate-200">Waiting for game to start…</p>
        <p className="text-slate-500 text-center text-lg">
          This view updates automatically every 15 seconds.
        </p>
        <button
          onClick={load}
          className="mt-4 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-lg font-medium border border-slate-700"
        >
          Refresh now
        </button>
      </div>
    );
  }

  const timeStr = lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between">
        <div>
          <p className="text-slate-100 font-bold text-lg leading-tight">
            {state.homeTeam ?? 'Home'} vs {state.visitingTeam ?? 'Away'}
          </p>
          <p className="text-slate-500 text-xs">View only · updated {timeStr}</p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-sm font-medium border border-slate-700 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex-shrink-0 flex bg-slate-900 border-b border-slate-800">
        {(['lineup', 'stats'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-base font-semibold tracking-wide transition-colors ${
              tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t === 'lineup' ? '👥 Lineup' : '📊 Stats'}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0">
        {tab === 'lineup' && (
          <LineupPanel
            readOnly
            state={state}
            onNextBatter={noop}
            onPrevBatter={noop}
            onEndAtBat={noop}
            onChangePitcher={noopP}
            onAddBatter={noopP}
            onRemoveBatter={noopP}
            onSetBatterAt={noopP}
            onUndoLastEnd={noop}
            onSetWebhookUrl={noopP}
          />
        )}
        {tab === 'stats' && (
          <AnalyticsScreen state={state} />
        )}
      </div>

    </div>
  );
}
