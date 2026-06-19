# Performance Design — SELADEV IDP

## Purpose

This document defines the performance strategy, targets, optimization patterns, and load testing approach for the SELADEV Internal Developer Platform. It is intended for:

- **Backend engineers** — understanding acceptable patterns and anti-patterns for database access, caching, and async work
- **Frontend engineers** — understanding bundle budget, caching strategy, and Core Web Vitals targets
- **DevOps / SRE** — load testing, monitoring for regressions, and capacity planning

This document complements:
- `database-design.md` — index strategy and schema design decisions
- `monitoring.md` — latency tracking, alerting thresholds, and observability
- `system-design.md` — component boundaries and data flow

---

## 1. Performance Philosophy

**Measure first. Optimize second.**

Premature optimization is the source of much engineering waste. SELADEV's performance process follows this sequence:

```
1. Define targets  →  2. Measure baseline  →  3. Identify bottlenecks
→  4. Optimize bottleneck  →  5. Measure gain  →  6. Repeat
```

Optimization decisions require:
- A benchmark showing the problem (not intuition)
- A benchmark showing the fix worked
- A test that prevents regression

**Anti-patterns explicitly forbidden:**
- Adding a Redis cache because "it might be slow" without a measured baseline
- Denormalizing MongoDB documents without a profiler trace showing a join bottleneck
- Removing an abstraction layer "for performance" without proving the layer is on the hot path

---

## 2. Performance Targets (SLA)

### 2.1 API Endpoint Latency Targets (p99, production, measured at API gateway)

| Endpoint Category | p50 | p95 | p99 |
|-------------------|-----|-----|-----|
| Auth (login, refresh, logout) | 150ms | 400ms | 800ms |
| Secret read (single) | 60ms | 150ms | 300ms |
| Secret list (paginated) | 80ms | 200ms | 400ms |
| Project CRUD | 50ms | 150ms | 300ms |
| Deployment trigger | 100ms | 300ms | 600ms |
| Deployment status poll | 30ms | 80ms | 150ms |
| Audit log query (paginated) | 100ms | 400ms | 800ms |
| Webhook management | 50ms | 150ms | 300ms |
| Analytics queries | 200ms | 600ms | 1200ms |
| Health check (`/health`) | 10ms | 30ms | 60ms |

### 2.2 Background Job Processing Targets

| Job Type | Expected Duration | Alert Threshold |
|----------|------------------|-----------------|
| Deployment simulation | 5–30s | > 120s |
| Webhook delivery | < 5s | > 30s |
| Email notification | < 10s | > 60s |
| Audit log write | < 50ms | > 500ms |

### 2.3 Frontend Core Web Vitals Targets

| Metric | Target | Definition |
|--------|--------|------------|
| **LCP** (Largest Contentful Paint) | < 2.5s | Time until largest visible element loads |
| **INP** (Interaction to Next Paint) | < 200ms | Worst interaction latency in a session |
| **CLS** (Cumulative Layout Shift) | < 0.1 | Unexpected layout shifts during load |
| **TTFB** (Time to First Byte) | < 800ms | Server response time |
| **Bundle size (initial)** | < 200KB gzip | JS loaded before first interaction |

---

## 3. Backend Performance

### 3.1 Database Query Optimization

SELADEV's index strategy is defined in `database-design.md`. Here, the enforcement rules:

**Rule 1: Every query must use an index.**

Before merging any new repository method, run `explain()` and verify `IXSCAN` (not `COLLSCAN`):

```typescript
// Development assertion — ensure index usage
if (process.env.NODE_ENV === 'development') {
  const explanation = await Model.find(filter).explain('executionStats');
  const stage = explanation.executionStats.executionStages;
  if (stage.stage === 'COLLSCAN') {
    console.warn(`⚠️  COLLSCAN detected on ${Model.collection.name}:`, filter);
  }
}
```

**Rule 2: Compound index field order matches query selectivity.**

