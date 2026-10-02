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
    body: JSON.stringify({ webhookUrl, ...player }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.player as PlayerRecord;
}
