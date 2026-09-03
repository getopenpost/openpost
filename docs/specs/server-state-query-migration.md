# Server-state query migration

## Decision

Use TanStack Query as the owner of cache-safe remote state in the web and mobile apps. The web app adopts `@tanstack/svelte-query`; mobile keeps `@tanstack/react-query`. Both consume framework-neutral query definitions from one package.

The cache stays in memory. This work does not add offline mutation replay or persist publication, account, or Workspace data on device storage.

## Module interfaces

- `@openpost/api-contract` owns the generated TypeScript OpenAPI declarations.
- `@openpost/query-catalog` owns typed reads, query keys, parameter normalization, freshness, cancellation, retry classification, detail seeding, and affected-key calculation.
- Web and mobile adapters own their Query clients, framework hooks, authentication lifecycle, connectivity, navigation prefetch, loading UI, and user feedback.
- Selected Workspace state, unsaved edits, editor history, dialogs, toasts, localization, and haptics stay outside Query.

Every Workspace read key contains its Workspace ID and every result-changing request parameter. Credentials never appear in a key. The whole cache clears when the authenticated actor changes, or when mobile changes server or token. Workspace changes retain inactive, Workspace-partitioned cache entries.

## Bootstrap contract

`GET /api/v1/app/bootstrap` accepts an optional `preferred_workspace_id` query parameter and returns:

```ts
type AppBootstrapResponse = {
  authenticated: boolean;
  user: UserProfile | null;
  workspaces: WorkspaceResponse[];
  selected_workspace_id: string | null;
  selected_workspace_settings: WorkspaceSettingsResponse | null;
};
```

No or invalid credentials return the anonymous shape. For an authenticated request, an accessible preferred Workspace wins. Otherwise the first Workspace in the existing organization and name order wins. An SSO-blocked Workspace may be selected, but its settings remain null. Existing auth, Workspace, and settings endpoints remain compatible.

Web ships with the endpoint. Mobile falls back to the existing auth, Workspace, and settings reads only when an older server returns 404 or 405. It remembers that capability in memory for the server's process session.

## Query policy

- Ordinary state stays fresh for 30 seconds and remains cached while inactive for 30 minutes.
- Stable catalogs and capabilities stay fresh for five minutes.
- Live publication and job state uses a named 15-second policy or existing bounded polling while work remains active.
- Reads retry once for network failures, 408, 425, 429, and 5xx. Mutations do not retry unless the operation already proves idempotency.
- Query functions forward their abort signal. Active stale reads refetch after reconnect. Focus refresh is opt-in for named live queries.
- Full entity responses seed exact detail keys. Mutations invalidate only affected lists, dates, status buckets, accounts, and aggregates.

## Loading behavior

Each route owns one first-viewport loading boundary and starts independent reads together. Nested children do not create a second sequence of loaders for reads the route can start. The editors hub is the recorded exception: it composes independent image and video sections, so each section keeps its own delayed boundary while the shared header and search stay mounted.

- With no usable data, wait 150 ms before showing a content-shaped page loader.
- Keep cached data visible during background refresh.
- Initial failures show a retryable inline error. Background failures keep stale content visible with a non-blocking notice.
- Show an empty state only after a successful zero-result response.
- Previous data may bridge parameter changes inside one Workspace. It never crosses a Workspace change.

## Compatibility and exclusions

Keep blobs, uploads, downloads, streams, OAuth redirects, pairing, one-time tokens, health probes, AI generation, and local editor operations in imperative adapters. Preserve legal acceptance, SSO, first-use destination selection, permissions, mobile server selection, and unsaved-work guards.

The migration proceeds by domain. A legacy store may temporarily delegate to Query, but Query and a manual TTL cache must not own the same resource independently. Each domain commit remains independently revertible. The bootstrap endpoint is additive and needs no database migration.

## Acceptance

- Cold authenticated web startup performs one bootstrap request before any genuinely dependent read.
- Equal concurrent keys perform one request.
- Returning to a route within 30 seconds performs no read. Returning within 30 minutes renders cached data before any background refresh.
- Workspace and actor changes never display data from the previous scope.
- List and create responses open publication detail or editor without a duplicate detail read.
- Web Activity and mobile Calendar prove cancellation, cached navigation, background errors, and exact request counts before the migration expands.
- Backend, contracts, frontend, application browser tests, UI consistency, mobile checks, an Android APK build, and the release check pass at the final candidate.
