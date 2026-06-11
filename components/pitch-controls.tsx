'use client';
import { PitchType, SwingResult, ContactType } from '@/types';
import { PITCH_TYPE_LABELS, PITCH_TYPE_COLORS } from '@/types';

interface PitchControlsProps {
  pitchType: PitchType | null;
  swing: SwingResult | null;
  contact: ContactType;
  onSetPitchType: (t: PitchType) => void;
  onSetContact: (c: ContactType) => void;
  onSwingStrike: () => void;
  balls: number;
  strikes: number;
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
const BTN_H = 'py-1';

export function PitchControls({ pitchType, swing, contact, onSetPitchType, onSetContact, onSwingStrike, balls, strikes }: PitchControlsProps) {
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
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${
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

      {/* Contact — shown after Swing is selected, same height as pitch type buttons */}
      {swing === 'swing' && (
        <div>
          <p className="text-slate-400 text-[18px] mb-1.5">Contact</p>
          <div className="grid grid-cols-4 gap-2">
            {/* Swing Strike */}
            <button
              onClick={onSwingStrike}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0.5 bg-red-900 hover:bg-red-800 text-red-200`}
            >
              <span className="text-[22px] font-black leading-none">☒</span>
              <span className="text-[15px] font-bold leading-none">Miss</span>
            </button>

            {/* Foul Ball */}
            <button
              onClick={() => onSetContact('foul')}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0.5 bg-slate-800 hover:bg-slate-700 text-amber-300`}
            >
              <span className="text-[22px] font-black leading-none">F</span>
              <span className="text-[15px] font-bold leading-none">
                {strikes >= 2 ? 'Foul*' : 'Foul'}
              </span>
            </button>

            {/* Foul Tip */}
            <button
              onClick={() => onSetContact('foul-tip')}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0.5 bg-slate-800 hover:bg-slate-700 text-amber-300`}
            >
              <span className="text-[22px] font-black leading-none">▲</span>
              <span className="text-[15px] font-bold leading-none">
                {strikes >= 2 ? 'Tip ⚡' : 'Tip'}
              </span>
            </button>

            {/* In Play */}
            <button
              onClick={() => onSetContact('in-play')}
              className={`${BTN_H} rounded-xl font-bold transition-all flex flex-col items-center justify-center gap-0.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-100`}
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
