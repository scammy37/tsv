# Townsquare Village HOA

The association's public site and its service-request system, in one app.

Residents land on a public homepage, file maintenance requests and rules
violations, and follow them to resolution. Management triages, assigns and
closes them. Documents, payments and the calendar stay on the association's
existing resident portal, which the homepage links out to rather than
duplicating.

Built for Townsquare Village HOA, Inc. in Rockaway, New Jersey, but there is
nothing about it that is specific to one association beyond the name and the
homepage copy.

## Project structure

```
/frontend          React app: public homepage, resident portal, staff portal
/backend           Express API, PostgreSQL schema and migrations
/docs              Setup and deployment walkthroughs
```

## Tech stack

- **Frontend**: React 18, React Router 6, Axios, plain CSS (light + dark)
- **Backend**: Node.js, Express, JWT authentication, Joi validation
- **Database**: PostgreSQL
- **Email**: Resend over HTTPS, or nodemailer over SMTP (optional — the app runs without either)
- **Tests**: Jest + supertest, against a real PostgreSQL database

## Features

### Public homepage

`/` is open to anyone, signed in or not: who the association is, how to reach
the office, what to do in an emergency, and links out to the resident portal
run by Taylor Management. One obvious call to action — submit a request.

### Resident portal

- Submit a request with a category, priority, address and location
- Follow its status, who is handling it and how long it has been open
- Comment back and forth with management
- Correct a request's details until it is closed or cancelled
- Full history of everything that happened to it
- Email notification on submission, status change, reply and closure, sent
  from an address that is not monitored — the request itself is where replies
  belong, so a resident's answer cannot end up detached from it

### Staff and management

- Queue of every ticket, with quick views for open, closed, unassigned and all,
  and a sort that survives switching between them
- Filter by status, priority, category and assignee; free-text search;
  pagination
- Assign to staff, with each person's open workload shown in the picker
- Change priority and move status
- Internal notes the resident never sees, and never sees the existence of
- Reports: volume, average resolution and first-response time, per-category and
  per-assignee breakdowns, daily volume, and what is ageing
- People directory: promote, demote, deactivate, and issue a temporary password
- Email notice when somebody creates an account, to every manager and to
  `ADMIN_NOTIFY_EMAIL` — which can be a personal address, and need not be a
  user of the site

### Throughout

- Role-based access control (homeowner / staff / management), enforced in the
  API — the UI only mirrors it
- Enforced status transitions, so the audit trail cannot contain nonsense
- Ticket **age** with a 7-day attention threshold, published through
  `GET /api/meta` so a badge and a report can never disagree about it
- Append-only activity log on every ticket
- Self-service password reset, with single-use hashed tokens that expire in an
  hour
- Management-issued temporary passwords for residents who are locked out,
  forced to be replaced at first sign-in — the way back in where outbound SMTP
  is blocked
- JWT authentication. Deactivating an account, or changing its password,
  invalidates its existing sessions immediately
- Every notification recorded in `email_logs`, sent or not

## Try it without installing anything

On GitHub, click **Code → Codespaces → Create codespace on this branch** and
wait a couple of minutes. The devcontainer starts PostgreSQL, installs
dependencies, applies the schema, loads demo data and builds the frontend, then
serves the whole app on port 5000. Click the globe icon next to port 5000 in the
**Ports** tab to open it.

Demo accounts (password `Password123!`):

| Account | Role | What you see |
|---|---|---|
| `manager@demo.test` | management | Triage queue, reports, people directory |
| `sam@demo.test` | staff | Assigned work, internal notes |
| `dana@demo.test` | homeowner | Only their own requests |

Sign in as the manager and the resident in two browser profiles to watch both
sides of the same ticket. The seeded data includes tickets that have been open
a while, an internal note and closed work, so the reports page has something
to show.

Codespaces is free for a monthly allowance on personal accounts, and the
codespace stops on its own when idle.

## Getting started locally

See **[docs/SETUP.md](docs/SETUP.md)** for the full walkthrough. The short
version:

```bash
createdb tsv_db

cd backend && npm install && cp .env.example .env
# set DB_PASSWORD, JWT_SECRET and STAFF_INVITE_CODE in .env
npm run migrate && npm run dev

cd ../frontend && npm install && cp .env.example .env && npm start
```

