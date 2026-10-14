# The app on Android phones

Residents, staff and management can have Townsquare Village as an app on
their phone. There are two ways to get it, and they share the same code: the
website itself.

## 1. Install it from the website (what residents do)

Nothing to download from a store and nothing to approve. On an Android phone:

1. Open **townsquarevillagenj.com** in **Chrome**.
2. Tap **Install the app** in the *Get the app* box on the homepage, or open
   Chrome's **⋮** menu and tap **Install app** (on some phones, **Add to Home
   screen**).
3. A gold Townsquare Village icon appears on the home screen. It opens
   full-screen, without the browser's address bar, straight to *My requests*.
   Pressing and holding the icon offers **New request** as a shortcut.

On an iPhone the same works from Safari: **Share → Add to Home Screen**.

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

## 2. A real Android app file (APK), for later

`frontend/android/` is a [Capacitor](https://capacitorjs.com) project that
packages the same pages as a genuine Android app. It is there so that putting
the app on the **Google Play Store**, or adding phone features such as push
notifications or photos from the camera, does not mean starting over.

### Getting an APK

**Public download link** (always the newest published version):
<https://github.com/scammy37/tsv/releases/latest/download/townsquare-village.apk>

A new version is published only when someone asks for one: GitHub →
**Actions** → **Android app** → **Run workflow**. That builds the app from
`main` and creates a release named *Townsquare Village app 1.N*. All of them
are listed under the repository's **Releases**.

Every push to `main` that changes the frontend also builds an APK, as a check
that the app still builds. That copy is not published; it is attached to the
run under **Artifacts** (sign-in required, kept 90 days).

To install the APK, a resident downloads it on their phone, opens it, and
allows their browser to "install unknown apps" when Android asks.

### Signing, and why updates may need an uninstall

Android only installs a new version over an old one if both are signed with
the same key. Until the association has its own key, published APKs are
signed with a throwaway debug key that changes from build to build, so
**installing a newer release means uninstalling the old one first**. To fix
that for good, create an upload key once and add it as four repository
secrets (GitHub → Settings → Secrets and variables → Actions):

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks     # the value for ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 text above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

Keep `upload.jks` and its passwords somewhere safe outside this repository:
losing them means residents must reinstall, and the same key is what the Play
Store will ask for. The workflow uses it automatically once the secrets exist.

To build on your own computer instead (needs JDK 21 and Android Studio):

```bash
bash scripts/build-android.sh          # debug APK
bash scripts/build-android.sh release  # release APK
```

or open `frontend/android` in Android Studio after running
`npx cap sync android` in `frontend/`.

### How the APK reaches the backend

The app carries its own copy of the pages, so it calls the backend at its full
address, `https://tsv-22a6.onrender.com/api` by default. Set
`REACT_APP_API_URL` when building to use another. The backend always accepts
calls from the app (`https://localhost`, see `corsOrigins` in
`backend/config/index.js`), so no Render setting needs changing.

Unlike the installed website, the APK does **not** update itself: the pages
inside it are the ones it was built with. That is why the website install
above is the recommended way for residents today.

### Going to the Play Store (when ready)

1. Create a Google Play developer account (one-time US$25).
2. Create an upload key and add a signing config to
   `frontend/android/app/build.gradle`. Keep the key file and its passwords
   out of this repository; store them as GitHub Actions secrets.
3. Build an App Bundle (`./gradlew bundleRelease` in `frontend/android`) and
   upload it in the Play Console.
