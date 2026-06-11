'use client';
import { useState } from 'react';
import { GameState, PitchType, SwingResult, ContactType, PitchLocation, AtBat, BaseState } from '@/types';
import { PITCH_TYPE_COLORS, PITCH_TYPE_LABELS } from '@/types';
import { PlayerHeader } from './player-header';
import { CountDisplay } from './count-display';
import { PitchRow } from './pitch-row';
import { PitchHistoryStrip } from './pitch-history-strip';
import { StrikeZone } from './strike-zone';
import { PitchControls } from './pitch-controls';
import { PitcherStatsModal } from './pitcher-stats-modal';

interface PitchScreenProps {
  state: GameState;
  onSetPitchType: (t: PitchType) => void;
  onSetLocation: (loc: PitchLocation) => void;
  onSetSwing: (s: SwingResult | null) => void;
  onSetContact: (c: ContactType) => void;
  onRecordPitch: () => void;
  onNextBatter: () => void;
  onPrevBatter: () => void;
  onUndoPitch: () => void;
  onToggleOverlay: () => void;
  onSetOverlayFilter: (f: PitchType | 'all') => void;
  onSetBatterHand: (h: 'L' | 'R' | null) => void;
  onTabChange: (tab: GameState['activeTab']) => void;
  onSetBase: (base: keyof BaseState, occupied: boolean) => void;
}

const OVERLAY_FILTERS: (PitchType | 'all')[] = ['all', 'FB', 'CB', 'SL', 'CH'];

// ── Batter history helpers ────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, string> = {
  ball: 'Ball',
  'called-strike': 'Called ☒',
  'swinging-strike': 'Swing ☒',
  foul: 'Foul',
  'foul-tip': 'Foul Tip',
  'in-play': 'In Play',
  walk: 'Walk',
};
const OUTCOME_COLORS: Record<string, string> = {
  ball: 'text-blue-400',
  'called-strike': 'text-red-400',
  'swinging-strike': 'text-red-400',
  foul: 'text-amber-400',
  'foul-tip': 'text-amber-400',
  'in-play': 'text-green-400',
  walk: 'text-blue-300',
  strikeout: 'text-red-500',
};
const HIT_TYPE_ICONS: Record<string, string> = {
  'ground-ball': '⬇', 'line-drive': '→', 'fly-ball': '⬆', 'pop-up': '↑↑',
};
const HIT_RESULT_ICONS: Record<string, string> = {
  out: '🔴', error: '🟠', single: '🟢', double: '🔵', triple: '🟣', 'home-run': '⭐',
};
const HIT_ZONE_ABBR: Record<string, string> = {
  'Shallow Left': 'Sha Lft', 'Shallow Right': 'Sha Rt', 'Shallow Center': 'Sha Ctr',
  'Deep Left': 'Dp Lft', 'Deep Right': 'Dp Rt', 'Deep Center': 'Dp Ctr',
  'C': 'C', 'SS': 'SS', '3B': '3B', '2B': '2B', '1B': '1B',
  'HR-Lft': 'HR·Lft', 'HR-LCtr': 'HR·LCtr', 'HR-RCtr': 'HR·RCtr', 'HR-Rt': 'HR·Rt',
  'Infield': 'Inf', 'Foul': 'Foul', 'Home Run': 'HR',
};

function KLabel({ swing }: { swing: boolean }) {
  if (swing) return <>K</>;
  return <span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>K</span>;
}

function getResultBadge(ab: AtBat): React.ReactNode {
  if (ab.result === 'in-play') {
    const hd = ab.pitches.find(p => p.hitData)?.hitData;
    if (!hd) return '⚾ IP';
    const icon = HIT_RESULT_ICONS[hd.result] ?? '';
    const zone = hd.zone ? (HIT_ZONE_ABBR[hd.zone] ?? hd.zone) : '';
    return `${icon}${zone ? ' · ' + zone : ''}`;
  }
  if (ab.result === 'strikeout') {
    const last = ab.pitches[ab.pitches.length - 1];
    return <>🔴 <KLabel swing={last ? last.swing : true} /></>;
  }
  const m: Record<string, string> = { walk: '🟢 BB', 'manual-end': '—' };
  return m[ab.result ?? ''] ?? '—';
}

