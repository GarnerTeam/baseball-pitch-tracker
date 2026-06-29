'use client';
import { PitchType, SwingResult, ContactType, PitchRecord } from '@/types';
import { PITCH_TYPE_LABELS, PITCH_TYPE_COLORS } from '@/types';

// ── Intel card helpers ─────────────────────────────────────────────────────────
const OUTCOME_SHORT: Record<string, string> = {
  ball: 'Ball', 'called-strike': 'Kl', 'swinging-strike': 'Ks',
  foul: 'F', 'foul-tip': 'F✓', 'in-play': 'IP', walk: 'BB', strikeout: 'K',
};
const OUTCOME_CLR: Record<string, string> = {
  ball: '#60a5fa', walk: '#38bdf8',
  'called-strike': '#f87171', 'swinging-strike': '#f87171', strikeout: '#ef4444',
  foul: '#fbbf24', 'foul-tip': '#fcd34d', 'in-play': '#34d399',
};
function zoneShort(loc: PitchRecord['location']): string {
  if (!loc) return '?';
  if (loc.zone === 'strike') {
    const N = ['Hi-In','High','Hi-Out','Mid-In','Ctr','Mid-Out','Lo-In','Low','Lo-Out'];
    return N[(loc.zoneNumber ?? 1) - 1] ?? 'Z?';
  }
  const v = loc.row === 0 ? 'Hi' : loc.row === 4 ? 'Lo' : '';
  const h = loc.col === 0 ? 'In' : loc.col === 4 ? 'Out' : '';
  if (v && h) return `B:${v}-${h}`;
  return v ? `B:${v}` : h ? `B:${h}` : 'Ball';
}

const STRIKE_OUTCOMES = new Set([
  'called-strike', 'swinging-strike', 'foul', 'foul-tip', 'strikeout',
]);

function bestStrikePitch(pitches: PitchRecord[]): { type: PitchType; pct: number } | null {
  if (pitches.length === 0) return null;
  const types = ['FB', 'CB', 'SL', 'CH'] as PitchType[];
  let best: { type: PitchType; pct: number } | null = null;
  for (const t of types) {
    const group = pitches.filter(p => p.pitchType === t);
    if (group.length < 1) continue;
    const strikes = group.filter(p => STRIKE_OUTCOMES.has(p.outcome)).length;
    const pct = Math.round((strikes / group.length) * 100);
    if (!best || pct > best.pct) best = { type: t, pct };
  }
  return best;
}

