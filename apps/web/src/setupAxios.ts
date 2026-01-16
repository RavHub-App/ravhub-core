import axios from 'axios';

// Ensure axios has the correct baseURL before any component runs.
// Vite exposes env vars under import.meta.env; VITE_API_URL should be set in
// docker-compose.dev.yml to http://localhost:3000 (host) during dev.
// This file is intended to be imported at app startup (main.tsx) so that
// all relative axios calls resolve to the backend host.
// We intentionally do NOT set axios.defaults.baseURL here for dev.
// The app should prefix requests with `/api` and the Vite dev-server
// proxy (configured in vite.config.ts) will forward `/api/*` to the
// backend and rewrite the URL so the backend receives the expected
// path (e.g. `/auth/bootstrap`). Avoiding a pre-set baseURL keeps the
// dev proxy behavior consistent (requests go to the browser origin).

export default axios;
