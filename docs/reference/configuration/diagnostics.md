# Maintainer diagnostics

Self-hosted instances send privacy-limited diagnostic reports to OpenPost so crashes and failed operations can be fixed for every deployment, not just Hosted. This channel is separate from product analytics: an operator's own PostHog project stays theirs, and diagnostic reports never carry user identities, sessions, or product events.

## Defaults and opt-out

Reporting is **on by default**. Instances report to the official receiver at `https://app.openpo.st/api/v1/diagnostics/ingest` unless the operator overrides it. To opt out completely:

```dotenv
# Prevent diagnostic reports from being sent to OpenPost.
OPENPOST_DIAGNOSTICS_ENABLED=false
```

Application browser test servers explicitly disable diagnostics and product telemetry. Maintainer diagnostics tests deliver to local HTTP receivers.

The environment disable always wins, stops sending, and clears pending reports. Upgrading OpenPost activates this channel where previous versions sent nothing; the change is called out in the release notes. Browser reports additionally stop when Do Not Track or Global Privacy Control is set, regardless of the instance switch.

## What is reported

Reports answer "what broke, in which build, under what technical conditions":

- release and revision, browser/backend/worker surface, operation (route template, job type, or normalized location)
- normalized error code (`api_5xx`, `http_panic`, `worker_failed`, `publish_failed`, `media_failed`, `export_failed`, `startup_failed`, `browser_uncaught`, `browser_unhandled_rejection`, provider outage codes)
- provider (allowlisted platforms only), HTTP status, retry/attempt counts, database/storage drivers, sanitized stack frames, occurrence counts

Reports never contain user or workspace identities, post text, prompts, media URLs, credentials, raw provider responses, instance domains, request/response bodies, cookies, headers, or client IPs. Payloads are built from an allowlist; unknown fields are rejected. Browser failures arrive as codes and app-relative locations only, never message text.

These are privacy-limited reports, not anonymous telemetry: each installation generates a random installation ID, and the receiving infrastructure observes the connecting server's IP.

## Coverage

- Uncaught browser exceptions and unhandled promise rejections (chunk-load deployment skew is excluded; it has its own recovery).
- Unexpected API failures and panics, including Huma-generated 5xx responses the error hook never sees.
- Worker panics, failed publishing, media processing, and editor export failures, reported even when the terminal job state could not persist.
- First occurrence plus samples with counts for repeated background failures.
- Startup failures (database init, migrations) through an early boundary that works without the application database.
- Expected failures (expired credentials, rate limits, provider outages) as structured codes with counts.
- Validation errors, 404s, cancellations, arbitrary console output, and application logs are not reported.

Delivery never blocks application work: bounded in-memory queue, short timeouts, backoff, drop-when-full, and hourly caps. `SIGKILL` and abrupt shutdowns cannot be caught, so delivery is best-effort.

## Configuration

```dotenv
# Send diagnostic reports to OpenPost. On by default.
OPENPOST_DIAGNOSTICS_ENABLED=true
# Receiver endpoint. Defaults to the official OpenPost receiver.
OPENPOST_DIAGNOSTICS_RECEIVER_URL=https://app.openpo.st/api/v1/diagnostics/ingest
# Installation identity file. The release container defaults this to the
# persistent /data volume; standalone installs may override the path.
OPENPOST_DIAGNOSTICS_STATE_FILE=/data/diagnostics-installation-id
# Public cross-instance ingest endpoint. Off unless this instance IS the
# official receiver. Hosted enables it with the maintainer webhook below.
OPENPOST_DIAGNOSTICS_INGEST_ENABLED=false
# Server-only maintainer Discord webhook. Use the _FILE companion for a
# managed secret. Never commit this value.
OPENPOST_DIAGNOSTICS_DISCORD_WEBHOOK_URL=
```

Use the `_FILE` companions (`OPENPOST_DIAGNOSTICS_DISCORD_WEBHOOK_URL_FILE`) for managed secrets. Webhook URLs never appear in logs, API responses, or the repository.

## The official receiver

`POST /api/v1/diagnostics/ingest` accepts reports from any OpenPost instance when `OPENPOST_DIAGNOSTICS_INGEST_ENABLED=true`. It is unauthenticated by design (reporting instances hold no account here); protection comes from strict schema validation, a 16 KB body cap, per-installation hourly quotas, a global per-minute cap, and bounded Discord delivery. Accepted reports are forwarded to the maintainer Discord channel as embeds with the code, operation, build, occurrence count, and sanitized frames.

## User feedback

User-written feedback stays between the user and their instance operator: it is delivered only to the operator-configured `OPENPOST_FEEDBACK_DESTINATION_URL` (Discord-compatible webhook) with the operator-chosen recipient label. The Hosted service points that destination at the maintainer feedback channel. Self-hosted feedback is never copied to the maintainer.
