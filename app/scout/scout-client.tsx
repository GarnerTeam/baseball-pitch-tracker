'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { BatterHistoryModal } from '@/components/batter-history-modal';
import { PitchRowLite } from '@/lib/sheets';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SheetRow {
  gameId: string; timestamp: string;
  homeTeam: string; visitingTeam: string;
  pitcherNumber: string; pitcherName: string;
  batterNumber: string; batterName: string; batterHand: string;
  lineupPosition: string | number; atBatNumber: string | number; pitchNumber: string | number;
  pitchType: string; pitchZone: string; pitchLocation: string;
  action: string; outcome: string;
  hitType: string; hitResult: string; hitZone: string;
  hitX: string | number; hitY: string | number;
  outsCount: string | number; baseState: string;
  ballsBefore: string | number; strikesBefore: string | number;
  ballsAfter: string | number; strikesAfter: string | number;
  [key: string]: unknown;
}

interface ScoutPitcher { name: string; number: string; }

interface ScoutAtBat {
  atBatNumber: number;
  pitches: SheetRow[];
  finalOutcome: string;
  hitResult: string;
}

interface ScoutBatter {
  name: string; number: string; hand: string;
  lineupPos: number;
  atBats: ScoutAtBat[];
}

interface ScoutGame {
  gameId: string; homeTeam: string; visitingTeam: string;
  /** Pitchers in order of appearance — index 0 = first pitcher, last = current */
  pitchers: ScoutPitcher[];
  batters: ScoutBatter[];
  allRows: SheetRow[];
}

