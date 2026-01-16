#!/bin/bash
set -e

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/npm-test"
ADMIN_USER="e2e-admin-npm"
ADMIN_PASS="password123"
AUTH_TOKEN=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

# Create admin user directly in DB
echo "Generating password hash..."
HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

echo "Creating admin user..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

echo "Assigning admin role..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), 'admin', 'Administrator') ON CONFLICT (name) DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = '$ADMIN_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
" > /dev/null

# Login
echo "Logging in..."
LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
  echo "Failed to authenticate: $LOGIN_RES"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"

cleanup() {
  echo "Cleaning up repositories..."
  curl -s -X DELETE "$API_URL/repositories/npm-hosted" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-proxy" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group-write" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-hosted-2" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group-pref" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group-mirror" -H "$AUTH_HEADER" > /dev/null
  
  kill $MOCK_PID 2>/dev/null || true
  rm -rf /tmp/npm-test
}

if [ "$SKIP_CLEANUP" != "1" ]; then
  if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi
fi

# Helper to create repo
create_repo() {
  local name=$1
  local type=$2
  local config=$3
  echo "Creating repo $name ($type)..."
  curl -s -X POST "$API_URL/repositories" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "{
      \"name\": \"$name\",
      \"type\": \"$type\",
      \"manager\": \"npm\",
      \"config\": $config
    }" > /dev/null
}

# Helper to publish package
publish_package() {
  local repo=$1
  local pkg=$2
  local ver=$3
  echo "Publishing $pkg@$ver to $repo..."
  
  # Create dummy tgz
  mkdir -p /tmp/npm-test/$pkg
  echo "content" > /tmp/npm-test/$pkg/index.js
  echo "{\"name\": \"$pkg\", \"version\": \"$ver\"}" > /tmp/npm-test/$pkg/package.json
  tar -czf /tmp/npm-test/$pkg-$ver.tgz -C /tmp/npm-test/$pkg .
  
  local tgz_base64=$(base64 -w 0 /tmp/npm-test/$pkg-$ver.tgz)
  
  # Create metadata JSON
  cat <<JSON > /tmp/npm-test/metadata.json
{
  "_id": "$pkg",
  "name": "$pkg",
  "description": "Test package",
  "dist-tags": { "latest": "$ver" },
  "versions": {
    "$ver": {
      "name": "$pkg",
      "version": "$ver",
      "dist": {
        "tarball": "$REPOS_URL/$repo/$pkg/-/$pkg-$ver.tgz",
        "shasum": "dummy"
      }
    }
  },
  "_attachments": {
    "$pkg-$ver.tgz": {
      "content_type": "application/octet-stream",
      "data": "$tgz_base64"
    }
  }
}
JSON

  HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/npm-test/publish_response.txt -X PUT "$REPOS_URL/$repo/$pkg" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d @/tmp/npm-test/metadata.json)
  
  echo "Publish response code: $HTTP_CODE"
  cat /tmp/npm-test/publish_response.txt
  echo ""

  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    echo "Publish failed"
    exit 1
  fi
}

# 1. Hosted Test
echo "--- NPM Hosted Test ---"
create_repo "npm-hosted" "hosted" "{}"
publish_package "npm-hosted" "test-pkg" "1.0.0"

# Verify metadata
echo "Verifying metadata..."
HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/npm-test/meta.json "$REPOS_URL/npm-hosted/test-pkg" -H "$AUTH_HEADER")
echo "Get metadata response code: $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "Get metadata failed"
  cat /tmp/npm-test/meta.json
  exit 1
fi
grep -q "test-pkg" /tmp/npm-test/meta.json || { echo "Metadata check failed"; exit 1; }

# Verify tarball
echo "Verifying tarball..."
curl -s -f "$REPOS_URL/npm-hosted/test-pkg/-/test-pkg-1.0.0.tgz" -H "$AUTH_HEADER" -o /tmp/npm-test/downloaded.tgz
[ -s /tmp/npm-test/downloaded.tgz ] || { echo "Tarball download failed"; exit 1; }

echo "NPM Hosted Test Passed"

# 2. Proxy Test (Mocking upstream)
echo "--- NPM Proxy Test ---"
# Start a simple mock server using node
cat <<JS > /tmp/npm-test/mock-server.js
const http = require('http');
const server = http.createServer((req, res) => {
  console.log(req.method, req.url);
  if (req.url === '/upstream-pkg') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'upstream-pkg',
      versions: {
        '1.0.0': {
          name: 'upstream-pkg',
          version: '1.0.0',
          dist: { tarball: 'http://localhost:9999/upstream-pkg/-/upstream-pkg-1.0.0.tgz' }
        }
      }
    }));
  } else if (req.url === '/upstream-pkg/-/upstream-pkg-1.0.0.tgz') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end('tarball-content');
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(9999);
JS

