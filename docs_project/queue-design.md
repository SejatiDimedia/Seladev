# Queue Architecture Design — SELADEV IDP

**Document type:** Architecture Design  
**Status:** Approved  
**Last updated:** 2026-06-19  
**Authors:** Platform Engineering  
**Cross-references:** [system-design.md](./system-design.md) · [webhooks.md](./webhooks.md) · [database-design.md](./database-design.md)

---

## 1. Purpose

This document defines the asynchronous job processing architecture for SELADEV. It covers the queue inventory, job data schemas, worker topology, retry strategy, dead letter design, deployment state machine, and operational concerns including graceful shutdown and monitoring.

**Audience:** Backend engineers building workers or producing jobs, platform engineers operating Redis/BullMQ infrastructure, and SREs diagnosing job failures.

---

## 2. Context

### Why Async Job Processing for an IDP?

SELADEV performs several categories of work that must not block the HTTP response:

| Work Category | Why Async |
|---|---|
| Webhook delivery | External HTTP calls; target may be slow, unreachable, or rate-limited |
| Email dispatch | SMTP/SES API latency; retryable on transient failures |
| In-app notifications | Fan-out to potentially many recipients; non-critical for response timing |
| Deployment simulation | Long-running multi-stage process (minutes); result pushed via Socket.IO |
| Audit log writes | Fire-and-forget; must not block the originating API response |

Attempting these synchronously in the HTTP request lifecycle produces:
- **High p99 latency** for endpoints that trigger them
- **Cascading failures** when downstream services (SMTP, webhook targets) are degraded
- **No retry capability** — a failed email or webhook is permanently lost

**Technology choice — BullMQ:** BullMQ is the production-grade evolution of Bull, built on Redis streams and sorted sets. It provides durable job storage, atomic job state transitions, worker concurrency control, job priority, rate limiting, and a mature ecosystem (BullMQ Board, BullMQ Pro). The Redis dependency is shared with the SELADEV session cache, reducing infrastructure surface area.

---

## 3. Decisions

| Decision | Rationale |
|---|---|
| BullMQ over SQS/RabbitMQ | Self-contained; Redis already required for session cache; avoids managed queue costs at current scale |
| Single Redis instance for all queues | Simpler ops; Redis is fast enough to handle all queue workloads at SELADEV's current scale |
| Workers run in-process (dev) / separate process (prod) | Simplifies local development; enables independent horizontal scaling in production |
| Exponential backoff with 5 attempts | Covers transient failures without indefinite retries; max delay of 30 minutes prevents job pile-ups |
| Dead letter queue as a named BullMQ queue | Preserves failed job data for inspection and manual replay; avoids data loss |
| Job deduplication via `jobId` | Prevents duplicate webhook deliveries and notification storms on retry |

---

## 4. Queue Inventory

SELADEV operates four primary queues and one dead letter queue:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         REDIS INSTANCE                               │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │   webhooks       │  │  notifications   │  │    email         │   │
│  │  queue           │  │  queue           │  │    queue         │   │
│  │  concurrency: 10 │  │  concurrency: 20 │  │  concurrency: 5  │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────────────────────────────┐  │
│  │  deployments     │  │           dead-letter                    │  │
│  │  queue           │  │           queue                          │  │
│  │  concurrency: 3  │  │           (no active worker)             │  │
│  └──────────────────┘  └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

| Queue | Purpose | Concurrency | Priority | Max Attempts |
|---|---|---|---|---|
| `webhooks` | Deliver webhook payloads to registered consumer endpoints | 10 | Normal | 5 |
| `notifications` | Emit in-app Socket.IO events and dispatch emails | 20 | High | 3 |
| `email` | Send transactional email via SMTP/SES | 5 | Normal | 5 |
| `deployments` | Run deployment simulation state machine | 3 | Normal | 1 (no retry) |
| `dead-letter` | Receive failed jobs from all other queues | — (no worker) | — | — |

---

## 5. Job Data Type Definitions

All job data is strictly typed. Workers validate job data on receipt using Zod schemas to guard against malformed queue entries from older code versions.

### 5.1 Webhook Delivery Job

