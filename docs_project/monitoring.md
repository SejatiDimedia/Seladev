# Monitoring & Observability — SELADEV IDP

## Purpose

This document defines the observability strategy for the SELADEV Internal Developer Platform — covering how the system is instrumented, what signals are collected, how they surface to operators, and what thresholds trigger alerts. It is intended for:

- **Platform engineers** — instrumenting new services and understanding existing observability contracts
- **DevOps / SRE** — configuring dashboards, alert rules, and on-call playbooks
- **Engineering leads** — understanding operational risk and system health at a glance

This document complements:
- `system-design.md` — component boundaries and data flow
- `security.md` — audit log requirements and security event monitoring
- `performance.md` — latency targets and regression detection

---

## 1. Observability Pillars

SELADEV's observability strategy is built on the three pillars model:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         OBSERVABILITY PILLARS                             │
│                                                                           │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────┐ │
│  │      LOGS       │   │     METRICS     │   │        TRACES           │ │
│  │                 │   │                 │   │                         │ │
│  │ What happened   │   │ How the system  │   │ Why a specific request  │ │
│  │ and when        │   │ is behaving     │   │ was slow or failed      │ │
│  │                 │   │ over time       │   │                         │ │
│  │ Winston (JSON)  │   │ Custom counters │   │ OpenTelemetry (future)  │ │
│  │ Audit logs      │   │ Prometheus-     │   │ Distributed tracing     │ │
│  │ Request logs    │   │ compatible      │   │ across BullMQ + API     │ │
│  └─────────────────┘   └─────────────────┘   └─────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Each pillar answers a different class of question:
- **Logs** → "What exactly happened in this request?"
- **Metrics** → "Is the system healthy right now and over the past hour?"
- **Traces** → "Why did this specific user's request take 3 seconds?"

In the current architecture, Logs and Metrics are fully implemented. Distributed Tracing is planned for the OpenTelemetry integration phase (see §10).

---

## 2. Structured Logging

### 2.1 Log Format

All logs are emitted as **newline-delimited JSON** (NDJSON). Every log line contains a standardized set of fields:

```typescript
interface LogRecord {
  // Always present
  timestamp: string;      // ISO 8601: "2026-06-19T12:34:56.789Z"
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;        // Human-readable description

  // Request context (populated by request logging middleware)
  requestId?: string;     // UUID v4, propagated via X-Request-ID header
  method?: string;        // "GET", "POST", etc.
  path?: string;          // "/api/v1/projects/:projectId/secrets"
  status?: number;        // HTTP status code
  durationMs?: number;    // Request duration in milliseconds
  ip?: string;            // Client IP (from X-Forwarded-For)
  userAgent?: string;     // Truncated to 200 chars

  // Auth context (populated after JWT verification)
  userId?: string;        // MongoDB ObjectId string — never email or name
  orgId?: string;         // MongoDB ObjectId string

  // Error context (populated on exceptions)
  error?: {
    name: string;         // "ValidationError", "UnauthorizedError", etc.
    message: string;
    stack?: string;       // Only in development; omitted in production
    code?: string;        // App-level error code: "SECRET_NOT_FOUND"
  };

  // Service context
  service: string;        // "api", "worker", "notification"
  environment: string;    // "production", "staging", "development"
  version: string;        // App version from package.json
}
```

**Example log line (production):**
```json
{
  "timestamp": "2026-06-19T12:34:56.789Z",
  "level": "info",
  "message": "POST /api/v1/projects/abc123/secrets → 201",
  "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "method": "POST",
  "path": "/api/v1/projects/abc123/secrets",
  "status": 201,
  "durationMs": 87,
  "ip": "203.0.113.42",
  "userId": "64a1b2c3d4e5f6a7b8c9d0e1",
  "orgId": "64a1b2c3d4e5f6a7b8c9d0e2",
  "service": "api",
  "environment": "production",
  "version": "0.1.0"
}
```

### 2.2 Log Levels — When to Use Each

| Level | Use When | Example |
|-------|----------|---------|
| `debug` | Detailed diagnostic information useful during development | "Cache hit for RBAC check", "JWT claims decoded" |
| `info` | Normal operational events; key lifecycle events | "Request completed", "Job enqueued", "User logged in" |
| `warn` | Unexpected condition that the system recovered from | "Retry attempt 2/3 for webhook delivery", "Rate limit approaching threshold" |
| `error` | Operation failed; requires investigation | "Database query timed out", "Uncaught exception in worker" |

**Rules:**
- `debug` is **disabled in production** (`LOG_LEVEL=info` in production env)
- `info` logs must not occur in hot paths (e.g., per-iteration loop logs)
- `warn` implies an action may be needed but no SLA is breached
- `error` should trigger an alert if sustained (see §7 Alerting)

