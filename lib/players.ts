'use client';
import { PlayerRecord } from '@/types';

const PLAYER_ID_PREFIX = 'PLR';

/**
 * True if a lineup Player.id came from the persistent Players database
 * (backend-generated, e.g. "PLR0001") — as opposed to a Saved Roster id
 * ("roster-<uuid>", see lib/roster.ts) or a throwaway per-game uuid.
 */
export function isPlayerId(id?: string | null): boolean {
  return !!id && new RegExp(`^${PLAYER_ID_PREFIX}\\d+$`, 'i').test(id);
}

/**
 * Fetch every player in the coach's persistent batter database (scoped to
 * their account). Returns [] if none have been created yet — that's a
 * normal, expected result, not an error. Mirrors the "fetch everything once,
 * filter client-side as you type" pattern already used for team-name
 * autocomplete (see TeamNameInput in components/setup-screen.tsx), so the
 * player-name autocomplete behaves identically.
 */
export async function fetchPlayers(
  webhookUrl: string,
  ownerId?: string,
): Promise<PlayerRecord[]> {
  if (!webhookUrl) return [];
  const qs = new URLSearchParams({ url: webhookUrl });
  if (ownerId) qs.set('owner', ownerId);
  const res = await fetch(`/api/sheets/players?${qs.toString()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return (json.players ?? []) as PlayerRecord[];
}

/**
 * Create a brand-new player in the persistent database. The backend
 * generates and returns the permanent Player ID ("PLR0001" style) — the
 * caller must use the returned record's `id`, not invent one locally, since
 * IDs are sequentially assigned server-side.
 */
export async function createPlayer(
  webhookUrl: string,
  player: { name: string; number: string; hand: 'L' | 'R' | null },
): Promise<PlayerRecord> {
  const res = await fetch('/api/sheets/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, action: 'create', ...player }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.player as PlayerRecord;
}

// ── Player Identity Phase 2: historical matching, duplicate merge, profile ──

/**
 * A distinct (batterName, batterNumber) combination recorded historically
 * with NO playerId yet — a candidate for "Attach historical records" on
 * the Player Profile screen. Purely informational until explicitly
 * attached; nothing is ever auto-linked.
 */
export interface UnlinkedBatter {
  name: string;
  number: string;
  pitchCount: number;
  gameCount: number;
}

/**
 * Fetch every unlinked (no playerId) batter name/number combination
 * recorded in this organization's Pitches history — the review list a
 * coach picks from before attaching old games to a specific player.
 */
export async function fetchUnlinkedBatters(
  webhookUrl: string,
  ownerId?: string,
): Promise<UnlinkedBatter[]> {
  if (!webhookUrl) return [];
  const qs = new URLSearchParams({ url: webhookUrl, type: 'unlinked' });
  if (ownerId) qs.set('owner', ownerId);
  const res = await fetch(`/api/sheets/players?${qs.toString()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return (json.batters ?? []) as UnlinkedBatter[];
}

/**
 * Attaches every unlinked historical pitch recorded as (batterName,
 * batterNumber) in this organization to the given player — an explicit,
 * reviewed action, never automatic. Returns how many pitch rows were
 * attached so the UI can confirm the result.
 */
export async function attachHistoricalRecords(
  webhookUrl: string,
  playerId: string,
  batter: { name: string; number: string },
): Promise<{ attached: number }> {
  const res = await fetch('/api/sheets/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookUrl, action: 'attach',
      playerId, batterName: batter.name, batterNumber: batter.number,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return { attached: Number(json.attached) || 0 };
}

/**
 * Merges a duplicate player record into a primary one. Every pitch and
 * saved-roster entry referencing `sourcePlayerId` is re-tagged to
 * `targetPlayerId`; the source player is deactivated (never deleted) so
 * nothing referencing its id breaks. Both players must belong to the same
 * organization — enforced server-side.
 */
export async function mergePlayers(
  webhookUrl: string,
  sourcePlayerId: string,
  targetPlayerId: string,
): Promise<{ pitchesReassigned: number; rostersReassigned: number; target: PlayerRecord | null }> {
  const res = await fetch('/api/sheets/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, action: 'merge', sourcePlayerId, targetPlayerId }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return {
    pitchesReassigned: Number(json.pitchesReassigned) || 0,
    rostersReassigned: Number(json.rostersReassigned) || 0,
    target: (json.target as PlayerRecord) ?? null,
  };
}

/** Editable fields on a Player Profile — see updatePlayerProfile(). */
export interface PlayerProfilePatch {
  name?: string;
  number?: string;
  hand?: 'L' | 'R' | '';
  notes?: string;
  verified?: boolean;
  isActive?: boolean;
}

/**
 * Updates editable profile fields (name, number, hand, notes, verified,
 * isActive) on an existing player — powers the Player Profile edit screen.
 * Only fields present in `patch` are changed.
 */
export async function updatePlayerProfile(
  webhookUrl: string,
  playerId: string,
  patch: PlayerProfilePatch,
): Promise<PlayerRecord> {
  const res = await fetch('/api/sheets/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, action: 'update', playerId, patch }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.player as PlayerRecord;
}