```ts
// packages/shared/src/queue/jobs/webhook-delivery.job.ts

export interface WebhookDeliveryJobData {
  webhookId: string;           // ObjectId of the Webhook document
  orgId: string;
  projectId?: string;
  event: WebhookEventType;     // e.g. 'deployment.completed'
  payload: WebhookPayload;     // full event envelope (see webhooks.md)
  targetUrl: string;           // cached at enqueue time to survive webhook updates
  secret: string;              // HMAC signing secret (encrypted at rest in DB)
  attempt: number;             // current attempt number (1-indexed)
  deliveryId: string;          // ObjectId of the WebhookDelivery log entry
}

export const WebhookDeliveryJobSchema = z.object({
  webhookId: z.string(),
  orgId: z.string(),
  projectId: z.string().optional(),
  event: z.enum(WEBHOOK_EVENTS),
  payload: WebhookPayloadSchema,
  targetUrl: z.string().url(),
  secret: z.string().min(32),
  attempt: z.number().int().min(1),
  deliveryId: z.string(),
});
```

### 5.2 Notification Job

```ts
// packages/shared/src/queue/jobs/notification.job.ts

export type NotificationChannel = 'in-app' | 'email' | 'both';

export interface NotificationJobData {
  orgId: string;
  recipients: Array<{
    userId: string;
    email: string;
    socketIds?: string[];   // active Socket.IO connections for this user
  }>;
  notification: {
    type: NotificationType;  // e.g. 'deployment_success', 'member_invited'
    title: string;
    body: string;
    resourceType: string;
    resourceId: string;
    actionUrl?: string;
  };
  channels: NotificationChannel;
  metadata?: Record<string, unknown>;
}
```

### 5.3 Email Job

```ts
// packages/shared/src/queue/jobs/email.job.ts

export type EmailTemplate =
  | 'invite_member'
  | 'deployment_success'
  | 'deployment_failed'
  | 'secret_expiring'
  | 'webhook_dead_letter'
  | 'org_suspended'
  | 'password_reset'
  | 'email_verification';

export interface EmailJobData {
  to: string | string[];
  replyTo?: string;
  template: EmailTemplate;
  subject: string;
  variables: Record<string, string | number | boolean>;
  orgId?: string;
  idempotencyKey: string;   // prevents duplicate sends on retry
}
```

### 5.4 Deployment Job

```ts
// packages/shared/src/queue/jobs/deployment.job.ts

export type DeploymentStage =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface DeploymentJobData {
  deploymentId: string;
  orgId: string;
  projectId: string;
  environmentId: string;
  triggeredBy: string;      // userId
  gitRef: string;           // branch or commit SHA
  buildConfig: {
    runtime: string;        // e.g. 'node:20', 'python:3.12'
    buildCommand: string;
    startCommand: string;
    envVars: Record<string, string>;  // resolved, decrypted at enqueue time
  };
}
```

### 5.5 Dead Letter Job

```ts
// packages/shared/src/queue/jobs/dead-letter.job.ts

export interface DeadLetterJobData {
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  originalData: unknown;
  failedAt: string;           // ISO timestamp
  errorMessage: string;
  errorStack?: string;
  attemptsMade: number;
  alertSent: boolean;
}
```

---

## 6. Worker Architecture

### 6.1 Development (Same-Process)

In development, all workers run in the same Node.js process as the Express API server. This simplifies local setup (single `pnpm dev` command) and debugging (unified logs, single debugger attachment).

```
apps/api/src/
└── workers/
    ├── index.ts              ← boots all workers in dev
    ├── webhook.worker.ts
    ├── notification.worker.ts
    ├── email.worker.ts
    └── deployment.worker.ts
```

```ts
// apps/api/src/workers/index.ts (dev mode)

if (process.env.NODE_ENV !== 'production') {
  // Boot workers in-process
  startWebhookWorker();
  startNotificationWorker();
  startEmailWorker();
  startDeploymentWorker();
  logger.info('Workers started in-process (development mode)');
}
```

### 6.2 Production (Separate Process)

