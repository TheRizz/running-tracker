/**
 * One-time setup and the "Running Tracker" menu in the sheet.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Running Tracker')
    .addItem('Setup (create tabs + 3-hour sync)', 'setup')
    .addItem('Sync Garmin now', 'syncAllGarmin')
    .addItem('Re-pull all Garmin data since Jan 1, 2026', 'backfillAllGarmin')
    .addItem('Rebuild weekly + annual tabs', 'rebuildSummariesFromMenu')
    .addSeparator()
    .addItem('Remove a member…', 'removeMemberFromMenu')
    .addToUi();
}

/** Creates any missing tabs, sets headers, and installs the 3-hour Garmin trigger. Safe to re-run. */
function setup() {
  var ss = ss_();
  ensureTab_(CONFIG.SHEETS.SETTINGS, ['Setting', 'Value'], function (sh) {
    var year = Number(todayYmd_().slice(0, 4));
    sh.getRange(2, 1, 3, 2).setValues([
      ['Invite code', 'change-me'],
      ['Group goal ' + year, 0],
      ['Group goal ' + (year + 1), 0]
    ]);
    sh.getRange('C1').setValue('Add a "Group goal YYYY" row for each year. Goals are in run-equivalent miles (1 run mile = 3 bike miles).');
  });
  ensureTab_(CONFIG.SHEETS.MEMBERS, MEMBER_HEADERS, function (sh) {
    sh.getRange('E:E').setNumberFormat('@');
    sh.getRange('G:G').setNumberFormat('@');
  });
  ensureTab_(CONFIG.SHEETS.ACTIVITIES, ACTIVITY_HEADERS, function (sh) {
    sh.getRange('E:E').setNumberFormat('@');
    sh.getRange('H:I').setNumberFormat('@');
    sh.getRange('L:L').setNumberFormat('@');
    sh.getRange('N:N').setNumberFormat('@');
  });
  ensureTab_(CONFIG.SHEETS.WEEKLY, WEEKLY_HEADERS);
  ensureTab_(CONFIG.SHEETS.ANNUAL, ANNUAL_HEADERS);
  ensureTab_(CONFIG.SHEETS.LOG, LOG_HEADERS);

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  installTriggers_();
  rebuildSummaries_();
  SpreadsheetApp.getActive().toast('Setup done. Set the invite code and group goal on the Settings tab.', 'Running Tracker', 8);
}

function ensureTab_(name, headers, onCreate) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (onCreate) onCreate(sh);
  return sh;
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAllGarmin') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAllGarmin').timeBased().everyHours(3).create();
}

function rebuildSummariesFromMenu() {
  rebuildSummaries_();
  SpreadsheetApp.getActive().toast('Weekly and Annual tabs rebuilt.', 'Running Tracker', 5);
}

/**
 * Marks a member as Removed (their rows stay in Activities for history but drop
 * out of the summaries) and deletes their stored Garmin key.
 */
function removeMemberFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Remove a member', 'Type the member\'s name exactly as it appears on the Members tab:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var name = resp.getResponseText().trim().toLowerCase();
  var m = readMembers_().filter(function (x) { return x.name.toLowerCase() === name && x.status !== 'Removed'; })[0];
  if (!m) { ui.alert('No active member with that name.'); return; }
  updateMemberStatus_(m, { status: 'Removed' });
  props_().deleteProperty('garminKey:' + m.id);
  props_().deleteProperty('garminToken:' + m.id);
  rebuildSummaries_();
  ui.alert(m.name + ' was removed.');
}
