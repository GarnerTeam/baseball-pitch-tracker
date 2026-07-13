'use client';
import { useState, useRef, ReactNode } from 'react';
import { useUser } from '@clerk/nextjs';
import { GameState, Player, AtBat, PitchRecord, PitchType, PitchOutcome, PITCH_TYPE_COLORS } from '@/types';
import { PitchRow } from '@/components/pitch-row';
import { PitcherStatsModal } from '@/components/pitcher-stats-modal';
import { BatterHistoryModal } from '@/components/batter-history-modal';
import { BatterFigureIcon } from '@/components/strike-zone';
import { toPitchRowLite, PitchRowLite } from '@/lib/sheets';
import { fetchRoster, saveRoster, isRosterId, newRosterId } from '@/lib/roster';
import { RosterPlayer } from '@/types';

interface SyncStatus {
  ok: boolean;
  message: string;
  ts: number;
}

interface LineupPanelProps {
  state: GameState;
  readOnly?: boolean;
  /** Optional content rendered between the Pitcher card and Batting Order —
   *  used by the Past Games view to place pitcher-swipe navigation there. */
  pitcherSwipeSlot?: ReactNode;
  /** Explicit data owner — only needed when rendered in an unauthenticated
   *  context (Scout page). Threaded down to BatterHistoryModal. */
  ownerId?: string;
  onNextBatter: () => void;
  onPrevBatter: () => void;
  onEndAtBat: () => void;
  onChangePitcher: (p: Player) => void;
  onAddBatter: (p: Player) => void;
  onRemoveBatter: (idx: number) => void;
  onSetBatterAt: (idx: number, player: Player) => void;
  onReorderBatter: (fromIdx: number, toIdx: number) => void;
  /** Bulk-replaces the batting order with a Saved Roster. Omitted in
   *  read-only contexts (Scout / Past Games) where rosters don't apply. */
  onLoadRoster?: (players: Player[]) => void;
  onEditPitch: (atBatId: string, pitchId: string, updates: Partial<PitchRecord>) => void;
  onUndoLastEnd: () => void;
  onSetWebhookUrl: (url: string) => void;
  syncStatus?: SyncStatus | null;
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
};
const OUTCOME_COLORS: Record<string, string> = {
  'ball': 'text-blue-400',
  'called-strike': 'text-red-400',
  'swinging-strike': 'text-red-400',
  'foul': 'text-amber-400',
  'foul-tip': 'text-amber-400',
  'in-play': 'text-yellow-400',
  'walk': 'text-sky-400',
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
  const m: Record<string, string> = { 'walk': '🔵 BB', 'manual-end': '—' };
  return m[ab.result ?? ''] ?? '—';
}
function getResultColor(ab: AtBat): string {
  if (ab.result === 'strikeout') return 'text-red-400';
  if (ab.result === 'walk') return 'text-sky-400';
  if (ab.result === 'in-play') {
    const r = ab.pitches.find(p => p.hitData)?.hitData?.result;
    if (r === 'out' || r === 'error') return 'text-red-400';
    return 'text-yellow-400';
  }
  return 'text-slate-400';
}

