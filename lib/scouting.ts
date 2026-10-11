/**
 * Batter scouting: turns a batter's stored pitches into the History &
 * Tendencies read-outs (heat map, Game Plan cards, 1st/2nd pitch, damage).
 *
 * Conventions
 * - Strike-zone keys Z1–Z9 are the catcher's view (Z1 = high, 3B side).
 *   For a right-handed batter column 1 is inside; for a lefty it's outside.
 *   Ball-zone keys ("B-Low-Out") are already batter-relative.
 * - Everything is drawn for one handedness (`gridHand`, his usual side);
 *   pitches he saw from the other side are mirrored so inside stays inside.
 * - "We win" on a pitch = called strike, swing and miss, foul, or an out on a
 *   ball in play. Damage = total bases on hits (errors are not his doing).
 * - Recommendations need a minimum number of pitches so one lucky pitch
 *   never drives a call; counts are always shown next to percentages.
 */

export interface ScoutPitch {
  gameId?: string;
  timestamp?: string;
  batterHand?: string;
  pitchType?: string;
  pitchZone?: string;
  pitchLocation?: string;
  action?: string;
  outcome?: string;
  hitResult?: string;
  hitZone?: string;
  atBatNumber?: number | string;
  pitchNumber?: number | string;
  ballsBefore?: number | string;
  strikesBefore?: number | string;
}

export type Hand = 'R' | 'L';
export type Dir = 'High' | 'Low' | 'In' | 'Out';

export const STRIKE_ZONES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7', 'Z8', 'Z9'];
const BASES: Record<string, number> = { single: 1, double: 2, triple: 3, 'home-run': 4 };
export const HIT_RESULTS = Object.keys(BASES);

/** Minimum pitches before a zone / pitch / direction can be recommended. */
export const MIN_ZONE = 3;
export const MIN_PITCH = 3;

// ── One pitch ───────────────────────────────────────────────────────────────

export interface PitchClass {
  swing: boolean;
  whiff: boolean;
  foul: boolean;
  calledStrike: boolean;
  takenBall: boolean;
  inPlay: boolean;
  hit: boolean;
  bases: number;
  inPlayOut: boolean;
  /** Called strike, whiff, foul, or an out in play. */
  win: boolean;
  strikeout: boolean;
}

export function classify(p: ScoutPitch): PitchClass {
  const o = p.outcome ?? '';
  const swing = (p.action ?? '').toLowerCase() === 'swing';
  const inPlay = o === 'in-play';
  const hr = (p.hitResult ?? '').trim();
  const bases = inPlay ? BASES[hr] ?? 0 : 0;
  const foul = swing && (o === 'foul' || o === 'foul-tip');
  const whiff = swing && (o === 'swinging-strike' || o === 'strikeout');
  const calledStrike = !swing && (o === 'called-strike' || o === 'strikeout');
  const takenBall = !swing && (o === 'ball' || o === 'walk' || o === 'hit-by-pitch');
  const inPlayOut = inPlay && hr === 'out';
  return {
    swing, whiff, foul, calledStrike, takenBall, inPlay,
    hit: bases > 0, bases, inPlayOut,
    win: calledStrike || whiff || foul || inPlayOut,
    strikeout: o === 'strikeout',
  };
}

// ── Locations ───────────────────────────────────────────────────────────────

export function handOf(v?: string): Hand | null {
  return v === 'L' || v === 'R' ? v : null;
}

/** "Left"/"Right" labels (hand unknown when recorded) → batter-relative In/Out. */
function ballKeyFor(loc: string, hand: Hand): string {
  const ins = hand === 'R' ? 'In' : 'Out';
  const outs = hand === 'R' ? 'Out' : 'In';
  return loc
    .replace('Left', ins)
    .replace('Right', outs)
    .replace(/-L$/, `-${ins}`)
    .replace(/-R$/, `-${outs}`);
}

const MIRROR: Record<string, string> = { Z1: 'Z3', Z3: 'Z1', Z4: 'Z6', Z6: 'Z4', Z7: 'Z9', Z9: 'Z7' };

