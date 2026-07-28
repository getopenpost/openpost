# Production Architecture and Readiness

OpenPost runs as a production self-hosted product and managed service. This page records the shared architecture, remaining provider verification work, and the checks that keep both deployment models ready. Private credentials and infrastructure stay in the deployment and operations layer.

## Product Direction

- Keep **OpenPost** as the product name.
- Use **OpenPost Cloud** for the official hosted service.
- Keep `openpost.social` as the marketing site, `docs.openpost.social` as the docs site, and `app.openpost.social` as the app.
- Position the product as: write one idea, adapt it into platform-native renditions, and publish intentionally.
- Keep self-hosting credible: no artificial self-hosted feature crippling.

## Architecture Principles

- Keep one shared product core in this repo.
- Keep secrets, production deployment config, provider credentials, monitoring, and private admin scripts outside this repo.
- Prefer interface-backed hosted primitives so self-hosted and cloud use the same API paths.
- Keep SQLite and local media as first-class self-hosted defaults.
- Add Postgres and S3/R2 as cloud-ready drivers, not replacements.
- Treat billing as entitlements and usage limits, not provider-specific checks scattered through handlers.
- Use background jobs for provider publishing, media processing, token refresh, and other restart-sensitive work.

## Current architecture and operating checks

### 1. Cloud Foundation

- `OPENPOST_EDITION=selfhost|cloud` is implemented. Cloud mode now refuses to boot unless the required Postgres, S3-compatible media, and Polar billing config is present.
- `OPENPOST_DATABASE_DRIVER=sqlite|postgres` is implemented. SQLite remains the self-hosted default; Postgres is the hosted/cloud path.
- `OPENPOST_STORAGE_DRIVER=local|s3` is implemented with local filesystem and S3-compatible media storage.
- Keep runtime database expressions portable. Background job recovery, job workspace scoping, publish-job cleanup, MCP scheduling cleanup, and schedule overview date aggregation now avoid SQLite-only JSON/date expressions so cloud Postgres deployments use the same paths.
- Add usage counters and entitlement checks at API boundaries. The foundation is in place with monthly `usage_counters`, workspace-creation entitlement checks, team invitation seat checks, and scheduled-post usage accounting.
- Enforce quota boundaries for workspace, team, provider, media, scheduling, and publishing paths. Social account connection quota enforcement is in place in the shared account saver, team invitations reserve active plus pending seats, media upload quota enforcement is in place for monthly uploaded bytes and stored bytes, scheduled-post quota enforcement is in place for single posts and threads, and publishing-worker quota enforcement is in place for published posts and provider write calls.
- Add monthly usage counters for scheduled posts, published posts, uploaded bytes, stored bytes, and provider write calls. The publishing worker records successful published posts and attempted provider writes separately.

### 2. Billing And Plans

