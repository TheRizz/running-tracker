# Joining the running tracker

You need the **sign-up link** and the **invite code** from the organizer.

When you join, you set an **annual goal in run-equivalent miles**. Run miles count 1:1, and bike miles count ⅓ (3 bike miles = 1 run mile). E-bike rides don't count, and there's no manual entry. Only workouts recorded on your watch count.

## If you have a Garmin watch (iPhone or Android)

1. On a computer, go to **connect.garmin.com**, sign in, and open [Settings → Personal API Token](https://connect.garmin.com/app/settings/personalApiToken).
2. Click **Create Key**, choose the **1 year** expiry, and copy the key. It's shown only once.
3. Open the sign-up link, enter the invite code, your name, and your goal, choose **Garmin**, and paste the key.
4. Click **Join**. Your workouts since Jan 1, 2026 load right away, and new ones sync every 3 hours.
5. **Save the member code** the page shows you. When your Garmin key expires, make a new one and paste it into the sign-up page's **Update Garmin key** tab with that code.

The key gives read-only access to your Garmin data. It's stored privately in the organizer's script, never in the shared sheet, and only run and bike totals are saved. You can revoke it at any time on the same Garmin settings page.

## If you have an Apple Watch

1. Open the sign-up link on your iPhone, enter the invite code, your name, and your goal, and choose **Apple Watch**.
2. The page shows an **Upload URL** and a **member code**. Keep that page open, or copy both somewhere safe.
3. Install the free **[Actions](https://apps.apple.com/app/id1586435171)** app from the App Store. The Shortcut needs it to read your workouts.
4. Follow [APPLE_SHORTCUT.md](APPLE_SHORTCUT.md) to set up the Shortcut, or install the shared version if the organizer sent you a link.
5. Run the Shortcut once by hand in **backfill** mode to load everything since Jan 1, 2026. After that, it runs by itself at noon and midnight.

Only workout type, date, and distance are sent: no routes, heart rate, or other health data.
