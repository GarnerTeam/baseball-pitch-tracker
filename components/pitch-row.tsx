'use client';
/**
 * Shared pitch row component used in both the lineup panel batter card
 * and the pitch-screen at-bat history modal.
 *
 * Display rules
 * ─────────────
 * Every pitch → single line:  # | TYPE | LOC | Swing/Look → RESULT | COUNT
 * In-play pitch → adds line 2: HitType  ·  RunnerResult  ·  BallZone
 */
import { ReactNode } from 'react';
import { PitchRecord, PITCH_TYPE_COLORS, AtBat } from '@/types';

// ── Display maps ──────────────────────────────────────────────────────────────
export const HIT_TYPE_ICON: Record<string, string> = {
  'ground-ball': '⬇', 'line-drive': '→', 'fly-ball': '⬆', 'pop-up': '↑',
};
export const HIT_TYPE_LABEL: Record<string, string> = {
  'ground-ball': 'Ground Ball', 'line-drive': 'Line Drive',
  'fly-ball': 'Fly Ball',      'pop-up': 'Pop Up',
};
export const HIT_RESULT_ICON: Record<string, string> = {
  out: '🔴', error: '🟠', single: '🟢', double: '🔵', triple: '🟣', 'home-run': '⭐',
};
export const HIT_RESULT_LABEL: Record<string, string> = {
  out: 'Out', error: 'Error', single: '1B', double: '2B', triple: '3B', 'home-run': 'HR',
};
export const HIT_ZONE_ABBR: Record<string, string> = {
  'Shallow Left':   'Sha Lft',  'Shallow Right':  'Sha Rt',  'Shallow Center': 'Sha Ctr',
  'Deep Left':      'Dp Lft',   'Deep Right':     'Dp Rt',   'Deep Center':    'Dp Ctr',
  'C': 'C', 'SS': 'SS', '3B': '3B', '2B': '2B', '1B': '1B',
  'HR-Lft': 'HR·Lft', 'HR-LCtr': 'HR·LCtr', 'HR-RCtr': 'HR·RCtr', 'HR-Rt': 'HR·Rt',
  'Infield': 'Inf', 'Foul': 'Foul', 'Home Run': 'HR',
};
export const OUTCOME_COLOR: Record<string, string> = {
  'ball':            'text-blue-400',
  'called-strike':   'text-red-400',
  'swinging-strike': 'text-red-400',
  'foul':            'text-amber-400',
  'foul-tip':        'text-amber-400',
  'in-play':         'text-green-400',
  'walk':            'text-blue-300',
  'strikeout':       'text-red-500',
};

/** K = swinging strikeout | mirrored K = strikeout looking */
export function KLabel({ swing }: { swing: boolean }) {
  if (swing) return <>K</>;
  return <span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>K</span>;
}

/**
 * Convert a ball-zone row/col + batter handedness to a readable label.
 * col 0 = left from catcher's view; col 4 = right from catcher's view.
 */
export function getBallLabel(row: number, col: number, hand?: 'L' | 'R' | null): string {
  const v = row === 0 ? 'Up' : row === 4 ? 'Low' : '';
  const getH = (c: number): string => {
    if (c === 0) return hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'Left';
    if (c === 4) return hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'Right';
    return '';
  };
  const h = getH(col);
  if (v && h) return `${v}-${h}`;
  if (v) {
    if (col === 1) return `${v}-${hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'L'}`;
    if (col === 3) return `${v}-${hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'R'}`;
    return v;
  }
  if (h) {
    if (row === 1) return `${h}-Hi`;
    if (row === 3) return `${h}-Lo`;
    return h;
  }
  return '—';
}

/** Build the pitch-location label shown on the card (e.g. "Z4", "B-Up-In"). */
export function pitchLocLabel(pitch: PitchRecord, hand?: 'L' | 'R' | null): string {
  if (!pitch.location) return '—';
  if (pitch.location.zone === 'strike') return `Z${pitch.location.zoneNumber ?? ''}`;
  return `B-${getBallLabel(pitch.location.row, pitch.location.col, hand)}`;
}

