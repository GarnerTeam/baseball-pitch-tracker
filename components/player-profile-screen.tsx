'use client';
import { useState, useEffect, useCallback } from 'react';
import { PlayerRecord } from '@/types';
import {
  fetchPlayers, fetchUnlinkedBatters, attachHistoricalRecords,
  mergePlayers, updatePlayerProfile, UnlinkedBatter,
} from '@/lib/players';

interface PlayerProfileScreenProps {
  webhookUrl: string;
  ownerId?: string;
  onClose: () => void;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Player Identity Phase 2 — Player Profile Management screen.
 *
 * Three jobs, each an explicit reviewed action (nothing automatic):
 *   1. Browse/search the organization's persistent player database and
 *      edit a player's profile (name/number/hand/notes/verified/active).
 *   2. Attach historical pre-migration pitches (recorded before this
 *      player existed, or typed without using autocomplete) to a player.
 *   3. Merge an accidental duplicate player into the correct one.
 */
export function PlayerProfileScreen({ webhookUrl, ownerId, onClose }: PlayerProfileScreenProps) {
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchPlayers(webhookUrl, ownerId);
      setPlayers(list.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '')));
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [webhookUrl, ownerId]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = players.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = players.find(p => p.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 h-dvh pt-safe bg-slate-950 text-slate-100 z-50 flex flex-col">
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 pb-3 flex items-center gap-3" style={{ paddingTop: 'max(3rem, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="text-blue-400 hover:text-blue-300 text-[15px] font-semibold flex-shrink-0">‹ Back</button>
        <p className="text-slate-100 text-[18px] font-bold flex-1">👤 Manage Players</p>
      </div>

      {selected ? (
        <PlayerDetail
          player={selected}
          webhookUrl={webhookUrl}
          allPlayers={players}
          onBack={() => setSelectedId(null)}
          onChanged={async () => { await reload(); }}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-scroll">
          <div className="px-4 pt-4 pb-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search players…"
              className="w-full h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 px-4 outline-none focus:border-blue-500"
            />
          </div>

          {loading && <p className="px-4 py-6 text-slate-500 text-[16px]">Loading…</p>}
          {loadError && <p className="px-4 py-3 text-red-400 text-[14px]">{loadError}</p>}
          {!loading && !loadError && filtered.length === 0 && (
            <p className="px-4 py-6 text-slate-500 text-[16px] italic">
              {players.length === 0 ? 'No players recorded yet — they appear here once created via the Lineup tab.' : 'No players match your search.'}
            </p>
          )}

          <div className="px-4 pb-6 space-y-1.5">
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="w-full text-left px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-slate-100 text-[18px] font-semibold truncate">
                    {p.name}{p.number && <span className="text-slate-400 font-normal"> (#{p.number})</span>}
                    {p.hand && <span className="text-slate-500 font-normal text-[14px]"> {p.hand}HB</span>}
                    {!p.verified && <span className="ml-2 text-amber-400 text-[12px] font-bold align-middle">UNVERIFIED</span>}
                  </p>
                  <p className="text-slate-500 text-[13px]">
                    {p.pitchesSeen} pitch{p.pitchesSeen !== 1 ? 'es' : ''} · {p.gamesSeen} game{p.gamesSeen !== 1 ? 's' : ''} · Last seen {fmtDate(p.lastSeen)}
                  </p>
                </div>
                <span className="text-slate-600 text-[22px]">›</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerDetail({
  player, webhookUrl, allPlayers, onBack, onChanged,
}: {
  player: PlayerRecord;
  webhookUrl: string;
  allPlayers: PlayerRecord[];
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(player.name);
  const [number, setNumber] = useState(player.number);
  const [hand, setHand] = useState<'L' | 'R' | ''>(player.hand ?? '');
  const [notes, setNotes] = useState(player.notes ?? '');
  const [verified, setVerified] = useState(player.verified);
  const [isActive, setIsActive] = useState(player.isActive);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await updatePlayerProfile(webhookUrl, player.id, {
        name: name.trim(), number: number.trim(), hand, notes, verified, isActive,
      });
      setSaveMsg('✓ Saved');
      await onChanged();
    } catch (e) {
      setSaveMsg('Error: ' + String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-scroll">
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-300 text-[14px] mb-3">‹ All Players</button>
        <p className="text-slate-500 text-[13px] font-mono mb-1">{player.id}</p>
      </div>

      {/* ── Profile fields ── */}
      <div className="mx-4 mb-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <p className="text-slate-400 text-[15px] font-medium uppercase tracking-wider">Profile</p>
        <div className="flex gap-2">
          <input value={number} onChange={e => setNumber(e.target.value)} placeholder="#" maxLength={3}
            className="w-16 h-11 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-center font-bold outline-none focus:border-blue-500" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name"
            className="flex-1 h-11 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-blue-500" />
        </div>
        <div className="flex gap-2">
          {(['R', 'L'] as const).map(h => (
            <button key={h} onClick={() => setHand(prev => prev === h ? '' : h)}
              className={`flex-1 h-9 rounded-lg text-[16px] font-bold transition-colors ${hand === h ? (h === 'R' ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white') : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
              {h === 'R' ? 'RHB' : 'LHB'}
            </button>
          ))}
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Scouting notes (e.g. 'Likes low pitches')"
          rows={2} className="w-full rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 py-2 text-[15px] outline-none focus:border-blue-500 resize-none" />
        <div className="flex items-center gap-4 text-[14px]">
          <label className="flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="w-4 h-4" />
            Verified
          </label>
          <label className="flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4" />
            Active
          </label>
        </div>
        <button onClick={handleSave} disabled={saving || !name.trim()}
          className="w-full h-10 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold text-[16px]">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saveMsg && <p className={`text-[13px] ${saveMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{saveMsg}</p>}
      </div>

      <div className="mx-4 mb-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-[15px] font-medium uppercase tracking-wider mb-2">Career Totals</p>
        <div className="flex gap-4 text-[15px]">
          <p className="text-slate-300"><span className="text-slate-100 font-bold">{player.pitchesSeen}</span> pitches</p>
          <p className="text-slate-300"><span className="text-slate-100 font-bold">{player.gamesSeen}</span> games</p>
          <p className="text-slate-300">First seen <span className="text-slate-100">{fmtDate(player.firstSeen)}</span></p>
        </div>
      </div>

      <AttachHistorySection webhookUrl={webhookUrl} player={player} onAttached={onChanged} />
      <MergeSection webhookUrl={webhookUrl} player={player} allPlayers={allPlayers} onMerged={async () => { await onChanged(); onBack(); }} />

      <div className="h-6" />
    </div>
  );
}

function AttachHistorySection({ webhookUrl, player, onAttached }: {
  webhookUrl: string; player: PlayerRecord; onAttached: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [batters, setBatters] = useState<UnlinkedBatter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attachingKey, setAttachingKey] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      setBatters(await fetchUnlinkedBatters(webhookUrl));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function attach(b: UnlinkedBatter) {
    const key = b.name + '|' + b.number;
    setAttachingKey(key);
    setSuccessMsg(null);
    try {
      const result = await attachHistoricalRecords(webhookUrl, player.id, b);
      setSuccessMsg(`✓ Attached ${result.attached} pitch${result.attached !== 1 ? 'es' : ''} from "${b.name}" to ${player.name}`);
      setBatters(prev => prev.filter(x => x.name + '|' + x.number !== key));
      await onAttached();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setAttachingKey(null);
    }
  }

  return (
    <div className="mx-4 mb-4 bg-slate-900 border border-indigo-900 rounded-xl p-4">
      <p className="text-indigo-300 text-[15px] font-medium uppercase tracking-wider mb-1">Attach Historical Records</p>
      <p className="text-slate-500 text-[13px] mb-3">
        Connect old pitches recorded before {player.name} existed as a player (pre-migration, or typed without using autocomplete) to this player&apos;s permanent history. Nothing is attached automatically — review each match first.
      </p>
      {!open ? (
        <button onClick={load} className="w-full h-10 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-indigo-100 font-semibold text-[15px]">
          Find Unlinked Historical Pitches
        </button>
      ) : (
        <>
          {loading && <p className="text-slate-500 text-[14px]">Scanning history…</p>}
          {error && <p className="text-red-400 text-[13px] mb-2">{error}</p>}
          {successMsg && <p className="text-emerald-400 text-[13px] mb-2">{successMsg}</p>}
          {!loading && batters.length === 0 && <p className="text-slate-500 text-[14px] italic">No unlinked historical pitches found.</p>}
          <div className="space-y-1.5">
            {batters.map(b => {
              const key = b.name + '|' + b.number;
              return (
                <div key={key} className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-100 text-[15px] font-semibold truncate">{b.name}{b.number && <span className="text-slate-400 font-normal"> (#{b.number})</span>}</p>
                    <p className="text-slate-500 text-[12px]">{b.pitchCount} pitch{b.pitchCount !== 1 ? 'es' : ''} · {b.gameCount} game{b.gameCount !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => attach(b)} disabled={attachingKey === key}
                    className="px-3 h-8 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-[13px] font-semibold flex-shrink-0">
                    {attachingKey === key ? '…' : `Attach to ${player.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MergeSection({ webhookUrl, player, allPlayers, onMerged }: {
  webhookUrl: string; player: PlayerRecord; allPlayers: PlayerRecord[]; onMerged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [dupeId, setDupeId] = useState('');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = allPlayers.filter(p => p.id !== player.id && p.isActive);
  const dupe = others.find(p => p.id === dupeId);

  async function handleMerge() {
    if (!dupe) return;
    if (!confirm(`Merge "${dupe.name}" into "${player.name}"?\n\nAll of ${dupe.name}'s pitch history will move to ${player.name}. "${dupe.name}" will be deactivated (not deleted) and will no longer appear in autocomplete. This cannot be undone from this screen.`)) return;
    setMerging(true);
    setError(null);
    try {
      await mergePlayers(webhookUrl, dupe.id, player.id);
      await onMerged();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setMerging(false);
    }
  }

  return (
    <div className="mx-4 mb-4 bg-slate-900 border border-red-900/60 rounded-xl p-4">
      <p className="text-red-300 text-[15px] font-medium uppercase tracking-wider mb-1">Merge Duplicate Player</p>
      <p className="text-slate-500 text-[13px] mb-3">
        If another player entry is actually the same real person as {player.name} (e.g. an accidental duplicate), merge it in here. The duplicate&apos;s full pitch history moves to {player.name}; the duplicate is deactivated, never deleted.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full h-10 rounded-lg bg-red-950 hover:bg-red-900 border border-red-800 text-red-200 font-semibold text-[15px]">
          Merge a Duplicate Into {player.name}
        </button>
      ) : (
        <div className="space-y-2">
          <select value={dupeId} onChange={e => setDupeId(e.target.value)}
            className="w-full h-11 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 px-3 outline-none focus:border-red-500">
            <option value="">Select the duplicate player…</option>
            {others.map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.number ? ` (#${p.number})` : ''} — {p.pitchesSeen} pitches</option>
            ))}
          </select>
          {error && <p className="text-red-400 text-[13px]">{error}</p>}
          <button onClick={handleMerge} disabled={!dupeId || merging}
            className="w-full h-10 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold text-[15px]">
            {merging ? 'Merging…' : `Merge Into ${player.name}`}
          </button>
        </div>
      )}
    </div>
  );
}
