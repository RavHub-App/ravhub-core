#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:5173/api"

# Auth variables
ADMIN_USER="manual-admin"
ADMIN_PASS="password123"
AUTH_TOKEN=""

echo "Cleaning up Manual Test Environment..."

# Login
LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${RED}Authentication failed. Cannot cleanup.${NC}"
    exit 1
fi

# List of repos to delete
REPOS=(
  "composer-proxy" "composer-hosted"
  "npm-proxy" "npm-hosted"
  "raw-hosted" "raw-proxy"
  "rust-hosted" "rust-proxy"
  "helm-hosted" "helm-proxy"
  "maven-hosted" "maven-proxy"
  "nuget-hosted" "nuget-proxy"
  "pypi-hosted" "pypi-proxy"
  "docker-hosted" "docker-proxy"
)

for repo in "${REPOS[@]}"; do
    ID=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$repo\"" | cut -d'"' -f4)
    if [ ! -z "$ID" ]; then
        echo "Deleting repo $repo ($ID)..."
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$ID" > /dev/null
    else
        echo "Repo $repo not found or already deleted."
    fi
done

echo -e "${GREEN}Cleanup Complete!${NC}"
