/**
 * Pure helpers for the "Import lineup from photo" feature — no network, no
 * React, safe to import from both the API route and client components, and
 * easy to unit test.
 *
 * The vision model's output is treated as UNTRUSTED text: it is parsed
 * defensively, length-capped, and normalised before it ever reaches the
 * review screen. Nothing here writes to a game or a sheet — the coach always
 * reviews and confirms first.
 */

/** Same cap as the Lineup tab (MAX_SLOTS) and the LOAD_ROSTER reducer. */
export const MAX_IMPORT_PLAYERS = 16;

export interface ExtractedLineupRow {
  /** Batting position as read from the image, or null if not shown. */
  order: number | null;
  /** Name exactly as printed — abbreviations/initials are NOT expanded. */
  name: string;
  /** Jersey number as printed, without a leading "#". "" if not shown. */
  number: string;
  hand: 'L' | 'R' | null;
}

export interface ExtractedLineup {
  teamName: string;
  players: ExtractedLineupRow[];
  /** Human-readable cautions (e.g. "9 rows found, expected 9–10"). */
  warnings: string[];
}

/** JSON Schema sent to Gemini (and documented here as the contract). */
export const LINEUP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    teamName: { type: 'string', description: 'Team name if visible in the image, otherwise an empty string.' },
    players: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          order: { type: 'integer', description: 'Batting order position (1 = leadoff) if shown.' },
          name: { type: 'string', description: 'Player name exactly as printed.' },
          number: { type: 'string', description: 'Jersey number exactly as printed, no # sign. Empty string if not shown.' },
          hand: { type: 'string', description: "Batting hand: 'L' or 'R' only if explicitly shown, otherwise an empty string." },
        },
        required: ['name', 'number'],
      },
    },
  },
  required: ['players'],
} as const;

export const LINEUP_EXTRACTION_PROMPT = [
  'This image shows a baseball or softball batting lineup. It may be a screenshot of a scorekeeping app, a photo of a paper lineup card, or a text message.',
  'Extract the BATTING ORDER only and return it as JSON matching the provided schema.',
  'Rules:',
  '- Copy each name EXACTLY as printed. Keep initials and abbreviations (e.g. "Patrick L", "B Downes"). Never expand, correct, translate or invent names.',
  '- "number" is the jersey number exactly as printed, without a "#" sign. Keep leading zeros ("00"). If no number is shown for a player, use an empty string.',
  '- "order" is the batting position (1 = leadoff) when shown; otherwise omit it and list players in the order they appear.',
  '- "hand" is "L" or "R" only if explicitly shown for that player; otherwise an empty string. Do not guess.',
  '- Include only players in the batting order. Exclude coaches, managers, team names, scores, dates and column headings.',
  '- If a row is unreadable, still include it with whatever you can read rather than skipping it.',
  '- "teamName" is the team the lineup belongs to if it is visible, otherwise an empty string.',
  'Return JSON only, with no commentary.',
].join('\n');

function cleanString(v: unknown, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  // Collapse whitespace/control chars; keep it a single short line.
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanNumber(v: unknown): string {
  const s = cleanString(v, 8).replace(/^#+\s*/, '');
  // Jersey numbers are short; anything longer is almost certainly not a number.
  return s.length > 3 ? '' : s;
}

function cleanHand(v: unknown): 'L' | 'R' | null {
  const s = cleanString(v, 8).toUpperCase();
  if (s === 'L' || s === 'LEFT' || s === 'LHB') return 'L';
  if (s === 'R' || s === 'RIGHT' || s === 'RHB') return 'R';
  return null; // switch hitters ("S"/"B") and unknowns stay unset on purpose
}

/**
 * Pull the first JSON object/array out of a model response, tolerating code
 * fences and stray prose around it. Returns undefined if nothing parses.
 */
export function extractJsonText(raw: string): unknown {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
  }

  const start = trimmed.search(/[\[{]/);
  if (start >= 0) {
    for (let end = trimmed.length; end > start; end--) {
      const ch = trimmed[end - 1];
      if (ch !== '}' && ch !== ']') continue;
      try { return JSON.parse(trimmed.slice(start, end)); } catch { /* keep shrinking */ }
    }
  }
  return undefined;
}

/** Normalise whatever the model returned into a safe ExtractedLineup. */
export function parseLineupResponse(raw: unknown): ExtractedLineup {
  const warnings: string[] = [];
  const parsed = typeof raw === 'string' ? extractJsonText(raw) : raw;

  let rawPlayers: unknown[] = [];
  let teamName = '';
  if (Array.isArray(parsed)) {
    rawPlayers = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    teamName = cleanString(obj.teamName, 80);
    if (Array.isArray(obj.players)) rawPlayers = obj.players;
  }

  const rows: ExtractedLineupRow[] = [];
  rawPlayers.forEach(p => {
    if (!p || typeof p !== 'object') return;
    const o = p as Record<string, unknown>;
    const name = cleanString(o.name, 40);
    const number = cleanNumber(o.number);
    if (!name && !number) return; // nothing usable on this row
    const orderNum = typeof o.order === 'number' ? Math.round(o.order) : parseInt(String(o.order ?? ''), 10);
    rows.push({
      order: Number.isFinite(orderNum) && orderNum > 0 && orderNum <= 99 ? orderNum : null,
      name,
      number,
      hand: cleanHand(o.hand),
    });
  });

  // If every row has a distinct order, trust it; otherwise keep reading order.
  const allOrdered = rows.length > 0 && rows.every(r => r.order !== null);
  const distinct = new Set(rows.map(r => r.order)).size === rows.length;
  if (allOrdered && distinct) rows.sort((a, b) => (a.order as number) - (b.order as number));

  if (rows.length === 0) warnings.push('No lineup rows were found in that image.');
  if (rows.length > MAX_IMPORT_PLAYERS) {
    warnings.push(`Found ${rows.length} rows; only the first ${MAX_IMPORT_PLAYERS} fit in a batting order.`);
  }
  if (rows.some(r => !r.name)) warnings.push('Some rows have a number but no readable name — please fill them in.');

  return { teamName, players: rows.slice(0, MAX_IMPORT_PLAYERS), warnings };
}

/** Normalise a name for matching against saved players (case/space-insensitive). */
export function normalizeName(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