### 2.3 What NOT to Log

The following data categories are **explicitly forbidden** in log output. The logger is configured with a field sanitizer that removes them even if accidentally passed:

```typescript
const REDACTED_FIELDS = new Set([
  'password', 'passwordHash', 'currentPassword', 'newPassword',
  'secret', 'secretValue', 'encryptedValue',
  'token', 'accessToken', 'refreshToken', 'idToken',
  'apiKey', 'rawKey', 'keyHash',
  'totpSecret', 'mfaSecret', 'backupCode',
  'signingSecret', 'webhookSecret',
  'creditCard', 'ssn', 'dob',
]);

function sanitizeLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      REDACTED_FIELDS.has(key.toLowerCase()) ? '[REDACTED]' : value,
    ])
  );
}
```

**PII rules:**
- Log `userId` (opaque ID) — do NOT log user's email, name, or phone number in standard request logs
- Log `orgId` — do NOT log org name in high-frequency logs
- Log request `path` with path params (e.g., `/projects/abc123`) — path params are IDs, not PII
- Do NOT log request body contents in production (contain user data)

### 2.4 Winston Configuration

```typescript
// apps/api/src/lib/logger.ts
import winston from 'winston';

const { combine, timestamp, json, errors } = winston.format;

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    errors({ stack: process.env.NODE_ENV === 'development' }),
    timestamp(),
    json()
  ),
  defaultMeta: {
    service: 'api',
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version,
  },
  transports: [
    new winston.transports.Console(),
    // In production: pipe console output to log aggregator (CloudWatch, Datadog)
  ],
});

// Child logger with request context — created per-request in middleware
export function requestLogger(requestId: string, userId?: string, orgId?: string) {
  return logger.child({ requestId, userId, orgId });
}
```

---

## 3. Request Logging Middleware

Every HTTP request is logged, before and after handling:

```typescript
// apps/api/src/middleware/requestLogger.middleware.ts
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
  const startTime = process.hrtime.bigint();

  // Attach requestId to request and response
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Log on response finish (not on incoming request, to avoid double logging)
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    logger.info(`${req.method} ${req.path} → ${res.statusCode}`, {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip ?? req.headers['x-forwarded-for'],
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 200),
      userId: req.user?.id,
      orgId: req.user?.orgId,
    });
  });

  next();
}
```

**Request ID propagation:**
- If the client sends `X-Request-ID`, it is used (useful for tracing from the browser)
- Otherwise a new UUID is generated
- The ID is returned in the response `X-Request-ID` header
- The ID is attached to `req.requestId` for use in downstream logs within the same request

---

## 4. Health Check Endpoints

### 4.1 Liveness Check — `GET /health`

Returns the basic liveness status and the health of critical dependencies.

```typescript
// Response schema
interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;        // seconds
  timestamp: string;     // ISO 8601
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    workers: 'ok' | 'error';
  };
}
```

**Example — healthy:**
```json
{
  "status": "ok",
  "uptime": 86400,
  "timestamp": "2026-06-19T12:00:00.000Z",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "workers": "ok"
  }
}
```

**Example — degraded (Redis down):**
```json
{
  "status": "degraded",
  "uptime": 86400,
  "timestamp": "2026-06-19T12:00:00.000Z",
  "checks": {
    "database": "ok",
    "redis": "error",
    "workers": "ok"
  }
}
```

Health check implementation:

```typescript
router.get('/health', async (req, res) => {
  const checks = await Promise.allSettled([
    mongoose.connection.db.admin().ping(),
    redis.ping(),
    checkWorkerQueue(),
  ]);

  const results = {
    database: checks[0].status === 'fulfilled' ? 'ok' : 'error',
    redis: checks[1].status === 'fulfilled' ? 'ok' : 'error',
    workers: checks[2].status === 'fulfilled' ? 'ok' : 'error',
  };

  const allOk = Object.values(results).every(v => v === 'ok');
  const anyOk = Object.values(results).some(v => v === 'ok');

  res.status(allOk ? 200 : anyOk ? 207 : 503).json({
    status: allOk ? 'ok' : anyOk ? 'degraded' : 'down',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: results,
  });
});
```

### 4.2 Readiness Check — `GET /health/ready`

Used by Kubernetes/Docker to determine if the instance should receive traffic:

```typescript
router.get('/health/ready', async (req, res) => {
  // Ready only when MongoDB and Redis are reachable
  const [db, cache] = await Promise.allSettled([
    mongoose.connection.db.admin().ping(),
    redis.ping(),
  ]);
  const ready = db.status === 'fulfilled' && cache.status === 'fulfilled';
  res.status(ready ? 200 : 503).json({ ready });
});
```