Most-selective field first in compound indexes:

```typescript
// Correct: orgId first (high selectivity partition), then createdAt for range
secretSchema.index({ orgId: 1, createdAt: -1 });

// Wrong: createdAt first causes near-full collection scan per org
// secretSchema.index({ createdAt: -1, orgId: 1 });
```

**Rule 3: Use projection to fetch only needed fields.**

```typescript
// Fetch only fields needed for the list view — not full documents
async listSecretsMeta(orgId: string, projectId: string): Promise<SecretMeta[]> {
  return SecretModel.find(
    { orgId, projectId },
    { name: 1, environment: 1, createdAt: 1, updatedAt: 1 } // value excluded
  ).lean(); // .lean() skips Mongoose document hydration — 2-5x faster for reads
}
```

**Rule 4: Use `.lean()` for read-only queries.**

Mongoose's document hydration (converting raw BSON to a Mongoose Document with methods and virtuals) adds 20–50% overhead on large result sets. Use `.lean()` on all repository read methods that do not need Mongoose document methods.

### 3.2 N+1 Query Prevention

N+1 queries — where a list query triggers one additional query per item — are a common MongoDB performance trap.

**Anti-pattern (N+1):**
```typescript
// ❌ BAD — 1 query for deployments + N queries for project details
const deployments = await DeploymentModel.find({ orgId });
const results = await Promise.all(
  deployments.map(d => ProjectModel.findById(d.projectId)) // N queries
);
```

**Correct pattern (batch fetch):**
```typescript
// ✅ GOOD — 2 queries total, regardless of N
const deployments = await DeploymentModel.find({ orgId }).lean();
const projectIds = [...new Set(deployments.map(d => d.projectId.toString()))];
const projects = await ProjectModel.find({ _id: { $in: projectIds } }).lean();
const projectMap = new Map(projects.map(p => [p._id.toString(), p]));
const results = deployments.map(d => ({
  ...d,
  project: projectMap.get(d.projectId.toString()),
}));
```

**Repository batch methods:**

Every repository exposes `findByIds(ids: string[], orgId: string)` for batch fetching:

```typescript
async findByIds(ids: string[], orgId: string): Promise<Secret[]> {
  return SecretModel.find({ _id: { $in: ids }, orgId }).lean();
}
```

### 3.3 Redis Caching Strategy

Redis is used for two caching purposes: **RBAC permission caching** and **idempotency key storage**. It is not used as a general application cache (avoid caching business data that can become stale without clear invalidation triggers).

**RBAC Cache:**

Checking a user's org role and project permissions on every request would require 1–2 DB queries per request on hot paths. RBAC results are cached in Redis:

```typescript
interface RbacCacheEntry {
  orgRole: OrgRole;
  projectRoles: Record<string, ProjectRole>; // projectId → role
  cachedAt: number;
}

const RBAC_CACHE_TTL_SEC = 300; // 5 minutes

async function getRbacFromCache(userId: string, orgId: string): Promise<RbacCacheEntry | null> {
  const key = `rbac:${orgId}:${userId}`;
  const cached = await redis.get(key);
  return cached ? JSON.parse(cached) : null;
}

async function setRbacCache(userId: string, orgId: string, entry: RbacCacheEntry): Promise<void> {
  const key = `rbac:${orgId}:${userId}`;
  await redis.set(key, JSON.stringify(entry), 'EX', RBAC_CACHE_TTL_SEC);
}

// Invalidate on role change
async function invalidateRbacCache(userId: string, orgId: string): Promise<void> {
  await redis.del(`rbac:${orgId}:${userId}`);
}
```

This reduces RBAC-related DB queries from ~2 per request to ~0.003 per request (cache miss rate at 5-min TTL with 10-min average session activity).

**Idempotency Cache:**

Prevents duplicate processing of retried API requests:

