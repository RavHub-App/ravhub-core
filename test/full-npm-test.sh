#!/bin/bash
set -e
API="http://localhost:8888"
API_NO_PROTO="localhost:8888"

echo "1. Getting Token..."
# Using /api prefix so Nginx handles it
LOGIN_RES=$(curl -s -X POST $API/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo $LOGIN_RES | python3 -c "import sys, json; print(json.load(sys.stdin).get('token'))")

if [ -z "$TOKEN" ] || [ "$TOKEN" == "None" ]; then
    echo "Failed to get token"
    exit 1
fi
echo "Token obtained."

echo "2. Creating NPM Repository..."
REPO_NAME="npm-test-pkg-$(date +%s)"
# Using /api prefix for repositories endpoint as well
CREATE_RES=$(curl -s -X POST $API/api/repositories \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$REPO_NAME\",\"type\":\"npm\",\"mode\":\"hosted\"}")
REPO_ID=$(echo $CREATE_RES | python3 -c "import sys, json; print(json.load(sys.stdin).get('id'))")

if [ -z "$REPO_ID" ] || [ "$REPO_ID" == "None" ]; then
    echo "Failed to create repo: $CREATE_RES"
    exit 1
fi
echo "Repo created: $REPO_NAME ($REPO_ID)"

echo "3. Preparing Package..."
rm -rf test-pkg
mkdir -p test-pkg
cd test-pkg
PKG_NAME="test-pkg-$(date +%s)"
echo "{\"name\":\"$PKG_NAME\",\"version\":\"1.0.0\",\"description\":\"Test package\"}" > package.json
echo "console.log('Hello RavHub')" > index.js

echo "4. Uploading via API (Generic)..."
# Try generic upload endpoint. Using /api prefix to be safe with nginx.
UPLOAD_RES=$(curl -s -X POST $API/api/repositories/$REPO_ID/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @package.json)

echo "Upload response: $UPLOAD_RES"

echo "5. Verifying Repository Content..."
LIST_RES=$(curl -s -X GET $API/api/repositories/$REPO_ID/packages \
  -H "Authorization: Bearer $TOKEN")
echo "Packages: $LIST_RES"

if [[ $LIST_RES == *"packages"* ]]; then
    echo "✅ SUCCESS: Repository is accessible and reachable via Nginx Prod!"
else
    echo "❌ FAILURE: Could not list packages via Nginx"
    exit 1
fi
