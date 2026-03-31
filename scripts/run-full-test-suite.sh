#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
E2E_COMPOSE_FILE="$ROOT_DIR/docker-compose.e2e.yml"
SERVICES=(postgres redis api web)
STACK_STARTED=0
KEEP_STACK="${RAVHUB_KEEP_STACK:-0}"

cd "$ROOT_DIR"

running_services() {
  docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null || true
}

service_is_running() {
  local service="$1"
  running_services | grep -qx "$service"
}

start_stack_if_needed() {
  local missing=0

  for service in "${SERVICES[@]}"; do
    if ! service_is_running "$service"; then
      missing=1
      break
    fi
  done

  if [ "$missing" -eq 0 ]; then
    return
  fi

  echo "Starting development stack..."
  docker compose -f "$COMPOSE_FILE" up -d "${SERVICES[@]}"
  STACK_STARTED=1
}

wait_for_http() {
  local url="$1"
  local label="$2"

  for _ in {1..60}; do
    if curl -fsS "$url" > /dev/null 2>&1; then
      echo "$label is ready"
      return 0
    fi
    sleep 2
  done

  echo "$label did not become ready"
  return 1
}

start_api_e2e_db() {
  echo "Starting API E2E database..."
  docker compose -f "$E2E_COMPOSE_FILE" up -d postgres

  for _ in {1..30}; do
    if docker compose -f "$E2E_COMPOSE_FILE" exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
      echo "API E2E database is ready"
      return 0
    fi
    sleep 2
  done

  echo "API E2E database did not become ready"
  return 1
}

stop_api_e2e_db() {
  docker compose -f "$E2E_COMPOSE_FILE" down -v > /dev/null 2>&1 || true
}

cleanup() {
  stop_api_e2e_db

  if [ "$STACK_STARTED" -eq 1 ] && [ "$KEEP_STACK" != "1" ]; then
    echo "Stopping development stack..."
    docker compose -f "$COMPOSE_FILE" down --remove-orphans
  fi
}

trap cleanup EXIT

start_stack_if_needed
wait_for_http "http://localhost:3000/health" "API"
wait_for_http "http://localhost:5173" "Web"

echo "Running API unit tests..."
pnpm run test:api:unit

echo "Running Web unit tests..."
pnpm run test:web

echo "Running API e2e tests..."
start_api_e2e_db
E2E_POSTGRES_HOST=127.0.0.1 \
E2E_POSTGRES_PORT=54329 \
E2E_POSTGRES_USER=postgres \
E2E_POSTGRES_PASSWORD=postgres \
E2E_POSTGRES_DB=ravhub \
pnpm run test:api:e2e:ci

echo "Running frontend Playwright tests..."
pnpm run test:frontend:e2e

echo "Running shell E2E scenarios..."
pnpm run test:shell:e2e

echo "Full RavHub test suite passed"
