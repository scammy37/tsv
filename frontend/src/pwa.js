/**
 * The installable-app side of the site: registers the service worker, and
 * keeps hold of Chrome's install prompt so the homepage can offer an
 * "Install the app" button at a moment of its choosing.
 */

// True when the site was opened from its home-screen icon.
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(Boolean(deferredPrompt)));

export const canPromptInstall = () => Boolean(deferredPrompt);

export const subscribeInstall = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Shows Chrome's install dialog. Resolves true if the user accepted. */
export const promptInstall = async () => {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  notify();
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted';
};

export function registerPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Hold the prompt for our own button instead of Chrome's mini-infobar.
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });

  // Development builds change on every save; a worker caching them would
  // only cause confusion.
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // The site works the same without it; only installability is lost.
      });
    });
  }
}