/**
 * The location key to draw this pitch at on a `gridHand` chart. Strike zones
 * seen from the other side of the plate are mirrored so inside stays inside.
 */
export function locationKey(raw: string | undefined, pitchHand: Hand | null, gridHand: Hand): string {
  const loc = (raw ?? '').trim();
  if (!loc) return '';
  if (loc.startsWith('B-')) return ballKeyFor(loc, pitchHand ?? gridHand);
  if (pitchHand && pitchHand !== gridHand) return MIRROR[loc] ?? loc;
  return loc;
}

const Z_NAMES_R: Record<string, string> = {
  Z1: 'Up-In', Z2: 'Up-Middle', Z3: 'Up-Away',
  Z4: 'Middle-In', Z5: 'Middle', Z6: 'Middle-Away',
  Z7: 'Down-In', Z8: 'Down-Middle', Z9: 'Down-Away',
};
const Z_NAMES_L: Record<string, string> = {
  Z1: 'Up-Away', Z2: 'Up-Middle', Z3: 'Up-In',
  Z4: 'Middle-Away', Z5: 'Middle', Z6: 'Middle-In',
  Z7: 'Down-Away', Z8: 'Down-Middle', Z9: 'Down-In',
};

/** Plain-English name for any location key, for this batter's side. */
export function zoneName(key: string, gridHand: Hand): string {
  if (key.startsWith('Z')) return (gridHand === 'R' ? Z_NAMES_R : Z_NAMES_L)[key] ?? key;
  const parts = key.replace(/^B-/, '').split('-')
    .map(w => ({ Up: 'High', Low: 'Low', In: 'In', Out: 'Away', Hi: 'High', Lo: 'Low' } as Record<string, string>)[w] ?? w);
  // "In-Hi" → "High & In"; "Low-Out" → "Low & Away"
  const order = (w: string) => (w === 'High' || w === 'Low' ? 0 : 1);
  parts.sort((a, b) => order(a) - order(b));
  return `${parts.join(' & ')} (ball)`;
}

/** Which directions a location sits in, for chase and damage by direction. */
export function directionsOf(key: string, gridHand: Hand): Dir[] {
  const out: Dir[] = [];
  if (key.startsWith('B-')) {
    const parts = key.slice(2).split('-');
    if (parts.includes('Up') || parts.includes('Hi')) out.push('High');
    if (parts.includes('Low') || parts.includes('Lo')) out.push('Low');
    if (parts.includes('In')) out.push('In');
    if (parts.includes('Out')) out.push('Out');
    return out;
  }
  const n = Number(key.slice(1));
  if (n >= 1 && n <= 3) out.push('High');
  if (n >= 7) out.push('Low');
  const col = (n - 1) % 3; // 0 = 3B side
  if (col === 0) out.push(gridHand === 'R' ? 'In' : 'Out');
  if (col === 2) out.push(gridHand === 'R' ? 'Out' : 'In');
  return out;
}

// ── Aggregates ──────────────────────────────────────────────────────────────

export interface Tally {
  total: number; swings: number; whiffs: number; fouls: number; called: number;
  takenBalls: number; inPlay: number; hits: number; bases: number; inPlayOuts: number; wins: number; ks: number;
  hitResults: Record<string, number>;
}

function emptyTally(): Tally {
  return { total: 0, swings: 0, whiffs: 0, fouls: 0, called: 0, takenBalls: 0, inPlay: 0, hits: 0, bases: 0, inPlayOuts: 0, wins: 0, ks: 0, hitResults: {} };
}

function add(t: Tally, c: PitchClass, hitResult?: string) {
  t.total++;
  if (c.swing) t.swings++;
  if (c.whiff) t.whiffs++;
  if (c.foul) t.fouls++;
  if (c.calledStrike) t.called++;
  if (c.takenBall) t.takenBalls++;
  if (c.inPlay) t.inPlay++;
  if (c.hit) { t.hits++; t.bases += c.bases; t.hitResults[hitResult!] = (t.hitResults[hitResult!] ?? 0) + 1; }
  if (c.inPlayOut) t.inPlayOuts++;
  if (c.win) t.wins++;
  if (c.strikeout) t.ks++;
}

