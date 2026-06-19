# SELADEV — Docker Setup & Container Strategy

## Purpose

This document covers the containerization strategy for the SELADEV Internal Developer Platform. It defines the container inventory, Dockerfile design per service, `docker-compose.yml` architecture, local development workflow, production container differences, and troubleshooting guide. Read this alongside `ci-cd.md` (image build pipeline) and `environment-config.md` (environment variable injection).

## Context

SELADEV runs five containers: an Express API server, a React/Vite frontend served via Nginx, a BullMQ worker process, MongoDB, and Redis. The container strategy must satisfy three distinct environments:

- **Local development** — Hot reload, volume mounts for source code, port exposure for direct access.
- **CI** — Fast builds, reproducible, no persistent volumes.
- **Production** — Multi-stage builds, minimal image size, no dev dependencies, restart policies, resource limits.

Docker Compose profiles and override files handle the difference between these environments without duplicating configuration.

---

## 1. Container Inventory

```
┌──────────────────────────────────────────────────────┐
│                   SELADEV Containers                  │
├──────────────┬──────────────────────────────────────┤
│  Container   │  Responsibility                       │
├──────────────┼──────────────────────────────────────┤
│  api         │  Express REST API (port 4000)         │
│  web         │  React/Vite → Nginx static serve      │
│              │  (port 80 internal, 3000 dev)         │
│  worker      │  BullMQ workers — no HTTP server      │
│  mongo       │  MongoDB 7.x (port 27017 internal)    │
│  redis       │  Redis 7.x (port 6379 internal)       │
└──────────────┴──────────────────────────────────────┘
```

**Port exposure policy:**
- In production: Only `api` (via reverse proxy) and `web` (via CDN or Nginx) expose ports externally. `mongo` and `redis` are accessible only on the internal Docker network.
- In local dev: All containers expose ports for direct debugging access.

---

## 2. Dockerfile Design

### Multi-Stage Build Pattern

All SELADEV Dockerfiles use a 4-stage multi-stage build:

```
base → deps → builder → runner
```

| Stage | Responsibility | Contents |
|---|---|---|
| `base` | Pin Node version, set workdir | `node:20-alpine`, `WORKDIR /app` |
| `deps` | Install all dependencies | `package.json`, `pnpm-lock.yaml`, `node_modules` |
| `builder` | Compile TypeScript / build assets | Source code + compiled output |
| `runner` | Minimal production runtime | Only compiled output + prod dependencies |

### `apps/api/Dockerfile`

```dockerfile
# ── Stage 1: base ──────────────────────────────────────────────────
FROM node:20-alpine AS base
# Install pnpm via corepack (avoids installing it as a global npm package)
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# ── Stage 2: deps ──────────────────────────────────────────────────
FROM base AS deps
# Copy only manifests first — Docker layer cache: deps only rebuild when lockfile changes
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/logger/package.json ./packages/logger/
# Install ALL deps (including devDeps) — builder stage needs tsc
RUN pnpm install --frozen-lockfile

# ── Stage 3: builder ───────────────────────────────────────────────
FROM deps AS builder
# Copy source code
COPY apps/api ./apps/api
COPY packages ./packages
COPY tsconfig.base.json ./
# Compile TypeScript
RUN pnpm --filter @seladev/api build

# ── Stage 4: runner ────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# Install only production dependencies
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/logger/package.json ./packages/logger/
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/schemas/dist ./packages/schemas/dist
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser
USER apiuser

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
```

### `apps/web/Dockerfile`

```dockerfile
# ── Stage 1: base ──────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# ── Stage 2: deps ──────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/schemas/package.json ./packages/schemas/
RUN pnpm install --frozen-lockfile

# ── Stage 3: builder ───────────────────────────────────────────────
FROM deps AS builder
COPY apps/web ./apps/web
COPY packages ./packages
COPY tsconfig.base.json ./
# Build-time env vars (public, non-secret — baked into the Vite bundle)
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN pnpm --filter @seladev/web build

# ── Stage 4: runner — Nginx to serve static files ──────────────────
FROM nginx:1.25-alpine AS runner
# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# Custom Nginx config for SPA (all routes → index.html)
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

**`apps/web/nginx.conf`:**
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Health check endpoint for Docker/load balancer
    location /health {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    # SPA fallback — all unknown routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively (Vite hashes filenames)
    location ~* \.(js|css|png|jpg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

### `apps/worker/Dockerfile`

The worker is identical to the API Dockerfile through the `builder` stage. The `runner` stage differs:

```dockerfile
# ── Stage 4: runner (worker) ───────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# ... (same dep installation as api runner) ...

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
# ... (shared packages) ...

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workeruser
USER workeruser

# Workers have no HTTP server — no EXPOSE, no HEALTHCHECK via HTTP
# Health is monitored by BullMQ worker event: worker.on('ready')
# Use a script that checks the worker process is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node apps/worker/dist/health-check.js || exit 1

