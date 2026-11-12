/**
 * Web app endpoints.
 *   GET  -> the sign-up page (Signup.html)
 *   POST -> workouts from the Apple Shortcut
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Signup')
    .evaluate()
    .setTitle('Join the running tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Apple Shortcut upload. Body (JSON):
 *   { "memberCode": "...", "workouts": [ { "type": "Running", "start": "2026-03-14 07:05:00",
 *     "distance": 3.1, "unit": "mi", "id": "optional" }, ... ] }
 * Responds with JSON {ok, added, updated, skipped} or {ok:false, error}.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var memberId = memberIdForCode_(body.memberCode);
    if (!memberId) return json_({ ok: false, error: 'Unknown member code' });

    var member = readMembers_().filter(function (m) { return m.id === memberId; })[0];
    if (!member || member.status === 'Removed') return json_({ ok: false, error: 'Member not active' });

    var workouts = parseShortcutWorkouts_(body.workouts);
    var norm = { trackingStart: CONFIG.TRACKING_START, bikeRatio: CONFIG.BIKE_MILES_PER_RUN_MILE };
    var rows = [];
    var skipped = 0;
    workouts.forEach(function (w) {
      try {
        var row = normalizeAppleWorkout(member, w, norm);
        if (row) rows.push(row); else skipped++;
      } catch (err) {
        skipped++;
      }
    });

    var lock = LockService.getScriptLock();
    lock.waitLock(30 * 1000);
    try {
      var r = upsertActivities_(rows);
      updateMemberStatus_(member, { status: 'Active', lastSync: nowStamp_(), lastError: '' });
      log_(member.name, 'apple', r.added, r.updated, workouts.length + ' received, ' + skipped + ' skipped');
      rebuildSummaries_();
      return json_({ ok: true, added: r.added, updated: r.updated, skipped: skipped });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Shortcuts may send workouts as a JSON array, or as a list of JSON strings
 * (one per workout) depending on how the list was built. Accept both.
 */
function parseShortcutWorkouts_(w) {
  if (!w) return [];
  if (typeof w === 'string') {
    try { w = JSON.parse(w); } catch (e) { return []; }
  }
  if (!Array.isArray(w)) w = [w];
  return w.map(function (item) {
    if (typeof item === 'string') {
      try { return JSON.parse(item); } catch (e) { return null; }
    }
    return item;
  }).filter(Boolean);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Called from Signup.html via google.script.run ----------

/**
 * form: {inviteCode, name, goal, source: 'garmin'|'apple', garminKey}
 * Returns {memberCode, endpointUrl, source}.
 */
function registerMember(form) {
  var settings = readSettings_();
  if (!settings.inviteCode || String(form.inviteCode || '').trim() !== settings.inviteCode) {
    throw new Error('That invite code is not right.');
  }
  var name = String(form.name || '').trim();
  if (!name || name.length > 40) throw new Error('Enter your name (40 characters max).');
  var goal = Number(form.goal);
  if (!(goal > 0 && goal < 20000)) throw new Error('Enter an annual goal in run-equivalent miles.');
  var source = form.source === 'garmin' ? 'garmin' : form.source === 'apple' ? 'apple' : null;
  if (!source) throw new Error('Pick Garmin or Apple Watch.');

  var garminKey = String(form.garminKey || '').trim();
  if (source === 'garmin') {
    if (!garminKey) throw new Error('Paste your Garmin Personal API key.');
    exchangeGarminKey_(garminKey); // throws if Garmin rejects it
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  var memberId, code;
  try {
    var members = readMembers_();
    var taken = members.some(function (m) { return m.name.toLowerCase() === name.toLowerCase() && m.status !== 'Removed'; });
    if (taken) throw new Error('Someone already joined with that name. Use a different name, or ask the organizer to remove the old entry.');
    memberId = 'm' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    code = issueMemberCode_(memberId);
    if (source === 'garmin') setGarminKey_(memberId, garminKey);
    appendMember_({ id: memberId, name: name, source: source, goal: goal });
  } finally {
    lock.releaseLock();
  }

  // Kick off the Garmin backfill right away rather than waiting for the next 3-hour run.
  if (source === 'garmin') {
    try {
      var m = readMembers_().filter(function (x) { return x.id === memberId; })[0];
      var r = syncGarminMember_(m, { full: true });
      updateMemberStatus_(m, { lastSync: nowStamp_() });
      log_(m.name, 'garmin', r.added, r.updated, 'initial backfill');
      rebuildSummaries_();
    } catch (e) {
      log_(name, 'garmin', 0, 0, 'Initial backfill failed, will retry on schedule: ' + e.message);
    }
  }

  return { memberCode: code, endpointUrl: ScriptApp.getService().getUrl(), source: source };
}

/** Replaces a Garmin member's key. Requires the member code issued at sign-up. */
function updateGarminKey(memberCode, newKey) {
  var memberId = memberIdForCode_(memberCode);
  if (!memberId) throw new Error('That member code is not recognized.');
  var key = String(newKey || '').trim();
  exchangeGarminKey_(key);
  setGarminKey_(memberId, key);
  var m = readMembers_().filter(function (x) { return x.id === memberId; })[0];
  if (m) updateMemberStatus_(m, { status: 'Active', lastError: '' });
  return { ok: true };
}
