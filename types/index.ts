export type PitchType = 'FB' | 'CH' | 'CB' | 'SL';

export const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  FB: 'Fastball', CH: 'Changeup', CB: 'Curveball', SL: 'Slider',
};

export const PITCH_TYPE_COLORS: Record<PitchType, string> = {
  FB: '#ef4444', CH: '#f97316', CB: '#22c55e', SL: '#8b5cf6',
};

export type SwingResult = 'swing' | 'no-swing';
export type ContactType = 'foul' | 'foul-tip' | 'in-play' | 'dropped-third' | null;

export type PitchOutcome =
  | 'ball'
  | 'called-strike'
  | 'swinging-strike'
  | 'foul'
  | 'foul-tip'
  | 'in-play'
  | 'walk'
  | 'strikeout'
  | 'hit-by-pitch';

export type HitType = 'ground-ball' | 'line-drive' | 'fly-ball' | 'pop-up';
export type HitResult = 'out' | 'single' | 'double' | 'triple' | 'home-run' | 'error';

export interface PitchLocation {
  row: number;
  col: number;
  zone: 'strike' | 'ball';
  zoneNumber?: number;
}

export interface HitData {
  x: number;
  y: number;
  type: HitType;
  result: HitResult;
  zone?: string;
}


export interface BaseState {
  first: boolean;
  second: boolean;
  third: boolean;
}

export interface PitchRecord {
  id: string;
  gameId: string;
  timestamp: string;
  pitcherName: string;
  pitcherNumber: string;
  batterName: string;
  batterNumber: string;
  lineupPosition: number;
  atBatNumber: number;
  pitchNumber: number;
  ballsBefore: number;
  strikesBefore: number;
  ballsAfter: number;
  strikesAfter: number;
  pitchType: PitchType;
  location: PitchLocation;
  swing: boolean;
  outcome: PitchOutcome;
  batterHand?: 'L' | 'R' | null;
  hitData?: HitData;
  baseState?: BaseState;
  outsCount?: 0 | 1 | 2;
  homeTeam?: string;
  visitingTeam?: string;
  isEdit?: boolean;   // true when this pitch was edited post-recording and needs a sheet row update
  /** Stable identity from a Saved Roster (see lib/roster.ts) — set only when
   *  the batter was loaded from (or saved to) a roster, rather than typed in
   *  fresh for this game. When present, batter-history lookups match on this
   *  ID exclusively instead of name/number, which is what correctly tells
   *  apart siblings/same-name players and survives a guest player wearing a
   *  different jersey number in different games. */
  rosterPlayerId?: string;
  /** Canonical long-term identity from the Players database (see
   *  lib/players.ts), formatted "PLR0001". Set whenever the batter was
   *  selected from (or newly created via) the player-name autocomplete on
   *  the Lineup tab. This is the PRIMARY link for cross-game/cross-season/
   *  cross-team scouting history — it survives name misspellings, jersey
   *  number changes, and team changes, which batterName/batterNumber alone
   *  never could. Display text (batterName) is unaffected; this field only
   *  changes how history is looked up on the backend. */
  playerId?: string;
}

export interface AtBat {
  id: string;
  batterIndex: number;
  playerId?: string;        // ties at-bat to player ID, not just lineup position
  atBatNumber: number;
  pitches: PitchRecord[];
  balls: number;
  strikes: number;
  result?: 'walk' | 'strikeout' | 'in-play' | 'manual-end' | 'hit-by-pitch';
  isComplete: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface Player {
  id: string;
  name: string;
  number: string;
  hand?: 'L' | 'R' | null;
}

/**
 * A player saved to a reusable roster (see lib/roster.ts), keyed by team
 * name under the coach's account. `id` is permanent once created — reusing
 * a roster across multiple games this season always assigns the SAME id to
 * the same real player, regardless of what jersey number he wears that day
 * or minor name-entry differences. IDs are prefixed "roster-" so the app can
 * tell a roster-backed lineup slot apart from one typed in ad hoc.
 */
export interface RosterPlayer {
  id: string;
  name: string;
  number: string;
  hand: 'L' | 'R' | null;
}

/**
 * A player in the coach's persistent, cross-game/cross-season/cross-team
 * batter intelligence database (see lib/players.ts). Unlike RosterPlayer
 * (scoped to one opposing team's saved lineup), a PlayerRecord is global to
 * the coach's account — the same real player is recognized via autocomplete
 * whether he's seen next week, next season, or on an entirely different
 * team, as long as the coach picks him from the suggestion list instead of
 * retyping his name. `id` ("PLR0001" style) is permanent and backend-
 * generated; it is the authoritative link used for all scouting history,
 * tendencies, and career totals — never batterName.
 */
export interface PlayerRecord {
  id: string;
  name: string;
  number: string;
  hand: 'L' | 'R' | null;
  firstSeen: string;
  lastSeen: string;
  gamesSeen: number;
  pitchesSeen: number;
  notes: string;
  verified: boolean;
  isActive: boolean;
}


export interface PendingPitch {
  pitchType: PitchType | null;
  location: PitchLocation | null;
  swing: SwingResult | null;
  contact: ContactType;
}

export interface AtBatSnapshot {
  previousBatterIndex: number;
  completedAtBat: AtBat;
}

export interface GameState {
  id: string;
  phase: 'setup' | 'pitching' | 'hit-mode';
  homeTeam: string;
  visitingTeam: string;
  pitcher: Player;
  lineup: Player[];
  currentBatterIndex: number;
  currentAtBat: AtBat | null;
  allAtBats: AtBat[];
  pendingPitch: PendingPitch;
  overlayEnabled: boolean;
  overlayFilter: PitchType | 'all';
  activeTab: 'pitch' | 'lineup' | 'analytics' | 'log';
  batterHand: 'L' | 'R' | null;
  notification: {
    message: string;
    type: 'walk' | 'strikeout' | 'info' | 'error';
  } | null;
  baseState: BaseState;
  outsCount: 0 | 1 | 2;
  sheetsWebhookUrl: string;
  syncQueue: PitchRecord[];
  lastCompletedAtBatSnapshot?: AtBatSnapshot;
  pitcherHistory: Player[];   // pitchers used earlier in this game
}
