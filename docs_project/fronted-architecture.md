# Frontend Architecture

**Document Type:** Frontend Architecture  
**Status:** Active  
**Last Updated:** 2025-01  
**Authors:** Platform Engineering

---

## Purpose

This document defines the frontend architecture for the IDP web application. It covers the component model, state management strategy, data fetching patterns, routing structure, and the reasoning behind every major tooling decision. It serves as the canonical reference for frontend engineering.

---

## Context

The IDP frontend is a single-page application (SPA) targeting authenticated internal users — engineers and platform team members who use the dashboard daily. It is not a public-facing marketing site. The UX requirements are:

- **Data-heavy dashboards** — deployment timelines, audit logs, secret lists, analytics charts.
- **Real-time updates** — deployment status changes, incoming notifications, environment health.
- **Complex forms** — multi-step project creation, secret management, webhook configuration.
- **Strict access rendering** — UI components must respect RBAC (hide/disable controls based on role).

---

## Technology Decisions

### Vite over Create React App
CRA is deprecated. Vite provides sub-second HMR, native ESM, and a significantly smaller config surface. Build times for the IDP are ~800ms cold vs. 8-12s with webpack-based setups.

### TanStack Query for Server State
Server state (API data) and client state (UI toggles, form values) have fundamentally different lifecycles. TanStack Query manages all server state: caching, background refetching, deduplication, and optimistic updates. Zustand manages the small amount of true client state that has no server counterpart.

**Decision rationale:** The alternative — managing all state in Redux with RTK Query — conflates the two concerns and requires more boilerplate for the same outcome. TanStack Query's stale-while-revalidate model matches the IDP's dashboard use case precisely.

### Zustand over Redux
The IDP has minimal global client state: the active organization context, theme preference, notification drawer open/closed state, and WebSocket connection status. Zustand provides this with minimal boilerplate and no need for reducers, action creators, or selectors for 4-5 pieces of state.

Redux is appropriate when state is complex, highly relational, and requires middleware for side effects. That describes none of the IDP's client state.

### shadcn/ui over a component library
shadcn/ui is not a component library — it is a collection of copy-owned components built on Radix UI primitives and styled with Tailwind. The IDP owns the component source code. This means:
- No version lock-in or breaking upgrades from a third-party library.
- Full control over styling, behavior, and accessibility.
- Radix primitives provide WAI-ARIA compliance without custom implementation.

The tradeoff is more initial setup and a larger bundle of owned code. For a long-lived internal tool, this is the correct trade.

---

## Folder Structure

```
apps/web/src/
├── app/                      # App shell, routing, providers
│   ├── App.tsx
│   ├── router.tsx
│   └── providers.tsx
│
├── features/                 # Feature modules (primary code location)
│   ├── auth/
│   │   ├── components/       # Login, Register, MFA forms
│   │   ├── hooks/            # useAuth, useCurrentUser
│   │   ├── api/              # Auth API calls (TanStack Query)
│   │   ├── stores/           # Auth Zustand slice
│   │   └── types.ts
│   │
│   ├── projects/
│   │   ├── components/
│   │   │   ├── ProjectList/
│   │   │   ├── ProjectCard/
│   │   │   └── CreateProjectModal/
│   │   ├── hooks/
│   │   ├── api/
│   │   └── types.ts
│   │
│   ├── secrets/
│   ├── deployments/
│   ├── webhooks/
│   ├── audit-logs/
│   ├── api-keys/
│   ├── members/
│   ├── notifications/
│   └── analytics/
│
├── components/               # Shared UI components
│   ├── ui/                   # shadcn/ui base components (owned)
│   ├── layout/               # Shell, Sidebar, Header, PageHeader
│   ├── data-display/         # DataTable, StatusBadge, CopyButton
│   ├── feedback/             # Toast, ConfirmDialog, EmptyState
│   └── forms/                # FieldWrapper, SecretInput, TagInput
│
├── hooks/                    # Shared, non-feature-specific hooks
│   ├── useDebounce.ts
│   ├── useLocalStorage.ts
│   ├── useWebSocket.ts
│   └── usePermission.ts
│
├── lib/                      # Framework config and utilities
│   ├── api-client.ts         # Axios instance, interceptors
│   ├── query-client.ts       # TanStack Query client config
│   ├── socket.ts             # Socket.IO client setup
│   └── utils.ts
│
├── stores/                   # Zustand stores (app-wide)
│   ├── org.store.ts          # Active org, org switching
│   ├── notifications.store.ts
│   └── ui.store.ts           # Theme, sidebar state
│
└── types/                    # Global TypeScript types
    ├── api.types.ts           # API response shapes (mirrors packages/types)
    └── rbac.types.ts
```

