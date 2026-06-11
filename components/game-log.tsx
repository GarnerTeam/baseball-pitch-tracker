'use client';
import { useState, useEffect, useRef } from 'react';
import { GameState, AtBat, Player } from '@/types';
import { PitchRow, getAtBatResultBadge, getAtBatResultColor } from '@/components/pitch-row';

// ── At-bat card (mirrors the lineup-panel batter card exactly) ─────────────────
function AtBatCard({ atBat, isLive, defaultOpen }: {
  atBat: AtBat;
  isLive: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const first      = atBat.pitches[0];
  const badge      = getAtBatResultBadge(atBat);
  const badgeColor = getAtBatResultColor(atBat);
  const borderColor = isLive ? 'border-blue-600' : 'border-slate-700';
  const headerBg    = isLive ? 'border-blue-800 bg-blue-950/40' : 'border-slate-700 bg-slate-800/50';

  return (
    <div className={`rounded-xl overflow-hidden border mb-3 ${borderColor}`}>
      <button
        className={`w-full flex items-center gap-2 px-3 py-2.5 border-b ${headerBg} active:opacity-70 transition-opacity`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-slate-300 font-semibold text-[21px] truncate">
          #{first?.batterNumber ?? '?'} {first?.batterName ?? '—'}
        </span>
        <span className="text-slate-500 text-[18px] flex-shrink-0">AB #{atBat.atBatNumber}</span>
        <span className="text-slate-500 text-[17px] flex-shrink-0">· {atBat.pitches.length}p</span>

        {isLive && (
          <span className="ml-auto flex-shrink-0 text-[17px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
            LIVE
          </span>
        )}
        {!isLive && (
          <span className={`ml-auto flex-shrink-0 text-[17px] font-bold ${badgeColor}`}>
            {badge}
          </span>
        )}
        <span className="text-slate-600 text-[15px] flex-shrink-0 ml-1">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-slate-950 px-3 py-2.5 space-y-1.5">
          {atBat.pitches.length > 0
            ? atBat.pitches.map((pitch, i) => (
                <PitchRow key={pitch.id} pitch={pitch} index={i} playerHand={pitch.batterHand ?? null} />
              ))
            : <p className="text-slate-600 text-[18px] text-center py-2">No pitches yet</p>
          }
        </div>
      )}
    </div>
  );
}

// ── Per-pitcher log page ───────────────────────────────────────────────────────
function PitcherLogPage({ items }: {
  items: { ab: AtBat; isLive: boolean }[];
}) {
  const totalPitches = items.reduce((n, x) => n + x.ab.pitches.length, 0);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2">
        <p className="text-[21px]">No at-bats recorded</p>
        <p className="text-[18px] text-slate-600">for this pitcher yet</p>
      </div>
    );
  }

  return (
    <div className="px-3 pt-3 pb-8">
      <p className="text-slate-500 text-[17px] mb-3">
        {items.length} AB{items.length !== 1 ? 's' : ''} · {totalPitches} pitch{totalPitches !== 1 ? 'es' : ''}
      </p>
      {items.map(({ ab, isLive }, i) => (
        <AtBatCard key={ab.id} atBat={ab} isLive={isLive} defaultOpen={i === 0} />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function GameLog({ state }: { state: GameState }) {
  const { allAtBats, currentAtBat } = state;
  const pitcherHistory = state.pitcherHistory ?? [];

  // Pages: current pitcher first, then previous pitchers (most recent → oldest)
  const pitchers: Player[] = [
    state.pitcher,
    ...[...pitcherHistory].reverse(),
  ];
  const pageCount = pitchers.length;

  const [pageIdx, setPageIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Reset to current pitcher when active pitcher changes
  const prevPitcherIdRef = useRef(state.pitcher?.id);
  useEffect(() => {
    if (state.pitcher?.id !== prevPitcherIdRef.current) {
      setPageIdx(0);
      prevPitcherIdRef.current = state.pitcher?.id;
    }
  }, [state.pitcher?.id]);

  const safeIdx = Math.min(pageIdx, pageCount - 1);
  const selectedPitcher = pitchers[safeIdx];
  const isCurrent = safeIdx === 0;

  // An at-bat "belongs" to the pitcher who threw its first pitch.
  // Falls back to showing the at-bat on the current pitcher's page
  // if there are no pitches yet (live empty at-bat).
  function abBelongsToPitcher(ab: AtBat, p: Player): boolean {
    const firstPitch = ab.pitches[0];
    if (!firstPitch) {
      // Empty live at-bat: show under current pitcher
      return isCurrent && ab === currentAtBat;
    }
    return firstPitch.pitcherName === p.name && firstPitch.pitcherNumber === p.number;
  }

  // Build the item list for the selected pitcher page
  const allItems = [
    ...(currentAtBat ? [{ ab: currentAtBat, isLive: true }] : []),
    ...[...allAtBats].reverse().map(ab => ({ ab, isLive: false })),
  ];
  const pageItems = allItems.filter(({ ab }) => abBelongsToPitcher(ab, selectedPitcher));

  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0 && safeIdx < pageCount - 1) setPageIdx(safeIdx + 1);
    if (dx < 0 && safeIdx > 0)             setPageIdx(safeIdx - 1);
  };

  const pitcherName   = selectedPitcher?.name?.trim()  || 'No Pitcher Set';
  const pitcherNumber = selectedPitcher?.number?.trim() || '—';

  // Empty-game state (no pitchers, no at-bats)
  const hasAnyPitches = allItems.length > 0;

  return (
    <div
      className="flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Sticky pitcher header ── */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800">

        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="bg-blue-600 text-white text-[21px] font-bold px-2.5 py-0.5 rounded-lg flex-shrink-0">
            #{pitcherNumber}
          </span>
          <span className="font-semibold text-[24px] text-slate-100 truncate">{pitcherName}</span>
          {isCurrent
            ? <span className="ml-auto flex-shrink-0 text-[15px] font-bold bg-green-700 text-white px-2 py-0.5 rounded-full">Current</span>
            : <span className="ml-auto flex-shrink-0 text-[15px] text-slate-500">Previous</span>
          }
        </div>

        {/* Page dots (only when multiple pitchers) */}
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 pb-2">
            <button
              onClick={() => safeIdx > 0 && setPageIdx(safeIdx - 1)}
              disabled={safeIdx === 0}
              className="text-slate-500 disabled:opacity-20 text-[21px] px-1"
            >‹</button>
            {pitchers.map((_, i) => (
              <button
                key={i}
                onClick={() => setPageIdx(i)}
                className={`w-2 h-2 rounded-full transition-colors ${i === safeIdx ? 'bg-blue-400' : 'bg-slate-700'}`}
              />
            ))}
            <button
              onClick={() => safeIdx < pageCount - 1 && setPageIdx(safeIdx + 1)}
              disabled={safeIdx === pageCount - 1}
              className="text-slate-500 disabled:opacity-20 text-[21px] px-1"
            >›</button>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {!hasAnyPitches ? (
        <div className="flex flex-col items-center justify-center flex-1 text-slate-400 space-y-3 p-8">
          <div className="text-[72px]">📋</div>
          <p className="text-[24px] font-medium text-slate-300">No pitches logged</p>
          <p className="text-[18px] text-center">Pitches will appear here as you record them.</p>
        </div>
      ) : (
        <PitcherLogPage key={safeIdx} items={pageItems} />
      )}
    </div>
  );
}