**Liveness vs Readiness:**
- **Liveness** (`/health`) — Is the process alive? Failures here trigger container restart.
- **Readiness** (`/health/ready`) — Should this instance receive traffic? Failures here remove it from the load balancer pool without restarting.

---

## 5. Performance Metrics to Track

### 5.1 API Latency

Track p50, p95, and p99 latency per endpoint group:

| Endpoint Group | p50 Target | p95 Target | p99 Target |
|----------------|-----------|-----------|-----------|
| Auth (login, refresh) | < 200ms | < 500ms | < 1000ms |
| Secret CRUD | < 100ms | < 300ms | < 600ms |
| Deployment triggers | < 150ms | < 400ms | < 800ms |
| Audit log queries | < 200ms | < 600ms | < 1200ms |
| Webhook management | < 100ms | < 300ms | < 600ms |

Implementation: Record response duration in request logging middleware (see §3). Aggregate using histogram buckets in the metrics layer.

### 5.2 MongoDB Query Latency

Enable MongoDB's slow query log:

```javascript
// Enable profiler for queries > 100ms
db.setProfilingLevel(1, { slowms: 100 });
```

Track per-collection:
- `system.profile` entries with `millis > 100`
- Missing index warnings (`COLLSCAN` in explain output)
- Lock wait time (`waitingForLock`)

### 5.3 BullMQ Queue Metrics

```typescript
interface QueueMetrics {
  queueName: string;
  waiting: number;     // Jobs waiting to be processed
  active: number;      // Jobs currently being processed
  completed: number;   // Jobs completed in last hour
  failed: number;      // Jobs failed in last hour
  delayed: number;     // Jobs scheduled for future execution
  avgProcessingMs: number;  // Moving average job duration
}
```

Queues to monitor:

| Queue | Expected Depth | Alert Threshold | Alert Reason |
|-------|---------------|-----------------|-------------|
| `deployments` | 0–10 | > 50 | Worker backlog |
| `webhooks` | 0–20 | > 100 | Delivery failures or surge |
| `notifications` | 0–50 | > 200 | Email/socket delivery lag |
| `audit-log-writes` | 0–100 | > 500 | DB write bottleneck |

### 5.4 Socket.IO Connection Count

```typescript
// Track active Socket.IO connections
io.on('connection', (socket) => {
  metrics.gauge('socketio.connections.active', io.engine.clientsCount);
  socket.on('disconnect', () => {
    metrics.gauge('socketio.connections.active', io.engine.clientsCount);
  });
});
```

Alert threshold: > 10,000 concurrent connections (signals need for horizontal scaling or connection draining).

---

## 6. Error Rate Monitoring

### 6.1 HTTP 5xx Rate

Track the percentage of requests resulting in 5xx responses over a 5-minute rolling window:

```
5xx Rate = (count of status >= 500) / (total requests) * 100
```

| Threshold | Action |
|-----------|--------|
| > 1% over 5 min | WARN alert — investigate |
| > 5% over 5 min | CRITICAL alert — wake on-call |
| > 10% over 2 min | P0 incident — all hands |

### 6.2 Authentication Failure Rate

Track `auth.login.failure` events from the audit log:

```
Auth Failure Rate = failures / (successes + failures) * 100
```

A spike in auth failures (> 20% over 10 minutes) indicates a credential stuffing attack or misconfigured client. This triggers the rate limiter alert and escalates to the security team.

### 6.3 Unhandled Exception Rate

Any uncaught error that reaches the global error handler increments `api.unhandled_errors.count`. More than 5 unhandled exceptions per minute indicates a regression (likely from a recent deployment).

---

## 7. Alerting Thresholds

All alerts follow a standard format: **Condition → Severity → Action**

| Alert Name | Condition | Severity | Action |
|-----------|-----------|----------|--------|
| High 5xx Rate | > 5% of requests return 5xx for 5 min | CRITICAL | Page on-call engineer |
| Auth Failure Spike | > 20% auth failure rate for 10 min | HIGH | Alert security team |
| Queue Backlog — Deployments | `deployments` queue depth > 50 | HIGH | Alert platform team |
| Queue Backlog — Webhooks | `webhooks` queue depth > 100 | MEDIUM | Alert platform team |
| Slow DB Queries | > 10 queries/min with `millis > 500` | MEDIUM | Alert DB admin |
| Redis Memory Usage | Redis memory > 80% of `maxmemory` | HIGH | Alert infra team |
| Redis Connection Failure | `/health` shows `redis: error` | CRITICAL | Page on-call engineer |
| MongoDB Connection Failure | `/health` shows `database: error` | CRITICAL | Page on-call engineer |
| Worker Process Crash | BullMQ worker disconnected unexpectedly | HIGH | Alert platform team |
| SSL Certificate Expiry | Certificate expires in < 14 days | HIGH | Alert infra team |
| API p99 Latency | p99 latency > 2000ms for any endpoint group for 10 min | MEDIUM | Alert platform team |
| Unhandled Exceptions | > 5 unhandled exceptions/min | HIGH | Alert platform team |

