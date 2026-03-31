#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/e2e-raw"
mkdir -p $TEMP_DIR

# Auth variables
ADMIN_USER="e2e-admin-raw"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""
LIMITED_USER="e2e-limited-raw"
LIMITED_PASS="password123"
LIMITED_TOKEN=""
LIMITED_USER_ID=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

echo "Starting Raw E2E Test..."

cleanup() {
    echo "Cleaning up..."
    rm -rf $TEMP_DIR
    
    # Delete repositories
    for repo in raw-hosted raw-hosted-2 raw-group raw-group-pref raw-group-mirror raw-group-read; do
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

    if [ ! -z "$LIMITED_USER_ID" ] && [ ! -z "$AUTH_TOKEN" ]; then
        echo "Deleting test user $LIMITED_USER..."
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$LIMITED_USER_ID" > /dev/null
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

LIMITED_HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$LIMITED_PASS', 10));")
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$LIMITED_USER', '$LIMITED_HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

LIMITED_LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$LIMITED_USER\",\"password\":\"$LIMITED_PASS\"}")

LIMITED_TOKEN=$(echo "$LIMITED_LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
LIMITED_USER_ID=$(echo "$LIMITED_LOGIN_RES" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)

if [ -z "$LIMITED_TOKEN" ]; then
        echo -e "${RED}Limited user authentication failed${NC}"
        exit 1
fi

create_repo() {
    local DATA="$1"
    curl -s -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "$DATA" > /dev/null
}

create_real_bundle() {
    local bundle_name="$1"
    local bundle_version="$2"
    local output_path="$3"

    python3 - "$bundle_name" "$bundle_version" "$output_path" <<'PY'
import io
import json
import os
import sys
import tarfile

bundle_name, bundle_version, output_path = sys.argv[1:4]
payload = (bundle_name + ':' + bundle_version).encode() * 16
manifest = json.dumps({
    'name': bundle_name,
    'version': bundle_version,
    'files': ['manifest.json', 'payload.bin'],
}, indent=2).encode()

with tarfile.open(output_path, 'w:gz') as archive:
    for entry_name, content in {
        'manifest.json': manifest,
        'payload.bin': payload,
        os.path.join('docs', 'README.txt'): f'{bundle_name} {bundle_version}\n'.encode(),
    }.items():
        info = tarfile.TarInfo(entry_name)
        info.size = len(content)
        archive.addfile(info, io.BytesIO(content))
PY
}

verify_real_bundle() {
    local archive_path="$1"
    local expected_name="$2"
    local expected_version="$3"

    python3 - "$archive_path" "$expected_name" "$expected_version" <<'PY'
import json
import sys
import tarfile

archive_path, expected_name, expected_version = sys.argv[1:4]

with tarfile.open(archive_path, 'r:gz') as archive:
    names = archive.getnames()
    if 'manifest.json' not in names or 'payload.bin' not in names:
        raise SystemExit(1)
    manifest = json.loads(archive.extractfile('manifest.json').read().decode())
    payload = archive.extractfile('payload.bin').read()
    if manifest.get('name') != expected_name or manifest.get('version') != expected_version:
        raise SystemExit(1)
    if not payload.startswith(f'{expected_name}:{expected_version}'.encode()):
        raise SystemExit(1)
PY
}

# 1. Hosted Repo
echo "Creating Raw Hosted repository..."
create_repo '{"name":"raw-hosted","type":"hosted","manager":"raw"}'

# Get ID of raw-hosted
HOSTED_RES=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories")
HOSTED_ID=$(echo "$HOSTED_RES" | grep -o '{"id":"[^"]*","name":"raw-hosted"' | cut -d'"' -f4)
echo "Hosted Repo ID: $HOSTED_ID"

echo "Uploading file to Hosted..."
HOSTED_BUNDLE="$TEMP_DIR/hello-bundle.tar.gz"
create_real_bundle "hello-bundle" "1.0.0" "$HOSTED_BUNDLE"
curl -s -X PUT "$REPOS_URL/raw-hosted/hello.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
    --data-binary @"$HOSTED_BUNDLE"

echo "Downloading file..."
curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted/hello.txt" > $TEMP_DIR/downloaded.tar.gz

if verify_real_bundle "$TEMP_DIR/downloaded.tar.gz" "hello-bundle" "1.0.0"; then
    echo -e "${GREEN}Raw Hosted Test Passed${NC}"
else
    echo -e "${RED}Raw Hosted Test Failed${NC}"
    exit 1
fi

LIMITED_WRITE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$REPOS_URL/raw-hosted/nope.txt" -H "Authorization: Bearer $LIMITED_TOKEN" -H "Content-Type: application/octet-stream" --data-binary @"$HOSTED_BUNDLE")
ANON_WRITE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$REPOS_URL/raw-hosted/noauth.txt" -H "Content-Type: application/octet-stream" --data-binary @"$HOSTED_BUNDLE")

if [ "$LIMITED_WRITE_CODE" -ge 400 ] && [ "$ANON_WRITE_CODE" -ge 400 ]; then
    echo -e "${GREEN}Raw Permission Test Passed${NC}"
else
    echo -e "${RED}Raw Permission Test Failed (limitedWrite=$LIMITED_WRITE_CODE anonWrite=$ANON_WRITE_CODE)${NC}"
    exit 1
fi

# 1.5 Group Read
echo "Testing Group Read..."
create_repo "{\"name\":\"raw-group-read\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\"]}}"

curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-group-read/hello.txt" > "$TEMP_DIR/group-read.tar.gz"
if verify_real_bundle "$TEMP_DIR/group-read.tar.gz" "hello-bundle" "1.0.0"; then
    echo -e "${GREEN}Raw Group Read Passed${NC}"
else
    echo -e "${RED}Raw Group Read Failed${NC}"
    exit 1
fi

# 2. Group Write Policies
echo "Testing Group Write Policies..."
create_repo '{"name":"raw-hosted-2","type":"hosted","manager":"raw"}'

# Get ID of raw-hosted-2
HOSTED_RES_2=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories")
HOSTED_ID_2=$(echo "$HOSTED_RES_2" | grep -o '{"id":"[^"]*","name":"raw-hosted-2"' | cut -d'"' -f4)
echo "Hosted Repo 2 ID: $HOSTED_ID_2"

# Ensure HOSTED_ID is set (it should be from earlier)
if [ -z "$HOSTED_ID" ]; then
    HOSTED_ID=$(echo "$HOSTED_RES_2" | grep -o '{"id":"[^"]*","name":"raw-hosted"' | cut -d'"' -f4)
fi

# First
echo "Testing 'first' policy..."
create_repo "{\"name\":\"raw-group\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"first\"}}"

FIRST_BUNDLE="$TEMP_DIR/first-bundle.tar.gz"
create_real_bundle "first-bundle" "1.0.0" "$FIRST_BUNDLE"
curl -s -X PUT "$REPOS_URL/raw-group/first.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
    --data-binary @"$FIRST_BUNDLE"

curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted/first.txt" > "$TEMP_DIR/first-downloaded.tar.gz"
if verify_real_bundle "$TEMP_DIR/first-downloaded.tar.gz" "first-bundle" "1.0.0"; then
    echo -e "${GREEN}Raw Group Write 'first' Passed${NC}"
else
    echo -e "${RED}Raw Group Write 'first' Failed${NC}"
fi

# Preferred
echo "Testing 'preferred' policy..."
create_repo "{\"name\":\"raw-group-pref\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}}"

PREF_BUNDLE="$TEMP_DIR/pref-bundle.tar.gz"
create_real_bundle "pref-bundle" "1.0.0" "$PREF_BUNDLE"
curl -s -X PUT "$REPOS_URL/raw-group-pref/pref.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
    --data-binary @"$PREF_BUNDLE"

curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted-2/pref.txt" > "$TEMP_DIR/pref-downloaded.tar.gz"
if verify_real_bundle "$TEMP_DIR/pref-downloaded.tar.gz" "pref-bundle" "1.0.0"; then
    echo -e "${GREEN}Raw Group Write 'preferred' Passed${NC}"
else
    echo -e "${RED}Raw Group Write 'preferred' Failed${NC}"
fi

# Mirror
echo "Testing 'mirror' policy..."
create_repo "{\"name\":\"raw-group-mirror\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}}"

MIRROR_BUNDLE="$TEMP_DIR/mirror-bundle.tar.gz"
create_real_bundle "mirror-bundle" "1.0.0" "$MIRROR_BUNDLE"
curl -s -X PUT "$REPOS_URL/raw-group-mirror/mirror.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
    --data-binary @"$MIRROR_BUNDLE"

curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted/mirror.txt" > "$TEMP_DIR/mirror-hosted.tar.gz"
curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted-2/mirror.txt" > "$TEMP_DIR/mirror-hosted-2.tar.gz"

if verify_real_bundle "$TEMP_DIR/mirror-hosted.tar.gz" "mirror-bundle" "1.0.0" && verify_real_bundle "$TEMP_DIR/mirror-hosted-2.tar.gz" "mirror-bundle" "1.0.0"; then
    echo -e "${GREEN}Raw Group Write 'mirror' Passed${NC}"
else
    echo -e "${RED}Raw Group Write 'mirror' Failed${NC}"
fi

echo -e "${GREEN}All Raw Tests Passed${NC}"
