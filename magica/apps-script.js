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
  'id','isEdit',
];

const HEADERS = [
  'Game ID','Timestamp','My Team','Opposing Team',
  'Pitcher #','Pitcher Name','Batter #','Batter Name','Handedness',
  'Lineup Pos','At-Bat #','Pitch # in AB',
  'Balls Before','Strikes Before','Pitch Type','Zone','Pitch Location',
  'Action','Result','Balls After','Strikes After',
  'Hit Type','Hit Type Name','Hit Result','Hit Result Name','Hit Zone','Hit X','Hit Y',
  'Runner 1B','Runner 2B','Runner 3B','Outs','Base State',
  'Row ID','Is Edit',
];

const HEADER_GROUPS = [
  { label:'Game',    cols:[1,4],   bg:'#1a3a5c', fg:'#ffffff' },
  { label:'Pitcher', cols:[5,6],   bg:'#2d5016', fg:'#ffffff' },
  { label:'Batter',  cols:[7,11],  bg:'#4a2060', fg:'#ffffff' },
  { label:'Pitch',   cols:[12,18], bg:'#5c3d00', fg:'#ffffff' },
  { label:'Outcome', cols:[19,28], bg:'#5c1a1a', fg:'#ffffff' },
  { label:'Base',    cols:[29,33], bg:'#1a4a3a', fg:'#ffffff' },
  { label:'Meta',    cols:[34,35], bg:'#2a2a2a', fg:'#aaaaaa' },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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

// ─── doGet ───────────────────────────────────────────────────────────────────

/**
 * doGet — supports two actions:
 *
 *   action=history  batter=<name>  num=<jersey>
 *     Returns all non-edit pitches for that batter across all games.
 *     Matches by name (case-insensitive) OR number — whichever is provided.
 *
 *   action=scout  [gameId=<id>]
 *     Returns all non-edit pitches for the latest game (or a specific gameId).
 *     Used by the read-only Scout view on a second device.
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || 'history').toLowerCase();

    if (action === 'history') {
      var batterName = (params.batter || '').trim();
      var batterNum  = (params.num   || '').trim();
      if (!batterName && !batterNum) {
        return jsonOut({ error: 'Provide batter name or number', pitches: [] });
      }
      return getBatterHistory(batterName, batterNum);
    }

    if (action === 'scout') {
      return getGameScout((params.gameId || '').trim());
    }

    return jsonOut({ error: 'Unknown action: ' + action });
  } catch (err) {
    Logger.log('doGet error: ' + err.toString());
    return jsonOut({ error: err.toString() });
  }
}

// ─── getBatterHistory ─────────────────────────────────────────────────────────

function getBatterHistory(batterName, batterNum) {
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

  var nameIdx  = hmap['batterName']  !== undefined ? hmap['batterName']  : hmap['Batter Name'];
  var numIdx   = hmap['batterNumber'] !== undefined ? hmap['batterNumber'] : hmap['Batter #'];
  var editIdx  = hmap['isEdit']      !== undefined ? hmap['isEdit']      : hmap['Is Edit'];

  if (nameIdx === undefined && numIdx === undefined) {
    return jsonOut({
      error: 'Cannot find batter columns. Headers found: ' + rawHeaders.slice(0, 15).join(', '),
      pitches: []
    });
  }

  var nameLower = batterName.toLowerCase();
  var pitches   = [];
  var sheetRows = data.length - 1; // total data rows (not counting header)

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    // Skip edit/correction rows — these are re-queued edits, not distinct pitches
    if (isEditRow(row, editIdx)) continue;

    // Skip blank rows
    if (!row[nameIdx] && !row[numIdx]) continue;

    var rowName = String(row[nameIdx] !== undefined ? row[nameIdx] : '').toLowerCase().trim();
    var rowNum  = String(row[numIdx]  !== undefined ? row[numIdx]  : '').trim();

    // Match by name (case-insensitive) OR by jersey number
    var nameMatch = nameLower && rowName === nameLower;
    var numMatch  = batterNum  && rowNum  === batterNum;
    if (!nameMatch && !numMatch) continue;

    // Build a plain object with camelCase keys
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

  return jsonOut({ pitches: pitches, count: pitches.length, sheetRows: sheetRows });
}

// ─── getGameScout ─────────────────────────────────────────────────────────────

function getGameScout(gameId) {
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

  if (gameIdIdx === undefined) {
    return jsonOut({ error: 'Cannot find gameId column', pitches: [] });
  }

  // If no gameId specified, find the latest game in the sheet
  var targetGameId = gameId;
  if (!targetGameId) {
    for (var r = data.length - 1; r >= 1; r--) {
      var v = String(data[r][gameIdIdx] || '').trim();
      if (v) { targetGameId = v; break; }
    }
  }
  if (!targetGameId) return jsonOut({ pitches: [], count: 0, gameId: '' });

  var pitches = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
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
