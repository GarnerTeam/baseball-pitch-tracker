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
  'id','isEdit','userId','rosterPlayerId','playerId','organizationId',
];

const HEADERS = [
  'Game ID','Timestamp','My Team','Opposing Team',
  'Pitcher #','Pitcher Name','Batter #','Batter Name','Handedness',
  'Lineup Pos','At-Bat #','Pitch # in AB',
  'Balls Before','Strikes Before','Pitch Type','Zone','Pitch Location',
  'Action','Result','Balls After','Strikes After',
  'Hit Type','Hit Type Name','Hit Result','Hit Result Name','Hit Zone','Hit X','Hit Y',
  'Runner 1B','Runner 2B','Runner 3B','Outs','Base State',
  'Row ID','Is Edit','User ID','Roster Player ID','Player ID','Organization ID',
];

const HEADER_GROUPS = [
  { label:'Game',    cols:[1,4],   bg:'#1a3a5c', fg:'#ffffff' },
  { label:'Pitcher', cols:[5,6],   bg:'#2d5016', fg:'#ffffff' },
  { label:'Batter',  cols:[7,11],  bg:'#4a2060', fg:'#ffffff' },
  { label:'Pitch',   cols:[12,18], bg:'#5c3d00', fg:'#ffffff' },
  { label:'Outcome', cols:[19,28], bg:'#5c1a1a', fg:'#ffffff' },
  { label:'Base',    cols:[29,33], bg:'#1a4a3a', fg:'#ffffff' },
  { label:'Meta',    cols:[34,39], bg:'#2a2a2a', fg:'#aaaaaa' },
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

/**
 * Player identity and all historical batter intelligence belong to the
 * coach's Organization, not to the individual user who happened to record
 * a given pitch — an assistant coach in the same org must see the same
 * scouting data a head coach already collected. userId still exists for
 * auth/permissions/audit ("who entered this row"), but it is NEVER the
 * scoping key for reads once an organizationId is available.
 *
 * Matching rule: if the caller has an organizationId AND the row actually
 * has one recorded (rows written before this migration won't), match on
 * organizationId only. Otherwise fall back to userId — this is what keeps
 * pre-migration rows visible to their original recorder without silently
 * reassigning them to a guessed organization.
 */
function rowMatchesScope(row, orgIdx, userIdIdx, organizationId, userId) {
  if (organizationId && orgIdx !== undefined) {
    var rowOrg = String(row[orgIdx] || '').trim();
    if (rowOrg) return rowOrg === organizationId;
  }
  if (userIdIdx !== undefined) {
    return String(row[userIdIdx] || '').trim() === userId;
  }
  return false;
}

// ─── doGet ─────────────────────────────────────────────────────────────────────

/**
 * doGet — supports five actions. Player identity and ALL historical batter
 * intelligence (pitch history, chase/swing rate, damage zones, best K
 * pitch, tendencies, scout reports) are scoped to the caller's
 * ORGANIZATION, not their individual userId — any authorized coach,
 * assistant, or parent attached to the same Organization sees the same
 * data. userId still exists and is always accepted, but it is only used
 * as a fallback scope for solo coaches with no Organization yet, and for
 * legacy rows recorded before this migration.
 *
 *   action=history  organizationId=<id>  [userId=<id>]  [batter=<name>] [num=<jersey>] [playerId=<id>]
 *     Returns all non-edit pitches for that batter across every game in
 *     THIS organization (or, with no organizationId, this user). If
 *     playerId is provided (a Saved Roster id or a persistent
 *     Players-database id — see action=players below), matches on it
 *     EXCLUSIVELY — the reliable way to tell apart siblings/same-name
 *     players and to survive a guest wearing a different jersey number, a
 *     team change, or a new season. Otherwise falls back to name (+ number
 *     when needed to disambiguate) matching.
 *
 *   action=scout  organizationId=<id>  [userId=<id>]  [gameId=<id>]
 *     Returns all non-edit pitches for the latest game (or a specific
 *     gameId) belonging to THIS organization. Used by the read-only Scout
 *     view and by the "Past Games" browser in the main app.
 *
 *   action=games  organizationId=<id>  [userId=<id>]
 *     Returns a lightweight list of THIS organization's distinct completed
 *     games (gameId, teams, first/last timestamp, pitch count) — powers the
 *     "Past Games" browser. Does NOT return per-pitch data.
 *
 *   action=roster  organizationId=<id>  [userId=<id>]  team=<teamName>
 *     Returns THIS organization's Saved Roster for an opposing team (id,
 *     name, number, hand per player) — powers reusing a lineup across
 *     every game against the same team this season, shared by every coach
 *     in the organization.
 *
 *   action=players  organizationId=<id>  [userId=<id>]
 *     Returns every ACTIVE player in THIS organization's persistent batter
 *     database (id, name, number, hand, firstSeen, lastSeen, gamesSeen,
 *     pitchesSeen, notes, verified) — the full list, not a per-keystroke
 *     search, so the Lineup tab's name autocomplete can filter client-side
 *     exactly like the My Team / Opposing Team autocomplete, and every
 *     coach in the organization sees the same suggestions. This is the
 *     persistent identity that survives jersey-number changes, new
 *     seasons, and even a player switching teams.
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || 'history').toLowerCase();
    // organizationId is the primary scope; userId is the legacy/fallback
    // scope for solo coaches with no Organization and for pre-migration
    // rows. `owner` is accepted as a synonym of either, for older Scout
    // share links that pre-date this field split.
    var userId = (params.userId || params.owner || '').trim();
    var organizationId = (params.organizationId || params.orgId || params.owner || userId || '').trim();

    if (!organizationId && !userId) {
      return jsonOut({ error: 'Missing organizationId (or userId/owner) parameter — every request must be scoped', pitches: [], games: [] });
    }

    if (action === 'history') {
      var batterName = (params.batter || '').trim();
      var batterNum  = (params.num   || '').trim();
      var playerId   = (params.playerId || '').trim();
      if (!batterName && !batterNum && !playerId) {
        return jsonOut({ error: 'Provide batter name or number', pitches: [] });
      }
      return getBatterHistory(batterName, batterNum, organizationId, userId, playerId);
    }

    if (action === 'scout') {
      return getGameScout((params.gameId || '').trim(), organizationId, userId);
    }

    if (action === 'games') {
      return getGamesList(organizationId, userId);
    }

    if (action === 'roster') {
      var teamName = (params.team || '').trim();
      if (!teamName) {
        return jsonOut({ error: 'Provide team parameter', players: [] });
      }
      return getRoster(teamName, organizationId, userId);
    }

    if (action === 'players') {
      return getPlayersList(organizationId, userId);
    }

    return jsonOut({ error: 'Unknown action: ' + action });
  } catch (err) {
    Logger.log('doGet error: ' + err.toString());
    return jsonOut({ error: err.toString() });
  }
}

// ─── getBatterHistory ──────────────────────────────────────────────────────────────────────

function getBatterHistory(batterName, batterNum, organizationId, userId, playerId) {
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

  var nameIdx     = hmap['batterName']     !== undefined ? hmap['batterName']     : hmap['Batter Name'];
  var numIdx      = hmap['batterNumber']   !== undefined ? hmap['batterNumber']   : hmap['Batter #'];
  var editIdx     = hmap['isEdit']         !== undefined ? hmap['isEdit']         : hmap['Is Edit'];
  var userIdIdx   = hmap['userId']         !== undefined ? hmap['userId']         : hmap['User ID'];
  var orgIdIdx    = hmap['organizationId'] !== undefined ? hmap['organizationId'] : hmap['Organization ID'];
  var rosterIdIdx = hmap['rosterPlayerId'] !== undefined ? hmap['rosterPlayerId'] : hmap['Roster Player ID'];
  var playerIdIdx = hmap['playerId']       !== undefined ? hmap['playerId']       : hmap['Player ID'];

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

  // ── Fast path: exact identity match (Saved Roster id OR persistent
  //    Players-database id) ──────────────────────────────────────────
  // If the caller has a stable id for this batter, it is a reliable,
  // permanent identity signal — completely bypass name/number guessing.
  // This is what correctly separates siblings/same-name players and
  // survives a guest batter wearing a different jersey number, a team
  // change, or a new season, since the id never changes once assigned.
  // The two id spaces ("roster-<uuid>" vs "PLR0001") never collide, so
  // checking both columns for equality is unambiguous.
  if (playerId && (rosterIdIdx !== undefined || playerIdIdx !== undefined)) {
    var idMatches = [];
    for (var ri = 1; ri < data.length; ri++) {
      var idRow = data[ri];
      if (!rowMatchesScope(idRow, orgIdIdx, userIdIdx, organizationId, userId)) continue;
      sheetRows++;
      if (isEditRow(idRow, editIdx)) continue;
      var rowRosterId = rosterIdIdx !== undefined ? String(idRow[rosterIdIdx] || '').trim() : '';
      var rowPlayerId = playerIdIdx !== undefined ? String(idRow[playerIdIdx] || '').trim() : '';
      if (rowRosterId !== playerId && rowPlayerId !== playerId) continue;
      idMatches.push(idRow);
    }

    var idPitches = idMatches.map(function(row) {
      var obj = {};
      for (var k = 0; k < COLUMNS.length; k++) {
        var colKey = COLUMNS[k];
        var idx = hmap[colKey];
        if (idx === undefined) { obj[colKey] = ''; continue; }
        var cell = row[idx];
        obj[colKey] = (cell instanceof Date)
          ? Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'")
          : (cell === null || cell === undefined) ? '' : cell;
      }
      return obj;
    });

    idPitches.sort(function(a, b) {
      var abA = Number(a.atBatNumber) || 0, abB = Number(b.atBatNumber) || 0;
      if (abA !== abB) return abA - abB;
      return (Number(a.pitchNumber) || 0) - (Number(b.pitchNumber) || 0);
    });

    return jsonOut({ pitches: idPitches, count: idPitches.length, sheetRows: sheetRows });
  }

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

    // Every row must belong to this organization (or, as a fallback, this
    // user) — this is the hard tenant boundary. Rows with neither value
    // recorded (pre-migration legacy rows) never match anyone.
    if (!rowMatchesScope(row, orgIdIdx, userIdIdx, organizationId, userId)) continue;
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

// ─── ROSTERS: getOrCreate sheet + column layout ────────────────────────
// Saved Rosters live in a separate "Rosters" tab so they never mix with the
// per-pitch Pitches sheet. A Team (Saved Roster) belongs to the
// Organization — every coach in the org reuses and updates the same
// roster — scoped by (organizationId, playerId), falling back to
// (userId, playerId) for solo coaches with no Organization. userId is
// kept for audit ("who last touched this row").
var ROSTER_COLUMNS = ['userId', 'teamName', 'playerId', 'name', 'number', 'hand', 'updatedAt', 'organizationId'];
var ROSTER_HEADERS = ['User ID', 'Team Name', 'Player ID', 'Name', 'Number', 'Hand', 'Updated At', 'Organization ID'];

function getOrCreateRostersSheet(ss) {
  var sheet = ss.getSheetByName('Rosters');
  if (!sheet) {
    sheet = ss.insertSheet('Rosters');
    sheet.getRange(1, 1, 1, ROSTER_HEADERS.length).setValues([ROSTER_HEADERS]);
    sheet.getRange(1, 1, 1, ROSTER_HEADERS.length)
         .setBackground('#1a3a5c').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, ROSTER_HEADERS.length);
  }
  return sheet;
}

// ─── getRoster ─────────────────────────────────────────────────────────────────────

function getRoster(teamName, organizationId, userId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Rosters');
  if (!sheet) return jsonOut({ players: [], count: 0 });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ players: [], count: 0 });

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var teamLower = String(teamName || '').toLowerCase().trim();
  var orgIdx = 7; // organizationId — see ROSTER_COLUMNS

  var players = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!rowMatchesScope(row, orgIdx, 0, organizationId, userId)) continue; // userId is column 0
    if (String(row[1] || '').toLowerCase().trim() !== teamLower) continue; // teamName
    players.push({
      id:     String(row[2] || ''), // playerId
      name:   String(row[3] || ''),
      number: String(row[4] || ''),
      hand:   String(row[5] || '') || null,
    });
  }

  return jsonOut({ players: players, count: players.length });
}

// ─── saveRosterPlayers ────────────────────────────────────────────────────────────
// Upserts by (userId, playerId): updates the matching row in place if found,
// otherwise appends a new one. `items` are pre-stamped by the /api/sheets/
// roster route with { userId, teamName, playerId, name, number, hand }.

function saveRosterPlayers(items) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateRostersSheet(ss);

  var lastRow = sheet.getLastRow();
  var data    = lastRow >= 2 ? sheet.getRange(1, 1, lastRow, ROSTER_COLUMNS.length).getValues() : [];
  var now     = new Date().toISOString();

  items.forEach(function(item) {
    var uid = String(item.userId || '').trim();
    var oid = String(item.organizationId || '').trim();
    var pid = String(item.playerId || '').trim();
    if ((!uid && !oid) || !pid) return; // can't upsert without an identity key
    // Scope key prefers organizationId — any coach in the org updates the
    // SAME roster row instead of forking a personal copy.
    var scopeKey = oid || uid;

    var newRow = [
      uid,
      String(item.teamName || ''),
      pid,
      String(item.name || ''),
      String(item.number || ''),
      String(item.hand || ''),
      now,
      oid,
    ];

    var foundRow = -1;
    for (var r = 1; r < data.length; r++) {
      var rowScopeKey = String(data[r][7] || '').trim() || String(data[r][0] || '').trim();
      if (rowScopeKey === scopeKey && String(data[r][2] || '').trim() === pid) {
        foundRow = r + 1; // 1-based sheet row
        break;
      }
    }

    if (foundRow > 0) {
      sheet.getRange(foundRow, 1, 1, ROSTER_COLUMNS.length).setValues([newRow]);
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, ROSTER_COLUMNS.length).setValues([newRow]);
      data.push(newRow); // keep in-memory copy in sync so dupes within the same batch upsert correctly
    }
  });
}

// ─── PLAYERS: persistent, cross-game/season/team batter identity ───────────
// Unlike Rosters (scoped to one opposing team's saved lineup), Players is
// global to the coach's ORGANIZATION — not the individual user — so the
// same real player is recognized via the Lineup tab's name autocomplete by
// EVERY authorized coach/assistant/parent in that org, whether he's seen
// next week, next season, or on an entirely different team. playerId
// ("PLR0001" style) is permanent and backend-generated; it is the
// authoritative link used for ALL scouting history, tendencies, and career
// totals (see the exact-ID fast path in getBatterHistory above) — never
// batterName. organizationId is the scoping/ownership key; userId still
// exists purely as an audit trail of who personally created the record.
var PLAYER_COLUMNS = [
  'playerId', 'organizationId', 'playerName', 'jerseyNumber', 'handedness',
  'firstSeen', 'lastSeen', 'gamesSeen', 'pitchesSeen', 'notes', 'verified', 'isActive',
  'lastGameId',       // internal bookkeeping only — not returned to the client;
                      // lets gamesSeen increment exactly once per distinct game
                      // without an expensive full-sheet scan on every pitch write.
  'createdByUserId',  // audit only — the individual coach who registered this
                      // player; NEVER used for scoping/visibility.
];
var PLAYER_HEADERS = [
  'Player ID', 'Organization ID', 'Player Name', 'Jersey Number', 'Handedness',
  'First Seen', 'Last Seen', 'Games Seen', 'Pitches Seen', 'Notes', 'Verified', 'Is Active',
  'Last Game ID (internal)', 'Created By (User ID)',
];

function getOrCreatePlayersSheet(ss) {
  var sheet = ss.getSheetByName('Players');
  if (!sheet) {
    sheet = ss.insertSheet('Players');
    sheet.getRange(1, 1, 1, PLAYER_HEADERS.length).setValues([PLAYER_HEADERS]);
    sheet.getRange(1, 1, 1, PLAYER_HEADERS.length)
         .setBackground('#4a2060').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, PLAYER_HEADERS.length);
  }
  return sheet;
}

/**
 * Next sequential "PLR####" id, scanning the whole sheet for the highest
 * existing numeric suffix (zero-padded to at least 4 digits; grows
 * naturally past PLR9999 → PLR10000 if a coach somehow tracks that many
 * distinct players). `data` is the Players sheet's full getValues() output.
 */
function generatePlayerId(data) {
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '');
    var m = /^PLR(\d+)$/i.exec(id.trim());
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  var next = maxNum + 1;
  var padded = String(next);
  while (padded.length < 4) padded = '0' + padded;
  return 'PLR' + padded;
}

