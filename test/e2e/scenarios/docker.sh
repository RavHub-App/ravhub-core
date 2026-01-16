#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"

# Auth variables
ADMIN_USER="e2e-admin-docker"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""

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

echo "Authenticated as $ADMIN_USER (ID: $USER_ID)"

# Login to Docker registries moved to after repo creation


# 1. Create Docker Proxy Repository (Docker Hub)
echo "Creating Docker Proxy repository (Docker Hub)..."
CREATE_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"docker-proxy","type":"proxy","manager":"docker","config":{"proxyUrl":"https://registry-1.docker.io", "cacheMaxAgeDays":7, "docker":{"port":5001}}}')

if [[ $CREATE_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create proxy repository: $CREATE_RES${NC}"
    exit 1
fi
echo "Repository docker-proxy created."

# Wait for registry to start
sleep 5

echo "Logging in to localhost:5001..."
echo "$ADMIN_PASS" | docker login localhost:5001 -u "$ADMIN_USER" --password-stdin

# 2. Pull an image through the proxy
echo "Pulling alpine via proxy..."
docker pull localhost:5001/library/alpine:latest
echo -e "${GREEN}Docker Proxy (Hub) Test Passed${NC}"

# 2b. Create Docker Proxy Repository (registry.k8s.io)
echo "Creating Docker Proxy repository (registry.k8s.io)..."
CREATE_K8S_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"docker-proxy-k8s","type":"proxy","manager":"docker","config":{"proxyUrl":"https://registry.k8s.io", "cacheMaxAgeDays":7, "docker":{"port":5005}}}')

if [[ $CREATE_K8S_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create k8s proxy repository: $CREATE_K8S_RES${NC}"
    exit 1
fi
echo "Repository docker-proxy-k8s created."

sleep 5

echo "Logging in to localhost:5005..."
echo "$ADMIN_PASS" | docker login localhost:5005 -u "$ADMIN_USER" --password-stdin

echo "Pulling pause via k8s proxy..."
for i in {1..3}; do
    if docker pull localhost:5005/pause:3.10; then
        break
    fi
    echo "Pull failed, retrying ($i/3)..."
    sleep 3
done
# Check if it succeeded by inspecting
if ! docker image inspect localhost:5005/pause:3.10 >/dev/null 2>&1; then
    echo "Failed to pull pause image after retries"
    exit 1
fi
echo -e "${GREEN}Docker Proxy (registry.k8s.io) Test Passed${NC}"

# 3. Create Hosted Repository
echo "Creating Docker Hosted repository..."
CREATE_HOSTED_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"docker-hosted","type":"hosted","manager":"docker","config":{"docker":{"port":5002}}}')

if [[ $CREATE_HOSTED_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create hosted repository: $CREATE_HOSTED_RES${NC}"
    exit 1
fi
echo "Repository docker-hosted created."
HOSTED_ID=$(echo "$CREATE_HOSTED_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

sleep 5

echo "Logging in to localhost:5002..."
echo "$ADMIN_PASS" | docker login localhost:5002 -u "$ADMIN_USER" --password-stdin

# 4. Push to Hosted
echo "Pushing image to hosted repo..."
docker tag localhost:5001/library/alpine:latest localhost:5002/my-alpine:latest
docker push localhost:5002/my-alpine:latest
echo -e "${GREEN}Docker Hosted Push Test Passed${NC}"

# 5. Create Proxy to Hosted (Auth)
# We use the hosted repo as upstream. The proxy performs server-side pulls and must authenticate
# against the hosted registry to obtain an upstream Bearer token.
echo "Creating Docker Proxy to Hosted (Auth)..."
CREATE_PROXY_AUTH_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-proxy-auth\",\"type\":\"proxy\",\"manager\":\"docker\",\"config\":{\"proxyUrl\":\"http://localhost:5002\",\"requireAuth\":true,\"auth\":{\"type\":\"basic\",\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"},\"cacheMaxAgeDays\":7,\"docker\":{\"port\":5003}}}")

if [[ $CREATE_PROXY_AUTH_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create proxy auth repository: $CREATE_PROXY_AUTH_RES${NC}"
    exit 1
fi
echo "Repository docker-proxy-auth created."

sleep 5

echo "Logging in to localhost:5003..."
echo "$ADMIN_PASS" | docker login localhost:5003 -u "$ADMIN_USER" --password-stdin

# 6. Pull from Proxy Auth
echo "Pulling via Proxy Auth..."
docker pull localhost:5003/my-alpine:latest
echo -e "${GREEN}Docker Proxy Auth Test Passed${NC}"

# 7. Create Group Repository
echo "Creating Docker Group repository..."
CREATE_GROUP_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"docker-group\",\"type\":\"group\",\"manager\":\"docker\",\"config\":{\"members\":[\"$HOSTED_ID\"], \"docker\":{\"port\":5004}}}")

if [[ $CREATE_GROUP_RES != *"id"* ]]; then
    echo -e "${RED}Failed to create group repository: $CREATE_GROUP_RES${NC}"
    exit 1
fi
echo "Repository docker-group created."

sleep 5

echo "Logging in to localhost:5004..."
echo "$ADMIN_PASS" | docker login localhost:5004 -u "$ADMIN_USER" --password-stdin

# 8. Group Download
echo "Pulling via Group..."
docker pull localhost:5004/my-alpine:latest
echo -e "${GREEN}Docker Group Download Test Passed${NC}"

# 9. Group Write (First)
echo "Testing Group Write (First)..."
# Update group to writePolicy: first
GROUP_ID=$(echo "$CREATE_GROUP_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"members\":[\"$HOSTED_ID\"], \"writePolicy\":\"first\", \"docker\":{\"port\":5004}}}" > /dev/null

sleep 2

echo "Pushing to Group..."
docker tag localhost:5001/library/alpine:latest localhost:5004/group-image:latest
docker push localhost:5004/group-image:latest

# Verify it ended up in hosted (5002)
echo "Verifying push to hosted via group..."
docker pull localhost:5002/group-image:latest
echo -e "${GREEN}Docker Group Write Test Passed${NC}"

# 10. Group Write (Preferred)
echo "Testing Group Write (Preferred)..."
# Create second hosted repo
CREATE_HOSTED_2_RES=$(curl -s -X POST "$API_URL/repositories" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"name":"docker-hosted-2","type":"hosted","manager":"docker","config":{"docker":{"port":5006}}}')
HOSTED_ID_2=$(echo "$CREATE_HOSTED_2_RES" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

sleep 5
echo "Logging in to localhost:5006..."
echo "$ADMIN_PASS" | docker login localhost:5006 -u "$ADMIN_USER" --password-stdin

# Update group to preferred
curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"], \"writePolicy\":\"preferred\", \"preferredWriter\":\"$HOSTED_ID_2\", \"docker\":{\"port\":5004}}}" > /dev/null

sleep 2

echo "Pushing to Group (Preferred)..."
docker tag localhost:5001/library/alpine:latest localhost:5004/pref-image:latest
docker push localhost:5004/pref-image:latest

# Verify in hosted-2 (5006)
echo "Verifying push to hosted-2..."
docker pull localhost:5006/pref-image:latest
echo -e "${GREEN}Docker Group Write (Preferred) Test Passed${NC}"

# 11. Group Write (Mirror)
echo "Testing Group Write (Mirror)..."
# Update group to mirror
curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"], \"writePolicy\":\"mirror\", \"docker\":{\"port\":5004}}}" > /dev/null

sleep 2

echo "Pushing to Group (Mirror)..."
docker tag localhost:5001/library/alpine:latest localhost:5004/mirror-image:latest
docker push localhost:5004/mirror-image:latest

# Verify in BOTH
echo "Verifying push to hosted (5002)..."
docker pull localhost:5002/mirror-image:latest
echo "Verifying push to hosted-2 (5006)..."
docker pull localhost:5006/mirror-image:latest
echo -e "${GREEN}Docker Group Write (Mirror) Test Passed${NC}"

echo -e "${GREEN}All Docker Tests Passed${NC}"
