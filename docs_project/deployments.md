# Deployments Module

**Document Type:** Feature Module Design  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the Deployments module for SELADEV — a simulated deployment pipeline that demonstrates real-world orchestration patterns including async job processing, state machine management, real-time status updates, and audit trail generation. While the pipeline is simulated (no actual code is deployed), the architecture mirrors production-grade deployment systems.

---

## Context

### Why Simulated?

SELADEV is a portfolio project demonstrating platform engineering competency. A real deployment pipeline requires cloud infrastructure (ECS, Kubernetes, Lambda), which is outside the scope of what this platform manages. The simulated pipeline:

- **Demonstrates the orchestration pattern** — BullMQ workers, state machines, real-time WebSocket updates
- **Exercises the full async flow** — trigger → queue → worker → state transitions → notifications → audit
- **Is honest about its scope** — the UI and API treat it as a first-class feature, not a stub

Future versions will replace the simulator with real CI/CD integration hooks (GitHub Actions triggers, Docker build steps).

---

## Deployment Schema

```typescript
{
  _id: ObjectId,
  organizationId: ObjectId,
  projectId: ObjectId,
  environmentId: ObjectId,
  version: string,              // Semantic version or commit SHA
  branch: string,
  commitSha: string,
  commitMessage: string,
  status: DeploymentStatus,
  statusHistory: StatusEvent[],
  triggeredBy: ObjectId,        // ref: users
  triggeredVia: 'ui' | 'api' | 'webhook' | 'schedule',
  buildLogs: string[],          // Simulated build log lines
  duration: number | null,      // Total duration in milliseconds
  errorMessage: string | null,
  metadata: Record<string, unknown>,
  createdAt: Date,
  completedAt: Date | null,
}

type DeploymentStatus =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'success'
  | 'failed'
  | 'cancelled';

type StatusEvent = {
  status: DeploymentStatus;
  timestamp: Date;
  message: string;
};
```

See [`database-design.md`](database-design.md) for indexing strategy.

---

## State Machine

```
                    ┌─────────┐
                    │ queued  │◄─── Deployment triggered
                    └────┬────┘
                         │ Worker picks up job
                    ┌────▼────┐
                    │building │◄─── Simulated build phase (3-8s)
                    └────┬────┘
                         │ Build succeeds
                    ┌────▼──────┐
                    │ deploying │◄─── Simulated deploy phase (2-5s)
                    └────┬──────┘
               ┌─────────┼─────────┐
          ┌────▼────┐         ┌────▼────┐
          │ success │         │ failed  │
          └─────────┘         └─────────┘

From any non-terminal state:
  → cancelled  (if cancellation flag set in Redis)
```

### Terminal States
`success`, `failed`, and `cancelled` are terminal — no further state transitions are possible.

### statusHistory
Every state transition appends to `statusHistory`:

```typescript
statusHistory: [
  { status: 'queued',    timestamp: T0, message: 'Deployment queued' },
  { status: 'building',  timestamp: T1, message: 'Starting build process' },
  { status: 'deploying', timestamp: T2, message: 'Build complete, deploying to production' },
  { status: 'success',   timestamp: T3, message: 'Deployment completed successfully' },
]
```

This provides a full timeline without needing a separate events collection.

---

## Simulation Logic

The deployment worker simulates the pipeline using timed state transitions and randomized log lines:

