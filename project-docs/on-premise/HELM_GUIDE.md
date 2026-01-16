# RavHub Helm Chart Guide

This guide explains how to configure and deploy RavHub using the provided Helm chart.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- PV provisioner support (for filesystem storage)
- Enterprise License (for Cloud Storage: S3, GCS, Azure)

## Installation

```bash
helm install ravhub ./charts/ravhub -f values.yaml
```

## Configuration Values

The default configuration is defined in `values.yaml`. You can override these values during installation.

### Storage Configuration

You must select **one** default storage backend using `storage.type`.

**1. Filesystem (Default)**
Suitable for single-node deployments using Persistent Volumes.

```yaml
storage:
  type: filesystem
  filesystem:
    path: /data/storage
```

**2. Cloud Storage (Enterprise)**
Requires an active Enterprise License. Supported backends:

- **S3 (AWS)**
- **GCS (Google Cloud)**
- **Azure Blob Storage**

Example (S3):

```yaml
storage:
  type: s3
  s3:
    bucket: "my-bucket"
    region: "us-east-1"
    accessKey: "..." # Optional if using IAM
    secretKey: "..."
```

### Licensing

You can bootstrap the installation with a license key.

```yaml
license:
  key: "YOUR-LICENSE-KEY"
```

### Scalability & High Availability

**Single Replica (`replicaCount: 1`)**

- Optimized for simplicity.
- Uses **In-Memory Mutex** for thread safety if Redis is disabled.
- Can use Filesystem (ReadWriteOnce) storage.

**Multiple Replicas (`replicaCount: >1`)**

- **Redis is REQUIRED**: Must be enabled (`redis.enabled: true`) for distributed locking.
- **Shared Storage REQUIRED**: usage of Filesystem requires `ReadWriteMany` (NFS). Recommended: S3/GCS/Azure.

### Authentication & Secrets

The chart handles sensitive data management:

- `auth.jwt.secret`: Auto-generated on install if empty.
- `externalDatabase.password`: Can use existing secrets.

## Production Recommendations

1. **Secrets**: Do not commit `values.yaml` with passwords. Use `existingSecret`.
2. **Ingress**: Configure TLS/SSL.
3. **Resources**: Tune `resources` based on load.
