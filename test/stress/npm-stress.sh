#!/bin/bash
set -e

# Configuration
API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
REPO_NAME="npm-stress-repo"
ADMIN_USER="stress-admin"
ADMIN_PASS="stressPass123"
CONCURRENCY=${1:-5}  # Default 5 concurrent users
ITERATIONS=${2:-10}  # Default 10 iterations per user
TOTAL_REQUESTS=$((CONCURRENCY * ITERATIONS))

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Starting NPM Stress Test with $CONCURRENCY threads, $ITERATIONS iterations each (Total: $TOTAL_REQUESTS packages)"

# --- Setup Helper Functions ---

setup_env() {
    # Detect containers
    POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1)
    
    if [ -z "$POSTGRES_CONTAINER" ]; then
        echo "Postgres container not found!"
        exit 1
    fi

    echo "Using Postgres container: $POSTGRES_CONTAINER"

    # Create admin user
    HASHED_PASS='$2a$10$8K1p/a0dL1.Pj.M/Wj.M/Wj.M/Wj.M/Wj.M/Wj.M/Wj.M/Wj.M' # Dummy hash for now or generate properly?
    # Actually let's use the one from npm.sh method to be safe
    API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1)
    HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

    docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
    INSERT INTO users (id, username, passwordhash)
    VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
    ON CONFLICT (username) DO NOTHING;
    " > /dev/null

    docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
    INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), 'admin', 'Administrator') ON CONFLICT (name) DO NOTHING;
    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM users u, roles r
    WHERE u.username = '$ADMIN_USER' AND r.name = 'admin'
    ON CONFLICT DO NOTHING;
    " > /dev/null

    # Login
    LOGIN_RES=$(curl -s -X POST "$API_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
    
    AUTH_TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$AUTH_TOKEN" ]; then
        echo "Login failed"
        exit 1
    fi

    AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"

    # Create hosted repo
    curl -s -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "$AUTH_HEADER" \
      -d "{
        \"name\": \"$REPO_NAME\",
        \"type\": \"hosted\",
        \"manager\": \"npm\",
        \"config\": {}
      }" > /dev/null
}

# --- Workload Function ---

run_worker() {
    local worker_id=$1
    local iterations=$2
    local success_count=0
    local fail_count=0
    local start_time=$(date +%s%3N)

    for ((i=1; i<=iterations; i++)); do
        local pkg_name="stress-pkg-${worker_id}-${i}"
        local version="1.0.0"
        
        # Prepare package
        local tmp_dir="/tmp/stress/w${worker_id}-i${i}"
        mkdir -p "$tmp_dir/$pkg_name"
        echo "content" > "$tmp_dir/$pkg_name/index.js"
        echo "{\"name\": \"$pkg_name\", \"version\": \"$version\"}" > "$tmp_dir/$pkg_name/package.json"
        tar -czf "$tmp_dir/pkg.tgz" -C "$tmp_dir/$pkg_name" .
        
        local tgz_base64=$(base64 -w 0 "$tmp_dir/pkg.tgz")
        
        # Publish
        cat <<JSON > "$tmp_dir/meta.json"
{
  "_id": "$pkg_name",
  "name": "$pkg_name",
  "dist-tags": { "latest": "$version" },
  "versions": {
    "$version": {
      "name": "$pkg_name",
      "version": "$version",
      "dist": {
        "tarball": "$REPOS_URL/$REPO_NAME/$pkg_name/-/$pkg_name-$version.tgz",
        "shasum": "dummy"
      }
    }
  },
  "_attachments": {
    "$pkg_name-$version.tgz": {
      "content_type": "application/octet-stream",
      "data": "$tgz_base64"
    }
  }
}
JSON
        
        HTTP_CODE=$(curl -s -w "%{http_code}" -X PUT "$REPOS_URL/$REPO_NAME/$pkg_name" \
            -H "Content-Type: application/json" \
            -H "$AUTH_HEADER" \
            -d @"$tmp_dir/meta.json" -o /dev/null)
            
        if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "201" ]; then
            # Verify Read
            READ_CODE=$(curl -s -w "%{http_code}" "$REPOS_URL/$REPO_NAME/$pkg_name" -H "$AUTH_HEADER" -o /dev/null)
            if [ "$READ_CODE" == "200" ]; then
                success_count=$((success_count + 1))
            else
                fail_count=$((fail_count + 1))
                echo -e "${RED}[W$worker_id] Read failed for $pkg_name ($READ_CODE)${NC}"
            fi
        else
            fail_count=$((fail_count + 1))
            echo -e "${RED}[W$worker_id] Publish failed for $pkg_name ($HTTP_CODE)${NC}"
        fi
        
        rm -rf "$tmp_dir"
    done

    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))
    echo "$worker_id $success_count $fail_count $duration" > "/tmp/stress/result-$worker_id.txt"
}

# --- Main Execution ---

rm -rf /tmp/stress
mkdir -p /tmp/stress

echo "Setting up environment..."
setup_env

echo "Launching $CONCURRENCY workers..."
START_GLOBAL=$(date +%s%3N)

pids=""
for ((k=1; k<=CONCURRENCY; k++)); do
    run_worker $k $ITERATIONS &
    pids="$pids $!"
done

echo "Waiting for workers..."
wait $pids

END_GLOBAL=$(date +%s%3N)
TOTAL_DURATION=$((END_GLOBAL - START_GLOBAL))

# --- Report ---

total_success=0
total_fail=0
max_duration=0

echo ""
echo "--- Load Test Results ---"
for ((k=1; k<=CONCURRENCY; k++)); do
    read w s f d < "/tmp/stress/result-$k.txt"
    total_success=$((total_success + s))
    total_fail=$((total_fail + f))
    echo "Worker $w: Success=$s, Fail=$f, Time=${d}ms"
done

echo "-------------------------"
echo "Total Requests: $TOTAL_REQUESTS"
echo "Successful:     $total_success"
echo "Failed:         $total_fail"
echo "Total Time:     ${TOTAL_DURATION}ms"
if [ $TOTAL_DURATION -gt 0 ]; then
    throughput=$(echo "scale=2; $total_success * 1000 / $TOTAL_DURATION" | bc)
    echo "Throughput:     $throughput pkgs/sec"
else
    echo "Throughput:     N/A"
fi
echo "-------------------------"

if [ $total_fail -eq 0 ]; then
    echo -e "${GREEN}PASSED${NC}"
    exit 0
else
    echo -e "${RED}FAILED${NC}"
    exit 1
fi
