import { PitchRecord, PITCH_TYPE_LABELS } from '@/types';

export const SHEETS_HEADERS = [
  'Game ID',
  'Timestamp',
  'Pitcher Name',
  'Pitcher #',
  'Batter Name',
  'Batter #',
  'Lineup Position',
  'At-Bat #',
  'Pitch #',
  'Balls (Before)',
  'Strikes (Before)',
  'Pitch Type',
  'Pitch Location',
  'Swing',
  'Pitch Outcome',
  'Hit Type',
  'Hit Result',
  'Hit Coordinates',
];

function formatPitchAsRow(pitch: PitchRecord): string[] {
  const locLabel =
    pitch.location.zone === 'strike'
      ? `Zone ${pitch.location.zoneNumber}`
      : `Outside (R${pitch.location.row}C${pitch.location.col})`;

  return [
    pitch.gameId,
    pitch.timestamp,
    pitch.pitcherName,
    pitch.pitcherNumber,
    pitch.batterName,
    pitch.batterNumber,
    String(pitch.lineupPosition + 1),
    String(pitch.atBatNumber),
    String(pitch.pitchNumber),
    String(pitch.ballsBefore),
    String(pitch.strikesBefore),
    PITCH_TYPE_LABELS[pitch.pitchType] ?? pitch.pitchType,
    locLabel,
    pitch.swing ? 'Yes' : 'No',
    pitch.outcome,
    pitch.hitData?.type ?? '',
    pitch.hitData?.result ?? '',
    pitch.hitData
      ? `${Math.round(pitch.hitData.x)},${Math.round(pitch.hitData.y)}`
      : '',
  ];
}

export async function syncPitchToSheets(
  webhookUrl: string,
  pitch: PitchRecord
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendRow',
        headers: SHEETS_HEADERS,
        row: formatPitchAsRow(pitch),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function syncQueueToSheets(
  webhookUrl: string,
  queue: PitchRecord[]
): Promise<{ synced: number; failed: number }> {
  if (!webhookUrl || queue.length === 0) return { synced: 0, failed: 0 };
  let synced = 0;
  let failed = 0;
  for (const pitch of queue) {
    const ok = await syncPitchToSheets(webhookUrl, pitch);
    if (ok) synced++;
    else failed++;
  }
  return { synced, failed };
}
