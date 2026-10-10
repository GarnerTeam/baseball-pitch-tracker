/**
 * Decides which recorded batters are the same real player.
 *
 * The coach's rule, in order: last name, then first name, then jersey
 * number, then team. Concretely, two records are the same player when
 *
 *   1. their last names match (case-insensitive; an initial like "G"
 *      matches "Gordon" only when the first names match fully), and
 *   2. their first names don't conflict (equal, one missing, or one is the
 *      other's initial), and
 *   3. either both have the SAME jersey number — then team doesn't matter,
 *      because kids play for more than one team — or one has no number and
 *      they played for the same team.
 *
 * Two different numbers are never merged automatically; the coach can
 * still merge those on the Player Profile screen.
 */

export interface NameParts { first: string; last: string }

/** Splits names as coaches type them: "Petronio", "C Brauer", "Bryce G", "Vinny Frick". */
export function parseName(raw: string): NameParts {
  const tokens = raw.replace(/[.,]/g, ' ').trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: '', last: tokens[0] };
  if (tokens[0].length === 1) return { first: tokens[0], last: tokens.slice(1).join(' ') };
  if (tokens[tokens.length - 1].length === 1) return { first: tokens.slice(0, -1).join(' '), last: tokens[tokens.length - 1] };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

function initialMatch(a: string, b: string): boolean {
  return (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
}

export function firstNamesCompatible(a: string, b: string): boolean {
  return !a || !b || a === b || initialMatch(a, b);
}

export function lastNamesCompatible(a: NameParts, b: NameParts): boolean {
  if (a.last === b.last) return true;
  // "Bryce G" vs "Bryce Gordon": a last initial only counts when the first
  // names are present and identical.
  return initialMatch(a.last, b.last) && !!a.first && a.first === b.first && a.first.length > 1;
}

/** A placeholder like "U" or "B" with no number — not a real player record. */
export function isPlaceholder(name: string, number: string): boolean {
  return !number.trim() && name.replace(/[^a-z]/gi, '').length <= 1;
}

export interface BatterRecord {
  key: string;          // stable id for this (name, number, team) group
  name: string;
  number: string;
  team: string;
  pitchCount: number;
}

export interface KnownPlayer { id: string; name: string; number: string; teams: string[] }

export interface PlayerCluster {
  /** Existing player these records join, or '' for a new player. */
  playerId: string;
  name: string;
  number: string;
  teams: string[];
  members: BatterRecord[];
  /** Matched on number alone across different teams — worth a glance. */
  crossTeam: boolean;
  /** Joined a record that had no number to one that did (same team). */
  fillsMissingNumber: boolean;
}

function fuller(a: string, b: string): string {
  const pa = parseName(a), pb = parseName(b);
  const score = (p: NameParts) => p.first.length + p.last.length;
  return score(pb) > score(pa) ? b : a;
}

function sameTeam(a: string[], b: string[]): boolean {
  const set = new Set(a.map(t => t.trim().toLowerCase()).filter(Boolean));
  return b.some(t => set.has(t.trim().toLowerCase()));
}

/**
 * Groups batter records into players. Existing players are matched first;
 * numbered records are placed before records with no number, so a blank
 * number can only join a player whose number is already known.
 */
export function clusterBatters(records: BatterRecord[], known: KnownPlayer[] = []): {
  clusters: PlayerCluster[];
  skipped: BatterRecord[];
} {
  const clusters: PlayerCluster[] = known.map(k => ({
    playerId: k.id, name: k.name, number: k.number.trim(), teams: [...k.teams],
    members: [], crossTeam: false, fillsMissingNumber: false,
  }));
  const skipped: BatterRecord[] = [];
  const ordered = [...records].sort((a, b) =>
    (a.number.trim() ? 0 : 1) - (b.number.trim() ? 0 : 1) || b.pitchCount - a.pitchCount || a.key.localeCompare(b.key));

  for (const r of ordered) {
    if (isPlaceholder(r.name, r.number)) { skipped.push(r); continue; }
    const p = parseName(r.name);
    const num = r.number.trim();
    let match: PlayerCluster | undefined;
    for (const c of clusters) {
      const cp = parseName(c.name);
      if (!lastNamesCompatible(p, cp) || !firstNamesCompatible(p.first, cp.first)) continue;
      const cNum = c.number.trim();
      if (num && cNum) {
        if (num !== cNum) continue;
        match = c;
        if (!sameTeam(c.teams, [r.team]) && c.teams.length > 0) c.crossTeam = true;
        break;
      }
      // One side has no number: only the same team counts.
      if (sameTeam(c.teams, [r.team])) {
        match = c;
        if (!num || !cNum) c.fillsMissingNumber = c.fillsMissingNumber || (!!num !== !!cNum);
        break;
      }
    }
    if (!match) {
      match = { playerId: '', name: r.name, number: num, teams: [], members: [], crossTeam: false, fillsMissingNumber: false };
      clusters.push(match);
    } else {
      match.name = fuller(match.name, r.name);
      if (!match.number && num) match.number = num;
    }
    match.members.push(r);
    if (r.team && !match.teams.some(t => t.toLowerCase() === r.team.toLowerCase())) match.teams.push(r.team);
  }
  return { clusters: clusters.filter(c => c.members.length > 0), skipped };
}
