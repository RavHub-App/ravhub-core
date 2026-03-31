#!/bin/bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="$API_URL/repository"
TEMP_DIR="/tmp/e2e-composer"
PROJECT_DIR="$TEMP_DIR/project"
ARTIFACT_DIR="$TEMP_DIR/artifacts"
ADMIN_USER="e2e-admin-composer"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""
LIMITED_USER="e2e-limited-composer"
LIMITED_PASS="password123"
LIMITED_TOKEN=""
LIMITED_USER_ID=""

mkdir -p "$PROJECT_DIR" "$ARTIFACT_DIR"

API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

echo "Starting Composer (PHP) E2E Test..."

run_sql() {
    docker exec "$POSTGRES_CONTAINER" psql -U postgres -d ravhub -c "$1" > /dev/null
}

repo_id_by_name() {
    local repo_name="$1"
    curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories" | grep -o "\"id\":\"[^\"]*\",\"name\":\"$repo_name\"" | cut -d'"' -f4
}

cleanup() {
    echo "Cleaning up..."
    docker run --rm -v "$TEMP_DIR:/app" alpine sh -c "rm -rf /app/*" > /dev/null 2>&1 || true
    rm -rf "$TEMP_DIR"

    for repo in composer-proxy drupal-proxy composer-hosted composer-group composer-proxy-auth composer-hosted-2; do
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

    if [ -n "$LIMITED_USER_ID" ] && [ -n "$AUTH_TOKEN" ]; then
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$LIMITED_USER_ID" > /dev/null
    fi
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

setup_auth() {
    local hashed_pass
    hashed_pass=$(docker exec -w /workspace/apps/api "$API_CONTAINER" node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

    run_sql "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$hashed_pass')
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
WHERE u.username = '$ADMIN_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
"

    local login_response
    login_response=$(curl -s -X POST "$API_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

    AUTH_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    USER_ID=$(echo "$login_response" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)

    if [ -z "$AUTH_TOKEN" ]; then
        echo -e "${RED}Authentication failed${NC}"
        echo "$login_response"
        exit 1
    fi

    hashed_pass=$(docker exec -w /workspace/apps/api "$API_CONTAINER" node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$LIMITED_PASS', 10));")
    run_sql "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$LIMITED_USER', '$hashed_pass')
ON CONFLICT (username) DO NOTHING;
"

    login_response=$(curl -s -X POST "$API_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"$LIMITED_USER\",\"password\":\"$LIMITED_PASS\"}")

    LIMITED_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    LIMITED_USER_ID=$(echo "$login_response" | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)

    if [ -z "$LIMITED_TOKEN" ]; then
        echo -e "${RED}Limited user authentication failed${NC}"
        echo "$login_response"
        exit 1
    fi
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

reset_project_dir() {
    docker run --rm -v "$PROJECT_DIR:/app" alpine sh -c "rm -rf /app/*" > /dev/null 2>&1 || true
    mkdir -p "$PROJECT_DIR"
}

run_composer() {
    docker run --rm --network host -v "$PROJECT_DIR:/app" -w /app composer:latest "$@"
}

write_project_json() {
    local content="$1"
    printf '%s\n' "$content" > "$PROJECT_DIR/composer.json"
}

create_real_composer_archive() {
    local package_name="$1"
    local version="$2"
    local output_path="$3"

    python3 - "$package_name" "$version" "$output_path" <<'PY'
import json
import re
import sys
import zipfile

package_name, version, output_path = sys.argv[1:4]
_, package = package_name.split('/', 1)
class_name = ''.join(part.capitalize() for part in re.split(r'[^a-zA-Z0-9]+', package) if part) or 'Package'
composer_json = {
    'name': package_name,
    'version': version,
    'description': f'Test package {package_name}',
    'type': 'library',
    'autoload': {'psr-4': {f'{class_name}\\': 'src/'}},
}
php_source = f'''<?php
namespace {class_name};

final class {class_name}
{{
    public static function version(): string
    {{
        return '{version}';
    }}
}}
'''

with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('composer.json', json.dumps(composer_json, indent=2))
    archive.writestr(f'src/{class_name}.php', php_source)
PY
}

verify_real_composer_archive() {
    local archive_path="$1"
    local expected_name="$2"
    local expected_version="$3"

    python3 - "$archive_path" "$expected_name" "$expected_version" <<'PY'
import json
import sys
import zipfile

archive_path, expected_name, expected_version = sys.argv[1:4]

with zipfile.ZipFile(archive_path) as archive:
    names = archive.namelist()
    if 'composer.json' not in names or not any(name.startswith('src/') for name in names):
        raise SystemExit(1)
    composer_json = json.loads(archive.read('composer.json').decode())
    if composer_json.get('name') != expected_name or composer_json.get('version') != expected_version:
        raise SystemExit(1)
PY
}

upload_real_composer_package() {
    local repo_name="$1"
    local package_name="$2"
    local version="$3"
    local archive_name
    archive_name=$(echo "$package_name-$version" | tr '/' '-')
    local archive_path="$ARTIFACT_DIR/$archive_name.zip"
    local encoded_content

    create_real_composer_archive "$package_name" "$version" "$archive_path"
    encoded_content=$(base64 -w 0 "$archive_path")

    curl -s -X POST "$REPOS_URL/$repo_name/upload" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "{\"name\":\"$package_name\",\"version\":\"$version\",\"content\":\"$encoded_content\",\"encoding\":\"base64\"}" > /dev/null
}

download_and_verify_composer_archive() {
    local repo_name="$1"
    local package_name="$2"
    local version="$3"
    local archive_name
    archive_name=$(echo "$repo_name-$package_name-$version" | tr '/' '-')
    local output_path="$ARTIFACT_DIR/$archive_name.zip"

    curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" "$REPOS_URL/$repo_name/$package_name/$version" -o "$output_path"
    verify_real_composer_archive "$output_path" "$package_name" "$version"
}

setup_auth

create_repo '{"name":"composer-proxy","type":"proxy","manager":"composer","config":{"proxyUrl":"https://repo.packagist.org","cacheMaxAgeDays":7}}'
reset_project_dir
write_project_json "{\"name\":\"test/app\",\"repositories\":[{\"packagist\":false},{\"type\":\"composer\",\"url\":\"$REPOS_URL/composer-proxy\"}],\"require\":{\"monolog/monolog\":\"^3.0\"},\"config\":{\"secure-http\":false}}"
run_composer install --no-interaction --no-progress --prefer-dist
if [ ! -d "$PROJECT_DIR/vendor/monolog" ]; then
    echo -e "${RED}Composer Proxy (Packagist) Test Failed${NC}"
    exit 1
fi
echo -e "${GREEN}Composer Proxy (Packagist) Test Passed${NC}"

create_repo '{"name":"drupal-proxy","type":"proxy","manager":"composer","config":{"proxyUrl":"https://packages.drupal.org","cacheMaxAgeDays":7}}'
reset_project_dir
write_project_json "{\"name\":\"test/drupal-app\",\"repositories\":[{\"type\":\"composer\",\"url\":\"$REPOS_URL/drupal-proxy/8\"}],\"require\":{\"drupal/token\":\"*\"},\"config\":{\"secure-http\":false,\"allow-plugins\":{\"drupal/core-composer-scaffold\":true}}}"
run_composer install --no-interaction --no-progress --prefer-dist --ignore-platform-reqs || true
DRUPAL_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/drupal-proxy/files/packages/8/p2/drupal/token.json")
if [ ! -f "$PROJECT_DIR/composer.lock" ] && [ "$DRUPAL_HTTP_CODE" -ne 200 ] && [ "$DRUPAL_HTTP_CODE" -ne 302 ]; then
    echo -e "${RED}Composer Proxy (Drupal) Test Failed${NC}"
    exit 1
fi
echo -e "${GREEN}Composer Proxy (Drupal) Test Passed${NC}"

create_repo '{"name":"composer-hosted","type":"hosted","manager":"composer"}'
upload_real_composer_package "composer-hosted" "my/package" "1.0.0"
download_and_verify_composer_archive "composer-hosted" "my/package" "1.0.0"
LIMITED_UPLOAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REPOS_URL/composer-hosted/upload" -H "Content-Type: application/json" -H "Authorization: Bearer $LIMITED_TOKEN" -d '{"name":"blocked/package","version":"1.0.0","content":"Zm9v","encoding":"base64"}')
ANON_UPLOAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REPOS_URL/composer-hosted/upload" -H "Content-Type: application/json" -d '{"name":"blocked/package","version":"1.0.0","content":"Zm9v","encoding":"base64"}')
if [ "$LIMITED_UPLOAD_CODE" -lt 400 ] || [ "$ANON_UPLOAD_CODE" -lt 400 ]; then
    echo -e "${RED}Composer Permission Test Failed (limited=$LIMITED_UPLOAD_CODE anon=$ANON_UPLOAD_CODE)${NC}"
    exit 1
fi
echo -e "${GREEN}Composer Permission Test Passed${NC}"
reset_project_dir
write_project_json "{\"name\":\"test/hosted-app\",\"repositories\":[{\"packagist\":false},{\"type\":\"composer\",\"url\":\"$REPOS_URL/composer-hosted\"}],\"require\":{\"my/package\":\"1.0.0\"},\"config\":{\"secure-http\":false}}"
run_composer install --no-interaction --no-progress --prefer-dist
if [ ! -d "$PROJECT_DIR/vendor/my/package" ]; then
    echo -e "${RED}Hosted Repository Install Failed${NC}"
    exit 1
fi
echo -e "${GREEN}Hosted Repository Install Passed${NC}"

PROXY_ID=$(repo_id_by_name "composer-proxy")
HOSTED_ID=$(repo_id_by_name "composer-hosted")
create_repo "{\"name\":\"composer-group\",\"type\":\"group\",\"manager\":\"composer\",\"config\":{\"members\":[\"$PROXY_ID\",\"$HOSTED_ID\"],\"writePolicy\":\"mirror\"}}"
download_and_verify_composer_archive "composer-group" "my/package" "1.0.0"
echo -e "${GREEN}Group Repository Download Passed${NC}"

upload_real_composer_package "composer-group" "my/group-package" "1.0.0"
download_and_verify_composer_archive "composer-hosted" "my/group-package" "1.0.0"
echo -e "${GREEN}Group Repository Write Passed${NC}"

GROUP_ID=$(repo_id_by_name "composer-group")
create_repo '{"name":"composer-hosted-2","type":"hosted","manager":"composer"}'
HOSTED_ID_2=$(repo_id_by_name "composer-hosted-2")

curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"composer-group\",\"type\":\"group\",\"manager\":\"composer\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"first\"}}" > /dev/null
upload_real_composer_package "composer-group" "my/first-pkg" "1.0.0"
download_and_verify_composer_archive "composer-hosted" "my/first-pkg" "1.0.0"
echo -e "${GREEN}Group Write 'first' Passed${NC}"

curl -s -X PUT "$API_URL/repositories/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"composer-group\",\"type\":\"group\",\"manager\":\"composer\",\"config\":{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}}" > /dev/null
upload_real_composer_package "composer-group" "my/pref-pkg" "1.0.0"
download_and_verify_composer_archive "composer-hosted-2" "my/pref-pkg" "1.0.0"
echo -e "${GREEN}Group Write 'preferred' Passed${NC}"

create_repo '{"name":"composer-proxy-auth","type":"proxy","manager":"composer","config":{"proxyUrl":"http://localhost:3000/repository/composer-hosted","auth":{"type":"basic","username":"e2e-admin-composer","password":"password123"}}}'
download_and_verify_composer_archive "composer-proxy-auth" "my/package" "1.0.0"
echo -e "${GREEN}Composer Proxy Auth Test Passed${NC}"
PROXY_AUTH_ID=$(repo_id_by_name "composer-proxy-auth")
curl -s -X PUT "$API_URL/repositories/$PROXY_AUTH_ID" -H "Content-Type: application/json" -H "Authorization: Bearer $AUTH_TOKEN" -d '{"name":"composer-proxy-auth","type":"proxy","manager":"composer","config":{"proxyUrl":"http://localhost:9/repository/composer-hosted","auth":{"type":"basic","username":"e2e-admin-composer","password":"password123"}}}' > /dev/null
download_and_verify_composer_archive "composer-proxy-auth" "my/package" "1.0.0"
echo -e "${GREEN}Composer Proxy Cache Test Passed${NC}"

echo -e "${GREEN}All Composer Tests Passed${NC}"
