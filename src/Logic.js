/**
 * Pure functions with no Google Apps Script dependencies, so they can be
 * unit-tested with Node (see test/logic.test.js).
 */

var METERS_PER_MILE = 1609.344;

// Garmin activityType.typeKey values that count as running.
var GARMIN_RUN_TYPES = [
  'running', 'street_running', 'treadmill_running', 'indoor_running',
  'trail_running', 'track_running', 'virtual_run', 'ultra_run', 'obstacle_run'
];

// Garmin activityType.typeKey values that count as biking. E-bike types are
// deliberately absent and are also rejected by isEbikeType_ below.
var GARMIN_BIKE_TYPES = [
  'cycling', 'road_biking', 'gravel_cycling', 'mountain_biking',
  'indoor_cycling', 'virtual_ride', 'cyclocross', 'track_cycling',
  'recumbent_cycling', 'downhill_biking', 'bmx', 'hand_cycling',
  'indoor_hand_cycling'
];

function isEbikeType_(key) {
  var k = String(key || '').toLowerCase().replace(/[\s-]+/g, '_');
  return k.indexOf('e_bike') !== -1 || k.indexOf('ebike') !== -1 ||
    k.indexOf('e_mtb') !== -1 || k.indexOf('e_enduro') !== -1;
}

/**
 * Maps a Garmin typeKey to 'run', 'bike', or null (not counted).
 * Unknown keys fall back to a keyword match so new Garmin sub-types still
 * count, but e-bike types never do.
 */
function categorizeGarminType(typeKey) {
  var k = String(typeKey || '').toLowerCase();
  if (!k || isEbikeType_(k)) return null;
  if (GARMIN_RUN_TYPES.indexOf(k) !== -1) return 'run';
  if (GARMIN_BIKE_TYPES.indexOf(k) !== -1) return 'bike';
  if (/run/.test(k)) return 'run';
  if (/cycl|bik|ride/.test(k)) return 'bike';
  return null;
}

/**
 * Maps an Apple Health workout type name (as Shortcuts reports it, e.g.
 * "Running", "Cycling", "Hand Cycling") to 'run', 'bike', or null.
 * Apple Health has no e-bike workout type, so nothing to exclude there.
 */
function categorizeAppleType(typeName) {
  var t = String(typeName || '').toLowerCase();
  if (!t) return null;
  if (/run/.test(t)) return 'run';
  if (/cycl|bik/.test(t)) return 'bike';
  return null;
}

function metersToMiles(meters) {
  return Number(meters || 0) / METERS_PER_MILE;
}

/** Converts a distance in the given unit ('mi', 'km', 'm') to miles. */
function toMiles(value, unit) {
  var v = Number(value || 0);
  var u = String(unit || 'mi').toLowerCase().trim();
  if (u === 'mi' || u === 'mile' || u === 'miles') return v;
  if (u === 'km' || u === 'kilometer' || u === 'kilometers' || u === 'kilometre' || u === 'kilometres') return v * 1000 / METERS_PER_MILE;
  if (u === 'm' || u === 'meter' || u === 'meters' || u === 'metre' || u === 'metres') return v / METERS_PER_MILE;
  throw new Error('Unknown distance unit: ' + unit);
}

/** Run miles count 1:1; bike miles are divided by bikeRatio. */
function equivalentMiles(category, miles, bikeRatio) {
  if (category === 'run') return miles;
  if (category === 'bike') return miles / bikeRatio;
  return 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Parses the date part of a local timestamp like "2026-03-14 07:05:00",
 * "2026-03-14T07:05:00", or "2026-03-14". Returns "YYYY-MM-DD" or throws.
 * The time zone is intentionally ignored: the date is whatever the runner's
 * watch/phone recorded locally, which is what "their week" means.
 */
function localDatePart(localTimestamp) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(localTimestamp || '').trim());
  if (!m) throw new Error('Unrecognized local date: ' + localTimestamp);
  return m[1] + '-' + m[2] + '-' + m[3];
}

