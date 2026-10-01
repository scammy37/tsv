import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { getWarmupState, subscribeWarmup } from '../api/warmup';

/**
 * Says the portal is starting, instead of leaving a button that seems to do
 * nothing for a minute while a sleeping backend wakes up.
 *
 * Not shown on the homepage: nothing there needs the backend, and a resident
 * who only came for the office's phone number has no reason to see it.
 */
export default function WarmupNotice() {
  const [state, setState] = useState(getWarmupState);
  const { pathname } = useLocation();

  useEffect(() => {
    const unsubscribe = subscribeWarmup(setState);
    // The check starts before the page renders, so it can change state in the
    // gap between this component's first render and this effect subscribing.
    // Catch up on anything missed there.
    setState(getWarmupState());
    return unsubscribe;
  }, []);

  if (pathname === '/' || (state !== 'waking' && state !== 'unreachable')) return null;

  return (
    <div className="warmup" role="status">
      {state === 'waking' ? (
        <>
          <span className="warmup-dot" aria-hidden="true" />
          Starting up the resident portal. After a quiet spell this takes up to a
          minute. Anything you submit will go through as soon as it is ready.
        </>
      ) : (
        <>
          The resident portal is not responding. Please try again in a few
          minutes, or call the office at <a href="tel:+19733284015">973-328-4015</a>.
        </>
      )}
    </div>
  );
}
