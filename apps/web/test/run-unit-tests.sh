#!/usr/bin/env bash
# Run Web unit tests
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR/apps/web"

echo "=== Running Web Unit Tests ==="
pnpm run test:unit

exit $?