```typescript
// Key: idempotency-key header value (client-provided UUID)
// Value: cached response (status + body)
// TTL: 24 hours

async function getIdempotentResponse(key: string): Promise<CachedResponse | null> {
  const cached = await redis.get(`idem:${key}`);
  return cached ? JSON.parse(cached) : null;
}
```

### 3.4 BullMQ Backpressure Handling

Prevent BullMQ queues from growing unboundedly under load:

```typescript
// Worker concurrency limits — tune per worker capability
const deploymentWorker = new Worker('deployments', processDeployment, {
  connection: redisConnection,
  concurrency: 5,       // Max parallel jobs per worker instance
  limiter: {
    max: 10,            // Max 10 jobs per duration
    duration: 1000,     // Per 1000ms
  },
});

// Queue-level job limits — shed load when queue is full
const deploymentQueue = new Queue('deployments', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,  // Keep last 100 completed jobs for debugging
    removeOnFail: 500,      // Keep last 500 failed jobs for investigation
  },
});
```

**Backpressure signal:** If the `deployments` queue depth exceeds 100 (alert threshold: 50), the API returns `503 Service Unavailable` for new deployment requests rather than enqueueing into an unbounded backlog:

```typescript
async function enqueueDeployment(payload: DeploymentPayload): Promise<Job> {
  const queueSize = await deploymentQueue.getWaitingCount();
  if (queueSize > 100) {
    throw new ServiceUnavailableError('Deployment queue is at capacity. Retry shortly.');
  }
  return deploymentQueue.add('deploy', payload);
}
```

### 3.5 Node.js Event Loop Blocking Prevention

The Node.js event loop must never block. Any synchronous operation that takes more than 1ms on a hot path is a candidate for removal.

**Banned patterns in request handlers:**

```typescript
// ❌ NEVER — synchronous filesystem operations in a route handler
const config = fs.readFileSync('/etc/seladev/config.json');

// ❌ NEVER — CPU-heavy synchronous work in a route handler
const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');

// ❌ NEVER — JSON.parse on untrusted large payloads (blocks for large inputs)
const data = JSON.parse(hugeUntrustedString);
```

**Correct patterns:**

```typescript
// ✅ Async filesystem access
const config = await fs.promises.readFile('/etc/seladev/config.json');

// ✅ Async bcrypt (bcrypt.hash runs in thread pool — does not block event loop)
const hash = await bcrypt.hash(password, 12);

// ✅ Stream large JSON instead of loading into memory
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
```

**Monitor event loop lag:**

```typescript
// Warning if event loop lag > 100ms
let lastCheck = Date.now();
setInterval(() => {
  const lag = Date.now() - lastCheck - 100;
  if (lag > 100) {
    logger.warn('Event loop lag detected', { lagMs: lag });
    metrics.histogram('nodejs.eventloop.lag_ms', lag);
  }
  lastCheck = Date.now();
}, 100);
```

### 3.6 Streaming for Large Datasets

Audit logs and deployment logs can be large. Never load them entirely into memory.

**MongoDB cursor streaming:**

```typescript
// Stream audit logs to response — avoids loading all documents into RAM
router.get('/audit-logs/export', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  const cursor = AuditLogModel
    .find({ orgId: req.user.orgId })
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean()
    .cursor();

  for await (const doc of cursor) {
    res.write(JSON.stringify(doc) + '\n');
  }

  res.end();
});
```

**Paginated streaming for the API:** Standard endpoints use cursor-based pagination (see §5.1) rather than offset, which degrades at high offsets.

---

## 4. Frontend Performance

### 4.1 Bundle Splitting

The React application uses **route-level lazy imports** to split the bundle. Only the code for the current route is loaded initially:

```typescript
// apps/web/src/router/index.tsx
import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const SecretsPage = lazy(() => import('@/pages/Secrets'));
const DeploymentsPage = lazy(() => import('@/pages/Deployments'));
const AuditLogsPage = lazy(() => import('@/pages/AuditLogs'));
const AnalyticsPage = lazy(() => import('@/pages/Analytics'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

export const router = createBrowserRouter([
  {
    path: '/dashboard',
    element: <Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>,
  },
  // ... other routes
]);
```

