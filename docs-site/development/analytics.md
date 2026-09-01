# Analytics Architecture

Analytics is an optional platform feature, not part of the core publishing adapter. Publishing, analytics, comments, and inboxes use separate interfaces so a network can support only the features its API allows.

This page is for contributors changing analytics collection, storage, or presentation boundaries.

## Boundaries

`platform.AnalyticsAdapter` is optional and declares account and OpenPost-managed content support plus required scopes. Its methods return normalized counters. Missing keys mean “not reported”; zero means the provider returned a measured zero. Every metric carries a unit, aggregation meaning, provider source, and reporting period where applicable.

`platform.AccountContentDiscoverer` is a separate optional seam for bounded provider inventory. Batch measurement remains optional and keys every result by stable provider content ID. The publishing `platform.Adapter` remains unchanged. `platform.CommentAdapter`, `platform.EngagementAdapter`, and `platform.MessagingAdapter` stay separate from it and from analytics. Each read path has its own access checks, cursors, data limits, and audit records.

## Persistence

- `analytics_account_snapshots` stores immutable normalized account measurements.
- `analytics_rendition_snapshots` stores one total per published Rendition. Thread segment IDs are collected together and OpenPost's own replies are removed from reply totals.
- `account_contents` stores the read-only inventory for eligible content published with OpenPost or elsewhere, including bounded normalized title and text, a provider-validated external URL, origin confidence, and an optional exact Rendition link.
- `analytics_account_content_snapshots` stores immutable measurements for discovered content.
- `account_content_discovery_states` owns opaque provider cursors, backfill coverage, safe failures, cadence, and read budgets.
- `account_content_observations` stores normalized provider-neutral events without webhook payloads.
- `analytics_sync_states` stores the latest metrics, collection status, safe error code, last attempt and success, next due time, and unchanged streak.

Snapshots include workspace and provider identity for scoped queries and deletion. Raw provider payloads, remote media, access tokens, bot credentials, and webhook secrets are intentionally discarded. Discovery job payloads contain only Workspace and Social Account IDs.

## Jobs and cadence

The worker handles `analytics_sweep`, `analytics_account_sync`, `analytics_rendition_sync`, and `account_content_discovery`. A partial unique job index prevents duplicate active work for the same subject. The sweep runs every 15 minutes, queues only due subjects, and always schedules its successor. Each discovery job processes one bounded page, commits its cursor with the page, and then requests a continuation.

Account checks start on a daily cadence. Rendition checks use 1, 3, 12, and 24 hour bands until day 7. Repeated unchanged results can increase the current interval to 8× its base cadence. Initial account-content discovery targets 90 days and at most 250 items, then runs no more than daily. Provider concurrency, per-account read budgets, stored backoff, and `Retry-After` apply to scheduled and manual refresh alike. X discovery defaults to a zero read budget unless the operator grants one.

Permission and unsupported states do not consume provider quota. OpenPost re-evaluates them during sweeps so reconnects and newly added adapter support recover without manual database changes. Rate limits preserve the last successful values and use the provider's retry hint when available.

The sweep uniqueness rule applies to pending sweeps. A running sweep can queue its successor, and worker recovery marks a stale running sweep complete when that successor already exists. Do not broaden the sweep index to pending and processing rows without changing this lifecycle.

## API and UI

`GET /api/v1/analytics` reads stored data only. It accepts `source=all|openpost|external`; the source, account, sort, range, and offset are bound into the opaque next cursor. It returns whole-account coverage, flat discriminated content references, metric metadata, and server-owned insights calculated before content pagination. Account growth remains explicitly account-wide. Page reads never call a provider.

`POST /api/v1/analytics/refresh` requires editor access and reconsiders collection without bypassing provider gates. `POST /api/v1/analytics/repurpose` accepts a Workspace ID, discriminated content reference, and range in the request body. It recomputes bounded evidence and returns a fresh local composer handoff without writing a Publication, changing the source, or calling an AI provider.

The API preserves engagement and exposure types. The frontend and mobile declarations are regenerated from Huma through OpenAPI. Analytics is intentionally not a first-class CLI or MCP workflow; their parity documentation continues to mark it unavailable rather than publishing a divergent contract.
