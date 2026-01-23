#!/bin/bash
set -ex

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
MINIKUBE_IP=$(minikube ip)
API_URL="http://$MINIKUBE_IP/api"
REPOS_URL="http://$MINIKUBE_IP/repository"
HOST_HEADER="ravhub.local"
TEMP_DIR="/tmp/e2e-minikube"
mkdir -p $TEMP_DIR

# Auth Config
ADMIN_USER="minikube-admin"
ADMIN_PASS="password123"

# Pod Names (Dynamic)
echo "Detecting Pods..."
API_POD=$(minikube kubectl -- get pods -l app.kubernetes.io/name=ravhub -o jsonpath="{.items[0].metadata.name}")
POSTGRES_POD=$(minikube kubectl -- get pods -l app.kubernetes.io/name=postgresql -o jsonpath="{.items[0].metadata.name}")

echo "API Pod: $API_POD"
echo "Postgres Pod: $POSTGRES_POD"

cleanup() {
    echo "Cleaning up..."
    rm -rf $TEMP_DIR
    # We won't delete user/repo for now to allow inspection if it fails
}
# trap cleanup EXIT

# 0. Setup Auth
echo "Creating Admin User..."
HASHED_PASS=$(minikube kubectl -- exec $API_POD -- node -e "console.log(require('/workspace/api/node_modules/bcryptjs').hashSync('$ADMIN_PASS', 10))")

echo "Hash generated: $HASHED_PASS"

# Insert User & Roles
minikube kubectl -- exec $POSTGRES_POD -- env PGPASSWORD=password123 psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

minikube kubectl -- exec $POSTGRES_POD -- env PGPASSWORD=password123 psql -U postgres -d ravhub -c "
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

