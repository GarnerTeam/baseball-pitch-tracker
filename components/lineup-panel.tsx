'use client';
import { useState, ReactNode } from 'react';
import { GameState, Player, AtBat, PitchRecord } from '@/types';
import { PitchRow } from '@/components/pitch-row';
import { PitcherStatsModal } from '@/components/pitcher-stats-modal';

interface LineupPanelProps {
  state: GameState;
  onNextBatter: () => void;
  onPrevBatter: () => void;
  onEndAtBat: () => void;
  onChangePitcher: (p: Player) => void;
  onAddBatter: (p: Player) => void;
  onRemoveBatter: (idx: number) => void;
  onSetBatterAt: (idx: number, player: Player) => void;
  onUndoLastEnd: () => void;
  onSetWebhookUrl: (url: string) => void;
}

/** K = swinging strikeout  |  mirrored K = strikeout looking */
function KLabel({ swing }: { swing: boolean }) {
  if (swing) return <>K</>;
  return <span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>K</span>;
}

const OUTCOME_LABELS: Record<string, string> = {
  'ball': 'Ball',
  'called-strike': 'Called ☒',
  'swinging-strike': 'Swing ☒',
  'foul': 'Foul',
  'foul-tip': 'Foul Tip',
  'in-play': 'In Play',
  'walk': 'Walk',
  // 'strikeout' handled separately via KLabel
};
const OUTCOME_COLORS: Record<string, string> = {
  'ball': 'text-blue-400',
  'called-strike': 'text-red-400',
  'swinging-strike': 'text-red-400',
  'foul': 'text-amber-400',
  'foul-tip': 'text-amber-400',
  'in-play': 'text-green-400',
  'walk': 'text-blue-300',
  'strikeout': 'text-red-500',
};
const HIT_ZONE_ABBR: Record<string, string> = {
  'Shallow Left': 'Sha Lft', 'Shallow Right': 'Sha Rt', 'Shallow Center': 'Sha Ctr',
  'Deep Left': 'Dp Lft', 'Deep Right': 'Dp Rt', 'Deep Center': 'Dp Ctr',
  'C': 'C', 'SS': 'SS', '3B': '3B', '2B': '2B', '1B': '1B',
  'HR-Lft': 'HR·Lft', 'HR-LCtr': 'HR·LCtr', 'HR-RCtr': 'HR·RCtr', 'HR-Rt': 'HR·Rt',
  'Infield': 'Inf', 'Foul': 'Foul', 'Home Run': 'HR',
};

const _HIT_RESULT_ICONS: Record<string, string> = {
  out: '🔴', error: '🟠', single: '🟢', double: '🔵', triple: '🟣', 'home-run': '⭐',
};
const _HIT_RESULT_LABELS: Record<string, string> = {
  out: 'Out', error: 'Error', single: '1B', double: '2B', triple: '3B', 'home-run': 'HR',
};
const _HIT_TYPE_ICONS: Record<string, string> = {
  'ground-ball': '⬇', 'line-drive': '→', 'fly-ball': '⬆', 'pop-up': '↑',
};
function getResultBadge(ab: AtBat): ReactNode {
  if (ab.result === 'in-play') {
    const hd = ab.pitches.find(p => p.hitData)?.hitData;
    if (!hd) return '⚾ IP';
    const typeIcon   = _HIT_TYPE_ICONS[hd.type ?? '']   ?? '';
    const resultIcon  = _HIT_RESULT_ICONS[hd.result]    ?? '';
    const resultLabel = _HIT_RESULT_LABELS[hd.result]   ?? hd.result;
    // For HR the zone already says HR-Lft etc.; skip it to avoid '⭐ HR · HR·LCtr'
    const isHR = hd.result === 'home-run';
    const zone = (!isHR && hd.zone) ? (HIT_ZONE_ABBR[hd.zone] ?? hd.zone) : '';
    const typePrefix = typeIcon ? `${typeIcon} ` : '';
    return `${typePrefix}${resultIcon} ${resultLabel}${zone ? ' · ' + zone : ''}`;
  }
  if (ab.result === 'strikeout') {
    const lastPitch = ab.pitches[ab.pitches.length - 1];
    const wasSwing = lastPitch ? lastPitch.swing : true;
    return <>🔴 <KLabel swing={wasSwing} /></>;
  }
  const m: Record<string, string> = { 'walk': '🟢 BB', 'manual-end': '—' };
  return m[ab.result ?? ''] ?? '—';
}
function getResultColor(ab: AtBat): string {
  if (ab.result === 'strikeout') return 'text-red-400';
  if (ab.result === 'walk') return 'text-blue-300';
  if (ab.result === 'in-play') {
    const r = ab.pitches.find(p => p.hitData)?.hitData?.result;
    if (r === 'out' || r === 'error') return 'text-red-400';
    return 'text-green-400';
  }
  return 'text-slate-400';
}


