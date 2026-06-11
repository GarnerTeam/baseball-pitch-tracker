import { PitchLocation, SwingResult, ContactType, PitchOutcome, AtBat } from '@/types';

/**
 * Determines the outcome of a pitch based on all inputs + current count.
 * Applies full baseball rules including foul ball and foul tip logic.
 */
export function determinePitchOutcome(
  location: PitchLocation,
  swing: SwingResult,
  contact: ContactType,
  currentBalls: number,
  currentStrikes: number
): PitchOutcome {
  // Ball in play — takes top priority
  if (contact === 'in-play') return 'in-play';

  // Foul tip caught — always a strike; strikeout if 3rd strike
  if (contact === 'foul-tip') {
    return currentStrikes >= 2 ? 'strikeout' : 'foul-tip';
  }

  // Foul ball — strike only if < 2 strikes; never causes a strikeout
  if (contact === 'foul') {
    return 'foul';
  }

  // Swing and miss
  if (swing === 'swing') {
    return currentStrikes >= 2 ? 'strikeout' : 'swinging-strike';
  }

  // No swing — location determines ball vs strike
  if (location.zone === 'strike') {
    return currentStrikes >= 2 ? 'strikeout' : 'called-strike';
  }

  // No swing, outside zone — ball or walk
  return currentBalls >= 3 ? 'walk' : 'ball';
}

/**
 * Computes the new ball/strike count after an outcome.
 * Foul ball at 2 strikes does NOT add a strike.
 */
export function updateCount(
  currentBalls: number,
  currentStrikes: number,
  outcome: PitchOutcome
): { balls: number; strikes: number } {
  switch (outcome) {
    case 'ball':
      return { balls: currentBalls + 1, strikes: currentStrikes };
    case 'walk':
      return { balls: 4, strikes: currentStrikes };
    case 'called-strike':
    case 'swinging-strike':
    case 'foul-tip':
      return { balls: currentBalls, strikes: currentStrikes + 1 };
    case 'strikeout':
      return { balls: currentBalls, strikes: 3 };
    case 'foul':
      // Only advances if < 2 strikes
      return currentStrikes < 2
        ? { balls: currentBalls, strikes: currentStrikes + 1 }
        : { balls: currentBalls, strikes: currentStrikes };
    case 'in-play':
      return { balls: currentBalls, strikes: currentStrikes };
    default:
      return { balls: currentBalls, strikes: currentStrikes };
  }
}

export function isAtBatComplete(outcome: PitchOutcome): boolean {
  return outcome === 'walk' || outcome === 'strikeout' || outcome === 'in-play';
}

export function getAtBatResult(
  outcome: PitchOutcome
): AtBat['result'] | undefined {
  if (outcome === 'walk') return 'walk';
  if (outcome === 'strikeout') return 'strikeout';
  if (outcome === 'in-play') return 'in-play';
  return undefined;
}

export function getOutcomeLabel(outcome: PitchOutcome): string {
  const labels: Record<PitchOutcome, string> = {
    ball: 'Ball',
    'called-strike': 'Called Strike',
    'swinging-strike': 'Swinging Strike',
    foul: 'Foul Ball',
    'foul-tip': 'Foul Tip',
    'in-play': 'Ball in Play',
    walk: 'WALK!',
    strikeout: 'STRIKEOUT!',
  };
  return labels[outcome] ?? outcome;
}

export function getPreviousAtBatsForBatter(
  allAtBats: AtBat[],
  batterIndex: number,
  excludeAtBatId?: string
): AtBat[] {
  return allAtBats.filter(
    (ab) =>
      ab.batterIndex === batterIndex &&
      ab.isComplete &&
      ab.id !== excludeAtBatId
  );
}
