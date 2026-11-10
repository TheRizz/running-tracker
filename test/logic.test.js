const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/Logic.js');

const opts = { trackingStart: '2026-01-01', bikeRatio: 3 };
const member = { id: 'm1', name: 'Ryan' };

test('Garmin types: runs and rides count, e-bikes never do', () => {
  for (const k of ['running', 'treadmill_running', 'trail_running', 'track_running', 'virtual_run']) {
    assert.equal(L.categorizeGarminType(k), 'run', k);
  }
  for (const k of ['cycling', 'road_biking', 'gravel_cycling', 'mountain_biking', 'indoor_cycling', 'virtual_ride']) {
    assert.equal(L.categorizeGarminType(k), 'bike', k);
  }
  for (const k of ['e_bike_fitness', 'e_bike_mountain', 'e_mtb', 'e_enduro_mtb', 'ebike']) {
    assert.equal(L.categorizeGarminType(k), null, k);
  }
  for (const k of ['walking', 'hiking', 'lap_swimming', 'strength_training', '', undefined]) {
    assert.equal(L.categorizeGarminType(k), null, String(k));
  }
});

test('Apple types', () => {
  assert.equal(L.categorizeAppleType('Running'), 'run');
  assert.equal(L.categorizeAppleType('Cycling'), 'bike');
  assert.equal(L.categorizeAppleType('Hand Cycling'), 'bike');
  assert.equal(L.categorizeAppleType('Walking'), null);
  assert.equal(L.categorizeAppleType('Hiking'), null);
});

test('unit conversion', () => {
  assert.equal(L.toMiles(5, 'mi'), 5);
  assert.ok(Math.abs(L.toMiles(10, 'km') - 6.2137) < 1e-3);
  assert.ok(Math.abs(L.toMiles(1609.344, 'm') - 1) < 1e-9);
  assert.throws(() => L.toMiles(1, 'furlong'));
});

test('weeks start Monday', () => {
  assert.equal(L.weekStartMonday('2026-11-09'), '2026-11-09'); // Monday
  assert.equal(L.weekStartMonday('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(L.weekStartMonday('2026-11-16'), '2026-11-16');
  assert.equal(L.weekStartMonday('2026-01-01'), '2025-12-29'); // Thu Jan 1 2026
  assert.equal(L.weekStartMonday('2028-03-01'), '2028-02-28'); // across leap day
});

test('local date uses the watch-recorded date, ignoring time zones', () => {
  assert.equal(L.localDatePart('2026-03-14 23:59:00'), '2026-03-14');
  assert.equal(L.localDatePart('2026-03-14T07:05:00-05:00'), '2026-03-14');
  assert.throws(() => L.localDatePart('March 14'));
});

test('Garmin activity normalization', () => {
  const run = L.normalizeGarminActivity(member, {
    activityId: 123, activityType: { typeKey: 'running' }, startTimeLocal: '2026-11-15 08:00:00', distance: 8046.72
  }, opts);
  assert.equal(run.key, 'garmin:m1:123');
  assert.equal(run.category, 'run');
  assert.equal(run.miles, 5);
  assert.equal(run.equivMiles, 5);
  assert.equal(run.weekStart, '2026-11-09');
  assert.equal(run.year, 2026);

  const ride = L.normalizeGarminActivity(member, {
    activityId: 124, activityType: { typeKey: 'indoor_cycling' }, startTimeLocal: '2026-11-15 08:00:00', distance: 1609.344 * 30
  }, opts);
  assert.equal(ride.miles, 30);
  assert.equal(ride.equivMiles, 10);

  assert.equal(L.normalizeGarminActivity(member, {
    activityId: 125, activityType: { typeKey: 'e_bike_fitness' }, startTimeLocal: '2026-11-15 08:00:00', distance: 20000
  }, opts), null, 'e-bike skipped');
  assert.equal(L.normalizeGarminActivity(member, {
    activityId: 126, activityType: { typeKey: 'running' }, startTimeLocal: '2025-12-31 08:00:00', distance: 5000
  }, opts), null, 'before tracking start');
  assert.equal(L.normalizeGarminActivity(member, {
    activityId: 127, activityType: { typeKey: 'indoor_cycling' }, startTimeLocal: '2026-11-15 08:00:00', distance: 0
  }, opts), null, 'no distance');
});

test('Apple workout normalization and fallback id', () => {
  const r = L.normalizeAppleWorkout(member, { type: 'Running', start: '2026-02-01 06:30:00', distance: 6.2, unit: 'mi' }, opts);
  assert.equal(r.key, 'apple:m1:2026-02-01 06:30:00|Running');
  assert.equal(r.weekStart, '2026-01-26'); // Feb 1 2026 is a Sunday
  const k = L.normalizeAppleWorkout(member, { id: 'abc', type: 'Cycling', start: '2026-02-01 06:30:00', distance: 30, unit: 'km' }, opts);
  assert.equal(k.key, 'apple:m1:abc');
  assert.ok(Math.abs(k.equivMiles - 6.21) < 0.01);
});

test('summaries: weekly zero-fill, group totals, annual pace', () => {
  const members = [{ id: 'a', name: 'A', goal: 520 }, { id: 'b', name: 'B', goal: 1040 }];
  const acts = [
    { memberId: 'a', category: 'run', miles: 10, equivMiles: 10, weekStart: '2026-11-02', year: 2026 },
    { memberId: 'a', category: 'bike', miles: 30, equivMiles: 10, weekStart: '2026-11-09', year: 2026 },
    { memberId: 'b', category: 'run', miles: 25, equivMiles: 25, weekStart: '2026-11-09', year: 2026 },
    { memberId: 'zzz', category: 'run', miles: 99, equivMiles: 99, weekStart: '2026-11-09', year: 2026 } // removed member
  ];
  const s = L.buildSummaries(acts, members, { 2026: 2000 }, '2026-11-10', '2026-11-02');
  // 2 weeks × (2 members + group)
  assert.equal(s.weekly.length, 6);
  const wkA = s.weekly.find(w => w.weekStart === '2026-11-09' && w.memberId === 'a');
  assert.deepEqual([wkA.run, wkA.bike, wkA.equiv, wkA.target, wkA.pct], [0, 30, 10, 10, 1]);
  const grp = s.weekly.find(w => w.weekStart === '2026-11-09' && w.memberId === 'GROUP');
  assert.equal(grp.equiv, 35);

  const annA = s.annual.find(a => a.memberId === 'a');
  assert.equal(annA.equiv, 20);
  assert.equal(annA.run, 10);
  assert.equal(annA.bike, 30);
  const annG = s.annual.find(a => a.memberId === 'GROUP');
  assert.equal(annG.equiv, 45);
  assert.equal(annG.goal, 2000);
  // Nov 10 is day 314 of 365.
  assert.ok(Math.abs(annG.expectedToDate - 2000 * 314 / 365) < 0.01);
});

test('summaries span multiple years', () => {
  const s = L.buildSummaries([], [{ id: 'a', name: 'A', goal: 100 }], {}, '2027-01-05', '2026-01-01');
  assert.deepEqual([...new Set(s.annual.map(a => a.year))], [2026, 2027]);
  assert.equal(s.annual.find(a => a.year === 2026 && a.memberId === 'a').expectedToDate, 100);
  assert.equal(s.weekly[0].weekStart, '2025-12-29');
  assert.equal(s.weekly[0].year, 2026);
  assert.equal(s.weekly[s.weekly.length - 1].weekStart, '2027-01-04');
});