Then register at <http://localhost:3000/register>. Management signup needs the
`STAFF_INVITE_CODE` you put in `backend/.env`. Or run `npm run seed` in
`backend` to load the same demo accounts the Codespace uses.

## Deploying

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. The app deploys as one
service: the API serves the built frontend, so there is one process, one port
and one origin. `render.yaml` provisions the service and its database on Render
in one step; the same build and run commands work on any host that provides
`DATABASE_URL`.

Two things to do before real residents use it:

1. **Create the first manager** with `npm run create-admin`, not the demo seed.
2. **Configure email and prove it works.** Notifications fail silently by
   design, so with no working transport nobody is ever notified of anything
   and the emailed password reset never arrives.

   Several hosts block outbound SMTP entirely. Render does: every port and
   provider tried from there timed out, which is the connection never opening
   rather than a credential being refused, so no mail account can fix it.
   Set `RESEND_API_KEY` and `MAIL_FROM` and the app sends over HTTPS instead.
   See [`backend/README.md`](backend/README.md#email-transports).

   Until either transport is configured, management can hand out temporary
   passwords from the People page.

The app deliberately refuses to start under `NODE_ENV=production` with a
missing, short or placeholder `JWT_SECRET`, no database configuration, or a
placeholder `STAFF_INVITE_CODE`. A boot failure there is the guard working.

## Development

- API reference, role matrix and ticket lifecycle:
  [`backend/README.md`](backend/README.md)
- `cd backend && npm test` runs the integration suite against a `tsv_test`
  database, created and migrated automatically.
- `cd backend && npm run backup` dumps the database to `backups/` with
  `pg_dump`, and `npm run export` writes the same data as JSON for machines
  without matching PostgreSQL client tools. `npm run restore` loads an export
  back. Run one before any plan change or migration, and before a free
  database expires — an expired one cannot be dumped. See
  [`backend/README.md`](backend/README.md#backups).
- `cd frontend && npm run build` produces the static bundle the API serves.
  CI builds with `CI=true`, which turns lint warnings into errors.

### Frontend routes

| Path | Who | Page |
|---|---|---|
| `/` | anyone | Public homepage |
| `/login`, `/register` | anyone | Sign in / resident signup |
| `/forgot-password`, `/reset-password` | anyone | Emailed reset flow |
| `/dashboard` | homeowner | Their requests |
| `/dashboard` | staff, management | Triage queue with filters, search, pagination |
| `/tickets/new` | signed in | Submit a request |
| `/tickets/:id` | anyone with access | Detail, conversation, activity; triage panel for staff |
| `/reports` | staff, management | Volume, timing and workload |
| `/users` | management | Directory, role changes, deactivation, password resets |
| `/profile` | signed in | Name, address, phone, password |

`/tickets` redirects to `/dashboard`; anything unmatched renders Not Found.

`/dashboard` renders a different view per role rather than redirecting, so both
audiences share one bookmark. An account on a temporary password gets the
change-password screen instead of whatever it asked for, at every protected
route.

A few things worth knowing before editing it:

- **`ProtectedRoute` gates by role, but the API enforces the same rules.** The
  UI is a convenience, not the boundary.
- **Categories, priorities and statuses come from `GET /api/meta`**, so adding
  a category server-side needs no frontend change.
- **A 401 on any call clears the token and returns to login.**
- **Light and dark both ship**, following the OS setting. Colours are defined
  once as custom properties in `src/index.css`.
- **Single column below 860px**, no horizontal scrolling at 390px.

### Two things that will bite you

**`npm ci` in the frontend needs `--include=dev`.** Managed hosts set
`NODE_ENV=production` for the whole build, and npm reads that as `omit=dev`.
Without the flag `react-scripts` is never installed and the build fails with
`react-scripts: not found`. `scripts/build.sh` passes it; the CI job does not
need it because it does not set `NODE_ENV`.

**`frontend/package.json` pins `typescript` to `^4.9.5` in `overrides`.** The
project has no TypeScript. The pin exists because `react-scripts@5.0.1`
declares an optional peer of `^3.2.1 || ^4` while a transitive peer accepts
`>= 2.7`; without it npm hoists a much newer TypeScript and `npm ci` then
rejects the lockfile as out of sync, so CI cannot install at all. Remove the
pin only alongside an upgrade off `react-scripts` 5.

## License

MIT
