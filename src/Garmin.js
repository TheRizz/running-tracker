/**
 * Pulls activities from Garmin's Personal API for each Garmin member.
 * Endpoints match Garmin's official client:
 * https://github.com/garmin/connect-personal-api-python
 */

/** Exchanges a member's Personal API key for a bearer token (cached until ~1h before expiry). */
function garminToken_(memberId, forceRefresh) {
  var props = props_();
  var cacheKey = 'garminToken:' + memberId;
  if (!forceRefresh) {
    var cached = props.getProperty(cacheKey);
    if (cached) {
      var c = JSON.parse(cached);
      if (c.exp * 1000 - Date.now() > 3600 * 1000) return c.token;
    }
  }
  var key = getGarminKey_(memberId);
  if (!key) throw new GarminAuthError_('No Garmin key on file');
  var token = exchangeGarminKey_(key);
  props.setProperty(cacheKey, JSON.stringify({ token: token, exp: jwtExp_(token) }));
  return token;
}

/** POSTs the API key to Garmin's token endpoint. Returns the bearer token string. */
function exchangeGarminKey_(apiKey) {
  var res = UrlFetchApp.fetch(CONFIG.GARMIN_BASE_URL + CONFIG.GARMIN_TOKEN_PATH, {
    method: 'post',
    headers: { Accept: '*/*', Authorization: 'ApiKey ' + apiKey },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 401 || code === 403) throw new GarminAuthError_('Garmin rejected the key (HTTP ' + code + '). It may be expired or revoked.');
  if (code < 200 || code >= 300) throw new Error('Garmin token request failed: HTTP ' + code + ' ' + res.getContentText().slice(0, 200));
  return res.getContentText().trim();
}

function jwtExp_(token) {
  try {
    var payload = token.split('.')[1];
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(payload + '==='.slice((payload.length + 3) % 4))).getDataAsString();
    var exp = JSON.parse(json).exp;
    if (exp) return exp;
  } catch (e) { /* fall through */ }
  // Garmin documents 24h tokens; assume that if the JWT can't be read.
  return Math.floor(Date.now() / 1000) + 23 * 3600;
}

function GarminAuthError_(message) {
  this.name = 'GarminAuthError';
  this.message = message;
}
GarminAuthError_.prototype = Object.create(Error.prototype);

function garminGet_(memberId, path, params) {
  var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var url = CONFIG.GARMIN_BASE_URL + path + (qs ? '?' + qs : '');
  for (var attempt = 0; attempt < 2; attempt++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + garminToken_(memberId, attempt > 0) },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 401 && attempt === 0) continue; // token went stale; refresh once
    if (code === 401 || code === 403) throw new GarminAuthError_('Garmin refused access (HTTP ' + code + ').');
    if (code === 429) throw new Error('Garmin rate limit hit (HTTP 429). Will retry next sync.');
    if (code < 200 || code >= 300) throw new Error('Garmin request failed: HTTP ' + code + ' ' + res.getContentText().slice(0, 200));
    var text = res.getContentText();
    return text ? JSON.parse(text) : [];
  }
}

/** Fetches all activities with a start date in [startYmd, endYmd]. */
function fetchGarminActivities_(memberId, startYmd, endYmd) {
  var all = [];
  var size = CONFIG.GARMIN_PAGE_SIZE;
  for (var start = 0; start < 5000; start += size) {
    var page = garminGet_(memberId, CONFIG.GARMIN_ACTIVITY_SEARCH_PATH, {
      start: start, limit: size, startDate: startYmd, endDate: endYmd
    });
    var list = Array.isArray(page) ? page : (page && (page.activities || page.activityList)) || [];
    all = all.concat(list);
    if (list.length < size) break;
  }
  return all;
}

/** Syncs one Garmin member. Returns {added, updated}. */
function syncGarminMember_(member, opts) {
  var today = todayYmd_();
  var start = CONFIG.TRACKING_START;
  if (member.lastSync && !(opts && opts.full)) {
    var back = addDays(String(member.lastSync).slice(0, 10), -CONFIG.GARMIN_LOOKBACK_DAYS);
    if (back > start) start = back;
  }
  var raw = fetchGarminActivities_(member.id, start, addDays(today, 1));
  var norm = { trackingStart: CONFIG.TRACKING_START, bikeRatio: CONFIG.BIKE_MILES_PER_RUN_MILE };
  var rows = [];
  raw.forEach(function (a) {
    var row = normalizeGarminActivity(member, a, norm);
    if (row) rows.push(row);
  });
  return upsertActivities_(rows);
}

/** Time-driven trigger entry point (every 3 hours). */
function syncAllGarmin() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;
  try {
    readMembers_().forEach(function (m) {
      if (m.source !== 'garmin' || m.status === 'Removed') return;
      try {
        var r = syncGarminMember_(m);
        updateMemberStatus_(m, { status: 'Active', lastSync: nowStamp_(), lastError: '' });
        log_(m.name, 'garmin', r.added, r.updated, '');
      } catch (e) {
        var isAuth = e instanceof GarminAuthError_;
        updateMemberStatus_(m, { status: isAuth ? 'Needs new Garmin key' : m.status || 'Active', lastError: e.message });
        log_(m.name, 'garmin', 0, 0, 'ERROR: ' + e.message);
      }
    });
    rebuildSummaries_();
  } finally {
    lock.releaseLock();
  }
}

/** Menu action: re-pull every Garmin member from TRACKING_START. */
function backfillAllGarmin() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try {
    readMembers_().forEach(function (m) {
      if (m.source !== 'garmin' || m.status === 'Removed') return;
      try {
        var r = syncGarminMember_(m, { full: true });
        updateMemberStatus_(m, { status: 'Active', lastSync: nowStamp_(), lastError: '' });
        log_(m.name, 'garmin', r.added, r.updated, 'full backfill');
      } catch (e) {
        updateMemberStatus_(m, { lastError: e.message });
        log_(m.name, 'garmin', 0, 0, 'ERROR (backfill): ' + e.message);
      }
    });
    rebuildSummaries_();
  } finally {
    lock.releaseLock();
  }
}
