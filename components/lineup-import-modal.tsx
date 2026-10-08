'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Player, PlayerRecord } from '@/types';
import { createPlayer } from '@/lib/players';
import { extractLineupFromImage } from '@/lib/lineup-import';
import { ExtractedLineupRow, MAX_IMPORT_PLAYERS, normalizeName } from '@/lib/lineup-extract-parse';
import { candidatesFor, defaultMatchId } from '@/lib/lineup-match';

interface LineupImportModalProps {
  webhookUrl: string;
  /** The organization's known players (same list that powers autocomplete). */
  knownPlayers: PlayerRecord[];
  /** True if the game already has named batters — import will replace them. */
  replacesExisting: boolean;
  onClose: () => void;
  /**
   * Called with the final batting order. `created` lists any brand-new
   * players that were registered during the import so the caller can add
   * them to its autocomplete list without refetching.
   */
  onConfirm: (lineup: Player[], created: PlayerRecord[]) => void;
}

interface ReviewRow {
  key: string;
  name: string;
  number: string;
  hand: 'L' | 'R' | null;
  /** '' = register as a NEW player; otherwise the PlayerRecord.id to reuse. */
  matchId: string;
}

let rowKeySeq = 0;
const nextKey = () => `row-${++rowKeySeq}`;

export function LineupImportModal({ webhookUrl, knownPlayers, replacesExisting, onClose, onConfirm }: LineupImportModalProps) {
  const [step, setStep] = useState<'pick' | 'reading' | 'review' | 'saving'>('pick');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [teamName, setTeamName] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [progress, setProgress] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStep('reading');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    try {
      const result = await extractLineupFromImage(file);
      const reviewRows: ReviewRow[] = result.players.map((p: ExtractedLineupRow) => ({
        key: nextKey(),
        name: p.name,
        number: p.number,
        hand: p.hand,
        matchId: defaultMatchId(p, knownPlayers),
      }));
      setTeamName(result.teamName);
      setWarnings(result.warnings ?? []);
      setRows(reviewRows);
      setStep('review');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setStep('pick');
    } finally {
      if (fileRef.current) fileRef.current.value = ''; // allow re-picking the same file
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }
  function moveRow(idx: number, dir: -1 | 1) {
    setRows(prev => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function removeRow(key: string) { setRows(prev => prev.filter(r => r.key !== key)); }
  function addRow() {
    setRows(prev => (prev.length >= MAX_IMPORT_PLAYERS ? prev : [...prev, { key: nextKey(), name: '', number: '', hand: null, matchId: '' }]));
  }

  const namedCount = useMemo(() => rows.filter(r => r.name.trim()).length, [rows]);
  const newCount = useMemo(() => rows.filter(r => r.name.trim() && !r.matchId).length, [rows]);

  async function handleConfirm() {
    const usable = rows.filter(r => r.name.trim() || r.number.trim());
    if (usable.length === 0) { setError('Add at least one batter first.'); return; }
    // Rows that look like an existing player but are set to "New player" would
    // create a duplicate if the coach just taps through — make that explicit.
    const lookAlikes = usable.filter(r => r.name.trim() && !r.matchId && candidatesFor(r, knownPlayers).length > 0);
    if (lookAlikes.length > 0) {
      const names = lookAlikes.map(r => r.name.trim()).join(', ');
      if (!confirm(`${lookAlikes.length} row${lookAlikes.length !== 1 ? 's' : ''} look similar to players you already have but will be saved as NEW players:\n\n${names}\n\nIf any of these are the same kid, tap Cancel and pick the existing player from the dropdown. Save them as new players anyway?`)) return;
    }
    if (replacesExisting && !confirm('This replaces the current batting order with the imported lineup. Continue?')) return;

    setStep('saving');
    setError(null);
    const lineup: Player[] = [];
    const created: PlayerRecord[] = [];
    const createdByName = new Map<string, string>(); // same new name twice → one player
    let failed = 0;
    let done = 0;
    const toCreate = usable.filter(r => r.name.trim() && !r.matchId).length;

    for (const r of usable) {
      const name = r.name.trim();
      const number = r.number.trim();

      if (r.matchId) {
        const existing = knownPlayers.find(p => p.id === r.matchId);
        if (existing) {
          lineup.push({ id: existing.id, name: existing.name, number: number || existing.number, hand: r.hand ?? existing.hand ?? undefined });
          continue;
        }
      }

      if (!name) { // number-only row: keep the slot, no identity to register
        lineup.push({ id: crypto.randomUUID(), name: '', number, hand: r.hand ?? undefined });
        continue;
      }

      const norm = normalizeName(name);
      const already = createdByName.get(norm);
      if (already) {
        lineup.push({ id: already, name, number, hand: r.hand ?? undefined });
        continue;
      }

      done++;
      setProgress(`Registering new players… ${done} of ${toCreate}`);
      try {
        const rec = await createPlayer(webhookUrl, { name, number, hand: r.hand });
        created.push(rec);
        createdByName.set(norm, rec.id);
        lineup.push({ id: rec.id, name, number, hand: r.hand ?? undefined });
      } catch {
        // Never block game setup on a backend hiccup — same policy as the
        // Lineup tab's single-player save: the batter is still added, they
        // just won't carry a long-term identity for this game.
        failed++;
        lineup.push({ id: crypto.randomUUID(), name, number, hand: r.hand ?? undefined });
      }
    }

    if (failed > 0) {
      // Surface it, but still apply the lineup so the coach isn't stuck.
      alert(`${failed} player${failed !== 1 ? 's' : ''} couldn't be saved to your player database and were added to this game only. You can re-enter them later from the Lineup tab to link their history.`);
    }
    onConfirm(lineup, created);
  }

  return (
    <div className="fixed inset-0 h-dvh pt-safe bg-slate-950 text-slate-100 z-50 flex flex-col">
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: 'max(3rem, env(safe-area-inset-top))' }}>
        <button onClick={onClose} disabled={step === 'saving'} className="text-blue-400 hover:text-blue-300 disabled:opacity-40 text-[15px] font-semibold flex-shrink-0">‹ Cancel</button>
        <p className="text-slate-100 text-[18px] font-bold flex-1">📷 Import Lineup from Photo</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-scroll">
        {(step === 'pick' || step === 'reading') && (
          <div className="px-4 pt-6 space-y-4">
            <p className="text-slate-400 text-[15px] leading-snug">
              Choose a screenshot (for example a GameChanger lineup) or a photo of a lineup card. You&apos;ll review and correct everything before it&apos;s used.
            </p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={step === 'reading'}
              className="w-full h-14 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-60 text-white text-[18px] font-bold"
            >
              {step === 'reading' ? 'Reading lineup…' : 'Choose Photo or Screenshot'}
            </button>
            {step === 'reading' && <p className="text-slate-500 text-[14px] text-center">This usually takes a few seconds.</p>}
            {error && <p className="text-red-400 text-[14px]">{error}</p>}
            <p className="text-slate-400 text-[13px] leading-snug">
              The image is sent to Google&apos;s Gemini service only to read the lineup. It is not saved by this app.
            </p>
          </div>
        )}

        {(step === 'review' || step === 'saving') && (
          <div className="px-4 pt-4 pb-6 space-y-3">
            <div className="flex items-start gap-3">
              {previewUrl && (
                <button onClick={() => setShowPhoto(s => !s)} className="flex-shrink-0 rounded-lg overflow-hidden border border-slate-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Selected lineup" className="h-16 w-16 object-cover" />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-slate-300 text-[15px] font-semibold">
                  {rows.length} row{rows.length !== 1 ? 's' : ''} found{teamName ? <span className="text-slate-500 font-normal"> · {teamName}</span> : null}
                </p>
                <p className="text-slate-500 text-[13px]">
                  {namedCount - newCount} matched to existing players · {newCount} new
                </p>
                <button onClick={() => setShowPhoto(s => !s)} className="text-blue-400 text-[13px]">{showPhoto ? 'Hide photo' : 'Show photo to double-check'}</button>
              </div>
            </div>

            {showPhoto && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Selected lineup" className="w-full rounded-lg border border-slate-700" />
            )}

            {replacesExisting && (
              <p className="text-amber-300/90 text-[13px] bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">
                Heads up: confirming replaces the current batting order.
              </p>
            )}
            {warnings.map((w, i) => (
              <p key={i} className="text-amber-300/90 text-[13px] bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">{w}</p>
            ))}

            <div className="space-y-2">
              {rows.map((r, idx) => {
                const cands = candidatesFor(r, knownPlayers);
                const matched = r.matchId ? knownPlayers.find(p => p.id === r.matchId) : undefined;
                const ambiguous = !r.matchId && knownPlayers.filter(p => normalizeName(p.name) === normalizeName(r.name) && normalizeName(r.name)).length > 1;
                return (
                  <div key={r.key} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 text-[16px] font-mono w-5 text-right flex-shrink-0">{idx + 1}.</span>
                      <input value={r.number} onChange={e => updateRow(r.key, { number: e.target.value })} placeholder="#" maxLength={3}
                        className="w-12 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-center font-bold outline-none focus:border-blue-500 flex-shrink-0" />
                      <input value={r.name} onChange={e => updateRow(r.key, { name: e.target.value, matchId: '' })} placeholder="Name"
                        className="flex-1 min-w-0 h-10 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500" />
                      <div className="flex flex-col flex-shrink-0">
                        <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} aria-label="Move up" className="w-9 h-5 flex items-center justify-center text-slate-400 hover:text-slate-100 active:bg-slate-800 rounded disabled:opacity-20 text-[13px] leading-none">▲</button>
                        <button onClick={() => moveRow(idx, 1)} disabled={idx === rows.length - 1} aria-label="Move down" className="w-9 h-5 flex items-center justify-center text-slate-400 hover:text-slate-100 active:bg-slate-800 rounded disabled:opacity-20 text-[13px] leading-none">▼</button>
                      </div>
                      <button onClick={() => removeRow(r.key)} aria-label="Remove row" className="w-9 h-10 flex items-center justify-center text-slate-500 hover:text-red-400 active:bg-slate-800 rounded text-[24px] leading-none flex-shrink-0">×</button>
                    </div>

                    <div className="flex items-center gap-2 pl-7">
                      <div className="flex gap-1 flex-shrink-0">
                        {(['R', 'L'] as const).map(h => (
                          <button key={h} onClick={() => updateRow(r.key, { hand: r.hand === h ? null : h })}
                            className={`px-2.5 h-8 rounded-md text-[13px] font-bold transition-colors ${r.hand === h ? (h === 'R' ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white') : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                            {h}
                          </button>
                        ))}
                      </div>
                      {r.name.trim() ? (
                        <select value={r.matchId} onChange={e => updateRow(r.key, { matchId: e.target.value })}
                          className={`flex-1 min-w-0 h-8 rounded-md bg-slate-800 border text-[13px] px-2 outline-none ${matched ? 'border-emerald-700 text-emerald-300' : ambiguous ? 'border-amber-600 text-amber-300' : 'border-slate-600 text-slate-300'}`}>
                          <option value="">{ambiguous ? '⚠ Several match — choose one' : '✚ New player'}</option>
                          {cands.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.number ? ` (#${p.number})` : ''} · {p.pitchesSeen} pitches
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-600 text-[12px] italic">Add a name to link a player</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {rows.length < MAX_IMPORT_PLAYERS && (
              <button onClick={addRow} className="w-full h-10 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-blue-400 hover:border-blue-500 text-[15px]">
                + Add batter
              </button>
            )}

            {error && <p className="text-red-400 text-[14px]">{error}</p>}
            {step === 'saving' && progress && <p className="text-slate-400 text-[14px] text-center">{progress}</p>}
          </div>
        )}
      </div>

      {(step === 'review' || step === 'saving') && (
        <div className="flex-shrink-0 bg-slate-900 border-t border-slate-800 px-4 py-3 flex gap-2 safe-area-inset-bottom">
          <button onClick={() => { setStep('pick'); setRows([]); setError(null); }} disabled={step === 'saving'}
            className="px-4 h-12 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-[15px] font-medium">
            Different photo
          </button>
          <button onClick={handleConfirm} disabled={step === 'saving' || rows.length === 0}
            className="flex-1 h-12 rounded-xl bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[17px] font-bold">
            {step === 'saving' ? 'Saving…' : `Use this lineup (${rows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
