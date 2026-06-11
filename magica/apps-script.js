/**
 * On the Bump — Google Apps Script Webhook
 * ─────────────────────────────────────────
 * Deploy as a Web App:
 *   Extensions → Apps Script → Deploy → New deployment
 *   Type: Web App
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Copy the Web App URL into the app's Data Backup field on the startup screen.
 */

// ── Column definitions (must match flattenPitch output in lib/sheets.ts) ──────

const COLUMNS = [
  'gameId',        // A
  'timestamp',     // B
  'homeTeam',      // C  — My Team
  'visitingTeam',  // D  — Opposing Team
  'pitcherNumber', // E
  'pitcherName',   // F
  'batterNumber',  // G
  'batterName',    // H
  'batterHand',    // I
  'lineupPosition',// J
  'atBatNumber',   // K
  'pitchNumber',   // L
  'ballsBefore',   // M
  'strikesBefore', // N
  'pitchType',     // O
  'pitchZone',     // P
  'pitchLocation', // Q
  'action',        // R
  'outcome',       // S
  'ballsAfter',    // T
  'strikesAfter',  // U
  'hitType',       // V
  'hitTypeName',   // W
  'hitResult',     // X
  'hitResultName', // Y
  'hitZone',       // Z
  'hitX',          // AA
  'hitY',          // AB
  'runner1B',      // AC
  'runner2B',      // AD
  'runner3B',      // AE
  'outsCount',     // AF
  'baseState',     // AG
];

const HEADERS = [
  'Game ID',        // A
  'Timestamp',      // B
  'My Team',        // C
  'Opposing Team',  // D
  'Pitcher #',      // E
  'Pitcher Name',   // F
  'Batter #',       // G
  'Batter Name',    // H
  'Handedness',     // I
  'Lineup Pos',     // J
  'At-Bat #',       // K
  'Pitch # in AB',  // L
  'Balls Before',   // M
  'Strikes Before', // N
  'Pitch Type',     // O
  'Zone',           // P
  'Pitch Location', // Q
  'Action',         // R
  'Result',         // S
  'Balls After',    // T
  'Strikes After',  // U
  'Hit Type',       // V
  'Hit Type Name',  // W
  'Hit Result',     // X
  'Hit Result Name',// Y
  'Hit Zone',       // Z
  'Hit X',          // AA
  'Hit Y',          // AB
  'Runner 1B',      // AC
  'Runner 2B',      // AD
  'Runner 3B',      // AE
  'Outs',           // AF
  'Base State',     // AG
];

// ── Header group colors ────────────────────────────────────────────────────────
// Used to color-band the header row by category for easy reading
const HEADER_GROUPS = [
  { label: 'Game',    cols: [1, 4],   bg: '#1a3a5c', fg: '#ffffff' }, // A–D
  { label: 'Pitcher', cols: [5, 6],   bg: '#2d5016', fg: '#ffffff' }, // E–F
  { label: 'Batter',  cols: [7, 11],  bg: '#4a2060', fg: '#ffffff' }, // G–K
  { label: 'Pitch',   cols: [12, 18], bg: '#5c3d00', fg: '#ffffff' }, // L–R
  { label: 'Outcome', cols: [19, 28], bg: '#5c1a1a', fg: '#ffffff' }, // S–AB
  { label: 'Base',    cols: [29, 33], bg: '#1a4a3a', fg: '#ffffff' }, // AC–AG
];

// ── Webhook entry point ────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : '[]';
    const data = JSON.parse(raw);
    const rows = Array.isArray(data) ? data : [data];

    if (rows.length === 0) {
      return ok({ count: 0, message: 'No rows received' });
    }

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, 'Pitches');

    // Write headers if the sheet is brand new
    if (sheet.getLastRow() === 0) {
      initSheet(sheet);
    }

    // Append pitch rows
    const matrix = rows.map(row => COLUMNS.map(key => {
      const val = row[key];
      return (val === null || val === undefined) ? '' : val;
    }));

    sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, COLUMNS.length)
         .setValues(matrix);

    return ok({ count: rows.length });
  } catch (err) {
    return error(err.toString());
  }
}

// ── Sheet setup ────────────────────────────────────────────────────────────────

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function initSheet(sheet) {
  // Write header row
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  // Apply group colors
  HEADER_GROUPS.forEach(group => {
    const range = sheet.getRange(1, group.cols[0], 1, group.cols[1] - group.cols[0] + 1);
    range.setBackground(group.bg)
         .setFontColor(group.fg)
         .setFontWeight('bold');
  });

  // Freeze header row, auto-resize columns
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);

  // Set timestamp column to datetime format
  sheet.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  // Set numeric columns
  ['M','N','T','U','AF'].forEach(col => {
    sheet.getRange(col + '2:' + col).setNumberFormat('0');
  });
}

// ── Manual setup trigger ───────────────────────────────────────────────────────
// Run this once from the Apps Script editor to initialize the sheet manually
// (useful for testing before any pitches are sent from the app)

function setupSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'Pitches');
  if (sheet.getLastRow() === 0) {
    initSheet(sheet);
    SpreadsheetApp.getUi().alert('✅ Sheet initialized! Headers and formatting are ready.');
  } else {
    SpreadsheetApp.getUi().alert('Sheet already has data — no changes made.');
  }
}

// ── Response helpers ───────────────────────────────────────────────────────────

function ok(payload) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message }))
    .setMimeType(ContentService.MimeType.JSON);
}