/**
 * Returns every ACTIVE player in this ORGANIZATION's persistent batter
 * database (falling back to userId for solo coaches with no Organization).
 * The full list (not a per-keystroke search) — the Lineup tab's name
 * autocomplete filters it client-side exactly like My Team / Opposing Team,
 * and every coach in the organization sees the same suggestions.
 */
function getPlayersList(organizationId, userId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Players');
  if (!sheet) return jsonOut({ players: [], count: 0 });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut({ players: [], count: 0 });

  var lastCol = sheet.getLastColumn();
  var data    = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  var players = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // organizationId lives at column 1; createdByUserId (audit, column 13)
    // is the fallback scope for solo coaches with no Organization.
    if (!rowMatchesScope(row, 1, 13, organizationId, userId)) continue;
    var isActive = row[11];
    if (isActive === false || String(isActive).toUpperCase() === 'FALSE') continue;
    players.push({
      id:          String(row[0] || ''),
      name:        String(row[2] || ''),
      number:      String(row[3] || ''),
      hand:        String(row[4] || '') || null,
      firstSeen:   row[5] instanceof Date ? row[5].toISOString() : String(row[5] || ''),
      lastSeen:    row[6] instanceof Date ? row[6].toISOString() : String(row[6] || ''),
      gamesSeen:   Number(row[7]) || 0,
      pitchesSeen: Number(row[8]) || 0,
      notes:       String(row[9] || ''),
      verified:    row[10] === true || String(row[10]).toUpperCase() === 'TRUE',
      isActive:    true,
    });
  }

  return jsonOut({ players: players, count: players.length });
}

