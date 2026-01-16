# Testing Guide

Complete guide for running tests in the Distributed Package Registry project.

## Quick Start

Run all tests:

```bash
./test/run-commissioning.sh
```

## Test Organization

```
project/
├── test/
│   ├── run-commissioning.sh      # Master test runner (Functional + Stress)
│   ├── scripts/                  # Ad-hoc test scripts
│   ├── e2e/                      # E2E Scenarios (bash)
│   ├── integration/              # Integration tests per package manager
│   │   ├── npm/test-npm.sh
│   │   ├── maven/test-maven.sh
│   │   ├── pypi/test-pypi.sh
│   │   ├── docker/test-docker.sh
│   │   ├── composer/test-composer.sh
│   │   ├── nuget/test-nuget.sh
│   │   ├── rust/test-rust.sh
│   │   └── raw/test-raw.sh
│   └── local/                    # Local test utilities
├── apps/
│   ├── api/
│   │   ├── src/**/__tests__/     # API unit tests
│   │   └── test/
│   │       ├── run-unit-tests.sh
│   │       └── run-e2e-auto.sh
│   └── web/
│       ├── src/__tests__/        # Web unit tests
│       ├── e2e/                  # Playwright E2E tests
│       └── test/run-unit-tests.sh
└── scripts/
    └── run-frontend-e2e.sh       # Frontend E2E runner
```

## Test Types

### 1. Unit Tests

**API Unit Tests**

```bash
cd apps/api
pnpm run test
# or
./apps/api/test/run-unit-tests.sh
```

**Web Unit Tests**

```bash
cd apps/web
pnpm run test:unit
# or
./apps/web/test/run-unit-tests.sh
```

### 2. E2E Tests

**API E2E Tests** (with docker-compose)

```bash
./test/run-e2e-with-compose.sh
```

**Frontend E2E Tests** (Playwright)

```bash
./scripts/run-frontend-e2e.sh
```

### 3. Integration Tests

Each package manager has a realistic integration test that:

- Creates a repository via API
- Uses the actual package manager CLI (via Docker)
- Publishes a real package
- Downloads/installs the package
- Verifies functionality

**Run individual integration tests:**

```bash
./test/integration/npm/test-npm.sh
./test/integration/maven/test-maven.sh
./test/integration/pypi/test-pypi.sh
./test/integration/docker/test-docker.sh
./test/integration/composer/test-composer.sh
./test/integration/nuget/test-nuget.sh
./test/integration/rust/test-rust.sh
./test/integration/raw/test-raw.sh
```

## Integration Test Details

### NPM

- Creates a scoped package (@test-scope/test-package)
- Uses Node.js Docker image
- Tests publish and install
- Verifies package functionality

### Maven

- Creates a Java project with pom.xml
- Uses Maven Docker image
- Tests deploy and dependency resolution
- Builds and runs consumer project

### PyPI

- Creates a Python package with setup.py
- Uses Python Docker image
- Tests twine upload and pip install
- Verifies import and functionality

### Docker

- Builds a test Docker image
- Tests push and pull
- Verifies image runs correctly
- **Note**: Requires Docker daemon configured for insecure registries

### Composer, NuGet, Rust, Raw

- Simplified tests using API upload
- Verify package storage and retrieval
- Can be enhanced with full CLI tests as needed

## Prerequisites

### For All Tests

- Docker
- curl
- bash

### For Specific Tests

- **Docker Integration**: Docker daemon with insecure-registries configured
- **Maven Integration**: ~2GB disk space for Maven dependencies
- **Frontend E2E**: Chromium (installed by Playwright)

## Environment Variables

- `API_URL`: API endpoint (default: http://localhost:3000)
- `TEST_POSTGRES_PORT`: Postgres port for E2E tests
- `TEST_REGISTRY_PORT`: Docker registry port for E2E tests
- `TEST_USE_LOCAL_UPSTREAM`: Use local upstream services (default: false)

### Kubernetes (Minikube) Test

To test the Helm chart deployment locally:
Follow the steps in [.agent/workflows/test-k8s-local.md](.agent/workflows/test-k8s-local.md) or use:

```bash
/test-k8s-local
```

if configured as a slash command.

### Storage Integration Tests

These tests verify storage adapters with local emulators/containers.

**Run S3 Local Test:**

```bash
cd apps/api
npx ts-node test/storage/test-s3-local.ts
```

**Run Enterprise (Azure/GCS) Local Test:**

```bash
cd apps/api
npx ts-node test/storage/test-enterprise-local.ts
```

## CI/CD Integration

The master test runner (`test/run-commissioning.sh`) provides:

- Colored output
- Test summary
- Non-zero exit code on failure
- Individual test status

Example CI usage:

```bash
# Start services
docker-compose -f docker-compose.dev.yml up -d

# Wait for API
until curl -f http://localhost:3000/health; do sleep 1; done

# Run all tests
./test/run-commissioning.sh
```

## Troubleshooting

### Docker Integration Test Fails

Configure Docker daemon to allow insecure registries:

```json
{
  "insecure-registries": ["localhost:5000", "localhost:5001"]
}
```

### Maven Test is Slow

First run downloads dependencies. Subsequent runs use cached dependencies.

### API Not Available

Ensure the API is running:

```bash
docker-compose -f docker-compose.dev.yml up -d api postgres
```

### Port Conflicts

E2E tests automatically find free ports. If you get port conflicts, check for:

- Other running instances
- Stale Docker containers

## Adding New Tests

### New Integration Test

1. Create directory: `test/integration/<manager>/`
2. Create test script: `test-<manager>.sh`
3. Make executable: `chmod +x test-<manager>.sh`
4. Add to `test/run-all-tests.sh`
5. Add README.md explaining the test

### New Unit Test

1. Add to `apps/api/src/**/__tests__/` or `apps/web/src/__tests__/`
2. Follow existing naming: `*.spec.ts` or `*.test.tsx`
3. Tests run automatically with `pnpm run test`

## Test Coverage

Run with coverage:

```bash
cd apps/api
pnpm run test:cov

cd apps/web
pnpm run test:unit -- --coverage
```