/** Human-readable RESULT token shown on the first line of the pitch card. */
function outcomeToken(pitch: PitchRecord): React.ReactNode {
  switch (pitch.outcome) {
    case 'strikeout':       return <KLabel swing={pitch.swing} />;
    case 'in-play':         return 'In Play';
    case 'ball':            return 'Ball';
    case 'called-strike':   return 'Called ☒';
    case 'swinging-strike': return 'Miss ☒';
    case 'foul':            return 'Foul';
    case 'foul-tip':        return 'Foul Tip';
    case 'walk':            return 'Walk';
    default:                return pitch.outcome;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
interface PitchRowProps {
  pitch: PitchRecord;
  index: number;
  /** Batter handedness — used to label ball-zone locations (In/Out direction). */
  playerHand?: 'L' | 'R' | null;
}

export function PitchRow({ pitch, index, playerHand }: PitchRowProps) {
  const locLabel = pitchLocLabel(pitch, playerHand);
  const action   = pitch.swing ? 'Swing' : 'Look';
  const hd       = pitch.hitData;
  const isInPlay = pitch.outcome === 'in-play' && !!hd;

  const runnerResultColor = hd
    ? (hd.result === 'out' || hd.result === 'error' ? 'text-red-400' : 'text-green-400')
    : '';

  return (
    <div
      className={`text-[18px] rounded px-2
        ${isInPlay
          ? 'bg-green-950/25 border border-green-900/40 py-1.5 space-y-1.5'
          : 'bg-slate-900 py-1.5 flex items-center gap-1.5'}`}
    >
      {/* ── Line 1: pitch details (same for all outcomes) ── */}
      <div className="flex items-center gap-1.5 w-full">
        {/* Pitch # */}
        <span className="text-slate-600 w-4 text-right flex-shrink-0">{index + 1}</span>

        {/* Pitch type colored badge */}
        <span
          className="font-black w-6 text-center flex-shrink-0 text-[21px]"
          style={{ color: PITCH_TYPE_COLORS[pitch.pitchType] }}
        >
          {pitch.pitchType}
        </span>

        {/* Pitch location */}
        <span className="text-slate-400 text-[17px] w-14 flex-shrink-0 font-mono">{locLabel}</span>

        {/* Action */}
        <span className={`text-[15px] font-semibold flex-shrink-0 ${pitch.swing ? 'text-amber-400' : 'text-slate-400'}`}>
          {action}
        </span>

        <span className="text-slate-700 flex-shrink-0 text-[15px]">→</span>

        {/* Result */}
        <span className={`flex-1 font-semibold ${OUTCOME_COLOR[pitch.outcome] ?? 'text-slate-400'}`}>
          {outcomeToken(pitch)}
        </span>

        {/* Count after pitch */}
        <span className="text-slate-600 font-mono flex-shrink-0 text-[15px]">
          {pitch.ballsAfter}-{pitch.strikesAfter}
        </span>
      </div>

      {/* ── Line 2: hit details (in-play only) ── */}
      {isInPlay && hd && (
        <div className="flex items-center gap-1.5 pl-[26px] flex-wrap text-[17px]">
          {/* Ball type */}
          <span className="text-slate-300 flex-shrink-0">
            {HIT_TYPE_ICON[hd.type] ?? ''}
            {' '}
            {HIT_TYPE_LABEL[hd.type] ?? hd.type}
          </span>

          <span className="text-slate-700 flex-shrink-0">·</span>

          {/* Runner result */}
          <span className={`font-bold flex-shrink-0 ${runnerResultColor}`}>
            {HIT_RESULT_ICON[hd.result] ?? ''}
            {' '}
            {HIT_RESULT_LABEL[hd.result] ?? hd.result}
          </span>

          {/* Ball zone on field */}
          {hd.zone && (
            <>
              <span className="text-slate-700 flex-shrink-0">·</span>
              <span className="text-slate-300 font-semibold flex-shrink-0">
                {HIT_ZONE_ABBR[hd.zone] ?? hd.zone}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── At-bat result helpers (shared by lineup-panel and game-log) ───────────────
export function getAtBatResultBadge(ab: AtBat): ReactNode {
  if (ab.result === 'in-play') {
    const hd = ab.pitches.find(p => p.hitData)?.hitData;
    if (!hd) return '⚾ IP';
    const typeIcon    = HIT_TYPE_ICON[hd.type ?? '']  ?? '';
    const resultIcon  = HIT_RESULT_ICON[hd.result]    ?? '';
    const resultLabel = HIT_RESULT_LABEL[hd.result]   ?? hd.result;
    const isHR        = hd.result === 'home-run';
    const zone        = (!isHR && hd.zone) ? (HIT_ZONE_ABBR[hd.zone] ?? hd.zone) : '';
    const typePrefix  = typeIcon ? `${typeIcon} ` : '';
    return `${typePrefix}${resultIcon} ${resultLabel}${zone ? ' · ' + zone : ''}`;
  }
  if (ab.result === 'strikeout') {
    const last = ab.pitches[ab.pitches.length - 1];
    const wasSwing = last ? last.swing : true;
    return <><span className="text-red-400">🔴</span> <KLabel swing={wasSwing} /></>;
  }
  const map: Record<string, string> = { walk: '🟢 BB', 'manual-end': '—' };
  return map[ab.result ?? ''] ?? '—';
}

export function getAtBatResultColor(ab: AtBat): string {
  if (ab.result === 'strikeout') return 'text-red-400';
  if (ab.result === 'walk')      return 'text-blue-300';
  if (ab.result === 'in-play') {
    const r = ab.pitches.find(p => p.hitData)?.hitData?.result;
    if (r === 'out' || r === 'error') return 'text-red-400';
    return 'text-green-400';
  }
  return 'text-slate-400';
}
