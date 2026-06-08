'use client';
import { GameState, PitchType, SwingResult, ContactType, PitchLocation } from '@/types';
import { PITCH_TYPE_COLORS, PITCH_TYPE_LABELS } from '@/types';
import { PlayerHeader } from './player-header';
import { CountDisplay } from './count-display';
import { PitchHistoryStrip } from './pitch-history-strip';
import { StrikeZone } from './strike-zone';
import { PitchControls } from './pitch-controls';

interface PitchScreenProps {
  state: GameState;
  onSetPitchType: (t: PitchType) => void;
  onSetLocation: (loc: PitchLocation) => void;
  onSetSwing: (s: SwingResult) => void;
  onSetContact: (c: ContactType) => void;
  onRecordPitch: () => void;
  onNextBatter: () => void;
  onResetCount: () => void;
  onToggleOverlay: () => void;
  onSetOverlayFilter: (f: PitchType | 'all') => void;
  onTabChange: (tab: GameState['activeTab']) => void;
}

export function PitchScreen({ state, onSetPitchType, onSetLocation, onSetSwing, onSetContact, onRecordPitch, onNextBatter, onResetCount, onToggleOverlay, onSetOverlayFilter }: PitchScreenProps) {
  const { currentAtBat, pendingPitch, overlayEnabled, overlayFilter, lineup, currentBatterIndex, pitcher, allAtBats } = state;
  const balls = currentAtBat?.balls ?? 0;
  const strikes = currentAtBat?.strikes ?? 0;
  const pitchNum = (currentAtBat?.pitches?.length ?? 0) + 1;
  const canRecord = pendingPitch.pitchType !== null && pendingPitch.location !== null && pendingPitch.swing !== null;
  const isInPlay = pendingPitch.contact === 'in-play';
  const batterAtBats = allAtBats.filter(ab => ab.batterIndex === currentBatterIndex && ab.isComplete);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      <PlayerHeader pitcher={pitcher} batter={lineup[currentBatterIndex]} atBatNumber={batterAtBats.length + 1} />

      <div className="px-3 pt-2 pb-1 space-y-1">
        <CountDisplay balls={balls} strikes={strikes} pitchNumber={pitchNum} />
        {currentAtBat && currentAtBat.pitches.length > 0 && <PitchHistoryStrip pitches={currentAtBat.pitches} />}
      </div>

      {/* Overlay filter pills — only shown when overlay is ON */}
      {overlayEnabled && (
        <div className="px-3 pb-1 flex items-center gap-1.5 flex-wrap">
          {(['all', 'FB', 'CH', 'CB', 'SL'] as const).map(f => (
            <button
              key={f}
              onClick={() => onSetOverlayFilter(f)}
              className={`text-[11px] px-2 py-1 rounded-full font-medium transition-colors ${overlayFilter === f ? 'text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              style={overlayFilter === f ? { backgroundColor: f === 'all' ? '#475569' : PITCH_TYPE_COLORS[f as PitchType] } : {}}
            >
              {f === 'all' ? 'All' : PITCH_TYPE_LABELS[f as PitchType]}
            </button>
          ))}
        </div>
      )}

      {/* Strike zone */}
      <div className="flex-shrink-0 px-3 py-1">
        <StrikeZone
          selected={pendingPitch.location}
          onSelect={onSetLocation}
          currentAtBatPitches={currentAtBat?.pitches ?? []}
          historicalPitches={overlayEnabled
            ? batterAtBats.flatMap(ab => ab.pitches).filter(p => overlayFilter === 'all' || p.pitchType === overlayFilter)
            : []}
        />
      </div>

      {/* Pitch controls */}
      <div className="flex-1 overflow-y-auto px-3 pb-1">
        <PitchControls
          pitchType={pendingPitch.pitchType}
          swing={pendingPitch.swing}
          contact={pendingPitch.contact}
          onSetPitchType={onSetPitchType}
          onSetSwing={onSetSwing}
          onSetContact={onSetContact}
          balls={balls}
          strikes={strikes}
        />
      </div>

      {/* CTA */}
      <div className="px-3 pb-3 pt-1 space-y-2 flex-shrink-0">
        <button
          onClick={onRecordPitch}
          disabled={!canRecord}
          className={`w-full h-14 rounded-xl text-lg font-bold transition-all ${
            canRecord
              ? isInPlay
                ? 'bg-yellow-500 hover:bg-yellow-400 text-slate-900'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-slate-800 text-slate-600 cursor-not-allowed'
          }`}
        >
          {isInPlay ? 'Record Hit →' : 'Record Pitch'}
        </button>

        {/* Secondary row: Next Batter | Reset Count | Overlay */}
        <div className="flex gap-1.5">
          <button
            onClick={onNextBatter}
            className="flex-1 h-9 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Next Batter ›
          </button>
          <button
            onClick={onResetCount}
            className="flex-1 h-9 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Reset Count
          </button>
          <button
            onClick={onToggleOverlay}
            className={`flex-1 h-9 rounded-lg text-xs font-medium transition-colors ${
              overlayEnabled
                ? 'bg-blue-700 hover:bg-blue-600 text-blue-100'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
            }`}
          >
            {overlayEnabled ? '👁 Overlay' : '👁 Overlay'}
          </button>
        </div>
      </div>
    </div>
  );
}