```typescript
// infrastructure/queue/workers/deployment.worker.ts
async function processDeployment(job: Job<DeploymentJobData>) {
  const { deploymentId, orgId } = job.data;

  // QUEUED → BUILDING
  await transitionStatus(deploymentId, 'building', 'Starting build process');
  await emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'building' });

  // Simulate build phase with log streaming
  const buildDuration = randomBetween(3000, 8000);
  await simulateBuildLogs(deploymentId, buildDuration);

  // Check cancellation flag before proceeding
  const cancelled = await redis.get(`deployment:cancel:${deploymentId}`);
  if (cancelled) {
    await transitionStatus(deploymentId, 'cancelled', 'Deployment cancelled by user');
    await emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'cancelled' });
    return;
  }

  // BUILDING → DEPLOYING
  await transitionStatus(deploymentId, 'deploying', 'Build complete, deploying to environment');
  await emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'deploying' });

  // Simulate deploy phase (5% random failure rate for realism)
  const deployDuration = randomBetween(2000, 5000);
  await sleep(deployDuration);

  const failed = Math.random() < 0.05; // 5% simulated failure
  if (failed) {
    await transitionStatus(deploymentId, 'failed', 'Deployment failed: container health check timeout');
    await emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'failed', error: true });
    await notificationService.send(userId, 'deployment.failed', { deploymentId });
    return;
  }

  // DEPLOYING → SUCCESS
  const totalDuration = Date.now() - job.timestamp;
  await transitionStatus(deploymentId, 'success', 'Deployment completed successfully');
  await deploymentRepo.setCompleted(deploymentId, totalDuration);
  await emitSocketEvent(orgId, 'deployment:status_changed', { deploymentId, status: 'success' });
  await notificationService.send(userId, 'deployment.completed', { deploymentId });
}
```

### Simulated Build Logs

```typescript
const BUILD_LOG_TEMPLATES = [
  '[00:00] Cloning repository...',
  '[00:01] Installing dependencies (pnpm install)...',
  '[00:03] Running type checks (tsc --noEmit)...',
  '[00:04] Running tests (vitest run)...',
  '[00:06] Building production bundle (vite build)...',
  '[00:07] Optimizing assets...',
  '[00:08] Build complete. Bundle size: 428KB (gzipped: 142KB)',
];

async function simulateBuildLogs(deploymentId: string, duration: number) {
  const interval = duration / BUILD_LOG_TEMPLATES.length;
  for (const line of BUILD_LOG_TEMPLATES) {
    await sleep(interval);
    await deploymentRepo.appendLog(deploymentId, line);
    // Emit each log line via Socket.IO for live streaming
    await emitSocketEvent(orgId, 'deployment:log', { deploymentId, line });
  }
}
```

---

## Trigger Methods

| Method | How | Auth Required |
|---|---|---|
| UI | Button click in dashboard | JWT session |
| API | `POST /deployments` with API key | API key with `deployments:trigger` scope |
| Webhook | Incoming webhook event triggers deploy | Webhook HMAC verification |
| Schedule | Cron-based trigger (roadmap) | System (BullMQ scheduler) |

---

## Deployment Protection

When `project.settings.deploymentProtection: true` for production environments:

```
1. Deploy triggered → status: 'pending_approval' (not queued)
2. Notification sent to all project:admin and org:admin members
3. Approval endpoint: POST /deployments/:id/approve
4. On approval: status → 'queued', job added to BullMQ
5. On rejection: status → 'cancelled', actor logged
```

This adds a manual gate before production deployments proceed.

### Branch Restrictions

```typescript
// deployments.service.ts
if (project.settings.allowedBranches.length > 0) {
  const isAllowed = project.settings.allowedBranches.some(pattern =>
    minimatch(input.branch, pattern)
  );
  if (!isAllowed) {
    throw new BusinessRuleViolationError(
      `Branch '${input.branch}' is not allowed for this project. Allowed: ${project.settings.allowedBranches.join(', ')}`
    );
  }
}
```

---

## Real-Time Updates (Socket.IO)

Deployment status changes are pushed to the frontend via Socket.IO:

```typescript
// Events emitted during deployment lifecycle
'deployment:status_changed' → { deploymentId, status, timestamp }
'deployment:log'            → { deploymentId, line, timestamp }
```

The frontend subscribes to these events and invalidates TanStack Query caches to refresh the deployment detail view — Socket.IO events are triggers for cache invalidation, not direct state updates.

See [`fronted-architecture.md`](fronted-architecture.md) for the Socket.IO integration pattern.

---

## Cancellation Flow

```
POST /api/v1/deployments/:id/cancel
```

