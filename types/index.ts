export type PitchType = 'FB' | 'CH' | 'CB' | 'SL';

export const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  FB: 'Fastball', CH: 'Changeup', CB: 'Curveball', SL: 'Slider',
};

export const PITCH_TYPE_COLORS: Record<PitchType, string> = {
  FB: '#ef4444', CH: '#f97316', CB: '#22c55e', SL: '#8b5cf6',
};

export type SwingResult = 'swing' | 'no-swing';
export type ContactType = 'foul' | 'foul-tip' | 'in-play' | null;

export type PitchOutcome =
  | 'ball'
  | 'called-strike'
  | 'swinging-strike'
  | 'foul'
  | 'foul-tip'
  | 'in-play'
  | 'walk'
  | 'strikeout';

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
}

export interface AtBat {
  id: string;
  batterIndex: number;
  playerId?: string;        // ties at-bat to player ID, not just lineup position
  atBatNumber: number;
  pitches: PitchRecord[];
  balls: number;
  strikes: number;
  result?: 'walk' | 'strikeout' | 'in-play' | 'manual-end';
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
