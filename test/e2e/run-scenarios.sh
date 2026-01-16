#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Running all E2E scenarios..."

SCENARIOS_DIR="$(dirname "$0")/scenarios"

for script in $SCENARIOS_DIR/*.sh; do
    if [ -f "$script" ]; then
        echo "------------------------------------------------"
        echo "Running $(basename "$script")..."
        if "$script"; then
            echo -e "${GREEN}SUCCESS: $(basename "$script")${NC}"
        else
            echo -e "${RED}FAILURE: $(basename "$script")${NC}"
            # Optional: exit on first failure
            # exit 1
        fi
    fi
done

echo "------------------------------------------------"
echo "All scenarios completed."
