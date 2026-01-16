#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:5173/api"
REPOS_URL="http://localhost:5173/repository"

# Auth variables
ADMIN_USER="manual-admin"
ADMIN_PASS="password123"
AUTH_TOKEN=""

# Detect containers
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'ravhub-api|ravhub-app' | head -n1 || echo "ravhub-api-1")
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'ravhub-postgres|postgres' | head -n1 || echo "ravhub-postgres-1")

echo "Setting up Manual Test Environment..."

# Cleanup function
cleanup() {
    echo "Cleaning up temporary files..."
    [ -d "$TEMP_BASE" ] && rm -rf "$TEMP_BASE"
}
trap cleanup EXIT

TEMP_BASE=$(mktemp -d)
echo "Using temporary base directory: $TEMP_BASE"

# 0. Setup Auth
echo "Setting up authentication..."
HASHED_PASS=$(docker exec $API_CONTAINER node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('$ADMIN_PASS', 10));")

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
    echo -e "${RED}Authentication failed.${NC}"
    exit 1
fi
echo "Authenticated as $ADMIN_USER"

create_repo() {
    local DATA="$1"
    local NAME=$(echo "$DATA" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
    echo "Creating repository $NAME..."
    curl -s -X POST "$API_URL/repositories" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -d "$DATA" > /dev/null
}

# --- COMPOSER ---
echo "--- Setting up Composer ---"
create_repo '{"name":"composer-proxy","type":"proxy","manager":"composer","config":{"proxyUrl":"https://repo.packagist.org","cacheMaxAgeDays":7}}'
create_repo '{"name":"composer-hosted","type":"hosted","manager":"composer"}'
# Upload real package
TEMP_COMPOSER="$TEMP_BASE/composer-hosted"
mkdir -p $TEMP_COMPOSER/my-package
mkdir -p $TEMP_COMPOSER/my-package/src

# Create realistic composer.json
cat > $TEMP_COMPOSER/my-package/composer.json <<JSON
{
    "name": "manual/package",
    "description": "A manual test package for ravhub",
    "type": "library",
    "license": "MIT",
    "authors": [
        {
            "name": "Manual Test",
            "email": "test@example.com"
        }
    ],
    "version": "1.0.0",
    "autoload": {
        "psr-4": {
            "Manual\\Package\\": "src/"
        }
    },
    "require": {
        "php": ">=7.4"
    }
}
JSON

# Create a PHP class
cat > $TEMP_COMPOSER/my-package/src/Library.php <<PHP
<?php

namespace Manual\Package;

class Library
{
    public function sayHello(): string
    {
        return "Hello from Manual Package!";
    }
}
PHP

# Create README
echo "# Manual Package" > $TEMP_COMPOSER/my-package/README.md

cd $TEMP_COMPOSER/my-package
if command -v zip >/dev/null 2>&1; then
    zip -r ../package.zip . > /dev/null
else
    python3 -c "import shutil; shutil.make_archive('../package', 'zip', '.')"
fi
cd $TEMP_COMPOSER
PKG_CONTENT=$(base64 -w 0 package.zip)

curl -s -X POST "$REPOS_URL/composer-hosted/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"manual/package\",\"version\":\"1.0.0\",\"content\":\"$PKG_CONTENT\",\"encoding\":\"base64\"}" > /dev/null

# Verify hosted metadata
echo "Verifying Composer Hosted metadata..."
curl -s "$REPOS_URL/composer-hosted/packages.json" | grep "manual/package" > /dev/null || echo -e "${RED}Failed to find manual/package in hosted metadata${NC}"

# Download from Proxy (populate cache)
echo "Populating Composer Proxy Cache..."
TEMP_COMPOSER="$TEMP_BASE/composer-proxy"
mkdir -p $TEMP_COMPOSER
cat > $TEMP_COMPOSER/composer.json <<JSON
{
    "name": "manual/app",
    "repositories": [
        { "packagist": false },
        {
            "type": "composer",
            "url": "$REPOS_URL/composer-proxy"
        }
    ],
    "require": {
        "monolog/monolog": "^3.0"
    },
    "config": {
        "secure-http": false
    }
}
JSON
docker run --rm \
    --network host \
    -v "$TEMP_COMPOSER:/app" \
    -w /app \
    composer:latest \
    install --no-interaction --no-progress --prefer-dist || echo "Composer install failed (expected if network issues, but cache might be populated)"
docker run --rm -v "$TEMP_COMPOSER:/app" alpine sh -c "rm -rf /app/*"
rm -rf $TEMP_COMPOSER
# Return to a safe directory
cd "$PWD" || cd /

# --- NPM ---
echo "--- Setting up NPM ---"
create_repo '{"name":"npm-proxy","type":"proxy","manager":"npm","config":{"proxyUrl":"https://registry.npmjs.org","cacheMaxAgeDays":7}}'
create_repo '{"name":"npm-hosted","type":"hosted","manager":"npm"}'

# Helper to publish npm package
publish_npm_package() {
  local repo=$1
  local pkg=$2
  local ver=$3
  echo "Publishing $pkg@$ver to $repo..."
  
  local PKG_DIR="$TEMP_BASE/npm-setup/$pkg"
  mkdir -p "$PKG_DIR"
  echo "content" > "$PKG_DIR/index.js"
  echo "{\"name\": \"$pkg\", \"version\": \"$ver\"}" > "$PKG_DIR/package.json"
  tar -czf "$TEMP_BASE/npm-setup/$pkg-$ver.tgz" -C "$PKG_DIR" .
  
  local tgz_base64=$(base64 -w 0 "$TEMP_BASE/npm-setup/$pkg-$ver.tgz")
  
  cat <<JSON > "$TEMP_BASE/npm-setup/metadata.json"
{
  "_id": "$pkg",
  "name": "$pkg",
  "description": "Test package",
  "dist-tags": { "latest": "$ver" },
  "versions": {
    "$ver": {
      "name": "$pkg",
      "version": "$ver",
      "dist": {
        "tarball": "$REPOS_URL/$repo/$pkg/-/$pkg-$ver.tgz",
        "shasum": "dummy"
      }
    }
  },
  "_attachments": {
    "$pkg-$ver.tgz": {
      "content_type": "application/octet-stream",
      "data": "$tgz_base64"
    }
  }
}
JSON

  curl -s -X PUT "$REPOS_URL/$repo/$pkg" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d @"$TEMP_BASE/npm-setup/metadata.json" > /dev/null
}

publish_npm_package "npm-hosted" "manual-pkg" "1.0.0"

# Download from Proxy (populate cache)
echo "Populating NPM Proxy Cache..."
# We use curl to fetch metadata and tarball for a popular package (e.g. react)
curl -s "$REPOS_URL/npm-proxy/react" > /dev/null
# Fetch a specific version tarball to ensure storage
VERSION=$(curl -s "$REPOS_URL/npm-proxy/react" | grep -o '"latest":"[^"]*"' | cut -d'"' -f4)
if [ ! -z "$VERSION" ]; then
    echo "Fetching react@$VERSION..."
    curl -s "$REPOS_URL/npm-proxy/react/-/react-$VERSION.tgz" > /dev/null
fi

# --- RAW ---
echo "--- Setting up Raw ---"
create_repo '{"name":"raw-hosted","type":"hosted","manager":"raw"}'
curl -s -X PUT "$REPOS_URL/raw-hosted/hello.txt" \
  -H "Content-Type: text/plain" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "Hello World" > /dev/null

# Raw proxy not supported by plugin yet
# create_repo '{"name":"raw-proxy","type":"proxy","manager":"raw","config":{"url":"https://raw.githubusercontent.com/google/leveldb/master"}}'

# --- RUST ---
echo "--- Setting up Rust ---"
create_repo '{"name":"rust-hosted","type":"hosted","manager":"rust"}'
create_repo '{"name":"rust-proxy","type":"proxy","manager":"rust","config":{"proxyUrl":"https://crates.io","cacheMaxAgeDays":7}}'

# Upload real crate
TEMP_RUST="$TEMP_BASE/rust-hosted"
mkdir -p $TEMP_RUST
cat > $TEMP_RUST/Cargo.toml <<TOML
[package]
name = "manual-crate"
version = "0.1.0"
authors = ["Me"]
edition = "2018"
TOML
mkdir -p $TEMP_RUST/src
echo "fn main() {}" > $TEMP_RUST/src/lib.rs
cd $TEMP_RUST
tar -czf crate.crate Cargo.toml src
PKG_CONTENT=$(base64 -w 0 crate.crate)

curl -s -X POST "$REPOS_URL/rust-hosted/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"manual-crate\",\"version\":\"0.1.0\",\"content\":\"$PKG_CONTENT\",\"encoding\":\"base64\"}" > /dev/null

# Download from Proxy (populate cache)
echo "Populating Rust Proxy Cache..."
# Fetch a popular crate metadata (e.g. serde)
curl -s "$REPOS_URL/rust-proxy/serde/1.0.197" > /dev/null
# Try to trigger download (this might fail if we don't have the exact download URL logic, but let's try standard crates.io pattern)
# Crates.io download: /api/v1/crates/{crate}/{version}/download
# Our proxy maps this?
# Let's try to fetch the download endpoint via proxy
curl -s -L "$REPOS_URL/rust-proxy/api/v1/crates/serde/1.0.197/download" > /dev/null

# --- HELM ---
echo "--- Setting up Helm ---"
create_repo '{"name":"helm-hosted","type":"hosted","manager":"helm"}'
create_repo '{"name":"helm-proxy","type":"proxy","manager":"helm","config":{"proxyUrl":"https://charts.bitnami.com/bitnami","cacheMaxAgeDays":7}}'

# Upload to Hosted
echo "Uploading chart to Helm Hosted..."
TEMP_HELM="$TEMP_BASE/helm-hosted"
mkdir -p $TEMP_HELM
echo "name: manual-chart" > $TEMP_HELM/Chart.yaml
echo "version: 0.1.0" >> $TEMP_HELM/Chart.yaml
echo "apiVersion: v2" >> $TEMP_HELM/Chart.yaml
cd $TEMP_HELM
tar -czf manual-chart-0.1.0.tgz Chart.yaml
CHART_CONTENT=$(base64 -w 0 manual-chart-0.1.0.tgz)
curl -s -X POST "$REPOS_URL/helm-hosted/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"manual-chart\",\"version\":\"0.1.0\",\"filename\":\"manual-chart-0.1.0.tgz\",\"content\":\"$CHART_CONTENT\"}" > /dev/null
cd "$PWD" || cd /
rm -rf $TEMP_HELM

# Download from Proxy (populate cache)
echo "Populating Helm Proxy Cache..."
# Fetch index.yaml to trigger caching of index
curl -s "$REPOS_URL/helm-proxy/index.yaml" > /dev/null
# Try to fetch a specific chart (nginx)
# Bitnami charts are usually at root of the repo url
echo "Fetching nginx chart..."
curl -s -f "$REPOS_URL/helm-proxy/nginx-15.4.0.tgz" -o /dev/null || echo "Failed to fetch nginx chart"

# --- MAVEN ---
echo "--- Setting up Maven ---"
create_repo '{"name":"maven-hosted","type":"hosted","manager":"maven"}'
create_repo '{"name":"maven-proxy","type":"proxy","manager":"maven","config":{"proxyUrl":"https://repo1.maven.org/maven2","cacheMaxAgeDays":7}}'

# Upload to Hosted
echo "Uploading artifact to Maven Hosted..."
curl -s -X PUT "$REPOS_URL/maven-hosted/com/manual/app/1.0.0/app-1.0.0.pom" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/xml" \
  --data-binary '<project><modelVersion>4.0.0</modelVersion><groupId>com.manual</groupId><artifactId>app</artifactId><version>1.0.0</version></project>' > /dev/null
curl -s -X PUT "$REPOS_URL/maven-hosted/com/manual/app/1.0.0/app-1.0.0.jar" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/java-archive" \
  --data-binary 'fake-jar-content' > /dev/null

# Download from Proxy (populate cache)
echo "Populating Maven Proxy Cache..."
# Fetch junit pom AND jar
echo "Fetching junit POM..."
curl -s -f "$REPOS_URL/maven-proxy/junit/junit/4.13.2/junit-4.13.2.pom" -o /dev/null
echo "Fetching junit JAR..."
curl -s -f "$REPOS_URL/maven-proxy/junit/junit/4.13.2/junit-4.13.2.jar" -o /dev/null || echo "Failed to fetch junit JAR"

# --- NUGET ---
echo "--- Setting up NuGet ---"
create_repo '{"name":"nuget-hosted","type":"hosted","manager":"nuget"}'
create_repo '{"name":"nuget-proxy","type":"proxy","manager":"nuget","config":{"proxyUrl":"https://api.nuget.org/v3/index.json","cacheMaxAgeDays":7}}'

# Upload to Hosted
echo "Uploading package to NuGet Hosted..."
TEMP_NUGET="$TEMP_BASE/nuget-hosted"
mkdir -p $TEMP_NUGET
echo "dummy content" > $TEMP_NUGET/dummy.txt
if command -v zip >/dev/null 2>&1; then
    zip -j $TEMP_NUGET/manual-pkg.1.0.0.nupkg $TEMP_NUGET/dummy.txt > /dev/null
else
    # Fallback if zip not present
    tar -czf $TEMP_NUGET/manual-pkg.1.0.0.nupkg -C $TEMP_NUGET dummy.txt
fi
curl -s -X PUT "$REPOS_URL/nuget-hosted/manual-pkg/1.0.0/manual-pkg.1.0.0.nupkg" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @$TEMP_NUGET/manual-pkg.1.0.0.nupkg > /dev/null
rm -rf $TEMP_NUGET

# Download from Proxy (populate cache)
echo "Populating NuGet Proxy Cache..."
# Fetch index
curl -s "$REPOS_URL/nuget-proxy/index.json" > /dev/null
# Fetch a .nupkg using v3-proxy magic
# Base: https://api.nuget.org/v3-flatcontainer/
# Encoded: https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer%2F
echo "Fetching Newtonsoft.Json nupkg..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPOS_URL/nuget-proxy/v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer%2F/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg")
if [ "$HTTP_CODE" != "200" ]; then
    echo "Failed to fetch nupkg (HTTP $HTTP_CODE)"
    # Try to fetch with verbose output to see what's wrong
    curl -v "$REPOS_URL/nuget-proxy/v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer%2F/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg" > /dev/null
