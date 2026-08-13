# Production Checklist

Use this page before putting a real OpenPost instance behind a public domain.
It is operator-facing: product usage lives in [User Docs](/usage/), while code
changes live in [Developer Docs](/development/).

## Baseline

- [ ] Copy the root `.env.example` to `.env` or mirror every required value in your secret manager.
- [ ] Generate fresh `OPENPOST_JWT_SECRET` and `OPENPOST_ENCRYPTION_KEY`.
- [ ] Keep both secrets at least 32 characters long.
- [ ] Store secrets outside the repository and outside container images.
- [ ] Use `<VARIABLE>_FILE` variants for Docker/Podman/Kubernetes/NixOS secrets, and leave the direct variable unset when the file value should win.
- [ ] Set `OPENPOST_APP_URL` to the public HTTPS app origin.
- [ ] Set `OPENPOST_PUBLIC_URL` to the same public HTTPS app origin unless you have a specific split-origin reason.
- [ ] Configure `OPENPOST_EMAIL_PROVIDER`, `OPENPOST_EMAIL_FROM`, and that provider's credentials; verify signup, password-reset, and one opted-in operational notification without logging codes or secrets.
- [ ] If Google login is enabled, register the exact `/api/v1/auth/oidc/google/callback` URL and store `OPENPOST_AUTH_GOOGLE_CLIENT_SECRET` through a file-backed secret.
- [ ] Keep `OPENPOST_EXTRA_CORS_ORIGINS` explicit and do not use `*`.
- [ ] Configure a reverse proxy with HTTPS before connecting OAuth providers.
- [ ] Align reverse-proxy and CDN request-body limits with the largest video you accept, and disable request buffering for streamed uploads.
- [ ] Decide whether to enable automatic image alt text. If enabled, store `OPENROUTER_API_KEY` through `OPENROUTER_API_KEY_FILE` and review OpenRouter and model provider privacy and retention terms.
- [ ] Decide whether to enable the meme generator. If enabled, review Memegen's privacy, content, template-rights, watermark, rate-limit, and output terms; prefer a private service for unpublished drafts, and use `OPENPOST_MEMEGEN_API_KEY_FILE` for a hosted key.
- [ ] Confirm `GET /api/v1/health` returns `{"status":"ok"}`.
- [ ] Confirm `GET /api/v1/ready` returns `{"status":"ready","database":"ok"}`.
- [ ] Use `/api/v1/health` for process liveness and `/api/v1/ready` for traffic admission, rollouts, and dependency-aware monitoring.
- [ ] Confirm `openpost instance health --instance <public-url>` succeeds against the public URL.
- [ ] Capture `openpost instance diagnostics --instance <public-url> --json` for the launch/support handoff.
- [ ] Decide whether to enable PostHog telemetry. Self-hosted instances keep it disabled unless the operator explicitly chooses an operator-owned project and updates their privacy notice.

## Self-Hosted Storage

- [ ] Keep `OPENPOST_EDITION=selfhost` or leave it unset.
- [ ] Use SQLite/local storage unless you intentionally operate Postgres/S3 yourself.
- [ ] Persist the SQLite database path, usually `/data/db/openpost.db`.
- [ ] Persist the local media directory, usually `/data/media`.
- [ ] Set `OPENPOST_MEDIA_URL` to the public media base URL.
- [ ] Back up database files, media files, and secrets together.
- [ ] Run at least one test restore before relying on the backup.

## Managed Or Hosted Operators

