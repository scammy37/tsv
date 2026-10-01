import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ensureBackend } from './api/warmup';
import './index.css';

// Start waking the backend the moment anyone opens any page, homepage
// included. On a host that puts it to sleep, this is what makes it likely to
// be awake by the time somebody gets as far as signing in.
ensureBackend();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
