# Running Tracker

This tracks weekly and annual run and bike miles for a private group of friends, without Strava. Everything lands in one Google Sheet.

## How it works

```
Garmin watch (iPhone or Android) ──► Garmin Personal API ◄── pulled every 3 h ──┐
                                                                              │
Apple Watch ──► Apple Health ──► Apple Shortcut (noon + midnight) ── POST ──► Google Apps Script ──► Google Sheet
                                                                              │
Friends join via a sign-up page hosted by the same script ───────────────────┘
```

- **Garmin users** create a free [Garmin Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/) key and paste it into the sign-up page. The script pulls their activities every 3 hours. The script stores the key in Script Properties, never in the sheet.
- **Apple Watch users** install a Shortcut. It runs at noon and midnight and sends the last 7 days of workouts. The sheet skips duplicates, so the overlap is harmless.
- **Google Apps Script** attached to the sheet is the whole backend. There's no server and nothing to pay for.

## Rules

| Rule | Value |
|---|---|
| Counts as running | outdoor, treadmill, trail, track, and virtual runs |
| Counts as biking | road, gravel, mountain, indoor or stationary, and virtual rides. **E-bike rides don't count.** |
| Doesn't count | walks, hikes, swims, strength workouts, and so on |
| Run-equivalent miles | run miles + bike miles ÷ 3 |
| Goals | each person sets an annual goal, and the group has its own annual goal. All goals are in run-equivalent miles. |
| Weekly target | annual goal ÷ 52 |
| Week | Monday to Sunday, using the date the watch recorded locally |
| Year | calendar year. Tracking starts **Jan 1, 2026** and is backfilled. |
| Manual entry | none. Only watch data counts. |

## Sheet tabs

- **Settings**: the invite code, plus one `Group goal YYYY` row per year.
- **Members**: name, source, annual goal (you can edit it), status, last sync, and last error.
- **Activities**: one row per counted workout. Duplicates are removed by a `source:member:activityId` key.
- **Weekly**: one row per person per week, plus a group total row, with the current week first.
- **Annual**: one row per person per year, plus a group total row. It shows goal %, the on-pace target, and how far ahead or behind each person is.
- **Sync Log**: the last 1,000 sync events, including any errors.

## Docs

- [docs/SETUP.md](docs/SETUP.md): one-time setup for the organizer.
- [docs/JOINING.md](docs/JOINING.md): what to send friends.
- [docs/APPLE_SHORTCUT.md](docs/APPLE_SHORTCUT.md): building the Apple Watch Shortcut.

## Development

`src/` is the Apps Script project. `src/Logic.js` holds the pure rules (types, miles, weeks, summaries). The tests run the real `src/` files against in-memory fakes of the Apps Script services:

```
npm test
```

To push code from the command line instead of pasting it, use [clasp](https://github.com/google/clasp). Copy `.clasp.json.example` to `.clasp.json`, fill in the script ID, then run `npx @google/clasp push`.
