#!/usr/bin/env sh
# POSIX sh safe mode: enable -e and -u; pipefail isn't available in dash/alpine sh
set -eu

# Copy bundled plugins to the deployment directory if they exist
# We determine the deployment directory based on STORAGE_PATH or default to /data/storage
STORAGE_ROOT="${STORAGE_PATH:-/data/storage}"

echo "[entrypoint] Running migrations (safe) and seeds (opt-in) before starting API"

if [ -f "/workspace/api/dist/run-migrations.js" ]; then
    echo "[entrypoint] Running compiled migration script..."
    # We need to be in the api directory for relative paths (if any) or just run it
    # But we should be careful about CWD.
    # The script likely uses absolute paths or relative to CWD.
    # Let's try running it with node directly.
    node /workspace/api/dist/run-migrations.js
else
    echo "[entrypoint] Running migration script via pnpm..."
    pnpm run migrations:run
fi

echo "[entrypoint] Starting API (mode=${NODE_ENV:-development})"

if [ "${NODE_ENV:-development}" = "test" ] || [ "${NODE_ENV:-production}" = "production" ]; then
	echo "[entrypoint] Production mode detected"

    # Start Nginx to serve frontend and proxy /api (if dist exists and nginx is installed)
    if [ -d "/workspace/web/dist" ] && command -v nginx >/dev/null 2>&1; then
        echo "[entrypoint] Starting nginx to serve frontend on port ${FRONTEND_PORT:-5173}..."
        # Ensure log directory exists
        mkdir -p /var/log/nginx
        # Test nginx config and start
        if nginx -t >/dev/null 2>&1; then
            nginx || echo "[entrypoint] nginx failed to start (it may already be running)"
        else
            echo "[entrypoint] nginx config test failed, check /etc/nginx/conf.d/default.conf"
        fi
    else
        echo "[entrypoint] Web dist not found or nginx not installed, skipping frontend start"
    fi

	echo "[entrypoint] Starting API..."
    # Run compiled NestJS directly (keeps runtime deps simple)
    if [ -f "/workspace/api/dist/main.js" ]; then
        exec node /workspace/api/dist/main
    else
        exec node /workspace/api/dist/src/main
    fi
    
else
	exec pnpm run start:dev
fi