CMD ["node", "apps/worker/dist/index.js"]
```

---

## 3. `docker-compose.yml` (Base Configuration)

The base `docker-compose.yml` defines stable, production-like service configuration. Dev-specific overrides live in `docker-compose.dev.yml`.

```yaml
# docker-compose.yml
name: seladev

services:
  # ── MongoDB ───────────────────────────────────────────────────────
  mongo:
    image: mongo:7.0
    container_name: seladev-mongo
    restart: unless-stopped
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_ROOT_USER:-seladev}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASS:?MONGO_ROOT_PASS is required}
      MONGO_INITDB_DATABASE: ${MONGODB_DB_NAME:-seladev}
    volumes:
      - mongo-data:/data/db
      - ./docker/mongo/init.js:/docker-entrypoint-initdb.d/init.js:ro
    networks:
      - seladev-internal
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    profiles:
      - full
      - infra-only

  # ── Redis ──────────────────────────────────────────────────────────
  redis:
    image: redis:7.2-alpine
    container_name: seladev-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
    volumes:
      - redis-data:/data
    networks:
      - seladev-internal
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 5s
    profiles:
      - full
      - infra-only

  # ── API Server ────────────────────────────────────────────────────
  api:
    image: seladev/api:${IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: runner
    container_name: seladev-api
    restart: unless-stopped
    env_file: .env
    networks:
      - seladev-internal
    ports:
      - "4000:4000"
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    profiles:
      - full

  # ── BullMQ Worker ─────────────────────────────────────────────────
  worker:
    image: seladev/worker:${IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
      target: runner
    container_name: seladev-worker
    restart: unless-stopped
    env_file: .env
    networks:
      - seladev-internal
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    profiles:
      - full

  # ── Web Frontend ───────────────────────────────────────────────────
  web:
    image: seladev/web:${IMAGE_TAG:-latest}
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: runner
      args:
        VITE_API_URL: ${VITE_API_URL:-http://localhost:4000}
        VITE_WS_URL: ${VITE_WS_URL:-ws://localhost:4000}
    container_name: seladev-web
    restart: unless-stopped
    networks:
      - seladev-internal
    ports:
      - "80:80"
    depends_on:
      - api
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:80/health"]
      interval: 30s
      timeout: 3s
      retries: 3
    profiles:
      - full

volumes:
  mongo-data:
    driver: local
  redis-data:
    driver: local

networks:
  seladev-internal:
    driver: bridge
    internal: false  # Set to true in production (only reverse proxy exits network)
```

---

## 4. `docker-compose.dev.yml` (Development Overrides)

Applied on top of the base file during local development. Enables hot reload and direct port access.

```yaml
# docker-compose.dev.yml
services:
  api:
    build:
      target: deps  # Stop at deps stage — source mounted via volume
    image: seladev/api:dev
    command: pnpm --filter @seladev/api dev  # nodemon/tsx watch mode
    environment:
      NODE_ENV: development
      LOG_LEVEL: debug
    volumes:
      - ./apps/api/src:/app/apps/api/src:delegated   # Hot reload source
      - ./packages:/app/packages:delegated
    ports:
      - "4000:4000"
      - "9229:9229"  # Node.js inspector for VS Code debugging

  worker:
    build:
      target: deps
    image: seladev/worker:dev
    command: pnpm --filter @seladev/worker dev
    environment:
      NODE_ENV: development
    volumes:
      - ./apps/worker/src:/app/apps/worker/src:delegated
      - ./packages:/app/packages:delegated

  web:
    build:
      target: deps
    image: seladev/web:dev
    command: pnpm --filter @seladev/web dev --host 0.0.0.0
    environment:
      NODE_ENV: development
    volumes:
      - ./apps/web/src:/app/apps/web/src:delegated
    ports:
      - "3000:3000"  # Vite dev server (not Nginx)

  mongo:
    ports:
      - "27017:27017"  # Exposed for MongoDB Compass access in dev

  redis:
    ports:
      - "6379:6379"  # Exposed for redis-cli / RedisInsight in dev
```

---

## 5. Profile Strategy

Docker Compose profiles prevent unnecessary containers from starting.

| Profile | Containers Started | When to Use |
|---|---|---|
| `infra-only` | `mongo`, `redis` | Running API/web natively (not in Docker) |
| `full` | All 5 containers | Full stack in Docker |
| *(no profile)* | None | Profiles are required — explicit intent |

```bash
# Start only infrastructure (run API/web with pnpm dev)
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile infra-only up -d

# Start entire stack with hot reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile full up

# Production-like full stack (no dev overrides)
docker compose --profile full up -d
```

The `infra-only` profile is the recommended local development mode for engineers — it gives the fastest feedback loop (native TypeScript execution via `tsx`) while keeping MongoDB and Redis containerized.

---

## 6. Environment Variable Injection

**Principle: No secrets in Dockerfiles or docker-compose.yml.**

All secrets and configuration are injected via `.env` files that are **never committed to Git** (enforced by `.gitignore`). The `env_file: .env` directive in docker-compose loads the file into the container at runtime.

```
# .gitignore — prevent accidental secret commits
.env
.env.local
.env.staging
.env.production
```

Build-time variables (baked into the frontend bundle) are passed as Docker `--build-arg`:

```bash
docker build \
  --build-arg VITE_API_URL=https://api.seladev.dev \
  --build-arg VITE_WS_URL=wss://api.seladev.dev \
  -t seladev/web:v1.2.3 \
  -f apps/web/Dockerfile .
```

Never pass `JWT_PRIVATE_KEY`, `MASTER_ENCRYPTION_KEY`, or other secrets as build args — they get baked into the image layers and appear in `docker history`.

---

## 7. Health Checks Per Container

| Container | Health Check Command | Interval | Start Period |
|---|---|---|---|
| `mongo` | `mongosh --eval "db.adminCommand('ping')"` | 10s | 20s |
| `redis` | `redis-cli ping` | 10s | 5s |
| `api` | `wget -qO- http://localhost:4000/health` | 30s | 15s |
| `worker` | Custom Node.js script checking BullMQ worker status | 30s | 20s |
| `web` | `wget -qO- http://localhost:80/health` | 30s | 5s |

The `api` health endpoint (`GET /health`) checks:

```typescript
// apps/api/src/shared/routes/health.routes.ts
router.get('/health', async (req, res) => {
  const mongoState = mongoose.connection.readyState; // 1 = connected
  const redisPing = await redisClient.ping();
  const healthy = mongoState === 1 && redisPing === 'PONG';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: {
      mongo: mongoState === 1 ? 'ok' : 'error',
      redis: redisPing === 'PONG' ? 'ok' : 'error',
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
```

`depends_on` with `condition: service_healthy` ensures the API and worker only start after MongoDB and Redis report healthy.

---

## 8. Volume Strategy

| Volume | Driver | Purpose | Backup Required |
|---|---|---|---|
| `mongo-data` | `local` | MongoDB data files | Yes — all application data |
| `redis-data` | `local` | Redis persistence (AOF) | Optional — BullMQ jobs can be requeued |

Named volumes (not bind mounts) are used for persistence. This avoids permission issues on Linux and makes volumes manageable independently of container lifecycle.

```bash
# List volumes
docker volume ls --filter name=seladev

# Backup mongo-data to a tar archive
docker run --rm \
  -v seladev_mongo-data:/data/db \
  -v $(pwd)/backups:/backups \
  alpine tar czf /backups/mongo-$(date +%Y%m%d).tar.gz /data/db
```

---

## 9. Network Isolation

```
┌─────────────────────────────────────────────────────┐
│               seladev-internal (bridge)              │
│                                                     │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────┐  │
│  │  api   │  │ worker │  │ mongo  │  │  redis   │  │
│  └────────┘  └────────┘  └────────┘  └──────────┘  │
│       ↑                                             │
│       │ (port 4000 exposed to host in dev)          │
│  ┌────────┐                                         │
│  │  web   │                                         │
│  └────────┘                                         │
│       ↑                                             │
│       │ (port 80 exposed to host / reverse proxy)   │
└─────────────────────────────────────────────────────┘
```

All services communicate on the internal `seladev-internal` bridge network using container names as hostnames (e.g., `redis://seladev-redis:6379`). `mongo` and `redis` do not expose ports externally in production — only `api` and `web` face external traffic, and only through a reverse proxy (Nginx or cloud load balancer).

---

## 10. `.dockerignore` Files

Every app has a `.dockerignore` to keep build contexts lean:

```dockerignore
# Root .dockerignore
node_modules
**/node_modules
.git
.gitignore
*.md
docs_project/
.env*
*.log
coverage/
dist/
.turbo/
.cache/
```

A smaller build context means faster `docker build` times and no accidental secret inclusion.

---

## 11. Local Development Workflow

### First-Time Setup

```bash
# 1. Clone the repository
git clone https://github.com/seladev/seladev.git && cd seladev

# 2. Copy environment template and fill in values
cp .env.example .env
# Edit .env — at minimum set MONGO_ROOT_PASS, REDIS_PASSWORD, JWT keys

# 3. Start infrastructure only (MongoDB + Redis)
docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  --profile infra-only up -d

# 4. Wait for MongoDB to be healthy
docker compose ps  # Check STATUS column shows "(healthy)"

# 5. Install dependencies
pnpm install

# 6. Run database seed (development data)
pnpm --filter @seladev/api db:seed

# 7. Start all apps in watch mode
pnpm dev
```

### Daily Development (Fastest Loop)

```bash
# Ensure infra is running
docker compose --profile infra-only up -d

# Start only the service you're working on
pnpm --filter @seladev/api dev
# or
pnpm --filter @seladev/web dev
```

### Full Stack in Docker (Integration Testing)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  --profile full up
```

### Resetting State

```bash
# Stop everything and remove volumes (full reset)
docker compose down -v

# Remove only application images (keep volumes)
docker compose down --rmi local
```

---

## 12. Production Differences

| Concern | Development | Production |
|---|---|---|
| Source volumes | Mounted (hot reload) | Not mounted |
| Node command | `tsx watch` / `nodemon` | `node dist/index.js` |
| Build stage | `deps` (dev) | `runner` (minimal) |
| Image size | ~600MB (with dev tools) | ~120MB (prod only) |
| Port exposure | All ports on host | Only `api:4000`, `web:80` |
| Restart policy | `no` (manual restart in dev) | `unless-stopped` |
| Resource limits | None | CPU/memory limits set |
| Log level | `debug` | `info` |
| Dev dependencies | Installed | Not installed (`--prod`) |

### Resource Limits (Production)

```yaml
# Production docker-compose.prod.yml additions
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped

  worker:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
    restart: unless-stopped

  mongo:
    deploy:
      resources:
        limits:
          memory: 2G
    restart: unless-stopped
```

---

## 13. Troubleshooting Common Issues

### MongoDB fails to start

```bash
# Check logs
docker compose logs mongo

# Common fix: stale lock file in named volume
docker compose down
docker volume rm seladev_mongo-data
docker compose up -d
```

### API cannot connect to MongoDB / Redis

```bash
# Verify health status
docker compose ps

# Check API sees correct env vars
docker compose exec api env | grep MONGODB_URI

# Ping from API container to mongo
docker compose exec api sh -c "ping -c 3 seladev-mongo"
```

### Hot reload not working

```bash
# Verify volume mounts in dev override
docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  config  # prints merged config — check volumes section

# Ensure polling is enabled for environments that don't support inotify
# (e.g., WSL2, Docker Desktop on macOS)
# In apps/api/.env:  CHOKIDAR_USEPOLLING=true
```

### Port already in use

```bash
# Find process using port 4000
lsof -i :4000
# Kill it or change port in .env: PORT=4001
```

### Container exits immediately

```bash
# Show last 50 log lines including exit reason
docker compose logs --tail=50 api

# Run container interactively for debugging
docker compose run --rm --entrypoint sh api
```

---

## Decisions

1. **Separate `worker` container** — The BullMQ worker runs in its own container, separate from the `api`. This is critical for production: the worker is CPU-intensive during deployments and must be scaled independently. Mixing them would cause job processing to starve API threads.

2. **Multi-stage builds** — The `runner` stage excludes devDependencies, source maps for non-debug builds, and TypeScript tooling. This cuts image size from ~600MB to ~120MB and eliminates attack surface (no `ts-node`, compiler, test frameworks in production images).

3. **`infra-only` profile** — The recommended dev mode runs MongoDB and Redis in Docker while keeping the API and web on the host. This gives sub-second hot reload compared to ~10s for Docker volume-mounted TypeScript compilation.

4. **Named volumes for persistence** — Bind-mounting MongoDB data (`./data/mongo:/data/db`) causes permission issues on Linux (MongoDB runs as uid 999). Named volumes handle permissions automatically.

## Tradeoffs

- **Docker Compose over Kubernetes in dev** — Kubernetes adds significant local complexity (minikube, kind, Helm). Docker Compose is sufficient for local and early production. The container architecture is Kubernetes-ready (stateless API/worker, external persistence), so migration is straightforward.
- **Nginx for web in production** — Vite's dev server is not production-safe (no caching, no compression). Nginx adds build complexity but is the correct choice for serving a production SPA.
- **`delegated` volume mount flag** — Trades strict consistency for performance on macOS Docker Desktop. Writes from the container may be slightly delayed to the host. Acceptable for dev; not used in production.

## Future Improvements

- **Kubernetes manifests** — `k8s/` directory with Deployment, Service, ConfigMap, and HorizontalPodAutoscaler resources per container.
- **Helm chart** — Parameterized chart for deploying SELADEV to managed Kubernetes clusters (EKS, GKE, AKS).
- **Docker BuildKit caching** — Enable `--cache-from` in CI to reuse layer cache across builds, cutting CI build time from ~4min to ~90s.
- **Distroless base images** — Replace `node:20-alpine` in the runner stage with `gcr.io/distroless/nodejs20` for a smaller, more secure final image (no shell, no package manager).
- **Secrets management** — Replace `.env` file injection with Docker secrets or AWS Secrets Manager for production credentials.
