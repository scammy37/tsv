import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ensureBackend } from './api/warmup';
import { registerPwa } from './pwa';
import './index.css';

// Start waking the backend the moment anyone opens any page, homepage
// included. On a host that puts it to sleep, this is what makes it likely to
// be awake by the time somebody gets as far as signing in.
ensureBackend();

// Makes the site installable as an app from Chrome's menu or our own button.
registerPwa();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