function getResultColor(ab: AtBat): string {
  if (ab.result === 'strikeout') return 'text-red-400';
  if (ab.result === 'walk') return 'text-blue-300';
  if (ab.result === 'in-play') {
    const r = ab.pitches.find(p => p.hitData)?.hitData?.result;
    return r === 'out' || r === 'error' ? 'text-red-400' : 'text-green-400';
  }
  return 'text-slate-400';
}

function getBallLabel(row: number, col: number, hand?: 'L' | 'R' | null): string {
  const v = row === 0 ? 'Up' : row === 4 ? 'Low' : '';
  const colSide = (c: number) => {
    if (c === 0) return hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'L';
    if (c === 4) return hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'R';
    return '';
  };
  const h = colSide(col);
  if (v && h) return `${v}-${h}`;
  if (v) {
    if (col === 1) return `${v}-${hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'L'}`;
    if (col === 3) return `${v}-${hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'R'}`;
    return v;
  }
  if (h) {
    if (row === 1) return `${h}-High`;
    if (row === 3) return `${h}-Low`;
    return h;
  }
  return 'Ball';
}

// ── Base State Diamond ────────────────────────────────────────────────────────
function BaseDiamond({
  baseState, outsCount, onSetBase,
}: {
  baseState: BaseState;
  outsCount: 0 | 1 | 2;
  onSetBase: (base: keyof BaseState, occupied: boolean) => void;
}) {
  const baseBtn = (key: keyof BaseState, active: boolean) => (
    <button
      onClick={() => onSetBase(key, !active)}
      className={`w-6 h-6 rotate-45 border-2 transition-colors ${
        active ? 'bg-amber-400 border-amber-400' : 'bg-transparent border-slate-500'
      }`}
    />
  );
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800">
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Base</span>
        <div className="relative w-14 h-14 flex items-center justify-center">
          <div className="absolute top-0 left-1/2 -translate-x-1/2">{baseBtn('second', baseState.second)}</div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2">{baseBtn('third', baseState.third)}</div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2">{baseBtn('first', baseState.first)}</div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-white" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Outs</span>
        <div className="flex gap-1.5 items-center">
          {[0, 1, 2].map(n => (
            <div
              key={n}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${
                n < outsCount
                  ? 'bg-red-600 border-red-600'
                  : 'bg-transparent border-slate-500'
              }`}
            />
          ))}
        </div>
        <span className="text-[13px] font-bold text-slate-300">{outsCount}</span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PitchScreen({
  state, onSetPitchType, onSetLocation, onSetSwing, onSetContact, onRecordPitch,
  onNextBatter, onPrevBatter, onUndoPitch, onToggleOverlay, onSetOverlayFilter, onSetBatterHand,
  onTabChange,
  onSetBase,
}: PitchScreenProps) {
  const { currentAtBat, pendingPitch, overlayEnabled, overlayFilter, lineup, currentBatterIndex, pitcher, allAtBats, batterHand } = state;
  const balls   = currentAtBat?.balls ?? 0;
  const strikes = currentAtBat?.strikes ?? 0;
  const pitchNum = (currentAtBat?.pitches?.length ?? 0) + 1;
  // Lineup may be empty when game first starts (users add batters on the Lineup tab).
  // If the current index slot is empty, fall back to a placeholder.
  const _safeBatterIdx = isNaN(currentBatterIndex) ? 0 : currentBatterIndex;
  const _currentPlayerId = lineup[_safeBatterIdx]?.id;
  // True if another player's UUID has ever appeared at this slot — meaning a sub occurred.
  // When no sub has occurred, anonymous at-bats (playerId undefined) at this slot
  // belong to the current player (first AB created before the lineup was filled).
  const _subHasOccurred = _currentPlayerId
    ? allAtBats.some(ab => ab.playerId && ab.playerId !== _currentPlayerId && ab.batterIndex === _safeBatterIdx)
    : false;
  function _matchesBatter(ab: { playerId?: string; batterIndex: number }): boolean {
    if (_currentPlayerId) {
      if (ab.playerId === _currentPlayerId) return true;
      if (!ab.playerId && ab.batterIndex === _safeBatterIdx && !_subHasOccurred) return true;
      return false;
    }
    return ab.batterIndex === currentBatterIndex;
  }
  const batterAtBats = allAtBats.filter(ab => _matchesBatter(ab) && ab.isComplete);
  const canUndo = (currentAtBat?.pitches?.length ?? 0) > 0;
  const _rawBatter = lineup[_safeBatterIdx];
  const batter = (_rawBatter && _rawBatter.name.trim())
    ? _rawBatter
    : { id: '', name: 'Add Batter', number: '—', hand: null as ('L' | 'R' | null) };
  const lineupIsEmpty = !lineup.some(p => p?.name?.trim());

  const [showFoulModal, setShowFoulModal] = useState(false);
  const [showBatterHistory, setShowBatterHistory] = useState(false);
  const [showPitcherStats, setShowPitcherStats] = useState(false);

  const completedABs = allAtBats
    .filter(ab => _matchesBatter(ab) && ab.isComplete && ab.pitches.length > 0)
    .sort((a, b) => b.atBatNumber - a.atBatNumber);

  // ── Auto-record wrappers with toggle support ────────────────────────────────
  const handleSetSwing = (s: SwingResult) => {
    if (pendingPitch.swing === s) {
      // Toggle off — deselect the button
      onSetSwing(null);
      return;
    }
    onSetSwing(s);
    if (s === 'no-swing') onRecordPitch(); // Looking: record immediately
  };

  const handleSetContact = (c: ContactType) => {
    if (c === 'foul') {
      setShowFoulModal(true);
      return;
    }
    onSetContact(c);
    onRecordPitch();
  };

  const handleSwingStrike = () => {
    onRecordPitch();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 relative">
      <BaseDiamond
        baseState={state.baseState}
        outsCount={state.outsCount}
        onSetBase={onSetBase}
      />
      <PlayerHeader
        pitcher={pitcher}
        batter={batter}
        atBatNumber={batterAtBats.length + 1}
        onBatterClick={() => setShowBatterHistory(true)}
        onPitcherClick={pitcher.name?.trim() ? () => setShowPitcherStats(true) : undefined}
      />

      {/* Empty-lineup banner */}
      {lineupIsEmpty && (
        <div className="mx-3 mt-2 px-3 py-2 bg-amber-900/40 border border-amber-700/50 rounded-xl flex items-center justify-between">
          <span className="text-amber-300 text-[18px]">No batters added yet</span>
          <button onClick={() => onTabChange('lineup')} className="text-amber-400 text-[18px] font-bold underline">
            Go to Lineup →
          </button>
        </div>
      )}

      {/* Count row with Undo on the right */}
      <div className="px-3 pt-2 pb-1 space-y-1">
        <CountDisplay
          balls={balls}
          strikes={strikes}
          pitchNumber={pitchNum}
          canUndo={canUndo}
          onUndo={onUndoPitch}
        />
        {currentAtBat && currentAtBat.pitches.length > 0 && <PitchHistoryStrip pitches={currentAtBat.pitches} />}
      </div>

      {/* Overlay filter pills — abbreviated, one row, selected state matches Overlay button blue */}
      {overlayEnabled && (
        <div className="px-3 pb-1 grid grid-cols-5 gap-1.5">
          {OVERLAY_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => onSetOverlayFilter(f)}
              className={`text-[14px] px-1 py-1 rounded-lg font-semibold transition-colors text-center ${
                overlayFilter === f
                  ? 'bg-blue-700 text-blue-100'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      )}

      {/* Strike zone */}
      <div className="flex-shrink-0 px-2 py-1">
        <StrikeZone
          selected={pendingPitch.location}
          onSelect={onSetLocation}
          currentAtBatPitches={currentAtBat?.pitches ?? []}
          historicalPitches={overlayEnabled
            ? batterAtBats.flatMap(ab => ab.pitches).filter(p => overlayFilter === 'all' || p.pitchType === overlayFilter)
            : []}
          batterHand={batterHand}
          onSetBatterHand={onSetBatterHand}
          swing={pendingPitch.swing}
          onSetSwing={handleSetSwing}
        />
      </div>

      {/* Pitch type + contact buttons */}
      <div className="flex-1 overflow-y-auto px-3 pb-1">
        <PitchControls
          pitchType={pendingPitch.pitchType}
          swing={pendingPitch.swing}
          contact={pendingPitch.contact}
          onSetPitchType={onSetPitchType}
          onSetContact={handleSetContact}
          onSwingStrike={handleSwingStrike}
          balls={balls}
          strikes={strikes}
        />
      </div>

      {/* Bottom row: Next Batter | ← Prev Batter | Overlay */}
      <div className="px-3 pb-3 pt-1 flex-shrink-0">
        <div className="flex gap-1.5">
          <button onClick={onNextBatter} className="flex-1 h-9 rounded-lg text-[18px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300">
            Next Batter ›
          </button>
          <button onClick={onPrevBatter} className="flex-1 h-9 rounded-lg text-[18px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300">
            ‹ Prev Batter
          </button>
          <button
            onClick={onToggleOverlay}
            className={`flex-1 h-9 rounded-lg text-[18px] font-medium transition-colors ${overlayEnabled ? 'bg-blue-700 hover:bg-blue-600 text-blue-100' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
          >
            👁 Overlay
          </button>
        </div>
      </div>

      {/* ── Foul Ball Caught? Modal ── */}
      {showFoulModal && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 px-6">
          <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-xs border border-slate-600 space-y-4">
            <div className="text-center">
              <p className="text-white font-bold text-[24px]">Foul Ball</p>
              <p className="text-slate-400 text-[21px] mt-1">Was it caught for an out?</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setShowFoulModal(false);
                  onSetContact('in-play');
                  onRecordPitch();
                }}
                className="py-3 rounded-xl text-[21px] font-bold bg-red-700 hover:bg-red-600 text-white"
              >
                ✓ Yes — Out
              </button>
              <button
                onClick={() => {
                  setShowFoulModal(false);
                  onSetContact('foul');
                  onRecordPitch();
                }}
                className="py-3 rounded-xl text-[21px] font-bold bg-slate-700 hover:bg-slate-600 text-amber-300"
              >
                ✗ No — Foul
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Batter History Modal ── */}
      {showBatterHistory && (
        <div className="absolute inset-0 bg-black/80 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0">
            <div>
              <p className="text-slate-100 font-bold text-[21px]">{batter.name}</p>
              <p className="text-slate-400 text-[18px]">#{batter.number} · {completedABs.length} previous at-bat{completedABs.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => setShowBatterHistory(false)}
              className="w-9 h-9 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-[27px] font-bold flex items-center justify-center"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {completedABs.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-500 text-[21px]">No previous at-bats yet</p>
                <p className="text-slate-600 text-[18px] mt-1">History will appear here after each at-bat</p>
              </div>
            ) : (
              completedABs.map(ab => (
                <div key={ab.id} className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
                    <p className="text-slate-400 text-[18px] font-medium">
                      AB #{ab.atBatNumber} · {ab.pitches.length} pitch{ab.pitches.length !== 1 ? 'es' : ''}
                    </p>
                    <span className={`text-[18px] font-bold ${getResultColor(ab)}`}>
                      {getResultBadge(ab)}
                    </span>
                  </div>
                  <div className="space-y-1.5 px-3 pb-1">
                    {ab.pitches.map((pitch, i) => (
                      <PitchRow
                        key={pitch.id}
                        pitch={pitch}
                        index={i}
                        playerHand={batter.hand}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pitcher stats modal */}
      {showPitcherStats && pitcher.name?.trim() && (
        <PitcherStatsModal
          pitcher={pitcher}
          allAtBats={allAtBats}
          currentAtBat={currentAtBat}
          onClose={() => setShowPitcherStats(false)}
        />
      )}
    </div>
  );
}
