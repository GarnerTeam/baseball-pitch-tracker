/**
 * On the Bump — Google Apps Script Webhook
 * Deploy as a Web App:
 *   Extensions → Apps Script → Deploy → New deployment
 *   Type: Web app | Execute as: Me | Who has access: Anyone
 *
 * COLUMNS must match the keys returned by flattenPitch() in lib/sheets.ts.
 * Order here controls the column order written to the sheet; keys are
 * also used in doPost() for row-by-row lookups, so order ≠ semantics.
 */

const COLUMNS = [
  'gameId','timestamp','homeTeam','visitingTeam',
  'pitcherNumber','pitcherName','batterNumber','batterName','batterHand',
  'lineupPosition','atBatNumber','pitchNumber',
  'ballsBefore','strikesBefore','pitchType','pitchZone','pitchLocation',
  'action','outcome','ballsAfter','strikesAfter',
  'hitType','hitTypeName','hitResult','hitResultName','hitZone','hitX','hitY',
  'runner1B','runner2B','runner3B','outsCount','baseState',
  'id','isEdit','userId',
];

const HEADERS = [
  'Game ID','Timestamp','My Team','Opposing Team',
  'Pitcher #','Pitcher Name','Batter #','Batter Name','Handedness',
  'Lineup Pos','At-Bat #','Pitch # in AB',
  'Balls Before','Strikes Before','Pitch Type','Zone','Pitch Location',
  'Action','Result','Balls After','Strikes After',
  'Hit Type','Hit Type Name','Hit Result','Hit Result Name','Hit Zone','Hit X','Hit Y',
  'Runner 1B','Runner 2B','Runner 3B','Outs','Base State',
  'Row ID','Is Edit','User ID',
];

