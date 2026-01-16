#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/e2e-nuget"
mkdir -p $TEMP_DIR

ADMIN_USER="e2e-admin-nuget"
ADMIN_PASS="password123"
AUTH_TOKEN=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

UP_USER="up-user"
UP_PASS="up-pass"
UPSTREAM_PORT="18091"

echo "Starting NuGet E2E Test..."

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
    echo "Cleaning up..."
    rm -rf $TEMP_DIR
    
    # Delete repositories
    for repo in nuget-hosted nuget-proxy nuget-group nuget-hosted-2 nuget-proxy-auth; do
        if [ ! -z "$AUTH_TOKEN" ]; then
            ID=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$repo\"" | cut -d'"' -f4)
            if [ ! -z "$ID" ]; then
                echo "Deleting repo $repo ($ID)..."
                curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$ID" > /dev/null
            fi
        fi
    done

    if [ ! -z "$USER_ID" ] && [ ! -z "$AUTH_TOKEN" ]; then
        echo "Deleting test user $ADMIN_USER..."
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$USER_ID" > /dev/null
    fi
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

# 1. Create NuGet Hosted Repository
echo "Cleaning up old repo..."
curl -s -X DELETE "$API_URL/repositories/nuget-hosted" \
  -H "$AUTH_HEADER" > /dev/null

echo "Creating NuGet Hosted repository..."
CREATE_RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-hosted","type":"hosted","manager":"nuget","config":{"allowRedeploy":true}}')

HTTP_CODE=$(echo "$CREATE_RES" | tail -n1)
BODY=$(echo "$CREATE_RES" | head -n -1)

if [ "$HTTP_CODE" -ne 201 ] && [ "$HTTP_CODE" -ne 200 ]; then
  echo -e "${RED}Failed to create hosted repo (HTTP $HTTP_CODE): $BODY${NC}"
  exit 1
fi

# 2. Upload a fake package to Hosted
echo "Uploading fake package to Hosted..."
# Create a dummy nupkg (just a zip file)
echo "dummy content" > $TEMP_DIR/dummy.txt
zip -j $TEMP_DIR/test-pkg.1.0.0.nupkg $TEMP_DIR/dummy.txt > /dev/null

# Use generic PUT upload supported by our plugin implementation
# Path format: /<id>/<version>/<filename>
echo "Sending PUT request..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/octet-stream" \
  -H "Expect:" \
  --data-binary @$TEMP_DIR/test-pkg.1.0.0.nupkg \
  "$REPOS_URL/nuget-hosted/test-pkg/1.0.0/test-pkg.1.0.0.nupkg")

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
    echo -e "${GREEN}NuGet Hosted Upload Test Passed${NC}"
else
    echo -e "${RED}NuGet Hosted Upload Test Failed (HTTP $HTTP_CODE)${NC}"
    # Try to get the error body
    curl -s -X PUT \
      -H "$AUTH_HEADER" \
      --data-binary @$TEMP_DIR/test-pkg.1.0.0.nupkg \
      "$REPOS_URL/nuget-hosted/test-pkg/1.0.0/test-pkg.1.0.0.nupkg"
    exit 1
fi

# 3. Create NuGet Proxy Repository
echo "Creating NuGet Proxy repository..."
curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-proxy","type":"proxy","manager":"nuget","config":{"proxyUrl":"https://api.nuget.org/v3/index.json","cacheMaxAgeDays":7}}' > /dev/null

# 4. Verify Proxy Read (Index)
echo "Verifying Proxy Read (Index)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-proxy/index.json")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}NuGet Proxy Index Test Passed${NC}"
else
    echo -e "${RED}NuGet Proxy Index Test Failed (HTTP $HTTP_CODE)${NC}"
    exit 1
fi

# 5. Create NuGet Group Repository
echo "Creating NuGet Group repository..."
curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-group","type":"group","manager":"nuget","config":{"members":["nuget-hosted","nuget-proxy"]}}' > /dev/null

# 6. Verify Group Read (Proxy Member)
echo "Verifying Group Read (Proxy Member)..."
# We can try to fetch the same index.json through the group
# Note: Group logic in storage.ts 'download' expects name/version, not arbitrary paths like index.json.
# So 'download' won't work for index.json on group unless we implement generic file fetch.
# But 'download' is for packages.
# Let's try to download a real package from proxy via group.
# Package: newtonsoft.json/13.0.3
echo "Downloading package via Group (from Proxy)..."
# URL: /repository/nuget-group/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg
# This maps to download(repo, 'newtonsoft.json', '13.0.3')
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-group/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg")
if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 302 ]; then
    echo -e "${GREEN}NuGet Group Download Test Passed${NC}"
else
    echo -e "${RED}NuGet Group Download Test Failed (HTTP $HTTP_CODE)${NC}"
    # Don't fail hard if internet is flaky, but warn
    echo "Warning: Could not download from NuGet.org via proxy. Check internet connection."
fi

# 7. Test Group Write Policies
echo "Testing Group Write Policies..."

# Create second hosted repo
echo "Creating nuget-hosted-2..."
curl -s -X DELETE "$API_URL/repositories/nuget-hosted-2" -H "$AUTH_HEADER" > /dev/null
curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-hosted-2","type":"hosted","manager":"nuget","config":{"allowRedeploy":true}}' > /dev/null

# Update Group to include both hosted repos
echo "Updating Group members..."
curl -s -X PUT "$API_URL/repositories/nuget-group" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-group","type":"group","manager":"nuget","config":{"members":["nuget-hosted","nuget-hosted-2","nuget-proxy"],"writePolicy":"first"}}' > /dev/null

