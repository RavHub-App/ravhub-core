#!/bin/bash
set -e

# Configuration
API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
REPO_NAME="maven-stress-repo"
ADMIN_USER="stress-admin"
ADMIN_PASS="stressPass123"
CONCURRENCY=${1:-5}
ITERATIONS=${2:-10}
TOTAL_REQUESTS=$((CONCURRENCY * ITERATIONS))

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Starting Maven Stress Test with $CONCURRENCY threads, $ITERATIONS iterations..."

# --- Setup (Same as NPM) ---
setup_env() {
    # Detect containers
    POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1)
    if [ -z "$POSTGRES_CONTAINER" ]; then echo "Postgres container not found!"; exit 1; fi
    API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1)
    
    # Create admin logic reused...
    HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")
    docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "INSERT INTO users (id, username, passwordhash) VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS') ON CONFLICT (username) DO NOTHING;" > /dev/null
    docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), 'admin', 'Administrator') ON CONFLICT (name) DO NOTHING; INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = '$ADMIN_USER' AND r.name = 'admin' ON CONFLICT DO NOTHING;" > /dev/null

    LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
    AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    if [ -z "$AUTH_TOKEN" ]; then echo "Login failed"; exit 1; fi
    AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"

    # Create repo
    curl -s -X POST "$API_URL/repositories" -H "Content-Type: application/json" -H "$AUTH_HEADER" -d "{
        \"name\": \"$REPO_NAME\", \"type\": \"hosted\", \"manager\": \"maven\", \"config\": {}
      }" > /dev/null
}

# --- Worker ---
run_worker() {
    local worker_id=$1
    local iterations=$2
    local success_count=0
    local fail_count=0
    local start_time=$(date +%s%3N)

    for ((i=1; i<=iterations; i++)); do
        local group_id="com.stress"
        local artifact_id="pkg-${worker_id}-${i}"
        local version="1.0.0"
        local jar_path="${group_id//.//}/$artifact_id/$version/$artifact_id-$version.jar"
        local pom_path="${group_id//.//}/$artifact_id/$version/$artifact_id-$version.pom"
        
        # Simula subida de JAR y POM
        # PUT JAR
        HTTP_CODE=$(curl -s -w "%{http_code}" -X PUT "$REPOS_URL/$REPO_NAME/$jar_path" \
            -H "$AUTH_HEADER" -H "Content-Type: application/octet-stream" -d "dummy-jar-content" -o /dev/null)
        
        # PUT POM
        curl -s -X PUT "$REPOS_URL/$REPO_NAME/$pom_path" \
            -H "$AUTH_HEADER" -d "<project><modelVersion>4.0.0</modelVersion><groupId>$group_id</groupId><artifactId>$artifact_id</artifactId><version>$version</version></project>" -o /dev/null

        if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "201" ]; then
             # Verify Read
             READ_CODE=$(curl -s -w "%{http_code}" "$REPOS_URL/$REPO_NAME/$jar_path" -H "$AUTH_HEADER" -o /dev/null)
             if [ "$READ_CODE" == "200" ]; then
                success_count=$((success_count + 1))
             else
                fail_count=$((fail_count + 1))
             fi
        else
            fail_count=$((fail_count + 1))
        fi
    done

    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))
    echo "$worker_id $success_count $fail_count $duration" > "/tmp/stress/maven-result-$worker_id.txt"
}

# --- Main ---
rm -rf /tmp/stress/maven
mkdir -p /tmp/stress

setup_env
echo "Launching workers..."
START_GLOBAL=$(date +%s%3N)
pids=""
for ((k=1; k<=CONCURRENCY; k++)); do
    run_worker $k $ITERATIONS &
    pids="$pids $!"
done
wait $pids
END_GLOBAL=$(date +%s%3N)
TOTAL_DURATION=$((END_GLOBAL - START_GLOBAL))

total_success=0
total_fail=0
for ((k=1; k<=CONCURRENCY; k++)); do
    if [ -f "/tmp/stress/maven-result-$k.txt" ]; then
        read w s f d < "/tmp/stress/maven-result-$k.txt"
        total_success=$((total_success + s))
        total_fail=$((total_fail + f))
    fi
done

echo "--- Maven Results ---"
echo "Requests: $total_success / $TOTAL_REQUESTS"
if [ $TOTAL_DURATION -gt 0 ]; then
    throughput=$(echo "scale=2; $total_success * 1000 / $TOTAL_DURATION" | bc)
    echo "Throughput: $throughput artifacts/sec"
fi
if [ $total_fail -eq 0 ]; then echo -e "${GREEN}PASSED${NC}"; else echo -e "${RED}FAILED${NC}"; exit 1; fi
