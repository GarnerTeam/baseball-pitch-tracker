'use client';
import { GameState } from '@/types';
import { LineupPanel } from '@/components/lineup-panel';

const NOOP = () => {};

/**
 * Past Games "Lineup" tab: the whole game's batting order, read-only. Each
 * batter's card lists every plate appearance in the game, whichever pitcher
 * threw it (each at-bat is labelled with its pitcher). Pitcher-by-pitcher
 * face-offs live on the pitcher's page: tap a pitcher here, or use Stats.
 */
export function HistoryLineupView({ state }: { state: GameState }) {
  return (
    <LineupPanel
      state={state}
      readOnly
      onNextBatter={NOOP} onPrevBatter={NOOP} onEndAtBat={NOOP}
      onChangePitcher={NOOP} onAddBatter={NOOP} onRemoveBatter={NOOP}
      onSetBatterAt={NOOP} onReorderBatter={NOOP} onEditPitch={NOOP}
      onUndoLastEnd={NOOP}
    />
  );
}
