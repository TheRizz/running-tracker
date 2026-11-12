# Apple Watch Shortcut

Apple Health has no web API, so each Apple Watch user runs a Shortcut that reads their recent workouts and posts them to the tracker. The organizer builds it once on their own iPhone and shares an iCloud link. On install, each friend is asked for their own Upload URL and member code.

> **Built-in Shortcuts can't read workouts.** The stock **Find Health Samples** action doesn't list Workouts as a type. Instead, this Shortcut uses the free **[Actions](https://apps.apple.com/app/id1586435171)** app by Sindre Sorhus, which adds a **Find Workout** action. Every Apple Watch user installs it once from the App Store. It needs iOS 26 or later.

## What it sends

A POST to the web app URL with a plain-text JSON body:

```json
{"memberCode":"abc123...","workouts":[
  {"type":"Running","start":"2026-11-09 06:02:11","distance":4.02,"unit":"mi"},
  {"type":"Cycling","start":"2026-11-08 17:30:00","distance":15.3,"unit":"mi"}
]}
```

- `type`: any name containing "run" counts as a run. Any name containing "cycl" or "bik" counts as a ride. Everything else is ignored.
- `start`: the local start time in `yyyy-MM-dd HH:mm:ss` format. Its date decides which week the workout counts in.
- The sheet removes duplicates by start time plus type, so re-sending the same workouts is harmless.

## Build the "Running Tracker Sync" shortcut

1. **Text**: paste the Upload URL. Rename it, then **Set Variable** `URL`.
2. **Text**: paste the member code, then **Set Variable** `Code`.
3. Pick the start date:
   - **If** `Shortcut Input` **is** `backfill`:
     - **Date**: `January 1, 2026` → **Set Variable** `Since`
   - **Otherwise**:
     - **Adjust Date**: subtract `7` days from `Current Date` → **Set Variable** `Since`
   - **End If**
4. **Find Workout** (from the Actions app): set the start date to on or after `Since`, with no limit. The first run asks for Health permission, so allow **Workouts**.
5. **Repeat with Each** item in Workouts:
   - a. **Get Details of Workout** (or tap the Repeat Item variable and choose the property): **Workout Type** → `WType`, **Distance** → `WDist`. Workouts with no distance, like most Apple Watch indoor rides, are ignored by the server.
   - b. **Format Date**: the workout's **Start Date**, with a custom format of `yyyy-MM-dd HH:mm:ss` → `WStart`.
   - c. **Round Number**: `WDist` to hundredths. If Distance comes out in km or meters, set `unit` in the next step to `km` or `m`. The server converts it.
   - d. **Text**: `{"type":"WType","start":"WStart","distance":Rounded Number,"unit":"mi"}`. Insert the variables where the names are. Leave the quotes around `WType` and `WStart`, and leave **no** quotes around the number.
   - e. **Add to Variable** `Items`.
6. **End Repeat**.
7. **Combine Text**: `Items` with a **Custom** separator of `,` → `Joined`.
8. **Text**: `{"memberCode":"Code","workouts":[Joined]}`, with the variables inserted.
9. **Get Contents of URL**: URL `URL`, Method **POST**, Request Body **File**, File = the Text from step 8. Add the header `Content-Type: application/json`.
10. Optional: **Show Result** when you're testing. The response looks like `{"ok":true,"added":3,"updated":0,"skipped":1}`.

If your distances come through in km, change `"unit":"mi"` to `"unit":"km"`. The server converts them.

Before sharing the shortcut, open its settings (ⓘ) → **Setup** and add **Import Questions** for the two Text actions in steps 1 and 2. Friends are then asked for their URL and code when they install it.

## Backfill shortcut (run once)

Create a second shortcut called **Running Tracker Backfill** with one action: **Run Shortcut** `Running Tracker Sync`, with the input set to the text `backfill`. Run it once by hand after installing. It sends every run and ride since Jan 1, 2026.

## Schedule it (noon and midnight)

In the Shortcuts app, go to **Automation → + → Time of Day**:

1. **12:00 PM**, Daily, **Run Immediately**, action: Run Shortcut **Running Tracker Sync**.
2. Repeat for **12:00 AM**.

Each run sends the last 7 days, so a missed run fixes itself.

## Notes

- Apple Watch **indoor cycling** usually records no distance, so those rides add 0 miles. That's a limit of Apple Health, not of the tracker.
- Run the Shortcut from the same iPhone your Apple Watch is paired with.
- **The Shortcut only sees workouts that are on the iPhone.** Workouts recorded on the watch normally sync to the paired iPhone's Health app within minutes. If the iPhone's **Fitness** app doesn't show a watch workout, the Shortcut can't see it either. See *Troubleshooting* below.
- **Plan B** if Find Workout doesn't return distance: the paid *Health Auto Export* app can post workouts to a URL on a schedule. The server would need a small adapter for its JSON format.

## Troubleshooting: Health shows few or no workouts

The Shortcut reads the iPhone's Health data, not the watch. So the iPhone has to have the workouts first.

1. On the iPhone, open the **Fitness** app and check the workouts list, or open **Health → Browse → Activity → Workouts → Show All Data**. The Health *summary* chart only shows recent data, so it can look nearly empty even when the data is there.
2. If workouts are missing from the phone:
   - Keep the watch on its charger next to the unlocked iPhone, with Bluetooth and Wi-Fi on, for about 30 minutes.
   - Turn on **Settings → [your name] → iCloud → Health**, then wait.
   - If the workouts still don't appear, open the **Watch** app on the iPhone and tap **General → Reset → Reset Sync Data**. This re-syncs the watch to the phone and doesn't delete watch data.
3. If runs are recorded in **Strava** on the watch, check **Health → Sharing → Apps → Strava** and confirm Strava is allowed to *write* Workouts. Otherwise those runs never reach Health.
