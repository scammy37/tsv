import { API_BASE } from './base';

/**
 * Wakes the backend and holds API calls until it answers.
 *
 * On a free host the backend sleeps after fifteen idle minutes and takes up
 * to a minute to come back. The site itself may be served from somewhere that
 * never sleeps, so the page is on screen long before the API can answer it.
 * Rather than let the first sign-in fail -- or worse, have the stored session
 * thrown away because checking it failed -- every API call waits here until a
 * health check succeeds.
 *
 * When the backend served this page itself it is plainly awake, the first
 * check answers at once, and nothing here is visible.
 */

const POLL_MS = 3000;
const CHECK_TIMEOUT_MS = 10000;
const GIVE_UP_MS = 120000;
// Only show "starting up" if the first check is slow; a quick answer should
// never flash a notice.
const NOTICE_AFTER_MS = 1500;
// The host sleeps after fifteen idle minutes. Anything that answered within
// the last ten is still awake, so there is no need to ask again.
const FRESH_MS = 10 * 60 * 1000;

let state = 'unknown'; // unknown | waking | ready | unreachable
let lastOk = 0;
let pending = null;
const listeners = new Set();

const setState = (next) => {
  if (state === next) return;
  state = next;
  listeners.forEach((fn) => fn(state));
};

export const getWarmupState = () => state;

export const subscribeWarmup = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Called on any reply from the API itself: proof it is awake. */
export const markApiAlive = () => {
  lastOk = Date.now();
  setState('ready');
};

/** Called when a request got no reply at all, so the next one checks first. */
export const markApiUnreachable = () => {
  lastOk = 0;
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const checkOnce = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return false;
    // While the host is still starting the service it can answer with a page
    // of its own, so a 200 alone is not proof. The API's answer is.
    const body = await res.json().catch(() => null);
    return body?.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const poll = async () => {
  const started = Date.now();
  const notice = setTimeout(() => { if (state !== 'ready') setState('waking'); }, NOTICE_AFTER_MS);
  try {
    while (Date.now() - started < GIVE_UP_MS) {
      // eslint-disable-next-line no-await-in-loop
      if (await checkOnce()) {
        markApiAlive();
        return;
      }
      setState('waking');
      // eslint-disable-next-line no-await-in-loop
      await sleep(POLL_MS);
    }
    // Let the caller's request go ahead and fail on its own terms, with its
    // own error, rather than inventing one here.
    setState('unreachable');
  } finally {
    clearTimeout(notice);
  }
};

/** Resolves once the API is answering, or once it has been given long enough. */
export const ensureBackend = () => {
  if (state === 'ready' && Date.now() - lastOk < FRESH_MS) return Promise.resolve();
  if (!pending) pending = poll().finally(() => { pending = null; });
  return pending;
};
