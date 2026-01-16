#!/bin/bash
set -e

# Require jq
if ! command -v jq &> /dev/null; then
    echo "jq is required but not installed."
    exit 1
fi

API_URL="http://localhost:8888"
ADMIN_USER="admin"
ADMIN_PASS="admin123"

echo "Waiting for API at $API_URL..."
MAX_RETRIES=30
COUNT=0
until curl -s $API_URL/health > /dev/null; do
  echo "Waiting for API... ($COUNT/$MAX_RETRIES)"
  sleep 5
  COUNT=$((COUNT+1))
  if [ $COUNT -ge $MAX_RETRIES ]; then
    echo "Timeout waiting for API"
    exit 1
  fi
done

echo "1. Login..."
LOGIN_RES=$(curl -s -X POST $API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\", \"password\":\"$ADMIN_PASS\"}")

TOKEN=$(echo $LOGIN_RES | python3 -c "import sys, json; print(json.load(sys.stdin).get('token'))")

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
    echo "Login failed. Response: $LOGIN_RES"
    exit 1
fi
echo "Login OK."

echo "2. Create Repository (NPM Hosted)..."
REPO_NAME="test-npm-hosted-$(date +%s)"
# Skip fetching storage config, use system default implicitly

CREATE_RES=$(curl -s -X POST $API_URL/repositories \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$REPO_NAME\",
    \"type\": \"npm\",
    \"mode\": \"hosted\"
  }")

# Check if response contains ID (simple string check to avoid jq/python complexity if not needed, but python is safer)
REPO_ID=$(echo $CREATE_RES | python3 -c "import sys, json; print(json.load(sys.stdin).get('id'))")

if [ "$REPO_ID" == "None" ] || [ -z "$REPO_ID" ]; then
    echo "Failed to create repository: $CREATE_RES"
    exit 1
fi
echo "Repository created successfully: $REPO_NAME (ID: $REPO_ID)"

echo "✅ Integration Test SUCCESS (Creation Verified)!"
