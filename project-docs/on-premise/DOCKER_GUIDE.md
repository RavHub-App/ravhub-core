# Docker Deployment Guide for RavHub

This guide provides instructions for deploying RavHub using Docker directly (without Kubernetes), suitable for single-server or development environments.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+

## Option 1: Docker Compose (Recommended)

We provide a `docker-compose.prod.yml` that orchestrates the API, Nginx, and PostgreSQL database.

### 1. Prepare Configuration

Create a `.env` file or modify `docker-compose.prod.yml` environment variables:

```yaml
- JWT_SECRET=your_secure_secret # REQUIRED
- LICENSE_KEY=your_license_key # Optional (Bootstrap)

# Storage (Filesystem default)
- STORAGE_TYPE=filesystem
- STORAGE_PATH=/data/storage
# Storage (S3 Example - Requires Enterprise)
# - STORAGE_TYPE=s3
# - S3_BUCKET=my-bucket
# - S3_ACCESS_KEY=...
```

### 2. Run Container

```bash
# Build and start in background
docker-compose -f docker-compose.prod.yml up -d --build
```

The application will be available at:

- **Web UI**: http://localhost:80
- **API**: http://localhost:3000

## Option 2: Docker CLI

If you prefer running the container manually:

1. **Build Image**:

   ```bash
   docker build -f ravhub-prod.Dockerfile -t ravhub/api:latest .
   ```

2. **Run Postgres**:

   ```bash
   docker run -d --name ravhub-postgres \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ravhub \
     postgres:15-alpine
   ```

3. **Run RavHub**:
   ```bash
   docker run -d --name ravhub \
     -p 80:80 -p 3000:3000 \
     --link ravhub-postgres:postgres \
     -e JWT_SECRET=change_me \
     -e POSTGRES_HOST=postgres \
     -v ravhub_data:/data/storage \
     ravhub/api:latest
   ```

## Production Considerations

- **Redis**: For single-server deployments (`replicas=1`), Redis is optional (an in-memory locking mechanism is used). For multiple instances (e.g. Docker Swarm), you MUST add a Redis service and configure `REDIS_HOST`.
- **Volumes**: Ensure `/data/storage` volume is backed up if using filesystem storage.
- **Security**: Put this setup behind a Reverse Proxy (Nginx/Traefik) with SSL termination for HTTPS access.
