/**
 * Reading and writing the sheet tabs, plus the private secret store
 * (Script Properties). Nothing secret is ever written into the sheet.
 */

var MEMBER_HEADERS = ['Member ID', 'Name', 'Source', 'Annual Goal (run-equiv mi)', 'Joined', 'Status', 'Last Sync', 'Last Error'];
var ACTIVITY_HEADERS = ['Key', 'Member ID', 'Name', 'Source', 'Source Activity ID', 'Type', 'Category', 'Date', 'Start (local)', 'Miles', 'Run-Equiv Miles', 'Week Start (Mon)', 'Year', 'Imported At'];
var WEEKLY_HEADERS = ['Week Start (Mon)', 'Year', 'Name', 'Run Miles', 'Bike Miles', 'Run-Equiv Miles', 'Weekly Target', '% of Target'];
var ANNUAL_HEADERS = ['Year', 'Name', 'Annual Goal', 'Run Miles', 'Bike Miles', 'Run-Equiv Miles', '% of Goal', 'On-Pace Target To Date', 'Ahead (+) / Behind (-)', 'Miles Remaining'];
var LOG_HEADERS = ['Time', 'Member', 'Source', 'Added', 'Updated', 'Message'];
var LOG_MAX_ROWS = 1000;

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run Setup from the Running Tracker menu.');
  return sh;
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function todayYmd_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// ---------- Settings ----------

/** Returns {inviteCode, groupGoals: {year: goal}} from the Settings tab. */
function readSettings_() {
  var rows = sheet_(CONFIG.SHEETS.SETTINGS).getDataRange().getValues();
  var out = { inviteCode: '', groupGoals: {} };
  rows.forEach(function (r) {
    var key = String(r[0] || '').trim();
    var m = /^group goal (\d{4})$/i.exec(key);
    if (/^invite code$/i.test(key)) out.inviteCode = String(r[1] || '').trim();
    else if (m) out.groupGoals[Number(m[1])] = Number(r[1]) || 0;
  });
  return out;
}

// ---------- Members ----------

function readMembers_() {
  var sh = sheet_(CONFIG.SHEETS.MEMBERS);
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      row: i + 1,
      id: String(r[0]),
      name: String(r[1]),
      source: String(r[2]),
      goal: Number(r[3]) || 0,
      status: String(r[5] || ''),
      lastSync: r[6] instanceof Date
        ? Utilities.formatDate(r[6], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
        : String(r[6] || '')
    });
  }
  return out;
}

function appendMember_(m) {
  sheet_(CONFIG.SHEETS.MEMBERS).appendRow([m.id, m.name, m.source, m.goal, nowStamp_(), 'Active', '', '']);
}

function updateMemberStatus_(member, fields) {
  var sh = sheet_(CONFIG.SHEETS.MEMBERS);
  if (fields.status !== undefined) sh.getRange(member.row, 6).setValue(fields.status);
  if (fields.lastSync !== undefined) sh.getRange(member.row, 7).setValue(fields.lastSync);
  if (fields.lastError !== undefined) sh.getRange(member.row, 8).setValue(fields.lastError);
}

// ---------- Secrets (Script Properties) ----------

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Creates a random member code and stores only its hash. Returns the code. */
function issueMemberCode_(memberId) {
  var code = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  props_().setProperty('code:' + sha256Hex_(code), memberId);
  return code;
}

function memberIdForCode_(code) {
  if (!code) return null;
  return props_().getProperty('code:' + sha256Hex_(String(code).trim()));
}

function setGarminKey_(memberId, key) {
  props_().setProperty('garminKey:' + memberId, key);
  props_().deleteProperty('garminToken:' + memberId);
}

function getGarminKey_(memberId) {
  return props_().getProperty('garminKey:' + memberId);
}

// ---------- Activities ----------

/**
 * Inserts new activities and updates changed ones, matched by Key.
 * Returns {added, updated}.
 */
function upsertActivities_(activities) {
  if (!activities.length) return { added: 0, updated: 0 };
  var sh = sheet_(CONFIG.SHEETS.ACTIVITIES);
  var last = sh.getLastRow();
  var existing = {};
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, ACTIVITY_HEADERS.length).getValues();
    vals.forEach(function (r, i) { existing[String(r[0])] = { row: i + 2, miles: Number(r[9]), type: String(r[5]) }; });
  }
  var stamp = nowStamp_();
  var toAppend = [];
  var updated = 0;
  var seen = {};
  activities.forEach(function (a) {
    if (seen[a.key]) return;
    seen[a.key] = true;
    var row = [a.key, a.memberId, a.name, a.source, a.sourceId, a.rawType, a.category, a.date, a.startLocal, a.miles, a.equivMiles, a.weekStart, a.year, stamp];
    var prev = existing[a.key];
    if (!prev) {
      toAppend.push(row);
    } else if (prev.miles !== a.miles || prev.type !== a.rawType) {
      sh.getRange(prev.row, 1, 1, row.length).setValues([row]);
      updated++;
    }
  });
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, ACTIVITY_HEADERS.length).setValues(toAppend);
  }
  return { added: toAppend.length, updated: updated };
}

function readActivities_() {
  var sh = sheet_(CONFIG.SHEETS.ACTIVITIES);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ACTIVITY_HEADERS.length).getValues().map(function (r) {
    return {
      memberId: String(r[1]), category: String(r[6]), miles: Number(r[9]) || 0,
      equivMiles: Number(r[10]) || 0, weekStart: ymdCell_(r[11]), year: Number(r[12]), date: ymdCell_(r[7])
    };
  });
}

/** Sheets may turn "2026-01-05" into a Date; normalize back to YYYY-MM-DD. */
function ymdCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

// ---------- Summaries ----------

function rebuildSummaries_() {
  var settings = readSettings_();
  var members = readMembers_().filter(function (m) { return m.status !== 'Removed'; });
  var result = buildSummaries(readActivities_(), members, settings.groupGoals, todayYmd_(), CONFIG.TRACKING_START);

  // Newest week first so the current week is at the top.
  var weeklyRows = result.weekly.slice().reverse().map(function (w) {
    return [w.weekStart, w.year, w.name, w.run, w.bike, w.equiv, w.target, w.pct];
  });
  writeTable_(CONFIG.SHEETS.WEEKLY, WEEKLY_HEADERS, weeklyRows);

  var annualRows = result.annual.slice().reverse().map(function (a) {
    return [a.year, a.name, a.goal, a.run, a.bike, a.equiv, a.pctGoal, a.expectedToDate, a.aheadBehind, a.remaining];
  });
  writeTable_(CONFIG.SHEETS.ANNUAL, ANNUAL_HEADERS, annualRows);
}

function writeTable_(name, headers, rows) {
  var sh = sheet_(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) {
    // Write dates as plain text so Sheets doesn't reformat them.
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sh.setFrozenRows(1);
}

// ---------- Log ----------

function log_(member, source, added, updated, message) {
  var sh = sheet_(CONFIG.SHEETS.LOG);
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, LOG_HEADERS.length).setValues([[nowStamp_(), member, source, added, updated, message || '']]);
  if (sh.getLastRow() > LOG_MAX_ROWS + 1) {
    sh.deleteRows(LOG_MAX_ROWS + 2, sh.getLastRow() - LOG_MAX_ROWS - 1);
  }
}
