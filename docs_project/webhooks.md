# Webhook Feature Design — SELADEV IDP

**Document type:** Feature Design  
**Status:** Approved  
**Last updated:** 2026-06-19  
**Authors:** Platform Engineering  
**Cross-references:** [queue-design.md](./queue-design.md) · [api-design.md](./api-design.md) · [rbac.md](./rbac.md) · [database-design.md](./database-design.md)

---

## 1. Purpose

This document defines the webhook system for SELADEV — the mechanism by which external consumers subscribe to platform events and receive real-time HTTP callbacks. It covers event catalog, payload structure, HMAC signing, delivery mechanics, retry logic, security, and consumer integration guidance.

**Audience:** Backend engineers building or modifying the webhook subsystem, platform engineers operating the delivery infrastructure, and external developers integrating SELADEV webhooks into their tooling.

---

## 2. Context

### Why Webhooks for an IDP?

SELADEV consumers — CI/CD pipelines, Slack bots, monitoring dashboards, custom automation — need to react to platform events without polling the SELADEV API. Polling is:
- **Inefficient:** Generates constant API load regardless of event frequency
- **Latency-prone:** Reaction time is bounded by poll interval
- **Stateful:** Consumer must track last-seen state to detect changes

Webhooks invert this: SELADEV pushes events to consumers the moment they occur, enabling sub-second reaction times with zero ongoing API load.

**Typical SELADEV webhook consumers:**
- Slack integration: notify `#deployments` channel on `deployment.completed` or `deployment.failed`
- GitHub Actions: trigger downstream pipelines on `deployment.success`
- Datadog / PagerDuty: alert on `deployment.failed` or `secret.expiring`
- Custom internal tooling: sync SELADEV project state into internal dashboards

---

## 3. Decisions

| Decision | Rationale |
|---|---|
| HMAC-SHA256 signing on every delivery | Allows consumers to cryptographically verify payload authenticity |
| Delivery via BullMQ worker (async) | Decouples delivery latency from event publication; enables retry |
| 10-second delivery timeout | Prevents slow consumer endpoints from blocking queue workers |
| Exponential backoff with 5 attempts | Covers transient consumer outages without overwhelming the target |
| Dead letter queue on exhaustion | Preserves payload for inspection; triggers alert to org admins |
| Per-webhook event filtering | Reduces noise; consumers only receive events they subscribed to |
| Delivery log with 90-day retention | Enables debugging without indefinite storage costs |
| SSRF prevention via IP blocklist | Blocks webhook targets pointing to internal services |

---

## 4. Event Catalog

All SELADEV webhook events follow the `resource.action` naming convention:

### 4.1 Deployment Events

| Event | Trigger |
|---|---|
| `deployment.queued` | A deployment job is enqueued |
| `deployment.building` | Build stage begins |
| `deployment.deploying` | Deploy stage begins |
| `deployment.completed` | Deployment reaches `success` state |
| `deployment.failed` | Deployment reaches `failed` state |
| `deployment.cancelled` | Deployment is cancelled by a user |

### 4.2 Secret & Config Events

| Event | Trigger |
|---|---|
| `secret.created` | A new secret is created in any environment |
| `secret.updated` | A secret value or metadata is updated |
| `secret.deleted` | A secret is deleted |
| `secret.rotated` | A secret is rotated (new version created) |
| `secret.expiring` | A secret is within 7 days of its expiry date |

### 4.3 Member Events

| Event | Trigger |
|---|---|
| `member.invited` | A user is invited to the organization |
| `member.joined` | A user accepts an invitation and joins the org |
| `member.removed` | A member is removed from the organization |
| `member.role_changed` | A member's org or project role is changed |

### 4.4 Project Events

| Event | Trigger |
|---|---|
| `project.created` | A new project is created |
| `project.updated` | Project metadata is updated |
| `project.archived` | A project is archived |
| `project.deleted` | A project is permanently deleted |

### 4.5 API Key Events

| Event | Trigger |
|---|---|
| `api_key.created` | A new API key is issued |
| `api_key.revoked` | An API key is revoked |
| `api_key.expired` | An API key reaches its expiry date |

### 4.6 Platform Events

| Event | Trigger |
|---|---|
| `webhook.test` | Manual test delivery triggered from dashboard |
| `audit_log.exported` | An audit log export is completed |

---

## 5. Webhook Registration & Management

### 5.1 Data Model

