'use client';
import { GameState, AtBat, PitchRecord } from '@/types';
import { PITCH_TYPE_COLORS } from '@/types';

const OUTCOME_SYM: Record<string,string> = {ball:'B','called-strike':'Kc','swinging-strike':'Ks',foul:'F','foul-tip':'FT','in-play':'IP',walk:'BB',strikeout:'K'};
const OUTCOME_COL: Record<string,string> = {ball:'#22c55e','called-strike':'#ef4444','swinging-strike':'#dc2626',foul:'#f97316','foul-tip':'#fb923c','in-play':'#3b82f6',walk:'#10b981',strikeout:'#7f1d1d'};

function PitchRow({pitch,num}:{pitch:PitchRecord;num:number}) {
  const sym=OUTCOME_SYM[pitch.outcome]??pitch.outcome; const col=OUTCOME_COL[pitch.outcome]??'#94a3b8'; const tc=PITCH_TYPE_COLORS[pitch.pitchType];
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 text-xs border-b border-slate-800 last:border-0">
      <span className="text-slate-500 w-5 text-right">{num}</span>
      <span className="px-1.5 py-0.5 rounded font-bold" style={{background:tc+'33',color:tc}}>{pitch.pitchType}</span>
      <span className="text-slate-500">{pitch.location?.zone==='strike'?'Z':'B'}{pitch.location?.zoneNumber??''}</span>
      <span className="text-slate-400">{pitch.swing?'●':'○'}</span>
      <span className="px-1.5 py-0.5 rounded font-bold" style={{background:col+'33',color:col}}>{sym}</span>
      <span className="text-slate-500 ml-auto">{pitch.ballsAfter}-{pitch.strikesAfter}</span>
    </div>
  );
}

function AtBatCard({atBat,isLive}:{atBat:AtBat;isLive:boolean}) {
  const first=atBat.pitches[0];
  return (
    <div className={`bg-slate-900 rounded-xl border mb-3 overflow-hidden ${isLive?'border-blue-600':'border-slate-700'}`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${isLive?'border-blue-800 bg-blue-950/40':'border-slate-700 bg-slate-800/50'}`}>
        <span className="text-slate-300 font-semibold text-sm">#{first?.batterNumber??'?'} {first?.batterName??'—'}</span>
        <span className="text-slate-500 text-xs">AB #{atBat.atBatNumber}</span>
        {isLive&&<span className="ml-auto text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">LIVE</span>}
        {!isLive&&atBat.result&&<span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${atBat.result==='strikeout'?'bg-red-900 text-red-300':atBat.result==='walk'?'bg-green-900 text-green-300':'bg-slate-700 text-slate-300'}`}>{atBat.result==='strikeout'?'K':atBat.result==='walk'?'BB':atBat.result==='in-play'?'IP':'END'}</span>}
        <span className="text-slate-500 text-xs ml-1">{atBat.pitches.length}p</span>
      </div>
      <div>
        {atBat.pitches.map((p,i)=><PitchRow key={p.id} pitch={p} num={i+1}/>)}
        {atBat.pitches.length===0&&<p className="text-slate-500 text-xs px-3 py-2">No pitches</p>}
      </div>
    </div>
  );
}

export function GameLog({state}:{state:GameState}) {
  const {allAtBats,currentAtBat}=state;
  const items=[...(currentAtBat?[{ab:currentAtBat,isLive:true}]:[]),...[...allAtBats].reverse().map(ab=>({ab,isLive:false}))];
  if (items.length===0) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3 p-8">
      <div className="text-5xl">📋</div>
      <p className="text-base font-medium text-slate-300">No pitches logged</p>
    </div>
  );
  return (
    <div className="flex flex-col overflow-y-auto bg-slate-950 text-slate-100 px-3 pt-3 pb-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Pitch Log</p>
        <p className="text-slate-500 text-xs">{items.length} ABs &bull; {items.reduce((n,x)=>n+x.ab.pitches.length,0)} pitches</p>
      </div>
      {items.map(({ab,isLive})=><AtBatCard key={ab.id} atBat={ab} isLive={isLive}/>)}
    </div>
  );
}