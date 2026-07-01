'use client';
import { useState, useRef } from 'react';
import { GameState } from '@/types';
import { LineupPanel } from '@/components/lineup-panel';
import { chronologicalPitchers, filterGameStateByPitcher } from '@/lib/game-reconstruct';

const NOOP = () => {};

/**
 * Wraps LineupPanel (readOnly) with pitcher-swipe navigation for the Past
 * Games "Lineup" tab — mirrors the swipe pattern already used on Stats/Log,
 * but ordered starting-pitcher-first (chronological) since there's no
 * "current" pitcher in a completed game. Selecting a pitcher filters the
 * displayed at-bats down to just what that pitcher faced. The swipe control
 * itself renders inside LineupPanel's own layout (via pitcherSwipeSlot),
 * positioned below the pitcher card and above the Batting Order.
 */
export function HistoryLineupView({ state }: { state: GameState }) {
  const pitchers = chronologicalPitchers(state);
  const pageCount = pitchers.length;
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(idx, Math.max(0, pageCount - 1));
  const selectedPitcher = pitchers[safeIdx] ?? null;
  const isStarter = safeIdx === 0;
  const isFinisher = safeIdx === pageCount - 1 && pageCount > 1;

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

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
    if (dx > 0 && safeIdx < pageCount - 1) setIdx(safeIdx + 1); // swipe left -> next pitcher
    if (dx < 0 && safeIdx > 0) setIdx(safeIdx - 1);              // swipe right -> previous pitcher
  };

  const commonProps = {
    readOnly: true as const,
    onNextBatter: NOOP, onPrevBatter: NOOP, onEndAtBat: NOOP,
    onChangePitcher: NOOP, onAddBatter: NOOP, onRemoveBatter: NOOP,
    onSetBatterAt: NOOP, onReorderBatter: NOOP, onEditPitch: NOOP,
    onUndoLastEnd: NOOP, onSetWebhookUrl: NOOP,
  };

  if (pageCount === 0) {
    return <LineupPanel state={state} {...commonProps} />;
  }

  const filteredState = filterGameStateByPitcher(state, selectedPitcher);

  const swipeSlot = pageCount > 1 ? (
    <div className="px-4 pb-2">
      <div className="bg-slate-900 rounded-xl border border-slate-700 px-3 py-2">
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => safeIdx > 0 && setIdx(safeIdx - 1)}
            disabled={safeIdx === 0}
            className="text-slate-500 disabled:opacity-20 text-[21px] px-1"
          >‹</button>
          <span className="text-slate-400 text-[15px] font-medium">
            {isStarter ? 'Starting Pitcher' : isFinisher ? 'Finished Game' : `Reliever ${safeIdx + 1}`}
            <span className="text-slate-600"> · {safeIdx + 1} of {pageCount}</span>
          </span>
          {pitchers.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-2 h-2 rounded-full transition-colors flex-shrink-0 ${i === safeIdx ? 'bg-blue-400' : 'bg-slate-700'}`}
            />
          ))}
          <button
            onClick={() => safeIdx < pageCount - 1 && setIdx(safeIdx + 1)}
            disabled={safeIdx === pageCount - 1}
            className="text-slate-500 disabled:opacity-20 text-[21px] px-1"
          >›</button>
        </div>
        <p className="text-center text-slate-600 text-[13px] mt-0.5">
          Lineup faced by this pitcher — swipe to view another
        </p>
      </div>
    </div>
  ) : null;

  return (
    <div
      className="h-full min-h-0"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <LineupPanel key={safeIdx} state={filteredState} pitcherSwipeSlot={swipeSlot} {...commonProps} />
    </div>
  );
}