// ── Pitch edit form ─────────────────────────────────────────────────────────────────────
const EDIT_PITCH_TYPES: PitchType[] = ['FB', 'CB', 'SL', 'CH'];
const EDIT_OUTCOMES: { value: PitchOutcome; label: string; swing: boolean }[] = [
  { value: 'ball',            label: 'Ball',      swing: false },
  { value: 'called-strike',   label: 'Called ☒',  swing: false },
  { value: 'swinging-strike', label: 'Swing ☒',   swing: true  },
  { value: 'foul',            label: 'Foul',      swing: true  },
  { value: 'foul-tip',        label: 'Tip',       swing: true  },
  { value: 'walk',            label: 'Walk',      swing: false },
];
interface PitchEditFormState {
  pitchType: PitchType;
  outcome: PitchOutcome;
  swing: boolean;
}
function PitchEditInlineForm({
  form, onChange, onSave, onCancel,
}: {
  form: PitchEditFormState;
  onChange: (f: PitchEditFormState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-slate-800 rounded-lg p-2 mt-1 space-y-1.5 border border-blue-800/70">
      {/* Pitch type row */}
      <div className="flex gap-1">
        {EDIT_PITCH_TYPES.map(pt => (
          <button
            key={pt}
            onClick={() => onChange({ ...form, pitchType: pt })}
            className={`flex-1 h-8 rounded text-[15px] font-bold border ${
              form.pitchType === pt
                ? 'border-transparent text-white'
                : 'bg-slate-700 border-slate-600 text-slate-400'
            }`}
            style={form.pitchType === pt ? { background: PITCH_TYPE_COLORS[pt], color: '#fff' } : { color: PITCH_TYPE_COLORS[pt] }}
          >
            {pt}
          </button>
        ))}
      </div>
      {/* Outcome row */}
      <div className="flex flex-wrap gap-1">
        {EDIT_OUTCOMES.map(o => (
          <button
            key={o.value}
            onClick={() => onChange({ ...form, outcome: o.value, swing: o.swing })}
            className={`px-2 h-8 rounded text-[14px] font-medium ${
              form.outcome === o.value
                ? 'bg-blue-700 text-white'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* Save / Cancel */}
      <div className="flex gap-2">
        <button
          onClick={onSave}
          className="flex-1 h-8 rounded bg-green-700 hover:bg-green-600 text-white text-[15px] font-bold"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-4 h-8 rounded bg-slate-700 text-slate-400 text-[15px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Field geometry constants (matches analytics-screen) ───────────────────────────────────
const SW=400, SH=390, SHX=200, SHY=365;
const SR_FENCE=270, SR_WARN=220;
const SLFPX=9, SLFPY=174, SRFPX=391, SRFPY=174;
const SB1X=271, SB1Y=294, SB2X=200, SB2Y=224, SB3X=129, SB3Y=294;
const SMX=200, SMY=298;
const SWARN_LX=44, SWARN_LY=209, SWARN_RX=356, SWARN_RY=209;

function sprayHitColor(result: string) {
  if (result === 'out')       return '#64748b';
  if (result === 'home-run')  return '#eab308';
  if (result === 'error')     return '#f59e0b';
  return '#14b8a6';
}

function BatterSprayChart({ allABs }: { allABs: AtBat[] }) {
  const allPitches = allABs.flatMap(ab => ab.pitches);
  const hits = allPitches
    .filter((p): p is PitchRecord & { hitData: NonNullable<PitchRecord["hitData"]> } => !!p.hitData);

  // Predominant batter hand — derived from what was actually entered on the
  // Pitch page for this batter's at-bats (PitchRecord.batterHand), not the
  // roster-level Player.hand field, so the icon reflects real recorded data.
  const handCounts = { R: 0, L: 0 };
  for (const p of allPitches) {
    if (p.batterHand === 'R') handCounts.R++;
    else if (p.batterHand === 'L') handCounts.L++;
  }
  const sprayHand: 'R' | 'L' | null =
    handCounts.R === 0 && handCounts.L === 0 ? null : (handCounts.L > handCounts.R ? 'L' : 'R');

  // Batter stands to the pitcher's left in the box when right-handed, and to
  // the pitcher's right when left-handed (same convention used elsewhere in
  // the app, e.g. the History page bat icon placement).
  const iconW = 22, iconH = 40;
  const iconX = sprayHand === 'R' ? SHX - 34 : SHX + 12;
  const iconY = SHY - 34;
  const iconColor = sprayHand === 'R' ? '#93c5fd' : '#fcd34d';

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
        {/* Batter icon — same figure used on the Pitch page, placed beside home plate
            on the side the batter actually stood (per recorded batterHand) */}
        {sprayHand && (
          <BatterFigureIcon hand={sprayHand} x={iconX} y={iconY} width={iconW} height={iconH} color={iconColor} />
        )}
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
          { color: '#14b8a6', label: 'Hit' },
          { color: '#64748b', label: 'Out' },
          { color: '#eab308', label: 'HR' },
          { color: '#f59e0b', label: 'Error' },
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

// ── Scout Share Modal ─────────────────────────────────────────────────────────────
function ScoutShareModal({ webhookUrl, onClose }: { webhookUrl: string; onClose: () => void }) {
  // The Scout link now carries the owner's Clerk user id — required so the
  // (unauthenticated) Scout page can be scoped to just this coach's data,
  // now that the sheet holds multiple coaches' rows.
  const { user } = useUser();
  const ownerId  = user?.id ?? '';
  const scoutUrl = `https://scout.robertegarner.com?url=${encodeURIComponent(webhookUrl)}&owner=${encodeURIComponent(ownerId)}`;
  const qrSrc    = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(scoutUrl)}&bgcolor=0f172a&color=e2e8f0&margin=12`;
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(scoutUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm flex flex-col items-center gap-5"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="w-full flex items-center justify-between">
          <p className="text-white font-bold text-[20px]">📡 Scout View</p>
          <button onClick={onClose} className="text-slate-500 text-[26px] leading-none">×</button>
        </div>

        <p className="text-slate-400 text-[15px] text-center -mt-2">
          Share this with coaches or parents. They scan once and see live game data — no setup needed.
        </p>

        {/* QR Code */}
        <div className="rounded-xl overflow-hidden border border-slate-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="Scout View QR Code" width={220} height={220} />
        </div>

        {/* Copy link button */}
        <button
          onClick={copyLink}
          className={`w-full py-3 rounded-xl text-[17px] font-bold transition-colors ${
            copied
              ? 'bg-emerald-700 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
          }`}
        >
          {copied ? '✓ Link Copied!' : '🔗 Copy Link'}
        </button>

        <p className="text-slate-600 text-[12px] text-center -mt-2">
          Scout view refreshes every 30 seconds automatically
        </p>
      </div>
    </div>
  );
}

// ── Sheets URL Panel ───────────────────────────────────────────────────────────────────
function SheetsUrlPanel({ webhookUrl, syncQueue, onSave, syncStatus }: {
  webhookUrl: string;
  syncQueue: number;
  onSave: (url: string) => void;
  syncStatus?: SyncStatus | null;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(webhookUrl);
  const [showShare, setShowShare] = useState(false);
  const isConnected = !!webhookUrl?.trim();

  function save() {
    onSave(val.trim());
    setEditing(false);
  }

  const displayUrl = webhookUrl
    ? webhookUrl.replace('https://script.google.com/macros/s/', '…/s/').slice(0, 38) + '…'
    : '';

  return (
    <div className="mx-3 mb-6 mt-4">
      <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">Google Sheets Sync</p>

      <div className={`rounded-xl border-2 ${isConnected && !editing ? 'border-emerald-600 bg-emerald-950/40' : 'border-amber-600 bg-amber-950/30'}`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-[28px] leading-none flex-shrink-0">
            {isConnected && !editing ? '✅' : '⚠️'}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[18px] font-bold ${isConnected && !editing ? 'text-emerald-300' : 'text-amber-300'}`}>
              {isConnected && !editing ? 'Sheets Connected' : 'Sheets Not Connected'}
            </p>
            {isConnected && !editing && (
              <p className="text-slate-500 text-[13px] truncate mt-0.5">{displayUrl}</p>
            )}
            {syncQueue > 0 && (
              <p className="text-amber-400 text-[14px] font-medium mt-0.5">
                ⏳ {syncQueue} pitch{syncQueue !== 1 ? 'es' : ''} pending sync
              </p>
            )}
            {isConnected && !editing && syncQueue === 0 && !syncStatus && (
              <p className="text-emerald-600 text-[13px] mt-0.5">All pitches synced</p>
            )}
            {isConnected && !editing && syncStatus?.ok && (
              <p className="text-emerald-400 text-[13px] mt-0.5">✓ {syncStatus.message}</p>
            )}
            {isConnected && !editing && syncStatus && !syncStatus.ok && (
              <p className="text-red-400 text-[14px] mt-0.5 font-semibold">⚠ Sync failed</p>
            )}
          </div>
          {isConnected && !editing && (
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setShowShare(true)}
                className="px-3 h-9 rounded-lg border text-[15px] font-medium bg-indigo-900 border-indigo-700 text-indigo-200 hover:bg-indigo-800"
                title="Share Scout View"
              >
                📡 Share
              </button>
              <button
                onClick={() => { setVal(webhookUrl); setEditing(true); }}
                className={`px-3 h-9 rounded-lg border text-[15px] font-medium ${syncStatus && !syncStatus.ok ? 'bg-red-950 border-red-700 text-red-300 hover:bg-red-900' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}
              >
                {syncStatus && !syncStatus.ok ? 'Fix URL' : 'Change'}
              </button>
            </div>
          )}
          {showShare && <ScoutShareModal webhookUrl={webhookUrl} onClose={() => setShowShare(false)} />}
        </div>

        {isConnected && !editing && syncStatus && !syncStatus.ok && (
          <div className="px-4 pb-3 border-t border-red-900/40 pt-3 space-y-2">
            <p className="text-red-300 text-[14px] font-semibold">Error from server:</p>
            <p className="text-red-400/90 text-[13px] font-mono break-all leading-snug bg-red-950/50 rounded-lg px-3 py-2">
              {syncStatus.message}
            </p>
            <p className="text-slate-400 text-[14px]">Most likely causes:</p>
            <ul className="text-slate-400 text-[13px] space-y-1 list-none pl-1">
              <li>• Script not deployed as a Web App yet</li>
              <li>• Access set to <strong className="text-slate-300">"Only myself"</strong> — must be <strong className="text-slate-300">"Anyone"</strong></li>
              <li>• Pasted the editor URL instead of the /exec deployment URL</li>
            </ul>
            <button
              onClick={() => { setVal(webhookUrl); setEditing(true); }}
              className="w-full h-11 rounded-xl bg-red-700 hover:bg-red-600 text-white text-[18px] font-bold mt-1"
            >
              Update URL
            </button>
          </div>
        )}

        {(!isConnected || editing) && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-700/60 pt-3">
            <p className="text-slate-400 text-[15px]">
              Paste your Google Apps Script web app URL:
            </p>
            <p className="text-slate-500 text-[13px] -mt-1">
              In the script editor: Deploy → Manage deployments → copy the /exec URL
            </p>
            <input
              value={val}
              onChange={e => setVal(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              className="w-full h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-3 text-[14px] outline-none focus:border-emerald-500 placeholder:text-slate-600"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={!val.trim()}
                className="flex-1 h-11 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[18px] font-bold"
              >
                Connect Sheets
              </button>
              {editing && (
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 h-11 rounded-xl bg-slate-700 text-slate-300 text-[16px]"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LineupPanel({
  state, readOnly = false, pitcherSwipeSlot, ownerId,
  onNextBatter, onPrevBatter, onEndAtBat,
  onChangePitcher, onAddBatter, onRemoveBatter, onSetBatterAt,
  onReorderBatter, onEditPitch,
  onUndoLastEnd, onSetWebhookUrl, syncStatus,
  onLoadRoster,
}: LineupPanelProps) {
  const {
    pitcher, lineup, currentBatterIndex, allAtBats,
    lastCompletedAtBatSnapshot, currentAtBat,
  } = state;
  const pitcherHistory = state.pitcherHistory ?? [];

  // ── Pitcher state ────────────────────────────────────────────────────────
  const [pitcherMode, setPitcherMode] = useState<'idle' | 'new' | 'edit'>(
    () => pitcher.name.trim() ? 'idle' : 'new'
  );
  const [pName, setPName] = useState('');
  const [pNum, setPNum]   = useState('');
  const [pHand, setPHand] = useState<'R' | 'L' | null>(null);

  // ── Pitcher stats popup state ────────────────────────────────────────────────────
  const [statsPitcher, setStatsPitcher] = useState<Player | null>(null);

  // ── Slot state ─────────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<{ idx: number; view: 'details' | 'edit' | 'edit-existing' } | null>(null);
  const [historyPlayer, setHistoryPlayer] = useState<{
    name: string;
    number: string;
    currentGameId: string;
    currentGamePitches: PitchRowLite[];
    rosterId?: string;
  } | null>(null);
  const [slotForm, setSlotForm] = useState({ name: '', num: '' });
  const [extraSlots, setExtraSlots] = useState(0);

  // ── Saved Roster state ────────────────────────────────────────────────────
  const [rosterMenuOpen, setRosterMenuOpen] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const opposingTeam = (state.visitingTeam ?? '').trim();

  async function handleLoadRoster() {
    if (!onLoadRoster || !state.sheetsWebhookUrl || !opposingTeam) return;
    setRosterBusy(true);
    setRosterError(null);
    try {
      const players = await fetchRoster(state.sheetsWebhookUrl, opposingTeam, ownerId);
      if (players.length === 0) {
        setRosterError(`No saved roster found for "${opposingTeam}" yet.`);
        return;
      }
      onLoadRoster(players.map((p: RosterPlayer) => ({ id: p.id, name: p.name, number: p.number, hand: p.hand })));
      setRosterMenuOpen(false);
    } catch (e) {
      setRosterError(String(e instanceof Error ? e.message : e));
    } finally {
      setRosterBusy(false);
    }
  }

  async function handleSaveRoster() {
    if (!state.sheetsWebhookUrl || !opposingTeam) return;
    setRosterBusy(true);
    setRosterError(null);
    try {
      const named = lineup
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => p && p.name.trim());

      if (named.length === 0) {
        setRosterError('Add at least one named batter before saving a roster.');
        return;
      }

      // Assign each batter a permanent roster id if they don't already have
      // one (re-saving an existing roster keeps everyone's identity stable).
      const rosterPlayers: RosterPlayer[] = [];
      const idUpdates: { idx: number; player: Player }[] = [];
      for (const { p, idx } of named) {
        const stableId = isRosterId(p!.id) ? p!.id : newRosterId();
        if (stableId !== p!.id) idUpdates.push({ idx, player: { ...p!, id: stableId } });
        rosterPlayers.push({ id: stableId, name: p!.name.trim(), number: p!.number.trim(), hand: p!.hand ?? null });
      }

      await saveRoster(state.sheetsWebhookUrl, opposingTeam, rosterPlayers);
      // Re-tag this game's lineup with the now-stable ids so any further
      // pitches recorded to these batters carry the same roster identity.
      idUpdates.forEach(u => onSetBatterAt(u.idx, u.player));
      setRosterMenuOpen(false);
    } catch (e) {
      setRosterError(String(e instanceof Error ? e.message : e));
    } finally {
      setRosterBusy(false);
    }
  }

  // ── Drag-to-reorder state ───────────────────────────────────────────────────
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── Pitch edit state ───────────────────────────────────────────────────────
  const [editingPitch, setEditingPitch] = useState<{ atBatId: string; pitchId: string } | null>(null);
  const [pitchEditForm, setPitchEditForm] = useState<PitchEditFormState>({
    pitchType: 'FB', outcome: 'ball', swing: false,
  });

  const MAX_SLOTS = 16;
  const visibleSlots = Math.max(9, lineup.length, Math.min(9 + extraSlots, MAX_SLOTS));

  // ── Pitcher helpers ──────────────────────────────────────────────────────
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
    setPHand(null);
    setPitcherMode('new');
  }
  function openPitcherEdit() {
    setPName(pitcher.name);
    setPNum(pitcher.number);
    setPHand((pitcher.hand as 'R' | 'L' | null) ?? null);
    setPitcherMode('edit');
  }
  function savePitcher() {
    if (!pName.trim()) return;
    const id = pitcherMode === 'edit' ? pitcher.id : crypto.randomUUID();
    onChangePitcher({ id, name: pName.trim(), number: pNum.trim(), hand: pHand ?? undefined });
    setPitcherMode('idle');
  }

  // ── Batter helpers ──────────────────────────────────────────────────────
function getAllCompletedABs(batterIdx: number, playerId?: string): AtBat[] {
    const subHasOccurred = playerId
      ? allAtBats.some(ab => ab.playerId && ab.playerId !== playerId && ab.batterIndex === batterIdx)
      : false;

    return allAtBats
      .filter(ab => {
        const isComplete = ab.isComplete && ab.pitches.length > 0;
        if (!isComplete) return false;
        if (playerId) {
          if (ab.playerId === playerId) return true;
          if (!ab.playerId && ab.batterIndex === batterIdx && !subHasOccurred) return true;
          return false;
        }
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
    setEditingPitch(null);
  }

  function handleSlotRowClick(idx: number) {
    const player = lineup[idx];
    if (!player) {
      openSlot(idx, 'edit');
    } else {
      openSlot(idx, 'details');
    }
  }

  function handleSubClick(e: React.MouseEvent, idx: number) {
    e.stopPropagation();
    if (expanded?.idx === idx && expanded.view === 'edit') {
      setExpanded(null);
    } else {
      setExpanded({ idx, view: 'edit' });
      setSlotForm({ name: '', num: '' });
    }
    setEditingPitch(null);
  }

  function handleSave(idx: number) {
    // Name and number are optional — save whatever the user has entered
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
    setEditingPitch(null);
  }

  function handleEditExistingSave(idx: number, currentPlayer: Player) {
    // Name and number are optional
    const player: Player = { ...currentPlayer, name: slotForm.name.trim(), number: slotForm.num.trim() };
    onSetBatterAt(idx, player);
    setExpanded(null);
    setSlotForm({ name: '', num: '' });
  }

  // ── Drag helpers ───────────────────────────────────────────────────────
  function handleDragHandleTouchStart(e: React.TouchEvent, idx: number) {
    e.stopPropagation();
    dragRef.current = idx;
    setDragFrom(idx);
    setDragOver(idx);
  }

  function handleDragHandleTouchMove(e: React.TouchEvent) {
    if (dragRef.current === null) return;
    // Prevent scroll while dragging
    e.preventDefault();
    const touch = e.touches[0];
    // Find which slot the finger is over by checking bounding rects
    for (let i = 0; i < slotRefs.current.length; i++) {
      const el = slotRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        if (i !== dragOver) setDragOver(i);
        break;
      }
    }
  }

  function handleDragHandleTouchEnd() {
    if (dragRef.current !== null && dragOver !== null && dragOver !== dragRef.current) {
      onReorderBatter(dragRef.current, dragOver);
    }
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <>
    <div className="flex flex-col h-full overflow-y-scroll bg-slate-950 text-slate-100" style={{ WebkitOverflowScrolling: "touch" }}>

      {/* ── At-Bat Controls ────────────────────────────────── */}
      {!readOnly && (
      <div className="px-4 pt-4 pb-2">
        <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider mb-2">At-Bat Controls</p>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={onPrevBatter} className="py-[7px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[15px] font-medium">‹ Prev Batter</button>
          <button onClick={onNextBatter} className="py-[7px] rounded-xl bg-green-700 hover:bg-green-600 text-white text-[15px] font-medium">Next Batter ›</button>
          <button onClick={onEndAtBat}   className="py-[7px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[15px] font-medium">End AB</button>
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
      )}

      {/* ── Pitcher ────────────────────────────────────────────── */}
      <div className="px-4 pt-1 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider">Pitchers</p>
          {!readOnly && (pitcherMode === 'idle' ? (
            <button onClick={openPitcherNew} className="text-blue-400 text-[18px] font-medium">
              + Change Pitcher
            </button>
          ) : (
            <button onClick={() => setPitcherMode('idle')} className="text-slate-500 text-[18px]">Cancel</button>
          ))}
        </div>

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
              {pitcher.hand && (
                <span className={`text-[15px] font-bold px-1.5 py-0.5 rounded ${
                  pitcher.hand === 'R' ? 'bg-blue-900 text-blue-300' : 'bg-amber-900 text-amber-300'
                }`}>
                  {pitcher.hand === 'R' ? 'RHP' : 'LHP'}
                </span>
              )}
              <span className="text-slate-600 text-[15px]">📊</span>
              {!readOnly && <button
                onClick={e => { e.stopPropagation(); openPitcherEdit(); }}
                className="text-slate-500 hover:text-blue-400 text-[17px] px-1.5 py-0.5 rounded hover:bg-slate-700 ml-1"
                title="Fix name/number typo"
              >✎</button>}
            </div>
          </div>
        )}

        {!readOnly && (pitcherMode === 'new' || pitcherMode === 'edit') && (
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
            {/* Pitcher handedness toggle */}
            <div className="flex gap-2">
              {(['R', 'L'] as const).map(h => (
                <button
                  key={h}
                  onClick={() => setPHand(prev => prev === h ? null : h)}
                  className={`flex-1 h-9 rounded-lg text-[18px] font-bold transition-colors ${
                    pHand === h
                      ? (h === 'R' ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white')
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {h === 'R' ? 'RHP' : 'LHP'}
                </button>
              ))}
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
                {!readOnly && <button
                  onClick={e => { e.stopPropagation(); onChangePitcher(p); }}
                  className="text-blue-500 hover:text-blue-400 text-[18px] px-2 py-0.5 rounded border border-blue-900 hover:border-blue-700"
                >
                  Recall
                </button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {pitcherSwipeSlot}

      {/* ── Batting Order ────────────────────────────────── */}
      <div className="px-4 pt-1 pb-4">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-[18px] font-medium uppercase tracking-wider">Batting Order</p>
          <span className="text-slate-600 text-[18px]">{lineup.filter(p => !!p).length} batters</span>
        </div>

        {/* ── Saved Roster: reuse a lineup across every game vs. the same team ── */}
        {!readOnly && onLoadRoster && state.sheetsWebhookUrl && opposingTeam && (
          <div className="mb-2">
            <button
              onClick={() => setRosterMenuOpen(v => !v)}
              className="w-full h-9 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[15px] font-medium flex items-center justify-center gap-2"
            >
              <span className="text-[16px]">📋</span> Saved Roster — {opposingTeam}
            </button>
            {rosterMenuOpen && (
              <div className="mt-1.5 p-2.5 rounded-xl bg-slate-900 border border-slate-700 space-y-2">
                <p className="text-slate-500 text-[13px]">
                  Load this team's known batters, or save the current lineup so it's ready next time you face them.
                </p>
                {rosterError && <p className="text-red-400 text-[13px]">{rosterError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleLoadRoster}
                    disabled={rosterBusy}
                    className="flex-1 h-9 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-[14px] font-semibold"
                  >
                    {rosterBusy ? 'Working…' : 'Load Roster'}
                  </button>
                  <button
                    onClick={handleSaveRoster}
                    disabled={rosterBusy}
                    className="flex-1 h-9 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[14px] font-semibold"
                  >
                    {rosterBusy ? 'Working…' : 'Save Current as Roster'}
                  </button>
                </div>
                <p className="text-slate-600 text-[12px]">
                  Tip: if two players share a last name (e.g. brothers), enter each one's full first name — once saved, the app tracks them by a permanent ID, not by name, so it will never mix them up again even if a number changes.
                </p>
              </div>
            )}
          </div>
        )}
        {!readOnly && dragFrom !== null && (
          <p className="text-blue-400 text-[15px] text-center mb-1.5 animate-pulse">
            Drag to reorder — slot {(dragFrom ?? 0) + 1} → slot {(dragOver ?? dragFrom ?? 0) + 1}
          </p>
        )}

        <div className="space-y-1.5">
          {Array.from({ length: visibleSlots }).map((_, idx) => {
            const player = lineup[idx] ?? null;
            // A slot is "occupied" whenever a Player object exists there (even with no name)
            const hasPlayer = !!player;
            const isActive = hasPlayer && idx === currentBatterIndex;
            const isExpanded = expanded?.idx === idx;
            const isDetails      = isExpanded && expanded?.view === 'details';
            const isEdit         = isExpanded && expanded?.view === 'edit';
            const isEditExisting = isExpanded && expanded?.view === 'edit-existing';
            const lastAB = hasPlayer ? getLastCompletedAB(idx, player!.id) : undefined;

            // Drag visual state
            const isDragSource = dragFrom === idx;
            const isDragTarget = dragOver === idx && dragFrom !== null && dragFrom !== idx;

            return (
              <div
                key={idx}
                ref={el => { slotRefs.current[idx] = el; }}
                className={`rounded-xl overflow-hidden border transition-all duration-150 ${
                  isDragSource ? 'opacity-40 scale-95' :
                  isDragTarget ? 'ring-2 ring-blue-400 scale-[1.02]' : ''
                } ${isActive ? 'border-blue-600' : isEditExisting ? 'border-blue-800' : 'border-slate-700'}`}
              >

                {/* ── Slot row ── */}
                <div
                  onClick={() => handleSlotRowClick(idx)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors select-none
                    ${isActive ? 'bg-slate-800' : hasPlayer ? 'bg-slate-900 hover:bg-slate-800/70' : 'bg-slate-900/50 hover:bg-slate-800/50'}
                    ${(isExpanded || isEditExisting) ? 'border-b border-slate-700' : ''}`}
                >
                  {/* ── Drag handle (filled slots only, not in readOnly) ── */}
                  {!readOnly && hasPlayer && (
                    <span
                      className="text-slate-600 text-[20px] leading-none cursor-grab active:cursor-grabbing select-none flex-shrink-0 touch-none px-0.5"
                      title="Drag to reorder"
                      onTouchStart={e => handleDragHandleTouchStart(e, idx)}
                      onTouchMove={handleDragHandleTouchMove}
                      onTouchEnd={handleDragHandleTouchEnd}
                      onClick={e => e.stopPropagation()}
                    >
                      ⠿
                    </span>
                  )}
                  {!readOnly && !hasPlayer && (
                    <span className="w-5 flex-shrink-0" />
                  )}

                  <span className="text-slate-500 text-[18px] font-mono w-5 text-right flex-shrink-0">{idx + 1}.</span>

                  {hasPlayer ? (
                    <>
                      <span className={`text-[18px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                        #{player!.number || '—'}
                      </span>
                      <span className={`flex-1 text-[21px] truncate ${isActive ? 'text-slate-100 font-semibold' : 'text-slate-300'}`}>
                        {player!.name || <span className="italic text-slate-500">No Name</span>}
                      </span>

                      {isActive && <span className="text-blue-400 text-[15px] font-bold flex-shrink-0">AT BAT</span>}

                      {!isActive && lastAB && (
                        <span className={`text-[15px] font-semibold flex-shrink-0 ${getResultColor(lastAB)}`}>
                          {getResultBadge(lastAB)}
                        </span>
                      )}

                      {/* Edit button — corrects name/number, keeps player ID + history */}
                      {!readOnly && <button
                        onClick={e => handleEditExistingClick(e, idx, player!)}
                        className={`text-[15px] px-1.5 py-0.5 rounded border transition-colors flex-shrink-0
                          ${isEditExisting
                            ? 'text-blue-400 bg-blue-950 border-blue-800'
                            : 'text-slate-500 hover:text-blue-400 hover:bg-blue-950 border-slate-700 hover:border-blue-800'}`}
                        title="Edit player name / number"
                      >✎</button>}

                      {/* Sub button — opens fresh form for a new player */}
                      {!readOnly && <button
                        onClick={e => handleSubClick(e, idx)}
                        className={`text-[15px] px-1.5 py-0.5 rounded border transition-colors flex-shrink-0
                          ${isEdit
                            ? 'text-amber-400 bg-amber-950 border-amber-800'
                            : 'text-slate-500 hover:text-amber-400 hover:bg-amber-950 border-slate-700 hover:border-amber-800'}`}
                        title="Substitute batter"
                      >SUB</button>}

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
                            {!readOnly && ab.pitches.length > 0 && (
                              <p className="text-slate-600 text-[13px] text-right pr-1">tap ✎ to edit a pitch</p>
                            )}
                            {ab.pitches.map((pitch, i) => (
                              <div key={pitch.id} className="relative group">
                                <PitchRow
                                  pitch={pitch}
                                  index={i}
                                  playerHand={player.hand}
                                />
                                {/* ── Pitch edit button ── */}
                                {!readOnly && (
                                  <button
                                    onClick={() => {
                                      if (editingPitch?.pitchId === pitch.id) {
                                        setEditingPitch(null);
                                      } else {
                                        setEditingPitch({ atBatId: ab.id, pitchId: pitch.id });
                                        setPitchEditForm({
                                          pitchType: pitch.pitchType,
                                          outcome: pitch.outcome,
                                          swing: pitch.swing,
                                        });
                                      }
                                    }}
                                    className={`absolute top-1 right-1 text-[15px] px-2 py-0.5 rounded border transition-colors min-w-[32px] text-center ${
                                      editingPitch?.pitchId === pitch.id
                                        ? 'text-blue-300 bg-blue-950 border-blue-600'
                                        : 'text-slate-400 bg-slate-800 border-slate-600 active:bg-slate-700'
                                    }`}
                                    title="Edit this pitch"
                                  >
                                    ✎
                                  </button>
                                )}
                                {/* ── Inline pitch edit form ── */}
                                {editingPitch?.pitchId === pitch.id && (
                                  <PitchEditInlineForm
                                    form={pitchEditForm}
                                    onChange={setPitchEditForm}
                                    onSave={() => {
                                      onEditPitch(ab.id, pitch.id, {
                                        pitchType: pitchEditForm.pitchType,
                                        outcome:   pitchEditForm.outcome,
                                        swing:     pitchEditForm.swing,
                                      });
                                      setEditingPitch(null);
                                    }}
                                    onCancel={() => setEditingPitch(null)}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )) : (
                        <p className="text-slate-600 text-[18px] text-center py-2">No completed at-bats yet</p>
                      )}
                      {/* Spray chart */}
                      <BatterSprayChart allABs={allBatterABs} />

                      {/* Full history button */}
                      {state.sheetsWebhookUrl && (
                        <button
                          onClick={() => {
                            const gameId = state.id;
                            const allPitches: PitchRecord[] = [
                              ...allAtBats.flatMap((ab: AtBat) => ab.pitches),
                              ...(currentAtBat?.pitches ?? []),
                            ];
                            const bPitches = allPitches
                              .filter(p =>
                                p.batterName === player!.name &&
                                p.batterNumber === player!.number
                              )
                              .map(toPitchRowLite);
                            setHistoryPlayer({
                              name:               player!.name,
                              number:             player!.number,
                              currentGameId:      gameId,
                              currentGamePitches: bPitches,
                              rosterId:           isRosterId(player!.id) ? player!.id : undefined,
                            });
                          }}
                          className="w-full py-2.5 rounded-xl bg-indigo-900 hover:bg-indigo-800 border border-indigo-700 text-indigo-200 text-[18px] font-semibold flex items-center justify-center gap-2"
                        >
                          📊 Full History &amp; Tendencies
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* ── Sub / Add form ── */}
                {!readOnly && isEdit && (
                  <div className="bg-slate-950 px-3 py-2.5">
                    {hasPlayer ? (
                      <p className="text-amber-400/80 text-[18px] mb-2 font-medium">
                        Sub in new batter at slot {idx + 1}
                        <span className="text-slate-500 font-normal"> (replaces {player!.name || 'current batter'})</span>
                      </p>
                    ) : (
                      <p className="text-slate-400 text-[18px] mb-2">Add batter to slot {idx + 1} <span className="text-slate-600 text-[15px]">(name &amp; number optional)</span></p>
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
                        placeholder="Player name (optional)"
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(idx); }}
                        className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSave(idx)}
                        className="px-3 h-10 rounded-lg bg-green-700 hover:bg-green-600 text-white font-bold text-[27px] flex-shrink-0"
                      >✓</button>
                    </div>
                    {/* Clear slot: only for filled slots that are not currently active */}
                    {hasPlayer && idx !== currentBatterIndex && (
                      <button
                        onClick={() => { onRemoveBatter(idx); setExpanded(null); }}
                        className="mt-2 w-full h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-red-400 text-[18px] font-medium border border-slate-800 hover:border-red-900"
                      >
                        Clear Slot {idx + 1} (remove {player!.name || 'batter'} from order)
                      </button>
                    )}
                  </div>
                )}

                {/* ── Edit existing player form ── */}
                {!readOnly && isEditExisting && hasPlayer && player && (
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
                        placeholder="Player name (optional)"
                        onKeyDown={e => { if (e.key === 'Enter') handleEditExistingSave(idx, player); }}
                        className="flex-1 h-10 rounded-lg bg-slate-800 border border-blue-700 text-slate-100 px-3 outline-none focus:border-blue-400"
                        autoFocus
                      />
                      <button
                        onClick={() => handleEditExistingSave(idx, player)}
                        className="px-3 h-10 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-bold text-[27px] flex-shrink-0"
                      >✓</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!readOnly && visibleSlots < MAX_SLOTS && (
          <button
            onClick={() => setExtraSlots(e => Math.min(e + 1, MAX_SLOTS - 9))}
            className="mt-2 w-full h-10 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-400 text-[21px] transition-colors"
          >
            + Add Batter {visibleSlots + 1}
          </button>
        )}
      </div>

      {/* ── Google Sheets URL ── */}
      {!readOnly && (
      <SheetsUrlPanel
        webhookUrl={state.sheetsWebhookUrl}
        syncQueue={state.syncQueue.length}
        onSave={onSetWebhookUrl}
        syncStatus={syncStatus}
      />
      )}

    </div>

      {/* ── Batter History Modal ────────────────────────────── */}
      {historyPlayer && (
        <BatterHistoryModal
          playerName={historyPlayer.name}
          playerNumber={historyPlayer.number}
          webhookUrl={state.sheetsWebhookUrl}
          currentGameId={historyPlayer.currentGameId}
          currentGamePitches={historyPlayer.currentGamePitches}
          playerRosterId={historyPlayer.rosterId}
          ownerId={ownerId}
          onClose={() => setHistoryPlayer(null)}
        />
      )}

      {/* ── Pitcher Stats Modal ──────────────────────────────── */}
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