function IntelCard({ label, pitches }: { label: string; pitches: PitchRecord[] }) {
  const shown = pitches.slice(0, 5);
  const rec = bestStrikePitch(pitches);
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wide">{label}</span>
        <span className="text-slate-600 text-[11px]">{pitches.length}×</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-slate-700 text-[12px] text-center py-1">—</p>
      ) : (
        <>
          {/* Best pitch for a strike */}
          {rec && (
            <div className="flex items-center gap-1 mb-1.5 px-1.5 py-1 rounded-lg bg-slate-800 border border-slate-700">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide shrink-0">Best K</span>
              <span className="text-[13px] font-black ml-1" style={{ color: PITCH_TYPE_COLORS[rec.type] }}>
                {rec.type}
              </span>
              <span className="text-[12px] font-bold text-emerald-400 ml-auto">{rec.pct}%</span>
            </div>
          )}
          <div className="space-y-[3px]">
            {shown.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-[12px] font-black w-7 shrink-0" style={{ color: PITCH_TYPE_COLORS[p.pitchType] }}>
                  {p.pitchType}
                </span>
                <span className="text-slate-500 text-[11px] flex-1 truncate">{zoneShort(p.location)}</span>
                <span className="text-[11px] font-semibold" style={{ color: OUTCOME_CLR[p.outcome] ?? '#94a3b8' }}>
                  {OUTCOME_SHORT[p.outcome] ?? p.outcome}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface PitchControlsProps {
  pitchType: PitchType | null;
  swing: SwingResult | null;
  contact: ContactType;
  onSetPitchType: (t: PitchType) => void;
  onSetContact: (c: ContactType) => void;
  onSwingStrike: () => void;
  balls: number;
  strikes: number;
  firstPitches: PitchRecord[];
  secondPitches: PitchRecord[];
}

// Order: FB=1, CB=2, SL=3, CH=4
const PITCH_TYPES: { type: PitchType; num: number }[] = [
  { type: 'FB', num: 1 },
  { type: 'CB', num: 2 },
  { type: 'SL', num: 3 },
  { type: 'CH', num: 4 },
];

// Shared button height class — both pitch type and contact buttons use this
// py-1 + text sizes below ≈ 25% shorter than the original py-2 layout
const BTN_H = 'py-[3px]';

export function PitchControls({ pitchType, swing, contact, onSetPitchType, onSetContact, onSwingStrike, balls, strikes, firstPitches, secondPitches }: PitchControlsProps) {
  return (
    <div className="space-y-3 pt-2">
      {/* Pitch Type */}
      <div>
        <p className="text-slate-400 text-[18px] mb-1.5">Pitch Type</p>
        <div className="grid grid-cols-4 gap-2">
          {PITCH_TYPES.map(({ type: t, num }) => (
            <button
              key={t}
              onClick={() => onSetPitchType(t)}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0 ${
                pitchType === t ? 'text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              style={pitchType === t ? { backgroundColor: PITCH_TYPE_COLORS[t] } : {}}
            >
              <span className={`text-[18px] font-black leading-none ${pitchType === t ? 'opacity-80' : 'text-slate-400'}`}>{num}</span>
              <span className="text-[22px] font-black leading-none">{t}</span>
            </button>
          ))}
        </div>
        {pitchType && (
          <p className="text-[18px] mt-1 text-center font-medium" style={{ color: PITCH_TYPE_COLORS[pitchType] }}>
            {PITCH_TYPE_LABELS[pitchType]}
          </p>
        )}
      </div>

      {/* 1st / 2nd pitch intel cards */}
      {(firstPitches.length > 0 || secondPitches.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <IntelCard label="1st Pitch" pitches={firstPitches} />
          <IntelCard label="2nd Pitch" pitches={secondPitches} />
        </div>
      )}

      {/* Contact — shown after Swing is selected, same height as pitch type buttons */}
      {swing === 'swing' && (
        <div>
          <p className="text-slate-400 text-[18px] mb-1.5">Contact</p>
          <div className="grid grid-cols-4 gap-2">
            {/* Swing Strike */}
            <button
              onClick={onSwingStrike}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0 bg-red-900 hover:bg-red-800 text-red-200`}
            >
              <span className="text-[22px] font-black leading-none">☒</span>
              <span className="text-[15px] font-bold leading-none">Miss</span>
            </button>

            {/* Foul Ball */}
            <button
              onClick={() => onSetContact('foul')}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0 bg-slate-800 hover:bg-slate-700 text-amber-300`}
            >
              <span className="text-[22px] font-black leading-none">F</span>
              <span className="text-[15px] font-bold leading-none">
                {strikes >= 2 ? 'Foul*' : 'Foul'}
              </span>
            </button>

            {/* Dropped 3rd Strike — replaces Foul Tip */}
            <button
              onClick={() => onSetContact('dropped-third')}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0 ${
                strikes >= 2
                  ? 'bg-purple-900 hover:bg-purple-800 text-purple-200'
                  : 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
              }`}
              disabled={strikes < 2}
              title={strikes < 2 ? 'Only available on strike 3' : 'Dropped 3rd Strike'}
            >
              <span className="text-[22px] font-black leading-none">3↓</span>
              <span className="text-[13px] font-bold leading-none text-center leading-tight">
                {strikes >= 2 ? 'Drop 3K' : 'Drop 3K'}
              </span>
            </button>

            {/* In Play */}
            <button
              onClick={() => onSetContact('in-play')}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0 bg-emerald-800 hover:bg-emerald-700 text-emerald-100`}
            >
              <span className="text-[22px] font-black leading-none">→</span>
              <span className="text-[15px] font-bold leading-none">In Play</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
