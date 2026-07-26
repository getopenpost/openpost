# Background Jobs

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
