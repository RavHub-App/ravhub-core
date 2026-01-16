# RavHub Configuration Guide

This document outlines the configuration options available for RavHub via Environment Variables and Helm Chart Values.

## Environment Variables

The application (API) is configured primarily through environment variables.

### Core

| Variable      | Default          | Description                                 |
| ------------- | ---------------- | ------------------------------------------- |
| `PORT`        | `3000`           | Port for the API server                     |
| `LOG_FORMAT`  | `json`           | Log format (json, simple)                   |
| `APP_VERSION` | `<ChartVersion>` | Application version (Auto-injected by Helm) |

### Authentication (Critical)

| Variable                 | Default      | Description                                                 |
| ------------------------ | ------------ | ----------------------------------------------------------- |
| `JWT_SECRET`             | **REQUIRED** | Secret key for signing JWT tokens. **Must be kept secret.** |
| `JWT_EXPIRES_IN`         | `1h`         | Token expiration time                                       |
| `JWT_REFRESH_EXPIRES_IN` | `7d`         | Refresh token expiration time                               |

### Database (PostgreSQL)

| Variable            | Default     | Description       |
| ------------------- | ----------- | ----------------- |
| `POSTGRES_HOST`     | `localhost` | Database host     |
| `POSTGRES_PORT`     | `5432`      | Database port     |
| `POSTGRES_USER`     | `postgres`  | Database username |
| `POSTGRES_PASSWORD` | `postgres`  | Database password |
| `POSTGRES_DB`       | `ravhub`    | Database name     |

### Redis (Optional but Recommended)

**Required for multi-replica setups.**

| Variable         | Default     | Description          |
| ---------------- | ----------- | -------------------- |
| `REDIS_ENABLED`  | `false`     | Enable Redis support |
| `REDIS_HOST`     | `localhost` | Redis host           |
| `REDIS_PORT`     | `6379`      | Redis port           |
| `REDIS_PASSWORD` | -           | Redis password       |
| `REDIS_DB`       | `0`         | Redis database index |

### Storage

**Enterprise License Required for Cloud Backends (S3, GCS, Azure).**

| Variable                          | Default         | Description                                                  |
| --------------------------------- | --------------- | ------------------------------------------------------------ |
| `STORAGE_TYPE`                    | `filesystem`    | Default storage backend (`filesystem`, `s3`, `gcs`, `azure`) |
| `STORAGE_PATH`                    | `/data/storage` | Local filesystem path for artifacts                          |
| `S3_BUCKET`                       | -               | S3 Bucket name                                               |
| `S3_REGION`                       | `us-east-1`     | S3 Region                                                    |
| `S3_ACCESS_KEY`                   | -               | S3 Access Key                                                |
| `S3_SECRET_KEY`                   | -               | S3 Secret Key                                                |
| `GCS_BUCKET`                      | -               | Google Cloud Storage Bucket                                  |
| `GCP_PROJECT`                     | -               | Google Cloud Project ID                                      |
| `AZURE_CONTAINER`                 | -               | Azure Blob Container Name                                    |
| `AZURE_STORAGE_CONNECTION_STRING` | -               | Azure Connection String                                      |

### Licensing

URLs and Public Keys are managed internally by the application build.

| Variable      | Default | Description                                          |
| ------------- | ------- | ---------------------------------------------------- |
| `LICENSE_KEY` | -       | Bootstrap license key for auto-activation on startup |

## Helm Chart Configuration

See [HELM_GUIDE.md](./HELM_GUIDE.md) for details on configuring these values via `values.yaml`.
