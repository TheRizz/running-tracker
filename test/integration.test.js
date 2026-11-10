const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, fakeJwt, response } = require('./fakes.js');

const GOOD_KEY = 'garmin-key-good';
const M = 1609.344;

function garminServer(activities) {
  return (url, opt) => {
    if (url.includes('/personal-api-key/token')) {
      return opt.headers.Authorization === 'ApiKey ' + GOOD_KEY
        ? response(200, fakeJwt(Math.floor(Date.now() / 1000) + 86400))
        : response(401, 'bad key');
    }
    if (url.includes('/activitylist-service/activities/search/activities')) {
      assert.match(opt.headers.Authorization, /^Bearer /);
      const q = new URL(url).searchParams;
      const start = Number(q.get('start')), limit = Number(q.get('limit'));
      return response(200, activities.slice(start, start + limit));
    }
    throw new Error('unexpected url ' + url);
  };
}

function setUp(activities) {
  const env = makeContext({ garmin: garminServer(activities) });
  env.ctx.setup();
  const settings = env.sheets.Settings;
  settings.set(2, 2, 'secret-invite');
  settings.set(3, 1, 'Group goal 2026');
  settings.set(3, 2, 3000);
  return env;
}

const garminActivities = [
  { activityId: 1, activityType: { typeKey: 'running' }, startTimeLocal: '2026-01-03 08:00:00', distance: 5 * M },
  { activityId: 2, activityType: { typeKey: 'treadmill_running' }, startTimeLocal: '2026-01-05 08:00:00', distance: 3 * M },
  { activityId: 3, activityType: { typeKey: 'road_biking' }, startTimeLocal: '2026-01-06 08:00:00', distance: 30 * M },
  { activityId: 4, activityType: { typeKey: 'e_bike_fitness' }, startTimeLocal: '2026-01-06 09:00:00', distance: 20 * M },
  { activityId: 5, activityType: { typeKey: 'walking' }, startTimeLocal: '2026-01-06 10:00:00', distance: 2 * M },
  { activityId: 6, activityType: { typeKey: 'running' }, startTimeLocal: '2025-12-31 08:00:00', distance: 4 * M }
];

test('setup creates tabs and a single 3-hour trigger', () => {
  const env = setUp([]);
  for (const t of ['Settings', 'Members', 'Activities', 'Weekly', 'Annual', 'Sync Log']) assert.ok(env.sheets[t], t);
  env.ctx.setup(); // re-run is safe
  assert.equal(env.triggers.length, 1);
  assert.equal(env.triggers[0].h, 3);
});

test('Garmin sign-up rejects bad invite code and bad key', () => {
  const env = setUp(garminActivities);
  assert.throws(() => env.ctx.registerMember({ inviteCode: 'nope', name: 'Ryan', goal: 1000, source: 'garmin', garminKey: GOOD_KEY }), /invite code/);
  assert.throws(() => env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Ryan', goal: 1000, source: 'garmin', garminKey: 'bad' }), /rejected/);
  assert.equal(env.sheets.Members.getLastRow(), 1);
});

test('Garmin sign-up backfills, filters types, and keeps the key out of the sheet', () => {
  const env = setUp(garminActivities);
  const r = env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Ryan', goal: 1040, source: 'garmin', garminKey: GOOD_KEY });
  assert.equal(r.source, 'garmin');
  assert.ok(r.memberCode.length >= 16);

  const acts = env.sheets.Activities.data.slice(1);
  assert.deepEqual(acts.map(a => a[4]).sort(), ['1', '2', '3']); // e-bike, walk, and 2025 run excluded
  const ride = acts.find(a => a[4] === '3');
  assert.equal(ride[9], 30);
  assert.equal(ride[10], 10);

  const everything = JSON.stringify(Object.values(env.sheets).map(s => s.data));
  assert.ok(!everything.includes(GOOD_KEY), 'API key must never be in the sheet');
  assert.ok(!everything.includes(r.memberCode), 'member code must never be in the sheet');

  const annual = env.sheets.Annual.data.slice(1);
  const ryan = annual.find(a => a[1] === 'Ryan' && a[0] === 2026);
  assert.deepEqual([ryan[3], ryan[4], ryan[5]], [8, 30, 18]);
  const grp = annual.find(a => a[1] === 'Group total' && a[0] === 2026);
  assert.equal(grp[2], 3000);
});

test('scheduled Garmin sync is idempotent and picks up new activities', () => {
  const list = garminActivities.slice();
  const env = setUp(list);
  env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Ryan', goal: 1040, source: 'garmin', garminKey: GOOD_KEY });
  env.ctx.syncAllGarmin();
  assert.equal(env.sheets.Activities.getLastRow(), 4);
  list.unshift({ activityId: 7, activityType: { typeKey: 'trail_running' }, startTimeLocal: '2026-01-07 08:00:00', distance: 6 * M });
  env.ctx.backfillAllGarmin();
  assert.equal(env.sheets.Activities.getLastRow(), 5);
});

test('expired Garmin key is flagged on the Members tab', () => {
  const env = setUp(garminActivities);
  env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Ryan', goal: 1040, source: 'garmin', garminKey: GOOD_KEY });
  const id = env.sheets.Members.data[1][0];
  env.props['garminKey:' + id] = 'revoked';
  delete env.props['garminToken:' + id];
  env.ctx.syncAllGarmin();
  assert.equal(env.sheets.Members.data[1][5], 'Needs new Garmin key');
  assert.match(env.sheets.Members.data[1][7], /rejected/);
});

test('Apple Shortcut upload: auth, dedupe, string-encoded items', () => {
  const env = setUp([]);
  const r = env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Sam', goal: 520, source: 'apple' });
  assert.equal(r.endpointUrl, 'https://script.google.com/macros/s/FAKE/exec');

  const post = body => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);

  assert.equal(post({ memberCode: 'wrong', workouts: [] }).ok, false);

  const workouts = [
    { type: 'Running', start: '2026-11-09 06:00:00', distance: 4, unit: 'mi' },
    JSON.stringify({ type: 'Cycling', start: '2026-11-10 06:00:00', distance: 15, unit: 'mi' }),
    { type: 'Walking', start: '2026-11-10 12:00:00', distance: 1, unit: 'mi' },
    { type: 'Running', start: 'garbage', distance: 1, unit: 'mi' }
  ];
  const first = post({ memberCode: r.memberCode, workouts });
  assert.deepEqual([first.ok, first.added, first.skipped], [true, 2, 2]);
  const again = post({ memberCode: r.memberCode, workouts });
  assert.deepEqual([again.added, again.updated], [0, 0]);

  const wk = env.sheets.Weekly.data.slice(1).find(w => w[2] === 'Sam' && w[0] === '2026-11-09');
  assert.deepEqual([wk[3], wk[4], wk[5], wk[6]], [4, 15, 9, 10]);
});

test('duplicate names are rejected', () => {
  const env = setUp([]);
  env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Sam', goal: 520, source: 'apple' });
  assert.throws(() => env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'sam', goal: 520, source: 'apple' }), /already joined/);
});

test('Garmin key can be replaced with the member code', () => {
  const env = setUp(garminActivities);
  const r = env.ctx.registerMember({ inviteCode: 'secret-invite', name: 'Ryan', goal: 1040, source: 'garmin', garminKey: GOOD_KEY });
  assert.throws(() => env.ctx.updateGarminKey('nope', GOOD_KEY), /not recognized/);
  assert.throws(() => env.ctx.updateGarminKey(r.memberCode, 'bad'), /rejected/);
  assert.equal(env.ctx.updateGarminKey(r.memberCode, GOOD_KEY).ok, true);
});
