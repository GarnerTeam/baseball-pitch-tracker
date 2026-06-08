export type PitchType = 'FB' | 'CH' | 'CB' | 'SL';

export const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  FB: 'Fastball',
  CH: 'Changeup',
  CB: 'Curveball',
  SL: 'Slider',
};

export const PITCH_TYPE_COLORS: Record<PitchType, string> = {
  FB: '#ef4444',
  CH: '#f97316',
  CB: '#22c55e',
  SL: '#8b5cf6',
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
  row: number; // 0-4 in 5x5 grid
  col: number; // 0-4
  zone: 'strike' | 'ball';
  zoneNumber?: number; // 1-9 for strike zone cells
}

export interface HitData {
  x: number; // 0-100 percentage on field SVG
  y: number;
  type: HitType;
  result: HitResult;
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
  hitData?: HitData;
}

export interface AtBat {
  id: string;
  batterIndex: number;
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
}

export interface PendingPitch {
  pitchType: PitchType | null;
  location: PitchLocation | null;
  swing: SwingResult | null;
  contact: ContactType;
}

export interface GameState {
  id: string;
  phase: 'setup' | 'pitching' | 'hit-mode';
  pitcher: Player;
  lineup: Player[];
  currentBatterIndex: number;
  currentAtBat: AtBat | null;
  allAtBats: AtBat[];
  pendingPitch: PendingPitch;
  overlayEnabled: boolean;
  overlayFilter: PitchType | 'all';
  activeTab: 'pitch' | 'lineup' | 'analytics' | 'log';
  notification: {
    message: string;
    type: 'walk' | 'strikeout' | 'info' | 'error';
  } | null;
  sheetsWebhookUrl: string;
  syncQueue: PitchRecord[];
}
