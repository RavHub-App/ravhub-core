#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
PORT_PROXY=5001
PORT_HOSTED=5002
PORT_PROXY_AUTH=5003
PORT_GROUP=5004
PORT_PROXY_K8S=5005
PORT_HOSTED_2=5006

# Auth variables
ADMIN_USER="e2e-admin-docker"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""
LIMITED_USER="e2e-limited-docker"
LIMITED_PASS="password123"
LIMITED_TOKEN=""
LIMITED_USER_ID=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

echo "Starting Docker E2E Test..."

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    
    # Delete repositories
    for repo in docker-proxy docker-proxy-k8s docker-hosted docker-proxy-auth docker-group docker-group-write docker-hosted-2 docker-group-pref docker-group-mirror; do
        # Get ID
        if [ ! -z "$AUTH_TOKEN" ]; then
            ID=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$repo\"" | cut -d'"' -f4)
            if [ ! -z "$ID" ]; then
                echo "Deleting repo $repo ($ID)..."
                curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$ID" > /dev/null
            fi
        fi
    done

    # Delete user if exists
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

wait_for_registry() {
  local port="$1"
  local code=""

  for _ in {1..30}; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port/v2/" || true)
    if [ "$code" = "200" ] || [ "$code" = "401" ]; then
      return 0
    fi
    sleep 1
  done

  echo -e "${RED}Registry on port $port did not become ready${NC}"
  return 1
}

delete_docker_repo_on_port() {
  local port="$1"
  local repo_id
  repo_id=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | python3 -c "import json, sys; target = int(sys.argv[1]); data = json.load(sys.stdin); print(next((repo.get('id', '') for repo in data if repo.get('manager') == 'docker' and ((repo.get('config') or {}).get('docker') or {}).get('port') == target), ''))" "$port")

  if [ -n "$repo_id" ]; then
    echo "Deleting stale docker repo on port $port ($repo_id)..."
    curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$repo_id" > /dev/null
  fi
}

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

# Login to get token
LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER_ID=$(echo "$LOGIN_RES" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${RED}Failed to authenticate${NC}"
    exit 1
fi

LIMITED_HASH=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$LIMITED_PASS', 10));")
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$LIMITED_USER', '$LIMITED_HASH')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

LIMITED_LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$LIMITED_USER\",\"password\":\"$LIMITED_PASS\"}")

LIMITED_TOKEN=$(echo "$LIMITED_LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
LIMITED_USER_ID=$(echo "$LIMITED_LOGIN_RES" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)

if [ -z "$LIMITED_TOKEN" ]; then
    echo -e "${RED}Failed to authenticate limited user: $LIMITED_LOGIN_RES${NC}"
    exit 1
fi

echo "Authenticated as $ADMIN_USER (ID: $USER_ID)"

for repo in docker-proxy docker-proxy-k8s docker-hosted docker-proxy-auth docker-group docker-group-write docker-hosted-2 docker-group-pref docker-group-mirror; do
  EXISTING_ID=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$repo\"" | cut -d'"' -f4)
  if [ -n "$EXISTING_ID" ]; then
    echo "Deleting stale repo $repo ($EXISTING_ID)..."
    curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$EXISTING_ID" > /dev/null
  fi
done

for port in "$PORT_PROXY" "$PORT_HOSTED" "$PORT_PROXY_AUTH" "$PORT_GROUP" "$PORT_PROXY_K8S" "$PORT_HOSTED_2"; do
  delete_docker_repo_on_port "$port"
done

# Login to Docker registries moved to after repo creation


# 1. Create Docker Proxy Repository (Docker Hub)
echo "Creating Docker Proxy repository (Docker Hub)..."
CREATE_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-proxy\",\"type\":\"proxy\",\"manager\":\"docker\",\"config\":{\"proxyUrl\":\"https://registry-1.docker.io\",\"cacheMaxAgeDays\":7,\"docker\":{\"port\":$PORT_PROXY}}}")

