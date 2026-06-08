'use client';
import { PitchType, SwingResult, ContactType } from '@/types';
import { PITCH_TYPE_LABELS, PITCH_TYPE_COLORS } from '@/types';

interface PitchControlsProps {
  pitchType: PitchType | null;
  swing: SwingResult | null;
  contact: ContactType;
  onSetPitchType: (t: PitchType) => void;
  onSetSwing: (s: SwingResult) => void;
  onSetContact: (c: ContactType) => void;
  balls: number;
  strikes: number;
}

const PITCH_TYPES: PitchType[] = ['FB', 'CH', 'CB', 'SL'];

export function PitchControls({ pitchType, swing, contact, onSetPitchType, onSetSwing, onSetContact, balls, strikes }: PitchControlsProps) {
  return (
    <div className="space-y-3 pt-2">
      <div>
        <p className="text-slate-400 text-xs mb-1.5">Pitch Type</p>
        <div className="grid grid-cols-4 gap-2">
          {PITCH_TYPES.map(t => (
            <button key={t} onClick={() => onSetPitchType(t)} className={`py-2.5 rounded-xl text-sm font-bold transition-all ${pitchType === t ? 'text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`} style={pitchType === t ? { backgroundColor: PITCH_TYPE_COLORS[t] } : {}}>
              {t}
            </button>
          ))}
        </div>
        {pitchType && <p className="text-xs mt-1 text-center font-medium" style={{ color: PITCH_TYPE_COLORS[pitchType] }}>{PITCH_TYPE_LABELS[pitchType]}</p>}
      </div>
      <div>
        <p className="text-slate-400 text-xs mb-1.5">Swing?</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onSetSwing('swing')} className={`py-3 rounded-xl text-sm font-bold transition-all ${swing === 'swing' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>● Swing</button>
          <button onClick={() => onSetSwing('no-swing')} className={`py-3 rounded-xl text-sm font-bold transition-all ${swing === 'no-swing' ? 'bg-slate-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>○ No Swing</button>
        </div>
      </div>
      {swing === 'swing' && (
        <div>
          <p className="text-slate-400 text-xs mb-1.5">Contact</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'foul' as const, label: 'Foul Ball', hint: strikes >= 2 ? '(stays 2K)' : '' },
              { value: 'foul-tip' as const, label: 'Foul Tip', hint: strikes >= 2 ? '(K!)' : '' },
              { value: 'in-play' as const, label: 'In Play', hint: '' },
            ].map(c => (
              <button key={c.value} onClick={() => onSetContact(contact === c.value ? null : c.value)} className={`py-2.5 rounded-xl text-xs font-medium transition-all text-center ${contact === c.value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                <div>{c.label}</div>
                {c.hint && <div className="text-[10px] text-amber-400 mt-0.5">{c.hint}</div>}
              </button>
            ))}
          </div>
          {!contact && <p className="text-slate-500 text-xs mt-1.5 text-center">No contact = swinging strike</p>}
        </div>
      )}
    </div>
  );
}