- [ ] Set `OPENPOST_EDITION=cloud`.
- [ ] Set `OPENPOST_DATABASE_DRIVER=postgres`.
- [ ] Set `OPENPOST_DATABASE_URL` to the production Postgres URL.
- [ ] Set `OPENPOST_STORAGE_DRIVER=s3`.
- [ ] Set `OPENPOST_S3_REGION`, `OPENPOST_S3_BUCKET`, `OPENPOST_S3_ACCESS_KEY_ID`, and `OPENPOST_S3_SECRET_ACCESS_KEY`.
- [ ] Set `OPENPOST_S3_PUBLIC_BASE_URL` to a stable public media origin.
- [ ] Verify the S3 bucket lifecycle policy and object access model before launch.
- [ ] Set `OPENPOST_PADDLE_API_KEY`, `OPENPOST_PADDLE_ENVIRONMENT=production`, `OPENPOST_PADDLE_CLIENT_TOKEN`, `OPENPOST_PADDLE_WEBHOOK_SECRET`, and `OPENPOST_PADDLE_CHECKOUT_RETURN_URL`.
- [ ] Set the monthly and annual `OPENPOST_PADDLE_<PLAN>_<PERIOD>_PRICE_ID` values for Starter, Founder, Pro, Team, and Agency.
- [ ] Confirm the production API key and client token have live prefixes; never deploy sandbox credentials to the managed app.
- [ ] Configure Paddle to send customer, subscription, and `transaction.completed` events to `/api/v1/billing/paddle/webhook`; send a signed test event and confirm it is stored once and reconciled through the billing job.
- [ ] Set the minimum and maximum quantity to `1` for every Paddle plan price so buyers cannot add duplicate copies of a workspace subscription.
- [ ] Before upgrading from Whop billing, migrate every active customer to Paddle and confirm the Paddle subscription is reconciled locally. Historical Whop rows do not grant entitlements after the upgrade.
- [ ] Complete an embedded checkout smoke: plan and period selection, $0 trial start, return to OpenPost, local `trialing` status, and billing management URL.
- [ ] Confirm a new hosted user can create the bootstrap workspace and is blocked from extra workspaces before checkout.
- [ ] Confirm team invitations are blocked once active members plus pending invites reach the plan limit.
- [ ] Configure one EU PostHog production project for the app, backend, marketing site, and documentation; use separate staging and development projects.
- [ ] Disable PostHog IP capture, autocapture, session replay, console capture, and network bodies; enable cookieless server hashing and set event retention to no more than 12 months.
- [ ] Set the PostHog project token and server, browser, and UI hosts; keep the personal API key only in CI source-map upload secrets.
- [ ] Verify `GET /api/v1/telemetry/config` exposes only the browser-safe project token and ingestion configuration.
- [ ] Verify a browser intent event, a server outcome event, and one sanitized test exception arrive without content, credentials, email, names, query strings, or raw URLs.

## Providers

- [ ] Start with Bluesky or Mastodon for the first end-to-end publish smoke.
- [ ] Update callback URLs for X, LinkedIn, Threads, Facebook, Instagram, TikTok, and YouTube to the production HTTPS app origin.
- [ ] Add Facebook through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if Facebook Pages publishing is enabled, and confirm `OPENPOST_MEDIA_URL` serves public HTTPS media for media posts.
- [ ] Add Instagram through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if Instagram professional publishing is enabled, and confirm `OPENPOST_MEDIA_URL` serves public HTTPS media.
- [ ] Add TikTok through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if short-form video publishing is enabled, and confirm `OPENPOST_MEDIA_URL` serves public HTTPS media.
- [ ] Add YouTube through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if video uploads are enabled, and confirm the Google Cloud project has YouTube Data API v3 enabled.
- [ ] Configure Mastodon servers in `MASTODON_SERVERS` if you need fixed self-hosted Mastodon apps.
- [ ] Confirm custom Mastodon instance registration works if you rely on dynamic Mastodon connections.
- [ ] Limit each new social network until OAuth, media, publishing, token refresh, retries, and API limits pass a live account test.
- [ ] Create one test account connection per enabled provider.
- [ ] Publish a private or low-risk test post with and without media for every enabled provider.

## Product Smoke

- [ ] Create the first admin account.
- [ ] Confirm email-and-password signup cannot create a session until the six-digit code is accepted, and confirm resend invalidates the prior code.
- [ ] Confirm Google can create a new account, then link and unlink Google from an existing password account without email-based auto-linking.
- [ ] Decide whether to set `OPENPOST_DISABLE_REGISTRATIONS=true`.
- [ ] Create a workspace.
- [ ] Invite a second user, accept the link, and confirm both members appear in **Settings -> Organization**.
- [ ] Connect at least one social account.
- [ ] Upload a small image and confirm it appears in the media library.
- [ ] If automatic alt text is enabled, add an image without alt text to the text-and-thread composer, confirm OpenPost fills its shared alt text, and confirm a manual edit is not replaced.
- [ ] Create a draft and scheduled post from the web app.
- [ ] Create a draft or scheduled post through the CLI.
- [ ] Create a draft or scheduled post through MCP if assistant access is enabled.
- [ ] Confirm scheduled publishing creates and completes a background job.

## Operations

- [ ] Point dependency-aware uptime monitoring at `/api/v1/ready`; keep container or orchestrator liveness on `/api/v1/health`.
- [ ] Confirm logs include startup configuration, database readiness errors, provider publish failures, and MCP tool-call failures.
- [ ] Document your deployment rollback path.
- [ ] Document where database backups, media backups, and secret backups live.
- [ ] Verify the release artifact or container image matches the version you intended to deploy.