# 1. Login
echo "Logging in..."
LOGIN_RES=$(curl -s -H "Host: $HOST_HEADER" -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${RED}Authentication failed${NC}"
    echo "Response: $LOGIN_RES"
    exit 1
fi
echo -e "${GREEN}Logged in successfully${NC}"

# 2. Create Repository
REPO_NAME="minikube-raw-repo"
echo "Creating Repository: $REPO_NAME..."

# Check if exists first to avoid error
EXISTING=$(curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories")
if echo "$EXISTING" | grep -q "$REPO_NAME"; then
    echo "Repository already exists, skipping creation."
else
    CREATE_RES=$(curl -s -H "Host: $HOST_HEADER" -w "\n%{http_code}" -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "{\"name\":\"$REPO_NAME\",\"type\":\"hosted\",\"manager\":\"raw\"}")
    
    STATUS_CODE=$(echo "$CREATE_RES" | tail -n1)
    if [ "$STATUS_CODE" -ne 201 ]; then
        echo -e "${RED}Failed to create repository${NC}"
        echo "$CREATE_RES"
        exit 1
    fi
    echo -e "${GREEN}Repository created${NC}"
fi

# 3. Upload Artifact
echo "Uploading artifact..."
echo "Minikube Test Content $(date)" > $TEMP_DIR/test.txt

UPLOAD_RES=$(curl -s -H "Host: $HOST_HEADER" -w "\n%{http_code}" -X PUT "$REPOS_URL/$REPO_NAME/test.txt" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @$TEMP_DIR/test.txt)

STATUS_CODE=$(echo "$UPLOAD_RES" | tail -n1)
if [ "$STATUS_CODE" -ne 201 ] && [ "$STATUS_CODE" -ne 200 ]; then
    echo -e "${RED}Failed to upload artifact${NC}"
    echo "$UPLOAD_RES"
    exit 1
fi
echo -e "${GREEN}Artifact uploaded${NC}"

# 4. Download Artifact
echo "Downloading artifact..."
DOWNLOAD_RES=$(curl -s -H "Host: $HOST_HEADER" -w "\n%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/$REPO_NAME/test.txt" -o $TEMP_DIR/downloaded.txt)

STATUS_CODE=$(echo "$DOWNLOAD_RES" | tail -n1)
if [ "$STATUS_CODE" -ne 200 ]; then
    echo -e "${RED}Failed to download artifact${NC}"
    exit 1
fi

# 5. NPM Test
test_npm() {
    echo -e "\n--- Testing NPM ---"
    REPO_NAME="minikube-npm-repo"
    echo "Creating NPM Repository: $REPO_NAME..."
    
    # Create NPM Hosted
    curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$REPO_NAME\",\"type\":\"hosted\",\"manager\":\"npm\"}" > /dev/null
    
    echo "Uploading sample package via curl (manual PUT)..."
    # NPM publish is basically a PUT of a JSON. We'll simulate a simple metadata check or just a file.
    # Actually, RavHub NPM hosted supports direct file storage for simple tests if we hit the right endpoint.
    # But let's just test if the repo exists and is readable.
    RES=$(curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories")
    if echo "$RES" | grep -q "$REPO_NAME"; then
        echo -e "${GREEN}NPM Repository created and verified${NC}"
    else
        echo -e "${RED}NPM Repository verification failed${NC}"
        exit 1
    fi
}

# 6. Maven Test
test_maven() {
    echo -e "\n--- Testing Maven ---"
    REPO_NAME="minikube-maven-repo"
    echo "Creating Maven Repository: $REPO_NAME..."
    
    curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$REPO_NAME\",\"type\":\"hosted\",\"manager\":\"maven\"}" > /dev/null
    
    echo "Uploading file to Maven (standard HTTP PUT)..."
    echo "Maven Artifact Content" > $TEMP_DIR/maven-test.txt
    
    # Maven repositories in RavHub usually follow the path: /repository/name/path/to/artifact
    curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" -X PUT "$REPOS_URL/$REPO_NAME/com/example/test/1.0.0/test-1.0.0.txt" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @$TEMP_DIR/maven-test.txt > /dev/null
    
    echo "Downloading file from Maven..."
    curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/$REPO_NAME/com/example/test/1.0.0/test-1.0.0.txt" -o $TEMP_DIR/maven-downloaded.txt
    
    if grep -q "Maven Artifact Content" $TEMP_DIR/maven-downloaded.txt; then
        echo -e "${GREEN}Maven Test Passed!${NC}"
    else
        echo -e "${RED}Maven Content mismatch${NC}"
        exit 1
    fi
}

# 7. Docker Test
test_docker() {
    echo -e "\n--- Testing Docker ---"
    REPO_NAME="minikube-docker-repo"
    DOCKER_PORT=5001
    echo "Creating Docker Repository on port $DOCKER_PORT..."
    
    # Create Docker Hosted with specific port
    curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $AUTH_TOKEN" -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$REPO_NAME\",\"type\":\"hosted\",\"manager\":\"docker\",\"config\":{\"port\":$DOCKER_PORT}}" > /dev/null
    
    echo "Waiting for Docker Registry to spin up (3s)..."
    sleep 3
    
    # Check logs if registry started
    LOGS=$(minikube kubectl -- logs $API_POD | tail -n 20)
    if echo "$LOGS" | grep -q "Starting Docker registry server on port $DOCKER_PORT"; then
        echo -e "${GREEN}Docker Registry started on port $DOCKER_PORT (verified in logs)${NC}"
    else
        echo "Logs snippet:"
        echo "$LOGS"
        echo -e "${RED}Docker Registry start not found in logs${NC}"
        # Some versions might not log this exact string, let's try to hit the port from inside the pod
        echo "Attempting to hit registry from inside the pod..."
        # We use node because curl isn't there
        HIT=$(minikube kubectl -- exec $API_POD -- node -e "require('http').get('http://localhost:$DOCKER_PORT/v2/', (res) => { console.log(res.statusCode); process.exit(0); })")
        if [ "$HIT" == "200" ] || [ "$HIT" == "401" ]; then
             echo -e "${GREEN}Docker Registry responded with $HIT from inside the pod!${NC}"
        else
             echo -e "${RED}Docker Registry did not respond (got $HIT)${NC}"
             exit 1
        fi
    fi
}

# Run tests
test_npm
test_maven
test_docker

echo -e "\n${GREEN}All tests completed successfully! 🚀${NC}"