### 7.1 Alert Routing

```
CRITICAL → PagerDuty → On-call engineer (15 min SLA to acknowledge)
HIGH     → Slack #alerts-high → On-call engineer (1 hour response SLA)
MEDIUM   → Slack #alerts-medium → Team channel (next business day)
LOW      → Slack #alerts-low → Weekly review
```

---

## 8. BullMQ Monitoring

### 8.1 BullMQ Board

Deploy **BullMQ Board** (or Bull Board) as an internal-only dashboard:

```typescript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/internal/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(deploymentQueue),
    new BullMQAdapter(webhookQueue),
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(auditLogQueue),
  ],
  serverAdapter,
});

// Mount ONLY on internal network / behind IP allowlist
app.use('/internal/queues', ipAllowlist, serverAdapter.getRouter());
```

**Visible metrics per queue:**
- Job counts by state (waiting, active, completed, failed, delayed)
- Job detail: payload, attempts, error stack, processing time
- Failed job retry controls
- Queue pause/resume (emergency use only)

### 8.2 Job Success/Failure Rates

Track per-queue over 1-hour rolling windows:

```typescript
// In worker completion handlers
worker.on('completed', (job) => {
  metrics.increment(`bullmq.${job.queueName}.completed`);
  metrics.histogram(`bullmq.${job.queueName}.duration_ms`, job.processedOn! - job.timestamp);
});

worker.on('failed', (job, error) => {
  metrics.increment(`bullmq.${job?.queueName}.failed`);
  logger.error('Job failed', {
    queueName: job?.queueName,
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: { name: error.name, message: error.message },
  });
});
```

**Failure rate alert:** If any queue's failure rate exceeds 10% over 15 minutes, alert the platform team.

---

## 9. MongoDB Monitoring

### 9.1 Atlas Metrics (if using MongoDB Atlas)

Key metrics to watch in the Atlas dashboard:

| Metric | Warning Threshold | Critical Threshold |
|--------|------------------|-------------------|
| Connections | > 70% of `maxConns` | > 90% of `maxConns` |
| Opcounters (query/s) | Baseline + 3σ | Baseline + 5σ |
| Page faults | > 100/s | > 500/s |
| Query targeting ratio | > 10 (scanned:returned) | > 100 |
| Replication lag | > 10s | > 60s |
| Disk IOPS | > 80% of provisioned | > 95% of provisioned |

### 9.2 Slow Query Detection

Log all queries slower than 100ms with `explain()` output:

```typescript
// Mongoose plugin for slow query logging
mongoose.plugin((schema) => {
  schema.pre('find', function () {
    this._startTime = Date.now();
  });
  schema.post('find', function (docs, next) {
    const duration = Date.now() - (this as any)._startTime;
    if (duration > 100) {
      logger.warn('Slow MongoDB query detected', {
        collection: this.model.collection.name,
        filter: JSON.stringify(this.getFilter()),
        durationMs: duration,
      });
    }
    next();
  });
});
```

### 9.3 Index Usage Validation

Run monthly to detect unused or missing indexes:

```javascript
// MongoDB shell — find collections with COLLSCAN operations
db.system.profile.aggregate([
  { $match: { op: 'query', 'planSummary': /COLLSCAN/ } },
  { $group: { _id: '$ns', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);
```

---

## 10. Redis Monitoring

### 10.1 Key Metrics

```bash
# Redis INFO command — key metrics
redis-cli INFO stats | grep -E 'total_commands_processed|keyspace_hits|keyspace_misses'
redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|mem_fragmentation_ratio'
redis-cli INFO clients | grep -E 'connected_clients|blocked_clients'
```

| Metric | Warning | Critical |
|--------|---------|----------|
| `used_memory` | > 75% of `maxmemory` | > 90% of `maxmemory` |
| Cache hit rate | < 80% | < 60% |
| Connected clients | > 100 | > 500 |
| `mem_fragmentation_ratio` | > 1.5 | > 2.0 |

### 10.2 Cache Hit Rate