export interface ZoneStat extends Tally {
  byType: Record<string, Tally>;
  /** Where his balls in play went, per pitch type. */
  hitZones: Record<string, Record<string, number>>;
}

export type CellVerdict = 'win' | 'damage' | 'takes' | 'none';

/**
 * The heat-map colour for a zone: does the pitcher win there, does he hurt
 * us there, or does he just take balls there? Each base of damage weighs
 * like one pitcher win: a homer outweighs three fouls, but one double in a
 * zone where he's otherwise 0-for-3 stays green.
 */
export function cellVerdict(z: Tally | undefined): CellVerdict {
  if (!z || z.total === 0) return 'none';
  const damage = z.bases;
  if (damage > 0 && damage >= z.wins && damage >= z.takenBalls) return 'damage';
  if (z.wins >= z.takenBalls && z.wins > 0) return 'win';
  if (z.takenBalls > 0) return 'takes';
  return damage > 0 ? 'damage' : 'none';
}

/** Pitcher's edge in a zone: share of pitches won, minus damage per pitch. */
function edge(t: Tally): number {
  return t.total ? (t.wins - t.bases * 1.5) / t.total : 0;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export interface Recommendation {
  key: string;
  name: string;
  detail: string;
  sample: number;
  bestPitch?: { type: string; detail: string };
}

export interface CountRead {
  label: string;
  atBats: number;
  swingPct: number;
  swings: number;
  advice: string;
  tone: 'attack' | 'careful' | 'neutral';
  strikeGetter?: { type: string; zone: string; detail: string };
  recent: ScoutPitch[];
}

export interface DamageCell {
  key: string;
  hits: number;
  bip: number;
  bases: number;
  rows: { type: string; results: Record<string, number>; topSpot: string | null }[];
}

export interface BatterReport {
  gridHand: Hand;
  total: number;
  games: number;
  zones: Record<string, ZoneStat>;
  summary: { swingPct: number; chasePct: number; whiffPct: number; hits: number; atBats: number };
  pitchHere: Recommendation | null;
  putAway: Recommendation | null;
  chase: (Recommendation & { disciplined?: boolean }) | null;
  danger: Recommendation | null;
  first: CountRead;
  second: CountRead;
  damage: { zones: Record<string, DamageCell>; outOfZone: { hits: number; bip: number; byDir: Partial<Record<Dir, number>> } };
}

function bestOf<T>(items: T[], score: (t: T) => number, tie: (t: T) => number): T | null {
  let best: T | null = null;
  for (const it of items) {
    if (!best || score(it) > score(best) || (score(it) === score(best) && tie(it) > tie(best))) best = it;
  }
  return best;
}

function resultLine(r: Record<string, number>): string {
  const L: Record<string, string> = { single: '1B', double: '2B', triple: '3B', 'home-run': 'HR' };
  return HIT_RESULTS.slice().reverse().filter(k => r[k]).map(k => `${r[k] > 1 ? `${r[k]} ` : ''}${L[k]}`).join(', ');
}

/** Strike-getter for a set of pitches: type + spot with best strike/out rate (min 2). */
function strikeGetter(rows: { p: ScoutPitch; c: PitchClass; key: string }[], gridHand: Hand) {
  const m = new Map<string, { type: string; key: string; n: number; wins: number; bases: number }>();
  for (const r of rows) {
    const type = (r.p.pitchType ?? '').toUpperCase();
    if (!type || !r.key) continue;
    const k = `${type}|${r.key}`;
    const e = m.get(k) ?? { type, key: r.key, n: 0, wins: 0, bases: 0 };
    e.n++; if (r.c.win) e.wins++; e.bases += r.c.bases;
    m.set(k, e);
  }
  const best = bestOf([...m.values()].filter(e => e.n >= 2 && e.bases === 0 && e.wins > 0), e => e.wins / e.n, e => e.n);
  if (!best) return undefined;
  return { type: best.type, zone: zoneName(best.key, gridHand), detail: `${best.wins} of ${best.n} for strikes/outs` };
}

function countRead(label: string, rows: { p: ScoutPitch; c: PitchClass; key: string }[], gridHand: Hand): CountRead {
  const n = rows.length;
  const swings = rows.filter(r => r.c.swing).length;
  const whiffs = rows.filter(r => r.c.whiff).length;
  const hits = rows.filter(r => r.c.hit);
  const swingPct = pct(swings, n);
  const getter = strikeGetter(rows, gridHand);
  let advice: string;
  let tone: CountRead['tone'] = 'neutral';
  if (n < 3) {
    advice = 'Too few at-bats to call yet';
  } else if (swingPct <= 30) {
    advice = 'Usually takes — throw a strike';
    tone = 'attack';
  } else if (hits.length > 0 && hits.length >= whiffs) {
    advice = `Ambushes it (${hits.length} hit${hits.length === 1 ? '' : 's'}) — start off-speed or off the plate`;
    tone = 'careful';
  } else if (swingPct >= 50 && whiffs >= 2) {
    advice = 'Swings early and misses — attack him';
    tone = 'attack';
  } else if (swingPct >= 50) {
    advice = 'Aggressive — don\'t give him a fat one; work the edges';
    tone = 'careful';
  } else {
    advice = 'Mixed — no strong pattern';
  }
  const recent = [...rows]
    .sort((a, b) => String(b.p.timestamp ?? '').localeCompare(String(a.p.timestamp ?? '')))
    .slice(0, 5)
    .map(r => r.p);
  return { label, atBats: n, swingPct, swings, advice, tone, strikeGetter: getter, recent };
}

/** Builds the full read-out. `preferHand` (today's side) wins over his usual side when given. */
export function analyzeBatter(pitches: ScoutPitch[], preferHand?: Hand | null): BatterReport {
  let r = 0, l = 0;
  for (const p of pitches) { const h = handOf(p.batterHand); if (h === 'R') r++; else if (h === 'L') l++; }
  const gridHand: Hand = preferHand ?? (l > r ? 'L' : 'R');

  const rows = pitches.map(p => {
    const c = classify(p);
    const key = locationKey(p.pitchLocation, handOf(p.batterHand), gridHand);
    return { p, c, key };
  });

  // Zones
  const zones: Record<string, ZoneStat> = {};
  for (const { p, c, key } of rows) {
    if (!key) continue;
    const z = zones[key] ??= { ...emptyTally(), byType: {}, hitZones: {} };
    add(z, c, p.hitResult);
    const type = (p.pitchType ?? '').toUpperCase() || '?';
    add(z.byType[type] ??= emptyTally(), c, p.hitResult);
    if (c.inPlay && p.hitZone) {
      const hz = z.hitZones[type] ??= {};
      hz[p.hitZone] = (hz[p.hitZone] ?? 0) + 1;
    }
  }

  // Summary
  const all = emptyTally();
  let outOfZone = 0, chases = 0, strikeouts = 0;
  for (const { p, c } of rows) {
    add(all, c, p.hitResult);
    if (p.pitchZone === 'Ball') { outOfZone++; if (c.swing) chases++; }
    if (c.strikeout) strikeouts++;
  }
  const atBats = all.hits + all.inPlayOuts + strikeouts
    + rows.filter(r => r.c.inPlay && (r.p.hitResult ?? '') === 'error').length;

  // 🎯 Pitch Here: best pitcher edge in the strike zone, no extra-base hits allowed there.
  const zoneCands = STRIKE_ZONES.map(k => ({ k, z: zones[k] }))
    .filter(({ z }) => z && z.total >= MIN_ZONE && !Object.keys(z.hitResults).some(h => (BASES[h] ?? 0) >= 2));
  const here = bestOf(zoneCands, ({ z }) => edge(z!), ({ z }) => z!.total);
  let pitchHere: Recommendation | null = null;
  if (here && edge(here.z!) > 0) {
    const z = here.z!;
    const types = Object.entries(z.byType).filter(([, t]) => t.total >= 2 && t.bases === 0);
    const bt = bestOf(types, ([, t]) => edge(t), ([, t]) => t.total);
    pitchHere = {
      key: here.k, name: zoneName(here.k, gridHand), sample: z.total,
      detail: `${z.wins} of ${z.total} strikes/outs · ${z.hits ? `${z.hits} hit${z.hits === 1 ? '' : 's'}` : 'no hits'}`,
      bestPitch: bt ? { type: bt[0], detail: `${bt[1].wins} of ${bt[1].total}` } : undefined,
    };
  }

  // ⚡ Put-away: with two strikes, which pitch finishes him; else best miss rate on swings.
  const byTypeTwo: Record<string, { n: number; k: number; whiffs: number }> = {};
  const byTypeSwing: Record<string, { sw: number; wh: number }> = {};
  for (const { p, c } of rows) {
    const t = (p.pitchType ?? '').toUpperCase();
    if (!t) continue;
    if (Number(p.strikesBefore) === 2) {
      const e = byTypeTwo[t] ??= { n: 0, k: 0, whiffs: 0 };
      e.n++; if (c.strikeout) e.k++; if (c.whiff) e.whiffs++;
    }
    if (c.swing) { const e = byTypeSwing[t] ??= { sw: 0, wh: 0 }; e.sw++; if (c.whiff) e.wh++; }
  }
  let putAway: Recommendation | null = null;
  const two = bestOf(Object.entries(byTypeTwo).filter(([, e]) => e.n >= MIN_PITCH && e.k > 0), ([, e]) => e.k / e.n, ([, e]) => e.n);
  const sw = bestOf(Object.entries(byTypeSwing).filter(([, e]) => e.sw >= MIN_PITCH && e.wh > 0), ([, e]) => e.wh / e.sw, ([, e]) => e.sw);
  const putType = two?.[0] ?? sw?.[0];
  if (putType) {
    // Best spot for it: where that pitch gets the most strikeouts + whiffs (any location).
    const spots = Object.entries(zones)
      .map(([k, z]) => ({ k, t: z.byType[putType] }))
      .filter(({ t }) => t && t.whiffs + t.called > 0);
    const spot = bestOf(spots, ({ t }) => t!.ks * 2 + t!.whiffs + t!.called - t!.bases * 2, ({ t }) => t!.total);
    putAway = {
      key: putType, name: putType, sample: two ? two[1].n : sw![1].sw,
      detail: two
        ? `${two[1].k} K in ${two[1].n} two-strike pitches`
        : `misses ${sw![1].wh} of ${sw![1].sw} swings`,
      bestPitch: spot ? { type: putType, detail: zoneName(spot.k, gridHand) } : undefined,
    };
  }

  // 🎣 Chase: direction off the plate he swings at most (min 3 pitches there).
  const dirs: Record<Dir, { n: number; sw: number; wh: number; types: Record<string, number> }> = {
    High: { n: 0, sw: 0, wh: 0, types: {} }, Low: { n: 0, sw: 0, wh: 0, types: {} },
    In: { n: 0, sw: 0, wh: 0, types: {} }, Out: { n: 0, sw: 0, wh: 0, types: {} },
  };
  for (const { p, c, key } of rows) {
    if (!key.startsWith('B-')) continue;
    for (const d of directionsOf(key, gridHand)) {
      const e = dirs[d]; e.n++;
      if (c.swing) { e.sw++; const t = (p.pitchType ?? '').toUpperCase(); if (t) e.types[t] = (e.types[t] ?? 0) + 1; }
      if (c.whiff) e.wh++;
    }
  }
  const DIR_NAME: Record<Dir, string> = { High: 'Above the zone', Low: 'Below the zone', In: 'Inside, off plate', Out: 'Away, off plate' };
  const dirCands = (Object.entries(dirs) as [Dir, typeof dirs.High][]).filter(([, e]) => e.n >= MIN_PITCH);
  const cd = bestOf(dirCands, ([, e]) => e.sw / e.n, ([, e]) => e.n);
  let chase: BatterReport['chase'] = null;
  if (cd) {
    const [d, e] = cd;
    const rate = pct(e.sw, e.n);
    const topType = bestOf(Object.entries(e.types), ([, n]) => n, () => 0);
    chase = rate >= 25
      ? {
          key: d, name: DIR_NAME[d], sample: e.n,
          detail: `chased ${e.sw} of ${e.n} (${rate}%)${e.wh ? ` · ${e.wh} whiff${e.wh === 1 ? '' : 's'}` : ''}`,
          bestPitch: topType ? { type: topType[0], detail: `${topType[1]} chase${topType[1] === 1 ? '' : 's'}` } : undefined,
        }
      : { key: d, name: 'Disciplined', sample: outOfZone, detail: `chases only ${pct(chases, outOfZone)}% off the plate — make him swing at strikes`, disciplined: true };
  }

  // 🚨 Danger: where his hits come from (any location), by bases per pitch.
  const dangerCands = Object.entries(zones).filter(([, z]) => z.hits > 0);
  const dz = bestOf(dangerCands, ([, z]) => z.bases / z.total, ([, z]) => z.bases);
  let danger: Recommendation | null = null;
  if (dz) {
    const [k, z] = dz;
    const avoid = bestOf(Object.entries(z.byType).filter(([, t]) => t.hits > 0), ([, t]) => t.bases, ([, t]) => t.hits);
    danger = {
      key: k, name: zoneName(k, gridHand), sample: z.total,
      detail: `${resultLine(z.hitResults)} in ${z.total} pitch${z.total === 1 ? '' : 'es'}`,
      bestPitch: avoid ? { type: avoid[0], detail: resultLine(avoid[1].hitResults) } : undefined,
    };
  }

  // 1st / 2nd pitch of each at-bat (an at-bat = game + at-bat number).
  const abs = new Map<string, typeof rows>();
  for (const row of rows) {
    const k = `${row.p.gameId ?? ''}|${row.p.atBatNumber ?? ''}`;
    if (!abs.has(k)) abs.set(k, []);
    abs.get(k)!.push(row);
  }
  const firsts: typeof rows = [], seconds: typeof rows = [];
  for (const ab of abs.values()) {
    ab.sort((a, b) => (Number(a.p.pitchNumber) || 0) - (Number(b.p.pitchNumber) || 0));
    if (ab[0]) firsts.push(ab[0]);
    if (ab[1]) seconds.push(ab[1]);
  }

  // Where he does damage: hits / balls in play per strike zone, plus off the plate.
  const damageZones: Record<string, DamageCell> = {};
  for (const k of STRIKE_ZONES) {
    const z = zones[k];
    if (!z || z.inPlay === 0) continue;
    damageZones[k] = {
      key: k, hits: z.hits, bip: z.inPlay, bases: z.bases,
      rows: Object.entries(z.byType)
        .filter(([, t]) => t.hits > 0)
        .sort((a, b) => b[1].bases - a[1].bases)
        .slice(0, 3)
        .map(([type, t]) => {
          const hz = z.hitZones[type] ?? {};
          const top = Object.entries(hz).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          return { type, results: t.hitResults, topSpot: top };
        }),
    };
  }
  let ozHits = 0, ozBip = 0;
  const byDir: Partial<Record<Dir, number>> = {};
  for (const { c, key } of rows) {
    if (!key.startsWith('B-') || !c.inPlay) continue;
    ozBip++;
    if (c.hit) { ozHits++; for (const d of directionsOf(key, gridHand)) byDir[d] = (byDir[d] ?? 0) + 1; }
  }

  return {
    gridHand,
    total: pitches.length,
    games: new Set(pitches.map(p => p.gameId).filter(Boolean)).size,
    zones,
    summary: {
      swingPct: pct(all.swings, all.total),
      chasePct: pct(chases, outOfZone),
      whiffPct: pct(all.whiffs, all.swings),
      hits: all.hits,
      atBats,
    },
    pitchHere, putAway, chase, danger,
    first: countRead('1st Pitch', firsts, gridHand),
    second: countRead('2nd Pitch', seconds, gridHand),
    damage: { zones: damageZones, outOfZone: { hits: ozHits, bip: ozBip, byDir } },
  };
}