**Bundle budget:**

| Chunk | Max Size (gzip) |
|-------|----------------|
| Initial (auth + layout) | 80KB |
| Dashboard chunk | 40KB |
| Secrets chunk | 35KB |
| Deployments chunk | 35KB |
| Audit Logs chunk | 30KB |
| Analytics chunk | 60KB (charting lib) |
| Total initial load | < 200KB |

Bundle size is enforced in CI using `vite-bundle-analyzer` and a size budget check:

```json
// vite.config.ts — rollupOptions
{
  "output": {
    "manualChunks": {
      "vendor-react": ["react", "react-dom", "react-router-dom"],
      "vendor-query": ["@tanstack/react-query"],
      "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"]
    }
  }
}
```

### 4.2 TanStack Query Caching Strategy

Cache duration (staleTime) is calibrated per data type based on how frequently it changes and how costly a stale read is:

```typescript
// apps/web/src/lib/queryConfig.ts

// Data that changes rarely — org settings, project list
export const STATIC_QUERY_CONFIG = {
  staleTime: 5 * 60 * 1000,   // 5 minutes
  gcTime: 30 * 60 * 1000,     // 30 minutes
};

// Data that changes on user action — secrets, members
export const INTERACTIVE_QUERY_CONFIG = {
  staleTime: 30 * 1000,        // 30 seconds
  gcTime: 5 * 60 * 1000,       // 5 minutes
};

// Real-time data — deployment status, notification count
export const REALTIME_QUERY_CONFIG = {
  staleTime: 0,                 // Always fresh (supplemented by Socket.IO)
  gcTime: 60 * 1000,            // 1 minute
  refetchInterval: 5000,        // Polling fallback if socket unavailable
};

// Audit logs — append-only, old entries don't change
export const AUDIT_LOG_QUERY_CONFIG = {
  staleTime: 2 * 60 * 1000,    // 2 minutes
  gcTime: 10 * 60 * 1000,      // 10 minutes
};
```

**Optimistic updates** for instant UI feedback on mutations:

```typescript
useMutation({
  mutationFn: createSecret,
  onMutate: async (newSecret) => {
    await queryClient.cancelQueries({ queryKey: ['secrets', projectId] });
    const previous = queryClient.getQueryData(['secrets', projectId]);
    queryClient.setQueryData(['secrets', projectId], (old) => [...old, newSecret]);
    return { previous }; // snapshot for rollback
  },
  onError: (err, newSecret, context) => {
    queryClient.setQueryData(['secrets', projectId], context.previous); // rollback
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['secrets', projectId] });
  },
});
```

### 4.3 Virtual List Rendering