```
Hit Rate = keyspace_hits / (keyspace_hits + keyspace_misses) * 100
```

A hit rate below 80% for the RBAC cache suggests the cache TTL is too short or cache keys are not being reused efficiently. Check key naming patterns.

### 10.3 Eviction Policy

Redis is configured with `maxmemory-policy allkeys-lru`. This means under memory pressure, the least-recently-used keys are evicted first. Since all rate limit and blocklist entries have explicit TTLs, eviction of aged entries is acceptable. Monitor evicted key count to detect memory pressure.

---

## 11. Dashboard Design

### 11.1 Operations Dashboard — "30-Second Glance"

A DevOps engineer opening the dashboard at 3 AM needs to assess system health in 30 seconds. The dashboard is organized into three rows:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ROW 1 — SYSTEM STATUS (RAG indicators)                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ API      │ │ MongoDB  │ │  Redis   │ │ Workers  │ │ Socket   │ │
│  │  ✅ OK   │ │  ✅ OK   │ │  ✅ OK   │ │  ✅ OK   │ │  ✅ OK   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  ROW 2 — TRAFFIC & LATENCY (last 1 hour)                           │
│  ┌──────────────────────┐ ┌──────────────────────────────────────┐ │
│  │ Request Rate (req/s) │ │ Latency p50 / p95 / p99             │ │
│  │ [timeseries chart]   │ │ [timeseries chart per endpoint]      │ │
│  └──────────────────────┘ └──────────────────────────────────────┘ │
│  ┌──────────────────────┐ ┌──────────────────────────────────────┐ │
│  │ 5xx Rate (%)         │ │ Auth Failure Rate (%)               │ │
│  │ [area chart]         │ │ [area chart]                         │ │
│  └──────────────────────┘ └──────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  ROW 3 — INFRASTRUCTURE SATURATION                                 │
│  ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────┐  │
│  │ Queue Depths     │ │ Redis Memory     │ │ MongoDB Ops/sec   │  │
│  │ deployments: 3   │ │ 42% used         │ │ reads: 450/s      │  │
│  │ webhooks: 12     │ │ hit rate: 94%    │ │ writes: 120/s     │  │
│  │ notifications: 8 │ │                  │ │ slow queries: 0   │  │
│  └──────────────────┘ └──────────────────┘ └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.2 Security Dashboard (separate view)

- Auth failure rate over time (login + token errors)
- Top IPs by rate limit hits (potential attackers)
- Audit log event stream (real-time table)
- Active session count per org (anomaly detection)

### 11.3 Business Dashboard (for product team)

- New users registered (daily/weekly)
- Deployments triggered (by org)
- Secrets created/rotated (vault usage)
- Webhook delivery success rate
- API key usage by org

---

## 12. Log Retention Policy

| Environment | Hot Storage (searchable) | Cold Storage (archive) |
|-------------|--------------------------|------------------------|
| Production | 30 days | 1 year |
| Staging | 7 days | 30 days |
| Development | Local only | Not archived |

**Audit logs** are retained for **7 years** in cold storage regardless of environment, for compliance purposes. Audit logs are immutable (no delete path in the application). Cold storage: AWS S3 Glacier or equivalent.

---

## 13. Future Improvements

### 13.1 OpenTelemetry Integration

Replace manual request timing and custom metrics with **OpenTelemetry SDK**:

```typescript
// Future: Auto-instrumentation
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

This adds distributed tracing across Express → BullMQ → MongoDB → Redis with zero manual instrumentation overhead.

### 13.2 Grafana + Prometheus

Move from ad-hoc metrics to a **Prometheus + Grafana** stack:
- Expose `/metrics` endpoint with Prometheus-formatted metrics
- Pre-built dashboards for Node.js (process metrics), MongoDB, Redis, BullMQ
- Alert rules in Prometheus AlertManager
- Grafana for visualization and on-call dashboards

### 13.3 Datadog APM

For production SaaS, **Datadog APM** provides:
- Automatic distributed tracing across all services
- Live tail log search
- Anomaly detection with ML-powered alerts
- SLO tracking per service
- Integration with PagerDuty for alert routing

### 13.4 Log Aggregation

In production, stdout logs should pipe to a log aggregator:
- **AWS CloudWatch Logs** — if running on ECS/EC2
- **Datadog Logs** — unified with APM traces
- **Loki + Grafana** — open-source self-hosted option

Configure structured log forwarding:
```json
// CloudWatch Log Group: /seladev/api/production
// Retention: 30 days
// Metric filters for 5xx rate, auth failures
```

---

*Document version: 1.0 | Last updated: 2026-06-19 | Owner: Platform Engineering*
