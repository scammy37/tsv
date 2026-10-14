# The app

Residents, staff and management can install Townsquare Village as an app,
on a phone or a computer. The app is the website itself, so there is nothing
to download from a store, nothing to approve, and nothing to update.

## Installing it

On an Android phone:

1. Open **townsquarevillagenj.com** in **Chrome**.
2. Tap **Install the app** in the *Get the app* box on the homepage, or open
   Chrome's **⋮** menu and tap **Install app** (on some phones, **Add to Home
   screen**).
3. A gold Townsquare Village icon appears on the home screen. It opens
   full-screen, without the browser's address bar, straight to *My requests*.
   Pressing and holding the icon offers **New request** as a shortcut.

On an iPhone the same works from Safari: **Share → Add to Home Screen**.

On a computer, in Chrome or Edge: click **Install the app** on the homepage,
or the install icon at the right of the address bar. It then opens in its own
window and can be pinned to the taskbar or Dock like any other program.

Things worth knowing:

- **It is always up to date.** The installed app is the website, so every
  change pushed to `main` reaches everyone's phone the next time they open it.
  There is nothing to update.
- **It needs a connection to do anything.** With no signal it still opens and
  shows its pages, but requests and comments are always fetched live, never
  from a stored copy, so nobody is shown an out-of-date status.
- **Staying signed in** works the same as in the browser.

Suggested wording for a notice or email to residents:

> You can now put Townsquare Village on your phone's home screen. Open
> townsquarevillagenj.com in Chrome (Android) or Safari (iPhone) and tap
> "Install the app", or choose "Add to Home screen" from the browser menu.

### How it works

| File | What it does |
|---|---|
| `frontend/public/manifest.webmanifest` | The app's name, icon, colours and start page |
| `frontend/public/sw.js` | Service worker: lets Chrome offer "Install", and lets the app open offline. Never caches `/api` |
| `frontend/public/icons/` | App icons. `icon.svg` is the source; the PNGs are rendered from it |
| `frontend/src/pwa.js` | Registers the service worker, holds Chrome's install prompt |
| `frontend/src/components/InstallAppCard.js` | The *Get the app* box on the homepage |

To force every installed copy to drop what it has stored (rarely needed),
change `VERSION` at the top of `sw.js`.
