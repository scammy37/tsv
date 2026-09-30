# Recovery

How to bring this back after the database is gone — expired, deleted, or
moved to another host. Written to be followed by somebody who was not there
when it was first set up.

## What survives on its own, and what does not

| | Where it lives | Survives the database being deleted? |
|---|---|---|
| Application code | GitHub | Yes |
| Database **structure** | `backend/db/schema.sql` | Yes — rebuilt by `npm run migrate` |
| Database **contents** | a backup file | **Only if you have one** |
| Environment variable values | the host's dashboard | **No** — see the checklist below |
| The domain and its DNS | IONOS | Yes |

Two of those five are not in the repository. They are the whole risk.

## Before anything goes wrong

**Find the most recent backup email.** The server emails one to
`ADMIN_NOTIFY_EMAIL` as a `.json` attachment whenever the last one is over a
day old. Search that mailbox for `Backup of`. If nothing is there, the
automatic backup is not running — fix that first, or take one by hand from
**People → Download a backup**.

**Write the environment values down** somewhere that is not the host. The
checklist is at the bottom of this file. The backup does not contain them.

## Render's free database expires

A free PostgreSQL instance is removed **30 days after it is created**. There
is then a 14-day grace period in which the only way back in is upgrading to a
paid plan, and after that Render deletes it along with its data.

**An expired database cannot be exported.** The backup has to exist before the
deadline, not after the problem. Upgrading to the smallest paid plan before it
lapses avoids the whole scenario.

## Rebuilding

### 1. A new database

Create one on Render (or anywhere). The name does not matter — the app reads
`DATABASE_URL` and nothing else, so `tsv-db-2` or any other name is fine, and
nothing in the code refers to the old one. Point the service's `DATABASE_URL`
at the new instance.

If you create it from `render.yaml` as a Blueprint, change the name under
`databases:` and the matching `fromDatabase.name` together, or Render will
look for a database that no longer exists.

### 2. The structure

```bash
cd backend
npm install
echo 'DATABASE_URL=<the new connection string>' > .env
npm run migrate
```

No PostgreSQL client tools are needed — this runs through the app's own
driver. A GitHub Codespace on this repository (**Code → Codespaces → Create
codespace**) gives you a terminal with Node already installed, so nothing has
to be installed on a laptop and the connection string never leaves the
browser.

### 3. The contents

Download the `.json` attachment from the backup email, then:

```bash
npm run restore -- <that file>
```

It runs in one transaction — either everything lands or nothing does — and
refuses a database that already has rows unless given `--force`. It restores
ids and sequence positions, so accounts keep their identity and the next
ticket number carries on rather than repeating one that already exists.

### 4. The environment values

Set these on the service, from your own record of them. Everything except
`JWT_SECRET` and `DATABASE_URL` has to come from you.

| Variable | What it is | If you lost it |
|---|---|---|
| `DATABASE_URL` | the new database | From the new instance |
| `JWT_SECRET` | signs login sessions | Generate a new random one. Everyone is signed out once; nothing else breaks |
| `NODE_ENV` | `production` | — |
| `SERVE_FRONTEND` | `true` | — |
| `RESEND_API_KEY` | sends all email over HTTPS | Issue a new sending-only key in Resend |
| `MAIL_FROM` | the unmonitored sender address | Must be on a domain verified with Resend |
| `ADMIN_NOTIFY_EMAIL` | where signup alerts and backups go | Your own address |
| `OFFICE_EMAIL` | quoted as the way to reach a person | `office@townsquarevillagenj.com` |
| `STAFF_INVITE_CODE` | see below | Leave blank once managers exist |

`FRONTEND_URL` needs nothing on Render: the app falls back to
`RENDER_EXTERNAL_URL`, so emailed links point at the real deployment from the
first boot.

### 5. Getting back in

**If you restored a backup, you are already in** — the manager accounts and
their passwords came back with it. Sign in as normal.

**If you are building from nothing**, there is a trap worth knowing about. The
first manager is normally made with `npm run create-admin`, which needs a
server shell, and Render's Shell tab is a paid feature. The alternative is the
invite code — but `render.yaml` deliberately ships without one, so staff
registration is refused outright and neither route works on a fresh free
instance.

So, in that order:

1. Set `STAFF_INVITE_CODE` to a long random string on the service, and let it
   redeploy.
2. Register at `/register`, choosing Management, and enter that code.
3. **Clear `STAFF_INVITE_CODE` again.** While it has a value, anyone who
   guesses it can make themselves a manager.

Or, from a Codespace pointed at the new database:

```bash
cd backend && npm run create-admin -- you@example.com "Your Name"
```

which prints a password once and needs no invite code at all.

## Checking it actually worked

1. `/api/health` returns `{"status":"ok"}`.
2. Sign in as a manager. If you restored, an old password should work — that
   is the strongest single sign that the restore was real.
3. The ticket list shows the requests you expect, with their original numbers.
4. File a test request. Its number should follow the highest existing one, not
   repeat it.
5. Check the Render log for `Email: ready via Resend over HTTPS`.
6. Within a day, a fresh backup email should arrive on its own.

## Moving to another host entirely

Nothing here is Render-specific. Any host that runs Node 22, provides
`DATABASE_URL` and serves one port will do: build with `bash scripts/build.sh`,
start with `npm --prefix backend start`. The restore step is identical. See
[DEPLOYMENT.md](DEPLOYMENT.md).