function ymdToUtcDate_(ymd) {
  var p = ymd.split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}

function utcDateToYmd_(d) {
  var mm = String(d.getUTCMonth() + 1);
  var dd = String(d.getUTCDate());
  return d.getUTCFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
}

/** Returns the Monday (YYYY-MM-DD) of the Monday–Sunday week containing ymd. */
function weekStartMonday(ymd) {
  var d = ymdToUtcDate_(ymd);
  var dow = d.getUTCDay(); // 0 = Sunday
  var back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return utcDateToYmd_(d);
}

function addDays(ymd, days) {
  var d = ymdToUtcDate_(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToYmd_(d);
}

/** Fraction of the calendar year elapsed through the end of ymd. */
function yearFractionElapsed(ymd) {
  var year = Number(ymd.slice(0, 4));
  var start = Date.UTC(year, 0, 1);
  var end = Date.UTC(year + 1, 0, 1);
  var through = ymdToUtcDate_(ymd).getTime() + 86400000;
  return Math.min(1, Math.max(0, (through - start) / (end - start)));
}

/**
 * Turns one Garmin activity summary into an activity row object, or null if
 * the activity doesn't count (wrong type, before tracking start, no distance).
 */
function normalizeGarminActivity(member, activity, opts) {
  var typeKey = activity && activity.activityType && activity.activityType.typeKey;
  var category = categorizeGarminType(typeKey);
  if (!category) return null;
  if (activity.activityId === undefined || activity.activityId === null) return null;
  var date = localDatePart(activity.startTimeLocal || activity.startTimeGMT);
  if (date < opts.trackingStart) return null;
  var miles = metersToMiles(activity.distance);
  if (!(miles > 0)) return null;
  return buildActivity_(member, 'garmin', String(activity.activityId), typeKey, category, date,
    String(activity.startTimeLocal || ''), miles, opts.bikeRatio);
}

/**
 * Turns one workout posted by the Apple Shortcut into an activity row object,
 * or null if it doesn't count. Expected shape:
 *   { id, type, start: "YYYY-MM-DD HH:mm:ss" (local), distance, unit }
 * If the Shortcut can't supply a stable id, start+type is used instead.
 */
function normalizeAppleWorkout(member, w, opts) {
  var category = categorizeAppleType(w && w.type);
  if (!category) return null;
  var date = localDatePart(w.start);
  if (date < opts.trackingStart) return null;
  var miles = toMiles(w.distance, w.unit);
  if (!(miles > 0)) return null;
  var id = w.id ? String(w.id) : (String(w.start).trim() + '|' + String(w.type).trim());
  return buildActivity_(member, 'apple', id, String(w.type), category, date, String(w.start), miles, opts.bikeRatio);
}

function buildActivity_(member, source, sourceId, rawType, category, date, startLocal, miles, bikeRatio) {
  return {
    key: source + ':' + member.id + ':' + sourceId,
    memberId: member.id,
    name: member.name,
    source: source,
    sourceId: sourceId,
    rawType: rawType,
    category: category,
    date: date,
    startLocal: startLocal,
    miles: round2(miles),
    equivMiles: round2(equivalentMiles(category, miles, bikeRatio)),
    weekStart: weekStartMonday(date),
    year: Number(date.slice(0, 4))
  };
}

/**
 * Builds weekly and annual summaries.
 *   activities: [{memberId, category, miles, equivMiles, weekStart, year, date}]
 *   members:    [{id, name, goal}]
 *   groupGoals: {year: goal}
 *   today:      "YYYY-MM-DD"
 * Weekly rows are produced for every member for every week from the first
 * tracked week through the current week (zero-mile weeks included), so the
 * sheet shows gaps instead of hiding them.
 */
function buildSummaries(activities, members, groupGoals, today, trackingStart) {
  var memberIds = members.map(function (m) { return m.id; });
  var byWeek = {};   // weekStart|memberId -> totals
  var byYear = {};   // year|memberId -> totals

  function add(map, key, a) {
    var t = map[key] || (map[key] = { run: 0, bike: 0, equiv: 0, count: 0 });
    if (a.category === 'run') t.run += a.miles;
    if (a.category === 'bike') t.bike += a.miles;
    t.equiv += a.equivMiles;
    t.count += 1;
  }

  activities.forEach(function (a) {
    if (memberIds.indexOf(a.memberId) === -1) return;
    add(byWeek, a.weekStart + '|' + a.memberId, a);
    add(byYear, a.year + '|' + a.memberId, a);
  });

  var empty = { run: 0, bike: 0, equiv: 0, count: 0 };
  var weekly = [];
  var lastWeek = weekStartMonday(today);
  for (var wk = weekStartMonday(trackingStart); wk <= lastWeek; wk = addDays(wk, 7)) {
    // A week that straddles New Year is labelled with the year it ends in.
    var wkYear = Number(addDays(wk, 6).slice(0, 4));
    var group = { run: 0, bike: 0, equiv: 0, target: 0 };
    members.forEach(function (m) {
      var t = byWeek[wk + '|' + m.id] || empty;
      var target = m.goal ? m.goal / 52 : 0;
      weekly.push({
        weekStart: wk, year: wkYear, memberId: m.id, name: m.name,
        run: round2(t.run), bike: round2(t.bike), equiv: round2(t.equiv),
        target: round2(target), pct: target ? round2(t.equiv / target) : null
      });
      group.run += t.run; group.bike += t.bike; group.equiv += t.equiv;
    });
    var gGoal = groupGoals[wkYear] || 0;
    var gTarget = gGoal / 52;
    weekly.push({
      weekStart: wk, year: wkYear, memberId: 'GROUP', name: 'Group total',
      run: round2(group.run), bike: round2(group.bike), equiv: round2(group.equiv),
      target: round2(gTarget), pct: gTarget ? round2(group.equiv / gTarget) : null
    });
  }

  var annual = [];
  var startYear = Number(trackingStart.slice(0, 4));
  var thisYear = Number(today.slice(0, 4));
  for (var y = startYear; y <= thisYear; y++) {
    var frac = y < thisYear ? 1 : yearFractionElapsed(today);
    var g = { run: 0, bike: 0, equiv: 0 };
    members.forEach(function (m) {
      var t = byYear[y + '|' + m.id] || empty;
      g.run += t.run; g.bike += t.bike; g.equiv += t.equiv;
      annual.push(annualRow_(y, m.id, m.name, m.goal, t, frac));
    });
    annual.push(annualRow_(y, 'GROUP', 'Group total', groupGoals[y] || 0, g, frac));
  }

  return { weekly: weekly, annual: annual };
}

function annualRow_(year, id, name, goal, t, frac) {
  var expected = goal ? goal * frac : 0;
  return {
    year: year, memberId: id, name: name, goal: goal || 0,
    run: round2(t.run), bike: round2(t.bike), equiv: round2(t.equiv),
    pctGoal: goal ? round2(t.equiv / goal) : null,
    expectedToDate: round2(expected),
    aheadBehind: goal ? round2(t.equiv - expected) : null,
    remaining: goal ? round2(Math.max(0, goal - t.equiv)) : null
  };
}

// Node export for tests; ignored by Apps Script.
if (typeof module !== 'undefined') {
  module.exports = {
    categorizeGarminType: categorizeGarminType,
    categorizeAppleType: categorizeAppleType,
    toMiles: toMiles,
    metersToMiles: metersToMiles,
    equivalentMiles: equivalentMiles,
    localDatePart: localDatePart,
    weekStartMonday: weekStartMonday,
    addDays: addDays,
    yearFractionElapsed: yearFractionElapsed,
    normalizeGarminActivity: normalizeGarminActivity,
    normalizeAppleWorkout: normalizeAppleWorkout,
    buildSummaries: buildSummaries
  };
}
