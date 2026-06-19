# Family Lake House — PWA

A shared, installable web app for coordinating who's at the lake house. Full-year
calendar and list views, names shown right on the calendar, and a built-in change
log that records every add, edit, and delete with who made it.

Everyone opens the same URL on their phone, taps "Add to Home Screen," and sees the
same live schedule. Changes sync across devices through a small free backend (Supabase).

---

## What's in this folder

| File | What it is |
|------|------------|
| `index.html` | The page shell |
| `app.js` | The whole app |
| `styles.css` | Styling |
| `config.js` | **You edit this** — your Supabase URL + key go here |
| `manifest.webmanifest` | Makes it installable as an app |
| `service-worker.js` | Lets it open offline |
| `icon-192.png`, `icon-512.png` | Home-screen icons |
| `schema.sql` | Database setup, run once in Supabase |

---

## Setup (about 15 minutes, one time)

### 1. Create a free Supabase project
1. Go to supabase.com and sign up.
2. Create a new project. Pick any name and a strong database password.
3. Wait a minute for it to finish provisioning.

### 2. Create the tables
1. In the project, open **SQL Editor → New query**.
2. Open `schema.sql` from this folder, copy all of it, paste it in, and click **Run**.
3. You should see "Success."

### 3. Connect the app
1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `config.js` in this folder and paste them in, replacing the placeholder text.
   Save the file.

### 4. Put the files online at your domain
Upload the entire contents of this folder to your web host so it's reachable at your
chosen address, for example `https://eyeintheskyuas.com/lakehouse/`.

- Any static host works (your existing host, Netlify, Cloudflare Pages, GitHub Pages).
- Keep all files together in the same folder. The app uses relative paths, so it works
  whether it lives at the site root or in a subfolder.
- **HTTPS is required** for a PWA to install and for the service worker to run. Your
  domain already serves HTTPS, so you're set.

### 5. Install it on phones
On each family member's phone, open the URL in Safari (iPhone) or Chrome (Android) and
choose **Add to Home Screen**. It then opens like a normal app, full screen, with its
own icon.

---

## Using it

- **+ Add a stay** — add everyone by name (type a name, tap Add; repeat), set arrive and
  leave dates, optionally note what they're bringing or flag the whole house.
- **Calendar** — every person's name appears on each day they're there, color-coded.
  Tap a day to see details or add a stay. Overlaps are welcome; the more the merrier.
- **List** — upcoming stays grouped by month, with past stays below.
- **Activity** — the change log. Every add, edit, and delete, with who did it and when.
- **Export** — tap Export for two options: an Excel spreadsheet of every stay plus the change log, or a calendar file (.ics) that imports into Apple Calendar, Google Calendar, or Outlook. Handy as your own backup copy, since the free Supabase tier has no automatic backups.

The first time someone makes a change, the app asks for their name. That name is stored
on their device and attached to their entries in the Activity log. They can change it any
time from the link under the house name.

---

## The house password

The app opens to a password screen. The password is **pleasantlake**. It's stored in
`app.js` near the bottom (`const PASSWORD = "pleasantlake"`); change that line to set a
different one. Once someone enters it correctly, their device stays unlocked, so they
only type it once.

On a phone, the password screen uses a proper login form, so **Safari and Apple Passwords
will offer to save it** the first time, then autofill it afterward. (This save/autofill
only works on your real HTTPS site in Safari or once installed to the home screen, not
inside an in-app preview.)

A note on what this protects: the password is a light gate that keeps the schedule
private from anyone who stumbles onto the link. It is not strong security, since the
check happens in the browser. For a private family tool that's the right level. If you
ever want real protection (a true login per person), Supabase Auth can do it and I can
wire it up.

---

## Updating the app later

If you change any app file, bump the cache name in `service-worker.js` (for example
`lakehouse-v1` → `lakehouse-v2`) so phones pick up the new version on next open.