**Feature module rule:** All code related to a feature lives in its `features/<name>/` directory. A component from `features/projects/` must never import directly from `features/secrets/`. Cross-feature communication goes through shared hooks, stores, or the router.

---

## State Management Architecture

```
┌─────────────────────────────────────────────────────┐
│                   State Sources                      │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────────┐ │
│  │   TanStack Query   │  │       Zustand          │ │
│  │   (Server State)   │  │    (Client State)      │ │
│  │                    │  │                        │ │
│  │  • Projects list   │  │  • Active org ID       │ │
│  │  • Secret names    │  │  • Theme preference    │ │
│  │  • Deployments     │  │  • Sidebar open        │ │
│  │  • Audit logs      │  │  • WS conn status      │ │
│  │  • Notifications   │  │  • Unread notif count  │ │
│  └────────────────────┘  └────────────────────────┘ │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────────┐ │
│  │   React Hook Form  │  │    URL / Router        │ │
│  │   (Form State)     │  │    (Navigation State)  │ │
│  │                    │  │                        │ │
│  │  • Create project  │  │  • Active project      │ │
│  │  • Edit webhook    │  │  • Active environment  │ │
│  │  • Secret values   │  │  • Pagination page     │ │
│  └────────────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Rule: Never duplicate server state in Zustand
If data comes from the API, it belongs in TanStack Query's cache. Do not copy it into Zustand. The only exception is derived/computed values that have no server equivalent (e.g., unread notification count computed from the notifications query result).

---

## Data Fetching Patterns

### API Client

A single Axios instance is configured with:
- Base URL from env
- JWT attach interceptor (reads from memory store, not localStorage)
- 401 interceptor → triggers token refresh → retries original request
- Request ID header injection
- Response unwrapping (extracts `data` from envelope)

```typescript
// lib/api-client.ts
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15_000,
});

// Attach token
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 → refresh
apiClient.interceptors.response.use(
  (res) => res.data.data,  // Unwrap envelope
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      await refreshAccessToken();
      return apiClient(error.config);
    }
    return Promise.reject(normalizeApiError(error));
  }
);
```

**Security note:** The access token is stored in Zustand (in-memory JavaScript), not `localStorage`. `localStorage` is readable by any JavaScript on the page (XSS risk). In-memory tokens are lost on page refresh, which is why the refresh token cookie (HttpOnly) is used to silently re-authenticate on page load.

### Query Key Convention

TanStack Query keys are defined as factory functions to enable precise cache invalidation:

```typescript
// features/projects/api/query-keys.ts
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (orgId: string, filters: ProjectFilters) =>
    [...projectKeys.lists(), orgId, filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (projectId: string) =>
    [...projectKeys.details(), projectId] as const,
};

// Usage
useQuery({ queryKey: projectKeys.detail(projectId), queryFn: ... });

// Invalidate all project queries after mutation
queryClient.invalidateQueries({ queryKey: projectKeys.all });
// Invalidate only the list
queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
```

### Optimistic Updates

For high-frequency mutations where the user expects instant feedback (toggling a webhook, updating an environment variable), optimistic updates are used:

```typescript
const updateEnvVar = useMutation({
  mutationFn: (vars) => api.environments.updateVariable(envId, vars),
  onMutate: async (newVar) => {
    await queryClient.cancelQueries({ queryKey: envKeys.detail(envId) });
    const previous = queryClient.getQueryData(envKeys.detail(envId));
    queryClient.setQueryData(envKeys.detail(envId), (old) => ({
      ...old,
      variables: old.variables.map(v => v.key === newVar.key ? newVar : v)
    }));
    return { previous };
  },
  onError: (err, vars, context) => {
    queryClient.setQueryData(envKeys.detail(envId), context.previous);
    toast.error('Failed to update variable');
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: envKeys.detail(envId) });
  }
});
```

---

## Routing

React Router v6 with data loaders. Routes are defined centrally in `app/router.tsx`:

```
/                           → Redirect to /dashboard
/login                      → AuthLayout > LoginPage
/register                   → AuthLayout > RegisterPage

/dashboard                  → AppLayout > DashboardPage
/projects                   → AppLayout > ProjectsPage
/projects/:projectId        → AppLayout > ProjectDetailPage
  /projects/:projectId/environments/:envId
  /projects/:projectId/environments/:envId/secrets
  /projects/:projectId/deployments
  /projects/:projectId/webhooks
  /projects/:projectId/members
  /projects/:projectId/settings

