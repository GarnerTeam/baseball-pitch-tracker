'use client';
import { GameState, PitchType, PitchRecord } from '@/types';
import { PITCH_TYPE_COLORS, PITCH_TYPE_LABELS } from '@/types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const OUTCOME_COLORS: Record<string, string> = { ball:'#22c55e','called-strike':'#ef4444','swinging-strike':'#dc2626',foul:'#f97316','foul-tip':'#fb923c','in-play':'#3b82f6',walk:'#10b981',strikeout:'#7f1d1d' };

function getAllPitches(state: GameState): PitchRecord[] {
  return [...state.allAtBats.flatMap(ab => ab.pitches), ...(state.currentAtBat?.pitches ?? [])];
}

export function AnalyticsScreen({ state }: { state: GameState }) {
  const all = getAllPitches(state);
  if (all.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3 p-8">
      <div className="text-5xl">📊</div>
      <p className="text-base font-medium text-slate-300">No pitches yet</p>
      <p className="text-sm text-center">Record pitches and stats will appear here.</p>
    </div>
  );
  const total = all.length;
  const strikes = all.filter(p => ['called-strike','swinging-strike','foul','foul-tip','strikeout'].includes(p.outcome)).length;
  const balls = all.filter(p => ['ball','walk'].includes(p.outcome)).length;
  const inPlay = all.filter(p => p.outcome === 'in-play').length;
  const typeData = (['FB','CH','CB','SL'] as PitchType[]).map(t => ({ name: PITCH_TYPE_LABELS[t], count: all.filter(p => p.pitchType===t).length, color: PITCH_TYPE_COLORS[t] })).filter(d => d.count > 0);
  const oc: Record<string,number> = {};
  all.forEach(p => { oc[p.outcome]=(oc[p.outcome]??0)+1; });
  const outcomeData = Object.entries(oc).map(([name,count]) => ({name,count}));
  const hm: number[][] = Array.from({length:5}, () => Array(5).fill(0));
  all.forEach(p => { if (p.location) hm[p.location.row][p.location.col]++; });
  const maxH = Math.max(...hm.flat(), 1);
  const bStats: Record<string,{name:string;pitches:number;k:number;bb:number}> = {};
  all.forEach(p => {
    if (!bStats[p.batterNumber]) bStats[p.batterNumber]={name:p.batterName,pitches:0,k:0,bb:0};
    bStats[p.batterNumber].pitches++;
    if (p.outcome==='strikeout') bStats[p.batterNumber].k++;
    if (p.outcome==='walk') bStats[p.batterNumber].bb++;
  });
  const hits = all.filter(p => p.hitData);
  return (
    <div className="flex flex-col overflow-y-auto bg-slate-950 text-slate-100 pb-8">
      <div className="px-3 pt-4 grid grid-cols-4 gap-2">
        {[{l:'Pitches',v:total,c:'text-slate-100'},{l:'Strikes',v:strikes,c:'text-red-400'},{l:'Balls',v:balls,c:'text-green-400'},{l:'In Play',v:inPlay,c:'text-blue-400'}].map(x => (
          <div key={x.l} className="bg-slate-900 rounded-xl p-2 text-center border border-slate-700">
            <div className={`text-xl font-bold ${x.c}`}>{x.v}</div>
            <div className="text-slate-500 text-xs mt-0.5">{x.l}</div>
          </div>
        ))}
      </div>
      {typeData.length > 0 && (
        <div className="px-3 pt-5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Pitch Types</p>
          <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={typeData} margin={{top:4,right:4,left:-20,bottom:0}}>
                <XAxis dataKey="name" tick={{fill:'#94a3b8',fontSize:11}} />
                <YAxis tick={{fill:'#94a3b8',fontSize:10}} allowDecimals={false} />
                <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:8}} />
                <Bar dataKey="count" radius={[4,4,0,0]}>{typeData.map(e => <Cell key={e.name} fill={e.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {outcomeData.length > 0 && (
        <div className="px-3 pt-4">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Outcomes</p>
          <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={outcomeData} layout="vertical" margin={{top:4,right:30,left:60,bottom:0}}>
                <XAxis type="number" tick={{fill:'#94a3b8',fontSize:10}} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{fill:'#94a3b8',fontSize:10}} width={70} />
                <Tooltip contentStyle={{background:'#1e293b',border:'1px solid #334155',borderRadius:8}} />
                <Bar dataKey="count" radius={[0,4,4,0]}>{outcomeData.map(e => <Cell key={e.name} fill={OUTCOME_COLORS[e.name]??'#64748b'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="px-3 pt-4">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Pitch Heat Map</p>
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
          <div className="mx-auto" style={{maxWidth:200}}>
            {hm.map((row, ri) => (
              <div key={ri} className="flex">
                {row.map((count, ci) => {
                  const intensity = count/maxH;
                  const isStrike = ri>=1&&ri<=3&&ci>=1&&ci<=3;
                  return <div key={ci} className="flex-1 flex items-center justify-center text-xs font-bold border border-slate-700" style={{aspectRatio:'1',background:count>0?`rgba(239,68,68,${0.2+intensity*0.8})`:isStrike?'#1e3a2e':'#0f172a',color:intensity>0.5?'white':'#94a3b8'}}>{count>0?count:''}</div>;
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-3 pt-4">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Batter Stats</p>
        <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
          <div className="grid grid-cols-4 text-xs text-slate-500 px-3 py-2 border-b border-slate-700 bg-slate-800/50">
            <span>Batter</span><span className="text-center">P</span><span className="text-center">K</span><span className="text-center">BB</span>
          </div>
          {Object.entries(bStats).map(([num, s]) => (
            <div key={num} className="grid grid-cols-4 text-sm px-3 py-2.5 border-b border-slate-800 last:border-0">
              <span className="text-slate-200 font-medium text-xs">#{num} {s.name}</span>
              <span className="text-center text-slate-300">{s.pitches}</span>
              <span className="text-center text-red-400 font-bold">{s.k}</span>
              <span className="text-center text-green-400 font-bold">{s.bb}</span>
            </div>
          ))}
        </div>
      </div>
      {hits.length > 0 && (
        <div className="px-3 pt-4">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Spray Chart</p>
          <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
            <svg viewBox="0 0 400 380" className="w-full" style={{maxHeight:200,background:'#1a2e1a',borderRadius:8}}>
              <path d="M 200 350 L 10 70 A 210 210 0 0 1 390 70 Z" fill="#22661a" opacity="0.7" />
              <path d="M 200 350 L 310 240 L 200 130 L 90 240 Z" fill="#8B5E3C" opacity="0.8" />
              {hits.map((p,i) => {
                const h=p.hitData!; const x=(h.x/100)*400; const y=(h.y/100)*380;
                const col=h.result==='out'?'#ef4444':h.result==='home-run'?'#eab308':h.result==='error'?'#f97316':'#22c55e';
                return <g key={i}><circle cx={x} cy={y} r="7" fill={col} opacity="0.85"/><circle cx={x} cy={y} r="7" fill="none" stroke="white" strokeWidth="1"/></g>;
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}