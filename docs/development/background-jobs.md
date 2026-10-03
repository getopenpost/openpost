# Background Jobs

This page is for contributors changing durable background work.

OpenPost uses durable background jobs stored in the configured database.

## Why

- Publishing must survive process restarts
- Scheduled work should not disappear when an HTTP request ends
- Simple deployments should not need Redis

## Guidance

If a feature must continue after the request completes, put it in the jobs table instead of launching an unmanaged goroutine.

Workers recover jobs left in `processing` by dead workers after the stale lock window and return them to `pending` without incrementing attempts. Job payload workspace scoping uses database-portable JSON expressions so the same queue paths work on SQLite and Postgres.

## Inspecting Jobs

- Use `GET /api/v1/jobs?limit=50&offset=0` for the operator-facing job feed.
- The response body stays a raw job array for existing clients.
- Pagination metadata is returned through `X-Total-Count`, `X-Limit`, `X-Offset`, `X-Next-Offset`, and `X-Has-More`.
- The CLI mirrors this with `openpost jobs list --limit 50 --offset 50`.

## Reply collection outcomes

A successful `engagement_sync` job means the collection outcome was saved. It does not prove the provider returned replies. Collection cadence and provider backoff belong to `engagement_sync_states`, rather than a second queue retry loop.

Inspect `sync_states` in `GET /api/v1/engagement?workspace_id=...` for each post's status, error code and next collection time. A successful provider read clears that post's error, including when no new replies exist. Other failed posts retain their state.

Worker logs report failed collection with the rendition, account, platform, recovery status, stable provider code, and bounded subcode or trace ID when available. They never include provider response text, request URLs or credentials. Meta permission and expired-token codes require account recovery, even when Graph reports HTTP 400.
