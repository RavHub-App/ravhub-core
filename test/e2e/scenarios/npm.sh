#!/bin/bash
set -e

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/npm-test"
ADMIN_USER="e2e-admin-npm"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""
LIMITED_USER="e2e-limited-npm"
LIMITED_PASS="password123"
LIMITED_TOKEN=""
LIMITED_USER_ID=""

API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

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

echo "Logging in..."
LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER_ID=$(echo "$LOGIN_RES" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
  echo "Failed to authenticate: $LOGIN_RES"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"
LIMITED_HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$LIMITED_PASS', 10));")
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "INSERT INTO users (id, username, passwordhash) VALUES (gen_random_uuid(), '$LIMITED_USER', '$LIMITED_HASHED_PASS') ON CONFLICT (username) DO NOTHING;" > /dev/null
LIMITED_LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"$LIMITED_USER\",\"password\":\"$LIMITED_PASS\"}")
LIMITED_TOKEN=$(echo "$LIMITED_LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
LIMITED_USER_ID=$(echo "$LIMITED_LOGIN_RES" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)
[ -n "$LIMITED_TOKEN" ] || { echo "Failed to authenticate limited user: $LIMITED_LOGIN_RES"; exit 1; }

repo_id_by_name() {
  curl -s -H "$AUTH_HEADER" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$1\"" | cut -d'"' -f4
}

cleanup() {
  echo "Cleaning up repositories..."
  curl -s -X DELETE "$API_URL/repositories/npm-hosted" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-proxy" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group-write" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-hosted-2" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group-pref" -H "$AUTH_HEADER" > /dev/null
  curl -s -X DELETE "$API_URL/repositories/npm-group-mirror" -H "$AUTH_HEADER" > /dev/null
  [ -n "$USER_ID" ] && curl -s -X DELETE "$API_URL/users/$USER_ID" -H "$AUTH_HEADER" > /dev/null || true
  [ -n "$LIMITED_USER_ID" ] && curl -s -X DELETE "$API_URL/users/$LIMITED_USER_ID" -H "$AUTH_HEADER" > /dev/null || true

  rm -rf /tmp/npm-test
}

if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

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

publish_package() {
  local repo=$1
  local pkg=$2
  local ver=$3
  local auth_header=${4:-$AUTH_HEADER}
  local status_only=${5:-0}
  local auth_args=()
  local package_dir="/tmp/npm-test/$pkg"
  local tarball_file
  local tgz_base64
  local shasum
  echo "Publishing $pkg@$ver to $repo..."

  rm -rf "$package_dir"
  mkdir -p "$package_dir"
  cat <<JSON > "$package_dir/package.json"
{
  "name": "$pkg",
  "version": "$ver",
  "main": "index.js",
  "description": "Real NPM package for E2E validation"
}
JSON
  echo "module.exports = '$pkg@$ver';" > "$package_dir/index.js"

  tarball_file=$(cd "$package_dir" && pnpm pack --pack-destination /tmp/npm-test | tail -n1)
  if [[ "$tarball_file" != /* ]]; then
    tarball_file="/tmp/npm-test/$tarball_file"
  fi
  tgz_base64=$(base64 -w 0 "$tarball_file")
  shasum=$(sha1sum "$tarball_file" | awk '{print $1}')
  
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
        "shasum": "$shasum"
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

  [ -n "$auth_header" ] && auth_args=(-H "$auth_header")
  HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/npm-test/publish_response.txt -X PUT "$REPOS_URL/$repo/$pkg" \
    -H "Content-Type: application/json" \
    "${auth_args[@]}" \
    -d @/tmp/npm-test/metadata.json)
  
  echo "Publish response code: $HTTP_CODE"
  cat /tmp/npm-test/publish_response.txt
  echo ""

  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    if [ "$status_only" = "1" ]; then
      echo "$HTTP_CODE"
      return 0
    fi
    echo "Publish failed"
    exit 1
  fi

  if [ "$status_only" = "1" ]; then echo "$HTTP_CODE"; fi
}

verify_tarball_contains_package() {
  local tarball_path=$1
  local expected_name=$2

  tar -xzf "$tarball_path" -O package/package.json | grep -q "\"name\": \"$expected_name\""
}

echo "--- NPM Hosted Test ---"
create_repo "npm-hosted" "hosted" "{}"
publish_package "npm-hosted" "test-pkg" "1.0.0"

echo "Verifying metadata..."
HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/npm-test/meta.json "$REPOS_URL/npm-hosted/test-pkg" -H "$AUTH_HEADER")
echo "Get metadata response code: $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "Get metadata failed"
  cat /tmp/npm-test/meta.json
  exit 1
fi
grep -q "test-pkg" /tmp/npm-test/meta.json || { echo "Metadata check failed"; exit 1; }

echo "Verifying tarball..."
curl -s -f "$REPOS_URL/npm-hosted/test-pkg/-/test-pkg-1.0.0.tgz" -H "$AUTH_HEADER" -o /tmp/npm-test/downloaded.tgz
[ -s /tmp/npm-test/downloaded.tgz ] || { echo "Tarball download failed"; exit 1; }
verify_tarball_contains_package /tmp/npm-test/downloaded.tgz test-pkg || { echo "Tarball content validation failed"; exit 1; }

echo "NPM Hosted Test Passed"
LIMITED_PUBLISH_CODE=$(publish_package "npm-hosted" "limited-pkg" "1.0.0" "Authorization: Bearer $LIMITED_TOKEN" "1" | tail -n1)
ANON_PUBLISH_CODE=$(curl -s -w "%{http_code}" -o /tmp/npm-test/anon_publish_response.txt -X PUT "$REPOS_URL/npm-hosted/limited-pkg" -H "Content-Type: application/json" -d @/tmp/npm-test/metadata.json)
[ "$LIMITED_PUBLISH_CODE" = "403" ] && [ "$ANON_PUBLISH_CODE" = "401" ] || { echo "NPM Permission Test Failed (limited=$LIMITED_PUBLISH_CODE anon=$ANON_PUBLISH_CODE)"; exit 1; }
echo "NPM Permission Test Passed"

echo "--- NPM Proxy Test ---"
echo "--- NPM Proxy Auth Test (against Hosted) ---"

create_repo "npm-proxy" "proxy" "{
  \"url\": \"http://localhost:3000/repository/npm-hosted\",
  \"auth\": {
    \"type\": \"bearer\",
    \"token\": \"$AUTH_TOKEN\"
  },
  \"cacheMaxAgeDays\": 7
}"

echo "Verifying proxy read..."
curl -s "$REPOS_URL/npm-proxy/test-pkg" -H "$AUTH_HEADER" > /tmp/npm-test/proxy-meta.json
cat /tmp/npm-test/proxy-meta.json
grep -q "test-pkg" /tmp/npm-test/proxy-meta.json || { echo "Proxy metadata check failed"; exit 1; }

echo "Verifying proxy tarball..."
curl -s -f "$REPOS_URL/npm-proxy/test-pkg/-/test-pkg-1.0.0.tgz" -H "$AUTH_HEADER" -o /tmp/npm-test/proxy-downloaded.tgz
[ -s /tmp/npm-test/proxy-downloaded.tgz ] || { echo "Proxy tarball download failed"; exit 1; }
verify_tarball_contains_package /tmp/npm-test/proxy-downloaded.tgz test-pkg || { echo "Proxy tarball content validation failed"; exit 1; }

echo "NPM Proxy Auth Test Passed"
NPM_PROXY_ID=$(repo_id_by_name "npm-proxy")
curl -s -X PUT "$API_URL/repositories/$NPM_PROXY_ID" -H "Content-Type: application/json" -H "$AUTH_HEADER" -d "{\"config\":{\"url\":\"http://localhost:9/unavailable\",\"auth\":{\"type\":\"bearer\",\"token\":\"$AUTH_TOKEN\"},\"cacheMaxAgeDays\":7}}" > /dev/null
curl -s -f "$REPOS_URL/npm-proxy/test-pkg" -H "$AUTH_HEADER" > /tmp/npm-test/proxy-meta-cached.json
grep -q "test-pkg" /tmp/npm-test/proxy-meta-cached.json || { echo "Proxy cache metadata check failed"; exit 1; }
curl -s -f "$REPOS_URL/npm-proxy/test-pkg/-/test-pkg-1.0.0.tgz" -H "$AUTH_HEADER" -o /tmp/npm-test/proxy-downloaded-cached.tgz
verify_tarball_contains_package /tmp/npm-test/proxy-downloaded-cached.tgz test-pkg || { echo "Proxy cache tarball validation failed"; exit 1; }
echo "NPM Proxy Cache Test Passed"

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
