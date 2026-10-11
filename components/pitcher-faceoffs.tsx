'use client';
import { useState } from 'react';
import { PitchRecord } from '@/types';
import { PitchRow } from '@/components/pitch-row';

/**
 * "Batters Faced": every plate appearance against one pitcher, grouped by
 * batter in lineup order, with the result and the pitch-by-pitch sequence on
 * tap. Lives on the pitcher's page; batter cards on the Lineup tab show the
 * batter's whole game instead.
 */

const HIT: Record<string, string> = { single: '1B', double: '2B', triple: '3B', 'home-run': 'HR', out: 'Out', error: 'E' };

interface PA {
  key: string;
  atBatNumber: number;
  pitches: PitchRecord[];
  result: string;
  tone: 'good' | 'bad' | 'neutral';
}

function resultOf(pitches: PitchRecord[], continued: boolean): Pick<PA, 'result' | 'tone'> {
  const last = pitches[pitches.length - 1];
  if (last.outcome === 'strikeout') return { result: last.swing ? 'K' : 'K looking', tone: 'good' };
  if (last.outcome === 'walk') return { result: 'BB', tone: 'bad' };
  if (last.outcome === 'hit-by-pitch') return { result: 'HBP', tone: 'bad' };
  if (last.outcome === 'in-play') {
    const r = last.hitData?.result ?? '';
    return { result: HIT[r] ?? 'In play', tone: r === 'out' ? 'good' : r === 'error' ? 'neutral' : 'bad' };
  }
  return { result: continued ? 'Relieved' : `${last.ballsAfter}-${last.strikesAfter}`, tone: 'neutral' };
}

/** Plate appearances in `pitches` (one pitcher's), grouped by batter. */
export function groupFaceOffs(pitches: PitchRecord[], allGamePitches: PitchRecord[] = pitches) {
  const pas = new Map<string, { batter: string; number: string; spot: number; first: number; pas: Map<string, PitchRecord[]> }>();
  pitches.forEach((p, i) => {
    const bKey = `${p.lineupPosition}|${p.batterName}|${p.batterNumber}`;
    const b = pas.get(bKey) ?? { batter: p.batterName, number: p.batterNumber, spot: p.lineupPosition, first: i, pas: new Map() };
    const aKey = `${p.gameId}|${p.atBatNumber}`;
    b.pas.set(aKey, [...(b.pas.get(aKey) ?? []), p]);
    pas.set(bKey, b);
  });
  return [...pas.values()]
    .sort((a, b) => a.spot - b.spot || a.first - b.first)
    .map(b => ({
      batter: b.batter, number: b.number, spot: b.spot,
      pas: [...b.pas.entries()].map(([key, ps]): PA => {
        const sorted = [...ps].sort((x, y) => x.pitchNumber - y.pitchNumber);
        const last = sorted[sorted.length - 1];
        // Did another pitcher finish this at-bat?
        const continued = allGamePitches.some(q =>
          q.gameId === last.gameId && q.atBatNumber === last.atBatNumber && q.lineupPosition === last.lineupPosition
          && q.batterName === last.batterName && q.pitchNumber > last.pitchNumber);
        return { key, atBatNumber: last.atBatNumber, pitches: sorted, ...resultOf(sorted, continued) };
      }).sort((x, y) => x.atBatNumber - y.atBatNumber),
    }));
}

const TONE = { good: 'text-emerald-400', bad: 'text-red-400', neutral: 'text-slate-400' };

export function PitcherFaceOffs({ pitches, allGamePitches }: { pitches: PitchRecord[]; allGamePitches?: PitchRecord[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const batters = groupFaceOffs(pitches, allGamePitches);
  if (batters.length === 0) return null;
  const totalPA = batters.reduce((n, b) => n + b.pas.length, 0);

  return (
    <div>
      <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">
        Batters Faced <span className="text-slate-600 normal-case tracking-normal">· {totalPA} plate appearance{totalPA === 1 ? '' : 's'}</span>
      </p>
      <div className="bg-slate-900 rounded-xl border border-slate-700 divide-y divide-slate-800">
        {batters.map(b => (
          <div key={`${b.spot}|${b.batter}|${b.number}`} className="px-3 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 text-[14px] w-5 flex-shrink-0">{b.spot + 1}.</span>
              <span className="text-slate-100 text-[17px] font-semibold">{b.batter || 'Unnamed'}</span>
              {b.number && <span className="text-slate-500 text-[14px]">#{b.number}</span>}
              <span className="ml-auto flex gap-1.5 flex-wrap justify-end">
                {b.pas.map(pa => (
                  <button
                    key={pa.key}
                    onClick={() => setOpen(open === pa.key ? null : pa.key)}
                    className={`px-2 py-0.5 rounded-md border text-[14px] font-bold ${open === pa.key ? 'bg-slate-700 border-slate-500' : 'bg-slate-800 border-slate-700'} ${TONE[pa.tone]}`}
                  >
                    {pa.result}
                    <span className="text-slate-500 font-normal"> ·{pa.pitches.length}p</span>
                  </button>
                ))}
              </span>
            </div>
            {b.pas.filter(pa => pa.key === open).map(pa => (
              <div key={pa.key} className="mt-2 space-y-1.5">
                {pa.pitches.map((p, i) => <PitchRow key={p.id} pitch={p} index={i} playerHand={p.batterHand ?? null} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-slate-600 text-[13px] mt-1">Tap a result to see its pitches (3p = 3 pitches)</p>
    </div>
  );
}
