# Restoring the site after the database expires

Render deletes a free database 30 days after it is created. The current one,
`tsv-db-2`, expires on **17 November 2026**. The code, the table layout and
the settings are safe; only the data is lost. This page puts it all back.

**Takes about 15 minutes. You need:** your Render login, your GitHub login,
and your backup file: the `.json` attached to the **newest** email titled
**"Backup of Townsquare Village HOA — tsv-…"**. Search Gmail for
`"Backup of Townsquare Village HOA"` and take the most recent; the date is in
the file name. Download the attachment before you start. Without a backup
file the site comes back empty and you skip Part 3.

**To get a fresh backup** while the database is still running: ask for one,
and the date in `BACKUP_REQUEST` in `backend/server.js` is changed and pushed.
The next deploy emails a new backup to `ADMIN_NOTIFY_EMAIL`, once. The
database must not have expired yet.

---

## Part 1: Create a new database (Render)

1. Render dashboard → **New** → **Postgres**.
2. Give it any name, for example `tsv-db-3`. Choose the **Free** plan (or the
   paid one so it never expires again) → **Create Database**.
   - If Render refuses a second free database, delete the old expired
     one first. Render allows one free database at a time.
3. Wait until its status says **Available**.

## Part 2: Connect the site to it (Render)

1. On the new database, click **Connect** → **Internal** tab → copy the URL.
2. Open the **web service `tsvnj`** (address `tsv-22a6.onrender.com`), which
   is the backend. Not the database, and not the static site `tsv-site`.
   → **Environment**.
3. Edit `DATABASE_URL` → paste the new URL → **Save Changes**.
4. The site redeploys on its own, and the deploy creates all the tables. Wait
   for **Live**. If it doesn't start, use **Manual Deploy → Deploy latest
   commit**.
5. Check: open `https://tsv-22a6.onrender.com/api/health`. It should
   show `"status":"ok"`.

Leave every other setting alone. They belong to the site, not the database,
so they survived. The static site `tsv-site`, which serves the homepage,
needs nothing at all during a restore.

## Part 3: Load your backup file (GitHub Codespace)

Skip this part if you have no backup file.

1. On the new database in Render: **Connect** → **External** tab → copy the
   URL. (External this time, because the Codespace is outside Render.)
2. On the GitHub repository page: green **Code** button → **Codespaces** tab
   → **Create codespace on main**. Wait 2–3 minutes until the terminal at the
   bottom is ready.
3. In the file list on the left, right-click → **New Folder** → name it
   `backups`, all lower case (the Codespace treats `Backups` as a different
   folder). Drag your `.json` backup file from your computer into it.
4. Click in the terminal, paste this whole line, and press **Enter**. Change
   the file name at the end if your backup has a different one:

   ```bash
   cd backend; read -p "Paste the database address, then press Enter: " U; echo "DATABASE_URL=$U" > .env; npm run restore -- ../backups/tsv-2026-10-13_11-01-59.json --force
   ```

   When it asks, paste the **External** URL from step 1 and press **Enter**.
   `--force` is needed because the site writes a log row into the new
   database the moment it starts.

5. It should end with `Restored N rows`.
6. Delete the Codespace: GitHub → **Code** → **Codespaces** → **…** →
   **Delete**. This removes the file and the database URL from it. Neither
   was ever uploaded to GitHub.

**Done.** Sign in with your usual manager email and password. All accounts,
passwords and tickets are back.

---

## No backup file? Make your manager account again

The site starts empty. Creating the first manager needs an invite code:

1. Web service `tsvnj` → **Environment** → add `STAFF_INVITE_CODE` with any long
   random value → **Save**. Wait for the redeploy.
2. On the site: **Create an account** → role **Management** → enter the code.
3. Back in **Environment**, **delete** `STAFF_INVITE_CODE`. While it is set,
   anyone who guesses it can make themselves a manager.
4. Homeowners register themselves as usual.

---

## If something is wrong

| What you see | Fix |
|---|---|
| Site shows an error or won't deploy | Web service → **Logs**. A database error means `DATABASE_URL` is wrong: re-copy the **Internal** URL (Part 2) |
| `restore` can't connect | You used the Internal URL. The Codespace needs the **External** one (Part 3, step 1) |
| `restore` says no such file | Check the file is in `backups` and the name in the command matches exactly |
| Can't sign in after restoring | The restore didn't finish. Run step 4 again |
| No emails arrive | Nothing to do with the database. Check `RESEND_API_KEY` is still set under **Environment** |

## Settings the site needs (for reference)

Web service → **Environment**. Only `DATABASE_URL` changes during a restore.

`DATABASE_URL` · `NODE_ENV=production` · `SERVE_FRONTEND=true` · `JWT_SECRET` ·
`RESEND_API_KEY` · `MAIL_FROM` · `ADMIN_NOTIFY_EMAIL` · `OFFICE_EMAIL`

**To never need this page again:** upgrade the database to Render's paid plan
(about $6/month). Paid databases don't expire.
