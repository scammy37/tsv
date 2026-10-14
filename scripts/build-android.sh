#!/usr/bin/env bash
# Builds the Android app (an APK) from the same React frontend as the website,
# packaged with Capacitor. The app carries its own copy of the pages and talks
# to the live backend over HTTPS. See docs/ANDROID.md.
#
# Needs JDK 21 and the Android SDK (ANDROID_HOME). The GitHub Actions
# workflow .github/workflows/android.yml runs this, so nobody has to install
# either to get an APK.
set -euo pipefail

cd "$(dirname "$0")/.."

# The app is not served by the backend, so it needs the backend's full
# address. The backend's own Render address is used rather than the public
# domain, because the domain may point at the static site, which has no API.
export REACT_APP_API_URL="${REACT_APP_API_URL:-https://tsv-22a6.onrender.com/api}"
BUILD_TYPE="${1:-debug}"

echo "==> Installing frontend dependencies"
npm --prefix frontend ci --include=dev

echo "==> Building the app's pages against ${REACT_APP_API_URL}"
npm --prefix frontend run build

echo "==> Copying them into the Android project"
(cd frontend && npx cap sync android)

echo "==> Building the ${BUILD_TYPE} APK"
if [ "$BUILD_TYPE" = release ]; then
  (cd frontend/android && ./gradlew --no-daemon assembleRelease)
else
  (cd frontend/android && ./gradlew --no-daemon assembleDebug)
fi

echo "==> Done:"
find frontend/android/app/build/outputs/apk -name '*.apk'
