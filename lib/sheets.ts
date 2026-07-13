'use client';
import { PitchRecord } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Map ball-zone row/col + batter hand to a readable label (mirrors component logic). */
function ballLocationLabel(row: number, col: number, hand?: 'L' | 'R' | null): string {
  const v = row === 0 ? 'Up' : row === 4 ? 'Low' : '';
  const getH = (c: number) => {
    if (c === 0) return hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'Left';
    if (c === 4) return hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'Right';
    return '';
  };
  const h = getH(col);
  if (v && h) return `${v}-${h}`;
  if (v) {
    if (col === 1) return `${v}-${hand === 'R' ? 'In' : hand === 'L' ? 'Out' : 'L'}`;
    if (col === 3) return `${v}-${hand === 'R' ? 'Out' : hand === 'L' ? 'In' : 'R'}`;
    return v;
  }
  if (h) {
    if (row === 1) return `${h}-Hi`;
    if (row === 3) return `${h}-Lo`;
    return h;
  }
  return 'Ball';
}

const HIT_TYPE_NAME: Record<string, string> = {
  'ground-ball': 'Ground Ball', 'line-drive': 'Line Drive',
  'fly-ball': 'Fly Ball',       'pop-up': 'Pop Up',
};
const HIT_RESULT_NAME: Record<string, string> = {
  out: 'Out', error: 'Error', single: '1B', double: '2B', triple: '3B', 'home-run': 'HR',
};


function baseStateLabel(bs?: { first: boolean; second: boolean; third: boolean }): string {
  if (!bs) return 'Empty';
  const { first, second, third } = bs;
  if (first && second && third) return 'Loaded';
  const parts: string[] = [];
  if (third) parts.push('3B');
  if (second) parts.push('2B');
  if (first) parts.push('1B');
  return parts.length ? parts.join('+') : 'Empty';
}

/**
 * Flatten a PitchRecord into a spreadsheet-friendly row object.
 *
 * Column order (for Apps Script reference):
 *   gameId | timestamp | pitcherNumber | pitcherName
 *   batterNumber | batterName | batterHand | lineupPosition | atBatNumber | pitchNumber
 *   ballsBefore | strikesBefore | pitchType | pitchZone | pitchLocation | action
 *   outcome | ballsAfter | strikesAfter
 *   hitType | hitTypeName | hitResult | hitResultName | hitZone | hitX | hitY
 *   runner1B | runner2B | runner3B | outsCount | baseState | homeTeam | visitingTeam
 */
function flattenPitch(p: PitchRecord) {
  const pitchZone = p.location?.zone === 'strike' ? 'Strike' : 'Ball';
  const pitchLocation = p.location
    ? p.location.zone === 'strike'
      ? `Z${p.location.zoneNumber ?? ''}`
      : `B-${ballLocationLabel(p.location.row, p.location.col, p.batterHand)}`
    : '';

  return {
    gameId:          p.gameId,
    timestamp:       p.timestamp,
    pitcherNumber:   p.pitcherNumber,
    pitcherName:     p.pitcherName,
    batterNumber:    p.batterNumber,
    batterName:      p.batterName,
    batterHand:      p.batterHand ?? '',
    lineupPosition:  p.lineupPosition + 1,
    atBatNumber:     p.atBatNumber,
    pitchNumber:     p.pitchNumber,
    ballsBefore:     p.ballsBefore,
    strikesBefore:   p.strikesBefore,
    pitchType:       p.pitchType,
    pitchZone,
    pitchLocation,
    action:          p.swing ? 'Swing' : 'Look',
    outcome:         p.outcome,
    ballsAfter:      p.ballsAfter,
    strikesAfter:    p.strikesAfter,
    hitType:         p.hitData?.type         ?? '',
    hitTypeName:     HIT_TYPE_NAME[p.hitData?.type ?? '']     ?? '',
    hitResult:       p.hitData?.result       ?? '',
    hitResultName:   HIT_RESULT_NAME[p.hitData?.result ?? ''] ?? '',
    hitZone:         p.hitData?.zone         ?? '',
    hitX:            p.hitData?.x            ?? '',
    hitY:            p.hitData?.y            ?? '',
    runner1B:        p.baseState?.first  ? 'Yes' : 'No',
    runner2B:        p.baseState?.second ? 'Yes' : 'No',
    runner3B:        p.baseState?.third  ? 'Yes' : 'No',
    outsCount:       p.outsCount ?? 0,
    baseState:       baseStateLabel(p.baseState),
    homeTeam:        p.homeTeam        ?? '',
    visitingTeam:    p.visitingTeam    ?? '',
    id:              p.id,
    isEdit:          p.isEdit          ?? false,
    rosterPlayerId:  p.rosterPlayerId   ?? '',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────────
export async function syncQueueToSheets(
  webhookUrl: string,
  queue: PitchRecord[]
): Promise<{ synced: number; error?: string; _urlTail?: string }> {
  if (!webhookUrl || queue.length === 0) return { synced: 0 };
  try {
    const flatRows = queue.map(flattenPitch);
    const res = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, pitches: flatRows }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { synced: 0, error: body.error ?? `HTTP ${res.status}` };
    }
    return { synced: queue.length, _urlTail: body._urlTail };
  } catch (err) {
    return { synced: 0, error: String(err) };
  }
}

export const DEFAULT_WEBHOOK_URL = process.env.NEXT_PUBLIC_SHEETS_WEBHOOK_URL ?? '';

// ── Game-state → PitchRow converter ───────────────────────────────────

/** Minimal shape matching BatterHistoryModal's PitchRow (all optional). */
export interface PitchRowLite {
  gameId?: string;
  timestamp?: string;
  batterName?: string;
  batterNumber?: string;
  batterHand?: string;
  pitchType?: string;
  pitchZone?: string;
  pitchLocation?: string;
  action?: string;
  outcome?: string;
  hitResult?: string;
  hitType?: string;
  hitX?: number | string;
  hitY?: number | string;
  atBatNumber?: number | string;
}

/**
 * Convert a game-state PitchRecord into the flat shape expected by
 * BatterHistoryModal (same field names as the Google Sheets API response).
 */
export function toPitchRowLite(p: PitchRecord): PitchRowLite {
  const f = flattenPitch(p);
  return {
    gameId:        f.gameId,
    timestamp:     f.timestamp,
    batterName:    f.batterName,
    batterNumber:  f.batterNumber,
    batterHand:    f.batterHand   || undefined,
    pitchType:     f.pitchType,
    pitchZone:     f.pitchZone,
    pitchLocation: f.pitchLocation,
    action:        f.action,
    outcome:       f.outcome,
    hitResult:     f.hitResult    || undefined,
    hitType:       f.hitType      || undefined,
    hitX:          f.hitX  !== '' ? f.hitX  : undefined,
    hitY:          f.hitY  !== '' ? f.hitY  : undefined,
    atBatNumber:   f.atBatNumber,
  };
}
