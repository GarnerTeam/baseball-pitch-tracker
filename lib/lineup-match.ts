import { PlayerRecord } from '@/types';
import { normalizeName } from '@/lib/lineup-extract-parse';

/**
 * Candidate existing players for an extracted lineup row, best first: exact
 * name, then same jersey number, then same first name. Used both to
 * pre-select a default and to populate the row's "which player is this?"
 * dropdown on the import review screen.
 */
export function candidatesFor(
  row: { name: string; number: string },
  players: PlayerRecord[],
): PlayerRecord[] {
  const n = normalizeName(row.name);
  const first = n.split(' ')[0] ?? '';
  const scored: Array<{ p: PlayerRecord; score: number }> = [];
  for (const p of players) {
    const pn = normalizeName(p.name);
    let score = 0;
    if (n && pn === n) score += 100;
    if (row.number && p.number === row.number) score += 20;
    if (first && pn.split(' ')[0] === first) score += 10;
    if (score >= 10) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.p.pitchesSeen - a.p.pitchesSeen)
    .slice(0, 6)
    .map(s => s.p);
}

/**
 * Pre-select an existing player ONLY when it is unambiguous. Anything less
 * certain (similar name, shared number, several players with the same name)
 * returns '' = "register as a new player", and the coach decides on the
 * review screen. Wrongly merging two different kids corrupts scouting
 * history; a spare duplicate can be merged later — so we err on the side of
 * NOT auto-linking.
 */
export function defaultMatchId(
  row: { name: string; number: string },
  players: PlayerRecord[],
): string {
  const n = normalizeName(row.name);
  if (!n) return '';
  const exact = players.filter(p => normalizeName(p.name) === n);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) {
    const sameNum = exact.filter(p => p.number === row.number);
    return sameNum.length === 1 ? sameNum[0].id : '';
  }
  return '';
}
