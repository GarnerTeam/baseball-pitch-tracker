/**
 * On the Bump — Google Apps Script Webhook
 * Deploy as a Web App:
 *   Extensions → Apps Script → Deploy → New deployment
 *   Type: Web app | Execute as: Me | Who has access: Anyone
 */

const COLUMNS = [
  'gameId','timestamp','homeTeam','visitingTeam',
  'pitcherNumber','pitcherName','batterNumber','batterName','batterHand',
  'lineupPosition','atBatNumber','pitchNumber',
  'ballsBefore','strikesBefore','pitchType','pitchZone','pitchLocation',
  'action','outcome','ballsAfter','strikesAfter',
  'hitType','hitTypeName','hitResult','hitResultName','hitZone','hitX','hitY',
  'runner1B','runner2B','runner3B','outsCount','baseState',
];

const HEADERS = [
  'Game ID','Timestamp','My Team','Opposing Team',
  'Pitcher #','Pitcher Name','Batter #','Batter Name','Handedness',
  'Lineup Pos','At-Bat #','Pitch # in AB',
  'Balls Before','Strikes Before','Pitch Type','Zone','Pitch Location',
  'Action','Result','Balls After','Strikes After',
  'Hit Type','Hit Type Name','Hit Result','Hit Result Name','Hit Zone','Hit X','Hit Y',
  'Runner 1B','Runner 2B','Runner 3B','Outs','Base State',
];

const HEADER_GROUPS = [
  { label:'Game',    cols:[1,4],   bg:'#1a3a5c', fg:'#ffffff' },
  { label:'Pitcher', cols:[5,6],   bg:'#2d5016', fg:'#ffffff' },
  { label:'Batter',  cols:[7,11],  bg:'#4a2060', fg:'#ffffff' },
  { label:'Pitch',   cols:[12,18], bg:'#5c3d00', fg:'#ffffff' },
  { label:'Outcome', cols:[19,28], bg:'#5c1a1a', fg:'#ffffff' },
  { label:'Base',    cols:[29,33], bg:'#1a4a3a', fg:'#ffffff' },
];

/**
 * doGet — returns pitch history for a batter as JSON.
 * Called by the app's /api/sheets/history proxy.
 *
 * Query params:
 *   action  = "history" (required)
 *   batter  = batter name (case-insensitive)
 *   num     = batter jersey number
 *
 * At least one of batter or num is required.
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action || 'history';

    if (action === 'history') {
      var batterName = (params.batter || '').trim();
      var batterNum  = (params.num   || '').trim();
      if (!batterName && !batterNum) {
        return jsonOut({ error: 'Provide batter name or number', pitches: [] });
      }
      return getBatterHistory(batterName, batterNum);
    }

    return jsonOut({ error: 'Unknown action: ' + action });
  } catch (err) {
    Logger.log('doGet error: ' + err.toString());
    return jsonOut({ error: err.toString() });
  }
}

function getBatterHistory(batterName, batterNum) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pitches');
  if (!sheet) return jsonOut({ error: 'No sheet named "Pitches"', pitches: [] });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ pitches: [], count: 0 });

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });

  var nameIdx = headers.indexOf('batterName');
  var numIdx  = headers.indexOf('batterNumber');
  if (nameIdx === -1 && numIdx === -1) {
    return jsonOut({ error: 'batterName/batterNumber columns not found', pitches: [] });
  }

  var nameLower = batterName.toLowerCase();
  var pitches   = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Skip blank rows
    if (!row[nameIdx] && !row[numIdx]) continue;

    var rowName = String(row[nameIdx] || '').toLowerCase().trim();
    var rowNum  = String(row[numIdx]  || '').trim();

    var match = false;
    if (nameLower && rowName === nameLower) match = true;
    if (batterNum  && rowNum  === batterNum)  match = true;

    if (!match) continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) {
        obj[headers[j]] = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'");
      } else {
        obj[headers[j]] = (val === null || val === undefined) ? '' : val;
      }
    }
    pitches.push(obj);
  }

  return jsonOut({ pitches: pitches, count: pitches.length });
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    Logger.log('doPost called');

    // ── Read body ───────────────────────────────────────────────────────────
    var raw = '';
    if (e && e.postData && e.postData.contents) {
      raw = e.postData.contents;
      Logger.log('postData.contents length: ' + raw.length);
      Logger.log('postData.type: ' + e.postData.type);
      Logger.log('first 200 chars: ' + raw.substring(0, 200));
    } else {
      Logger.log('No postData — e=' + JSON.stringify(e));
      return ok({ count: 0, message: 'No postData received' });
    }

    // ── Parse ───────────────────────────────────────────────────────────────
    var data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      Logger.log('JSON.parse failed: ' + parseErr.toString());
      Logger.log('raw body: ' + raw);
      return error('JSON parse error: ' + parseErr.toString());
    }

    var rows = Array.isArray(data) ? data : [data];
    Logger.log('rows received: ' + rows.length);

    if (rows.length === 0) {
      return ok({ count: 0, message: 'Empty array received' });
    }

    // ── Write to sheet ──────────────────────────────────────────────────────
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log('Spreadsheet: ' + ss.getName());

    var sheet = getOrCreateSheet(ss, 'Pitches');
    Logger.log('Sheet last row before write: ' + sheet.getLastRow());

    if (sheet.getLastRow() === 0) {
      Logger.log('Initialising headers');
      initSheet(sheet);
    }

    var matrix = rows.map(function(row) {
      return COLUMNS.map(function(key) {
        var val = row[key];
        if (val === null || val === undefined) return '';
        if (typeof val === 'number' && isNaN(val)) return '';
        return val;
      });
    });

    Logger.log('Writing ' + matrix.length + ' row(s) starting at row ' + (sheet.getLastRow() + 1));
    sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, COLUMNS.length)
         .setValues(matrix);
    Logger.log('Write complete');

    return ok({ count: rows.length });

  } catch (err) {
    Logger.log('CAUGHT ERROR: ' + err.toString());
    Logger.log('Stack: ' + err.stack);
    return error(err.toString());
  }
}

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
  ['M','N','T','U','AF'].forEach(function(col) {
    sheet.getRange(col + '2:' + col).setNumberFormat('0');
  });
}

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Pitches');
  if (sheet.getLastRow() === 0) {
    initSheet(sheet);
    SpreadsheetApp.getUi().alert('✅ Sheet initialised!');
  } else {
    SpreadsheetApp.getUi().alert('Sheet already has data — no changes made.');
  }
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