Long lists (audit logs, deployment history, secret lists) use **virtual rendering** via `@tanstack/react-virtual` to render only the visible rows:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function AuditLogTable({ logs }: { logs: AuditLog[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56, // row height in px
    overscan: 10,           // Render 10 extra rows above/below viewport
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => (
          <div
            key={logs[item.index].id}
            style={{ transform: `translateY(${item.start}px)`, position: 'absolute' }}
          >
            <AuditLogRow log={logs[item.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

This renders ~15 DOM nodes instead of thousands, regardless of list length. Required for audit log pages that may load 1,000+ entries.

### 4.4 Image Optimization

User avatars and organization logos are served from a CDN with `srcSet` for responsive images:

```tsx
<img
  src={`${CDN_URL}/avatars/${userId}?w=40`}
  srcSet={`
    ${CDN_URL}/avatars/${userId}?w=40 1x,
    ${CDN_URL}/avatars/${userId}?w=80 2x,
    ${CDN_URL}/avatars/${userId}?w=120 3x
  `}
  width={40}
  height={40}
  alt={`${userName} avatar`}
  loading="lazy"
  decoding="async"
/>
```

**Fallback:** If no avatar exists, a deterministic generated avatar (e.g., DiceBear API or initials-based SVG) is used. No broken image states.

---

## 5. API Response Optimization

### 5.1 Cursor Pagination for Time-Series Data

Offset pagination (`SKIP N`) degrades at large offsets in MongoDB — it still scans N documents before returning results. Cursor pagination is used for all time-series collections (audit logs, deployments, notifications):

```typescript
// Request: GET /api/v1/audit-logs?limit=50&cursor=<base64-encoded-cursor>

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;   // Base64-encoded { _id, createdAt } of last item
    limit: number;
    total?: number;              // Omitted for large collections (expensive to count)
  };
}

// Repository implementation
async listAuditLogs(orgId: string, limit: number, cursor?: string) {
  const filter: FilterQuery<AuditLog> = { orgId };

  if (cursor) {
    const { _id, createdAt } = decodeCursor(cursor);
    // Fetch documents older than the cursor
    filter.$or = [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: _id } },
    ];
  }

  const docs = await AuditLogModel
    .find(filter, { actor: 1, action: 1, resource: 1, createdAt: 1 })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1) // Fetch one extra to determine hasMore
    .lean();

  const hasMore = docs.length > limit;
  const results = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? encodeCursor(results[results.length - 1]) : null;

  return { data: results, pagination: { hasMore, nextCursor, limit } };
}
```

Performance characteristic: O(log n) regardless of how deep into the list the cursor is, because the `{ createdAt, _id }` index is used for the comparison.

### 5.2 Field Projection in MongoDB

Only fetch fields required for the response:

```typescript
// Secret list — exclude encrypted value (not needed, large, and security-sensitive)
const LIST_PROJECTION = { name: 1, environment: 1, createdAt: 1, updatedAt: 1, _id: 1 };
// Secret detail — include encrypted value (for display/copy after decrypt)
const DETAIL_PROJECTION = { name: 1, environment: 1, value: 1, iv: 1, authTag: 1, createdAt: 1 };
```

Projection rules are constants at the repository level, not passed from the route handler. This prevents accidental over-fetching from being introduced in controller code.

### 5.3 Response Compression

All API responses are compressed with **gzip** via the `compression` middleware:

```typescript
import compression from 'compression';

app.use(compression({
  level: 6,          // Balance between CPU and compression ratio
  threshold: 1024,   // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));
```

**Impact:** JSON responses for audit log lists (100 items) compress from ~15KB to ~3KB (5:1 ratio). The CPU cost is negligible on modern hardware.

### 5.4 ETags for Cacheable Resources

Resources that change infrequently support **ETags** to allow clients to avoid re-downloading unchanged data:

```typescript
import etag from 'etag';

// GET /api/v1/projects/:projectId (project details — changes rarely)
router.get('/:projectId', requireAuth, async (req, res) => {
  const project = await projectService.getProject(req.params.projectId, req.user.orgId);
  const tag = etag(JSON.stringify(project));

  if (req.headers['if-none-match'] === tag) {
    return res.status(304).end(); // Not Modified — save bandwidth
  }

  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', 'private, max-age=60'); // 1-minute browser cache
  res.json(project);
});
```

ETags are appropriate for project details, org settings, and user profile. They are **not** used for secrets (security risk if a client caches a secret after rotation) or audit logs (always fresh).

---

## 6. Load Testing Approach

### 6.1 k6 Test Scripts for Critical Paths

Load tests are maintained in `tests/load/` and run against the staging environment.

**Critical path 1 — Auth flow:**
```javascript
// tests/load/auth.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp up to 50 users
    { duration: '60s', target: 50 },   // Hold
    { duration: '30s', target: 100 },  // Ramp to 100
    { duration: '60s', target: 100 },  // Hold
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400', 'p(99)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const loginRes = http.post(`${__ENV.BASE_URL}/api/v1/auth/login`, JSON.stringify({
    email: 'loadtest@seladev.dev',
    password: 'LoadTest123!',
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'has accessToken': (r) => r.json('data.accessToken') !== null,
  });
  sleep(1);
}
```

**Critical path 2 — Secret read under load:**
```javascript
// tests/load/secrets.k6.js
export const options = {
  stages: [
    { duration: '1m', target: 200 },   // 200 concurrent users reading secrets
    { duration: '3m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:secret_read}': ['p(95)<150', 'p(99)<300'],
  },
};
```

**Critical path 3 — Webhook delivery surge:**

Simulate a burst of 1,000 webhook events (e.g., a deployment wave across many projects):
```javascript
export const options = {
  scenarios: {
    webhook_burst: {
      executor: 'constant-arrival-rate',
      rate: 100,          // 100 webhook triggers/sec
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 50,
    },
  },
};
```

### 6.2 Load Test Environments

| Environment | Purpose | Data |
|-------------|---------|------|
| Staging | Pre-release load testing | Anonymized production-scale seed data |
| Performance | Dedicated load testing target | Synthetic data — can be destroyed |
| Production | Passive monitoring only | Real traffic |

Load tests are **never run against production**. Staging is sized to match production horizontally.

---

## 7. Performance Regression Testing in CI

### 7.1 Automated Benchmark Gate

A subset of load tests run in CI as performance regression gates:

```yaml
# .github/workflows/perf.yml
- name: Run performance benchmarks
  run: k6 run tests/load/smoke.k6.js --env BASE_URL=${{ secrets.STAGING_URL }}

- name: Check benchmark results
  run: node scripts/check-perf-budget.js results.json
```

`check-perf-budget.js` fails the build if:
- p95 latency for any endpoint group exceeds 110% of the baseline (recorded in `tests/load/baselines.json`)
- Any endpoint exceeds the absolute thresholds defined in §2.1

### 7.2 Smoke Test (Fast, Every PR)

```javascript
// tests/load/smoke.k6.js — runs in < 2 minutes, tests happy paths
export const options = {
  vus: 10,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};
```

The smoke test runs on every PR to catch obvious regressions. Full load tests run nightly on staging.

### 7.3 Bundle Size Regression

Frontend bundle size is checked on every PR:

```yaml
- name: Build and check bundle size
  run: |
    pnpm --filter web build
    node scripts/check-bundle-budget.js dist/assets/

- name: Comment bundle diff on PR
  uses: actions/github-script@v7
  with:
    script: |
      // Post bundle size comparison comment on PR
```

---

## 8. Future Improvements

| Item | Priority | Impact |
|------|----------|--------|
| **CDN for static assets** | High | Serve JS/CSS bundles from Cloudflare CDN edge nodes — reduce TTFB from 800ms to < 100ms for global users |
| **MongoDB Atlas Search** | Medium | Replace regex-based search with full-text indexed search for audit logs and secret names |
| **Connection pooling tuning** | Medium | Tune Mongoose `maxPoolSize` (currently 10) based on actual connection patterns from Atlas monitoring |
| **Redis cluster mode** | Medium | When single Redis instance approaches 80% memory, move to Redis Cluster for horizontal scaling |
| **HTTP/2 multiplexing** | Medium | Enable HTTP/2 at the load balancer for multiplexed requests — reduces browser connection overhead |
| **React Server Components** | Low | For static portions of the dashboard (org settings, docs), RSC removes client-side JS for those routes |
| **MongoDB aggregation pipeline optimization** | Medium | Analytics queries use `$lookup` stages — materialize rollup data into a dedicated `analytics_snapshots` collection |
| **Brotli compression** | Low | Brotli achieves 15–25% better compression than gzip for text/JSON — enable at load balancer level |
| **WebWorker for heavy client-side operations** | Low | If client-side secret encryption is added, offload to WebWorker to avoid blocking the main thread |

---

*Document version: 1.0 | Last updated: 2026-06-19 | Owner: Platform Engineering*
