# Website on a static site (never sleeps)

On Render's free plan the **web service** sleeps after 15 idle minutes and
takes up to a minute to wake. A **static site** never sleeps. This setup
serves the website from a static site, so the homepage always loads
instantly, and leaves the backend (sign-in, requests, the database) on the
web service.

When someone opens any page, it quietly wakes the backend. If they sign in
before it's awake, they see *"Starting up the resident portal…"* and the
sign-in goes through by itself once it's ready.

**Nothing about the current setup is removed.** The web service keeps
serving the full site at `https://tsv-22a6.onrender.com` the whole time. The
switch is moving your domain from one to the other, and switching back is
moving it back.

---

## Set it up (about 15 minutes, all in Render plus one DNS record)

**1. Create the static site.** Render → **New** → **Static Site** → pick the
`tsv` repository, branch `main`.

| Field | Value |
|---|---|
| Name | `tsv-site` (any name works; the steps below assume this one) |
| Build Command | `bash scripts/build-static.sh` |
| Publish Directory | `frontend/build` |

Under **Environment Variables** (Advanced), add:

| Key | Value |
|---|---|
| `REACT_APP_API_URL` | `https://tsv-22a6.onrender.com/api` |

Use the address shown at the top of your web service's page if it differs.
Then **Create Static Site** and wait for the first deploy.

**2. Make page links work.** On the static site → **Redirects/Rewrites** →
**Add Rule**: Source `/*`, Destination `/index.html`, Action **Rewrite** →
Save. Without it, a link straight to a page like `/login` shows "Not Found".

**3. Let the backend accept the website.** On the **web service** →
**Environment** → add or edit `FRONTEND_URL`:

```
https://www.townsquarevillagenj.com,https://townsquarevillagenj.com,https://tsv-site.onrender.com
```

The first address is where links in emails point. Save, and let it redeploy.

**4. Test before touching your domain.** Open `https://tsv-site.onrender.com`.
The homepage should appear immediately. Sign in, open a request. If anything
is wrong, stop here. Your live site hasn't been touched yet.

**5. Move your domain.** This is the only step residents notice, a few
minutes of downtime.
1. **Web service** → **Settings** → **Custom Domains** → delete
   `townsquarevillagenj.com` and `www.townsquarevillagenj.com`.
2. **Static site** → **Settings** → **Custom Domains** → add both.
3. Render shows the DNS records it wants. In **IONOS** → your domain → **DNS**,
   change the `www` **CNAME** from `tsv-22a6.onrender.com` to
   `tsv-site.onrender.com`. Update the apex `A` record too if Render asks for
   a different IP than the one there now.
4. Wait for both domains to show **Verified** with a certificate. Usually
   minutes, sometimes up to an hour while DNS catches up.

Delete before adding: the free plan allows two custom domains, and this way
you never need more.

**6. Check.** Open `https://www.townsquarevillagenj.com` in a private window.

---

## Switch back to how it was

1. **Static site** → **Settings** → **Custom Domains** → delete both domains.
2. **Web service** → **Settings** → **Custom Domains** → add both back.
3. **IONOS** → change the `www` CNAME back to `tsv-22a6.onrender.com`, and
   the apex `A` record back if you changed it.

That's everything. The web service never stopped serving the full site, so
there is no code or deploy to undo. You can leave `FRONTEND_URL` as it is,
since it does no harm, and delete or **Suspend** the static site whenever you
like.

---

## Good to know

- **Signing in still needs the backend.** After a quiet spell, the first
  sign-in can wait up to a minute, with the notice showing. Removing that
  wait means paying for the web service (about $7/month).
- **Restoring the database** works the same either way. `DATABASE_URL` lives
  on the web service. See [RESTORE.md](../RESTORE.md).
- **Code changes** deploy to both automatically from `main`.
