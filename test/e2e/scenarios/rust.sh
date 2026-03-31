#!/bin/bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="$API_URL/repository"
TEMP_DIR="/tmp/e2e-rust"
ARTIFACT_DIR="$TEMP_DIR/artifacts"
DOWNLOAD_DIR="$TEMP_DIR/downloads"
ADMIN_USER="e2e-admin-rust"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""
LIMITED_USER="e2e-limited-rust"
LIMITED_PASS="password123"
LIMITED_TOKEN=""
LIMITED_USER_ID=""
AUTH_HELPER_USER="rust-auth-user"
AUTH_HELPER_PASS="authpass123"

mkdir -p "$ARTIFACT_DIR" "$DOWNLOAD_DIR"

API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

echo "Starting Rust (Cargo) E2E Test..."

run_sql() {
    docker exec "$POSTGRES_CONTAINER" psql -U postgres -d ravhub -c "$1" > /dev/null
}

repo_id_by_name() {
    local repo_name="$1"
    curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$repo_name\"" | cut -d'"' -f4
}

ensure_user_with_admin_role() {
    local username="$1"
    local password="$2"
    local hashed_pass
    hashed_pass=$(docker exec -w /workspace/apps/api "$API_CONTAINER" node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$password', 10));")

    run_sql "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$username', '$hashed_pass')
ON CONFLICT (username) DO NOTHING;

INSERT INTO roles (id, name, description)
VALUES (gen_random_uuid(), 'admin', 'Administrator')
ON CONFLICT (name) DO NOTHING;

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
WHERE u.username = '$username' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
"
}

cleanup() {
    echo "Cleaning up..."
    rm -rf "$TEMP_DIR"

    for repo in rust-proxy rust-hosted rust-hosted-2 rust-group rust-group-pref rust-group-mirror rust-group-read rust-hosted-auth rust-proxy-auth; do
        if [ -n "$AUTH_TOKEN" ]; then
            local repo_id
            repo_id=$(repo_id_by_name "$repo")
            if [ -n "$repo_id" ]; then
                curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$repo_id" > /dev/null
            fi
        fi
    done

    if [ -n "$USER_ID" ] && [ -n "$AUTH_TOKEN" ]; then
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$USER_ID" > /dev/null
    fi
    if [ -n "$LIMITED_USER_ID" ] && [ -n "$AUTH_TOKEN" ]; then curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$LIMITED_USER_ID" > /dev/null; fi
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

setup_auth() {
    ensure_user_with_admin_role "$ADMIN_USER" "$ADMIN_PASS"

    local login_response
    login_response=$(curl -s -X POST "$API_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

    AUTH_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    USER_ID=$(echo "$login_response" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)
    hashed_pass=$(docker exec -w /workspace/apps/api "$API_CONTAINER" node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$LIMITED_PASS', 10));")
    run_sql "INSERT INTO users (id, username, passwordhash) VALUES (gen_random_uuid(), '$LIMITED_USER', '$hashed_pass') ON CONFLICT (username) DO NOTHING;"
    login_response=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"$LIMITED_USER\",\"password\":\"$LIMITED_PASS\"}")
    LIMITED_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    LIMITED_USER_ID=$(echo "$login_response" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)

    if [ -z "$AUTH_TOKEN" ]; then
        echo -e "${RED}Authentication failed${NC}"
        echo "$login_response"
        exit 1
    fi
    [ -n "$LIMITED_TOKEN" ] || { echo -e "${RED}Limited authentication failed${NC}"; exit 1; }
}

create_repo() {
    local data="$1"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "$data")

    if [ "$http_code" -ne 201 ] && [ "$http_code" -ne 200 ]; then
        echo -e "${RED}Repository creation failed with HTTP $http_code${NC}"
        exit 1
    fi
}

create_real_crate() {
    local crate_name="$1"
    local version="$2"
    local output_path="$3"

    python3 - "$crate_name" "$version" "$output_path" <<'PY'
import io
import sys
import tarfile

crate_name, version, output_path = sys.argv[1:4]
root = f"{crate_name}-{version}"
cargo_toml = f'''[package]
name = "{crate_name}"
version = "{version}"
edition = "2021"

[lib]
path = "src/lib.rs"
'''
lib_rs = f'''pub fn crate_version() -> &'static str {{
    "{version}"
}}
'''
readme = f"# {crate_name}\n\nVersion {version}\n"

with tarfile.open(output_path, 'w:gz') as archive:
    entries = {
        f"{root}/Cargo.toml": cargo_toml.encode(),
        f"{root}/README.md": readme.encode(),
        f"{root}/src/lib.rs": lib_rs.encode(),
    }
    for name, content in entries.items():
        info = tarfile.TarInfo(name)
        info.size = len(content)
        archive.addfile(info, io.BytesIO(content))
PY
}

verify_real_crate() {
    local crate_path="$1"
    local expected_name="$2"
    local expected_version="$3"

    python3 - "$crate_path" "$expected_name" "$expected_version" <<'PY'
import re
import sys
import tarfile

crate_path, expected_name, expected_version = sys.argv[1:4]

with tarfile.open(crate_path, 'r:gz') as archive:
    members = archive.getnames()
    cargo_member = next((name for name in members if name.endswith('/Cargo.toml')), None)
    lib_member = next((name for name in members if name.endswith('/src/lib.rs')), None)
    if not cargo_member or not lib_member:
        raise SystemExit(1)
    cargo_toml = archive.extractfile(cargo_member).read().decode()
    lib_rs = archive.extractfile(lib_member).read().decode()
    name_match = re.search(r'^name\s*=\s*"([^"]+)"', cargo_toml, re.MULTILINE)
    version_match = re.search(r'^version\s*=\s*"([^"]+)"', cargo_toml, re.MULTILINE)
    if not name_match or not version_match:
        raise SystemExit(1)
    if name_match.group(1) != expected_name or version_match.group(1) != expected_version:
        raise SystemExit(1)
    if expected_version not in lib_rs:
        raise SystemExit(1)
PY
}

upload_real_crate() {
    local repo_name="$1"
    local crate_name="$2"
    local version="$3"
    local crate_path="$ARTIFACT_DIR/${crate_name}-${version}.crate"
    local encoded_content

    create_real_crate "$crate_name" "$version" "$crate_path"
    encoded_content=$(base64 -w 0 "$crate_path")

    curl -s -X POST "$REPOS_URL/$repo_name/upload" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "{\"name\":\"$crate_name\",\"version\":\"$version\",\"content\":\"$encoded_content\",\"encoding\":\"base64\"}" > /dev/null
}

upload_real_crate_status() {
    local repo_name="$1" crate_name="$2" version="$3" token="$4" crate_path="$ARTIFACT_DIR/${crate_name}-${version}.crate" encoded_content
    create_real_crate "$crate_name" "$version" "$crate_path"; encoded_content=$(base64 -w 0 "$crate_path")
    if [ -n "$token" ]; then curl -s -o /dev/null -w "%{http_code}" -X POST "$REPOS_URL/$repo_name/upload" -H "Content-Type: application/json" -H "Authorization: Bearer $token" -d "{\"name\":\"$crate_name\",\"version\":\"$version\",\"content\":\"$encoded_content\",\"encoding\":\"base64\"}"; return; fi
    curl -s -o /dev/null -w "%{http_code}" -X POST "$REPOS_URL/$repo_name/upload" -H "Content-Type: application/json" -d "{\"name\":\"$crate_name\",\"version\":\"$version\",\"content\":\"$encoded_content\",\"encoding\":\"base64\"}"
}

download_and_verify_crate() {
    local repo_name="$1"
    local crate_name="$2"
    local version="$3"
    local output_path="$DOWNLOAD_DIR/${repo_name}-${crate_name}-${version}.crate"

    curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/$repo_name/$crate_name/$version" -o "$output_path"
    verify_real_crate "$output_path" "$crate_name" "$version"
}

setup_auth

echo "Creating Rust hosted repository..."
create_repo '{"name":"rust-hosted","type":"hosted","manager":"rust"}'
upload_real_crate "rust-hosted" "my-crate" "0.1.0"
download_and_verify_crate "rust-hosted" "my-crate" "0.1.0"
echo -e "${GREEN}Rust Hosted Test Passed${NC}"
LIMITED_UPLOAD_CODE=$(upload_real_crate_status "rust-hosted" "limited-crate" "1.0.0" "$LIMITED_TOKEN")
ANON_UPLOAD_CODE=$(upload_real_crate_status "rust-hosted" "anon-crate" "1.0.0" "")
[ "$LIMITED_UPLOAD_CODE" = "403" ] && [ "$ANON_UPLOAD_CODE" = "401" ] || { echo -e "${RED}Rust Permission Test Failed (limited=$LIMITED_UPLOAD_CODE anon=$ANON_UPLOAD_CODE)${NC}"; exit 1; }
echo -e "${GREEN}Rust Permission Test Passed${NC}"

echo "Testing Rust proxy download..."
create_repo '{"name":"rust-proxy","type":"proxy","manager":"rust","config":{"url":"http://localhost:3000/repository/rust-hosted","cacheMaxAgeDays":7}}'
download_and_verify_crate "rust-proxy" "my-crate" "0.1.0"
echo -e "${GREEN}Rust Proxy Test Passed${NC}"

RUST_PROXY_ID=$(repo_id_by_name "rust-proxy")
curl -s -X PUT "$API_URL/repositories/$RUST_PROXY_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d '{"config":{"url":"http://localhost:9/unavailable","cacheMaxAgeDays":7}}' > /dev/null
download_and_verify_crate "rust-proxy" "my-crate" "0.1.0"
echo -e "${GREEN}Rust Proxy Cache Test Passed${NC}"

echo "Testing Rust group download..."
create_repo '{"name":"rust-group-read","type":"group","manager":"rust","config":{"members":["rust-proxy"]}}'
download_and_verify_crate "rust-group-read" "my-crate" "0.1.0"
echo -e "${GREEN}Rust Group Download Passed${NC}"

echo "Testing Rust proxy auth..."
create_repo '{"name":"rust-hosted-auth","type":"hosted","manager":"rust"}'
upload_real_crate "rust-hosted-auth" "auth-crate" "0.1.0"
ensure_user_with_admin_role "$AUTH_HELPER_USER" "$AUTH_HELPER_PASS"
create_repo "{\"name\":\"rust-proxy-auth\",\"type\":\"proxy\",\"manager\":\"rust\",\"config\":{\"url\":\"http://localhost:3000/repository/rust-hosted-auth\",\"auth\":{\"username\":\"$AUTH_HELPER_USER\",\"password\":\"$AUTH_HELPER_PASS\"},\"cacheMaxAgeDays\":7}}"
download_and_verify_crate "rust-proxy-auth" "auth-crate" "0.1.0"
echo -e "${GREEN}Rust Proxy Auth Test Passed${NC}"

echo "Testing Rust group write policies..."
create_repo '{"name":"rust-hosted-2","type":"hosted","manager":"rust"}'
HOSTED_ID=$(repo_id_by_name "rust-hosted")
HOSTED_ID_2=$(repo_id_by_name "rust-hosted-2")

create_repo "{\"name\":\"rust-group\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"first\"}}"
upload_real_crate "rust-group" "crate-first" "0.1.0"
download_and_verify_crate "rust-hosted" "crate-first" "0.1.0"
echo -e "${GREEN}Rust Group Write 'first' Passed${NC}"

create_repo "{\"name\":\"rust-group-pref\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}}"
upload_real_crate "rust-group-pref" "crate-pref" "0.1.0"
download_and_verify_crate "rust-hosted-2" "crate-pref" "0.1.0"
echo -e "${GREEN}Rust Group Write 'preferred' Passed${NC}"

create_repo "{\"name\":\"rust-group-mirror\",\"type\":\"group\",\"manager\":\"rust\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}}"
upload_real_crate "rust-group-mirror" "crate-mirror" "0.1.0"
download_and_verify_crate "rust-hosted" "crate-mirror" "0.1.0"
download_and_verify_crate "rust-hosted-2" "crate-mirror" "0.1.0"
echo -e "${GREEN}Rust Group Write 'mirror' Passed${NC}"

echo -e "${GREEN}All Rust Tests Passed${NC}"
