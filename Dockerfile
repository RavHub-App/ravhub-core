
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy app package.json files
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY services/license-portal/package.json services/license-portal/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build web
WORKDIR /app/apps/web
RUN pnpm build

# Build api
WORKDIR /app/apps/api
RUN pnpm build

# Production image
FROM node:20-alpine

WORKDIR /app

# Create a non-root user
RUN addgroup -S ravhub && adduser -S ravhub -G ravhub

RUN npm install -g pnpm

# Copy workspace config for production install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/

# Install prod dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built API
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Copy built Web to client folder in API
COPY --from=builder /app/apps/web/dist ./apps/api/client

# Ensure the non-root user has access to the app directory
RUN chown -R ravhub:ravhub /app

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV SERVE_STATIC_PATH=/app/apps/api/client

# Switch to non-root user
USER ravhub

WORKDIR /app/apps/api

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
