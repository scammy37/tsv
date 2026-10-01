#!/usr/bin/env bash
# Build step for hosting the website as a static site, separate from the
# backend. The static site never sleeps, so the homepage loads instantly even
# while the backend is asleep. See docs/STATIC-SITE.md.
#
# The backend still serves the full site at its own address too (via
# scripts/build.sh), which is what makes switching back a domain change only.
set -euo pipefail

cd "$(dirname "$0")/.."

# Without this the bundle would quietly point at localhost and every sign-in
# would fail. Refuse to build rather than ship that.
: "${REACT_APP_API_URL:?Set REACT_APP_API_URL to the backend, e.g. https://tsv-22a6.onrender.com/api}"

echo "==> Installing frontend dependencies"
# --include=dev: hosts set NODE_ENV=production for builds, which npm reads as
# omit=dev, and react-scripts is a devDependency. Same reason as build.sh.
npm --prefix frontend ci --include=dev

echo "==> Building the website against ${REACT_APP_API_URL}"
npm --prefix frontend run build

echo "==> Done: publish frontend/build"
