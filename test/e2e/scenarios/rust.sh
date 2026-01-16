#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/e2e-rust"
mkdir -p $TEMP_DIR

# Auth variables
ADMIN_USER="e2e-admin-rust"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

echo "Starting Rust (Cargo) E2E Test..."

cleanup() {
    echo "Cleaning up..."
    rm -rf $TEMP_DIR
    
    # Delete repositories
    for repo in rust-proxy rust-hosted rust-hosted-2 rust-group rust-group-pref rust-group-mirror rust-group-read rust-hosted-auth rust-proxy-auth; do
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
echo "Creating Rust Hosted repository..."
create_repo '{"name":"rust-hosted","type":"hosted","manager":"rust"}'

echo "Uploading crate to Hosted..."
# Rust plugin expects multipart or raw body.
UPLOAD_RES=$(curl -s -X POST "$REPOS_URL/rust-hosted/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"my-crate","version":"0.1.0","content":"hosted-content"}')
echo "Upload response: $UPLOAD_RES"

echo "Verifying download..."
CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-hosted/my-crate/0.1.0")
echo "Download content: $CONTENT"
if [[ "$CONTENT" == *"hosted-content"* ]]; then
    echo -e "${GREEN}Rust Hosted Test Passed${NC}"
else
    echo -e "${RED}Rust Hosted Test Failed${NC}"
    exit 1
fi

# 1.5 Proxy Download
echo "Testing Proxy Download..."
# Point proxy to the hosted repo we just created
# URL format: $REPOS_URL/rust-hosted
create_repo "{\"name\":\"rust-proxy\",\"type\":\"proxy\",\"manager\":\"rust\",\"config\":{\"url\":\"http://localhost:3000/repository/rust-hosted\",\"cacheMaxAgeDays\":7}}"

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-proxy/my-crate/0.1.0")
if [[ "$CONTENT" == *"hosted-content"* ]]; then
    echo -e "${GREEN}Rust Proxy Download Passed${NC}"
else
    echo -e "${RED}Rust Proxy Download Failed${NC}"
    echo "Expected 'hosted-content', got '$CONTENT'"
    exit 1
fi

# 1.6 Group Download
echo "Testing Group Download..."
create_repo "{\"name\":\"rust-group-read\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"rust-proxy\"]}}"

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-group-read/my-crate/0.1.0")
if [[ "$CONTENT" == *"hosted-content"* ]]; then
    echo -e "${GREEN}Rust Group Download Passed${NC}"
else
    echo -e "${RED}Rust Group Download Failed${NC}"
    exit 1
fi

# 1.7 Proxy Auth
echo "Testing Proxy Auth..."
# Create a separate hosted repo for auth test
create_repo '{"name":"rust-hosted-auth","type":"hosted","manager":"rust"}'
curl -s -X POST "$API_URL/repositories/rust-hosted-auth/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"auth-crate","version":"0.1.0","content":"auth-content"}' > /dev/null

# Create a user for auth
AUTH_USER="rust-auth-user"
AUTH_PASS="authpass123"
HASHED_AUTH_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$AUTH_PASS', 10));")
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$AUTH_USER', '$HASHED_AUTH_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null
# Give read access
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r WHERE u.username = '$AUTH_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
" > /dev/null

# Create proxy with auth
create_repo "{\"name\":\"rust-proxy-auth\",\"type\":\"proxy\",\"manager\":\"rust\",\"config\":{\"url\":\"http://localhost:3000/repository/rust-hosted-auth\",\"auth\":{\"username\":\"$AUTH_USER\",\"password\":\"$AUTH_PASS\"},\"cacheMaxAgeDays\":7}}"

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-proxy-auth/auth-crate/0.1.0")
if [[ "$CONTENT" == *"auth-content"* ]]; then
    echo -e "${GREEN}Rust Proxy Auth Passed${NC}"
else
    echo -e "${RED}Rust Proxy Auth Failed${NC}"
    echo "Expected 'auth-content', got '$CONTENT'"
    exit 1
fi

# 2. Group Write Policies
echo "Testing Group Write Policies..."
create_repo '{"name":"rust-hosted-2","type":"hosted","manager":"rust"}'

HOSTED_ID=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o '"id":"[^"]*","name":"rust-hosted"' | cut -d'"' -f4)
HOSTED_ID_2=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o '"id":"[^"]*","name":"rust-hosted-2"' | cut -d'"' -f4)

# First
echo "Testing 'first' policy..."
create_repo "{\"name\":\"rust-group\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"first\"}}"

curl -s -X POST "$REPOS_URL/rust-group/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"crate-first","version":"0.1.0","content":"first-content"}' > /dev/null

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-hosted/crate-first/0.1.0")
if [[ "$CONTENT" == *"first-content"* ]]; then
    echo -e "${GREEN}Rust Group Write 'first' Passed${NC}"
else
    echo -e "${RED}Rust Group Write 'first' Failed${NC}"
fi

# Preferred
echo "Testing 'preferred' policy..."
create_repo "{\"name\":\"rust-group-pref\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}}"

curl -s -X POST "$REPOS_URL/rust-group-pref/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"crate-pref","version":"0.1.0","content":"pref-content"}' > /dev/null

CONTENT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-hosted-2/crate-pref/0.1.0")
if [[ "$CONTENT" == *"pref-content"* ]]; then
    echo -e "${GREEN}Rust Group Write 'preferred' Passed${NC}"
else
    echo -e "${RED}Rust Group Write 'preferred' Failed${NC}"
fi

# Mirror
echo "Testing 'mirror' policy..."
create_repo "{\"name\":\"rust-group-mirror\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}}"

curl -s -X POST "$REPOS_URL/rust-group-mirror/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"crate-mirror","version":"0.1.0","content":"mirror-content"}' > /dev/null

CONTENT1=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-hosted/crate-mirror/0.1.0")
CONTENT2=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/rust-hosted-2/crate-mirror/0.1.0")

if [[ "$CONTENT1" == *"mirror-content"* ]] && [[ "$CONTENT2" == *"mirror-content"* ]]; then
    echo -e "${GREEN}Rust Group Write 'mirror' Passed${NC}"
else
    echo -e "${RED}Rust Group Write 'mirror' Failed${NC}"
fi

echo "Rust E2E Test Completed"