/api-keys                   → AppLayout > ApiKeysPage
/audit-logs                 → AppLayout > AuditLogsPage
/analytics                  → AppLayout > AnalyticsPage
/notifications              → AppLayout > NotificationsPage
/settings                   → AppLayout > OrgSettingsPage
/settings/profile           → AppLayout > ProfilePage

/403                        → ErrorPage
/404                        → ErrorPage
```

**Protected route wrapper** checks authentication state and org membership. Unauthenticated users are redirected to `/login` with the attempted URL preserved in `redirect` query param.

---

## RBAC in the UI

The `usePermission` hook resolves permissions from the current user's role (from TanStack Query, not a separate state):

```typescript
// hooks/usePermission.ts
export function usePermission(resource: string, action: string): boolean {
  const { data: membership } = useMembership();
  const { data: projectMembership } = useProjectMembership();
  return resolvePermission(membership?.role, projectMembership?.role, resource, action);
}

// Usage in component
function SecretCard({ secret }) {
  const canEdit = usePermission('secrets', 'write');
  const canDelete = usePermission('secrets', 'delete');

  return (
    <div>
      <span>{secret.name}</span>
      {canEdit && <EditButton />}
      {canDelete && <DeleteButton />}
    </div>
  );
}
```

**Rule:** RBAC in the UI is UX, not security. The API enforces permissions on every request. The frontend hides/disables controls so users don't attempt actions they cannot complete — it does not protect data.

---

## Real-Time Integration (Socket.IO)

The Socket.IO client connects on authentication and subscribes to org-scoped rooms:

```typescript
// lib/socket.ts
export const socket = io(import.meta.env.VITE_WS_URL, {
  autoConnect: false,
  auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
});

// Reconnect with new token after refresh
useAuthStore.subscribe((state) => {
  if (state.accessToken) {
    socket.auth = { token: state.accessToken };
    socket.connect();
  } else {
    socket.disconnect();
  }
});
```

Real-time events invalidate TanStack Query caches rather than directly updating state:

```typescript
// features/deployments/hooks/useDeploymentSocket.ts
useEffect(() => {
  socket.on('deployment:status_changed', ({ deploymentId }) => {
    queryClient.invalidateQueries({ queryKey: deploymentKeys.detail(deploymentId) });
    queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
  });

  socket.on('notification:new', (notification) => {
    notificationStore.getState().increment();
    queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  });

  return () => {
    socket.off('deployment:status_changed');
    socket.off('notification:new');
  };
}, [queryClient]);
```

This keeps TanStack Query as the single source of truth for server data. Socket events are triggers for cache invalidation, not separate state updates.

---

## Form Architecture

All forms use React Hook Form with Zod resolvers. Schemas are imported from `packages/validators/` (shared with the backend):

```typescript
import { createProjectSchema } from '@idp/validators';

const form = useForm<CreateProjectInput>({
  resolver: zodResolver(createProjectSchema),
  defaultValues: { name: '', slug: '', visibility: 'private' },
});
```

**Multi-step forms** use a controlled step index with individual Zod schemas per step, validated progressively. The full form data is assembled and submitted only on the final step.

---

## Error Handling

API errors are normalized to a consistent shape by the Axios interceptor. Components use an `ErrorBoundary` for unexpected render errors and display inline error states for expected API failures:

```typescript
// Expected API error in component
const { data, error, isError } = useQuery(projectKeys.detail(id), fetchProject);

if (isError) {
  if (error.code === 'RESOURCE_NOT_FOUND') return <NotFoundState />;
  return <ErrorState message={error.message} />;
}
```

Toast notifications are used for mutation success/failure states. They are never used for data loading states — those use inline skeletons.

---

## Performance Strategy

- **Route-level code splitting** — each page route is a lazy import. Initial bundle contains only the app shell and auth routes.
- **TanStack Query caching** — `staleTime: 30_000` for slow-changing data (project list, member list). `staleTime: 0` for real-time data (deployment status, audit logs).
- **Virtualized lists** — audit logs and deployment history use `@tanstack/virtual` for rendering 10,000+ rows without DOM pressure.
- **Image optimization** — user avatars served via CDN with `srcSet` for responsive sizing.

---

## Future Improvements

- **React Server Components** — Once Vite RSC support matures, server-render the dashboard shell and initial data for faster time-to-interactive.
- **Storybook** — Component isolation and visual regression testing. Deferred to avoid setup overhead during initial feature development.
- **i18n** — `react-i18next` can be layered in once the component structure stabilizes. All user-visible strings should be extracted to constants in the interim.
- **E2E test coverage** — Playwright specs for critical user journeys (login, create project, create secret, trigger deployment).