# Run mock server in background
node /tmp/npm-test/mock-server.js > /tmp/npm-test/mock.log 2>&1 &
MOCK_PID=$!
sleep 2

echo "--- NPM Proxy Auth Test (against Hosted) ---"
# Create proxy repo pointing to npm-hosted
# URL: http://localhost:3000/repository/npm-hosted (assuming API can reach itself via localhost)

create_repo "npm-proxy" "proxy" "{
  \"url\": \"http://localhost:3000/repository/npm-hosted\",
  \"auth\": {
    \"type\": \"bearer\",
    \"token\": \"$AUTH_TOKEN\"
  },
  \"cacheMaxAgeDays\": 7
}"

# Verify proxy read
echo "Verifying proxy read..."
curl -s "$REPOS_URL/npm-proxy/test-pkg" -H "$AUTH_HEADER" > /tmp/npm-test/proxy-meta.json
cat /tmp/npm-test/proxy-meta.json
grep -q "test-pkg" /tmp/npm-test/proxy-meta.json || { echo "Proxy metadata check failed"; exit 1; }

# Verify proxy tarball
echo "Verifying proxy tarball..."
curl -s -f "$REPOS_URL/npm-proxy/test-pkg/-/test-pkg-1.0.0.tgz" -H "$AUTH_HEADER" -o /tmp/npm-test/proxy-downloaded.tgz
[ -s /tmp/npm-test/proxy-downloaded.tgz ] || { echo "Proxy tarball download failed"; exit 1; }

echo "NPM Proxy Auth Test Passed"

# 3. Group Test
echo "--- NPM Group Test ---"
create_repo "npm-group" "group" "{
  \"members\": [\"npm-hosted\", \"npm-proxy\"]
}"

# Verify group read (from hosted member)
echo "Verifying group read..."
curl -s -f "$REPOS_URL/npm-group/test-pkg" -H "$AUTH_HEADER" > /tmp/npm-test/group-meta.json
grep -q "test-pkg" /tmp/npm-test/group-meta.json || { echo "Group metadata check failed"; exit 1; }

# Verify group write (if policy allows)
# Let's update group to allow write to hosted
create_repo "npm-group-write" "group" "{
  \"members\": [\"npm-hosted\"],
  \"writePolicy\": \"first\"
}"

echo "Verifying group write..."
publish_package "npm-group-write" "group-pkg" "1.0.0"

# Check if it landed in npm-hosted
curl -s -f "$REPOS_URL/npm-hosted/group-pkg" -H "$AUTH_HEADER" > /dev/null || { echo "Group write failed to propagate"; exit 1; }

echo "NPM Group Write 'first' Test Passed"

# Test 'preferred' policy
echo "Testing 'preferred' write policy..."
create_repo "npm-hosted-2" "hosted" "{}"
create_repo "npm-group-pref" "group" "{
  \"members\": [\"npm-hosted\", \"npm-hosted-2\"],
  \"writePolicy\": \"preferred\",
  \"preferredWriter\": \"npm-hosted-2\"
}"

publish_package "npm-group-pref" "pkg-pref" "1.0.0"

# Verify it exists in npm-hosted-2
curl -s -f "$REPOS_URL/npm-hosted-2/pkg-pref" -H "$AUTH_HEADER" > /dev/null || { echo "Group write 'preferred' failed"; exit 1; }
echo "NPM Group Write 'preferred' Test Passed"

# Test 'mirror' policy
echo "Testing 'mirror' write policy..."
create_repo "npm-group-mirror" "group" "{
  \"members\": [\"npm-hosted\", \"npm-hosted-2\"],
  \"writePolicy\": \"mirror\"
}"

publish_package "npm-group-mirror" "pkg-mirror" "1.0.0"

# Verify it exists in BOTH
curl -s -f "$REPOS_URL/npm-hosted/pkg-mirror" -H "$AUTH_HEADER" > /dev/null || { echo "Group write 'mirror' failed (1)"; exit 1; }
curl -s -f "$REPOS_URL/npm-hosted-2/pkg-mirror" -H "$AUTH_HEADER" > /dev/null || { echo "Group write 'mirror' failed (2)"; exit 1; }
echo "NPM Group Write 'mirror' Test Passed"

echo "NPM Group Test Passed"

echo "All NPM Tests Passed"
