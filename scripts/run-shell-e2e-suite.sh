#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCENARIO_DIR="$ROOT_DIR/test/e2e/scenarios"
SCENARIOS=(composer docker helm maven npm nuget pypi raw rust)

cd "$ROOT_DIR"

for scenario in "${SCENARIOS[@]}"; do
  echo "=== Running ${scenario}.sh ==="
  bash "$SCENARIO_DIR/${scenario}.sh"
  echo "=== Completed ${scenario}.sh ==="
done

echo "All shell E2E scenarios passed"
