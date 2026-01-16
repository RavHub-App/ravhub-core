#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:3000"
REPOS_URL="http://localhost:3000/repository"
TEMP_DIR="/tmp/e2e-helm"
mkdir -p $TEMP_DIR

HELM_STATE_DIR="$TEMP_DIR/helm-state"
export HELM_CACHE_HOME="$HELM_STATE_DIR/cache"
export HELM_CONFIG_HOME="$HELM_STATE_DIR/config"
export HELM_DATA_HOME="$HELM_STATE_DIR/data"
mkdir -p "$HELM_CACHE_HOME" "$HELM_CONFIG_HOME" "$HELM_DATA_HOME"

# Auth variables
ADMIN_USER="e2e-admin-helm"
ADMIN_PASS="password123"
AUTH_TOKEN=""
USER_ID=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-app|distributed-chat-api|api' | head -n1 || echo "distributed-chat-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'distributed-chat-postgres|postgres' | head -n1 || echo "distributed-chat-postgres-1")

RUN_ID="e2e-helm-$(date +%s)-$$"

REPO_IDS=()
HELM_REPOS=()

HOSTED_ID=""
PROXY_ID=""
PROXY_AUTH_ID=""
GROUP_ID=""

UP_USER="up-user"
UP_PASS="up-pass"
UPSTREAM_PORT="18090"

ensure_helm() {
  if command -v helm >/dev/null 2>&1; then
    HELM_BIN="helm"
    return 0
  fi

  echo "helm no encontrado; descargando helm local para el test..."

  local helm_version="v3.16.3"
  local os="linux"
  local arch

  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Arquitectura no soportada para descarga automática: $(uname -m)"
      echo "Instala helm manualmente o añade 'helm' al PATH."
      exit 127
      ;;
  esac

  local tools_dir
  tools_dir="$(cd "$(dirname "$0")/.." && pwd)/.tools"
  local helm_dir="$tools_dir/helm/${helm_version}-${os}-${arch}"
  local helm_path="$helm_dir/helm"

  if [[ -x "$helm_path" ]]; then
    HELM_BIN="$helm_path"
    return 0
  fi

  mkdir -p "$helm_dir"
  local url="https://get.helm.sh/helm-${helm_version}-${os}-${arch}.tar.gz"
  local tgz="$helm_dir/helm.tgz"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tgz"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tgz" "$url"
  else
    echo "Ni curl ni wget están disponibles para descargar helm."
    echo "Instala helm manualmente o añade 'helm' al PATH."
    exit 127
  fi

  tar -xzf "$tgz" -C "$helm_dir"
  mv "$helm_dir/${os}-${arch}/helm" "$helm_path"
  chmod +x "$helm_path"
  rm -rf "$tgz" "$helm_dir/${os}-${arch}"

  HELM_BIN="$helm_path"
}

echo "Starting Helm E2E Test..."

ensure_helm

cleanup() {
  echo "Cleaning up..."

  if [ ! -z "$AUTH_TOKEN" ]; then
    for id in "${REPO_IDS[@]}"; do
      if [ ! -z "$id" ]; then
        echo "Deleting repo ($id)..."
        curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/repositories/$id" > /dev/null || true
      fi
    done
  fi

  if [ ! -z "$USER_ID" ] && [ ! -z "$AUTH_TOKEN" ]; then
    echo "Deleting test user $ADMIN_USER ($USER_ID)..."
    curl -s -X DELETE -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/users/$USER_ID" > /dev/null || true
  fi

  rm -rf $TEMP_DIR || true
  for rname in "${HELM_REPOS[@]}"; do
    "$HELM_BIN" repo remove "$rname" >/dev/null 2>&1 || true
  done
}
if [ "$SKIP_CLEANUP" != "1" ]; then trap cleanup EXIT; fi

