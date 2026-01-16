#!/usr/bin/env sh
# POSIX sh safe mode: enable -e and -u; pipefail isn't available in dash/alpine sh
set -eu

# Copy bundled plugins to the deployment directory if they exist
# We determine the deployment directory based on STORAGE_PATH or default to /data/storage
STORAGE_ROOT="${STORAGE_PATH:-/data/storage}"

echo "[entrypoint] Running migrations (safe) and seeds (opt-in) before starting API"


echo "[entrypoint] Starting API (mode=${NODE_ENV:-development})"

if [ -f "node_modules/.bin/ts-node" ]; then
  pnpm run migrations:run
else
  pnpm run migrations:run:prod
fi

if [ "${NODE_ENV:-development}" = "test" ] || [ "${NODE_ENV:-production}" = "production" ]; then
	echo "[entrypoint] Running build for production start"
	pnpm run build || true
	exec pnpm run start:prod
else
	exec pnpm run start:dev
fi
