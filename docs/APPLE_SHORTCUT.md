# Apple Watch Shortcut

Apple Health has no web API, so each Apple Watch user runs a Shortcut that reads their recent workouts and posts them to the tracker. The organizer builds it once on their own iPhone and shares an iCloud link. On install, each friend is asked for their own Upload URL and member code.

> **Status: still needs a test on a real iPhone.** The exact names of the Shortcuts health actions vary between iOS versions. Build it, run it once, and check the **Sync Log** tab. If the workout sample doesn't show a distance, use the fallback in step 5b.

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
4. **Find Health Samples** where **Type** is **Workouts** and **Start Date** is after `Since`. Sort by Start Date, with no limit.
5. **Repeat with Each** item in Health Samples:
   - a. **Get Details of Health Sample**: get **Workout Activity Type** (it may be labelled **Type** or **Name**) → `WType`. Get **Distance** → `WDist`.
   - b. *Fallback, only if the workout sample has no Distance:* **Find Health Samples** where Type is **Walking + Running Distance** (or **Cycling Distance** for rides), Start Date is on or after the workout's Start Date, and End Date is on or before its End Date. Then **Calculate Statistics → Sum** → `WDist`.
   - c. **Format Date**: the workout's **Start Date**, with a custom format of `yyyy-MM-dd HH:mm:ss` → `WStart`.
   - d. **Round Number**: `WDist` to hundredths.
   - e. **Text**: `{"type":"WType","start":"WStart","distance":Rounded Number,"unit":"mi"}`. Insert the variables where the names are. Leave the quotes around `WType` and `WStart`, and leave **no** quotes around the number.
   - f. **Add to Variable** `Items`.
6. **End Repeat**.
7. **Combine Text**: `Items` with a **Custom** separator of `,` → `Joined`.
8. **Text**: `{"memberCode":"Code","workouts":[Joined]}`, with the variables inserted.
9. **Get Contents of URL**: URL `URL`, Method **POST**, Request Body **File**, File = the Text from step 8. Add the header `Content-Type: application/json`.
10. Optional: **Show Result** when you're testing. The response looks like `{"ok":true,"added":3,"updated":0,"skipped":1}`.

If your distances come through in km, change `"unit":"mi"` to `"unit":"km"`. The server converts them.

Before sharing the shortcut, open its settings (ⓘ) → **Setup** and add **Import Questions** for the two Text actions in steps 1 and 2. Friends are then asked for their URL and code when they install it.

## Backfill shortcut (run once)

Create a second shortcut called **Running Tracker Backfill** with one action: **Run Shortcut** `Running Tracker Sync`, with the input set to the text `backfill`. Run it once by hand after installing. It sends every run and ride since Jan 1, 2026. The first run asks for Health permission. Allow **Workouts**, plus the distance types if you're using the fallback.

## Schedule it (noon and midnight)

In the Shortcuts app, go to **Automation → + → Time of Day**:

1. **12:00 PM**, Daily, **Run Immediately**, action: Run Shortcut **Running Tracker Sync**.
2. Repeat for **12:00 AM**.

Each run sends the last 7 days, so a missed run fixes itself.

## Notes

- Apple Watch **indoor cycling** usually records no distance, so those rides add 0 miles. That's a limit of Apple Health, not of the tracker.
- Run the Shortcut from the same iPhone your Apple Watch is paired with.
- **Plan B** if Shortcuts can't read workouts on your iOS version: the paid *Health Auto Export* app can post workouts to a URL on a schedule. The server would need a small adapter for its JSON format.
