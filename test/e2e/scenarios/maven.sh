#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/e2e-maven"
mkdir -p $TEMP_DIR

# Auth variables
ADMIN_USER="e2e-admin-maven"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

RUN_ID="e2e-maven-$(date +%s)-$$"

REPO_IDS=()

HOSTED_ID=""
PROXY_ID=""
PROXY_AUTH_ID=""
GROUP_ID=""

UP_USER="up-user"
UP_PASS="up-pass"
UPSTREAM_PORT="18081"

echo "Starting Maven E2E Test..."

cleanup() {
  echo "Cleaning up..."

  # Stop upstream server inside API container (best-effort)
  docker exec $API_CONTAINER sh -lc "pkill -f e2e-maven-basic-upstream" >/dev/null 2>&1 || true

  if [ ! -z "$AUTH_TOKEN" ]; then
    for id in "${REPO_IDS[@]}"; do
      if [ ! -z "$id" ]; then
        echo "Deleting repo ($id)..."
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$id" > /dev/null || true
      fi
    done
  fi

  if [ ! -z "$USER_ID" ] && [ ! -z "$AUTH_TOKEN" ]; then
    echo "Deleting test user $ADMIN_USER ($USER_ID)..."
    curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$USER_ID" > /dev/null
  fi
  
  rm -rf $TEMP_DIR
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

# 0. Setup Auth
echo "Setting up authentication..."

# Generate bcrypt hash using node (available in environment)
echo "Generating password hash..."
HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

# Insert user into DB if not exists
echo "Inserting admin user into DB..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
"

# Ensure permissions exist and are assigned to admin
echo "Ensuring permissions..."
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
"

# Assign admin role
echo "Assigning admin role..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = '$ADMIN_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
"

echo "Starting Maven E2E Test..."

cleanup() {
  echo "Cleaning up..."

  # Stop upstream server inside API container (best-effort)
  docker exec $API_CONTAINER sh -lc "pkill -f e2e-maven-basic-upstream" >/dev/null 2>&1 || true

  if [ ! -z "$AUTH_TOKEN" ]; then
    for id in "${REPO_IDS[@]}"; do
      if [ ! -z "$id" ]; then
        echo "Deleting repo ($id)..."
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$id" > /dev/null || true
      fi
    done
  fi

  if [ ! -z "$USER_ID" ] && [ ! -z "$AUTH_TOKEN" ]; then
    echo "Deleting test user $ADMIN_USER ($USER_ID)..."
    curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$USER_ID" > /dev/null || true
  fi

  rm -rf $TEMP_DIR || true
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

create_repo() {
  local name="$1"
  local type="$2"
  local manager="$3"
  local config_json="$4"

  local body
  body=$(curl -sS -X POST "$API_URL/repositories" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"type\":\"$type\",\"manager\":\"$manager\",\"config\":$config_json}")

  local id
  id=$(echo "$body" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  if [ -z "$id" ]; then
    echo -e "${RED}Failed to create repo $name: $body${NC}" >&2
    return 1
  fi
  echo "$id"
}

put_artifact() {
  local repo_id="$1"
  local repo_path="$2"
  local file_path="$3"

  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$file_path" \
    "$REPOS_URL/$repo_id/$repo_path")


  if [ "$code" != "200" ]; then
    echo -e "${RED}PUT failed ($code) -> $repo_id/$repo_path${NC}"
    exit 1
  fi
}

get_artifact() {
  local repo_id="$1"
  local repo_path="$2"
  local out_file="$3"

  local code
  code=$(curl -sS -o "$out_file" -w "%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" \
    "$REPOS_URL/$repo_id/$repo_path")
  if [ "$code" != "200" ]; then
    echo -e "${RED}GET failed ($code) -> $repo_id/$repo_path${NC}"
    exit 1
  fi
}

upload_via_group() {
  local repo_id="$1"
  local repo_path="$2"
  local file_path="$3"

  local content
  content=$(base64 -w0 "$file_path")

  local res
  res=$(curl -sS -X POST "$REPOS_URL/$repo_id/upload" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"$repo_path\",\"content\":\"$content\"}")

  if echo "$res" | grep -q '"ok":true'; then
    echo "✓ Uploaded via group to $repo_id ($repo_path)"
  else
    echo -e "${RED}Upload via group failed: $res${NC}"
    exit 1
  fi
}

# 0. Setup Auth (reuse the same technique as docker.sh)
echo "Setting up authentication..."

echo "Generating password hash..."
HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

echo "Inserting admin user into DB..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

echo "Ensuring permissions..."
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
" > /dev/null

echo "Assigning admin role..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
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
  echo -e "${RED}Failed to authenticate: $LOGIN_RES${NC}"
  exit 1
fi

# 1) Proxy público (Maven Central)
echo "Creating Maven Proxy repository (Maven Central)..."
PROXY_ID=$(create_repo "$RUN_ID-proxy" "proxy" "maven" '{"proxyUrl":"https://repo1.maven.org/maven2","cacheMaxAgeDays":7}')
REPO_IDS+=("$PROXY_ID")

echo "[Proxy] Fetching junit pom via proxy..."
OUT_POM="$TEMP_DIR/junit-4.12.pom"
get_artifact "$PROXY_ID" "junit/junit/4.12/junit-4.12.pom" "$OUT_POM"
if grep -q "<artifactId>junit</artifactId>" "$OUT_POM"; then
  echo -e "${GREEN}Maven Proxy Test Passed${NC}"
else
  echo -e "${RED}Maven Proxy Test Failed${NC}"
  exit 1
fi

# 2) Hosted (deploy via PUT + checksum on-demand)
echo "Creating Maven Hosted repository..."
HOSTED_ID=$(create_repo "$RUN_ID-hosted" "hosted" "maven" '{"allowRedeploy":true}')
REPO_IDS+=("$HOSTED_ID")

echo "[Hosted] Creating a test POM and deploying via PUT..."
mkdir -p "$TEMP_DIR/maven"
cat > "$TEMP_DIR/maven/demo-1.0.0.pom" <<XML
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.acme</groupId>
  <artifactId>demo</artifactId>
  <version>1.0.0</version>
</project>
XML

PUT_PATH="com/acme/demo/1.0.0/demo-1.0.0.pom"
put_artifact "$HOSTED_ID" "$PUT_PATH" "$TEMP_DIR/maven/demo-1.0.0.pom"

echo "[Hosted] Fetching deployed POM..."
get_artifact "$HOSTED_ID" "$PUT_PATH" "$TEMP_DIR/demo-1.0.0.pom"
if grep -q "<artifactId>demo</artifactId>" "$TEMP_DIR/demo-1.0.0.pom"; then
  echo -e "${GREEN}Maven Hosted Read Test Passed${NC}"
else
  echo -e "${RED}Maven Hosted Read Test Failed${NC}"
  exit 1
fi

echo "[Hosted] Fetching checksum on-demand (.sha1)..."
get_artifact "$HOSTED_ID" "$PUT_PATH.sha1" "$TEMP_DIR/demo-1.0.0.pom.sha1"
if [ -s "$TEMP_DIR/demo-1.0.0.pom.sha1" ]; then
  echo -e "${GREEN}Maven Hosted Checksum Test Passed${NC}"
else
  echo -e "${RED}Maven Hosted Checksum Test Failed${NC}"
  exit 1
fi

# 3) Group read/write (hosted member, writePolicy:first)
echo "Creating Maven Group repository (members: hosted, writePolicy:first)..."
GROUP_ID=$(create_repo "$RUN_ID-group" "group" "maven" "{\"members\":[\"$HOSTED_ID\"],\"writePolicy\":\"first\"}")
REPO_IDS+=("$GROUP_ID")

echo "[Group] Fetching POM via group..."
get_artifact "$GROUP_ID" "$PUT_PATH" "$TEMP_DIR/group-demo-1.0.0.pom"
if grep -q "<groupId>com.acme</groupId>" "$TEMP_DIR/group-demo-1.0.0.pom"; then
  echo -e "${GREEN}Maven Group Read Test Passed${NC}"
else
  echo -e "${RED}Maven Group Read Test Failed${NC}"
  exit 1
fi

echo "[GroupWrite] Uploading a new version via group upload API..."
cat > "$TEMP_DIR/maven/demo-1.0.1.pom" <<XML
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.acme</groupId>
  <artifactId>demo</artifactId>
  <version>1.0.1</version>
</project>
XML

PUT_PATH_2="com/acme/demo/1.0.1/demo-1.0.1.pom"
upload_via_group "$GROUP_ID" "$PUT_PATH_2" "$TEMP_DIR/maven/demo-1.0.1.pom"

echo "[GroupWrite] Fetching v1.0.1 via group..."
get_artifact "$GROUP_ID" "$PUT_PATH_2" "$TEMP_DIR/group-demo-1.0.1.pom"
if grep -q "<version>1.0.1</version>" "$TEMP_DIR/group-demo-1.0.1.pom"; then
  echo -e "${GREEN}Maven Group Write Test Passed${NC}"
else
  echo -e "${RED}Maven Group Write Test Failed${NC}"
  exit 1
fi

# 3b) Group Write 'preferred'
echo "[GroupWrite] Testing 'preferred' policy..."
HOSTED_ID_2=$(create_repo "$RUN_ID-hosted-2" "hosted" "maven" '{"allowRedeploy":true}')
REPO_IDS+=("$HOSTED_ID_2")

GROUP_PREF_ID=$(create_repo "$RUN_ID-group-pref" "group" "maven" "{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}")
REPO_IDS+=("$GROUP_PREF_ID")

cat > "$TEMP_DIR/maven/demo-pref.pom" <<XML
<project><groupId>com.acme</groupId><artifactId>demo-pref</artifactId><version>1.0.0</version></project>
XML
upload_via_group "$GROUP_PREF_ID" "com/acme/demo-pref/1.0.0/demo-pref-1.0.0.pom" "$TEMP_DIR/maven/demo-pref.pom"

# Verify in hosted-2
get_artifact "$HOSTED_ID_2" "com/acme/demo-pref/1.0.0/demo-pref-1.0.0.pom" "$TEMP_DIR/check-pref.pom"
if grep -q "demo-pref" "$TEMP_DIR/check-pref.pom"; then
  echo -e "${GREEN}Maven Group Write 'preferred' Passed${NC}"
else
  echo -e "${RED}Maven Group Write 'preferred' Failed${NC}"
  exit 1
fi

# 3c) Group Write 'mirror'
echo "[GroupWrite] Testing 'mirror' policy..."
GROUP_MIRROR_ID=$(create_repo "$RUN_ID-group-mirror" "group" "maven" "{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}")
REPO_IDS+=("$GROUP_MIRROR_ID")

cat > "$TEMP_DIR/maven/demo-mirror.pom" <<XML
<project><groupId>com.acme</groupId><artifactId>demo-mirror</artifactId><version>1.0.0</version></project>
XML
upload_via_group "$GROUP_MIRROR_ID" "com/acme/demo-mirror/1.0.0/demo-mirror-1.0.0.pom" "$TEMP_DIR/maven/demo-mirror.pom"

# Verify in BOTH
get_artifact "$HOSTED_ID" "com/acme/demo-mirror/1.0.0/demo-mirror-1.0.0.pom" "$TEMP_DIR/check-mirror-1.pom"
get_artifact "$HOSTED_ID_2" "com/acme/demo-mirror/1.0.0/demo-mirror-1.0.0.pom" "$TEMP_DIR/check-mirror-2.pom"

if grep -q "demo-mirror" "$TEMP_DIR/check-mirror-1.pom" && grep -q "demo-mirror" "$TEMP_DIR/check-mirror-2.pom"; then
  echo -e "${GREEN}Maven Group Write 'mirror' Passed${NC}"
else
  echo -e "${RED}Maven Group Write 'mirror' Failed${NC}"
  exit 1
fi

# 4) Proxy-Auth upstream (Basic) + SNAPSHOT resolution
echo "[ProxyAuth] Starting Basic upstream inside API container..."
docker exec $API_CONTAINER sh -lc "mkdir -p /tmp/e2e-maven-upstream" >/dev/null

docker exec -d $API_CONTAINER sh -lc "node -e '
  const http = require(\"http\");
  const USER = process.env.UP_USER || \"$UP_USER\";
  const PASS = process.env.UP_PASS || \"$UP_PASS\";
  const PORT = parseInt(process.env.UP_PORT || \"$UPSTREAM_PORT\", 10);

  function unauthorized(res) {
    res.writeHead(401, { \"WWW-Authenticate\": \"Basic realm=\\\"up\\\"\" });
    res.end(\"Unauthorized\");
  }

  const snapshotMeta = \`<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<metadata>
  <groupId>com.acme</groupId>
  <artifactId>snapdemo</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <versioning>
    <snapshot>
      <timestamp>20251213.000000</timestamp>
      <buildNumber>1</buildNumber>
    </snapshot>
    <snapshotVersions>
      <snapshotVersion>
        <extension>pom</extension>
        <value>1.0.0-20251213.000000-1</value>
        <updated>20251213000000</updated>
      </snapshotVersion>
    </snapshotVersions>
  </versioning>
</metadata>\`;

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || \"\";
    if (!auth.startsWith(\"Basic \")) return unauthorized(res);
    const decoded = Buffer.from(auth.slice(6).trim(), \"base64\").toString(\"utf8\");
    const idx = decoded.indexOf(\":\");
    const u = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const p = idx >= 0 ? decoded.slice(idx + 1) : \"\";
    if (u !== USER || p !== PASS) return unauthorized(res);

    // Release POM
    if (req.url === \"/com/acme/authdemo/1.0.0/authdemo-1.0.0.pom\") {
      res.writeHead(200, { \"Content-Type\": \"application/xml\" });
      return res.end(\"<project><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>authdemo</artifactId><version>1.0.0</version></project>\");
    }

    // SNAPSHOT metadata
    if (req.url === \"/com/acme/snapdemo/1.0.0-SNAPSHOT/maven-metadata.xml\") {
      res.writeHead(200, { \"Content-Type\": \"application/xml\" });
      return res.end(snapshotMeta);
    }

    // SNAPSHOT resolved POM
    if (req.url === \"/com/acme/snapdemo/1.0.0-SNAPSHOT/snapdemo-1.0.0-20251213.000000-1.pom\") {
      res.writeHead(200, { \"Content-Type\": \"application/xml\" });
      return res.end(\"<project><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>snapdemo</artifactId><version>1.0.0-SNAPSHOT</version></project>\");
    }

    res.writeHead(404);
    return res.end(\"Not found\");
  });

  server.listen(PORT, \"0.0.0.0\", () => console.log(\"e2e-maven-basic-upstream listening\", PORT));

  process.title = \"e2e-maven-basic-upstream\";
'" >/dev/null

echo "Creating Maven Proxy repository (Auth -> Basic upstream)..."
PROXY_AUTH_ID=$(create_repo "$RUN_ID-proxy-auth" "proxy" "maven" "{\"proxyUrl\":\"http://localhost:$UPSTREAM_PORT\",\"requireAuth\":true,\"auth\":{\"type\":\"basic\",\"username\":\"$UP_USER\",\"password\":\"$UP_PASS\"},\"cacheMaxAgeDays\":7}")
REPO_IDS+=("$PROXY_AUTH_ID")

echo "[ProxyAuth] Fetching release POM via proxy-auth..."
get_artifact "$PROXY_AUTH_ID" "com/acme/authdemo/1.0.0/authdemo-1.0.0.pom" "$TEMP_DIR/authdemo-1.0.0.pom"
if grep -q "<artifactId>authdemo</artifactId>" "$TEMP_DIR/authdemo-1.0.0.pom"; then
  echo -e "${GREEN}Maven Proxy Auth Test Passed${NC}"
else
  echo -e "${RED}Maven Proxy Auth Test Failed${NC}"
  exit 1
fi

echo "[ProxyAuth] Fetching SNAPSHOT POM (should resolve via maven-metadata.xml)..."
get_artifact "$PROXY_AUTH_ID" "com/acme/snapdemo/1.0.0-SNAPSHOT/snapdemo-1.0.0-SNAPSHOT.pom" "$TEMP_DIR/snapdemo-snapshot.pom"
if grep -q "<artifactId>snapdemo</artifactId>" "$TEMP_DIR/snapdemo-snapshot.pom"; then
  echo -e "${GREEN}Maven SNAPSHOT Resolution Test Passed${NC}"
else
  echo -e "${RED}Maven SNAPSHOT Resolution Test Failed${NC}"
  exit 1
fi

echo -e "${GREEN}All Maven Tests Passed${NC}"

rm -rf $TEMP_DIR
