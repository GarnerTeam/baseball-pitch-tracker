'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { BatterHistoryModal } from '@/components/batter-history-modal';
import { LineupPanel } from '@/components/lineup-panel';
import { PitchRowLite } from '@/lib/sheets';
import { GameState } from '@/types';

import {
  SheetRow, ScoutGame, ScoutAtBat,
  reconstructGame, buildFakeGameState,
} from '@/lib/game-reconstruct';

// ── Stats helpers (for the stats tab — unchanged) ────────────────────────────────────
const PT_COLOR: Record<string, string> = { FB: '#ef4444', CB: '#22c55e', SL: '#8b5cf6', CH: '#f97316' };
const OUTCOME_COLOR: Record<string, string> = {
  'called-strike': '#ef4444', 'swinging-strike': '#ef4444', strikeout: '#ef4444',
  walk: '#22c55e', 'in-play': '#3b82f6', foul: '#f97316', ball: '#64748b',
};
const OUTCOME_LABEL: Record<string, string> = {
  'called-strike': 'K', 'swinging-strike': 'K', strikeout: 'K',
  walk: 'BB', 'in-play': '●', foul: 'F', 'foul-tip': 'FT', ball: 'B',
};
const HIT_COLOR: Record<string, string> = {
  out: '#ef4444', error: '#f97316', single: '#22c55e', double: '#22c55e',
  triple: '#22c55e', 'home-run': '#eab308',
};
const HIT_LABEL: Record<string, string> = {
  out: 'Out', error: 'Err', single: '1B', double: '2B', triple: '3B', 'home-run': 'HR',
};

function abResultLabel(ab: ScoutAtBat) {
  if (ab.hitResult) return HIT_LABEL[ab.hitResult] ?? ab.hitResult;
  if (ab.finalOutcome === 'strikeout') return 'K';
  if (ab.finalOutcome === 'walk') return 'BB';
  return ab.finalOutcome ? (OUTCOME_LABEL[ab.finalOutcome] ?? ab.finalOutcome) : '—';
}
function abResultColor(ab: ScoutAtBat) {
  if (ab.hitResult) return HIT_COLOR[ab.hitResult] ?? '#94a3b8';
  return OUTCOME_COLOR[ab.finalOutcome] ?? '#94a3b8';
}

// ── Swipe hook ───────────────────────────────────────────────────────────────────
function useSwipe(onLeft: () => void, onRight: () => void) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.targetTouches[0].clientX;
      startY.current = e.targetTouches[0].clientY;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (startX.current === null || startY.current === null) return;
      const dx = startX.current - e.changedTouches[0].clientX;
      const dy = startY.current - e.changedTouches[0].clientY;
      startX.current = null; startY.current = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onLeft();
      if (dx < 0) onRight();
    },
  };
}

const URL_KEY = 'scout-webhook-url';
const OWNER_KEY = 'scout-owner-id';
const NOOP = () => {};

