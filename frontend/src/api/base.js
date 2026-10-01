// Where the API lives. Same-origin `/api` when the backend serves this bundle
// itself; an absolute URL when the site is hosted separately as a static site
// and the backend lives elsewhere. Set at build time, see scripts/.
export const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
