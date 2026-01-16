#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/e2e-pypi"
mkdir -p $TEMP_DIR

# Auth variables
ADMIN_USER="e2e-admin-pypi"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

UP_USER="up-user"
UP_PASS="up-pass"
UPSTREAM_PORT="18082"

echo "Starting PyPI E2E Test..."

cleanup() {
    echo "Cleaning up..."
    kill $MOCK_PID 2>/dev/null || true
    docker exec $API_CONTAINER sh -lc "pkill -f e2e-pypi-basic-upstream" >/dev/null 2>&1 || true
    rm -rf $TEMP_DIR
    
    # Delete repositories
    for repo in pypi-hosted pypi-proxy pypi-group pypi-hosted-2 pypi-group-write pypi-group-pref pypi-group-mirror pypi-proxy-auth; do
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

# 0. Setup Auth
echo "Setting up authentication..."
HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), 'admin', 'Administrator') ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id, key, description) VALUES 
(gen_random_uuid(), 'repo.read', 'Read access'),
(gen_random_uuid(), 'repo.write', 'Write access'),
(gen_random_uuid(), 'repo.manage', 'Manage access')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.key IN ('repo.read', 'repo.write', 'repo.manage')
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = '$ADMIN_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
" > /dev/null

LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER_ID=$(echo "$LOGIN_RES" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${RED}Authentication failed${NC}"
    exit 1
fi

create_repo() {
    local DATA="$1"
    local RES=$(curl -s -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "$DATA")
    echo "$RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4
}

# 1. Hosted Repo
echo "Creating PyPI Hosted repository..."
HOSTED_ID=$(create_repo '{"name":"pypi-hosted","type":"hosted","manager":"pypi"}')

echo "Uploading package to Hosted..."
UPLOAD_RES=$(curl -s -w "\n%{http_code}" -X POST "$REPOS_URL/pypi-hosted/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"my-pkg","version":"1.0.0","content":"hosted-content"}')

HTTP_CODE=$(echo "$UPLOAD_RES" | tail -n1)
BODY=$(echo "$UPLOAD_RES" | head -n -1)
echo "Upload response: $HTTP_CODE $BODY"

if [ "$HTTP_CODE" -ne 200 ] && [ "$HTTP_CODE" -ne 201 ]; then
    echo -e "${RED}Upload failed${NC}"
    exit 1
fi

echo "Verifying download..."
CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-hosted/my-pkg/1.0.0")
echo "Download content: $CONTENT"

if [[ "$CONTENT" == *"hosted-content"* ]]; then
    echo -e "${GREEN}PyPI Hosted Test Passed${NC}"
else
    echo -e "${RED}PyPI Hosted Test Failed${NC}"
    exit 1
fi

# 2. Proxy Test (Mocking upstream)
echo "--- PyPI Proxy Test ---"
cat <<JS > $TEMP_DIR/mock-server.js
const http = require('http');
const server = http.createServer((req, res) => {
  console.log(req.method, req.url);
  if (req.url === '/upstream-pkg/1.0.0') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end('upstream-content');
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(9998, '0.0.0.0');
JS

node $TEMP_DIR/mock-server.js > $TEMP_DIR/mock.log 2>&1 &
MOCK_PID=$!
sleep 2

echo "Creating PyPI Proxy repository..."
PROXY_ID=$(create_repo "{\"name\":\"pypi-proxy\",\"type\":\"proxy\",\"manager\":\"pypi\",\"config\":{\"url\":\"http://172.17.0.1:9998\",\"cacheMaxAgeDays\":7}}")


echo "Verifying proxy download..."
CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-proxy/upstream-pkg/1.0.0")
if [[ "$CONTENT" == *"upstream-content"* ]]; then
    echo -e "${GREEN}PyPI Proxy Test Passed${NC}"
else
    echo -e "${RED}PyPI Proxy Test Failed${NC}"
    exit 1
fi

# 3. Group Test
echo "--- PyPI Group Test ---"
echo "Creating PyPI Group repository..."
GROUP_ID=$(create_repo "{\"name\":\"pypi-group\",\"type\":\"group\",\"manager\":\"pypi\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$PROXY_ID\"]}}")

echo "Verifying group download (from hosted)..."
CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-group/my-pkg/1.0.0")
if [[ "$CONTENT" == *"hosted-content"* ]]; then
    echo -e "${GREEN}PyPI Group Read (Hosted) Passed${NC}"
else
    echo -e "${RED}PyPI Group Read (Hosted) Failed${NC}"
    exit 1
fi

echo "Verifying group download (from proxy)..."
CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-group/upstream-pkg/1.0.0")
if [[ "$CONTENT" == *"upstream-content"* ]]; then
    echo -e "${GREEN}PyPI Group Read (Proxy) Passed${NC}"
else
    echo -e "${RED}PyPI Group Read (Proxy) Failed${NC}"
    exit 1
fi

# 4. Group Write Policies
echo "--- PyPI Group Write Policies ---"
HOSTED_ID_2=$(create_repo '{"name":"pypi-hosted-2","type":"hosted","manager":"pypi"}')

# First
echo "Testing 'first' policy..."
GROUP_WRITE_ID=$(create_repo "{\"name\":\"pypi-group-write\",\"type\":\"group\",\"manager\":\"pypi\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"first\"}}")

curl -s -X POST "$REPOS_URL/pypi-group-write/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"pkg-first","version":"1.0.0","content":"first-content"}' > /dev/null

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-hosted/pkg-first/1.0.0")
if [[ "$CONTENT" == *"first-content"* ]]; then
    echo -e "${GREEN}PyPI Group Write 'first' Passed${NC}"
else
    echo -e "${RED}PyPI Group Write 'first' Failed${NC}"
fi

# Preferred
echo "Testing 'preferred' policy..."
GROUP_PREF_ID=$(create_repo "{\"name\":\"pypi-group-pref\",\"type\":\"group\",\"manager\":\"pypi\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}}")

curl -s -X POST "$REPOS_URL/pypi-group-pref/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"pkg-pref","version":"1.0.0","content":"pref-content"}' > /dev/null

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-hosted-2/pkg-pref/1.0.0")
if [[ "$CONTENT" == *"pref-content"* ]]; then
    echo -e "${GREEN}PyPI Group Write 'preferred' Passed${NC}"
else
    echo -e "${RED}PyPI Group Write 'preferred' Failed${NC}"
fi

# Mirror
echo "Testing 'mirror' policy..."
GROUP_MIRROR_ID=$(create_repo "{\"name\":\"pypi-group-mirror\",\"type\":\"group\",\"manager\":\"pypi\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}}")

curl -s -X POST "$REPOS_URL/pypi-group-mirror/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"pkg-mirror","version":"1.0.0","content":"mirror-content"}' > /dev/null

CONTENT1=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-hosted/pkg-mirror/1.0.0")
CONTENT2=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-hosted-2/pkg-mirror/1.0.0")

if [[ "$CONTENT1" == *"mirror-content"* ]] && [[ "$CONTENT2" == *"mirror-content"* ]]; then
    echo -e "${GREEN}PyPI Group Write 'mirror' Passed${NC}"
else
    echo -e "${RED}PyPI Group Write 'mirror' Failed${NC}"
fi

# 5. Proxy Auth Test
echo "--- PyPI Proxy Auth Test ---"
echo "[ProxyAuth] Starting Basic upstream inside API container..."
docker exec -d $API_CONTAINER sh -lc "node -e '
  const http = require(\"http\");
  const USER = process.env.UP_USER || \"$UP_USER\";
  const PASS = process.env.UP_PASS || \"$UP_PASS\";
  const PORT = parseInt(process.env.UP_PORT || \"$UPSTREAM_PORT\", 10);

  function unauthorized(res) {
    res.writeHead(401, { \"WWW-Authenticate\": \"Basic realm=\\\"up\\\"\" });
    res.end(\"Unauthorized\");
  }

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || \"\";
    if (!auth.startsWith(\"Basic \")) return unauthorized(res);
    const decoded = Buffer.from(auth.slice(6).trim(), \"base64\").toString(\"utf8\");
    const idx = decoded.indexOf(\":\");
    const u = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const p = idx >= 0 ? decoded.slice(idx + 1) : \"\";
    if (u !== USER || p !== PASS) return unauthorized(res);

    if (req.url === \"/auth-pkg/1.0.0\") {
      res.writeHead(200, { \"Content-Type\": \"application/octet-stream\" });
      return res.end(\"auth-content\");
    }

    res.writeHead(404);
    return res.end(\"Not found\");
  });

  server.listen(PORT, \"0.0.0.0\", () => console.log(\"e2e-pypi-basic-upstream listening\", PORT));
  process.title = \"e2e-pypi-basic-upstream\";
'" >/dev/null

sleep 2

echo "Creating PyPI Proxy Auth repository..."
PROXY_AUTH_ID=$(create_repo "{\"name\":\"pypi-proxy-auth\",\"type\":\"proxy\",\"manager\":\"pypi\",\"config\":{\"url\":\"http://localhost:$UPSTREAM_PORT\",\"auth\":{\"type\":\"basic\",\"username\":\"$UP_USER\",\"password\":\"$UP_PASS\"},\"cacheMaxAgeDays\":7}}")

echo "Verifying proxy auth download..."
CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/pypi-proxy-auth/auth-pkg/1.0.0")
if [[ "$CONTENT" == *"auth-content"* ]]; then
    echo -e "${GREEN}PyPI Proxy Auth Test Passed${NC}"
else
    echo -e "${RED}PyPI Proxy Auth Test Failed${NC}"
    exit 1
fi

echo "PyPI E2E Test Completed"