// ── Main ─────────────────────────────────────────────────────────────────────
export function ScoutClient() {
  const searchParams = useSearchParams();
  const DEFAULT_URL = process.env.NEXT_PUBLIC_SCOUT_WEBHOOK_URL ?? '';

  const [webhookUrl, setWebhookUrl] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_URL;
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('url');
    if (paramUrl) {
      try { localStorage.setItem(URL_KEY, paramUrl); } catch {}
      return paramUrl;
    }
    try { return localStorage.getItem(URL_KEY) ?? DEFAULT_URL; } catch { return DEFAULT_URL; }
  });
  const [urlInput, setUrlInput] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_URL;
    const params = new URLSearchParams(window.location.search);
    return params.get('url') ?? ((() => { try { return localStorage.getItem(URL_KEY) ?? DEFAULT_URL; } catch { return DEFAULT_URL; } })());
  });
  // owner = the data owner's Clerk user id, embedded in the shared Scout link.
  // Required now that the sheet holds multiple users' data — without it the
  // Apps Script has no way to know whose games to return.
  const [ownerId, setOwnerId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const paramOwner = params.get('owner');
    if (paramOwner) {
      try { localStorage.setItem(OWNER_KEY, paramOwner); } catch {}
      return paramOwner;
    }
    try { return localStorage.getItem(OWNER_KEY) ?? ''; } catch { return ''; }
  });
  const [game, setGame]               = useState<ScoutGame | null>(null);
  const [loading, setLoading]         = useState(false);
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tab, setTab]                 = useState<'lineup' | 'stats'>('lineup');

  // Keep in sync if the URL params change while mounted
  useEffect(() => {
    const paramUrl = searchParams?.get('url');
    if (paramUrl && paramUrl !== webhookUrl) {
      try { localStorage.setItem(URL_KEY, paramUrl); } catch {}
      setWebhookUrl(paramUrl);
      setUrlInput(paramUrl);
    }
    const paramOwner = searchParams?.get('owner');
    if (paramOwner && paramOwner !== ownerId) {
      try { localStorage.setItem(OWNER_KEY, paramOwner); } catch {}
      setOwnerId(paramOwner);
    }
  }, [searchParams]);

  const fetchGame = useCallback(async (url: string, owner: string) => {
    if (!url || !owner) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res  = await fetch(`/api/sheets/scout?${new URLSearchParams({ url, owner })}`);
      const json = await res.json();
      if (json.error) { setFetchError(json.error); return; }
      const rows: SheetRow[] = json.pitches ?? [];
      setGame(reconstructGame(rows));
      setLastRefresh(new Date());
    } catch (e) { setFetchError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!webhookUrl || !ownerId) return;
    fetchGame(webhookUrl, ownerId);
    const id = setInterval(() => fetchGame(webhookUrl, ownerId), 30_000);
    return () => clearInterval(id);
  }, [webhookUrl, ownerId, fetchGame]);

  // Stats-tab pitcher navigation (swipe)
  const [statsPitcherIdx, setStatsPitcherIdx] = useState(0);
  const statsSwipe = useSwipe(
    () => statsPitchers.length > 0 && setStatsPitcherIdx(i => Math.min(i + 1, statsPitchers.length - 1)),
    () => setStatsPitcherIdx(i => Math.max(i - 1, 0)),
  );

  // ── URL / owner setup ───────────────────────────────────────────────
  if (!webhookUrl || !ownerId) {
    return (
      <div className="fixed inset-0 h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-5 p-8">
        <span className="text-6xl">⚾</span>
        <p className="text-2xl font-bold">Scout View</p>
        <p className="text-slate-400 text-center">Ask your coach for the Scout link — it carries everything needed to load their game data.</p>
        <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)}
          placeholder="https://script.google.com/macros/s/…/exec" rows={3}
          className="w-full max-w-md rounded-xl bg-slate-800 border border-slate-600 text-slate-100 text-sm p-3 outline-none focus:border-blue-500 font-mono" />
        <input value={ownerId} onChange={e => setOwnerId(e.target.value)}
          placeholder="owner id (from the coach's Scout link)"
          className="w-full max-w-md h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 text-sm px-3 outline-none focus:border-blue-500 font-mono" />
        <button disabled={!urlInput.trim() || !ownerId.trim()}
          onClick={() => {
            const u = urlInput.trim();
            localStorage.setItem(URL_KEY, u);
            localStorage.setItem(OWNER_KEY, ownerId.trim());
            setWebhookUrl(u);
          }}
          className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-lg font-semibold">
          Connect
        </button>
      </div>
    );
  }

  if (loading && !game) return (
    <div className="fixed inset-0 h-dvh bg-slate-950 text-slate-400 flex items-center justify-center text-xl">Loading…</div>
  );

  if (fetchError && !game) return (
    <div className="fixed inset-0 h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <p className="text-red-400 text-lg font-semibold">Failed to load data</p>
      <p className="text-slate-500 text-sm text-center">{fetchError}</p>
      <p className="text-slate-600 text-xs text-center">Make sure the Apps Script has been updated with the new doGet() and redeployed.</p>
      <button onClick={() => fetchGame(webhookUrl, ownerId)} className="px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-base font-medium">Retry</button>
      <button onClick={() => { localStorage.removeItem(URL_KEY); setWebhookUrl(''); }} className="text-slate-600 text-sm underline mt-2">Change URL</button>
    </div>
  );

  if (!game || game.allRows.length === 0) return (
    <div className="fixed inset-0 h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <span className="text-5xl">⚾</span>
      <p className="text-xl font-bold text-slate-300">No game data yet</p>
      <p className="text-slate-500 text-center">Waiting for pitches to sync from the recording device.</p>
      <button onClick={() => fetchGame(webhookUrl, ownerId)} className="mt-2 px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-base">Refresh</button>
    </div>
  );

  const timeStr = lastRefresh?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '';

  // Build the fake GameState for LineupPanel (lineup tab)
  const fakeState = buildFakeGameState(game, webhookUrl);

  // Stats tab: pitcher data (unchanged logic)
  const statsPitchers = [...game.pitchers].reverse(); // current first
  const safeStatsIdx = Math.min(statsPitcherIdx, Math.max(0, statsPitchers.length - 1));
  const statsPitcher = statsPitchers[safeStatsIdx] ?? null;
  const isCurrentPitcher = safeStatsIdx === 0;

  const pitcherRows = statsPitcher
    ? game.allRows.filter(r => String(r.pitcherName) === statsPitcher.name && String(r.pitcherNumber) === statsPitcher.number)
    : game.allRows;
  const pitcherBatters = statsPitcher
    ? game.batters.map(b => ({
        ...b,
        atBats: b.atBats.map(ab => ({
          ...ab,
          pitches: ab.pitches.filter(p => String(p.pitcherName) === statsPitcher.name && String(p.pitcherNumber) === statsPitcher.number),
        })).filter(ab => ab.pitches.length > 0),
      })).filter(b => b.atBats.length > 0)
    : game.batters;

  const totalP     = pitcherRows.length;
  const strikes    = pitcherRows.filter(p => ['called-strike','swinging-strike','foul','foul-tip','in-play','strikeout'].includes(String(p.outcome))).length;
  const walks      = pitcherRows.filter(p => String(p.outcome) === 'walk').length;
  const strikeouts = pitcherRows.filter(p => String(p.outcome) === 'strikeout').length;
  const inPlay     = pitcherRows.filter(p => String(p.outcome) === 'in-play').length;
  const strikePct  = totalP > 0 ? Math.round((strikes / totalP) * 100) : 0;
  const ptCounts: Record<string, number> = {};
  for (const p of pitcherRows) { const t = String(p.pitchType || '?').toUpperCase(); ptCounts[t] = (ptCounts[t] ?? 0) + 1; }
  const ptEntries = Object.entries(ptCounts).sort((a, b) => b[1] - a[1]);
  const outcomeCounts: Record<string, number> = {};
  for (const p of pitcherRows) { const o = String(p.outcome || '?'); outcomeCounts[o] = (outcomeCounts[o] ?? 0) + 1; }

  return (
    <div className="fixed inset-0 h-dvh bg-slate-950 text-slate-100 flex flex-col">

      {/* Header */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between">
        <div>
          <p className="text-slate-100 font-bold text-lg leading-tight">
            {game.homeTeam || 'Home'} vs {game.visitingTeam || 'Away'}
          </p>
          <p className="text-slate-500 text-xs">View only · {timeStr}{loading ? ' · refreshing…' : ''}</p>
        </div>
        <button onClick={() => fetchGame(webhookUrl, ownerId)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-medium border border-slate-700">↻</button>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex bg-slate-900 border-b border-slate-800">
        {(['lineup', 'stats'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-base font-semibold tracking-wide transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
            {t === 'lineup' ? '👥 Lineup' : '📊 Stats'}
          </button>
        ))}
      </div>

      {/* ── LINEUP TAB: exact carbon copy of LineupPanel in readOnly mode ── */}
      {tab === 'lineup' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <LineupPanel
            state={fakeState}
            readOnly={true}
            ownerId={ownerId}
            onNextBatter={NOOP}
            onPrevBatter={NOOP}
            onEndAtBat={NOOP}
            onChangePitcher={NOOP}
            onAddBatter={NOOP}
            onRemoveBatter={NOOP}
            onSetBatterAt={NOOP}
            onReorderBatter={NOOP}
            onEditPitch={NOOP}
            onUndoLastEnd={NOOP}
            onSetWebhookUrl={NOOP}
          />
        </div>
      )}

      {/* ── STATS TAB ── */}
      {tab === 'stats' && (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* Pitcher header with swipe */}
          <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800" {...statsSwipe}>
            <div className="flex items-center gap-3 px-4 pt-3 pb-2">
              <span className="bg-blue-600 text-white text-[21px] font-bold px-2.5 py-0.5 rounded-lg flex-shrink-0">
                #{statsPitcher?.number || '—'}
              </span>
              <span className="font-semibold text-[22px] text-slate-100 truncate flex-1">
                {statsPitcher?.name || 'No Pitcher'}
              </span>
              <span className="text-[15px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full"
                style={{ background: isCurrentPitcher ? '#166534' : 'transparent', color: isCurrentPitcher ? '#fff' : '#64748b' }}>
                {isCurrentPitcher ? 'Current' : 'Previous'}
              </span>
            </div>
            {statsPitchers.length > 1 && (
              <div className="flex items-center justify-center gap-2 pb-2">
                <button onClick={() => safeStatsIdx > 0 && setStatsPitcherIdx(safeStatsIdx - 1)} disabled={safeStatsIdx === 0}
                  className="text-slate-500 disabled:opacity-20 text-[21px] px-1">‹</button>
                {statsPitchers.map((_, i) => (
                  <button key={i} onClick={() => setStatsPitcherIdx(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${i === safeStatsIdx ? 'bg-blue-400' : 'bg-slate-700'}`} />
                ))}
                <button onClick={() => safeStatsIdx < statsPitchers.length - 1 && setStatsPitcherIdx(safeStatsIdx + 1)} disabled={safeStatsIdx === statsPitchers.length - 1}
                  className="text-slate-500 disabled:opacity-20 text-[21px] px-1">›</button>
              </div>
            )}
          </div>

          <div className="p-4 space-y-4">

            {/* ── Performance: horizontal bar chart ── */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 space-y-3">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium">Performance</p>
              {[
                { label: 'Batters Faced', value: pitcherBatters.length, color: '#3b82f6' },
                { label: 'Strikeouts',    value: strikeouts,             color: '#ef4444' },
                { label: 'Walks',         value: walks,                  color: '#22c55e' },
              ].map(bar => {
                const maxVal = Math.max(pitcherBatters.length, strikeouts, walks, 1);
                const pct = Math.max((bar.value / maxVal) * 100, bar.value > 0 ? 2 : 0);
                return (
                  <div key={bar.label} className="flex items-center gap-3">
                    <span className="text-slate-300 text-[16px] w-32 flex-shrink-0">{bar.label}</span>
                    <span className="text-white font-black text-[20px] w-8 text-right flex-shrink-0">{bar.value}</span>
                    <div className="flex-1 rounded-full overflow-hidden" style={{ height: 18, backgroundColor: '#1e293b' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: bar.color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Strike %', value: `${strikePct}%` },
                { label: 'Total Pitches', value: totalP },
                { label: 'Strikeouts', value: strikeouts },
              ].map(c => (
                <div key={c.label} className="bg-slate-900 rounded-xl border border-slate-700 p-3 text-center">
                  <p className="text-slate-400 text-[13px] uppercase tracking-wide mb-1">{c.label}</p>
                  <p className="text-white font-black text-[28px] leading-none">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Walks', value: walks },
                { label: 'In Play', value: inPlay },
                { label: 'Batters Faced', value: pitcherBatters.length },
              ].map(c => (
                <div key={c.label} className="bg-slate-900 rounded-xl border border-slate-700 p-3 text-center">
                  <p className="text-slate-400 text-[13px] uppercase tracking-wide mb-1">{c.label}</p>
                  <p className="text-white font-black text-[28px] leading-none">{c.value}</p>
                </div>
              ))}
            </div>

            {/* Pitch mix */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Pitch Mix</p>
              <div className="space-y-2">
                {ptEntries.map(([pt, cnt]) => {
                  const pct = Math.round((cnt / totalP) * 100);
                  const color = PT_COLOR[pt] ?? '#94a3b8';
                  return (
                    <div key={pt} className="flex items-center gap-3">
                      <span className="w-8 font-bold text-[16px] flex-shrink-0" style={{ color }}>{pt}</span>
                      <div className="flex-1 bg-slate-800 rounded-full h-3 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <span className="text-slate-300 text-[15px] w-14 text-right flex-shrink-0">{cnt} · {pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Outcomes */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Outcomes</p>
              <div className="space-y-1.5">
                {Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1]).map(([oc, cnt]) => (
                  <div key={oc} className="flex items-center justify-between text-[16px]">
                    <span className="capitalize text-slate-300">{oc.replace(/-/g, ' ')}</span>
                    <span className="font-bold" style={{ color: OUTCOME_COLOR[oc] ?? '#94a3b8' }}>{cnt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-batter vs this pitcher */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-4">
              <p className="text-slate-400 text-[15px] uppercase tracking-wider font-medium mb-3">Batters Faced</p>
              <div className="space-y-2">
                {pitcherBatters.map((b, idx) => {
                  const pc = b.atBats.reduce((s, ab) => s + ab.pitches.length, 0);
                  const lastAB = b.atBats[b.atBats.length - 1];
                  return (
                    <div key={`${b.number}|${b.name}`} className="flex items-center gap-2 text-[16px]">
                      <span className="text-slate-600 w-5 text-right font-mono">{idx + 1}.</span>
                      <span className="text-slate-500 font-bold w-8 flex-shrink-0">#{b.number}</span>
                      <span className="flex-1 text-slate-300 truncate">{b.name}</span>
                      <span className="text-slate-500 text-[14px] flex-shrink-0">{pc}p</span>
                      {lastAB && (
                        <span className="font-bold text-[15px] flex-shrink-0 w-8 text-right" style={{ color: abResultColor(lastAB) }}>
                          {abResultLabel(lastAB)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button onClick={() => { localStorage.removeItem(URL_KEY); setWebhookUrl(''); setGame(null); }}
              className="w-full py-2 rounded-xl border border-slate-800 text-slate-700 hover:text-slate-500 text-sm">
              Change Sheets URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