// ── Field geometry constants (matches analytics-screen) ───────────────────────
const SW=400, SH=390, SHX=200, SHY=365;
const SR_FENCE=270, SR_WARN=220;
const SLFPX=9, SLFPY=174, SRFPX=391, SRFPY=174;
const SB1X=271, SB1Y=294, SB2X=200, SB2Y=224, SB3X=129, SB3Y=294;
const SMX=200, SMY=298;
const SWARN_LX=44, SWARN_LY=209, SWARN_RX=356, SWARN_RY=209;

function sprayHitColor(result: string) {
  if (result === 'out')       return '#ef4444';
  if (result === 'home-run')  return '#eab308';
  if (result === 'error')     return '#f97316';
  return '#22c55e';
}

function BatterSprayChart({ allABs }: { allABs: AtBat[] }) {
  const hits = allABs
    .flatMap(ab => ab.pitches)
    .filter((p): p is PitchRecord & { hitData: NonNullable<PitchRecord["hitData"]> } => !!p.hitData);

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-slate-500 text-[15px] uppercase tracking-wider px-0.5">Spray Chart</p>
      <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full rounded-xl" style={{ background: '#0a140a' }}>
        {/* Warning track */}
        <path d={`M ${SHX} ${SHY} L ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY} Z`} fill="#7a5c3a" />
        {/* Outfield grass */}
        <path d={`M ${SHX} ${SHY} L ${SWARN_LX} ${SWARN_LY} A ${SR_WARN} ${SR_WARN} 0 0 1 ${SWARN_RX} ${SWARN_RY} Z`} fill="#173d10" />
        {/* Infield */}
        <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#1e5216" />
        <path d={`M ${SHX} ${SHY} L ${SB1X} ${SB1Y} L ${SB2X} ${SB2Y} L ${SB3X} ${SB3Y} Z`} fill="#7a5230" opacity="0.45" />
        {/* Fence arc */}
        <path d={`M ${SLFPX} ${SLFPY} A ${SR_FENCE} ${SR_FENCE} 0 0 1 ${SRFPX} ${SRFPY}`} fill="none" stroke="#e5a020" strokeWidth="2.5" opacity="0.85" />
        {/* Foul lines */}
        <line x1={SHX} y1={SHY} x2={SLFPX} y2={SLFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
        <line x1={SHX} y1={SHY} x2={SRFPX} y2={SRFPY} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
        {/* Mound */}
        <circle cx={SMX} cy={SMY} r="9" fill="#9B6E4C" opacity="0.8" />
        <circle cx={SMX} cy={SMY} r="2" fill="#ccc" opacity="0.9" />
        {/* Bases */}
        {([
          [SHX, SHY, 'H', false],
          [SB1X, SB1Y, '1', true],
          [SB2X, SB2Y, '2', true],
          [SB3X, SB3Y, '3', true],
        ] as [number, number, string, boolean][]).map(([x, y, l, rotate]) => (
          <g key={l}>
            <rect x={x-9} y={y-9} width="18" height="18"
              fill={l==='H'?'#d4c5a0':'white'} rx="2"
              transform={rotate?`rotate(45 ${x} ${y})`:undefined} />
            <text x={x} y={y+4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#0a140a">{l}</text>
          </g>
        ))}
        {/* Hit dots */}
        {hits.length === 0 && (
          <text x={SW/2} y={SH/2} textAnchor="middle" fontSize="16" fill="#475569">No hits recorded</text>
        )}
        {hits.map((p, i) => {
          const x = (p.hitData.x / 100) * SW;
          const y = (p.hitData.y / 100) * SH;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="8" fill={sprayHitColor(p.hitData.result)} opacity="0.85" />
              <circle cx={x} cy={y} r="8" fill="none" stroke="white" strokeWidth="1.5" />
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div className="flex gap-3 flex-wrap px-0.5">
        {([
          { color: '#22c55e', label: 'Hit' },
          { color: '#ef4444', label: 'Out' },
          { color: '#eab308', label: 'HR' },
          { color: '#f97316', label: 'Error' },
        ] as { color: string; label: string }[]).map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-slate-500 text-[13px]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sheets URL Panel ──────────────────────────────────────────────────────────
function SheetsUrlPanel({ webhookUrl, syncQueue, onSave }: {
  webhookUrl: string;
  syncQueue: number;
  onSave: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(webhookUrl);
  const isConnected = !!webhookUrl?.trim();

  function save() {
    onSave(val.trim());
    setEditing(false);
  }

  return (
    <div className={`mx-3 mb-4 mt-2 rounded-xl border ${isConnected && !editing ? 'border-emerald-700 bg-emerald-950/30' : 'border-amber-700 bg-amber-950/20'} overflow-hidden`}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[18px]">{isConnected && !editing ? '✅' : '⚠️'}</span>
          <div>
            <p className={`text-[15px] font-bold ${isConnected && !editing ? 'text-emerald-300' : 'text-amber-300'}`}>
              {isConnected && !editing ? 'Sheets Connected' : 'Sheets Not Connected'}
            </p>
            {syncQueue > 0 && (
              <p className="text-amber-400 text-[13px]">{syncQueue} pitch{syncQueue !== 1 ? 'es' : ''} pending sync</p>
            )}
          </div>
        </div>
        {isConnected && !editing && (
          <button onClick={() => { setVal(webhookUrl); setEditing(true); }} className="text-slate-500 text-[15px] underline">
            Change
          </button>
        )}
      </div>
      {(!isConnected || editing) && (
        <div className="px-3 pb-3 space-y-2">
          <input
            value={val}
            onChange={e => setVal(e.target.value)}
            placeholder="https://script.google.com/macros/s/..."
            className="w-full h-10 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-3 text-[13px] outline-none focus:border-blue-500 placeholder:text-slate-600"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={!val.trim()} className="flex-1 h-9 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[15px] font-semibold">
              Connect
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} className="px-3 h-9 rounded-xl bg-slate-700 text-slate-300 text-[15px]">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LineupPanel({
  state, onNextBatter, onPrevBatter, onEndAtBat,
  onChangePitcher, onAddBatter, onRemoveBatter, onSetBatterAt,
  onUndoLastEnd, onSetWebhookUrl,
}: LineupPanelProps) {
  const {
    pitcher, lineup, currentBatterIndex, allAtBats,
    lastCompletedAtBatSnapshot, currentAtBat,
  } = state;
  // Guard against old localStorage saves that predate this field
  const pitcherHistory = state.pitcherHistory ?? [];

  // ── Pitcher state ──────────────────────────────────────────────────────────
  // 'idle' | 'new' (entering a new pitcher) | 'edit' (fixing current pitcher info)
  const [pitcherMode, setPitcherMode] = useState<'idle' | 'new' | 'edit'>(
    () => pitcher.name.trim() ? 'idle' : 'new'
  );
  const [pName, setPName] = useState('');
  const [pNum, setPNum]   = useState('');

  // ── Pitcher stats popup state ─────────────────────────────────────────────
  const [statsPitcher, setStatsPitcher] = useState<Player | null>(null);

  // ── Slot state ────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<{ idx: number; view: 'details' | 'edit' | 'edit-existing' } | null>(null);
  const [slotForm, setSlotForm] = useState({ name: '', num: '' });
  const [extraSlots, setExtraSlots] = useState(0);

  const MAX_SLOTS = 16;
  const visibleSlots = Math.max(9, lineup.length, Math.min(9 + extraSlots, MAX_SLOTS));

  // ── Pitcher helpers ────────────────────────────────────────────────────────
  /** Count pitches thrown by a specific pitcher (all recorded at-bats + current) */
  function getPitchCount(name: string, number: string): number {
    const historicalPitches = allAtBats
      .flatMap(ab => ab.pitches)
      .filter(p => p.pitcherName === name && p.pitcherNumber === number)
      .length;
    const currentPitches = (currentAtBat?.pitches ?? [])
      .filter(p => p.pitcherName === name && p.pitcherNumber === number)
      .length;
    return historicalPitches + currentPitches;
  }


  function openPitcherNew() {
    setPName('');
    setPNum('');
    setPitcherMode('new');
  }
  function openPitcherEdit() {
    setPName(pitcher.name);
    setPNum(pitcher.number);
    setPitcherMode('edit');
  }
  function savePitcher() {
    if (!pName.trim()) return;
    const id = pitcherMode === 'edit' ? pitcher.id : crypto.randomUUID();
    onChangePitcher({ id, name: pName.trim(), number: pNum.trim() });
    setPitcherMode('idle');
  }

  // ── Batter helpers ─────────────────────────────────────────────────────────
  /**
   * Filter at-bats for a specific batter.
   * Uses playerId when both the AtBat record and the player have IDs — this ensures
   * substituted players don't inherit the previous occupant's at-bat history.
   * Falls back to batterIndex for legacy records without playerId.
   */
  function getAllCompletedABs(batterIdx: number, playerId?: string): AtBat[] {
    // Detect whether a substitution has ever occurred at this slot.
    // A sub leaves behind at-bats with a *different* playerId at the same batterIndex.
    // If no sub has occurred, legacy at-bats (playerId === undefined) at this slot
    // safely belong to the current player (e.g. first AB created before lineup filled).
    const subHasOccurred = playerId
      ? allAtBats.some(ab => ab.playerId && ab.playerId !== playerId && ab.batterIndex === batterIdx)
      : false;

    return allAtBats
      .filter(ab => {
        const isComplete = ab.isComplete && ab.pitches.length > 0;
        if (!isComplete) return false;
        if (playerId) {
          // Exact UUID match — always include
          if (ab.playerId === playerId) return true;
          // Legacy record (no playerId) at the same slot — include only when no sub
          // has ever occurred here. Once a sub happens, anonymous records are ambiguous.
          if (!ab.playerId && ab.batterIndex === batterIdx && !subHasOccurred) return true;
          return false;
        }
        // No playerId on caller — fall back to position index
        return ab.batterIndex === batterIdx;
      })
      .sort((a, b) => b.atBatNumber - a.atBatNumber);
  }

  function getLastCompletedAB(batterIdx: number, playerId?: string): AtBat | undefined {
    return getAllCompletedABs(batterIdx, playerId)[0];
  }

  function openSlot(idx: number, view: 'details' | 'edit', prefill?: Player) {
    if (expanded?.idx === idx && expanded.view === view) {
      setExpanded(null);
    } else {
      setExpanded({ idx, view });
      setSlotForm({ name: prefill?.name ?? '', num: prefill?.number ?? '' });
    }
  }

  function handleSlotRowClick(idx: number) {
    const player = lineup[idx];
    if (!player?.name?.trim()) {
      openSlot(idx, 'edit');
    } else {
      openSlot(idx, 'details');
    }
  }

  function handleSubClick(e: React.MouseEvent, idx: number) {
    e.stopPropagation();
    // Open sub form with EMPTY fields — this is a new player, not editing the existing one
    if (expanded?.idx === idx && expanded.view === 'edit') {
      setExpanded(null);
    } else {
      setExpanded({ idx, view: 'edit' });
      setSlotForm({ name: '', num: '' });
    }
  }

  function handleSave(idx: number) {
    if (!slotForm.name.trim() || !slotForm.num.trim()) return;
    // NEW player id — this is critical: new player must NOT inherit old player's at-bat history
    const player: Player = { id: crypto.randomUUID(), name: slotForm.name.trim(), number: slotForm.num.trim() };
    onSetBatterAt(idx, player);
    setExpanded(null);
    setSlotForm({ name: '', num: '' });
  }

  function handleEditExistingClick(e: React.MouseEvent, idx: number, player: Player) {
    e.stopPropagation();
    if (expanded?.idx === idx && expanded.view === 'edit-existing') {
      setExpanded(null);
    } else {
      setExpanded({ idx, view: 'edit-existing' });
      setSlotForm({ name: player.name, num: player.number });
    }
  }

  function handleEditExistingSave(idx: number, currentPlayer: Player) {
    if (!slotForm.name.trim() || !slotForm.num.trim()) return;
    // KEEP the same player id so at-bat history stays attached to this player
    const player: Player = { ...currentPlayer, name: slotForm.name.trim(), number: slotForm.num.trim() };
    onSetBatterAt(idx, player);
    setExpanded(null);
    setSlotForm({ name: '', num: '' });
  }

  return (
    <>
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100">

      {/* ── At-Bat Controls ─────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">At-Bat Controls</p>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={onNextBatter} className="py-3 rounded-xl bg-green-700 hover:bg-green-600 text-white text-[21px] font-medium">Next Batter</button>
          <button onClick={onPrevBatter} className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[21px] font-medium">← Prev</button>
          <button onClick={onEndAtBat}   className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[21px] font-medium">End AB</button>
        </div>
        {lastCompletedAtBatSnapshot && (
          <button
            onClick={onUndoLastEnd}
            className="mt-2 w-full h-10 rounded-xl border border-amber-800 bg-amber-950 hover:bg-amber-900 text-amber-300 text-[21px] font-medium flex items-center justify-center gap-2"
          >
            <span className="text-[24px]">↩</span> Undo Last End
          </button>
        )}
      </div>

      {/* ── Pitcher ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-1 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider">Pitchers</p>
          {pitcherMode === 'idle' ? (
            <button onClick={openPitcherNew} className="text-blue-400 text-[18px] font-medium">
              + Change Pitcher
            </button>
          ) : (
            <button onClick={() => setPitcherMode('idle')} className="text-slate-500 text-[18px]">Cancel</button>
          )}
        </div>

        {/* Current Pitcher display */}
        {pitcherMode === 'idle' && (
          <div className="bg-slate-900 rounded-xl border border-slate-700 divide-y divide-slate-800">
            <div
              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-800/60 transition-colors rounded-xl"
              onClick={() => pitcher.name.trim() && setStatsPitcher(pitcher)}
              title={pitcher.name.trim() ? 'Tap to view pitcher stats' : undefined}
            >
              <span className="bg-blue-600 text-white text-[21px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0">
                #{pitcher.number || '—'}
              </span>
              <span className="flex-1 font-medium text-[21px]">{pitcher.name || <span className="text-slate-500 italic">No pitcher set</span>}</span>
              <span className="text-slate-500 text-[18px]">{getPitchCount(pitcher.name, pitcher.number)} pitches</span>
              <span className="text-slate-600 text-[15px]">📊</span>
              <button
                onClick={e => { e.stopPropagation(); openPitcherEdit(); }}
                className="text-slate-500 hover:text-blue-400 text-[17px] px-1.5 py-0.5 rounded hover:bg-slate-700 ml-1"
                title="Fix name/number typo"
              >✎</button>
            </div>
          </div>
        )}

        {/* New Pitcher / Edit form */}
        {(pitcherMode === 'new' || pitcherMode === 'edit') && (
          <div className="bg-slate-900 rounded-xl p-3 space-y-2 border border-slate-700">
            <p className="text-slate-400 text-[18px]">
              {pitcherMode === 'new' ? 'Enter incoming pitcher' : 'Edit current pitcher info'}
            </p>
            <div className="flex gap-2">
              <input
                value={pNum}
                onChange={e => setPNum(e.target.value)}
                placeholder="#"
                maxLength={3}
                className="w-16 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-center font-bold outline-none focus:border-blue-500 flex-shrink-0"
              />
              <input
                value={pName}
                onChange={e => setPName(e.target.value)}
                placeholder="Name"
                onKeyDown={e => { if (e.key === 'Enter') savePitcher(); }}
                className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            <button
              onClick={savePitcher}
              disabled={!pName.trim()}
              className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[21px] font-medium"
            >
              {pitcherMode === 'new' ? 'Set as Current Pitcher' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Previous Pitchers */}
        {pitcherHistory.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-slate-600 text-[15px] uppercase tracking-wide px-1">Previous</p>
            {pitcherHistory.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-2 bg-slate-900/60 rounded-lg border border-slate-800 cursor-pointer hover:bg-slate-800/60 transition-colors"
                onClick={() => setStatsPitcher(p)}
                title="Tap to view pitcher stats"
              >
                <span className="text-slate-400 text-[18px] font-bold">#{p.number}</span>
                <span className="flex-1 text-slate-400 text-[21px]">{p.name}</span>
                <span className="text-slate-600 text-[18px]">{getPitchCount(p.name, p.number)} pitches</span>
                <span className="text-slate-600 text-[15px]">📊</span>
                <button
                  onClick={e => { e.stopPropagation(); onChangePitcher(p); }}
                  className="text-blue-500 hover:text-blue-400 text-[18px] px-2 py-0.5 rounded border border-blue-900 hover:border-blue-700"
                >
                  Recall
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Batting Order ────────────────────────────────────────────────── */}
      <div className="px-4 pt-1 pb-4">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider">Batting Order</p>
          <span className="text-slate-600 text-[18px]">{lineup.filter(p => p?.name?.trim()).length} batters</span>
        </div>

        <div className="space-y-1.5">
          {Array.from({ length: visibleSlots }).map((_, idx) => {
            const player = lineup[idx] ?? null;
            const hasPlayer = !!player?.name?.trim();
            const isActive = hasPlayer && idx === currentBatterIndex;
            const isExpanded = expanded?.idx === idx;
            const isDetails      = isExpanded && expanded?.view === 'details';
            const isEdit         = isExpanded && expanded?.view === 'edit';
            const isEditExisting = isExpanded && expanded?.view === 'edit-existing';
            // Use playerId-aware history lookup
            const lastAB = hasPlayer ? getLastCompletedAB(idx, player!.id) : undefined;

            return (
              <div key={idx} className={`rounded-xl overflow-hidden border ${isActive ? 'border-blue-600' : isEditExisting ? 'border-blue-800' : 'border-slate-700'}`}>

                {/* ── Slot row ── */}
                <div
                  onClick={() => handleSlotRowClick(idx)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors select-none
                    ${isActive ? 'bg-slate-800' : hasPlayer ? 'bg-slate-900 hover:bg-slate-800/70' : 'bg-slate-900/50 hover:bg-slate-800/50'}
                    ${(isExpanded || isEditExisting) ? 'border-b border-slate-700' : ''}`}
                >
                  <span className="text-slate-500 text-[18px] font-mono w-5 text-right flex-shrink-0">{idx + 1}.</span>

                  {hasPlayer ? (
                    <>
                      <span className={`text-[18px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                        #{player!.number}
                      </span>
                      <span className={`flex-1 text-[21px] truncate ${isActive ? 'text-slate-100 font-semibold' : 'text-slate-300'}`}>
                        {player!.name}
                      </span>

                      {isActive && <span className="text-blue-400 text-[15px] font-bold flex-shrink-0">AT BAT</span>}

                      {!isActive && lastAB && (
                        <span className={`text-[15px] font-semibold flex-shrink-0 ${getResultColor(lastAB)}`}>
                          {getResultBadge(lastAB)}
                        </span>
                      )}

                      {/* Edit button — corrects name/number, keeps player ID + history */}
                      <button
                        onClick={e => handleEditExistingClick(e, idx, player!)}
                        className={`text-[15px] px-1.5 py-0.5 rounded border transition-colors flex-shrink-0
                          ${isEditExisting
                            ? 'text-blue-400 bg-blue-950 border-blue-800'
                            : 'text-slate-500 hover:text-blue-400 hover:bg-blue-950 border-slate-700 hover:border-blue-800'}`}
                        title="Edit player name / number"
                      >✎</button>

                      {/* Sub button — opens fresh form for a new player */}
                      <button
                        onClick={e => handleSubClick(e, idx)}
                        className={`text-[15px] px-1.5 py-0.5 rounded border transition-colors flex-shrink-0
                          ${isEdit
                            ? 'text-amber-400 bg-amber-950 border-amber-800'
                            : 'text-slate-500 hover:text-amber-400 hover:bg-amber-950 border-slate-700 hover:border-amber-800'}`}
                        title="Substitute batter"
                      >SUB</button>

                      <span className="text-slate-600 text-[15px] flex-shrink-0">{isDetails ? '▲' : '▼'}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-slate-600 text-[18px] italic">Slot {idx + 1} — tap to add batter</span>
                      <span className="text-slate-600 text-[18px]">{isEdit ? '▲' : '＋'}</span>
                    </>
                  )}
                </div>

                {/* ── At-bat details panel ── */}
                {isDetails && hasPlayer && player && (() => {
                  const allBatterABs = getAllCompletedABs(idx, player.id);
                  return (
                    <div className="bg-slate-950 px-3 py-2.5 space-y-3">
                      {allBatterABs.length > 0 ? allBatterABs.map(ab => (
                        <div key={ab.id} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="text-slate-500 text-[18px]">At-Bat #{ab.atBatNumber} · {ab.pitches.length} pitch{ab.pitches.length !== 1 ? 'es' : ''}</p>
                            <span className={`text-[18px] font-bold ${getResultColor(ab)}`}>{getResultBadge(ab)}</span>
                          </div>
                          <div className="space-y-1.5">
                            {ab.pitches.map((pitch, i) => (
                              <PitchRow
                                key={pitch.id}
                                pitch={pitch}
                                index={i}
                                playerHand={player.hand}
                              />
                            ))}
                          </div>
                        </div>
                      )) : (
                        <p className="text-slate-600 text-[18px] text-center py-2">No completed at-bats yet</p>
                      )}
                      {/* Spray chart — shows all hits across every at-bat for this batter */}
                      <BatterSprayChart allABs={allBatterABs} />
                    </div>
                  );
                })()}

                {/* ── Sub / Add form ── */}
                {isEdit && (
                  <div className="bg-slate-950 px-3 py-2.5">
                    {hasPlayer ? (
                      <p className="text-amber-400/80 text-[18px] mb-2 font-medium">
                        Sub in new batter at slot {idx + 1}
                        <span className="text-slate-500 font-normal"> (replaces {player!.name})</span>
                      </p>
                    ) : (
                      <p className="text-slate-400 text-[18px] mb-2">Add batter to slot {idx + 1}</p>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={slotForm.num}
                        onChange={e => setSlotForm(s => ({ ...s, num: e.target.value }))}
                        placeholder="#"
                        maxLength={3}
                        className="w-14 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-center font-bold outline-none focus:border-blue-500 flex-shrink-0"
                      />
                      <input
                        value={slotForm.name}
                        onChange={e => setSlotForm(s => ({ ...s, name: e.target.value }))}
                        placeholder="Player name"
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(idx); }}
                        className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSave(idx)}
                        disabled={!slotForm.name.trim() || !slotForm.num.trim()}
                        className="px-3 h-10 rounded-lg bg-green-700 hover:bg-green-600 text-white font-bold text-[27px] disabled:opacity-40 flex-shrink-0"
                      >✓</button>
                    </div>
                    {/* Clear slot: only for filled slots that are not currently active */}
                    {hasPlayer && idx !== currentBatterIndex && (
                      <button
                        onClick={() => { onRemoveBatter(idx); setExpanded(null); }}
                        className="mt-2 w-full h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-red-400 text-[18px] font-medium border border-slate-800 hover:border-red-900"
                      >
                        Clear Slot {idx + 1} (remove {player!.name} from order)
                      </button>
                    )}
                  </div>
                )}

                {/* ── Edit existing player form ── */}
                {isEditExisting && hasPlayer && player && (
                  <div className="bg-slate-950 px-3 py-2.5">
                    <p className="text-blue-400/90 text-[18px] mb-2 font-medium">
                      Edit slot {idx + 1}
                      <span className="text-slate-500 font-normal"> — corrects name / number only, history is kept</span>
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={slotForm.num}
                        onChange={e => setSlotForm(s => ({ ...s, num: e.target.value }))}
                        placeholder="#"
                        maxLength={3}
                        className="w-14 h-10 rounded-lg bg-slate-800 border border-blue-700 text-slate-100 text-center font-bold outline-none focus:border-blue-400 flex-shrink-0"
                      />
                      <input
                        value={slotForm.name}
                        onChange={e => setSlotForm(s => ({ ...s, name: e.target.value }))}
                        placeholder="Player name"
                        onKeyDown={e => { if (e.key === 'Enter') handleEditExistingSave(idx, player); }}
                        className="flex-1 h-10 rounded-lg bg-slate-800 border border-blue-700 text-slate-100 px-3 outline-none focus:border-blue-400"
                        autoFocus
                      />
                      <button
                        onClick={() => handleEditExistingSave(idx, player)}
                        disabled={!slotForm.name.trim() || !slotForm.num.trim()}
                        className="px-3 h-10 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-bold text-[27px] disabled:opacity-40 flex-shrink-0"
                      >✓</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {visibleSlots < MAX_SLOTS && (
          <button
            onClick={() => setExtraSlots(e => Math.min(e + 1, MAX_SLOTS - 9))}
            className="mt-2 w-full h-10 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-400 text-[21px] transition-colors"
          >
            + Add Batter {visibleSlots + 1}
          </button>
        )}
      </div>

      {/* ── Google Sheets URL ── */}
      <SheetsUrlPanel
        webhookUrl={state.sheetsWebhookUrl}
        syncQueue={state.syncQueue.length}
        onSave={onSetWebhookUrl}
      />

    </div>

      {/* ── Pitcher Stats Modal ──────────────────────────────────────────── */}
      {statsPitcher && (
        <PitcherStatsModal
          pitcher={statsPitcher}
          allAtBats={allAtBats}
          currentAtBat={currentAtBat}
          onClose={() => setStatsPitcher(null)}
        />
      )}
    </>
  );
}