Cancellation uses a Redis flag rather than direct BullMQ job cancellation:

```typescript
// Set cancellation flag in Redis (TTL: 10 minutes)
await redis.set(`deployment:cancel:${deploymentId}`, '1', 'EX', 600);
```

The worker checks this flag at each state transition checkpoint. If set, the worker transitions to `cancelled` and returns. This is safer than force-killing a BullMQ job, which could leave the deployment in an inconsistent state.

**Only** a `project:admin` or org admin can cancel a deployment. Cancellation is only effective for `queued` or `building` status — `deploying` cannot be cancelled (the deploy is already in-flight).

---

## Deployment History

The deployment history is paginated using **cursor pagination** (not offset), because:
- Deployments are append-only (time-series data)
- Offset pagination suffers from the "phantom record" problem: if a new deployment is triggered while the user is browsing page 2, all subsequent pages shift by one record

```
GET /api/v1/projects/:projectId/deployments?limit=20&cursor=<opaque>

Response:
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6IjY2YWIiLCJ0cyI6MTcwNH0=",
    "hasNext": true
  }
}
```

See [`api-design.md`](api-design.md) for cursor pagination implementation details.

---

## Audit Trail

| Event | Trigger |
|---|---|
| `deployment.triggered` | Deploy initiated — includes branch, version, trigger method |
| `deployment.approved` | Manual approval granted |
| `deployment.rejected` | Manual approval denied |
| `deployment.cancelled` | Deployment cancelled by user |
| `deployment.completed` | Deployment reached `success` state |
| `deployment.failed` | Deployment reached `failed` state |

---

## API Endpoints

```
GET    /api/v1/projects/:projectId/deployments            → List history (cursor paginated)
POST   /api/v1/projects/:projectId/deployments            → Trigger deployment
GET    /api/v1/deployments/:id                            → Get deployment detail + logs
POST   /api/v1/deployments/:id/cancel                     → Cancel deployment
POST   /api/v1/deployments/:id/approve                    → Approve (if protection enabled)
POST   /api/v1/deployments/:id/reject                     → Reject (if protection enabled)
GET    /api/v1/deployments/:id/logs                       → Stream build logs (SSE or polling)
```

---

## Decisions

### Redis Cancellation Flag over BullMQ Job Removal
**Rationale:** BullMQ does not guarantee that a job can be removed from the queue once it has been picked up by a worker. A Redis flag checked at each checkpoint is reliable regardless of job state and does not require BullMQ internals knowledge.

### 5% Random Failure Rate
**Rationale:** A deployment pipeline that always succeeds is not realistic. The 5% simulated failure rate demonstrates error handling, failure notification, and retry reasoning without engineering actual failure conditions.

### Embedded statusHistory
**Rationale:** Deployment status events are tightly coupled to their deployment and are never queried independently of the deployment document. Embedding them avoids a join on every status read and keeps the deployment document self-contained.

---

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Simulated pipeline | No cloud infra required, demonstrable in any environment | Does not prove real CI/CD orchestration capability |
| Redis cancellation flag | Reliable, checkpoint-safe cancellation | Small window where flag is set but not yet checked |
| Cursor pagination | No phantom records on append-only data | Cannot jump to arbitrary page (random access) |
| Embedded logs | Simple, no join required | Log array grows per deployment (bounded by simulation) |

---

## Future Improvements

- **Real CI/CD integration** — Replace the simulator with actual GitHub Actions workflow triggers. `POST /deployments` would fire `repository_dispatch` event on the target repo, and GitHub Actions would send status updates back via webhook.
- **Docker build integration** — Build and push actual Docker images as part of the deployment pipeline.
- **Deployment rollback** — `POST /deployments/:id/rollback` re-deploys the previous successful deployment artifact.
- **Event sourcing for deployments** — Replace the mutable `status` field with an append-only event log. Enables time-travel debugging and richer rollback semantics.
- **Deployment metrics** — Track deployment frequency, success rate, and mean time to restore (MTTR) across projects. Feed into the analytics dashboard.
