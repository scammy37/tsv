# Restoring the site after the database expires

Render deletes a free database 30 days after it is created. The current one,
`tsv-db`, expires on **17 October 2026**. The code, the table layout and
the settings are safe; only the data is lost. This page puts it all back.

**Takes about 15 minutes. You need:** your Render login, your GitHub login,
and your backup file. That's the `.json` attached to the email
**"Backup of Townsquare Village HOA — tsv-2026-09-29_02-58-43.json"**
(starred in the Gmail inbox). Download the attachment before you start.
Without a backup file the site comes back empty and you skip Part 3.

---

## Part 1: Create a new database (Render)

1. Render dashboard → **New** → **Postgres**.
2. Give it any name, for example `tsv-db-2`. Choose the **Free** plan (or the
   paid one so it never expires again) → **Create Database**.
   - If Render refuses a second free database, delete the old expired
     `tsv-db` first. Render allows one free database at a time.
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
   `backups`. Drag your `.json` backup file from your computer into it.
4. In the terminal, run these one at a time. Paste your External URL between
   the quotes and put in your backup file's real name:

   ```bash
   cd backend
   echo 'DATABASE_URL=<External URL>' > .env
   npm run restore -- ../backups/<backup file name>.json
   ```

5. It should end with `Restored N rows`.
   - If it says **the database already has rows**, someone registered after
     Part 2. Run the last line again with ` --force` at the end.
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
| Can't sign in after restoring | The restore didn't finish. Run it again with ` --force` |
| No emails arrive | Nothing to do with the database. Check `RESEND_API_KEY` is still set under **Environment** |

## Settings the site needs (for reference)

Web service → **Environment**. Only `DATABASE_URL` changes during a restore.

`DATABASE_URL` · `NODE_ENV=production` · `SERVE_FRONTEND=true` · `JWT_SECRET` ·
`RESEND_API_KEY` · `MAIL_FROM` · `ADMIN_NOTIFY_EMAIL` · `OFFICE_EMAIL`

**To never need this page again:** upgrade the database to Render's paid plan
(about $6/month). Paid databases don't expire.
