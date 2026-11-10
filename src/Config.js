/**
 * Settings that rarely change. Values you edit day to day (invite code, group
 * goal) live in the "Settings" tab of the sheet instead.
 */
var CONFIG = {
  // Tracking starts on this date. Garmin backfill and the Apple Shortcut's
  // first run both go back to here.
  TRACKING_START: '2026-01-01',

  // 1 run mile counts the same as this many bike miles.
  BIKE_MILES_PER_RUN_MILE: 3,

  // How far back each scheduled Garmin pull looks. Re-reading a few days of
  // overlap catches workouts that synced to Garmin Connect late.
  GARMIN_LOOKBACK_DAYS: 7,

  // Page size for Garmin activity search.
  GARMIN_PAGE_SIZE: 100,

  GARMIN_BASE_URL: 'https://personal.connectapi.garmin.com',
  GARMIN_TOKEN_PATH: '/personalapitoken-service/personal-api/personal-api-key/token',
  GARMIN_ACTIVITY_SEARCH_PATH: '/activitylist-service/activities/search/activities',

  SHEETS: {
    SETTINGS: 'Settings',
    MEMBERS: 'Members',
    ACTIVITIES: 'Activities',
    WEEKLY: 'Weekly',
    ANNUAL: 'Annual',
    LOG: 'Sync Log'
  }
};