/**
 * Creates one brand-new player and returns the full created record
 * (including the generated id) — this is a synchronous round trip, unlike
 * pitch/roster syncing, because the caller needs the id back immediately to
 * tag it onto the lineup slot and every pitch recorded against it.
 */
function createPlayerRecord(item) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreatePlayersSheet(ss);

  var lastRow = sheet.getLastRow();
  var data    = lastRow >= 1 ? sheet.getRange(1, 1, lastRow, PLAYER_COLUMNS.length).getValues() : [PLAYER_HEADERS];

  var userId = String(item.userId || '').trim();
  var organizationId = String(item.organizationId || '').trim() || userId;
  var name   = String(item.name || '').trim();
  if (!organizationId || !name) {
    throw new Error('createPlayerRecord requires organizationId (or userId) and name');
  }

  var id  = generatePlayerId(data);
  var now = new Date().toISOString();
  var record = {
    id: id,
    name: name,
    number: String(item.number || ''),
    hand: String(item.hand || '') || null,
    firstSeen: now,
    lastSeen: now,
    gamesSeen: 0,
    pitchesSeen: 0,
    notes: '',
    verified: true,
    isActive: true,
  };

  var newRow = [
    id, organizationId, name, record.number, record.hand || '',
    now, now, 0, 0, '', true, true,
    '',     // lastGameId — unset until this player's first pitch is recorded
    userId, // createdByUserId — audit only
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, PLAYER_COLUMNS.length).setValues([newRow]);

  return record;
}