// ── Reconstruction ────────────────────────────────────────────────────────────
function reconstructGame(rows: SheetRow[]): ScoutGame {
  if (!rows.length) return { gameId: '', homeTeam: '', visitingTeam: '', pitchers: [], batters: [], allRows: [] };

  const first = rows[0];

  // Build ordered pitcher list (first appearance order)
  const pitcherSeen = new Set<string>();
  const pitchers: ScoutPitcher[] = [];
  for (const row of rows) {
    const key = `${row.pitcherNumber}|${row.pitcherName}`;
    if (row.pitcherName && !pitcherSeen.has(key)) {
      pitcherSeen.add(key);
      pitchers.push({ name: String(row.pitcherName), number: String(row.pitcherNumber ?? '') });
    }
  }

  // Build batters grouped by name+number, preserving lineup order
  const batterMap = new Map<string, ScoutBatter>();
  const batterOrder: string[] = [];
  for (const row of rows) {
    const key = `${row.batterNumber}|${row.batterName}`;
    if (!batterMap.has(key)) {
      batterMap.set(key, {
        name: String(row.batterName ?? ''), number: String(row.batterNumber ?? ''),
        hand: String(row.batterHand ?? ''), lineupPos: Number(row.lineupPosition) || 999,
        atBats: [],
      });
      batterOrder.push(key);
    }
    const batter = batterMap.get(key)!;
    const abNum = Number(row.atBatNumber) || 0;
    let ab = batter.atBats.find(a => a.atBatNumber === abNum);
    if (!ab) {
      ab = { atBatNumber: abNum, pitches: [], finalOutcome: '', hitResult: '' };
      batter.atBats.push(ab);
    }
    ab.pitches.push(row);
    if (row.outcome)   ab.finalOutcome = String(row.outcome);
    if (row.hitResult) ab.hitResult    = String(row.hitResult);
  }

  const batters = batterOrder
    .map(k => batterMap.get(k)!)
    .sort((a, b) => a.lineupPos - b.lineupPos);
  for (const b of batters) {
    b.atBats.sort((a, b2) => a.atBatNumber - b2.atBatNumber);
    for (const ab of b.atBats) ab.pitches.sort((a, b2) => Number(a.pitchNumber) - Number(b2.pitchNumber));
  }

  return {
    gameId: String(first.gameId ?? ''),
    homeTeam: String(first.homeTeam ?? ''),
    visitingTeam: String(first.visitingTeam ?? ''),
    pitchers, batters, allRows: rows,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const OUTCOME_LABEL: Record<string, string> = {
  'called-strike':'K','swinging-strike':'K',strikeout:'K',
  walk:'BB','in-play':'●',foul:'F','foul-tip':'FT',ball:'B',
};
const OUTCOME_COLOR: Record<string, string> = {
  'called-strike':'#ef4444','swinging-strike':'#ef4444',strikeout:'#ef4444',
  walk:'#22c55e','in-play':'#3b82f6',foul:'#f97316',ball:'#64748b',
};
const HIT_COLOR: Record<string, string> = {
  out:'#ef4444',error:'#f97316',single:'#22c55e',double:'#22c55e',triple:'#22c55e','home-run':'#eab308',
};
const HIT_LABEL: Record<string, string> = {
  out:'Out',error:'Err',single:'1B',double:'2B',triple:'3B','home-run':'HR',
};
const PT_COLOR: Record<string, string> = { FB:'#ef4444',CB:'#22c55e',SL:'#8b5cf6',CH:'#f97316' };

function abResultLabel(ab: ScoutAtBat) {
  if (ab.hitResult) return HIT_LABEL[ab.hitResult] ?? ab.hitResult;
  if (ab.finalOutcome === 'strikeout') return 'K';
  if (ab.finalOutcome === 'walk')      return 'BB';
  return ab.finalOutcome ? (OUTCOME_LABEL[ab.finalOutcome] ?? ab.finalOutcome) : '—';
}
function abResultColor(ab: ScoutAtBat) {
  if (ab.hitResult) return HIT_COLOR[ab.hitResult] ?? '#94a3b8';
  return OUTCOME_COLOR[ab.finalOutcome] ?? '#94a3b8';
}

/** Rows for a given pitcher (by name+number). Empty name = all rows. */
function rowsForPitcher(rows: SheetRow[], pitcher: ScoutPitcher) {
  if (!pitcher.name) return rows;
  return rows.filter(r => String(r.pitcherName) === pitcher.name && String(r.pitcherNumber) === pitcher.number);
}

/** Batters whose atBats include at least one pitch to this pitcher */
function battersForPitcher(batters: ScoutBatter[], pitcher: ScoutPitcher): ScoutBatter[] {
  if (!pitcher.name) return batters;
  return batters.map(b => ({
    ...b,
    atBats: b.atBats.map(ab => ({
      ...ab,
      pitches: ab.pitches.filter(p => String(p.pitcherName) === pitcher.name && String(p.pitcherNumber) === pitcher.number),
    })).filter(ab => ab.pitches.length > 0),
  })).filter(b => b.atBats.length > 0);
}

// ── Swipe hook ────────────────────────────────────────────────────────────────
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

// ── PitcherNav ────────────────────────────────────────────────────────────────
function PitcherNav({ pitchers, idx, onChange }: { pitchers: ScoutPitcher[]; idx: number; onChange: (i: number) => void }) {
  if (pitchers.length <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pb-2">
      <button onClick={() => idx > 0 && onChange(idx - 1)} disabled={idx === 0}
        className="text-slate-500 disabled:opacity-20 text-[21px] px-1">‹</button>
      {pitchers.map((_, i) => (
        <button key={i} onClick={() => onChange(i)}
          className={`w-2 h-2 rounded-full transition-colors ${i === idx ? 'bg-blue-400' : 'bg-slate-700'}`} />
      ))}
      <button onClick={() => idx < pitchers.length - 1 && onChange(idx + 1)} disabled={idx === pitchers.length - 1}
        className="text-slate-500 disabled:opacity-20 text-[21px] px-1">›</button>
    </div>
  );
}

const URL_KEY = 'scout-webhook-url';

// ── Main ──────────────────────────────────────────────────────────────────────
export function ScoutClient() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [urlInput, setUrlInput]     = useState('');
  const [game, setGame]             = useState<ScoutGame | null>(null);
  const [loading, setLoading]       = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tab, setTab]               = useState<'lineup' | 'stats'>('lineup');
  const [pitcherIdx, setPitcherIdx] = useState(0); // shared across both tabs
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [historyBatter, setHistoryBatter] = useState<{ name: string; number: string; pitches: PitchRowLite[] } | null>(null);

  useEffect(() => {
    // 1. Honour ?url= query param — lets coaches share a pre-configured link
    const params = new URLSearchParams(window.location.search);
    const qUrl = params.get('url');
    if (qUrl) {
      localStorage.setItem(URL_KEY, qUrl);
      setWebhookUrl(qUrl);
      setUrlInput(qUrl);
      return;
    }
    // 2. Fall back to whatever was saved last time on this device
    const saved = localStorage.getItem(URL_KEY);
    if (saved) { setWebhookUrl(saved); setUrlInput(saved); }
  }, []);

  const fetchGame = useCallback(async (url: string) => {
    if (!url) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res  = await fetch(`/api/sheets/scout?${new URLSearchParams({ url })}`);
      const json = await res.json();
      if (json.error) { setFetchError(json.error); return; }
      const rows: SheetRow[] = json.pitches ?? [];
      const g = reconstructGame(rows);
      setGame(g);
      // Keep pitcherIdx pointing to current pitcher (last in array) on new data
      setPitcherIdx(prev => Math.min(prev, Math.max(0, g.pitchers.length - 1)));
      setLastRefresh(new Date());
    } catch (e) { setFetchError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!webhookUrl) return;
    fetchGame(webhookUrl);
    const id = setInterval(() => fetchGame(webhookUrl), 30_000);
    return () => clearInterval(id);
  }, [webhookUrl, fetchGame]);

  // Pitcher navigation — current pitcher is LAST in pitchers array
  // Display order: current (last) first, then previous descending
  // So display index 0 = pitchers[last], display index 1 = pitchers[last-1], etc.
  const pitchers = game ? [...game.pitchers].reverse() : []; // display order
  const safeIdx  = Math.min(pitcherIdx, Math.max(0, pitchers.length - 1));
  const currentPitcher = pitchers[safeIdx] ?? null;
  const isCurrent = safeIdx === 0;

  const swipe = useSwipe(
    () => safeIdx < pitchers.length - 1 && setPitcherIdx(safeIdx + 1),
    () => safeIdx > 0                   && setPitcherIdx(safeIdx - 1),
  );

  // ── URL setup ─────────────────────────────────────────────────────────────
  if (!webhookUrl) {
    return (
      <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-5 p-8">
        <span className="text-6xl">⚾</span>
        <p className="text-2xl font-bold">Scout View</p>
        <p className="text-slate-400 text-center">Enter your Google Sheets webhook URL to view live game data.</p>
        <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)}
          placeholder="https://script.google.com/macros/s/…/exec" rows={3}
          className="w-full max-w-md rounded-xl bg-slate-800 border border-slate-600 text-slate-100 text-sm p-3 outline-none focus:border-blue-500 font-mono" />
        <button disabled={!urlInput.trim()}
          onClick={() => { const u = urlInput.trim(); localStorage.setItem(URL_KEY, u); setWebhookUrl(u); }}
          className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-lg font-semibold">
          Connect
        </button>
      </div>
    );
  }

  if (loading && !game) return (
    <div className="fixed inset-0 bg-slate-950 text-slate-400 flex items-center justify-center text-xl">Loading…</div>
  );

  if (fetchError && !game) return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <p className="text-red-400 text-lg font-semibold">Failed to load data</p>
      <p className="text-slate-500 text-sm text-center">{fetchError}</p>
      <p className="text-slate-600 text-xs text-center">Make sure the Apps Script has been updated with the new doGet() and redeployed.</p>
      <button onClick={() => fetchGame(webhookUrl)} className="px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-base font-medium">Retry</button>
      <button onClick={() => { localStorage.removeItem(URL_KEY); setWebhookUrl(''); }} className="text-slate-600 text-sm underline mt-2">Change URL</button>
    </div>
  );

  if (!game || game.allRows.length === 0) return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-8">
      <span className="text-5xl">⚾</span>
      <p className="text-xl font-bold text-slate-300">No game data yet</p>
      <p className="text-slate-500 text-center">Waiting for pitches to sync from the recording device.</p>
      <button onClick={() => fetchGame(webhookUrl)} className="mt-2 px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-base">Refresh</button>
    </div>
  );

  const timeStr = lastRefresh?.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }) ?? '';

  // Data filtered to selected pitcher
  const pitcherRows    = currentPitcher ? rowsForPitcher(game.allRows, currentPitcher) : game.allRows;
  const pitcherBatters = currentPitcher ? battersForPitcher(game.batters, currentPitcher) : game.batters;

  // Stats for selected pitcher
  const totalP    = pitcherRows.length;
  const strikes   = pitcherRows.filter(p => ['called-strike','swinging-strike','foul','foul-tip','in-play','strikeout'].includes(String(p.outcome))).length;
  const walks     = pitcherRows.filter(p => String(p.outcome) === 'walk').length;
  const strikeouts = pitcherRows.filter(p => String(p.outcome) === 'strikeout').length;
  const inPlay    = pitcherRows.filter(p => String(p.outcome) === 'in-play').length;
  const strikePct = totalP > 0 ? Math.round((strikes / totalP) * 100) : 0;

  const ptCounts: Record<string, number> = {};
  for (const p of pitcherRows) { const t = String(p.pitchType || '?').toUpperCase(); ptCounts[t] = (ptCounts[t] ?? 0) + 1; }
  const ptEntries = Object.entries(ptCounts).sort((a, b) => b[1] - a[1]);

  const outcomeCounts: Record<string, number> = {};
  for (const p of pitcherRows) { const o = String(p.outcome || '?'); outcomeCounts[o] = (outcomeCounts[o] ?? 0) + 1; }

  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col">

      {/* Header */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between">
        <div>
          <p className="text-slate-100 font-bold text-lg leading-tight">
            {game.homeTeam || 'Home'} vs {game.visitingTeam || 'Away'}
          </p>
          <p className="text-slate-500 text-xs">View only · {timeStr}{loading ? ' · refreshing…' : ''}</p>
        </div>
        <button onClick={() => fetchGame(webhookUrl)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-medium border border-slate-700">↻</button>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex bg-slate-900 border-b border-slate-800">
        {(['lineup','stats'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-base font-semibold tracking-wide transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
            {t === 'lineup' ? '👥 Lineup' : '📊 Stats'}
          </button>
        ))}
      </div>

      {/* Pitcher sticky header — shared across both tabs, swipeable */}
      <div className="flex-shrink-0 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800" {...swipe}>
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="bg-blue-600 text-white text-[21px] font-bold px-2.5 py-0.5 rounded-lg flex-shrink-0">
            #{currentPitcher?.number || '—'}
          </span>
          <span className="font-semibold text-[22px] text-slate-100 truncate flex-1">
            {currentPitcher?.name || 'No Pitcher'}
          </span>
          <span className="text-[15px] font-bold flex-shrink-0 px-2 py-0.5 rounded-full"
            style={{ background: isCurrent ? '#166534' : 'transparent', color: isCurrent ? '#fff' : '#64748b' }}>
            {isCurrent ? 'Current' : 'Previous'}
          </span>
        </div>
        <PitcherNav pitchers={pitchers} idx={safeIdx} onChange={setPitcherIdx} />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }} {...swipe}>

        {/* ── LINEUP TAB ── */}
        {tab === 'lineup' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider">
                Batting Order
              </p>
              <span className="text-slate-600 text-[18px]">{pitcherBatters.length} batters</span>
            </div>

            {pitcherBatters.length === 0 ? (
              <p className="text-slate-600 text-center py-8 text-lg">No batters faced yet</p>
            ) : (
              <div className="space-y-1.5">
                {pitcherBatters.map((batter, idx) => {
                  const key = `${batter.number}|${batter.name}`;
                  const isOpen = expanded === key;
                  const lastAB = batter.atBats[batter.atBats.length - 1];
                  const pitchCount = batter.atBats.reduce((s, ab) => s + ab.pitches.length, 0);

                  return (
                    <div key={key} className="rounded-xl overflow-hidden border border-slate-700">
                      <div onClick={() => setExpanded(isOpen ? null : key)}
                        className="flex items-center gap-2 px-3 py-2.5 bg-slate-900 hover:bg-slate-800/70 cursor-pointer select-none">
                        <span className="text-slate-500 text-[18px] font-mono w-5 text-right flex-shrink-0">{idx + 1}.</span>
                        <span className="text-[18px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 flex-shrink-0">
                          #{batter.number}
                        </span>
                        <span className="flex-1 text-[21px] truncate text-slate-300">{batter.name}</span>
                        {batter.hand && <span className="text-slate-600 text-[15px] flex-shrink-0">{batter.hand}HB</span>}
                        {lastAB && (
                          <span className="text-[15px] font-bold flex-shrink-0" style={{ color: abResultColor(lastAB) }}>
                            {abResultLabel(lastAB)}
                          </span>
                        )}
                        <span className="text-slate-600 text-[15px] flex-shrink-0">{pitchCount}p {isOpen ? '▲' : '▼'}</span>
                      </div>

                      {isOpen && (
                        <div className="bg-slate-950 px-3 py-2.5 border-t border-slate-700 space-y-3">
                          {batter.atBats.map(ab => (
                            <div key={ab.atBatNumber} className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <p className="text-slate-500 text-[18px]">At-Bat #{ab.atBatNumber} · {ab.pitches.length} pitches</p>
                                <span className="text-[18px] font-bold" style={{ color: abResultColor(ab) }}>{abResultLabel(ab)}</span>
                              </div>
                              <div className="space-y-1">
                                {ab.pitches.map((pitch, i) => {
                                  const pt = String(pitch.pitchType || '?').toUpperCase();
                                  const oc = String(pitch.outcome || '');
                                  return (
                                    <div key={i} className="flex items-center gap-2 text-[16px] bg-slate-900 rounded-lg px-2.5 py-1.5">
                                      <span className="w-5 text-slate-600 text-right flex-shrink-0">{i + 1}</span>
                                      <span className="font-bold w-7 flex-shrink-0" style={{ color: PT_COLOR[pt] ?? '#94a3b8' }}>{pt}</span>
                                      <span className="text-slate-400 flex-1">{String(pitch.pitchLocation || pitch.pitchZone || '')}</span>
                                      <span className="text-slate-400 flex-shrink-0">{String(pitch.action || '')}</span>
                                      <span className="font-semibold flex-shrink-0" style={{ color: OUTCOME_COLOR[oc] ?? '#94a3b8' }}>
                                        {OUTCOME_LABEL[oc] ?? oc}
                                      </span>
                                      <span className="text-slate-600 text-[14px] flex-shrink-0">
                                        {String(pitch.ballsAfter ?? '')}–{String(pitch.strikesAfter ?? '')}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}

                          <button
                            onClick={() => {
                              // Pass ALL of this batter's pitches across all pitchers for history modal
                              const allBatterRows = game.allRows.filter(
                                r => String(r.batterName) === batter.name && String(r.batterNumber) === batter.number
                              );
                              const litePitches: PitchRowLite[] = allBatterRows.map(p => ({
                                gameId: String(p.gameId ?? ''),
                                batterName: String(p.batterName ?? ''),
                                batterNumber: String(p.batterNumber ?? ''),
                                batterHand: String(p.batterHand ?? ''),
                                pitchType: String(p.pitchType ?? ''),
                                pitchZone: String(p.pitchZone ?? ''),
                                pitchLocation: String(p.pitchLocation ?? ''),
                                action: String(p.action ?? ''),
                                outcome: String(p.outcome ?? ''),
                                hitResult: String(p.hitResult ?? '') || undefined,
                                hitX: p.hitX !== '' ? p.hitX as number : undefined,
                                hitY: p.hitY !== '' ? p.hitY as number : undefined,
                              }));
                              setHistoryBatter({ name: batter.name, number: batter.number, pitches: litePitches });
                            }}
                            className="w-full py-2.5 rounded-xl bg-indigo-900 hover:bg-indigo-800 border border-indigo-700 text-indigo-200 text-[18px] font-semibold flex items-center justify-center gap-2"
                          >
                            📊 Full History &amp; Tendencies
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── STATS TAB ── */}
        {tab === 'stats' && (
          <div className="p-4 space-y-4">

            <div className="grid grid-cols-3 gap-3">
              {[
                { label:'Strike %', value:`${strikePct}%` },
                { label:'Total Pitches', value:totalP },
                { label:'Strikeouts', value:strikeouts },
              ].map(c => (
                <div key={c.label} className="bg-slate-900 rounded-xl border border-slate-700 p-3 text-center">
                  <p className="text-slate-400 text-[13px] uppercase tracking-wide mb-1">{c.label}</p>
                  <p className="text-white font-black text-[28px] leading-none">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label:'Walks', value:walks },
                { label:'In Play', value:inPlay },
                { label:'Batters Faced', value:pitcherBatters.length },
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
                        <div className="h-full rounded-full" style={{ width:`${pct}%`, background:color }} />
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
                    <span className="capitalize text-slate-300">{oc.replace(/-/g,' ')}</span>
                    <span className="font-bold" style={{ color:OUTCOME_COLOR[oc] ?? '#94a3b8' }}>{cnt}</span>
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
                        <span className="font-bold text-[15px] flex-shrink-0 w-8 text-right" style={{ color:abResultColor(lastAB) }}>
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
        )}
      </div>

      {/* History modal */}
      {historyBatter && (
        <BatterHistoryModal
          playerName={historyBatter.name}
          playerNumber={historyBatter.number}
          webhookUrl={webhookUrl}
          currentGameId={game.gameId}
          currentGamePitches={historyBatter.pitches}
          onClose={() => setHistoryBatter(null)}
        />
      )}
    </div>
  );
}
