import React, { useEffect, useState } from 'react';

import {
  canPromptInstall, isInstalled, promptInstall, subscribeInstall,
} from '../pwa';

const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

/**
 * "Get the app" card for the homepage. Where Chrome has offered to install
 * the site it is one button; everywhere else it says where the browser keeps
 * the same option. Once the site is running as the installed app it is gone.
 */
export default function InstallAppCard() {
  const [canPrompt, setCanPrompt] = useState(canPromptInstall);
  const [installed, setInstalled] = useState(isInstalled);

  useEffect(() => subscribeInstall(setCanPrompt), []);

  if (installed) return null;

  const install = async () => {
    if (await promptInstall()) setInstalled(true);
  };

  return (
    <div className="home-card">
      <h3>Get the app</h3>
      <p>
        Install Townsquare Village on your phone or computer to submit and follow
        requests in one tap.
      </p>
      {canPrompt ? (
        <button type="button" className="home-btn home-btn-primary" onClick={install}>
          Install the app
        </button>
      ) : (
        <p className="home-install-howto">
          {isIos()
            ? <>In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</>
            : <>In Chrome, open the <strong>&#8942;</strong> menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</>}
        </p>
      )}
    </div>
  );
}