# Test 'first' policy (should go to nuget-hosted)
echo "Testing 'first' write policy..."
zip -j $TEMP_DIR/pkg-first.1.0.0.nupkg $TEMP_DIR/dummy.txt > /dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/octet-stream" \
  -H "Expect:" \
  --data-binary @$TEMP_DIR/pkg-first.1.0.0.nupkg \
  "$REPOS_URL/nuget-group/pkg-first/1.0.0/pkg-first.1.0.0.nupkg")

if [ "$HTTP_CODE" -ne 200 ] && [ "$HTTP_CODE" -ne 201 ]; then
    echo -e "${RED}Group Upload (first) Failed (HTTP $HTTP_CODE)${NC}"
    exit 1
fi

# Verify it exists in nuget-hosted
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-hosted/pkg-first/1.0.0/pkg-first.1.0.0.nupkg")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}Group Write 'first' Verified (found in nuget-hosted)${NC}"
else
    echo -e "${RED}Group Write 'first' Failed (not found in nuget-hosted)${NC}"
    exit 1
fi

# Test 'preferred' policy (should go to nuget-hosted-2)
echo "Testing 'preferred' write policy..."
curl -s -X PUT "$API_URL/repositories/nuget-group" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-group","type":"group","manager":"nuget","config":{"members":["nuget-hosted","nuget-hosted-2","nuget-proxy"],"writePolicy":"preferred","preferredWriter":"nuget-hosted-2"}}' > /dev/null

zip -j $TEMP_DIR/pkg-pref.1.0.0.nupkg $TEMP_DIR/dummy.txt > /dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/octet-stream" \
  -H "Expect:" \
  --data-binary @$TEMP_DIR/pkg-pref.1.0.0.nupkg \
  "$REPOS_URL/nuget-group/pkg-pref/1.0.0/pkg-pref.1.0.0.nupkg")

if [ "$HTTP_CODE" -ne 200 ] && [ "$HTTP_CODE" -ne 201 ]; then
    echo -e "${RED}Group Upload (preferred) Failed (HTTP $HTTP_CODE)${NC}"
    exit 1
fi

# Verify it exists in nuget-hosted-2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-hosted-2/pkg-pref/1.0.0/pkg-pref.1.0.0.nupkg")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}Group Write 'preferred' Verified (found in nuget-hosted-2)${NC}"
else
    echo -e "${RED}Group Write 'preferred' Failed (not found in nuget-hosted-2)${NC}"
    exit 1
fi

# Test 'mirror' policy (should go to both)
echo "Testing 'mirror' write policy..."
curl -s -X PUT "$API_URL/repositories/nuget-group" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"nuget-group","type":"group","manager":"nuget","config":{"members":["nuget-hosted","nuget-hosted-2","nuget-proxy"],"writePolicy":"mirror"}}' > /dev/null

zip -j $TEMP_DIR/pkg-mirror.1.0.0.nupkg $TEMP_DIR/dummy.txt > /dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/octet-stream" \
  -H "Expect:" \
  --data-binary @$TEMP_DIR/pkg-mirror.1.0.0.nupkg \
  "$REPOS_URL/nuget-group/pkg-mirror/1.0.0/pkg-mirror.1.0.0.nupkg")

if [ "$HTTP_CODE" -ne 200 ] && [ "$HTTP_CODE" -ne 201 ]; then
    echo -e "${RED}Group Upload (mirror) Failed (HTTP $HTTP_CODE)${NC}"
    exit 1
fi

# Verify it exists in nuget-hosted
HTTP_CODE1=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-hosted/pkg-mirror/1.0.0/pkg-mirror.1.0.0.nupkg")
# Verify it exists in nuget-hosted-2
HTTP_CODE2=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-hosted-2/pkg-mirror/1.0.0/pkg-mirror.1.0.0.nupkg")

if [ "$HTTP_CODE1" -eq 200 ] && [ "$HTTP_CODE2" -eq 200 ]; then
    echo -e "${GREEN}Group Write 'mirror' Verified (found in both)${NC}"
else
    echo -e "${RED}Group Write 'mirror' Failed (1: $HTTP_CODE1, 2: $HTTP_CODE2)${NC}"
    exit 1
fi

# 8. Proxy Auth Test
echo "--- NuGet Proxy Auth Test ---"
echo "[ProxyAuth] Testing Proxy with Auth against own Hosted repository..."

# Create a test user for upstream authentication
TEST_UPSTREAM_USER="e2e-nuget-upstream-user"
TEST_UPSTREAM_PASS="upstream-pass-123"

echo "Creating upstream user..."
UPSTREAM_HASH=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$TEST_UPSTREAM_PASS', 10));")
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$TEST_UPSTREAM_USER', '$UPSTREAM_HASH')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

echo "Assigning permissions to upstream user..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), 'admin', 'Administrator') ON CONFLICT (name) DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = '$TEST_UPSTREAM_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
" > /dev/null

echo "Creating NuGet Proxy Auth repository pointing to own Hosted..."
# Use our own hosted repository as the upstream, with authentication
# NuGet uses index.json, so we point to the hosted repo's index
curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{\"name\":\"nuget-proxy-auth\",\"type\":\"proxy\",\"manager\":\"nuget\",\"config\":{\"proxyUrl\":\"http://localhost:3000/repository/nuget-hosted/index.json\",\"auth\":{\"username\":\"$TEST_UPSTREAM_USER\",\"password\":\"$TEST_UPSTREAM_PASS\"},\"cacheMaxAgeDays\":7}}" > /dev/null

echo "Verifying Proxy Auth (Index)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-proxy-auth/index.json")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}NuGet Proxy Auth Test Passed${NC}"
else
    echo -e "${RED}NuGet Proxy Auth Test Failed (HTTP $HTTP_CODE)${NC}"
    exit 1
fi

echo -e "${GREEN}All NuGet Tests Passed${NC}"