/**
 * Increments pitchesSeen / gamesSeen and bumps lastSeen for every player
 * referenced by this batch of newly-appended (non-edit) pitch rows. Called
 * once per doPost after new rows are written. gamesSeen only increments
 * once per distinct gameId per player (tracked via the internal
 * lastGameId column) so re-syncing offline-buffered pitches from the same
 * game never double-counts.
 */
function updatePlayerStatsFromPitches(newRows) {
  var counts = {}; // playerId -> { pitches: n, gameId: lastGameIdInBatch }
  newRows.forEach(function(row) {
    var pid = String(row.playerId || '').trim();
    if (!pid) return;
    if (!counts[pid]) counts[pid] = { pitches: 0, gameId: String(row.gameId || '').trim() };
    counts[pid].pitches++;
    counts[pid].gameId = String(row.gameId || '').trim() || counts[pid].gameId;
  });
  var playerIds = Object.keys(counts);
  if (playerIds.length === 0) return;

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreatePlayersSheet(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // no player rows exist yet — nothing to update

  var data = sheet.getRange(1, 1, lastRow, PLAYER_COLUMNS.length).getValues();
  var now  = new Date().toISOString();

  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][0] || '').trim();
    if (!counts[rowId]) continue;
    var info = counts[rowId];
    var sheetRow = i + 1; // 1-based + header

    var currentPitches  = Number(data[i][8]) || 0;
    var currentGames    = Number(data[i][7]) || 0;
    var lastGameId      = String(data[i][12] || '').trim();
    var newGameCount    = (info.gameId && info.gameId !== lastGameId) ? currentGames + 1 : currentGames;

    sheet.getRange(sheetRow, 7).setValue(now);                           // Last Seen
    sheet.getRange(sheetRow, 8).setValue(newGameCount);                  // Games Seen
    sheet.getRange(sheetRow, 9).setValue(currentPitches + info.pitches); // Pitches Seen
    if (info.gameId) sheet.getRange(sheetRow, 13).setValue(info.gameId); // Last Game ID (internal)
  }
}

