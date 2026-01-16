# RavHub On-Premise Architecture

This document outlines the architecture and components of the RavHub Self-Hosted product.

## High Level Overview

RavHub is designed as a modular application that can run as a single container (Monolith-style) or distributed microservices.

```mermaid
graph TD
    User[Developer/CI] -->|HTTP/HTTPS| LB[Load Balancer / Nginx]
    LB -->|/api| API[API Service (NestJS)]
    LB -->|/| Web[Web UI (React/Vite)]

    API --> DB[(PostgreSQL)]
    API --> Redis[(Redis)]
    API --> Storage[(Artifact Storage)]

    subgraph Storage Options
    Storage -.-> FS[Local Filesystem]
    Storage -.-> S3[AWS S3]
    Storage -.-> GCS[Google Cloud Storage]
    Storage -.-> Azure[Azure Blob]
    end
```

## Core Components

### 1. API Service (NestJS)

The heart of the application. Handles:

- **Authentication**: JWT issuance and validation.
- **Package Registry**: Implements protocols for NPM, Maven, Docker, PyPI, etc.
- **Metadata Management**: Indexing and searching packages in Postgres.
- **License Enforcement**: Validates instance license on startup.

### 2. Web UI (React)

A Static SPA (Single Page Application) served via Nginx. Consumes the API.

### 3. PostgreSQL

Stores:

- User accounts and RBAC permissions.
- Repository configurations.
- Package metadata (transient/cached versions).
- License status.

### 4. Redis (Optional / Required for HA)

Used for:

- **Distributed Locking** (`Redlock`): Prevents race conditions during package uploads via multiple API replicas.
- **Caching**: Session data and query caching.
- _Note: If running a single replica, an In-Memory fallback is used instead of Redis._

### 5. Storage Backend

Abstracted via the `StorageService`. Configurable via `STORAGE_TYPE` env var.

- **Filesystem**: Default. Requires a Persistent Volume.
- **Cloud (Enterprise)**: S3, GCS, Azure. Logic handles streaming for performance.

## License enforcement

The product boots up with a `LICENSE_KEY`.

1. **Startup**: API validates key format.
2. **Activation**: API contacts `license.ravhub.io` to exchange the Key for a signed JWT Token (Activation Token).
3. **Verification**: The API verifies the Token signature using the embedded **Public Key**.
4. **Offline Mode**: Once activated, the token caches locally and allows operation properly for the token duration (e.g. 1 year).