- Use Polar for OpenPost Cloud checkout, subscriptions, customer portal, and webhooks. Cloud mode now requires the Polar access token, webhook secret, checkout/return URLs, and Starter/Creator/Pro/Team/Agency product IDs at startup.
- Store local subscription state and entitlement snapshots; do not call Polar on every request. The Polar checkout, customer portal, and webhook foundation now creates hosted billing sessions, verifies signed events, deduplicates webhook deliveries, and upserts organization subscription snapshots.
- Keep self-hosted entitlement defaults permissive and configurable.
- Keep cloud pre-checkout access constrained. Cloud mode now allows a first bootstrap workspace, then evaluates workspace expansion from active organization subscription snapshots instead of falling back to self-hosted unlimited behavior.
- Keep the public plan catalog, backend entitlement snapshots, and Polar product metadata aligned. The current prices and limits are maintained in the [managed pricing page](https://openpost.social/pricing) and `marketing-site/src/routes/_marketing.ts`.
- Keep cloud access before checkout constrained. Any trial access must come from Polar's `trialing` state and must not be described as automatic.

### 3. Provider Readiness

- The provider app registry is implemented for cloud and self-hosted credentials. Startup builds adapters from a normalized registry populated by legacy env vars, optional `OPENPOST_PROVIDER_APPS` JSON, and active encrypted `provider_apps` database rows managed through instance-admin APIs for hosted/operator-managed credentials.
- Replace fixed Mastodon env-only config with dynamic instance registration for cloud.
- Keep user-supplied remote URLs guarded against SSRF. Dynamic Mastodon registration and MCP URL media ingestion now reject private/local targets, validate redirects, use guarded dial-time resolution, and ignore environment proxy settings for these fetches.
- Add production OAuth app checklists for X, LinkedIn, Threads, Facebook, Instagram, YouTube, TikTok, Mastodon, and Bluesky.
- Delay platform launch promises until provider-specific publish, refresh, media, and retry behavior is verified end to end. TikTok, Facebook, Instagram, and YouTube now have first-slice adapters, but all four still need live-account verification before being treated as fully proven production providers.

### 4. Media Pipeline

- Move cloud uploads to direct browser-to-S3/R2 upload sessions. The S3 storage driver now issues authenticated upload sessions with presigned PUT targets, pending media reservations, completion finalization, dedupe, and quota accounting.
- Track media assets separately from provider-uploaded media IDs.
- Store size, checksum, dimensions, duration, processing status, storage driver, object key, and public URL mode.
- Add provider media state for X, LinkedIn, Mastodon, Threads, Instagram,
  Facebook, YouTube, and TikTok. Destination-scoped provider media state now
  records successful upload IDs for retry reuse while avoiding cached public
  URLs for Threads, Instagram, Facebook, and TikTok.
- Keep Threads and other public-URL providers working through signed/public media URLs.

### 5. Draft And Rendition Model

- Keep **Post** and **Draft** as the user-facing units of work.
- Use **Renditions** as destination-specific versions with format-specific validation.
- Keep the composer centered on base content, destinations, media, per-platform renditions, and release timing.
- Leave old source-idea compatibility tables in place only until a migration can safely remove or repurpose them.
- Support release choreography: same time, staggered posts, platform-first launches, and follow-up threads.

### 6. MCP And ChatGPT App

- Expose a remote MCP endpoint for OpenPost Cloud at `/mcp`.
- Keep the MCP server backend-owned, not frontend-owned.
- The local `openpost-mcp` stdio binary is implemented for desktop/self-hosted clients. The CLI stdio proxy loads the active OpenPost profile/token and forwards frames to `/mcp`.
- Reuse CLI/API client behavior where possible, but keep MCP stdout strict.
- Start with safe semantic tools and prompts: list workspaces, list accounts, create/list/update drafts, set post renditions, upload media from URL, schedule post or draft, cancel post, get post status, suggest next slot, and prompt templates for planning posts, adapting renditions, and reviewing the queue. The remote MCP foundation now supports workspace/account listing, draft creation/review/revision, destination-specific rendition updates, guarded URL media upload, quota-checked scheduling for new posts and existing drafts, post status reads, scheduled-post queue inspection/cancellation, next-slot suggestions, and agentic scheduling prompt templates.
- Require auth for remote MCP, scope sessions, log tool calls, and expose revocation in settings. Tool-call logging is now persisted in `mcp_tool_calls`, recent calls are visible in settings with API-token client attribution, Apps SDK-facing protected-resource/tool security metadata, invocation status labels, and output schemas are in place. Settings can create/revoke dedicated `mcp:read` or `mcp:full` tokens, OAuth authorization-code + PKCE account linking mints audience-bound MCP tokens, and both manual tokens and OAuth approvals can be limited to one workspace. Read tokens receive only read-safe tools and search results, and mutation attempts are rejected server-side.

### 7. Marketing, SEO, And Docs

- Keep `marketing-site/` public in this repo.
- Keep `docs-site/` technical and task-oriented.
- Keep pricing, platform, comparison, security, open-source, changelog, and tools pages crawlable on `openpost.social`. The public sitemap now covers each current landing page, platform guide, comparison, and tool.
- Keep the free tools useful without an account. The current set covers social image design, character counting, platform previews, thread splitting, handle checks, LinkedIn formatting, and timezone-aware posting plans, with focused browser checks.
- Keep app, public Studio, and marketing form controls on the shared Shadcn-svelte primitives so focus, touch targets, dark mode, and interaction states do not drift.
- Keep `CHANGELOG.md` authoritative. The public changelog and tagged GitHub release notes are generated from it.
- Keep docs on install, providers, configuration, CLI, operations, and development.

### 8. Verification

- Add Playwright smoke tests for marketing, login, onboarding, composer, scheduling, accounts, settings, and media. Coverage is now in place for marketing, docs audience separation, browser registration/login/onboarding, app settings/billing/MCP activity/session revocation, Activity job pagination, provider discovery, custom Mastodon connect, plan onboarding, account-specific composer previews, composer scheduling through suggested slots, and media-library upload/listing.
- Add backend regression tests before each schema/service change.
- Keep `devenv shell -- lint` as the push gate.
- For hosted deployment work, verify the real app URL, docs URL, marketing URL, release workflow, database backups, and logs.

## Change verification order

1. Update source behavior, generated contracts, tests, and public docs in the same change.
2. Run `devenv shell -- doctor` before broad or release work.
3. Run targeted checks while iterating, then `devenv shell -- verify`.
4. For visible changes, run the relevant app, docs, or marketing browser suite at desktop and phone widths.
5. For a production release, follow [Releases and Versioning](/development/releases) and verify the workflow, release, deployed revision, and public readiness.
