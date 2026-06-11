'use client';
/**
 * Shared pitch-type bar chart with strike-% label above each bar.
 * Used on the Stats (analytics) screen and in the Pitcher Stats popup.
 */
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { PitchType, PitchRecord } from '@/types';
import { PITCH_TYPE_COLORS, PITCH_TYPE_LABELS } from '@/types';

// Ordered as FB=1, CB=2, SL=3, CH=4
const PITCH_ORDER: PitchType[] = ['FB', 'CB', 'SL', 'CH'];

export const PITCH_TYPE_SHORT: Record<PitchType, string> = {
  FB: 'FB', CB: 'CB', SL: 'SL', CH: 'Ch',
};

export interface PitchTypeStat {
  type: PitchType;
  label: string;       // display label for X-axis
  color: string;       // hex fill
  count: number;       // total pitches of this type
  strikes: number;     // strike-counted pitches of this type
  strikePct: number;   // 0-100
}

/** Build per-type stats from any pitch array (all pitches for one pitcher, or game-wide). */
export function buildPitchTypeStats(
  pitches: PitchRecord[],
  useShortLabels = false,
): PitchTypeStat[] {
  return PITCH_ORDER.map(t => {
    const tp = pitches.filter(p => p.pitchType === t);
    const ts = tp.filter(p =>
      ['called-strike', 'swinging-strike', 'foul', 'foul-tip', 'strikeout', 'in-play']
        .includes(p.outcome)
    ).length;
    return {
      type: t,
      label: useShortLabels ? PITCH_TYPE_SHORT[t] : PITCH_TYPE_LABELS[t],
      color: PITCH_TYPE_COLORS[t],
      count: tp.length,
      strikes: ts,
      strikePct: tp.length > 0 ? Math.round((ts / tp.length) * 100) : 0,
    };
  }).filter(s => s.count > 0);
}

interface Props {
  stats: PitchTypeStat[];
  /** px height of the chart area (default 160). Increase for more room. */
  height?: number;
}

export function PitchTypeBarChart({ stats, height = 160 }: Props) {
  if (stats.length === 0) return null;

  // Add a formatted label field used by LabelList
  const chartData = stats.map(s => ({
    ...s,
    strikeLabel: `${s.strikePct}%`,
  }));

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 p-3">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          margin={{ top: 22, right: 6, left: -22, bottom: 0 }}
        >
          <XAxis
            dataKey="label"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 10 }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              if (name === 'count') return [value, 'Pitches'];
              return [value, name];
            }}
          />
          <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={56}>
            {/* Strike-% label above each bar */}
            <LabelList
              dataKey="strikeLabel"
              position="top"
              style={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 700 }}
            />
            {chartData.map((e, i) => (
              <Cell key={i} fill={e.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-center text-slate-600 text-[10px] mt-0.5 tracking-wide">
        % above bar = strike rate per pitch type
      </p>
    </div>
  );
}
