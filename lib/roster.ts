'use client';
import { RosterPlayer } from '@/types';

const ROSTER_ID_PREFIX = 'roster-';

/** True if a lineup Player.id came from (or was saved to) a Saved Roster. */
export function isRosterId(id?: string | null): boolean {
  return !!id && id.startsWith(ROSTER_ID_PREFIX);
}

export function newRosterId(): string {
  return `${ROSTER_ID_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Fetch the saved roster for an opposing team (scoped to the coach's
 * account). Returns [] if no roster has been saved for that team yet —
 * that's a normal, expected result, not an error.
 */
export async function fetchRoster(
  webhookUrl: string,
  teamName: string,
  ownerId?: string,
): Promise<RosterPlayer[]> {
  if (!webhookUrl || !teamName.trim()) return [];
  const qs = new URLSearchParams({ url: webhookUrl, team: teamName.trim() });
  if (ownerId) qs.set('owner', ownerId);
  const res = await fetch(`/api/sheets/roster?${qs.toString()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return (json.players ?? []) as RosterPlayer[];
}

/**
 * Save/update a roster of players for an opposing team. Existing players
 * (matched by id) are updated in place; new ones are appended. Safe to call
 * repeatedly as a roster evolves over the season (new call-ups, corrections).
 */
export async function saveRoster(
  webhookUrl: string,
  teamName: string,
  players: RosterPlayer[],
): Promise<void> {
  if (!webhookUrl || !teamName.trim() || players.length === 0) return;
  const res = await fetch('/api/sheets/roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, teamName: teamName.trim(), players }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
}