create_repo() {
  local name="$1"
  local type="$2"
  local manager="$3"
  local config_json="$4"

  local body
  body=$(curl -sS -X POST "$API_URL/repositories" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"type\":\"$type\",\"manager\":\"$manager\",\"config\":$config_json}")

  local id
  id=$(echo "$body" | grep -o '"id":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  if [ -z "$id" ]; then
    echo -e "${RED}Failed to create repo $name: $body${NC}" >&2
    return 1
  fi
  echo "$id"
}

upload_chart() {
  local repo_id="$1"
  local tgz="$2"
  local chart_name="$3"
  local chart_version="$4"
  local filename
  filename=$(basename "$tgz")
  local content
  content=$(base64 -w0 "$tgz")

  local res
  res=$(curl -sS -X POST "$REPOS_URL/$repo_id/upload" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$chart_name\",\"version\":\"$chart_version\",\"filename\":\"$filename\",\"content\":\"$content\"}")

  if echo "$res" | grep -q '"ok":true'; then
    echo "✓ Uploaded $filename to $repo_id"
  else
    echo -e "${RED}Upload failed: $res${NC}"
    exit 1
  fi
}

helm_add_and_update() {
  local repo_name="$1"
  local repo_url="$2"
  shift 2
  HELM_REPOS+=("$repo_name")
  "$HELM_BIN" repo add "$repo_name" "$repo_url" "$@"
  "$HELM_BIN" repo update
}

# 0. Setup Auth (reuse the same technique as docker.sh)
echo "Setting up authentication..."

echo "Generating password hash..."
HASHED_PASS=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

echo "Inserting admin user into DB..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$ADMIN_USER', '$HASHED_PASS')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

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
" > /dev/null

echo "Assigning admin role..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
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
  echo -e "${RED}Failed to authenticate: $LOGIN_RES${NC}"
  exit 1
fi

echo "Creating Helm Proxy repository (Bitnami)..."
PROXY_ID=$(create_repo "$RUN_ID-proxy" "proxy" "helm" '{"proxyUrl":"https://charts.bitnami.com/bitnami","cacheMaxAgeDays":7}')
REPO_IDS+=("$PROXY_ID")

echo "[Proxy] Adding helm repo..."
helm_add_and_update "my-proxy" "$REPOS_URL/$PROXY_ID/"

echo "[Proxy] Fetching chart (nginx)..."
cd $TEMP_DIR
"$HELM_BIN" fetch my-proxy/nginx --destination "$TEMP_DIR"
if ls "$TEMP_DIR"/nginx-*.tgz 1> /dev/null 2>&1; then
  echo -e "${GREEN}Helm Proxy Test Passed${NC}"
else
  echo -e "${RED}Helm Proxy Test Failed${NC}"
  exit 1
fi

echo "Creating Helm Hosted repository..."
HOSTED_ID=$(create_repo "$RUN_ID-hosted" "hosted" "helm" '{}')
REPO_IDS+=("$HOSTED_ID")

echo "Creating Helm Group repository (members: hosted, writePolicy:first)..."
GROUP_ID=$(create_repo "$RUN_ID-group" "group" "helm" "{\"members\":[\"$HOSTED_ID\"],\"writePolicy\":\"first\"}")
REPO_IDS+=("$GROUP_ID")

echo "Building a test chart..."
CHART_DIR="$TEMP_DIR/chart"
PKG_DIR="$TEMP_DIR/pkg"
mkdir -p "$CHART_DIR" "$PKG_DIR"
rm -rf "$CHART_DIR/e2e-chart" "$PKG_DIR"/*.tgz || true

"$HELM_BIN" create "$CHART_DIR/e2e-chart" >/dev/null
sed -i 's/^name: .*/name: e2e-chart/' "$CHART_DIR/e2e-chart/Chart.yaml"
sed -i 's/^version: .*/version: 0.1.0/' "$CHART_DIR/e2e-chart/Chart.yaml"

"$HELM_BIN" package "$CHART_DIR/e2e-chart" -d "$PKG_DIR" >/dev/null
CHART_TGZ="$PKG_DIR/e2e-chart-0.1.0.tgz"
if [ ! -f "$CHART_TGZ" ]; then
  echo -e "${RED}Chart package not found: $CHART_TGZ${NC}"
  exit 1
fi

echo "[Hosted] Uploading chart to hosted..."
upload_chart "$HOSTED_ID" "$CHART_TGZ" "e2e-chart" "0.1.0"

echo "[Hosted] Fetching chart via hosted repo..."
helm_add_and_update "hosted" "$REPOS_URL/$HOSTED_ID/"
rm -f "$TEMP_DIR"/e2e-chart-0.1.0.tgz || true
"$HELM_BIN" fetch hosted/e2e-chart --version 0.1.0 --destination "$TEMP_DIR"
if [ -f "$TEMP_DIR/e2e-chart-0.1.0.tgz" ]; then
  echo -e "${GREEN}Helm Hosted Read Test Passed${NC}"
else
  echo -e "${RED}Helm Hosted Read Test Failed${NC}"
  exit 1
fi

# Group Write Tests
echo "[GroupWrite] Testing 'first' policy..."
# Create a new version for group upload
sed -i 's/^version: .*/version: 0.1.1/' "$CHART_DIR/e2e-chart/Chart.yaml"
"$HELM_BIN" package "$CHART_DIR/e2e-chart" -d "$PKG_DIR" >/dev/null
CHART_TGZ_1="$PKG_DIR/e2e-chart-0.1.1.tgz"

upload_chart "$GROUP_ID" "$CHART_TGZ_1" "e2e-chart" "0.1.1"

# Verify in hosted
helm_add_and_update "hosted" "$REPOS_URL/$HOSTED_ID/"
rm -f "$TEMP_DIR"/e2e-chart-0.1.1.tgz || true
"$HELM_BIN" fetch hosted/e2e-chart --version 0.1.1 --destination "$TEMP_DIR"
if [ -f "$TEMP_DIR/e2e-chart-0.1.1.tgz" ]; then
  echo -e "${GREEN}Helm Group Write 'first' Passed${NC}"
else
  echo -e "${RED}Helm Group Write 'first' Failed${NC}"
  exit 1
fi

echo "[GroupWrite] Testing 'preferred' policy..."
HOSTED_ID_2=$(create_repo "$RUN_ID-hosted-2" "hosted" "helm" '{}')
REPO_IDS+=("$HOSTED_ID_2")

GROUP_PREF_ID=$(create_repo "$RUN_ID-group-pref" "group" "helm" "{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"preferred\",\"preferredWriter\":\"$HOSTED_ID_2\"}")
REPO_IDS+=("$GROUP_PREF_ID")

sed -i 's/^version: .*/version: 0.1.2/' "$CHART_DIR/e2e-chart/Chart.yaml"
"$HELM_BIN" package "$CHART_DIR/e2e-chart" -d "$PKG_DIR" >/dev/null
CHART_TGZ_2="$PKG_DIR/e2e-chart-0.1.2.tgz"

upload_chart "$GROUP_PREF_ID" "$CHART_TGZ_2" "e2e-chart" "0.1.2"

# Verify in hosted-2
helm_add_and_update "hosted-2" "$REPOS_URL/$HOSTED_ID_2/"
rm -f "$TEMP_DIR"/e2e-chart-0.1.2.tgz || true
"$HELM_BIN" fetch hosted-2/e2e-chart --version 0.1.2 --destination "$TEMP_DIR"
if [ -f "$TEMP_DIR/e2e-chart-0.1.2.tgz" ]; then
  echo -e "${GREEN}Helm Group Write 'preferred' Passed${NC}"
else
  echo -e "${RED}Helm Group Write 'preferred' Failed${NC}"
  exit 1
fi

echo "[GroupWrite] Testing 'mirror' policy..."
GROUP_MIRROR_ID=$(create_repo "$RUN_ID-group-mirror" "group" "helm" "{\"members\":[\"$HOSTED_ID\",\"$HOSTED_ID_2\"],\"writePolicy\":\"mirror\"}")
REPO_IDS+=("$GROUP_MIRROR_ID")

sed -i 's/^version: .*/version: 0.1.3/' "$CHART_DIR/e2e-chart/Chart.yaml"
"$HELM_BIN" package "$CHART_DIR/e2e-chart" -d "$PKG_DIR" >/dev/null
CHART_TGZ_3="$PKG_DIR/e2e-chart-0.1.3.tgz"

upload_chart "$GROUP_MIRROR_ID" "$CHART_TGZ_3" "e2e-chart" "0.1.3"

# Verify in BOTH
helm_add_and_update "hosted" "$REPOS_URL/$HOSTED_ID/"
helm_add_and_update "hosted-2" "$REPOS_URL/$HOSTED_ID_2/"

rm -f "$TEMP_DIR"/e2e-chart-0.1.3.tgz || true
"$HELM_BIN" fetch hosted/e2e-chart --version 0.1.3 --destination "$TEMP_DIR"
FOUND_1=$?

rm -f "$TEMP_DIR"/e2e-chart-0.1.3.tgz || true
"$HELM_BIN" fetch hosted-2/e2e-chart --version 0.1.3 --destination "$TEMP_DIR"
FOUND_2=$?

if [ $FOUND_1 -eq 0 ] && [ $FOUND_2 -eq 0 ]; then
  echo -e "${GREEN}Helm Group Write 'mirror' Passed${NC}"
else
  echo -e "${RED}Helm Group Write 'mirror' Failed${NC}"
  exit 1
fi

echo "[ProxyAuth] Testing Proxy with Auth against own Hosted repository..."
# Create a test user for upstream authentication
TEST_UPSTREAM_USER="e2e-helm-upstream-user"
TEST_UPSTREAM_PASS="upstream-pass-123"

echo "Creating upstream user..."
UPSTREAM_HASH=$(docker exec -w /workspace/apps/api $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$TEST_UPSTREAM_PASS', 10));")
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO users (id, username, passwordhash)
VALUES (gen_random_uuid(), '$TEST_UPSTREAM_USER', '$UPSTREAM_HASH')
ON CONFLICT (username) DO NOTHING;
" > /dev/null

echo "Assigning permissions to upstream user..."
docker exec $POSTGRES_CONTAINER psql -U postgres -d ravhub -c "
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = '$TEST_UPSTREAM_USER' AND r.name = 'admin'
ON CONFLICT DO NOTHING;
" > /dev/null

echo "Creating Proxy repository with auth pointing to own Hosted..."
# Use our own hosted repository as the upstream, with authentication
PROXY_AUTH_ID=$(create_repo "$RUN_ID-proxy-auth" "proxy" "helm" "{\"proxyUrl\":\"http://localhost:3000/repository/$HOSTED_ID/\",\"auth\":{\"username\":\"$TEST_UPSTREAM_USER\",\"password\":\"$TEST_UPSTREAM_PASS\"}}")
REPO_IDS+=("$PROXY_AUTH_ID")

echo "[ProxyAuth] Fetching chart via authenticated proxy..."
helm_add_and_update "proxy-auth" "$REPOS_URL/$PROXY_AUTH_ID/"
rm -f "$TEMP_DIR"/e2e-chart-0.1.0.tgz || true
"$HELM_BIN" fetch proxy-auth/e2e-chart --version 0.1.0 --destination "$TEMP_DIR"
if [ -f "$TEMP_DIR/e2e-chart-0.1.0.tgz" ]; then
  echo -e "${GREEN}Helm Proxy Auth Test Passed${NC}"
else
  echo -e "${RED}Helm Proxy Auth Test Failed${NC}"
  exit 1
fi

echo "[Group] Fetching chart via group..."
helm_add_and_update "group" "$REPOS_URL/$GROUP_ID/"
rm -f "$TEMP_DIR"/e2e-chart-0.1.0.tgz || true
"$HELM_BIN" fetch group/e2e-chart --version 0.1.0 --destination "$TEMP_DIR"
if [ -f "$TEMP_DIR/e2e-chart-0.1.0.tgz" ]; then
  echo -e "${GREEN}Helm Group Read Test Passed${NC}"
else
  echo -e "${RED}Helm Group Read Test Failed${NC}"
  exit 1
fi

echo "[GroupWrite] Building chart v0.1.1 and uploading via group..."
sed -i 's/^version: .*/version: 0.1.1/' "$CHART_DIR/e2e-chart/Chart.yaml"
rm -f "$PKG_DIR"/e2e-chart-0.1.1.tgz || true
"$HELM_BIN" package "$CHART_DIR/e2e-chart" -d "$PKG_DIR" >/dev/null
CHART_TGZ_2="$PKG_DIR/e2e-chart-0.1.1.tgz"
if [ ! -f "$CHART_TGZ_2" ]; then
  echo -e "${RED}Chart package not found: $CHART_TGZ_2${NC}"
  exit 1
fi

upload_chart "$GROUP_ID" "$CHART_TGZ_2" "e2e-chart" "0.1.1"

echo "[GroupWrite] Fetching v0.1.1 via group..."
"$HELM_BIN" repo update
rm -f "$TEMP_DIR"/e2e-chart-0.1.1.tgz || true
"$HELM_BIN" fetch group/e2e-chart --version 0.1.1 --destination "$TEMP_DIR"
if [ -f "$TEMP_DIR/e2e-chart-0.1.1.tgz" ]; then
  echo -e "${GREEN}Helm Group Write Test Passed${NC}"
else
  echo -e "${RED}Helm Group Write Test Failed${NC}"
  exit 1
fi

echo -e "${GREEN}All Helm Tests Passed${NC}"
