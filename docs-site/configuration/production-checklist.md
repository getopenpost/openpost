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
- [ ] Keep `OPENPOST_EXTRA_CORS_ORIGINS` explicit and do not use `*`.
- [ ] Configure a reverse proxy with HTTPS before connecting OAuth providers.
- [ ] Align reverse-proxy and CDN request-body limits with the largest video you accept, and disable request buffering for streamed uploads.
- [ ] Confirm `GET /api/v1/health` returns `{"status":"ok"}`.
- [ ] Confirm `GET /api/v1/ready` returns `{"status":"ready","database":"ok"}`.
- [ ] Confirm `openpost instance health --instance <public-url>` succeeds against the public URL.
- [ ] Capture `openpost instance diagnostics --instance <public-url> --json` for the launch/support handoff.

## Self-Hosted Storage

- [ ] Keep `OPENPOST_EDITION=selfhost` or leave it unset.
- [ ] Use SQLite/local storage unless you intentionally operate Postgres/S3 yourself.
- [ ] Persist the SQLite database path, usually `/data/db/openpost.db`.
- [ ] Persist the local media directory, usually `/data/media`.
- [ ] Set `OPENPOST_MEDIA_URL` to the public media base URL.
- [ ] Back up database files, media files, and secrets together.
- [ ] Run at least one test restore before relying on the backup.

## OpenPost Cloud Or Hosted Operators

- [ ] Set `OPENPOST_EDITION=cloud`.
- [ ] Set `OPENPOST_DATABASE_DRIVER=postgres`.
- [ ] Set `OPENPOST_DATABASE_URL` to the production Postgres URL.
- [ ] Set `OPENPOST_STORAGE_DRIVER=s3`.
- [ ] Set `OPENPOST_S3_REGION`, `OPENPOST_S3_BUCKET`, `OPENPOST_S3_ACCESS_KEY_ID`, and `OPENPOST_S3_SECRET_ACCESS_KEY`.
- [ ] Set `OPENPOST_S3_PUBLIC_BASE_URL` to a stable public media origin.
- [ ] Verify the S3 bucket lifecycle policy and object access model before launch.
- [ ] Set `OPENPOST_POLAR_ACCESS_TOKEN`, `OPENPOST_POLAR_WEBHOOK_SECRET`, `OPENPOST_POLAR_CHECKOUT_SUCCESS_URL`, and `OPENPOST_POLAR_RETURN_URL`.
- [ ] Set `OPENPOST_POLAR_STARTER_PRODUCT_ID`, `OPENPOST_POLAR_CREATOR_PRODUCT_ID`, `OPENPOST_POLAR_PRO_PRODUCT_ID`, `OPENPOST_POLAR_TEAM_PRODUCT_ID`, and `OPENPOST_POLAR_AGENCY_PRODUCT_ID`.
- [ ] Set `OPENPOST_POLAR_API_BASE_URL=https://sandbox-api.polar.sh/v1` only for sandbox testing; production defaults to `https://api.polar.sh/v1`.
- [ ] Send a signed Polar webhook test event and confirm it is stored once.
- [ ] Confirm a new hosted user can create the bootstrap workspace and is blocked from extra workspaces before checkout.
- [ ] Confirm team invitations are blocked once active members plus pending invites reach the plan limit.

## Providers

- [ ] Start with Bluesky or Mastodon for the first end-to-end publish smoke.
- [ ] Update callback URLs for X, LinkedIn, Threads, Facebook, Instagram, TikTok, and YouTube to the production HTTPS app origin.
- [ ] Add Facebook through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if Facebook Pages publishing is enabled, and confirm `OPENPOST_MEDIA_URL` serves public HTTPS media for media posts.
- [ ] Add Instagram through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if Instagram professional publishing is enabled, and confirm `OPENPOST_MEDIA_URL` serves public HTTPS media.
- [ ] Add TikTok through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if short-form video publishing is enabled, and confirm `OPENPOST_MEDIA_URL` serves public HTTPS media.
- [ ] Add YouTube through `OPENPOST_PROVIDER_APPS` or the instance-admin provider app API if video uploads are enabled, and confirm the Google Cloud project has YouTube Data API v3 enabled.
- [ ] Configure Mastodon servers in `MASTODON_SERVERS` if you need fixed self-hosted Mastodon apps.
- [ ] Confirm custom Mastodon instance registration works if you rely on dynamic Mastodon connections.
- [ ] Keep first-slice providers in limited rollout until their OAuth, media, publish, refresh, retry, and quota behavior is verified with live accounts.
- [ ] Create one test account connection per enabled provider.
- [ ] Publish a private or low-risk test post with and without media for every enabled provider.

## Product Smoke

- [ ] Create the first admin account.
- [ ] Decide whether to set `OPENPOST_DISABLE_REGISTRATIONS=true`.
- [ ] Create a workspace.
- [ ] Invite a second user, accept the link, and confirm both members appear in **Settings -> Organization**.
- [ ] Connect at least one social account.
- [ ] Upload a small image and confirm it appears in the media library.
- [ ] Create a draft and scheduled post from the web app.
- [ ] Create a draft or scheduled post through the CLI.
- [ ] Create a draft or scheduled post through MCP if assistant access is enabled.
- [ ] Confirm scheduled publishing creates and completes a background job.

## Operations

- [ ] Point uptime monitoring at `/api/v1/ready`, not only `/api/v1/health`.
- [ ] Confirm logs include startup configuration, database readiness errors, provider publish failures, and MCP tool-call failures.
- [ ] Document your deployment rollback path.
- [ ] Document where database backups, media backups, and secret backups live.
- [ ] Verify the release artifact or container image matches the version you intended to deploy.