fi

# --- PYPI ---
echo "--- Setting up PyPI ---"
create_repo '{"name":"pypi-hosted","type":"hosted","manager":"pypi"}'
create_repo '{"name":"pypi-proxy","type":"proxy","manager":"pypi","config":{"proxyUrl":"https://pypi.org/simple","cacheMaxAgeDays":7}}'

# Upload real package
TEMP_PYPI="$TEMP_BASE/pypi-hosted"
mkdir -p $TEMP_PYPI/pkg
echo "print('hello')" > $TEMP_PYPI/pkg/__init__.py
cat > $TEMP_PYPI/setup.py <<PYTHON
from setuptools import setup
setup(name='manual-pypi', version='1.0.0', packages=['pkg'])
PYTHON
cd $TEMP_PYPI
# Create tar.gz
tar -czf package.tar.gz setup.py pkg
PKG_CONTENT=$(base64 -w 0 package.tar.gz)

curl -s -X POST "$REPOS_URL/pypi-hosted/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"name\":\"manual-pypi\",\"version\":\"1.0.0\",\"content\":\"$PKG_CONTENT\",\"encoding\":\"base64\"}" > /dev/null

# Download from Proxy (populate cache)
echo "Populating PyPI Proxy Cache..."
# Fetch requests package page
echo "Fetching requests simple index..."
INDEX=$(curl -s "$REPOS_URL/pypi-proxy/requests/")
# Try to extract a download link from the rewritten index and fetch it
# Look for a .whl or .tar.gz link
LINK=$(echo "$INDEX" | grep -o 'href="[^"]*requests-[0-9.]*\(.whl\|.tar.gz\)[^"]*"' | head -n1 | cut -d'"' -f2)
if [ ! -z "$LINK" ]; then
    # Decode HTML entities if necessary (ampersand)
    LINK=$(echo "$LINK" | sed 's/&amp;/\&/g')
    echo "Fetching PyPI artifact: $LINK"
    curl -s -f "$LINK" -o /dev/null || echo "Failed to fetch PyPI artifact"