In production, workers run as a separate Node.js process alongside the API process. This enables:
- Independent horizontal scaling (more worker replicas for high-throughput queues)
- Isolated crash domains (a buggy worker doesn't take down the API)
- Independent memory limits and CPU allocation

```
Docker Compose services (production):
  api         → apps/api (HTTP server, no workers)
  worker      → apps/worker (all BullMQ workers, no HTTP server)
  redis       → Redis 7
  mongodb     → MongoDB 7
```

```ts
// apps/worker/src/index.ts (production worker entrypoint)

async function main() {
  await connectRedis();
  await connectMongoDB();

  const workers = [
    startWebhookWorker(),
    startNotificationWorker(),
    startEmailWorker(),
    startDeploymentWorker(),
  ];

  logger.info(`Started ${workers.length} workers`);

  // Graceful shutdown (see §13)
  process.on('SIGTERM', () => gracefulShutdown(workers));
  process.on('SIGINT', () => gracefulShutdown(workers));
}

main().catch(logger.fatal);
```

### 6.3 Worker Factory Pattern

Each worker is created via a factory function that wires the BullMQ `Worker` to its processor, registers event listeners, and returns the worker instance:

```ts
// apps/api/src/workers/webhook.worker.ts

export function startWebhookWorker(): Worker {
  const worker = new Worker<WebhookDeliveryJobData>(
    'webhooks',
    webhookProcessor,
    {
      connection: redisConnection,
      concurrency: 10,
      limiter: { max: 100, duration: 1000 },  // 100 jobs/sec max
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, webhookId: job.data.webhookId }, 'Webhook delivered');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Webhook delivery failed');
    metrics.increment('webhook.delivery.failed');
  });

  return worker;
}
```

---

## 7. Retry Strategy

### 7.1 Exponential Backoff Schedule

All queues (except `deployments`) use exponential backoff with jitter:

| Attempt | Delay | Rationale |
|---|---|---|
| 1 (initial) | Immediate | First attempt; most transient failures resolve on retry |
| 2 | 1 second | Quick retry for short-lived network blips |
| 3 | 5 seconds | Covers brief outages (DNS propagation, pod restart) |
| 4 | 30 seconds | Covers partial outages |
| 5 | 5 minutes | Allows recovery from brief service disruptions |
| After 5 | Dead letter | Escalate; alert on-call |

For the `email` queue, an additional 6th attempt is made after 30 minutes, given that SMTP failures are often transient and email is high-value.

```ts
// Shared BullMQ retry config
export const DEFAULT_BACKOFF_CONFIG: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 1000,   // base delay in ms; attempt 2 = 1s, 3 = 5s (1*2^2), etc.
  },
  removeOnComplete: { count: 1000, age: 24 * 3600 },  // keep last 1000 completed jobs for 24h
  removeOnFail: false,  // failed jobs moved to dead-letter, not removed
};

export const EMAIL_BACKOFF_CONFIG: JobsOptions = {
  ...DEFAULT_BACKOFF_CONFIG,
  attempts: 6,
  backoff: { type: 'exponential', delay: 1000 },
};

export const DEPLOYMENT_JOB_CONFIG: JobsOptions = {
  attempts: 1,          // no retry — deployment state machine handles its own error states
  removeOnComplete: true,
  removeOnFail: false,
};
```

### 7.2 Jitter

BullMQ's exponential backoff does not apply jitter by default. To prevent retry thundering herds (all failed jobs retrying simultaneously after a Redis restart), a custom backoff function adds ±20% random jitter:

```ts
export const JITTERED_BACKOFF: JobsOptions['backoff'] = {
  type: 'custom',
};

// Registered globally at worker startup:
Worker.registerBackoffStrategy('custom', (attemptsMade: number) => {
  const base = Math.pow(2, attemptsMade - 1) * 1000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
});
```

---

## 8. Dead Letter Queue

### 8.1 Design

Failed jobs that exhaust all retry attempts are moved to the `dead-letter` queue by BullMQ's `failedJobHandler`. The dead letter queue has no active worker — it exists purely for inspection and manual replay.

```ts
// apps/api/src/workers/dead-letter.handler.ts

export async function handleDeadLetter(job: Job, error: Error): Promise<void> {
  const deadLetterData: DeadLetterJobData = {
    originalQueue: job.queueName,
    originalJobId: job.id!,
    originalJobName: job.name,
    originalData: job.data,
    failedAt: new Date().toISOString(),
    errorMessage: error.message,
    errorStack: error.stack,
    attemptsMade: job.attemptsMade,
    alertSent: false,
  };

  // Write to dead-letter queue (for BullMQ Board inspection)
  await deadLetterQueue.add('dead-letter', deadLetterData, {
    removeOnComplete: false,
    removeOnFail: false,
  });

  // Write to MongoDB dead_letters collection (long-term retention)
  await DeadLetterModel.create(deadLetterData);

  // Send alert
  await alertingService.send({
    severity: 'warning',
    title: `Dead letter: ${job.queueName}/${job.name}`,
    body: `Job ${job.id} exhausted all retries. Error: ${error.message}`,
    channel: 'platform-alerts',
  });

  metrics.increment('dead_letter.received', { queue: job.queueName });
}
```

### 8.2 Alerting

Dead letter events trigger:
1. A `dead_letter.received` metric increment (tracked by Grafana / Prometheus)
2. A Slack alert to the `#platform-alerts` channel via webhook
3. An in-app notification to all org `admin` users if the dead letter relates to a specific org (e.g., failed webhook delivery)

### 8.3 Manual Replay

Dead letter jobs can be replayed via the BullMQ Board UI or via admin API:

```
POST /admin/queues/dead-letter/:jobId/retry
Authorization: Bearer <admin-token>
```

Replay re-enqueues the original job data onto the original queue with a fresh `attempts` counter.

---

## 9. Job Priorities and Concurrency

BullMQ uses a priority queue mechanism where lower priority values are processed first.

| Queue | Priority | Concurrency | Rate Limit | Notes |
|---|---|---|---|---|
| `notifications` | 1 (highest) | 20 | None | Users expect near-instant in-app notifications |
| `webhooks` | 2 | 10 | 100 req/sec | Rate limited to avoid overwhelming single targets |
| `email` | 3 | 5 | 50 req/sec | SMTP pools are rate-limited; SES limit is ~14/sec |
| `deployments` | 4 (lowest) | 3 | None | CPU-bound simulation; low concurrency prevents saturation |

Priority assignment per job:

```ts
// High-priority notification for deployment failures
await notificationsQueue.add('notify', data, {
  ...DEFAULT_BACKOFF_CONFIG,
  priority: 1,
});

// Standard webhook delivery
await webhooksQueue.add('deliver', data, {
  ...DEFAULT_BACKOFF_CONFIG,
  priority: 2,
});
```

---

## 10. Deployment Simulation State Machine

### 10.1 State Diagram

```
                        ┌─────────┐
                        │ QUEUED  │ ← initial state on job enqueue
                        └────┬────┘
                             │ worker picks up job
                             ▼
                        ┌──────────┐
                        │ BUILDING │ ← simulate build (15–45s)
                        └────┬─────┘
                    ┌────────┴────────┐
                    │ build fails     │ build succeeds
                    ▼                 ▼
              ┌──────────┐     ┌───────────┐
              │  FAILED  │     │ DEPLOYING │ ← simulate deploy (10–30s)
              └──────────┘     └─────┬─────┘
                               ┌─────┴──────┐
                               │            │
                      user cancels     deploy completes
                               ▼            ▼
                         ┌──────────┐ ┌─────────┐
                         │CANCELLED │ │ SUCCESS │
                         └──────────┘ └─────────┘
```

### 10.2 State Transition Implementation

Each state transition:
1. Updates the `Deployment` document in MongoDB
2. Emits a `deployment:status_changed` event via Socket.IO to the project room
3. Creates an audit log entry
4. Optionally enqueues a notification job

```ts
// apps/api/src/workers/deployment.worker.ts

export async function deploymentProcessor(job: Job<DeploymentJobData>): Promise<void> {
  const { deploymentId, projectId, orgId } = job.data;

  const transition = async (stage: DeploymentStage, meta?: Partial<Deployment>) => {
    await DeploymentModel.findByIdAndUpdate(deploymentId, {
      status: stage,
      ...meta,
      [`timestamps.${stage}`]: new Date(),
    });
    io.to(`project:${projectId}`).emit('deployment:status_changed', { deploymentId, stage });
    logger.info({ deploymentId, stage }, 'Deployment stage transition');
  };

  try {
    await transition('building');
    await simulateBuildStage(job.data.buildConfig);  // throws on simulated failure

    await transition('deploying');

    // Check for cancellation signal before proceeding
    if (await isCancelled(deploymentId)) {
      await transition('cancelled');
      return;
    }

    await simulateDeployStage(job.data.buildConfig);

    await transition('success', { completedAt: new Date() });

    await notificationsQueue.add('notify', buildDeploySuccessNotification(job.data), {
      priority: 1,
    });
    await webhooksQueue.add('deliver', buildDeployWebhookPayload(job.data, 'deployment.completed'));

  } catch (err) {
    await transition('failed', {
      error: { message: (err as Error).message },
    });
    await notificationsQueue.add('notify', buildDeployFailedNotification(job.data), {
      priority: 1,
    });
    await webhooksQueue.add('deliver', buildDeployWebhookPayload(job.data, 'deployment.failed'));
    throw err;  // re-throw so BullMQ records failure
  }
}
```

### 10.3 Cancellation Mechanism

Deployments can be cancelled by a `project:developer` or above during the `building` or `deploying` stage. Cancellation is implemented as a Redis flag checked between stages:

```ts
// Set by the cancel API endpoint:
await redis.set(`deployment:cancel:${deploymentId}`, '1', 'EX', 300);

// Checked in the worker between stages:
async function isCancelled(deploymentId: string): Promise<boolean> {
  return (await redis.exists(`deployment:cancel:${deploymentId}`)) === 1;
}
```

---

## 11. Webhook Delivery Worker Detail

Full implementation details for the webhook delivery worker, including HMAC signing and timeout handling:

```ts
// apps/api/src/workers/webhook.worker.ts

const WEBHOOK_TIMEOUT_MS = 10_000;  // 10 second timeout per delivery attempt

export async function webhookProcessor(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { webhookId, targetUrl, secret, payload, deliveryId, event } = job.data;

  // 1. Sign the payload
  const body = JSON.stringify(payload);
  const signature = createHmacSignature(body, secret);

  // 2. Record delivery attempt start
  await WebhookDeliveryModel.findByIdAndUpdate(deliveryId, {
    $push: {
      attempts: {
        attemptNumber: job.attemptsMade + 1,
        startedAt: new Date(),
      },
    },
  });

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let durationMs: number | null = null;
  let success = false;

  const startTime = Date.now();

  try {
    // 3. Deliver with timeout
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SELADEV-Signature': `sha256=${signature}`,
        'X-SELADEV-Event': event,
        'X-SELADEV-Delivery': deliveryId,
        'User-Agent': 'SELADEV-Webhook/1.0',
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    responseStatus = response.status;
    responseBody = await response.text().catch(() => null);
    durationMs = Date.now() - startTime;

    if (!response.ok) {
      throw new WebhookDeliveryError(`HTTP ${responseStatus}`, responseStatus);
    }

    success = true;

  } catch (err) {
    durationMs = Date.now() - startTime;

    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new WebhookDeliveryError(`Delivery timed out after ${WEBHOOK_TIMEOUT_MS}ms`);
    }
    throw err;

  } finally {
    // 4. Update delivery log regardless of outcome
    await WebhookDeliveryModel.findByIdAndUpdate(deliveryId, {
      $set: {
        status: success ? 'delivered' : 'failed',
        lastAttemptAt: new Date(),
      },
      $push: {
        attempts: {
          $each: [],
          $position: -1,  // update last element's result fields
        },
      },
    });

    if (success) {
      metrics.histogram('webhook.delivery.duration_ms', durationMs!);
      metrics.increment('webhook.delivery.success');
    }
  }
}

function createHmacSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}
```

---

## 12. Notification Worker

The notification worker handles both real-time Socket.IO emission and email dispatch:

```ts
// apps/api/src/workers/notification.worker.ts

export async function notificationProcessor(job: Job<NotificationJobData>): Promise<void> {
  const { recipients, notification, channels, orgId } = job.data;

  // 1. Persist notification records to MongoDB
  const notificationDocs = await NotificationModel.insertMany(
    recipients.map((r) => ({
      userId: r.userId,
      orgId,
      ...notification,
      read: false,
      createdAt: new Date(),
    })),
  );

  // 2. Emit via Socket.IO (in-app)
  if (channels === 'in-app' || channels === 'both') {
    for (const recipient of recipients) {
      // Emit to all active socket sessions for this user
      io.to(`user:${recipient.userId}`).emit('notification:new', {
        ...notification,
        id: notificationDocs.find(d => d.userId.toString() === recipient.userId)?._id,
      });
    }
  }

  // 3. Enqueue email jobs (email channel handled by separate worker)
  if (channels === 'email' || channels === 'both') {
    await Promise.all(
      recipients.map((r) =>
        emailQueue.add('email', {
          to: r.email,
          template: mapNotificationTypeToTemplate(notification.type),
          subject: notification.title,
          variables: {
            recipientName: r.email.split('@')[0],
            body: notification.body,
            actionUrl: notification.actionUrl ?? '',
          },
          orgId,
          idempotencyKey: `${job.id}:${r.userId}`,
        } satisfies EmailJobData),
      ),
    );
  }
}
```

---

## 13. BullMQ Board (Monitoring UI)

BullMQ Board is the official web UI for inspecting queue state, browsing jobs, retrying failures, and viewing metrics.

### 13.1 Setup

```ts
// apps/api/src/admin/bullmq-board.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(webhooksQueue),
    new BullMQAdapter(notificationsQueue),
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(deploymentsQueue),
    new BullMQAdapter(deadLetterQueue),
  ],
  serverAdapter,
});

// Mount on admin router (protected by admin-only middleware)
adminRouter.use('/queues', requireAdminToken, serverAdapter.getRouter());
```

### 13.2 Access Control

BullMQ Board is mounted under `/admin/queues` and protected by a separate `requireAdminToken` middleware that validates a long-lived admin API key stored in `ADMIN_API_KEY` env var. It is not exposed to org-level users.

### 13.3 Key Metrics to Monitor

| Metric | Alert Threshold | Action |
|---|---|---|
| `webhooks` queue depth | > 1,000 waiting | Scale webhook worker replicas |
| Dead letter queue count | > 10 in 1 hour | Page on-call; investigate root cause |
| Worker throughput | < 50% of baseline | Check Redis health, worker process status |
| Job failure rate | > 5% per queue | Alert; check downstream service health |
| Active deployment count | > 50 concurrent | Queue is backlogged; notify users |

---

## 14. Redis Configuration for BullMQ

```ts
// apps/api/src/config/redis.ts

import { Redis } from 'ioredis';

export const redisConnection = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,   // Required by BullMQ — must be null
  enableReadyCheck: false,       // Required by BullMQ
  retryStrategy: (times) => Math.min(times * 50, 2000),
  lazyConnect: false,
  db: 0,
});

// Separate connection for BullMQ event listeners
// BullMQ requires separate connections for workers and queue producers
export const redisSubscriberConnection = redisConnection.duplicate();
```

**Critical Redis configuration notes:**
- `maxRetriesPerRequest: null` is mandatory for BullMQ. Without it, BullMQ's blocking `BRPOP` calls fail on retry.
- Each `Worker` and `Queue` instance requires its own connection. BullMQ internally uses connection pools, but separate connection objects prevent interference.
- Redis `maxmemory-policy` must be set to `noeviction` or `allkeys-lru` with a large enough `maxmemory` to avoid evicting job data before processing.

**Recommended Redis configuration (`redis.conf`):**

```
maxmemory 512mb
maxmemory-policy noeviction
save ""                        # Disable RDB persistence (AOF preferred for queues)
appendonly yes
appendfsync everysec
```

---

## 15. Graceful Shutdown

Workers must drain in-flight jobs before process termination to avoid partial processing:

```ts
// apps/worker/src/shutdown.ts

export async function gracefulShutdown(workers: Worker[]): Promise<void> {
  logger.info('Received shutdown signal, draining workers...');

  const SHUTDOWN_TIMEOUT_MS = 30_000;  // 30 seconds max

  const drainPromises = workers.map(async (worker) => {
    await worker.close();   // stops accepting new jobs; waits for in-flight to complete
    logger.info({ worker: worker.name }, 'Worker drained');
  });

  const timeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error('Graceful shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
  );

  try {
    await Promise.race([Promise.all(drainPromises), timeout]);
    logger.info('All workers drained cleanly');
  } catch (err) {
    logger.error({ err }, 'Graceful shutdown timed out — forcing exit');
  } finally {
    await redisConnection.quit();
    process.exit(0);
  }
}
```

Docker Compose `stop_grace_period` must be set to at least 35 seconds to allow the graceful shutdown to complete:

```yaml
# docker-compose.yml
services:
  worker:
    stop_grace_period: 35s
    stop_signal: SIGTERM
```

---

## 16. Job Deduplication Strategy

Some jobs must not be processed more than once even if enqueued multiple times (e.g., due to API retries or event system fan-out bugs). BullMQ supports deduplication via explicit `jobId`.

```ts
// Webhook delivery deduplication: one job per (deliveryId, attempt)
await webhooksQueue.add(
  'deliver',
  webhookJobData,
  {
    jobId: `webhook:${webhookId}:${deliveryId}:${attempt}`,
    ...DEFAULT_BACKOFF_CONFIG,
  },
);

// Deployment deduplication: exactly one active job per deployment
await deploymentsQueue.add(
  'deploy',
  deploymentJobData,
  {
    jobId: `deployment:${deploymentId}`,
    ...DEPLOYMENT_JOB_CONFIG,
  },
);

// Email deduplication: idempotency key prevents duplicate sends on retry
await emailQueue.add(
  'email',
  emailJobData,
  {
    jobId: `email:${emailJobData.idempotencyKey}`,
    ...EMAIL_BACKOFF_CONFIG,
  },
);
```

If a job with the same `jobId` already exists in the queue (in `waiting`, `active`, or `delayed` state), BullMQ will silently skip the duplicate `add` call and return the existing job. This is safe for all idempotent job types.

---

## 17. Error Handling and Logging

### 17.1 Structured Logging

All worker processors use structured JSON logging via Pino:

```ts
// Every job processor receives the logger with job context pre-bound
const jobLogger = logger.child({
  queue: job.queueName,
  jobId: job.id,
  jobName: job.name,
  attempt: job.attemptsMade + 1,
});

jobLogger.info('Job started');
jobLogger.error({ err }, 'Job failed');
```

### 17.2 Error Classification

```ts
export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly isRetryable = true,
  ) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}

// In worker processor:
} catch (err) {
  if (err instanceof WebhookDeliveryError && !err.isRetryable) {
    // Mark delivery as permanently failed; don't retry
    await job.discard();
    return;
  }
  throw err;  // retryable — BullMQ will schedule the next attempt
}
```

### 17.3 Progress Reporting

Long-running deployment jobs report progress for the frontend progress bar:

```ts
await job.updateProgress({ stage: 'building', percent: 25 });
await job.updateProgress({ stage: 'building', percent: 75 });
await job.updateProgress({ stage: 'deploying', percent: 90 });
```

Socket.IO listens for BullMQ progress events and relays them to the frontend:

```ts
worker.on('progress', (job, progress) => {
  io.to(`project:${job.data.projectId}`).emit('deployment:progress', {
    deploymentId: job.data.deploymentId,
    ...progress,
  });
});
```

---

## 18. Tradeoffs

| Option Considered | Decision | Reason |
|---|---|---|
| SQS / SNS | Rejected | Adds AWS dependency; increases operational complexity for dev env |
| RabbitMQ | Rejected | AMQP protocol overhead; Redis already in stack |
| BullMQ Pro (paid) | Deferred | Rate limiter, repeatable jobs, priority groups are useful; evaluate at scale |
| Kafka | Rejected | Operational overhead far exceeds current needs; revisit at 10M+ events/day |
| In-process queue (node-queue) | Rejected | No durability; queue lost on process crash |
| Separate Redis for BullMQ | Rejected | Unnecessary at current scale; same Redis instance is fine |

---

## 19. Future Improvements

### 19.1 Extract Workers to Dedicated Container

The worker process should run in its own Docker image with a separate Dockerfile optimized for long-running CPU-bound work (no HTTP port exposed, tuned Node.js GC settings). This enables:
- Independent scaling via Kubernetes HPA based on queue depth metrics
- Worker-specific resource limits without affecting API latency

### 19.2 Queue Depth Autoscaling

Expose BullMQ queue depth metrics to Prometheus. Configure Kubernetes KEDA (Kubernetes Event-Driven Autoscaling) to scale worker replicas based on queue depth:

```yaml
# KEDA ScaledObject example
triggers:
  - type: redis
    metadata:
      listName: bull:webhooks:wait
      listLength: "50"   # scale up when >50 jobs waiting
```

### 19.3 Repeatable / Scheduled Jobs

BullMQ supports cron-style repeatable jobs. Planned uses:
- Daily secret expiry checks (`secret:expire_check`, runs at 00:00 UTC)
- Hourly analytics aggregation
- Weekly dead letter digest emails to org admins

### 19.4 BullMQ Pro Migration

Evaluate BullMQ Pro for:
- **Rate limiter per queue target** (limit deliveries to a single webhook URL)
- **Priority groups** (ensure org `owner` deploys aren't blocked by bulk `member` deploys)
- **Sandboxed workers** (worker processors run in child processes for isolation)
