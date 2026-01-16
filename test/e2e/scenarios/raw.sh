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
    curl -s -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "$DATA" > /dev/null
}

# 1. Hosted Repo
echo "Creating Raw Hosted repository..."
create_repo '{"name":"raw-hosted","type":"hosted","manager":"raw"}'

# Get ID of raw-hosted
HOSTED_RES=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories")
HOSTED_ID=$(echo "$HOSTED_RES" | grep -o '{"id":"[^"]*","name":"raw-hosted"' | cut -d'"' -f4)
echo "Hosted Repo ID: $HOSTED_ID"

echo "Uploading file to Hosted..."
echo "Hello World" > $TEMP_DIR/hello.txt
curl -s -X PUT "$REPOS_URL/raw-hosted/hello.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @$TEMP_DIR/hello.txt

echo "Downloading file..."
curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted/hello.txt" > $TEMP_DIR/downloaded.txt

if grep -q "Hello World" $TEMP_DIR/downloaded.txt; then
    echo -e "${GREEN}Raw Hosted Test Passed${NC}"
else
    echo -e "${RED}Raw Hosted Test Failed${NC}"
    echo "Expected 'Hello World', got:"
    cat $TEMP_DIR/downloaded.txt
    exit 1
fi

# 1.5 Group Read
echo "Testing Group Read..."
create_repo "{\"name\":\"raw-group-read\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\"]}}"

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-group-read/hello.txt")
if [[ "$CONTENT" == *"Hello World"* ]]; then
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

echo "First Content" > $TEMP_DIR/first.txt
curl -s -X PUT "$REPOS_URL/raw-group/first.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @$TEMP_DIR/first.txt

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted/first.txt")
if [[ "$CONTENT" == *"First Content"* ]]; then
    echo -e "${GREEN}Raw Group Write 'first' Passed${NC}"
else
    echo -e "${RED}Raw Group Write 'first' Failed${NC}"
fi

# Preferred
echo "Testing 'preferred' policy..."
create_repo "{\"name\":\"raw-group-pref\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}}"

echo "Pref Content" > $TEMP_DIR/pref.txt
curl -s -X PUT "$REPOS_URL/raw-group-pref/pref.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @$TEMP_DIR/pref.txt

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted-2/pref.txt")
if [[ "$CONTENT" == *"Pref Content"* ]]; then
    echo -e "${GREEN}Raw Group Write 'preferred' Passed${NC}"
else
    echo -e "${RED}Raw Group Write 'preferred' Failed${NC}"
fi

# Mirror
echo "Testing 'mirror' policy..."
create_repo "{\"name\":\"raw-group-mirror\",\"type\":\"group\",\"manager\":\"raw\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}}"

echo "Mirror Content" > $TEMP_DIR/mirror.txt
curl -s -X PUT "$REPOS_URL/raw-group-mirror/mirror.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @$TEMP_DIR/mirror.txt

CONTENT1=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted/mirror.txt")
CONTENT2=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/raw-hosted-2/mirror.txt")

if [[ "$CONTENT1" == *"Mirror Content"* ]] && [[ "$CONTENT2" == *"Mirror Content"* ]]; then
    echo -e "${GREEN}Raw Group Write 'mirror' Passed${NC}"
else
    echo -e "${RED}Raw Group Write 'mirror' Failed${NC}"
fi

echo "Raw E2E Test Completed"