else
    echo "Could not find download link for requests package"
fi

# --- DOCKER ---
echo "--- Setting up Docker ---"
# Create Proxy (Docker Hub) on port 5001
# Note: proxyUrl and isDockerHub are inside the 'docker' object in the schema
create_repo '{"name":"docker-proxy","type":"proxy","manager":"docker","config":{"docker":{"port":5001,"proxyUrl":"https://registry-1.docker.io","isDockerHub":true},"cacheMaxAgeDays":7}}'
# Create Hosted on port 5002
create_repo '{"name":"docker-hosted","type":"hosted","manager":"docker","config":{"docker":{"port":5002}}}'

echo "Waiting for Docker registries to start..."
sleep 5

echo "Logging in to Docker registries..."
echo "$ADMIN_PASS" | docker login localhost:5001 -u "$ADMIN_USER" --password-stdin
echo "$ADMIN_PASS" | docker login localhost:5002 -u "$ADMIN_USER" --password-stdin

echo "Populating Docker Proxy Cache..."
# Pull a specific version to ensure download (avoid 'up to date')
# Use hello-world as it is smaller and simpler
docker pull localhost:5001/library/hello-world:latest

echo "Populating Docker Hosted..."
docker tag localhost:5001/library/hello-world:latest localhost:5002/manual-hello:latest
docker push localhost:5002/manual-hello:latest

echo -e "${GREEN}Manual Setup Complete!${NC}"
echo "User: $ADMIN_USER"
echo "Pass: $ADMIN_PASS"
