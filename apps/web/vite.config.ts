/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['web', 'host.docker.internal', 'localhost', 'ravhub-web-1'],
    cors: true,
    watch: {
      usePolling: true,
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      clientPort: 5173
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // Remove the /api prefix before sending to the backend so the
        // backend receives the same routes it expects (e.g. /auth/* instead
        // of /api/auth/*). This keeps client calls consistent (always use
        // /api/*) while letting the dev-server proxy map correctly.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // forward /repository/* to backend without rewriting the path — some clients
      // (package manager clients) will expect the exact path to match e.g. /repository/<name>/v2/...
      '/repository': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // keep the original path, do not rewrite
        rewrite: (path) => path, // explicit no-op rewrite to be clear
      },
    },
  },
})