const HEADER_GROUPS = [
  { label:'Game',    cols:[1,4],   bg:'#1a3a5c', fg:'#ffffff' },
  { label:'Pitcher', cols:[5,6],   bg:'#2d5016', fg:'#ffffff' },
  { label:'Batter',  cols:[7,11],  bg:'#4a2060', fg:'#ffffff' },
  { label:'Pitch',   cols:[12,18], bg:'#5c3d00', fg:'#ffffff' },
  { label:'Outcome', cols:[19,28], bg:'#5c1a1a', fg:'#ffffff' },
  { label:'Base',    cols:[29,33], bg:'#1a4a3a', fg:'#ffffff' },
  { label:'Meta',    cols:[34,36], bg:'#2a2a2a', fg:'#aaaaaa' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────────

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function initSheet(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  HEADER_GROUPS.forEach(function(group) {
    sheet.getRange(1, group.cols[0], 1, group.cols[1] - group.cols[0] + 1)
         .setBackground(group.bg).setFontColor(group.fg).setFontWeight('bold');
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  sheet.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ status: 'ok' }, payload)))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Build a map of { camelCaseKey → columnIndex (0-based) } from the header row.
 * Handles both the human-readable HEADERS format ('Batter Name') and
 * the camelCase COLUMNS format ('batterName') for backwards compatibility.
 */
function buildHeaderMap(rawHeaders) {
  var map = {};
  // Map HEADERS[k] → COLUMNS[k]  (e.g. 'Batter Name' → 'batterName')
  for (var k = 0; k < HEADERS.length; k++) {
    map[HEADERS[k]] = k;    // human header → index
    map[COLUMNS[k]] = k;    // camelCase key → same index
  }
  // Also map whatever is actually in the sheet header row (handles renamed cols)
  rawHeaders.forEach(function(h, i) {
    if (!(h in map)) map[h] = i;
  });
  return map;
}

function isEditRow(row, editIdx) {
  if (editIdx === undefined || editIdx === null) return false;
  var v = row[editIdx];
  return v === true || v === 'true' || v === 'TRUE' || v === 1;
}

// ─── doGet ─────────────────────────────────────────────────────────────────────

/**
 * doGet — supports three actions. ALL actions require userId (or owner as a
 * synonym) — every read is scoped to that one user's rows only, since this
 * sheet now holds data for multiple independent coaches/subscribers.
 *
 *   action=history  userId=<id>  batter=<name>  num=<jersey>
 *     Returns all non-edit pitches for that batter across all of THIS
 *     user's games. Matches by name (case-insensitive) OR number.
 *
 *   action=scout  userId=<id>  [gameId=<id>]
 *     Returns all non-edit pitches for the latest game (or a specific gameId)
 *     belonging to THIS user. Used by the read-only Scout view and by the
 *     "Past Games" browser in the main app.
 *
 *   action=games  userId=<id>
 *     Returns a lightweight list of THIS user's distinct completed games
 *     (gameId, teams, first/last timestamp, pitch count) — powers the
 *     "Past Games" browser. Does NOT return per-pitch data.
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || 'history').toLowerCase();
    var userId = (params.userId || params.owner || '').trim();

    if (!userId) {
      return jsonOut({ error: 'Missing userId (or owner) parameter — every request must be scoped to a user', pitches: [], games: [] });
    }

    if (action === 'history') {
      var batterName = (params.batter || '').trim();
      var batterNum  = (params.num   || '').trim();
      if (!batterName && !batterNum) {
        return jsonOut({ error: 'Provide batter name or number', pitches: [] });
      }
      return getBatterHistory(batterName, batterNum, userId);
    }

    if (action === 'scout') {
      return getGameScout((params.gameId || '').trim(), userId);
    }

    if (action === 'games') {
      return getGamesList(userId);
    }

    return jsonOut({ error: 'Unknown action: ' + action });
  } catch (err) {
    Logger.log('doGet error: ' + err.toString());
    return jsonOut({ error: err.toString() });
  }
}

// ─── getBatterHistory ──────────────────────────────────────────────────────────────────────

function getBatterHistory(batterName, batterNum, userId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pitches');
  if (!sheet) {
    return jsonOut({ error: 'No sheet named "Pitches" — run setupSheet() first', pitches: [] });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ pitches: [], count: 0, sheetRows: 0 });

  var lastCol  = sheet.getLastColumn();
  var data     = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var rawHeaders = data[0].map(function(h) { return String(h).trim(); });
  var hmap     = buildHeaderMap(rawHeaders);

  var nameIdx   = hmap['batterName']  !== undefined ? hmap['batterName']  : hmap['Batter Name'];
  var numIdx    = hmap['batterNumber'] !== undefined ? hmap['batterNumber'] : hmap['Batter #'];
  var editIdx   = hmap['isEdit']      !== undefined ? hmap['isEdit']      : hmap['Is Edit'];
  var userIdIdx = hmap['userId']      !== undefined ? hmap['userId']      : hmap['User ID'];

  if (nameIdx === undefined && numIdx === undefined) {
    return jsonOut({
      error: 'Cannot find batter columns. Headers found: ' + rawHeaders.slice(0, 15).join(', '),
      pitches: []
    });
  }

  // Normalize: lowercase + collapse/trim whitespace, so minor entry
  // differences ("Smith", " Smith ", "Smith  ") never cause a false miss.
  function normalizeName(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }
  var nameLower = normalizeName(batterName);
  var sheetRows = 0; // count only rows owned by this user

  // Two passes: gather every name-matching row first, then decide whether
  // the jersey number should narrow it down. A guest/fill-in player very
  // commonly wears a DIFFERENT number for a team than in prior appearances
  // (borrowed jersey, no number assigned yet, etc.) — if we hard-require the
  // number to match, his real history silently disappears even though the
  // name is a perfect match. So: name is the primary, reliable identity
  // signal; the number is only used to disambiguate when it's actually
  // needed (i.e. there's evidence of two DIFFERENT people sharing this name).
  var nameMatches = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    // Every row must belong to this user — this is the hard tenant boundary.
    // Rows with no userId (pre-migration legacy rows) never match anyone.
    if (userIdIdx === undefined || String(row[userIdIdx] || '').trim() !== userId) continue;
    sheetRows++;

    // Skip edit/correction rows — these are re-queued edits, not distinct pitches
    if (isEditRow(row, editIdx)) continue;

    // Skip blank rows
    if (!row[nameIdx] && !row[numIdx]) continue;

    var rowName = normalizeName(row[nameIdx]);
    var rowNum  = String(row[numIdx] !== undefined ? row[numIdx] : '').trim();

    if (!nameLower || rowName !== nameLower) continue;
    nameMatches.push({ row: row, rowNum: rowNum });
  }

  // Only treat this name as "ambiguous" (multiple real people sharing it)
  // if we actually see more than one DISTINCT jersey number recorded for it.
  // If every row under this name shares one number, or there's no number
  // variation at all, there's no evidence of a collision — include everyone.
  var distinctNums = {};
  for (var m = 0; m < nameMatches.length; m++) {
    if (nameMatches[m].rowNum) distinctNums[nameMatches[m].rowNum] = true;
  }
  var isAmbiguousName = batterNum && Object.keys(distinctNums).length > 1;

  var matchedRows = nameMatches
    .filter(function(m) { return !isAmbiguousName || m.rowNum === batterNum; })
    .map(function(m) { return m.row; });

  // Safety net: if narrowing by number produced nothing (e.g. this really is
  // the same guest player, just recorded with a different number every time),
  // fall back to every name match rather than returning an empty history.
  if (matchedRows.length === 0 && nameMatches.length > 0) {
    matchedRows = nameMatches.map(function(m) { return m.row; });
  }

  var pitches = [];
  for (var j = 0; j < matchedRows.length; j++) {
    var mRow = matchedRows[j];
    // Build a plain object with camelCase keys
    var obj = {};
    for (var k = 0; k < COLUMNS.length; k++) {
      var colKey = COLUMNS[k];
      var idx    = hmap[colKey];
      if (idx === undefined) { obj[colKey] = ''; continue; }
      var cell   = mRow[idx];
      if (cell instanceof Date) {
        obj[colKey] = Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'");
      } else {
        obj[colKey] = (cell === null || cell === undefined) ? '' : cell;
      }
    }
    pitches.push(obj);
  }

  // Sort by at-bat number then pitch number so sheet row order never matters.
  // Each pitch carries atBatNumber and pitchNumber — this guarantees correct
  // chronological order even when offline buffering caused rows to land out
  // of sequence in the sheet.
  var abIdx  = hmap['atBatNumber']  !== undefined ? hmap['atBatNumber']  : hmap['At-Bat #'];
  var pnIdx  = hmap['pitchNumber']  !== undefined ? hmap['pitchNumber']  : hmap['Pitch # in AB'];

  pitches.sort(function(a, b) {
    var abA = Number(a.atBatNumber)  || 0;
    var abB = Number(b.atBatNumber)  || 0;
    if (abA !== abB) return abA - abB;
    var pA  = Number(a.pitchNumber)  || 0;
    var pB  = Number(b.pitchNumber)  || 0;
    return pA - pB;
  });

  return jsonOut({ pitches: pitches, count: pitches.length, sheetRows: sheetRows });
}

// ─── getGameScout ─────────────────────────────────────────────────────────────

function getGameScout(gameId, userId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pitches');
  if (!sheet) return jsonOut({ error: 'No sheet named "Pitches"', pitches: [] });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ pitches: [], count: 0, gameId: '' });

  var lastCol    = sheet.getLastColumn();
  var data       = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var rawHeaders = data[0].map(function(h) { return String(h).trim(); });
  var hmap       = buildHeaderMap(rawHeaders);

  var gameIdIdx  = hmap['gameId']  !== undefined ? hmap['gameId']  : hmap['Game ID'];
  var editIdx    = hmap['isEdit']  !== undefined ? hmap['isEdit']  : hmap['Is Edit'];
  var userIdIdx  = hmap['userId']  !== undefined ? hmap['userId']  : hmap['User ID'];

  if (gameIdIdx === undefined) {
    return jsonOut({ error: 'Cannot find gameId column', pitches: [] });
  }

  // If no gameId specified, find the latest game belonging to THIS user
  // (never the globally-latest game across every user's data).
  var targetGameId = gameId;
  if (!targetGameId) {
    for (var r = data.length - 1; r >= 1; r--) {
      if (userIdIdx === undefined || String(data[r][userIdIdx] || '').trim() !== userId) continue;
      var v = String(data[r][gameIdIdx] || '').trim();
      if (v) { targetGameId = v; break; }
    }
  }
  if (!targetGameId) return jsonOut({ pitches: [], count: 0, gameId: '' });

  var pitches = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (userIdIdx === undefined || String(row[userIdIdx] || '').trim() !== userId) continue;
    if (isEditRow(row, editIdx)) continue;
    var rowGameId = String(row[gameIdIdx] || '').trim();
    if (rowGameId !== targetGameId) continue;

    var obj = {};
    for (var k = 0; k < COLUMNS.length; k++) {
      var colKey = COLUMNS[k];
      var idx    = hmap[colKey];
      if (idx === undefined) { obj[colKey] = ''; continue; }
      var cell   = row[idx];
      if (cell instanceof Date) {
        obj[colKey] = Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'");
      } else {
        obj[colKey] = (cell === null || cell === undefined) ? '' : cell;
      }
    }
    pitches.push(obj);
  }

  return jsonOut({ pitches: pitches, count: pitches.length, gameId: targetGameId });
}

// ─── getGamesList ─────────────────────────────────────────────────────────────

function getGamesList(userId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pitches');
  if (!sheet) return jsonOut({ error: 'No sheet named "Pitches"', games: [] });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ games: [], count: 0 });

  var lastCol    = sheet.getLastColumn();
  var data       = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var rawHeaders = data[0].map(function(h) { return String(h).trim(); });
  var hmap       = buildHeaderMap(rawHeaders);

  var gameIdIdx  = hmap['gameId']       !== undefined ? hmap['gameId']       : hmap['Game ID'];
  var tsIdx      = hmap['timestamp']    !== undefined ? hmap['timestamp']    : hmap['Timestamp'];
  var homeIdx    = hmap['homeTeam']     !== undefined ? hmap['homeTeam']     : hmap['My Team'];
  var awayIdx    = hmap['visitingTeam'] !== undefined ? hmap['visitingTeam'] : hmap['Opposing Team'];
  var editIdx    = hmap['isEdit']       !== undefined ? hmap['isEdit']       : hmap['Is Edit'];
  var userIdIdx  = hmap['userId']       !== undefined ? hmap['userId']       : hmap['User ID'];

  if (gameIdIdx === undefined) {
    return jsonOut({ error: 'Cannot find gameId column', games: [] });
  }

  // Aggregate per gameId: team names, first/last timestamp, pitch count.
  // Rows are appended chronologically, so first-seen order == game order.
  // Every row must belong to this user — the hard tenant boundary.
  var gamesMap = {};
  var order    = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (userIdIdx === undefined || String(row[userIdIdx] || '').trim() !== userId) continue;
    if (isEditRow(row, editIdx)) continue;

    var gid = String(row[gameIdIdx] || '').trim();
    if (!gid) continue;

    if (!gamesMap[gid]) {
      gamesMap[gid] = {
        gameId: gid,
        homeTeam: '',
        visitingTeam: '',
        firstTimestamp: '',
        lastTimestamp: '',
        pitchCount: 0,
      };
      order.push(gid);
    }

    var g = gamesMap[gid];
    g.pitchCount++;

    var rawTs = tsIdx !== undefined ? row[tsIdx] : '';
    var tsStr = rawTs instanceof Date
      ? Utilities.formatDate(rawTs, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'")
      : String(rawTs || '');
    if (tsStr) {
      if (!g.firstTimestamp || tsStr < g.firstTimestamp) g.firstTimestamp = tsStr;
      if (!g.lastTimestamp  || tsStr > g.lastTimestamp)  g.lastTimestamp  = tsStr;
    }
    // Team names can be filled in partway through a game; keep the most
    // recently seen non-blank value so late entries aren't lost.
    if (homeIdx !== undefined && row[homeIdx]) g.homeTeam = String(row[homeIdx]);
    if (awayIdx !== undefined && row[awayIdx]) g.visitingTeam = String(row[awayIdx]);
  }

  // Most recently active game first
  var games = order.map(function(gid) { return gamesMap[gid]; })
    .sort(function(a, b) { return (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''); });

  return jsonOut({ games: games, count: games.length });
}

// ─── doPost ───────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    Logger.log('doPost called');

    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    if (!raw) {
      Logger.log('No postData');
      return ok({ count: 0, message: 'No postData received' });
    }

    var rows;
    try {
      var parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch (parseErr) {
      Logger.log('JSON.parse failed: ' + parseErr.toString());
      return error('JSON parse error: ' + parseErr.toString());
    }

    Logger.log('Rows received: ' + rows.length);
    if (rows.length === 0) return ok({ count: 0, message: 'Empty array' });

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, 'Pitches');
    if (sheet.getLastRow() === 0) initSheet(sheet);

    // Split into new pitches and edits
    var newRows = rows.filter(function(r) { return !r.isEdit; });
    var edits   = rows.filter(function(r) { return  r.isEdit; });

    // ── Append new pitch rows ─────────────────────────────────────────────
    if (newRows.length > 0) {
      var matrix = newRows.map(function(row) {
        return COLUMNS.map(function(key) {
          var val = row[key];
          if (val === null || val === undefined) return '';
          if (typeof val === 'number' && isNaN(val)) return '';
          return val;
        });
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, COLUMNS.length)
           .setValues(matrix);
      Logger.log('Appended ' + newRows.length + ' new rows');
    }

    // ── Apply in-place edits (find by id, overwrite key columns) ─────────
    if (edits.length > 0) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var lastCol    = sheet.getLastColumn();
        var data       = sheet.getRange(1, 1, lastRow, lastCol).getValues();
        var rawHeaders = data[0].map(function(h) { return String(h).trim(); });
        var hmap       = buildHeaderMap(rawHeaders);
        var idColIdx   = hmap['id'] !== undefined ? hmap['id'] : hmap['Row ID'];

        if (idColIdx !== undefined) {
          edits.forEach(function(edit) {
            for (var ri = 1; ri < data.length; ri++) {
              if (String(data[ri][idColIdx]) === String(edit.id)) {
                var sheetRow = ri + 1; // 1-based + header
                ['pitchType','pitchZone','pitchLocation','action','outcome'].forEach(function(col) {
                  var ci = hmap[col];
                  if (ci !== undefined && edit[col] !== undefined) {
                    sheet.getRange(sheetRow, ci + 1).setValue(edit[col]);
                  }
                });
                Logger.log('Updated row ' + sheetRow + ' for id=' + edit.id);
                break;
              }
            }
          });
        } else {
          Logger.log('id column not found — cannot apply edits. Run setupSheet() or add id column.');
        }
      }
    }

    return ok({ count: rows.length, newRows: newRows.length, edits: edits.length });

  } catch (err) {
    Logger.log('CAUGHT ERROR: ' + err.toString());
    return error(err.toString());
  }
}

// ─── setupSheet ───────────────────────────────────────────────────────────────

function setupSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Pitches');
  if (sheet.getLastRow() === 0) {
    initSheet(sheet);
    SpreadsheetApp.getUi().alert('✅ Sheet initialised with all columns including id and isEdit!');
  } else {
    // Add any missing columns to existing sheets
    var lastCol    = sheet.getLastColumn();
    var headerRow  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var existing   = headerRow.map(function(h) { return String(h).trim(); });
    var added      = [];
    COLUMNS.forEach(function(col, i) {
      var humanHeader = HEADERS[i];
      if (existing.indexOf(col) === -1 && existing.indexOf(humanHeader) === -1) {
        var newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue(humanHeader)
             .setBackground('#2a2a2a').setFontColor('#aaaaaa').setFontWeight('bold');
        added.push(humanHeader);
      }
    });
    if (added.length > 0) {
      SpreadsheetApp.getUi().alert('✅ Added missing columns: ' + added.join(', '));
    } else {
      SpreadsheetApp.getUi().alert('Sheet already has all columns — no changes made.');
    }
  }
}

// ─── backfillOwnerId ────────────────────────────────────────────────────────
//
// ONE-TIME MIGRATION — run this manually from the Apps Script editor after
// deploying the userId lockdown, so your existing rows (which predate the
// User ID column) become visible again under your account.
//
// HOW TO RUN:
//   1. Replace 'PASTE_YOUR_CLERK_USER_ID_HERE' below with your real Clerk
//      user ID (find it in the Clerk dashboard → Users → click your user →
//      copy the "User ID", it looks like "user_2abc123XYZ...").
//   2. Select "backfillOwnerId" from the function dropdown at the top of
//      this editor, then click ▶ Run.
//   3. Check the execution log — it will report how many rows were updated.
//   4. You can safely re-run this again later; it only touches rows that
//      still have a blank User ID, so it will never overwrite anyone else's
//      data once other users' rows are tagged with their own IDs.

function backfillOwnerId() {
  var YOUR_USER_ID = 'PASTE_YOUR_CLERK_USER_ID_HERE'; // ← edit this line

  if (!YOUR_USER_ID || YOUR_USER_ID === 'PASTE_YOUR_CLERK_USER_ID_HERE') {
    SpreadsheetApp.getUi().alert('Please edit backfillOwnerId() and paste in your real Clerk User ID first.');
    return;
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pitches');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('No sheet named "Pitches" found.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No data rows to migrate.');
    return;
  }

  var lastCol    = sheet.getLastColumn();
  var data       = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var rawHeaders = data[0].map(function(h) { return String(h).trim(); });
  var hmap       = buildHeaderMap(rawHeaders);
  var userIdIdx  = hmap['userId'] !== undefined ? hmap['userId'] : hmap['User ID'];

  if (userIdIdx === undefined) {
    SpreadsheetApp.getUi().alert('User ID column not found — run setupSheet() first to add it.');
    return;
  }

  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var current = String(data[i][userIdIdx] || '').trim();
    if (current === '') {
      sheet.getRange(i + 1, userIdIdx + 1).setValue(YOUR_USER_ID);
      updated++;
    }
  }

  SpreadsheetApp.getUi().alert('✅ Backfilled ' + updated + ' row(s) with your User ID.');
  Logger.log('backfillOwnerId: updated ' + updated + ' rows');
}