```ts
// Mongoose schema reference

interface Webhook {
  _id: ObjectId;
  orgId: ObjectId;
  projectId?: ObjectId;          // null = org-level webhook (all projects)
  name: string;
  targetUrl: string;
  secret: string;                 // AES-256-GCM encrypted at rest
  events: WebhookEventType[];     // subscribed event types
  active: boolean;
  headers?: Record<string, string>; // optional additional headers
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  lastDeliveryAt?: Date;
  lastDeliveryStatus?: 'delivered' | 'failed';
  failureStreak: number;          // consecutive failed deliveries
  disabledAt?: Date;              // auto-disabled after 100 consecutive failures
}
```

### 5.2 REST API

Webhooks are managed via the standard SELADEV REST API. All endpoints require `Bearer` authentication and appropriate RBAC permissions (`webhook:create`, `webhook:read`, `webhook:update`, `webhook:delete`).

**Base path:** `/api/v1/orgs/:orgId`

#### List Webhooks

```
GET /api/v1/orgs/:orgId/webhooks
GET /api/v1/orgs/:orgId/projects/:projectId/webhooks
```

Response: paginated list of webhook objects (secret field is **never returned** after creation).

#### Create Webhook

```
POST /api/v1/orgs/:orgId/webhooks

Body:
{
  "name": "Slack Deployments",
  "targetUrl": "https://hooks.slack.com/services/T.../B.../...",
  "events": ["deployment.completed", "deployment.failed"],
  "headers": {
    "X-Custom-Header": "value"
  }
}

Response 201:
{
  "id": "...",
  "name": "Slack Deployments",
  "targetUrl": "https://hooks.slack.com/...",
  "events": ["deployment.completed", "deployment.failed"],
  "secret": "whsec_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456",  // shown ONCE, never again
  "active": true,
  "createdAt": "2026-06-19T12:00:00.000Z"
}
```

The `secret` is generated as a cryptographically random 32-byte value, base64-encoded, prefixed with `whsec_`. It is shown exactly once in the creation response and stored in encrypted form (AES-256-GCM) in MongoDB.

#### Get Webhook

```
GET /api/v1/orgs/:orgId/webhooks/:webhookId

Response 200:
{
  "id": "...",
  "name": "Slack Deployments",
  "targetUrl": "https://hooks.slack.com/...",
  "events": ["deployment.completed", "deployment.failed"],
  // NOTE: secret is NEVER returned after creation
  "active": true,
  "lastDeliveryAt": "2026-06-19T11:55:00.000Z",
  "lastDeliveryStatus": "delivered",
  "failureStreak": 0
}
```

#### Update Webhook

```
PATCH /api/v1/orgs/:orgId/webhooks/:webhookId

Body (all fields optional):
{
  "name": "Slack Deployments (Updated)",
  "events": ["deployment.completed", "deployment.failed", "deployment.cancelled"],
  "active": false
}
```

#### Delete Webhook

```
DELETE /api/v1/orgs/:orgId/webhooks/:webhookId
```

Deletes the webhook and all associated delivery logs. Irreversible.

#### Rotate Secret

```
POST /api/v1/orgs/:orgId/webhooks/:webhookId/rotate-secret

Response 200:
{
  "secret": "whsec_nEwSeCrEtVaLuE...",  // shown ONCE
  "rotatedAt": "2026-06-19T12:30:00.000Z"
}
```

#### Manual Test Delivery

```
POST /api/v1/orgs/:orgId/webhooks/:webhookId/test

Body:
{
  "event": "webhook.test"   // optional, defaults to webhook.test
}

Response 202: { "deliveryId": "...", "message": "Test delivery enqueued" }
```

---

## 6. Payload Structure

Every webhook delivery uses a consistent envelope regardless of event type. This allows consumers to build a single parser that handles all SELADEV events.

### 6.1 Envelope Schema

```ts
interface WebhookPayload {
  id: string;              // unique delivery ID (UUID v4)
  event: WebhookEventType; // e.g. 'deployment.completed'
  apiVersion: string;      // e.g. '2026-06-01' — date-based API versioning
  orgId: string;
  projectId?: string;
  timestamp: string;       // ISO 8601 UTC
  data: Record<string, unknown>; // event-specific data (see §6.2)
}
```

### 6.2 Event-Specific Data

#### `deployment.completed`

