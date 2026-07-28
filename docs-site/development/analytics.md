# Analytics Architecture

Analytics is an optional platform capability, not part of the core publishing adapter. This keeps publishing stable and leaves room for future inbox, notification, and messaging capabilities without creating one large provider interface.

## Boundaries

`platform.AnalyticsAdapter` is optional and declares account and content support plus required scopes. Its methods return normalized counters. Missing keys mean “not reported”; zero means the provider returned a measured zero.

The publishing `platform.Adapter` remains unchanged. Existing `platform.CommentAdapter` also remains separate. Future social hub work should add focused capabilities, such as notification queries or message conversations, with their own authorization, cursors, retention rules, and audit events. It should not add these methods to either the publishing or analytics interface.

## Persistence

- `analytics_account_snapshots` stores immutable normalized account measurements.
- `analytics_rendition_snapshots` stores one aggregate measurement per canonical rendition. Thread segment provider IDs are collected together and OpenPost's own replies are removed from reply totals.
- `analytics_sync_states` stores the latest metrics, collection status, safe error code, last attempt and success, next due time, and unchanged streak.

Snapshots include workspace and provider identity for scoped queries and deletion. Raw provider payloads are intentionally discarded.

## Jobs and cadence

The worker handles `analytics_sweep`, `analytics_account_sync`, and `analytics_rendition_sync`. A partial unique job index prevents duplicate active work for the same subject. The sweep runs every 15 minutes, queues only due subjects, and always schedules its successor.

Account checks start on a daily cadence. Publication checks use 1, 3, 12, and 24 hour bands until day 7. Repeated unchanged results can increase the current interval to 8× its base cadence. Manual refresh covers publications from the last 90 days.

Permission and unsupported states do not consume provider quota. OpenPost re-evaluates them during sweeps so reconnects and newly added adapter support recover without manual database changes. Rate limits preserve the last successful values and use the provider's retry hint when available.

The sweep uniqueness rule applies to pending sweeps. A running sweep can queue its successor, and worker recovery marks a stale running sweep complete when that successor already exists. Do not broaden the sweep index to pending and processing rows without changing this lifecycle.

## API and UI

`GET /api/v1/analytics` reads stored data only. It never turns page load into a fan-out of provider requests. `POST /api/v1/analytics/refresh` requires editor access and queues collection; workspace viewers can read results.

The API preserves engagement types and exposure types. The frontend uses generated OpenAPI types and presents views, impressions, and reach independently.