if [[ $CREATE_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create proxy repository: $CREATE_RES${NC}"
    exit 1
fi
echo "Repository docker-proxy created."

wait_for_registry "$PORT_PROXY"

echo "Logging in to localhost:$PORT_PROXY..."
echo "$ADMIN_PASS" | docker login localhost:$PORT_PROXY -u "$ADMIN_USER" --password-stdin

# 2. Pull an image through the proxy
echo "Pulling alpine via proxy..."
docker pull localhost:$PORT_PROXY/library/alpine:latest
echo -e "${GREEN}Docker Proxy (Hub) Test Passed${NC}"

# 2b. Create Docker Proxy Repository (registry.k8s.io)
echo "Creating Docker Proxy repository (registry.k8s.io)..."
CREATE_K8S_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-proxy-k8s\",\"type\":\"proxy\",\"manager\":\"docker\",\"config\":{\"proxyUrl\":\"https://registry.k8s.io\",\"cacheMaxAgeDays\":7,\"docker\":{\"port\":$PORT_PROXY_K8S}}}")

if [[ $CREATE_K8S_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create k8s proxy repository: $CREATE_K8S_RES${NC}"
    exit 1
fi
echo "Repository docker-proxy-k8s created."

wait_for_registry "$PORT_PROXY_K8S"

echo "Logging in to localhost:$PORT_PROXY_K8S..."
echo "$ADMIN_PASS" | docker login localhost:$PORT_PROXY_K8S -u "$ADMIN_USER" --password-stdin

echo "Pulling pause via k8s proxy..."
for i in {1..3}; do
  if docker pull localhost:$PORT_PROXY_K8S/pause:3.10; then
        break
    fi
    echo "Pull failed, retrying ($i/3)..."
    sleep 3
done
# Check if it succeeded by inspecting
if ! docker image inspect localhost:$PORT_PROXY_K8S/pause:3.10 >/dev/null 2>&1; then
    echo "Failed to pull pause image after retries"
    exit 1
fi
echo -e "${GREEN}Docker Proxy (registry.k8s.io) Test Passed${NC}"

# 3. Create Hosted Repository
echo "Creating Docker Hosted repository..."
CREATE_HOSTED_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-hosted\",\"type\":\"hosted\",\"manager\":\"docker\",\"config\":{\"docker\":{\"port\":$PORT_HOSTED}}}")

if [[ $CREATE_HOSTED_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create hosted repository: $CREATE_HOSTED_RES${NC}"
    exit 1
fi
echo "Repository docker-hosted created."
HOSTED_ID=$(echo "$CREATE_HOSTED_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

wait_for_registry "$PORT_HOSTED"

echo "Logging in to localhost:$PORT_HOSTED..."
echo "$ADMIN_PASS" | docker login localhost:$PORT_HOSTED -u "$ADMIN_USER" --password-stdin

# 4. Push to Hosted
echo "Pushing image to hosted repo..."
docker tag localhost:$PORT_PROXY/library/alpine:latest localhost:$PORT_HOSTED/my-alpine:latest
docker push localhost:$PORT_HOSTED/my-alpine:latest
echo -e "${GREEN}Docker Hosted Push Test Passed${NC}"

echo "Testing denied writes for limited and anonymous users..."
docker tag localhost:$PORT_PROXY/library/alpine:latest localhost:$PORT_HOSTED/limited-image:latest
echo "$LIMITED_PASS" | docker login localhost:$PORT_HOSTED -u "$LIMITED_USER" --password-stdin >/dev/null 2>&1
if docker push localhost:$PORT_HOSTED/limited-image:latest >/tmp/docker-limited-push.log 2>&1; then
  echo -e "${RED}Docker Permission Test Failed: limited user push succeeded${NC}"
  cat /tmp/docker-limited-push.log
  exit 1
fi

docker logout localhost:$PORT_HOSTED >/dev/null 2>&1 || true
docker tag localhost:$PORT_PROXY/library/alpine:latest localhost:$PORT_HOSTED/anon-image:latest
if docker push localhost:$PORT_HOSTED/anon-image:latest >/tmp/docker-anon-push.log 2>&1; then
  echo -e "${RED}Docker Permission Test Failed: anonymous push succeeded${NC}"
  cat /tmp/docker-anon-push.log
  exit 1
fi

LIMITED_BEARER_PUSH_CODE=$(curl -s -o /tmp/docker-limited-bearer-token.json -w "%{http_code}" \
  -H "Authorization: Bearer $LIMITED_TOKEN" \
  "$API_URL/repository/$HOSTED_ID/v2/token?service=localhost:$PORT_HOSTED&scope=repository:bearer-image:push")

ADMIN_BEARER_PUSH_CODE=$(curl -s -o /tmp/docker-admin-bearer-token.json -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$API_URL/repository/$HOSTED_ID/v2/token?service=localhost:$PORT_HOSTED&scope=repository:bearer-image:push")

if [ "$LIMITED_BEARER_PUSH_CODE" != "401" ] || [ "$ADMIN_BEARER_PUSH_CODE" != "200" ]; then
  echo -e "${RED}Docker Bearer Permission Test Failed (limited=$LIMITED_BEARER_PUSH_CODE admin=$ADMIN_BEARER_PUSH_CODE)${NC}"
  cat /tmp/docker-limited-bearer-token.json 2>/dev/null || true
  cat /tmp/docker-admin-bearer-token.json 2>/dev/null || true
  exit 1
fi

echo "$ADMIN_PASS" | docker login localhost:$PORT_HOSTED -u "$ADMIN_USER" --password-stdin >/dev/null 2>&1
echo -e "${GREEN}Docker Permission Test Passed${NC}"

# 5. Create Proxy to Hosted (Auth)
# We use the hosted repo as upstream. The proxy performs server-side pulls and must authenticate
# against the hosted registry to obtain an upstream Bearer token.
echo "Creating Docker Proxy to Hosted (Auth)..."
CREATE_PROXY_AUTH_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-proxy-auth\",\"type\":\"proxy\",\"manager\":\"docker\",\"config\":{\"proxyUrl\":\"http://localhost:$PORT_HOSTED\",\"requireAuth\":true,\"auth\":{\"type\":\"basic\",\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"},\"cacheMaxAgeDays\":7,\"docker\":{\"port\":$PORT_PROXY_AUTH}}}")

if [[ $CREATE_PROXY_AUTH_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create proxy auth repository: $CREATE_PROXY_AUTH_RES${NC}"
    exit 1
fi
echo "Repository docker-proxy-auth created."

wait_for_registry "$PORT_PROXY_AUTH"

echo "Logging in to localhost:$PORT_PROXY_AUTH..."
echo "$ADMIN_PASS" | docker login localhost:$PORT_PROXY_AUTH -u "$ADMIN_USER" --password-stdin

# 6. Pull from Proxy Auth
echo "Pulling via Proxy Auth..."
docker pull localhost:$PORT_PROXY_AUTH/my-alpine:latest
echo -e "${GREEN}Docker Proxy Auth Test Passed${NC}"

curl -s -X PUT "$API_URL/repositories/$(echo "$CREATE_PROXY_AUTH_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"proxyUrl\":\"http://localhost:9\",\"requireAuth\":true,\"auth\":{\"type\":\"basic\",\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"},\"cacheMaxAgeDays\":7,\"docker\":{\"port\":$PORT_PROXY_AUTH}}}" > /dev/null

docker image rm localhost:$PORT_PROXY_AUTH/my-alpine:latest >/dev/null 2>&1 || true
if docker pull localhost:$PORT_PROXY_AUTH/my-alpine:latest; then
    echo -e "${GREEN}Docker Proxy Cache Test Passed${NC}"
else
    echo -e "${RED}Docker Proxy Cache Test Failed${NC}"
    exit 1
fi

# 7. Create Group Repository
echo "Creating Docker Group repository..."
CREATE_GROUP_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-group\",\"type\":\"group\",\"manager\":\"docker\",\"config\":{\"members\":[\"$HOSTED_ID\"],\"docker\":{\"port\":$PORT_GROUP}}}")

if [[ $CREATE_GROUP_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create group repository: $CREATE_GROUP_RES${NC}"
    exit 1
fi
echo "Repository docker-group created."

wait_for_registry "$PORT_GROUP"

echo "Logging in to localhost:$PORT_GROUP..."
echo "$ADMIN_PASS" | docker login localhost:$PORT_GROUP -u "$ADMIN_USER" --password-stdin

# 8. Group Download
echo "Pulling via Group..."
docker pull localhost:$PORT_GROUP/my-alpine:latest
echo -e "${GREEN}Docker Group Download Test Passed${NC}"

# 9. Group Write (First)
echo "Testing Group Write (First)..."
# Update group to writePolicy: first
GROUP_ID=$(echo "$CREATE_GROUP_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"members\":[\"$HOSTED_ID\"],\"writePolicy\":\"first\",\"docker\":{\"port\":$PORT_GROUP}}}" > /dev/null

sleep 2

echo "Pushing to Group..."
docker tag localhost:$PORT_PROXY/library/alpine:latest localhost:$PORT_GROUP/group-image:latest
docker push localhost:$PORT_GROUP/group-image:latest

# Verify it ended up in hosted (5002)
echo "Verifying push to hosted via group..."
docker pull localhost:$PORT_HOSTED/group-image:latest
echo -e "${GREEN}Docker Group Write Test Passed${NC}"

# 10. Group Write (Preferred)
echo "Testing Group Write (Preferred)..."
# Create second hosted repo
CREATE_HOSTED_2_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-hosted-2\",\"type\":\"hosted\",\"manager\":\"docker\",\"config\":{\"docker\":{\"port\":$PORT_HOSTED_2}}}")
HOSTED_ID_2=$(echo "$CREATE_HOSTED_2_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

wait_for_registry "$PORT_HOSTED_2"
echo "Logging in to localhost:$PORT_HOSTED_2..."
echo "$ADMIN_PASS" | docker login localhost:$PORT_HOSTED_2 -u "$ADMIN_USER" --password-stdin

# Update group to preferred
curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\",\"docker\":{\"port\":$PORT_GROUP}}}" > /dev/null

sleep 2

echo "Pushing to Group (Preferred)..."
docker tag localhost:$PORT_PROXY/library/alpine:latest localhost:$PORT_GROUP/pref-image:latest
docker push localhost:$PORT_GROUP/pref-image:latest

# Verify in hosted-2 (5006)
echo "Verifying push to hosted-2..."
docker pull localhost:$PORT_HOSTED_2/pref-image:latest
echo -e "${GREEN}Docker Group Write (Preferred) Test Passed${NC}"

# 11. Group Write (Mirror)
echo "Testing Group Write (Mirror)..."
# Update group to mirror
curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\",\"docker\":{\"port\":$PORT_GROUP}}}" > /dev/null

sleep 2

echo "Pushing to Group (Mirror)..."
docker tag localhost:$PORT_PROXY/library/alpine:latest localhost:$PORT_GROUP/mirror-image:latest
docker push localhost:$PORT_GROUP/mirror-image:latest

# Verify in BOTH
echo "Verifying push to hosted ($PORT_HOSTED)..."
docker pull localhost:$PORT_HOSTED/mirror-image:latest
echo "Verifying push to hosted-2 ($PORT_HOSTED_2)..."
docker pull localhost:$PORT_HOSTED_2/mirror-image:latest
echo -e "${GREEN}Docker Group Write (Mirror) Test Passed${NC}"

echo -e "${GREEN}All Docker Tests Passed${NC}"
