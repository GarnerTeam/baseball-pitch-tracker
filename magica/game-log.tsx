'use client';
import { useState } from 'react';
import { GameState, AtBat, PitchRecord } from '@/types';
import { PITCH_TYPE_COLORS } from '@/types';
import { KLabel, getBallLabel } from '@/components/pitch-row';

const OUTCOME_SYM: Record<string, string> = {
  ball: 'B',
  'called-strike': 'Kc',
  'swinging-strike': 'Ks',
  foul: 'F',
  'foul-tip': 'FT',
  'in-play': 'IP',
  walk: 'BB',
  strikeout: 'K',
};
const OUTCOME_COL: Record<string, string> = {
  ball: '#22c55e',
  'called-strike': '#ef4444',
  'swinging-strike': '#dc2626',
  foul: '#f97316',
  'foul-tip': '#fb923c',
  'in-play': '#3b82f6',
  walk: '#10b981',
  strikeout: '#7f1d1d',
};

function resultBadge(ab: AtBat) {
  if (!ab.result) return null;
  if (ab.result === 'strikeout') {
    const last = ab.pitches[ab.pitches.length - 1];
    const wasSwing = last ? last.swing : true;
    return { label: wasSwing ? 'K' : 'ꓘ', bg: 'bg-red-900', text: 'text-red-300' };
  }
  if (ab.result === 'walk')      return { label: 'BB',   bg: 'bg-green-900',  text: 'text-green-300' };
  if (ab.result === 'in-play')   return { label: 'IP',   bg: 'bg-blue-900',   text: 'text-blue-300'  };
  if (ab.result === 'manual-end') return { label: 'END', bg: 'bg-slate-700',  text: 'text-slate-300' };
  return { label: ab.result, bg: 'bg-slate-700', text: 'text-slate-300' };
}

function PitchDetailRow({ pitch, num }: { pitch: PitchRecord; num: number }) {
  const sym = OUTCOME_SYM[pitch.outcome] ?? pitch.outcome;
  const col = OUTCOME_COL[pitch.outcome] ?? '#94a3b8';
  const tc  = PITCH_TYPE_COLORS[pitch.pitchType];
  const loc = pitch.location ? getBallLabel(pitch.location.row, pitch.location.col, pitch.batterHand ?? null) : '—';

  return (
    <div className="flex items-center gap-2 py-2 px-3 border-b border-slate-800/60 last:border-0">
      {/* Pitch number */}
      <span className="text-slate-600 text-[15px] w-5 text-right flex-shrink-0">{num}</span>

      {/* Type chip */}
      <span
        className="text-[17px] font-bold px-2 py-0.5 rounded flex-shrink-0"
        style={{ background: tc + '33', color: tc }}
      >
        {pitch.pitchType}
      </span>

      {/* Location */}
      <span className="text-slate-400 text-[17px] flex-shrink-0 w-16">{loc}</span>

      {/* Swing/Look */}
      <span className="text-slate-500 text-[17px] flex-shrink-0">
        {pitch.swing === true ? 'Swing' : pitch.swing === false ? 'Look' : '—'}
      </span>

      {/* Outcome chip */}
      <span
        className="text-[17px] font-bold px-2 py-0.5 rounded flex-shrink-0"
        style={{ background: col + '33', color: col }}
      >
        {sym}
      </span>

      {/* Count after */}
      <span className="text-slate-500 text-[15px] ml-auto flex-shrink-0">
        {pitch.ballsAfter}-{pitch.strikesAfter}
      </span>
    </div>
  );
}

function AtBatCard({
  atBat,
  isLive,
  defaultOpen,
}: {
  atBat: AtBat;
  isLive: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const first  = atBat.pitches[0];
  const badge  = resultBadge(atBat);
  const border = isLive ? 'border-blue-600' : 'border-slate-700';
  const header = isLive ? 'border-blue-800 bg-blue-950/40' : 'border-slate-700 bg-slate-800/50';

  return (
    <div className={`bg-slate-900 rounded-xl border mb-3 overflow-hidden ${border}`}>
      {/* ── Header row — tap to expand/collapse ── */}
      <button
        className={`w-full flex items-center gap-2 px-3 py-2.5 border-b ${header} active:opacity-70 transition-opacity`}
        onClick={() => setOpen(o => !o)}
      >
        {/* Batter name + AB number */}
        <span className="text-slate-300 font-semibold text-[21px] truncate">
          #{first?.batterNumber ?? '?'} {first?.batterName ?? '—'}
        </span>
        <span className="text-slate-500 text-[18px] flex-shrink-0">AB #{atBat.atBatNumber}</span>

        {/* Live badge */}
        {isLive && (
          <span className="ml-auto flex-shrink-0 text-[17px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
            LIVE
          </span>
        )}

        {/* Result badge */}
        {!isLive && badge && (
          <span className={`${isLive ? '' : 'ml-auto'} flex-shrink-0 text-[17px] font-bold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
            {badge.label}
          </span>
        )}

        {/* Pitch count */}
        <span className="text-slate-500 text-[17px] flex-shrink-0 ml-1">
          {atBat.pitches.length}p
        </span>

        {/* Chevron */}
        <span className="text-slate-600 text-[17px] flex-shrink-0 ml-1">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* ── Pitch detail rows (collapsible) ── */}
      {open && (
        <div>
          {atBat.pitches.length > 0 ? (
            atBat.pitches.map((p, i) => (
              <PitchDetailRow key={p.id} pitch={p} num={i + 1} />
            ))
          ) : (
            <p className="text-slate-500 text-[18px] px-3 py-3 text-center">No pitches yet</p>
          )}
        </div>
      )}
    </div>
  );
}

export function GameLog({
  state,
  onEndAtBat,
}: {
  state: GameState;
  onEndAtBat: () => void;
}) {
  const { allAtBats, currentAtBat } = state;

  const items = [
    ...(currentAtBat ? [{ ab: currentAtBat, isLive: true }] : []),
    ...[...allAtBats].reverse().map(ab => ({ ab, isLive: false })),
  ];

  const totalPitches = items.reduce((n, x) => n + x.ab.pitches.length, 0);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3 p-8">
        <div className="text-[72px]">📋</div>
        <p className="text-[24px] font-medium text-slate-300">No pitches logged</p>
        <p className="text-[18px] text-center">Pitches will appear here as you record them.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800 px-3 py-2.5 flex items-center justify-between">
        <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider">Pitch Log</p>
        <div className="flex items-center gap-2">
          <p className="text-slate-500 text-[17px]">
            {items.length} ABs · {totalPitches} pitches
          </p>
          <button
            onClick={onEndAtBat}
            className="text-[17px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 font-medium border border-slate-700"
          >
            End AB
          </button>
        </div>
      </div>

      {/* ── At-bat cards ── */}
      <div className="px-3 pt-3 pb-8">
        {items.map(({ ab, isLive }, i) => (
          <AtBatCard
            key={ab.id}
            atBat={ab}
            isLive={isLive}
            defaultOpen={i === 0}   /* live / most-recent AB starts expanded */
          />
        ))}
      </div>
    </div>
  );
}
