#!/bin/bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="$API_URL/repository"
TEMP_DIR="/tmp/e2e-maven"
ARTIFACT_DIR="$TEMP_DIR/artifacts"
ADMIN_USER="e2e-admin-maven"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""
LIMITED_USER="e2e-limited-maven"
LIMITED_PASS="password123"
LIMITED_TOKEN=""
LIMITED_USER_ID=""
RUN_ID="e2e-maven-$(date +%s)-$$"
REPO_IDS=()
UP_USER="up-user"
UP_PASS="up-pass"
UP_PORT="18081"
SNAPSHOT_TS="20251213.000000"
SNAPSHOT_BUILD="1"

mkdir -p "$ARTIFACT_DIR"

API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

run_sql() { docker exec "$POSTGRES_CONTAINER" psql -U postgres -d ravhub -c "$1" > /dev/null; }

cleanup() {
  echo "Cleaning up..."
  docker exec "$API_CONTAINER" sh -lc "pkill -f e2e-maven-basic-upstream || true; rm -rf /tmp/e2e-maven-upstream" > /dev/null 2>&1 || true
  if [ -n "$AUTH_TOKEN" ]; then
    for repo_id in "${REPO_IDS[@]}"; do
      [ -n "$repo_id" ] && curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$repo_id" > /dev/null || true
    done
  fi
  [ -n "$USER_ID" ] && [ -n "$AUTH_TOKEN" ] && curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$USER_ID" > /dev/null || true
  [ -n "$LIMITED_USER_ID" ] && [ -n "$AUTH_TOKEN" ] && curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$LIMITED_USER_ID" > /dev/null || true
  rm -rf "$TEMP_DIR"
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

setup_auth() {
  local hashed_pass login_response
  hashed_pass=$(docker exec -w /workspace/apps/api "$API_CONTAINER" node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")
  run_sql "INSERT INTO users (id, username, passwordhash) VALUES (gen_random_uuid(), '$ADMIN_USER', '$hashed_pass') ON CONFLICT (username) DO NOTHING; INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), 'admin', 'Administrator') ON CONFLICT (name) DO NOTHING; INSERT INTO permissions (id, key, description) VALUES (gen_random_uuid(), 'repo.read', 'Read access'), (gen_random_uuid(), 'repo.write', 'Write access'), (gen_random_uuid(), 'repo.manage', 'Manage access') ON CONFLICT (key) DO NOTHING; INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin' AND p.key IN ('repo.read', 'repo.write', 'repo.manage') ON CONFLICT DO NOTHING; INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = '$ADMIN_USER' AND r.name = 'admin' ON CONFLICT DO NOTHING;"
  login_response=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
  AUTH_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  USER_ID=$(echo "$login_response" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)
  hashed_pass=$(docker exec -w /workspace/apps/api "$API_CONTAINER" node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$LIMITED_PASS', 10));")
  run_sql "INSERT INTO users (id, username, passwordhash) VALUES (gen_random_uuid(), '$LIMITED_USER', '$hashed_pass') ON CONFLICT (username) DO NOTHING;"
  login_response=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"$LIMITED_USER\",\"password\":\"$LIMITED_PASS\"}")
  LIMITED_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  LIMITED_USER_ID=$(echo "$login_response" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)
  [ -n "$AUTH_TOKEN" ] || { echo -e "${RED}Authentication failed${NC}"; echo "$login_response"; exit 1; }
  [ -n "$LIMITED_TOKEN" ] || { echo -e "${RED}Limited authentication failed${NC}"; exit 1; }
}

create_repo() {
  local name="$1" type="$2" config_json="$3" body id
  body=$(curl -sS -X POST "$API_URL/repositories" -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" -d "{\"name\":\"$name\",\"type\":\"$type\",\"manager\":\"maven\",\"config\":$config_json}")
  id=$(echo "$body" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)
  [ -n "$id" ] || { echo -e "${RED}Failed to create repo $name: $body${NC}"; exit 1; }
  REPO_IDS+=("$id")
  echo "$id"
}

get_artifact() {
  local repo_id="$1" repo_path="$2" output_file="$3" code
  code=$(curl -sS -o "$output_file" -w "%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/$repo_id/$repo_path")
  [ "$code" = "200" ] || { echo -e "${RED}GET failed ($code) -> $repo_id/$repo_path${NC}"; exit 1; }
}

put_artifact() {
  local repo_id="$1" repo_path="$2" file_path="$3" code
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/octet-stream" --data-binary "@$file_path" "$REPOS_URL/$repo_id/$repo_path")
  [ "$code" = "200" ] || { echo -e "${RED}PUT failed ($code) -> $repo_id/$repo_path${NC}"; exit 1; }
}

put_artifact_status() {
  local repo_id="$1" repo_path="$2" file_path="$3" token="$4"
  if [ -n "$token" ]; then curl -sS -o /dev/null -w "%{http_code}" -X PUT -H "Authorization: Bearer $token" -H "Content-Type: application/octet-stream" --data-binary "@$file_path" "$REPOS_URL/$repo_id/$repo_path"; return; fi
  curl -sS -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: application/octet-stream" --data-binary "@$file_path" "$REPOS_URL/$repo_id/$repo_path"
}

upload_via_group() {
  local repo_id="$1" repo_path="$2" file_path="$3" content response
  content=$(base64 -w0 "$file_path")
  response=$(curl -sS -X POST "$REPOS_URL/$repo_id/upload" -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" -d "{\"path\":\"$repo_path\",\"encoding\":\"base64\",\"content\":\"$content\"}")
  echo "$response" | grep -q '"ok":true' || { echo -e "${RED}Group upload failed: $response${NC}"; exit 1; }
}

create_real_maven_artifact() {
  local artifact_id="$1" version="$2" class_name="$3" target_dir source_dir classes_dir
  target_dir="$ARTIFACT_DIR/$artifact_id-$version"
  source_dir="$target_dir/src/main/java/com/acme"
  classes_dir="$target_dir/classes"
  mkdir -p "$source_dir" "$classes_dir"
  cat > "$source_dir/$class_name.java" <<EOF
package com.acme;

public final class $class_name {
    public static String version() {
        return "$version";
    }
}
EOF
  cat > "$target_dir/$artifact_id-$version.pom" <<EOF
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd"><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>$artifact_id</artifactId><version>$version</version><packaging>jar</packaging></project>
EOF
  javac -d "$classes_dir" "$source_dir/$class_name.java"
  jar --create --file "$target_dir/$artifact_id-$version.jar" -C "$classes_dir" . >/dev/null
  echo "$target_dir"
}

verify_pom() { grep -q "<artifactId>$2</artifactId>" "$1" && grep -q "<version>$3</version>" "$1" || { echo -e "${RED}Invalid POM: $1${NC}"; exit 1; }; }
verify_jar() { jar tf "$1" | grep -q "com/acme/$2.class" || { echo -e "${RED}Invalid JAR: $1${NC}"; exit 1; }; }
verify_sha1() { [ "$(sha1sum "$1" | awk '{print $1}')" = "$(tr -d '[:space:]' < "$2")" ] || { echo -e "${RED}Checksum mismatch for $1${NC}"; exit 1; }; }

download_and_verify_release() {
  local repo_id="$1" artifact_id="$2" version="$3" class_name="$4" prefix base
  prefix="$TEMP_DIR/$repo_id-$artifact_id-$version"
  base="com/acme/$artifact_id/$version/$artifact_id-$version"
  get_artifact "$repo_id" "$base.pom" "$prefix.pom"
  get_artifact "$repo_id" "$base.jar" "$prefix.jar"
  verify_pom "$prefix.pom" "$artifact_id" "$version"
  verify_jar "$prefix.jar" "$class_name"
}

stage_upstream_files() {
  local auth_artifact snapshot_artifact auth_dir snapshot_dir server_file metadata_file
  auth_artifact=$(create_real_maven_artifact "authdemo" "1.0.0" "AuthDemo")
  snapshot_artifact=$(create_real_maven_artifact "snapdemo" "1.0.0-SNAPSHOT" "SnapDemo")
  auth_dir="$TEMP_DIR/upstream/com/acme/authdemo/1.0.0"
  snapshot_dir="$TEMP_DIR/upstream/com/acme/snapdemo/1.0.0-SNAPSHOT"
  mkdir -p "$auth_dir" "$snapshot_dir"
  cp "$auth_artifact/authdemo-1.0.0.pom" "$auth_dir/authdemo-1.0.0.pom"
  cp "$auth_artifact/authdemo-1.0.0.jar" "$auth_dir/authdemo-1.0.0.jar"
  cp "$snapshot_artifact/snapdemo-1.0.0-SNAPSHOT.pom" "$snapshot_dir/snapdemo-1.0.0-$SNAPSHOT_TS-$SNAPSHOT_BUILD.pom"
  cp "$snapshot_artifact/snapdemo-1.0.0-SNAPSHOT.jar" "$snapshot_dir/snapdemo-1.0.0-$SNAPSHOT_TS-$SNAPSHOT_BUILD.jar"
  metadata_file="$snapshot_dir/maven-metadata.xml"
  cat > "$metadata_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?><metadata><groupId>com.acme</groupId><artifactId>snapdemo</artifactId><version>1.0.0-SNAPSHOT</version><versioning><snapshot><timestamp>$SNAPSHOT_TS</timestamp><buildNumber>$SNAPSHOT_BUILD</buildNumber></snapshot><snapshotVersions><snapshotVersion><extension>pom</extension><value>1.0.0-$SNAPSHOT_TS-$SNAPSHOT_BUILD</value><updated>20251213000000</updated></snapshotVersion><snapshotVersion><extension>jar</extension><value>1.0.0-$SNAPSHOT_TS-$SNAPSHOT_BUILD</value><updated>20251213000000</updated></snapshotVersion></snapshotVersions></versioning></metadata>
EOF
  server_file="$TEMP_DIR/upstream-server.js"
  cat > "$server_file" <<EOF
const fs = require('fs'); const path = require('path'); const http = require('http'); const root = '/tmp/e2e-maven-upstream'; const user = '$UP_USER'; const pass = '$UP_PASS'; const port = $UP_PORT; const unauthorized = (res) => { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="up"' }); res.end('Unauthorized'); }; http.createServer((req, res) => { const auth = req.headers.authorization || ''; if (!auth.startsWith('Basic ')) return unauthorized(res); const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8'); if (decoded !== user + ':' + pass) return unauthorized(res); const safePath = path.normalize(req.url).replace(/^\/+/, ''); const filePath = path.join(root, safePath); if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': filePath.endsWith('.jar') ? 'application/java-archive' : 'application/xml' }); fs.createReadStream(filePath).pipe(res); }).listen(port, '0.0.0.0', () => console.log('e2e-maven-basic-upstream listening', port)); process.title = 'e2e-maven-basic-upstream';
EOF
  docker exec "$API_CONTAINER" sh -lc "rm -rf /tmp/e2e-maven-upstream && mkdir -p /tmp/e2e-maven-upstream"
  docker cp "$TEMP_DIR/upstream/." "$API_CONTAINER:/tmp/e2e-maven-upstream"
  docker cp "$server_file" "$API_CONTAINER:/tmp/e2e-maven-upstream/server.js"
}

setup_auth
echo "Starting Maven E2E Test..."

PROXY_ID=$(create_repo "$RUN_ID-proxy" "proxy" '{"proxyUrl":"https://repo1.maven.org/maven2","cacheMaxAgeDays":7}')
get_artifact "$PROXY_ID" "junit/junit/4.12/junit-4.12.pom" "$TEMP_DIR/junit-4.12.pom"
get_artifact "$PROXY_ID" "junit/junit/4.12/junit-4.12.jar" "$TEMP_DIR/junit-4.12.jar"
verify_pom "$TEMP_DIR/junit-4.12.pom" "junit" "4.12"
jar tf "$TEMP_DIR/junit-4.12.jar" | grep -q 'junit/framework/Test.class' || { echo -e "${RED}Maven Proxy Test Failed${NC}"; exit 1; }
echo -e "${GREEN}Maven Proxy Test Passed${NC}"

HOSTED_ID=$(create_repo "$RUN_ID-hosted" "hosted" '{"allowRedeploy":true}')
GROUP_ID=$(create_repo "$RUN_ID-group" "group" "{\"members\":[\"$HOSTED_ID\"],\"writePolicy\":\"first\"}")
DEMO_DIR=$(create_real_maven_artifact "demo" "1.0.0" "Demo")
put_artifact "$HOSTED_ID" "com/acme/demo/1.0.0/demo-1.0.0.pom" "$DEMO_DIR/demo-1.0.0.pom"
put_artifact "$HOSTED_ID" "com/acme/demo/1.0.0/demo-1.0.0.jar" "$DEMO_DIR/demo-1.0.0.jar"
download_and_verify_release "$HOSTED_ID" "demo" "1.0.0" "Demo"
get_artifact "$HOSTED_ID" "com/acme/demo/1.0.0/demo-1.0.0.jar.sha1" "$TEMP_DIR/demo-1.0.0.jar.sha1"
verify_sha1 "$DEMO_DIR/demo-1.0.0.jar" "$TEMP_DIR/demo-1.0.0.jar.sha1"
echo -e "${GREEN}Maven Hosted Test Passed${NC}"

DENY_DIR=$(create_real_maven_artifact "demo-denied" "1.0.0" "DemoDenied")
LIMITED_PUT_CODE=$(put_artifact_status "$HOSTED_ID" "com/acme/demo-denied/1.0.0/demo-denied-1.0.0.pom" "$DENY_DIR/demo-denied-1.0.0.pom" "$LIMITED_TOKEN")
ANON_PUT_CODE=$(put_artifact_status "$HOSTED_ID" "com/acme/demo-denied/1.0.0/demo-denied-1.0.0.pom" "$DENY_DIR/demo-denied-1.0.0.pom" "")
[ "$LIMITED_PUT_CODE" = "403" ] && [ "$ANON_PUT_CODE" = "401" ] || { echo -e "${RED}Maven Permission Test Failed (limited=$LIMITED_PUT_CODE anon=$ANON_PUT_CODE)${NC}"; exit 1; }
echo -e "${GREEN}Maven Permission Test Passed${NC}"

download_and_verify_release "$GROUP_ID" "demo" "1.0.0" "Demo"
echo -e "${GREEN}Maven Group Read Test Passed${NC}"

FIRST_DIR=$(create_real_maven_artifact "demo-first" "1.0.0" "DemoFirst")
upload_via_group "$GROUP_ID" "com/acme/demo-first/1.0.0/demo-first-1.0.0.pom" "$FIRST_DIR/demo-first-1.0.0.pom"
upload_via_group "$GROUP_ID" "com/acme/demo-first/1.0.0/demo-first-1.0.0.jar" "$FIRST_DIR/demo-first-1.0.0.jar"
download_and_verify_release "$HOSTED_ID" "demo-first" "1.0.0" "DemoFirst"
echo -e "${GREEN}Maven Group Write 'first' Passed${NC}"

HOSTED_ID_2=$(create_repo "$RUN_ID-hosted-2" "hosted" '{"allowRedeploy":true}')
GROUP_PREF_ID=$(create_repo "$RUN_ID-group-pref" "group" "{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}")
PREF_DIR=$(create_real_maven_artifact "demo-pref" "1.0.0" "DemoPref")
upload_via_group "$GROUP_PREF_ID" "com/acme/demo-pref/1.0.0/demo-pref-1.0.0.pom" "$PREF_DIR/demo-pref-1.0.0.pom"
upload_via_group "$GROUP_PREF_ID" "com/acme/demo-pref/1.0.0/demo-pref-1.0.0.jar" "$PREF_DIR/demo-pref-1.0.0.jar"
download_and_verify_release "$HOSTED_ID_2" "demo-pref" "1.0.0" "DemoPref"
echo -e "${GREEN}Maven Group Write 'preferred' Passed${NC}"

GROUP_MIRROR_ID=$(create_repo "$RUN_ID-group-mirror" "group" "{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}")
MIRROR_DIR=$(create_real_maven_artifact "demo-mirror" "1.0.0" "DemoMirror")
upload_via_group "$GROUP_MIRROR_ID" "com/acme/demo-mirror/1.0.0/demo-mirror-1.0.0.pom" "$MIRROR_DIR/demo-mirror-1.0.0.pom"
upload_via_group "$GROUP_MIRROR_ID" "com/acme/demo-mirror/1.0.0/demo-mirror-1.0.0.jar" "$MIRROR_DIR/demo-mirror-1.0.0.jar"
download_and_verify_release "$HOSTED_ID" "demo-mirror" "1.0.0" "DemoMirror"
download_and_verify_release "$HOSTED_ID_2" "demo-mirror" "1.0.0" "DemoMirror"
echo -e "${GREEN}Maven Group Write 'mirror' Passed${NC}"

stage_upstream_files
docker exec -d "$API_CONTAINER" sh -lc "node /tmp/e2e-maven-upstream/server.js" > /dev/null
PROXY_AUTH_ID=$(create_repo "$RUN_ID-proxy-auth" "proxy" "{\"proxyUrl\":\"http://localhost:$UP_PORT\",\"requireAuth\":true,\"auth\":{\"type\":\"basic\",\"username\":\"$UP_USER\",\"password\":\"$UP_PASS\"},\"cacheMaxAgeDays\":7}")
download_and_verify_release "$PROXY_AUTH_ID" "authdemo" "1.0.0" "AuthDemo"
echo -e "${GREEN}Maven Proxy Auth Test Passed${NC}"

get_artifact "$PROXY_AUTH_ID" "com/acme/snapdemo/1.0.0-SNAPSHOT/snapdemo-1.0.0-SNAPSHOT.pom" "$TEMP_DIR/snapdemo-snapshot.pom"
get_artifact "$PROXY_AUTH_ID" "com/acme/snapdemo/1.0.0-SNAPSHOT/snapdemo-1.0.0-SNAPSHOT.jar" "$TEMP_DIR/snapdemo-snapshot.jar"
verify_pom "$TEMP_DIR/snapdemo-snapshot.pom" "snapdemo" "1.0.0-SNAPSHOT"
verify_jar "$TEMP_DIR/snapdemo-snapshot.jar" "SnapDemo"
echo -e "${GREEN}Maven SNAPSHOT Resolution Test Passed${NC}"

docker exec "$API_CONTAINER" sh -lc "pkill -f e2e-maven-basic-upstream || true" > /dev/null 2>&1 || true
download_and_verify_release "$PROXY_AUTH_ID" "authdemo" "1.0.0" "AuthDemo"
echo -e "${GREEN}Maven Proxy Cache Test Passed${NC}"

echo -e "${GREEN}All Maven Tests Passed${NC}"
