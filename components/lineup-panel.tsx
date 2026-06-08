'use client';
import { useState } from 'react';
import { GameState, Player, AtBat, PITCH_TYPE_LABELS, PITCH_TYPE_COLORS } from '@/types';

interface LineupPanelProps {
  state: GameState;
  onNextBatter: () => void;
  onSkipBatter: () => void;
  onEndAtBat: () => void;
  onChangePitcher: (p: Player) => void;
  onAddBatter: (p: Player) => void;
  onRemoveBatter: (idx: number) => void;
  onSetBatterAt: (idx: number, player: Player) => void;
  onSetWebhookUrl: (url: string) => void;
}

const OUTCOME_LABELS: Record<string, string> = {
  'ball': 'Ball',
  'called-strike': 'Called ☒',
  'swinging-strike': 'Swing ☒',
  'foul': 'Foul',
  'foul-tip': 'Foul Tip',
  'in-play': 'In Play',
  'walk': 'Walk',
  'strikeout': 'K',
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
function getHitLabel(result: string): string {
  const m: Record<string, string> = {
    'out': '🔴 Out', 'error': '🟠 Error', 'single': '🟢 1B',
    'double': '🔵 2B', 'triple': '🟣 3B', 'home-run': '⭐ HR',
  };
  return m[result] || result;
}
function getResultBadge(ab: AtBat): string {
  if (ab.result === 'in-play') {
    const hd = ab.pitches.find(p => p.hitData)?.hitData;
    return hd ? getHitLabel(hd.result) : '⚾ IP';
  }
  const m: Record<string, string> = {
    'walk': '🟢 BB', 'strikeout': '🔴 K', 'manual-end': '—',
  };
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

const APPS_SCRIPT = `function doPost(e) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var d = JSON.parse(e.postData.contents);
  var p = Array.isArray(d) ? d : [d];
  if (s.getLastRow() === 0) {
    s.appendRow(['Time','Pitcher','Batter','#','AB#','Pitch#',
      'Type','Outcome','Before','After','Hit']);
  }
  p.forEach(function(r) {
    s.appendRow([r.timestamp,r.pitcherName,r.batterName,
      r.batterNumber,r.atBatNumber,r.pitchNumber,r.pitchType,
      r.outcome,r.ballsBefore+'-'+r.strikesBefore,
      r.ballsAfter+'-'+r.strikesAfter,
      (r.hitData||{}).result||'']);
  });
  return ContentService
    .createTextOutput(JSON.stringify({status:'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export function LineupPanel({
  state, onNextBatter, onSkipBatter, onEndAtBat,
  onChangePitcher, onAddBatter, onRemoveBatter, onSetBatterAt, onSetWebhookUrl,
}: LineupPanelProps) {
  const { pitcher, lineup, currentBatterIndex, allAtBats, syncQueue, sheetsWebhookUrl } = state;

  // Pitcher edit
  const [editP, setEditP] = useState(false);
  const [pName, setPName] = useState(pitcher.name);
  const [pNum, setPNum] = useState(pitcher.number);

  // Slot state: which slot is open and what view
  const [expanded, setExpanded] = useState<{ idx: number; view: 'details' | 'edit' } | null>(null);
  const [slotForm, setSlotForm] = useState({ name: '', num: '' });

  // Google Sheets
  const [webhookInput, setWebhookInput] = useState(sheetsWebhookUrl);
  const [showSetup, setShowSetup] = useState(false);
  const [copied, setCopied] = useState(false);

  const MAX_SLOTS = 10;

  function getLastCompletedAB(batterIdx: number): AtBat | undefined {
    for (let i = allAtBats.length - 1; i >= 0; i--) {
      if (allAtBats[i].batterIndex === batterIdx && allAtBats[i].isComplete) {
        return allAtBats[i];
      }
    }
    return undefined;
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
    if (!player) {
      openSlot(idx, 'edit');
    } else {
      openSlot(idx, 'details');
    }
  }

  function handleEditClick(e: React.MouseEvent, idx: number) {
    e.stopPropagation();
    openSlot(idx, 'edit', lineup[idx]);
  }

  function handleSave(idx: number) {
    if (!slotForm.name.trim() || !slotForm.num.trim()) return;
    const player: Player = { id: crypto.randomUUID(), name: slotForm.name.trim(), number: slotForm.num.trim() };
    onSetBatterAt(idx, player);
    setExpanded(null);
    setSlotForm({ name: '', num: '' });
  }

  function copyScript() {
    navigator.clipboard.writeText(APPS_SCRIPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100">

      {/* ── At-Bat Controls ── */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">At-Bat Controls</p>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={onNextBatter} className="py-3 rounded-xl bg-green-700 hover:bg-green-600 text-white text-sm font-medium">Next Batter</button>
          <button onClick={onSkipBatter} className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium">Skip</button>
          <button onClick={onEndAtBat} className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium">End AB</button>
        </div>
      </div>

      {/* ── Pitcher ── */}
      <div className="px-4 pt-1 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Pitcher</p>
          <button onClick={() => { setEditP(!editP); setPName(pitcher.name); setPNum(pitcher.number); }} className="text-blue-400 text-xs">{editP ? 'Cancel' : 'Change'}</button>
        </div>
        {editP ? (
          <div className="bg-slate-900 rounded-xl p-3 space-y-2 border border-slate-700">
            <div className="flex gap-2">
              <input value={pNum} onChange={e => setPNum(e.target.value)} placeholder="#" maxLength={3} className="w-16 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-center font-bold outline-none focus:border-blue-500 flex-shrink-0" />
              <input value={pName} onChange={e => setPName(e.target.value)} placeholder="Name" className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500" />
            </div>
            <button onClick={() => { if (pName.trim() && pNum.trim()) { onChangePitcher({ id: pitcher.id, name: pName.trim(), number: pNum.trim() }); setEditP(false); } }} className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">Save</button>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-xl p-3 flex items-center gap-3 border border-slate-700">
            <span className="bg-blue-600 text-white text-sm font-bold px-2 py-1 rounded-lg">#{pitcher.number}</span>
            <span className="font-medium">{pitcher.name}</span>
          </div>
        )}
      </div>

      {/* ── Batting Order: 10 Slots ── */}
      <div className="px-4 pt-1 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Batting Order</p>
          <span className="text-slate-600 text-xs">{lineup.length}/10 batters</span>
        </div>

        <div className="space-y-1.5">
          {Array.from({ length: MAX_SLOTS }).map((_, idx) => {
            const player = lineup[idx] ?? null;
            const isActive = player !== null && idx === currentBatterIndex;
            const isExpanded = expanded?.idx === idx;
            const isDetails = isExpanded && expanded?.view === 'details';
            const isEdit = isExpanded && expanded?.view === 'edit';
            const lastAB = player ? getLastCompletedAB(idx) : undefined;

            return (
              <div key={idx} className={`rounded-xl overflow-hidden border ${isActive ? 'border-blue-600' : 'border-slate-700'}`}>
                {/* Slot row */}
                <div
                  onClick={() => handleSlotRowClick(idx)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors select-none
                    ${isActive ? 'bg-slate-800' : player ? 'bg-slate-900 hover:bg-slate-800/70' : 'bg-slate-900/50 hover:bg-slate-800/50'}
                    ${isExpanded ? 'border-b border-slate-700' : ''}`}
                >
                  {/* Position number */}
                  <span className="text-slate-500 text-xs font-mono w-5 text-right flex-shrink-0">{idx + 1}.</span>

                  {player ? (
                    <>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                        #{player.number}
                      </span>
                      <span className={`flex-1 text-sm truncate ${isActive ? 'text-slate-100 font-semibold' : 'text-slate-300'}`}>{player.name}</span>

                      {isActive && <span className="text-blue-400 text-[10px] font-bold flex-shrink-0">AT BAT</span>}

                      {!isActive && lastAB && (
                        <span className={`text-[10px] font-semibold flex-shrink-0 ${getResultColor(lastAB)}`}>
                          {getResultBadge(lastAB)}
                        </span>
                      )}

                      <button
                        onClick={e => handleEditClick(e, idx)}
                        className={`text-[11px] px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${isEdit ? 'text-blue-400 bg-slate-700' : 'text-slate-500 hover:text-blue-400 hover:bg-slate-700'}`}
                      >✎</button>
                      <span className="text-slate-600 text-[10px] flex-shrink-0">{isDetails ? '▲' : '▼'}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-slate-600 text-xs italic">Slot {idx + 1} — tap to add batter</span>
                      <span className="text-slate-600 text-xs">{isEdit ? '▲' : '＋'}</span>
                    </>
                  )}
                </div>

                {/* ── At-bat details panel ── */}
                {isDetails && player && (
                  <div className="bg-slate-950 px-3 py-2.5">
                    {lastAB ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-slate-500 text-xs">At-Bat #{lastAB.atBatNumber} · {lastAB.pitches.length} pitch{lastAB.pitches.length !== 1 ? 'es' : ''}</p>
                          <span className={`text-xs font-bold ${getResultColor(lastAB)}`}>{getResultBadge(lastAB)}</span>
                        </div>
                        <div className="space-y-1">
                          {lastAB.pitches.map((pitch, i) => (
                            <div key={pitch.id} className="flex items-center gap-2 text-xs bg-slate-900 rounded px-2 py-1">
                              <span className="text-slate-600 w-4 text-right">{i + 1}</span>
                              <span className="font-bold w-6" style={{ color: PITCH_TYPE_COLORS[pitch.pitchType] }}>{pitch.pitchType}</span>
                              <span className="text-slate-500 w-8">
                                {pitch.location?.zone === 'strike' ? `Z${pitch.location.zoneNumber ?? ''}` : `B${pitch.location ? `(${pitch.location.col},${pitch.location.row})` : ''}`}
                              </span>
                              <span className={`flex-1 ${OUTCOME_COLORS[pitch.outcome] ?? 'text-slate-400'}`}>
                                {OUTCOME_LABELS[pitch.outcome] ?? pitch.outcome}
                                {pitch.hitData ? ` — ${getHitLabel(pitch.hitData.result)}` : ''}
                              </span>
                              <span className="text-slate-600 font-mono">{pitch.ballsAfter}-{pitch.strikesAfter}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-600 text-xs text-center py-2">No completed at-bats yet</p>
                    )}
                  </div>
                )}

                {/* ── Add / Replace form ── */}
                {isEdit && (
                  <div className="bg-slate-950 px-3 py-2.5">
                    <p className="text-slate-400 text-xs mb-2">
                      {player ? `Replace Slot ${idx + 1} (${player.name})` : `Add Batter to Slot ${idx + 1}`}
                    </p>
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
                        className="px-3 h-10 rounded-lg bg-green-700 hover:bg-green-600 text-white font-bold text-lg disabled:opacity-40 flex-shrink-0"
                      >✓</button>
                    </div>
                    {player && idx !== currentBatterIndex && (
                      <button
                        onClick={() => { onRemoveBatter(idx); setExpanded(null); }}
                        className="mt-2 w-full h-8 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 text-xs font-medium border border-red-900"
                      >Remove from Order</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Google Sheets Sync ── */}
      <div className="px-4 pt-2 pb-6">
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-700 space-y-2">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-slate-200 text-sm font-semibold">☁ Google Sheets Sync</p>
              <p className="text-slate-500 text-xs mt-0.5">Every coach sees live pitch data</p>
            </div>
            {syncQueue.length > 0
              ? <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full flex-shrink-0">{syncQueue.length} queued</span>
              : sheetsWebhookUrl
                ? <span className="text-xs bg-green-900 text-green-400 px-2 py-0.5 rounded-full flex-shrink-0">✓ Live</span>
                : <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full flex-shrink-0">Not set up</span>
            }
          </div>

          {/* URL input */}
          <input
            value={webhookInput}
            onChange={e => setWebhookInput(e.target.value)}
            placeholder="Paste Apps Script Web App URL here..."
            className="w-full h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 text-xs outline-none focus:border-blue-500"
          />
          <button
            onClick={() => { onSetWebhookUrl(webhookInput); }}
            className="w-full h-9 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium"
          >Save &amp; Connect to Sheets</button>

          {/* Setup toggle */}
          <button
            onClick={() => setShowSetup(v => !v)}
            className="w-full h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs"
          >
            {showSetup ? '▲ Hide setup guide' : '▼ First time? See setup guide (3 min)'}
          </button>

          {/* Setup instructions */}
          {showSetup && (
            <div className="bg-slate-800 rounded-xl p-3 space-y-3 text-xs">
              <p className="font-semibold text-slate-200">One-time Google Sheets setup:</p>
              <ol className="space-y-1.5 text-slate-400 list-decimal list-inside leading-relaxed">
                <li>Open <span className="text-slate-200">Google Sheets</span> → create a new spreadsheet</li>
                <li>Click <span className="text-slate-200">Extensions → Apps Script</span></li>
                <li>Delete all existing code, paste the script below</li>
                <li>Click <span className="text-slate-200">Deploy → New deployment</span></li>
                <li>Type: <span className="text-slate-200">Web App</span> · Execute as: <span className="text-slate-200">Me</span> · Access: <span className="text-slate-200">Anyone</span></li>
                <li>Click <span className="text-slate-200">Deploy</span> → authorize → copy the Web App URL</li>
                <li>Paste the URL above and tap <span className="text-slate-200">Save &amp; Connect</span></li>
                <li>Share your Google Sheet with coaching staff — they see all pitches in real time ✓</li>
              </ol>

              {/* Script copy box */}
              <div className="bg-slate-900 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-slate-500 text-[10px] font-medium">Apps Script code</p>
                  <button
                    onClick={copyScript}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${copied ? 'bg-green-700 text-green-100' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                  >{copied ? '✓ Copied!' : 'Copy'}</button>
                </div>
                <pre className="text-[9px] text-green-400 whitespace-pre-wrap break-all leading-relaxed">{APPS_SCRIPT}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