// ─── getGameScout ─────────────────────────────────────────────────────────────

function getGameScout(gameId, organizationId, userId) {
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
  var orgIdIdx   = hmap['organizationId'] !== undefined ? hmap['organizationId'] : hmap['Organization ID'];

  if (gameIdIdx === undefined) {
    return jsonOut({ error: 'Cannot find gameId column', pitches: [] });
  }

  // If no gameId specified, find the latest game belonging to THIS
  // organization (never the globally-latest game across every org/user).
  var targetGameId = gameId;
  if (!targetGameId) {
    for (var r = data.length - 1; r >= 1; r--) {
      if (!rowMatchesScope(data[r], orgIdIdx, userIdIdx, organizationId, userId)) continue;
      var v = String(data[r][gameIdIdx] || '').trim();
      if (v) { targetGameId = v; break; }
    }
  }
  if (!targetGameId) return jsonOut({ pitches: [], count: 0, gameId: '' });

  var pitches = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!rowMatchesScope(row, orgIdIdx, userIdIdx, organizationId, userId)) continue;
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

function getGamesList(organizationId, userId) {
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
  var orgIdIdx   = hmap['organizationId'] !== undefined ? hmap['organizationId'] : hmap['Organization ID'];

  if (gameIdIdx === undefined) {
    return jsonOut({ error: 'Cannot find gameId column', games: [] });
  }

  // Aggregate per gameId: team names, first/last timestamp, pitch count.
  // Rows are appended chronologically, so first-seen order == game order.
  // Every row must belong to this organization (or, as a fallback, this
  // user) — the hard tenant boundary.
  var gamesMap = {};
  var order    = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!rowMatchesScope(row, orgIdIdx, userIdIdx, organizationId, userId)) continue;
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

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      Logger.log('JSON.parse failed: ' + parseErr.toString());
      return error('JSON parse error: ' + parseErr.toString());
    }

    // ── Player creation is a dedicated single-object request (not a rows
    //    array) because, unlike pitch/roster syncing, the caller needs the
    //    backend-generated Player ID back synchronously. ───────────────────
    if (!Array.isArray(parsed) && parsed && parsed._kind === 'createPlayer') {
      try {
        var createdPlayer = createPlayerRecord(parsed);
        return ok({ player: createdPlayer });
      } catch (createErr) {
        Logger.log('createPlayerRecord error: ' + createErr.toString());
        return error(createErr.toString());
      }
    }

    var rows = Array.isArray(parsed) ? parsed : [parsed];

    Logger.log('Rows received: ' + rows.length);
    if (rows.length === 0) return ok({ count: 0, message: 'Empty array' });

    // ── Roster saves are a completely different write target (the Rosters
    //    tab, not Pitches) — split them off first and handle separately.
    var rosterItems = rows.filter(function(r) { return r._kind === 'roster'; });
    var pitchRows   = rows.filter(function(r) { return r._kind !== 'roster'; });

    if (rosterItems.length > 0) {
      saveRosterPlayers(rosterItems);
    }

    if (pitchRows.length === 0) {
      return ok({ count: rows.length, newRows: 0, edits: 0, rosterSaved: rosterItems.length });
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, 'Pitches');
    if (sheet.getLastRow() === 0) initSheet(sheet);

    // Split into new pitches and edits
    var newRows = pitchRows.filter(function(r) { return !r.isEdit; });
    var edits   = pitchRows.filter(function(r) { return  r.isEdit; });

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

      // Keep each referenced player's cached gamesSeen/pitchesSeen/lastSeen
      // in sync — this is what powers the stats shown in the Lineup tab's
      // autocomplete dropdown without scanning the whole Pitches sheet.
      try {
        updatePlayerStatsFromPitches(newRows);
      } catch (statsErr) {
        Logger.log('updatePlayerStatsFromPitches error (non-fatal): ' + statsErr.toString());
      }
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

    return ok({ count: rows.length, newRows: newRows.length, edits: edits.length, rosterSaved: rosterItems.length });

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