```json
{
  "id": "evt_01J4K8QZXYZ",
  "event": "deployment.completed",
  "apiVersion": "2026-06-01",
  "orgId": "org_01HXYZ",
  "projectId": "proj_01HABC",
  "timestamp": "2026-06-19T12:00:00.000Z",
  "data": {
    "deployment": {
      "id": "dep_01HXYZ",
      "status": "success",
      "environmentId": "env_01HPROD",
      "environmentName": "production",
      "triggeredBy": {
        "userId": "usr_01HXYZ",
        "email": "alice@acme.com"
      },
      "gitRef": "main",
      "duration": 42,
      "startedAt": "2026-06-19T11:59:18.000Z",
      "completedAt": "2026-06-19T12:00:00.000Z"
    }
  }
}
```

#### `secret.created`

```json
{
  "id": "evt_01J4K9ABCDE",
  "event": "secret.created",
  "apiVersion": "2026-06-01",
  "orgId": "org_01HXYZ",
  "projectId": "proj_01HABC",
  "timestamp": "2026-06-19T12:05:00.000Z",
  "data": {
    "secret": {
      "id": "sec_01HXYZ",
      "key": "DATABASE_URL",
      "environmentId": "env_01HPROD",
      "environmentName": "production",
      "createdBy": {
        "userId": "usr_01HXYZ",
        "email": "alice@acme.com"
      }
    }
    // NOTE: Secret values are NEVER included in webhook payloads
  }
}
```

#### `member.invited`

```json
{
  "id": "evt_01J4KAFGHIJ",
  "event": "member.invited",
  "apiVersion": "2026-06-01",
  "orgId": "org_01HXYZ",
  "projectId": null,
  "timestamp": "2026-06-19T12:10:00.000Z",
  "data": {
    "invitation": {
      "inviteeEmail": "bob@acme.com",
      "orgRole": "member",
      "invitedBy": {
        "userId": "usr_01HXYZ",
        "email": "alice@acme.com"
      },
      "expiresAt": "2026-06-26T12:10:00.000Z"
    }
  }
}
```

> **Security invariant:** Secret values, API key secrets, and HMAC signing secrets are **never** included in any webhook payload, regardless of event type. Payloads contain only identifiers and metadata sufficient for the consumer to take action.

---

## 7. HMAC-SHA256 Signing

### 7.1 Signature Generation

SELADEV signs every webhook payload using HMAC-SHA256. The signature covers the raw JSON body bytes (not parsed and re-serialized) to prevent signing/verification discrepancies from whitespace or key ordering.

```ts
// apps/api/src/workers/webhook.worker.ts

function generateSignature(rawBody: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}
```

**Request header:**

```
X-SELADEV-Signature: sha256=3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4
X-SELADEV-Event: deployment.completed
X-SELADEV-Delivery: evt_01J4K8QZXYZ
X-SELADEV-Timestamp: 1750334400
User-Agent: SELADEV-Webhook/1.0
Content-Type: application/json
```

`X-SELADEV-Timestamp` contains the Unix timestamp of the delivery. Consumers should reject deliveries where `|now - timestamp| > 300` (5 minutes) to prevent replay attacks.

### 7.2 Signed Content

The signature is computed over the concatenation of the timestamp and raw body, separated by a period:

```
signedContent = `${timestamp}.${rawBody}`
signature = HMAC-SHA256(signedContent, webhookSecret)
```

This ties the signature to a specific timestamp, preventing replay of captured payloads.

### 7.3 Consumer Verification Guide (Node.js)

```ts
// Example: Express.js consumer endpoint

import express from 'express';
import crypto from 'crypto';

const app = express();

// IMPORTANT: Use raw body middleware, NOT json() — signature covers raw bytes
app.use('/webhooks/seladev', express.raw({ type: 'application/json' }));

app.post('/webhooks/seladev', (req, res) => {
  const signature = req.headers['x-seladev-signature'] as string;
  const timestamp = req.headers['x-seladev-timestamp'] as string;
  const rawBody = req.body as Buffer;

  if (!verifySignature(rawBody.toString('utf8'), timestamp, signature, process.env.WEBHOOK_SECRET!)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Replay attack prevention
  const deliveryAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (deliveryAge > 300) {
    return res.status(401).json({ error: 'Delivery timestamp too old' });
  }

  const payload = JSON.parse(rawBody.toString('utf8'));
  console.log(`Received event: ${payload.event}`);

  // Always respond 200 quickly — process async
  res.status(200).json({ received: true });

  // Process event asynchronously
  processWebhookEvent(payload).catch(console.error);
});

function verifySignature(
  rawBody: string,
  timestamp: string,
  receivedSignature: string,
  secret: string,
): boolean {
  const signedContent = `${timestamp}.${rawBody}`;
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(signedContent, 'utf8')
    .digest('hex')}`;

  // Use timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(receivedSignature, 'utf8'),
  );
}
```

### 7.4 Consumer Verification Guide (Python)

```python
import hmac
import hashlib
import time
from flask import Flask, request, jsonify

