#!/bin/bash
set -e

# Ensure we are in the root
cd "$(dirname "$0")/.."

echo "Starting backend..."
docker compose -f docker-compose.dev.yml up -d api postgres

echo "Waiting for backend health..."
# Simple wait loop
for i in {1..30}; do
  if curl -s http://localhost:5173/api/health > /dev/null; then
    echo "Backend is ready!"
    break
  fi
  echo "Waiting for backend..."
  sleep 2
done

echo "Running frontend E2E tests..."
cd apps/web
echo "Cleaning Vite cache and ensuring dependencies..."
# remove vite cache which may be root-owned from previous runs and cause EACCES when Playwright tries to start the dev server
if [ -d ./node_modules/.vite ]; then
  echo "Fixing ownership of ./node_modules/.vite if sudo available..."
  if command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$(id -u):$(id -g)" ./node_modules/.vite || true
  fi
  rm -rf ./node_modules/.vite || true
fi
pnpm install --frozen-lockfile || true
pnpm exec playwright install chromium
pnpm exec playwright test

echo "Done!"
