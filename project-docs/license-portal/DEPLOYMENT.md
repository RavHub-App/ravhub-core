# License Portal Deployment Guide

This document describes how to deploy the **RavHub License Portal**, the SaaS component responsible for issuing, validating, and managing licenses for On-Premise instances.

## Architecture

```
License Portal (Cloud)
├── services/license-portal (Next.js App)
└── license-portal-db (PostgreSQL)
```

## Security Credentials (Critical)

Before deployment, you must generate and configure the following secrets. **NEVER commit these to git.**

### 1. RSA Key Pair

Used to sign license tokens. The Private Key stays in the Portal; the Public Key is embedded in the On-Premise product builds.

```bash
# Generate keys (if not using scripts provided)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -outform PEM -pubout -out public.pem
```

- **Env Var**: `LICENSE_PRIVATE_KEY`
- **Value**: Content of `private.pem`

### 2. Stripe Keys

Required for billing and subscription management.

- **Env Var**: `STRIPE_SECRET_KEY` (starts with `sk_live_...`)
- **Env Var**: `STRIPE_WEBHOOK_SECRET` (starts with `whsec_...`)

### 3. Database

- **Env Var**: `DATABASE_URL` (Connection string to Postgres)

### 4. Auth

- **Env Var**: `NEXTAUTH_SECRET` (Random string, e.g. `openssl rand -base64 32`)
- **Env Var**: `NEXTAUTH_URL` (The canonical URL of the portal, e.g. `https://license.ravhub.io`)

## Deployment Options

### Option A: Vercel (Recommended for Frontend/API)

The portal is a Next.js application, optimized for ephemeral serverless deployment.

1. **Push code** to GitHub/GitLab.
2. **Import project** in Vercel.
3. **Configure Environment Variables** in the dashboard settings.
4. **Deploy**.

_Note: You must provisions a PostgreSQL database (e.g. Neon, Supabase, AWS RDS) separately and provide the `DATABASE_URL`._

### Option B: Docker (VPS / Container)

You can self-host the portal using Docker.

**Dockerfile**: `services/license-portal/Dockerfile`

```bash
# Build
docker build -f services/license-portal/Dockerfile -t license-portal:latest services/license-portal

# Run
docker run -d \
  -p 3001:3000 \
  -e LICENSE_PRIVATE_KEY="$(cat .keys/private.pem)" \
  -e STRIPE_SECRET_KEY=sk_live_xxx \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  license-portal:latest
```

## Maintenance

- **Key Rotation**: If you rotate the RSA Private Key, all existing licenses will become invalid unless the Product is updated with the new Public Key. Only do this in case of compromise.
- **Backups**: Ensure automatic daily backups of the PostgreSQL database. It contains customer data and license mappings.