app = Flask(__name__)

WEBHOOK_SECRET = os.environ['WEBHOOK_SECRET']

@app.route('/webhooks/seladev', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-SELADEV-Signature', '')
    timestamp = request.headers.get('X-SELADEV-Timestamp', '')
    raw_body = request.get_data()  # raw bytes

    if not verify_signature(raw_body, timestamp, signature, WEBHOOK_SECRET):
        return jsonify({'error': 'Invalid signature'}), 401

    # Replay attack prevention
    delivery_age = abs(time.time() - int(timestamp))
    if delivery_age > 300:
        return jsonify({'error': 'Delivery timestamp too old'}), 401

    payload = request.get_json()
    event = payload.get('event')

    # Respond immediately; process async
    process_event.delay(payload)  # Celery task example
    return jsonify({'received': True}), 200


def verify_signature(raw_body: bytes, timestamp: str, received_sig: str, secret: str) -> bool:
    signed_content = f"{timestamp}.{raw_body.decode('utf-8')}".encode('utf-8')
    expected_sig = 'sha256=' + hmac.new(
        secret.encode('utf-8'),
        signed_content,
        hashlib.sha256,
    ).hexdigest()

    # Constant-time comparison
    return hmac.compare_digest(expected_sig, received_sig)
```

---

## 8. Delivery Mechanism

### 8.1 Flow

```
Event occurs in SELADEV (e.g., deployment completes)
    │
    ▼
EventEmitterService.emit('deployment.completed', context)
    │
    ▼
WebhookPublisher.publish(event, payload)
    │  - Queries webhooks matching event + orgId + projectId
    │  - Creates WebhookDelivery log entry (status: 'pending')
    │  - Enqueues one BullMQ job per matching webhook
    ▼
BullMQ 'webhooks' queue
    │
    ▼
WebhookWorker.process(job)
    │  - Decrypts webhook secret from MongoDB
    │  - Signs payload
    │  - HTTP POST to targetUrl (10s timeout)
    │  - Updates WebhookDelivery log entry
    │  - On failure: BullMQ schedules retry with backoff
    ▼
Consumer endpoint (external)
```

### 8.2 Publisher Implementation

```ts
// apps/api/src/features/webhooks/webhook.publisher.ts

export class WebhookPublisher {
  async publish(event: WebhookEventType, context: WebhookPublishContext): Promise<void> {
    // Find all active webhooks for this org/project that subscribe to this event
    const webhooks = await this.webhookRepo.findActive({
      orgId: context.orgId,
      projectId: context.projectId,
      event,
    });

    if (webhooks.length === 0) return;

    const payloadBase: Omit<WebhookPayload, 'id'> = {
      event,
      apiVersion: CURRENT_API_VERSION,
      orgId: context.orgId.toString(),
      projectId: context.projectId?.toString(),
      timestamp: new Date().toISOString(),
      data: context.data,
    };

    await Promise.all(
      webhooks.map(async (webhook) => {
        const deliveryId = new Types.ObjectId();
        const payload: WebhookPayload = {
          ...payloadBase,
          id: `evt_${deliveryId.toString()}`,
        };

        // Create delivery log entry
        await WebhookDeliveryModel.create({
          _id: deliveryId,
          webhookId: webhook._id,
          orgId: context.orgId,
          event,
          payload,
          status: 'pending',
          attemptsMade: 0,
          createdAt: new Date(),
        });

        // Enqueue delivery job
        await webhooksQueue.add(
          'deliver',
          {
            webhookId: webhook._id.toString(),
            orgId: context.orgId.toString(),
            event,
            payload,
            targetUrl: webhook.targetUrl,
            secret: await this.cryptoService.decrypt(webhook.secret),
            attempt: 1,
            deliveryId: deliveryId.toString(),
          } satisfies WebhookDeliveryJobData,
          {
            jobId: `webhook:${webhook._id}:${deliveryId}:1`,
            ...DEFAULT_BACKOFF_CONFIG,
          },
        );
      }),
    );
  }
}
```

---

## 9. Retry Logic

### 9.1 Retry Schedule

Failed deliveries are retried using exponential backoff. BullMQ manages the retry schedule — the worker simply `throw`s on failure.

| Attempt | Delay Before Next Attempt | Total Elapsed |
|---|---|---|
| 1 (initial) | — | 0s |
| 2 | 1 second | ~1s |
| 3 | ~5 seconds | ~6s |
| 4 | ~30 seconds | ~36s |
| 5 (final) | ~5 minutes | ~6m |
| Exhausted | → Dead letter | — |

### 9.2 Failure Conditions

A delivery attempt is considered failed if:
- HTTP status is `4xx` (except `429 Too Many Requests`) or `5xx`
- The request times out after 10 seconds (`AbortSignal.timeout(10_000)`)
- A network error occurs (DNS failure, connection refused, TLS error)

`429 Too Many Requests` is treated as a retryable error. The `Retry-After` response header is honored as the delay before the next attempt.

`410 Gone` is treated as a permanent failure — the webhook is automatically disabled and the admin is notified.

### 9.3 Auto-Disable on Persistent Failure

If a webhook accumulates 100 consecutive failed deliveries (tracked via `failureStreak` on the `Webhook` document), it is automatically disabled:

```ts
// Called after each failed delivery in the webhook worker:
await WebhookModel.findByIdAndUpdate(webhookId, {
  $inc: { failureStreak: 1 },
  $set: { lastDeliveryStatus: 'failed', lastDeliveryAt: new Date() },
});

const updated = await WebhookModel.findById(webhookId);
if (updated.failureStreak >= 100) {
  await WebhookModel.findByIdAndUpdate(webhookId, {
    active: false,
    disabledAt: new Date(),
  });
  await notifyAdmins(orgId, 'webhook_auto_disabled', { webhookId, webhookName: updated.name });
}
```

`failureStreak` is reset to 0 on every successful delivery.

---

## 10. Delivery Log

### 10.1 Schema

```ts
// MongoDB collection: webhookDeliveries

interface WebhookDelivery {
  _id: ObjectId;
  webhookId: ObjectId;
  orgId: ObjectId;
  event: WebhookEventType;
  payload: WebhookPayload;      // full payload stored for debugging
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  attemptsMade: number;
  attempts: Array<{
    attemptNumber: number;
    startedAt: Date;
    completedAt?: Date;
    durationMs?: number;
    httpStatus?: number;
    responseBody?: string;        // truncated to 1KB
    errorMessage?: string;
  }>;
  deliveredAt?: Date;
  createdAt: Date;
  expiresAt: Date;               // TTL field — 90 days after createdAt
}
```

### 10.2 Retention Policy

Delivery log entries are automatically expired by MongoDB TTL index after **90 days**:

```ts
WebhookDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

The `expiresAt` field is set to `createdAt + 90 days` at document creation time. This provides a 3-month debugging window without indefinite storage growth.

### 10.3 Delivery Log API

```
GET /api/v1/orgs/:orgId/webhooks/:webhookId/deliveries
  ?status=failed        // filter by status
  ?event=deployment.*   // filter by event (supports glob)
  ?limit=50
  ?cursor=<cursor>

GET /api/v1/orgs/:orgId/webhooks/:webhookId/deliveries/:deliveryId
```

Delivery log access requires `webhook:read` permission.

---

## 11. Webhook Secret Rotation

### 11.1 Rotation Flow

Secret rotation generates a new secret and replaces the old one atomically. There is a **grace period** of 10 minutes during which SELADEV accepts signatures from both the old and new secrets. This allows consumers to update their secret without missing deliveries.

```
1. POST /webhooks/:id/rotate-secret
2. New secret generated and stored (encrypted)
3. Old secret stored as `previousSecret` with `previousSecretExpiresAt = now + 10 min`
4. Response: { secret: "whsec_NEW..." }
5. Consumer updates their secret
6. After 10 minutes: `previousSecret` cleared
```

```ts
// During signature verification (worker):
function verifyWithGracePeriod(body: string, timestamp: string, received: string, webhook: Webhook): boolean {
  const current = verifySignature(body, timestamp, received, webhook.secret);
  if (current) return true;

  // Check grace period for rotated secret
  if (webhook.previousSecret && webhook.previousSecretExpiresAt > new Date()) {
    return verifySignature(body, timestamp, received, webhook.previousSecret);
  }

  return false;
}
```

### 11.2 Rotation Audit Log

Every secret rotation is recorded in the audit log:

```json
{
  "action": "webhook:secret_rotated",
  "resource": { "type": "webhook", "id": "...", "name": "Slack Deployments" },
  "actor": { "userId": "...", "email": "alice@acme.com", "orgRole": "admin" },
  "timestamp": "2026-06-19T12:30:00.000Z"
}
```

---

## 12. Event Filtering

Each webhook specifies the set of events it subscribes to. Unsubscribed events are never delivered and never create delivery log entries.

```ts
// When creating a webhook:
{
  "events": ["deployment.completed", "deployment.failed"]
  // Only these events will trigger deliveries for this webhook
}
```

Wildcard subscriptions are **not** supported via the API for security and cost reasons. Consumers must enumerate the events they need.

**Event filtering at publish time:**

```ts
// WebhookRepository.findActive: query includes event filter
const webhooks = await WebhookModel.find({
  orgId,
  $or: [{ projectId }, { projectId: null }],  // org-level or project-specific
  events: event,     // MongoDB $in match — event must be in the events array
  active: true,
});
```

---

## 13. Testing Webhooks

### 13.1 Manual Test Delivery

Consumers can trigger a synthetic `webhook.test` event from the SELADEV dashboard or API:

```
POST /api/v1/orgs/:orgId/webhooks/:webhookId/test

Response 202:
{
  "deliveryId": "del_01HTEST",
  "message": "Test delivery enqueued"
}
```

The test payload uses the standard envelope with `event: "webhook.test"` and a synthetic `data` object:

```json
{
  "id": "evt_test_01HXYZ",
  "event": "webhook.test",
  "apiVersion": "2026-06-01",
  "orgId": "org_01HXYZ",
  "timestamp": "2026-06-19T12:00:00.000Z",
  "data": {
    "message": "This is a test delivery from SELADEV.",
    "webhookId": "whk_01HXYZ",
    "webhookName": "Slack Deployments"
  }
}
```

### 13.2 Delivery Log UI

The SELADEV dashboard provides a delivery log view per webhook:
- Lists all deliveries with status, event type, timestamp, and duration
- Shows per-attempt detail: HTTP status, response body (truncated), error message
- Allows manual retry of any failed delivery
- Shows the full raw payload for debugging

### 13.3 Local Development Testing

During local development, consumers can use [Hookdeck](https://hookdeck.com/) or [ngrok](https://ngrok.com/) to expose a local endpoint:

```bash
# ngrok example
ngrok http 3001
# Use the ngrok HTTPS URL as the webhook targetUrl in SELADEV dashboard
```

For integration testing within the SELADEV monorepo, the test suite uses `@webhook-testing/mock-server` to spin up a local HTTP server and assert delivery calls:

```ts
// apps/api/src/features/webhooks/__tests__/webhook-delivery.test.ts

const server = await createMockWebhookServer({ port: 0 });

const webhook = await createTestWebhook({
  targetUrl: server.url,
  events: ['deployment.completed'],
});

await triggerDeployment(testProject._id);
await waitForDelivery(server, { timeout: 5000 });

expect(server.lastRequest.headers['x-seladev-event']).toBe('deployment.completed');
expect(verifyTestSignature(server.lastRequest)).toBe(true);

await server.close();
```

---

## 14. Security Considerations

### 14.1 SSRF Prevention

Webhook targets must be public internet endpoints. SELADEV blocks delivery to private IP ranges, localhost, and internal cloud metadata endpoints:

```ts
// apps/api/src/features/webhooks/webhook.validator.ts

import ipRangeCheck from 'ip-range-check';

const BLOCKED_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '::1/128',
  '169.254.0.0/16',  // AWS/GCP metadata
  'fc00::/7',
  'fe80::/10',
];

export async function validateWebhookUrl(url: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Webhook URL must use HTTPS');
  }

  // Resolve DNS and check resolved IPs
  const { addresses } = await dns.promises.lookup(parsed.hostname, { all: true });

  for (const { address } of addresses) {
    if (ipRangeCheck(address, BLOCKED_RANGES)) {
      throw new ValidationError(
        `Webhook URL resolves to a blocked IP range: ${address}`,
      );
    }
  }
}
```

DNS resolution is performed at registration time **and** at delivery time to prevent DNS rebinding attacks. If the resolved IP changes between registration and delivery to a blocked range, the delivery is rejected.

### 14.2 Secret Storage

Webhook secrets are stored encrypted using AES-256-GCM:

```ts
// The stored value in MongoDB:
{
  secret: "enc:AES256GCM:iv:ciphertext:authTag"
}

// Decrypted only in-memory during the delivery worker processor
// Never logged, never returned in API responses (after creation)
```

### 14.3 Payload Size Limit

Webhook payloads are capped at **256KB**. If a payload would exceed this (unlikely for current event types), it is truncated and a `payload_truncated: true` flag is set in the envelope. This prevents memory exhaustion in consumer endpoints.

### 14.4 Request Headers Security

- `User-Agent: SELADEV-Webhook/1.0` — allows consumers to filter their access logs
- No `Authorization` headers are sent — authentication relies solely on HMAC verification
- Custom headers configured per-webhook are sanitized to remove reserved headers (`Host`, `Content-Length`, etc.)

### 14.5 TLS Enforcement

All webhook deliveries require HTTPS. HTTP URLs are rejected at registration. TLS certificate validation is strict — self-signed certificates are rejected. Consumers using internal certificates must use a valid CA-signed cert or configure a public-facing proxy.

---

## 15. Tradeoffs

| Option Considered | Decision | Reason |
|---|---|---|
| Symmetric HMAC-SHA256 | **Accepted** | Sufficient for payload verification; industry standard (Stripe, GitHub, Shopify all use this) |
| Asymmetric signing (RS256) | Rejected | Added complexity for consumers (must manage public key); no clear benefit at this scale |
| HTTP GET with event data in query params | Rejected | Body-less GET cannot be signed meaningfully; payload size limits |
| WebSockets for event delivery | Rejected | Stateful connections don't suit external consumer integrations; webhooks are simpler |
| Delivery TTL of 30 days | Rejected | Too short for compliance use cases; 90 days is standard |
| Delivery TTL of 1 year | Rejected | Excessive storage cost for high-volume orgs |
| Wildcard event subscriptions (`deployment.*`) | Rejected | Hard to reason about cost and rate limits; explicit subscriptions are clearer |
| Validating `Retry-After` for all 4xx | Rejected | Only `429` semantically warrants it; other 4xx indicate consumer misconfiguration |

---

## 16. Future Improvements

### 16.1 Webhook Versioning

As SELADEV's event schema evolves, a breaking change (e.g., renaming a field) would break all consumers simultaneously. The `apiVersion` field in the payload envelope is designed to support versioning:

```
POST /api/v1/orgs/:orgId/webhooks
{
  "apiVersion": "2026-06-01"   // consumer requests a specific version
}
```

SELADEV would maintain transformers to serialize event data into the format expected by each `apiVersion`, enabling consumers to migrate on their own timeline.

### 16.2 Asynchronous Signature Verification

For very high-throughput consumers, synchronous HMAC verification on every request can become a CPU bottleneck. A verification proxy (similar to Svix's approach) can offload verification to a sidecar, returning a pre-verified request context to the consumer application.

### 16.3 Webhook Metrics per Consumer

Expose per-webhook delivery metrics via API:
- Success rate over last 24h / 7d / 30d
- Average response time per target URL
- Event volume by type

This enables consumers to proactively detect degradation in their endpoint health.

### 16.4 Webhook Catalog in Dashboard

A visual event catalog in the SELADEV dashboard that shows:
- All available event types with descriptions and example payloads
- Per-event delivery count and success rate for the org
- One-click subscription to events when creating a new webhook

### 16.5 Svix Migration Path

For orgs requiring enterprise-grade webhook infrastructure (fan-out to thousands of endpoints, per-consumer portal, advanced filtering), SELADEV could delegate webhook delivery to [Svix](https://www.svix.com/). The `WebhookPublisher` abstraction is designed to support this swap:

```ts
// Future: replace internal BullMQ publisher with Svix client
class SvixWebhookPublisher implements WebhookPublisher {
  async publish(event: WebhookEventType, context: WebhookPublishContext): Promise<void> {
    await svix.message.create(context.orgId.toString(), {
      eventType: event,
      payload: buildPayload(event, context),
    });
  }
}
```
