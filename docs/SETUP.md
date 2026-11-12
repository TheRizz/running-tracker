# Organizer setup (about 15 minutes)

Use your **personal** Google account. Work accounts often block scripts and outside sharing.

## 1. Create the sheet and script

1. Create a new Google Sheet, for example "Running Tracker 2026".
2. Open **Extensions → Apps Script**.
3. In the editor, open **Project Settings** (the gear icon) and turn on **Show "appsscript.json" manifest file in editor**.
4. For each file in [`src/`](../src), create a file with the same name and paste in its contents:
   - `appsscript.json`: replace what's already there.
   - `Config.gs`, `Logic.gs`, `Store.gs`, `Garmin.gs`, `WebApp.gs`, `Setup.gs`: use **+ → Script**. The repo uses `.js` and the editor uses `.gs`, but the code is the same. Delete the default `Code.gs`.
   - `Signup.html`: use **+ → HTML**.
5. In `appsscript.json`, set `timeZone` to your time zone, for example `America/New_York`. It controls what "today" means for pace math. Each person's own workouts still use the date on their watch.
6. Click **Save**.

## 2. Run setup

1. Reload the sheet. A **Running Tracker** menu appears.
2. Click **Running Tracker → Setup**. Google asks you to authorize the script. Because the script is your own, you'll see "Google hasn't verified this app". Click **Advanced → Go to … (unsafe)** to continue.
3. Setup creates the tabs and a trigger that syncs Garmin every 3 hours.
4. On the **Settings** tab:
   - Change **Invite code** from `change-me` to something only your group knows.
   - Fill in **Group goal 2026**, and **Group goal 2027** if you know it, in run-equivalent miles.

## 3. Publish the sign-up page

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon, then **Web app**.
3. Set **Execute as** to **Me** and **Who has access** to **Anyone**.
4. Click **Deploy** and copy the **Web app URL**, which ends in `/exec`.

This one URL is both the sign-up page and the upload address for the Apple Shortcut.

> **When you change the code later**, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. That keeps the same URL. A *new* deployment creates a new URL, and everyone's Shortcut would break.

## 4. Test with your own data first

1. Open the web app URL and join with your own watch.
   - **Garmin**: make a key first (see [JOINING.md](JOINING.md)). Joining checks the key and backfills from Jan 1, 2026 right away.
   - **Apple Watch**: build the Shortcut ([APPLE_SHORTCUT.md](APPLE_SHORTCUT.md)), then do its one-time backfill run.
2. Check the **Activities**, **Weekly**, and **Annual** tabs, and look for errors in **Sync Log**.
3. If a Garmin activity you expected is missing, look at its type in Garmin Connect. Only run and ride types count, and e-bike types never do. The raw type name is kept in the **Type** column, so you can check what came through.

## 5. Invite friends

Send them the web app URL, the invite code, and [JOINING.md](JOINING.md). Share the sheet itself with **Viewer** access for anyone who wants to look at it.

## Day to day

- **Change someone's goal**: edit their **Annual Goal** cell on the Members tab. The new number applies to every year shown.
- **New year**: add a `Group goal 2027` row on Settings. Have people update their goal on Members.
- **"Needs new Garmin key"** on the Members tab means that person's key expired or was revoked. They make a new key and paste it into the **Update Garmin key** tab of the sign-up page, along with their member code.
- **Remove someone**: **Running Tracker → Remove a member…** Their old rows stay in Activities, but they drop out of the summaries, and their Garmin key is deleted.
- **Sync now**: **Running Tracker → Sync Garmin now**.

## For your Power Automate / Teams flow

Read from the **Weekly** tab (current week at the top) and the **Annual** tab (current year at the top). The `Group total` rows carry the group numbers. Column headers are stable.

## Known limits

- **Garmin Personal API**: launched October 2026. Garmin hasn't published rate limits or how far back history goes. Keys can be set to expire after up to 1 year.
- **Apple Watch indoor cycling** records no distance unless the bike is connected, so those rides add 0 miles. Garmin indoor rides with a speed sensor or smart trainer do record distance.
- **Apps Script quotas**: free accounts get 90 minutes of trigger runtime per day and 20,000 URL fetches per day. A group of about 15 people uses a small fraction of that.
