# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- Split the docs sidebar into user, self-hosting, and development navigation groups with cleaner section labels.
- Corrected stale CLI/config/provider/settings/production-readiness docs so the documented automation env vars, file-backed config behavior, provider-app management paths, MCP setup/tool lists, callback URL guidance, frontend route docs, README/platform lists, homepage/media/scheduling/thread wording, provider capability notes, binary install steps, and cloud-readiness status match the current codebase.
- Added Windows amd64 server binary release support and documented Windows single-binary setup.
- Removed social media sets from the app, API, CLI, MCP tools, and docs; posting schedules now resolve at the workspace/account level with a migration that drops the legacy set tables.
- Updated CLI and MCP publication workflows for current post types, explicit account targeting, media roles, YouTube title/description/privacy, TikTok settings, and publication schedule/publish actions.

### Fixed

- Made remote MCP `GET /mcp` return HTTP 405 instead of falling through to SPA HTML, restoring Streamable HTTP compatibility with clients such as Hermes.
- Preserved finalized `Location` headers on Meta OAuth callback redirects by setting redirect targets before Huma commits the 307 status.
- Registered persisted and newly added dynamic Mastodon instance adapters with publishing and token refresh so custom instances can publish without manual server restarts.

## [1.0.40] - 2026-07-06

### Changed

- Moved the composer post-type picker into the composer control row and made calendar-created posts prefill their schedule date.

### Fixed

- Aligned the composer Schedule/Publish actions with the app button system, made the split-arrow schedule the next free queue slot, and added a per-post random-delay override in the schedule dialog.
- Fixed the fullscreen calendar platform filter, day-level create actions, sidebar fullscreen shortcut, and dark-mode workspace filter styling.
- Updated composer e2e coverage for the post-type selector so release preflight follows the new UI.
- Kept release server-binary jobs out of the full frontend devenv shell after frontend assets are already built.

## [1.0.36] - 2026-07-06

### Changed

- Reworked the legacy composer schedule control into a dialog with natural-language time input, quick picks, timezone context, and the existing calendar/time selector.
- Renamed the default composer mode to Post and kept the mode picker in sync when users add or remove thread posts.

### Fixed

- Detected X Premium long-post limits from account capabilities and metadata instead of relying only on a manual limit profile flag.

## [1.0.34] - 2026-07-06

### Changed

- Made commit and push hooks faster by keeping pre-commit to lightweight checks and trimming pre-push to backend format/lint plus frontend lint.
- Added the format-first publication/rendition publishing model, capability registry, composer, CLI/MCP publication commands, and profile-aware Facebook, Instagram, YouTube, and TikTok publishing paths.
- Added media analysis/public URL validation metadata and provider-readiness diagnostics for format-first publishing.
- Switched YouTube publishing to resumable uploads with retry/resume handling, thumbnail upload, playlist insertion, and post-upload processing-status checks.
- Added X quote-post, poll, reply-setting, paid-partnership, and AI-disclosure publishing settings with validation for mutually exclusive attachment modes.
- Added Mastodon visibility, content-warning, sensitive-media, language, poll, and native scheduling settings with poll/media conflict validation.
- Added Bluesky video capability metadata plus rich-text facets, external link cards, quote posts, quote-with-media embeds, and self-label settings.
- Added LinkedIn document/PDF carousel capability metadata and document upload/publishing support via the LinkedIn Documents API.
- Added TikTok Upload/Inbox video support with `FILE_UPLOAD` initialization and chunk transfer while keeping Direct Post on verified public media URLs.
- Added rendition comment inbox/moderation API routes with opaque OpenPost comment IDs, Facebook/Instagram/LinkedIn/Threads comment adapters, and explicit unsupported-provider responses.
- Added MCP provider-readiness, publication-validation, media-analysis metadata, publication lifecycle, and rendition comment workflows for automation clients.
- Added workspace image URLs and moved workspace-scoped navigation into the workspace switcher menu.
- Added a fullscreen month calendar with workspace/platform filtering, account badges, publication sets, and drag-and-drop rescheduling.
- Replaced the route-level unified composer with a focused old-shell composer picker that defaults to Short text and uses explicit output-role labels for rich publication modes.

### Fixed

- Made provider readiness use the effective registered provider adapters so env-configured X, LinkedIn, and Threads credentials are not reported as missing.
- Fixed Postgres migration normalization for numeric boolean defaults so hosted databases can apply the format-first schema migrations.
- Reworked existing-post editing so posts open in the full composer with explicit save/cancel controls instead of prompt-based rescheduling.
- Made publication rendition saves replace omitted account outputs instead of leaving stale renditions behind.
- Rendered a success page for completed OAuth account callbacks before returning users to Accounts.
- Stopped showing checkout CTAs for other plans when an organization already has an active hosted plan.

## [1.0.30] - 2026-07-03

### Fixed

- Removed the obsolete provider-app admin E2E coverage after the admin UI moved out of the app.

## [1.0.29] - 2026-07-03

### Changed

- Moved shared post scheduling, media validation, thread-draft, and thread cascade helpers out of the post API handler for reuse by MCP and tests.
- Made the account provider catalog UI consume the generated API type instead of maintaining a fallback provider list in the page.
- Extracted composer platform character-limit helpers into a tested compose module.
- Removed the in-app provider-app admin panel and sidebar shortcut so provider credentials stay operator-managed through deployment configuration.
- Removed the redundant schedule label above the sidebar calendar.

### Fixed

- Blocked social account connection attempts before provider redirects when the workspace has no remaining social-account entitlement.
- Corrected the frontend test command in the contributor guide.

## [1.0.28] - 2026-07-03

### Changed

- Replaced the marketing site with a minimal static SvelteKit index that reuses the main app theme and shared UI components.
- Removed the old marketing content routes from the public sitemap.

### Fixed

- Bridged the Paraglide Vite plugin type for the frontend Vite 7 config.
- Kept authenticated sidebar navigation inside the app shell without re-running the full onboarding loading state on every section change.
- Redirected OAuth callback failures back to Accounts with user-safe error messages instead of raw callback JSON pages.
- Encoded LinkedIn OAuth scopes with percent-escaped spaces so LinkedIn does not reject the scope string.
- Reused X OAuth request-token metadata through the callback token exchange so approved X connections can be saved.
- Dropped the legacy one-active-social-account workspace index from older databases.

## [1.0.26] - 2026-07-03

### Changed

- Moved Accounts, Media, Prompts, and Activity into the primary sidebar as workspace content and narrowed the avatar menu to account/session actions.
- Reworked settings entry points so Account, Workspace, Organization, and Instance Admin render as scoped destinations instead of sibling tabs.
- Clarified Mastodon provider app copy so normal users connect by entering an instance domain while manual provider credentials remain an instance-admin fallback.

### Fixed

- Loaded Uppy core, dashboard, webcam, and image editor styles globally so the profile picture picker renders with the expected uploader styling.
- Matched the theme toggle icon color to the rest of the avatar menu icons.

## [1.0.25] - 2026-07-03

### Fixed

- Made Postgres migration normalization use `ADD COLUMN IF NOT EXISTS` so fresh cloud databases created from models can still record column-add migrations cleanly.

## [1.0.24] - 2026-07-03

### Changed

- Aligned OpenPost Cloud plan links, environment examples, docs, and landing-page pricing with the full Starter/Creator/Pro/Team/Agency billing catalog.
- Switched OpenPost Cloud public and in-app pricing from dollar-denominated display to Euro source prices with locale-aware formatting.

### Fixed

- Fixed the pre-push lint hook's tag-push detection and no-devenv fallback directory handling.

## [1.0.23] - 2026-07-01

### Fixed

- Preserved safe same-origin login redirects after authentication so settings deep links survive the authenticated route guard.
- Made the workspace-switcher e2e test match the footer switcher behavior for alphabetically selected workspaces.

## [1.0.22] - 2026-07-01

### Added

- Added organization-backed workspace ownership, team listing APIs, organization-scoped billing routes, and team/agency Polar plan configuration for hosted accounts.
- Added authenticated profile updates and avatar upload/removal endpoints backed by existing media storage.
- Added an Account settings profile UI with Uppy-powered avatar upload/camera capture.

### Changed

- Removed the user-facing Publications surface from the web app, CLI, public API, MCP tools, and docs so drafts/posts plus per-platform renditions remain the canonical workflow.
- Split Settings into Workspace, Account, Organization, and Admin tabs so user-owned and workspace-owned preferences are clearer.
- Clarified user, self-hosting, and developer docs around Settings ownership, provider app management, and organization billing.
- Moved workspace switching into the sidebar footer and clarified Provider Apps settings around Mastodon custom instances and optional provider OAuth key overrides.
- Made billing subscription snapshots organization-scoped while preserving legacy workspace billing metadata for compatibility.

### Fixed

- Replaced raw browser User-Agent strings in active sessions with readable browser/device labels.

## [1.0.21] - 2026-07-01

### Fixed

- Installed Playwright Chromium in local, CI, and release frontend test gates before browser-backed Vitest and E2E checks run.

## [1.0.20] - 2026-07-01

### Fixed

- Fixed backend lint configuration drift between local macOS and Linux release runners by excluding noisy `goconst` findings.

## [1.0.19] - 2026-07-01

### Fixed

- Fixed release preflight backend lint failures in MCP and billing error responses.

## [1.0.18] - 2026-07-01

### Added

- Added `OPENPOST_POLAR_API_BASE_URL` and strict cloud-mode Polar billing config validation for hosted checkout, portal, and webhook readiness.
- Added a production-readiness implementation plan covering OpenPost Cloud, Postgres/S3 drivers, Polar billing, provider readiness, the publication model, MCP/ChatGPT app work, marketing/SEO, and verification.
- Rebuilt `marketing-site/` as a SvelteKit landing page for OpenPost Cloud with an agentic scheduler position, demo slot, pricing direction, platform grid, FAQ, and lower-page open-core trust section.
- Added backend edition, database-driver, and storage-driver configuration primitives, including Postgres Bun driver initialization and S3-compatible storage settings for upcoming cloud storage work.
- Added an S3-compatible media storage driver behind the `BlobStorage` interface for OpenPost Cloud and R2/S3-backed deployments.
- Added an entitlement service contract with self-hosted unlimited defaults and static plan-limit decisions for upcoming Polar billing and quota enforcement.
- Added Playwright smoke coverage for the OpenPost Cloud marketing landing page across desktop and mobile Chrome.
- Added an authenticated `/mcp` JSON-RPC foundation with MCP `initialize`, `tools/list`, and a read-only `list_workspaces` tool backed by existing Bearer JWT/API-token authentication.
- Added monthly `usage_counters` storage plus a usage accounting service for hosted quotas, and enforced the first entitlement boundary on workspace creation while keeping self-hosted defaults unlimited.
- Added media upload quota enforcement for monthly uploaded bytes and total stored media bytes, with successful new uploads recorded into monthly usage counters.
- Added scheduled-post quota enforcement for single posts and threads, with successful scheduled creates recorded into monthly usage counters.
- Added social account connection quota enforcement in the shared account saver used by OAuth and app-password provider flows.
- Added MCP `list_accounts` and `create_draft` tools so authenticated assistants can inspect connected accounts and create workspace-scoped draft posts.
- Added publishing-worker usage accounting for successful published posts and provider publish write calls.
- Added Polar billing webhook configuration, signature verification, idempotent webhook event storage, and local subscription snapshot tables for OpenPost Cloud.
- Added a subscription-backed entitlement service for cloud-mode workspace quotas using local Polar subscription snapshots.
- Added authenticated Polar checkout and customer portal API endpoints for OpenPost Cloud billing.
- Added a workspace billing status API and settings UI summary for current plans and monthly usage.
- Added publishing-worker quota enforcement for monthly published posts and provider write calls.
- Added a Playwright app smoke suite that boots the Go server and verifies the authenticated billing settings surface.
- Added MCP `schedule_post`, `get_post_status`, and `cancel_post` tools with workspace/account validation, scheduled-post quota enforcement, and publish-job queue integration.
- Added MCP `suggest_next_slot` so assistants can pick the next free configured posting slot before scheduling.
- Added an `openpost-mcp` CLI stdio proxy that reuses OpenPost CLI profiles and tokens to connect desktop MCP clients to the authenticated remote `/mcp` endpoint.
- Added MCP `upload_media_from_url` with shared media ingestion, upload quota accounting, dedupe, and private/local-address SSRF protection.
- Added persistent MCP tool-call auditing with user/workspace scope, status, error message, duration, and migration coverage.
- Added an authenticated MCP activity API and settings panel so users can inspect recent assistant/CLI tool calls, failures, durations, and workspace scope.
- Added Apps SDK-facing MCP protected-resource metadata, OAuth scope descriptors, and bearer challenges for ChatGPT/App client account-linking readiness.
- Added dedicated `mcp:full` API-token creation in settings and enforced MCP-compatible token scopes on `/mcp` while preserving existing CLI proxy tokens.
- Added a structured provider app registry that normalizes legacy provider env vars and optional `OPENPOST_PROVIDER_APPS` JSON before building platform adapters.
- Added database-backed provider app registry loading so hosted/operator deployments can keep OAuth app credentials encrypted in `provider_apps` rows while retaining env and JSON bootstrap config.
- Added instance-admin provider app registry APIs for listing, saving, and deleting encrypted provider app credentials without exposing stored secrets.
- Added an instance-admin Settings panel for managing database-backed provider app credentials and restart-required state.
- Added provider-readiness catalog details to `openpost instance diagnostics` support snapshots.
- Added billing plan and usage details to authenticated `openpost instance diagnostics` support snapshots.
- Added `openpost billing status`, `openpost billing checkout`, and `openpost billing portal` for hosted workspace billing flows from the CLI.
- Added an authenticated account-provider discovery endpoint so clients can distinguish configured provider apps from unavailable providers.
- Added provider-discovery rendering on the Accounts page, including unavailable states for provider apps that still need operator configuration.
- Added MCP `list_scheduled_posts` so assistant clients can inspect the upcoming publishing queue before scheduling or canceling posts.
- Added DB-backed dynamic Mastodon app registration so hosted and self-hosted deployments can connect user-supplied Mastodon instances without preconfigured server entries.
- Added Accounts UI support for custom Mastodon instance connection, including OOB exchange persistence and Playwright coverage.
- Added MCP `set_post_renditions` so assistants can write destination-specific post variants for draft and scheduled posts.
- Added MCP `list_drafts`, `update_draft`, and `schedule_draft` so assistant clients can review, revise, and queue existing draft posts without creating duplicates.
- Added MCP client attribution for tool-call activity by storing API-token client ID, name, scope, and token prefix and surfacing the client label in Settings.
- Added MCP OAuth authorization-code + PKCE account linking for ChatGPT-style clients, including authorization-server metadata, browser approval, client metadata redirect validation, and audience-bound MCP tokens.
- Added MCP prompt templates for common agentic scheduling workflows: planning a social post, adapting platform renditions, and reviewing the publishing queue.
- Added Apps SDK-friendly MCP tool invocation metadata and output schemas so ChatGPT-style clients can render progress states and validate structured tool results.
- Added direct browser-to-S3 media upload sessions with pending media reservations, presigned PUT targets, completion finalization, dedupe, and quota accounting.
- Wired web media uploads through direct S3 upload sessions with automatic multipart fallback for local/self-hosted storage.
- Added provider launch-status metadata to account-provider discovery, including Instagram, Facebook, YouTube, and TikTok entries for web, CLI, MCP, and ChatGPT App clients.
- Added MCP `list_provider_catalog` so assistant clients can inspect available, unconfigured, and planned social providers before choosing destinations.
- Added MCP `list_media` plus source `media_ids` support on draft and scheduling tools so assistant clients can reuse existing workspace media or attach uploaded assets to posts.
- Added MCP `ping` and Streamable HTTP notification handling, with `openpost-mcp` suppressing empty stdio frames for accepted notifications.
- Added an MCP Apps scheduler widget resource and `render_scheduler_widget` tool so ChatGPT-style clients can render OpenPost workspaces, accounts, media, providers, drafts, and queue data.
- Added the first Publication model schema foundation with `publications`, `publication_assets`, and optional `posts.publication_id` links for the upcoming source-idea → rendition workflow.
- Added MCP `list_publications` and `create_publication` tools so assistants can work from source ideas and assets before creating platform-specific drafts.
- Added authenticated publication API endpoints for creating, listing, reading, and updating source publications with media attachments.
- Linked source publications to post creation/update, thread creation, CLI API structs, and MCP draft/schedule workflows through `publication_id`.
- Added CLI publication commands plus `--publication` linking for post and thread workflows.
- Added a web Publications page for source ideas, source media, status changes, and handoff into the composer.
- Added user-facing web-app Publications docs that distinguish the UI workflow from CLI and MCP publication workflows.
- Added user-facing MCP docs and reorganized the docs navigation around user docs, self-hosting docs, and developer docs.
- Added a backend OpenAPI generator command so docs builds regenerate the checked-in Huma spec from the same route registrar used by the server.
- Added hosted pricing handoff from landing-page plan CTAs through registration, onboarding, and the app billing checkout flow.
- Added account-specific platform preview cards for Instagram, Facebook, YouTube, and TikTok compose views.
- Added a compact settings section navigator with stable anchors for billing, security, tokens, schedules, and workspace defaults.
- Added server-backed web session tracking with Settings UI revocation and Playwright coverage for active browser sessions.
- Added dedicated docs overview pages that separate user-facing web/CLI/MCP docs, self-hosting operations docs, and developer implementation docs.
- Added marketing SEO pages for free social post tools and publishing tips, including interactive character counting, thread splitting, and platform previews.
- Added a UTM campaign-link builder to the marketing tools page with Playwright coverage for generated tracking URLs.
- Added a source-publication context panel in the composer, including source brief metadata, source reuse, and publication media metadata hydration.
- Added crawlable marketing blog and comparison pages for agentic social media scheduling and publication-first workflows.
- Added static marketing-site `robots.txt` and `sitemap.xml` routes for the landing, tools, and tips pages.
- Added a cloud bootstrap entitlement so hosted users can create one workspace before checkout while paid workspace expansion uses active subscription snapshots.
- Added a database-backed `/api/v1/ready` endpoint for deployment readiness checks while keeping `/api/v1/health` as a liveness probe.
- Added `openpost instance health` for unauthenticated CLI liveness and readiness checks against the active instance.
- Added production-operator checklist coverage for self-hosted storage, cloud Postgres/S3/Polar readiness, provider launch gates, backup restores, and CLI readiness probes.
- Added stricter Apps SDK metadata coverage for the MCP scheduler widget, including standard `_meta.ui` CSP keys, legacy ChatGPT aliases, and model-only render-tool visibility.
- Added Playwright docs E2E coverage that verifies the user-facing, self-hosting, and developer docs entry points stay distinct and reachable.
- Added the docs E2E suite to CI and release preflight gates so docs audience separation stays verified automatically.
- Added the app Playwright E2E suite to CI and release preflight gates for billing, MCP, provider, and publication workflows.
- Added Playwright app E2E coverage for browser registration, first-workspace onboarding, and login redirects.
- Added Playwright app E2E coverage for media-library upload and listing through the local-storage multipart fallback.
- Added Playwright app E2E coverage for composer scheduling through suggested posting slots.
- Added the backend OAuth account-selection foundation for page/channel providers, including encrypted pending selection storage and completion APIs used by Facebook and Instagram plus future YouTube adapters.
- Added a first TikTok adapter slice with OAuth, provider discovery, one-video direct publishing through public HTTPS media URLs, media validation, app UI connection wiring, and provider docs.
- Added a first Facebook Pages adapter slice with Meta OAuth, Page account selection, Page-token saving, text/single-media publishing through public HTTPS media URLs, provider discovery, and docs.
- Added a first Instagram Business adapter slice with Meta OAuth, account selection, image/Reel publishing through public HTTPS media URLs, provider discovery, app UI wiring, and docs.
- Added a first YouTube adapter slice with Google OAuth, channel selection, refresh-token support, private one-video uploads, media validation, provider discovery, app UI wiring, and docs.
- Added destination-scoped provider media-state tracking so publish retries reuse already uploaded provider media without caching expiring public media URLs.
- Added optional workspace-scoped API and MCP OAuth tokens so ChatGPT/App clients, MCP clients, and automation can be limited to a single workspace.
- Added workspace team invitations with copyable accept links, authenticated accept/revoke APIs, Settings team management, and team-member quota enforcement that counts active members plus pending invites.
- Added shared frontend provider-media capability rules with tested composer warnings, size-aware metadata hydration, and provider-limited video labels in the media library.
- Added optional deployment/provider context and a redacted last-100-line log tail to `openpost instance diagnostics` support snapshots.
- Added provider-specific troubleshooting docs and docs E2E coverage for OAuth, permission, media URL, and publishing failure paths.
- Added offset pagination metadata for background jobs, including Activity load-more UI, CLI `jobs list --offset`, backend regression tests, and Playwright coverage.
- Added offset pagination metadata for post lists, including CLI `post list --offset` and backend regression coverage.
- Added release artifacts for the `openpost-mcp` stdio proxy alongside the main `openpost` CLI, with both binaries stamped with the release tag version.
- Added file-backed env var support through `<VARIABLE>_FILE` for cloud secrets, provider JSON bootstrap config, legacy aliases, and deploy-managed secret files.
- Added `--with-mcp` support to the release installer so desktop MCP clients can install `openpost` and `openpost-mcp` together.

### Changed

- Migrated from openpost.rgo.pt to app.openpost.social (app), docs.openpost.social (docs), and openpost.social (landing page).
- Enabled registrations on hosted instance.
- Updated all doc links from op.rgo.pt to docs.openpost.social.
- Added marketing-site/ — minimal Astro landing page at openpost.social.
- Moved docs and marketing site deployment from VPS/GitHub Pages to Cloudflare Pages.
- Moved the JavaScript workspace to pnpm workspaces with Turborepo orchestration across the web app, docs site, and marketing site.
- Tightened cloud-mode CORS defaults so hosted deployments allow only `OPENPOST_APP_URL` plus explicit extra origins, while self-hosted installs keep local development and Capacitor defaults.
- Clarified developer and configuration docs so database, jobs, and media storage descriptions distinguish SQLite/local self-host defaults from Postgres/S3 cloud deployments.
- Added concise MCP server instructions during initialization and made the ChatGPT Apps widget render standard `ui/notifications/tool-input` events as well as tool results.
- Split settings-page static data and DTO types into a route-local module, reducing the Svelte page script and removing a mutable `Map` derived value from the posting-schedule grid.

### Fixed

- Made background-job workspace scoping, publish-job cancellation, MCP scheduling cleanup, stale processing-job recovery, and schedule overview date aggregation use database-portable expressions for Postgres-backed cloud deployments.
- Rejected MCP `schedule_post` and `schedule_draft` requests with provider/media combinations that cannot publish, including inherited draft media.
- Rejected scheduled posts and threads with provider/media combinations that cannot publish, while still allowing incomplete drafts to autosave.
- Hardened user-supplied remote URL fetches for dynamic Mastodon registration and MCP media uploads with shared private-address validation and guarded dial-time checks.
- Normalized embedded database migrations for Postgres so cloud deployments do not execute SQLite-only `BLOB`, `DATETIME`, or boolean predicates.
- Made the frontend instance connection check use the database-backed readiness probe instead of accepting liveness-only health responses.
- Return service-unavailable billing API errors for missing Polar server configuration instead of classifying operator setup problems as bad client requests.
- Enforced cloud-mode runtime validation so hosted deployments must boot with Postgres and S3-compatible media storage instead of local SQLite/filesystem defaults.
- Made app Playwright E2E runs start a freshly built Go server by default instead of silently reusing stale local servers.
- Removed duplicate Huma route registration from the Go binary startup path so app E2E runs and production boot no longer panic on repeated operation IDs.
- Wrapped the docs API reference OpenAPI renderer in client-only rendering so VitePress builds no longer emit a nonfatal SSR TypeError.
- Fixed release CLI cross-compilation by keeping `GOOS` and `GOARCH` out of `devenv` shell evaluation and applying them only to the Go build commands.

## [1.0.17] - 2026-06-27

## [1.0.16] - 2026-06-23

### Fixed

- Build release frontend assets once on Ubuntu and reuse them for server binary packaging, avoiding the macOS runner's post-build Node/libuv abort.

## [1.0.15] - 2026-06-23

### Fixed

- Run frontend unit tests from the devenv pre-push lint chain and trigger the Vitest pre-commit hook for frontend dependency/config changes.
- Pin `estree-walker` at the frontend root to the CommonJS-compatible version required by Rollup plugin utilities during the SvelteKit production build.

## [1.0.14] - 2026-06-23

### Fixed

- Pin `svelte-toolbelt` at the frontend root so `bits-ui` resolves the export required by the production build in CI.

## [1.0.13] - 2026-06-23

### Fixed

- Track the frontend Bun lockfile so CI and local hooks use the same formatter/build dependency graph.

## [1.0.12] - 2026-06-23

### Fixed

- Added the frontend production build to devenv-managed pre-commit and pre-push checks so Vite compiler failures are caught before release tags are pushed.
- Avoided optional-parameter syntax in the composer account loader to keep the Vite/PWA release build parser path happy.

## [1.0.11] - 2026-06-23

### Fixed

- Kept LinkedIn account icons clickable in the composer while moving the thread-reply warning to publish-time validation.

## [1.0.10] - 2026-06-17

### Added

- Scaffold for a new `cli/` Go module (`github.com/openpost/cli`) — a standalone HTTP client for a running OpenPost instance. Includes the config layer (XDG config dir, profile precedence, flag > env > file), the OS keyring token store with an explicit --insecure-storage fallback, a typed API client, a JSON/table output printer, an account-picker that resolves `--accounts x,x:@main,mastodon:server.example` to social_account IDs, a schedule parser that handles RFC3339 / absolute layouts / natural-language ("tomorrow 2pm", "in 3 hours", "next monday 9am") / `now` / `draft`, and Cobra-based `root` and `completion` commands. The CLI does not embed the server, does not open SQLite, and does not import `backend/internal/...`.
- First-class API tokens for the CLI and other long-lived automation clients. `api_tokens` table stores sha256-hashed opaque tokens with the format `op_cli_<8-hex-prefix>_<base64url-secret>`; the JWT web path is unchanged. New `Authenticator` interface and `CompositeService` (JWT → API token fallback) wrap the existing `*auth.Service`. Huma handlers now accept the interface; the Echo `JWTMiddleware` is preserved. `GET /api/v1/api-tokens`, `POST /api/v1/api-tokens`, and `DELETE /api/v1/api-tokens/{id}` let users manage tokens from web/CLI; the raw token is returned exactly once on create.
- `cli_auth_sessions` table for the device-flow authorization flow that will land in the next phase (RFC 8628-style). Both device code and user code are stored as sha256 hashes; only the plain user_code ever leaves the server. Migration 008 and 009 are idempotent and auto-applied on startup, matching the 007 pattern.
- CLI device-flow authorization endpoints under `/api/v1/cli/auth/`: `POST /start` (opens a session, returns device_code + user_code + verification_url, rate-limited per client IP), `POST /poll` (1 req/s minimum, slow-down + retry-after), `GET /session?user_code=…` (the web approval page), `POST /approve` (mints an `APIToken` via the existing apitokens service, raw token returned once), `POST /deny`. New `internal/services/cli_auth` package wraps the session lifecycle and `CleanupExpired`. The CLI never handles the user's password, TOTP, or passkey — the user approves in the web UI.
- `/cli/authorize` web page that gates on auth, fetches the pending session, and shows the client identity, requested scopes, and Approve/Deny buttons. Same-origin `?redirect=` support on `/login` so the page round-trips through login when needed. New shadcn-style `Badge` primitive used by the requested-scopes chips.
- CLI skeleton: `openpost auth login|status|logout`, `openpost auth token list|revoke`, `openpost instance add|list|use|remove`, `openpost workspace list|use|create`. Login flows through the device-flow endpoints (browser-open by default, `--device` for SSH/headless, `--with-token` for stdin paste, `--insecure-storage` to opt out of the OS keyring). Config lives in `~/.config/openpost/config.toml` (XDG-aware); tokens live in the OS keyring by default. `--json`, `--quiet`, `--yes`, `--no-color`, and shell completions for `bash`, `zsh`, `fish`, and `powershell` are wired in. The CLI does not embed the server, does not open SQLite, and does not import `backend/internal/...`.
- CLI account and media commands: `openpost account list|disconnect` and `openpost media upload|list`. The `--accounts` picker resolves platform aliases (`x`, `linkedin`, `x:@username`) and account IDs against the workspace's social accounts, with a friendly disambiguation hint when a platform has multiple accounts. Accountpicker has table-driven unit tests covering the empty / single / multiple-match paths.
- CLI posting commands: `openpost post create|list|view|update|delete` and `openpost thread create <file>`. `--schedule` accepts RFC3339, `now`, `draft`, or natural language (`tomorrow 2pm`, `in 3 hours`, `next monday 9am`) and resolves against the workspace's timezone with a friendly confirmation prompt for natural-language inputs. `--accounts` resolves platform aliases via the picker. `--media` accepts existing media IDs or local file paths (uploaded first). Thread files use front matter for metadata and `---` separators between posts; the splitter has table-driven tests for front-matter, embedded dashes, empty segments, and mixed CRLF/LF. `openpost jobs list` surfaces the server's job queue.
- Release artifacts and documentation for the CLI: GitHub releases now build `openpost-cli-*` binaries for Linux, macOS, and Windows alongside the unchanged `openpost-server-*` artifacts; `scripts/install-cli.sh` installs the latest release binary with `curl | sh`; and new CLI docs cover installation, authentication, posting, and automation.
- Generated CLI reference docs from the Cobra command tree. `scripts/sync-docs-openapi.mjs` now copies the Huma OpenAPI spec and regenerates `docs-site/reference/cli.md`, so command usage and flags stay in sync with the implementation.
- CLI social set management via `openpost set list|create|rename|default|add|remove|delete`. `post create`, `post update`, and `thread create` now accept `--set <name-or-id>`; `post create` and `thread create` fall back to the workspace default social set when neither `--accounts` nor `--set` is provided.
- CLI posting commands now accept `--schedule next-slot` (also `next slot` or `slot`) to schedule at the next available server-side posting slot. When a social set is selected or inherited as the default, the CLI passes that set to the next-slot lookup.
- Docs-site now has a full CLI section for installation, authentication, posting/social sets, automation, and command reference, plus a dedicated Android app installation/build page.
- Settings UI for CLI devices and API tokens, including token creation, one-time raw token display, token prefix/last-used metadata, and revocation. CLI device-flow approvals and manually-created automation tokens now share one visible management surface.
- Account slug management in the web Accounts page, backed by persisted `social_accounts.slug` values and a new `PATCH /api/v1/accounts/{account_id}` endpoint.
- Pre-commit hooks for the `cli/` Go module: `cli-gofmt`, `cli-golangci-lint`, and `cli-go-test` mirror the existing `backend/` hooks via the same `devenv`-generated `pre-commit-config.json` and run only for changes under `cli/`. The CLI's gofmt and golangci-lint were not previously gated at commit time; they are now.

### Changed

- Moved thread draft state out of `posts.content` (where it lived as a `__openpost_thread__:` JSON blob) into a dedicated `thread_drafts` table. The composer now sends the encoded draft as a typed `thread_draft` field on the create/update POST/PATCH and reads it back from the same field on get. The blob-in-content path is preserved as a fallback for data that was saved before the migration. Migration 007 is idempotent and runs automatically on startup.
- Replaced the `WHERE payload LIKE '%<uuid>%'` job-cancellation query in `posts.go` with a `type = 'publish_post' AND json_extract(payload, '$.post_id') = ?` match, so cancelling one post's jobs can no longer accidentally cancel other jobs (e.g. `media_cleanup`, `refresh_token`) whose payload happened to contain the post ID as a substring. Added a regression test in `posts_cancellation_test.go`.
- Made OAuth callback redirects absolute: the `Location` header on error and success paths now uses the configured `OPENPOST_APP_URL` as the base, so the redirect works correctly behind subpath reverse proxies and non-root mounts.
- Aligned the Go config's `*_REDIRECT_URI` defaults with `.env.example`: when an env var is unset the value is now derived from `OPENPOST_APP_URL` (with `urn:ietf:wg:oauth:2.0:oob` for Mastodon, matching the documented example).
- The Go binary now panics loudly at startup with a clear message if the embedded `index.html` is missing or empty. Previously a build that skipped the frontend step would silently serve a blank HTML page with HTTP 200.

### Removed

- Deleted the dead `frontend/messages/es.json` stub. Spanish was listed as a supported language in the docs and the ROADMAP, but the locale wasn't registered in Paraglide and the file only contained a single placeholder key. Both `frontend/README.md` and `ROADMAP.md` now reflect that Spanish is not yet shipped.
- Dropped `openpost account connect <platform>` from the CLI. Account connection is web-UI-only: provider credentials live on the server, the OAuth/Bluesky-app-password dance is server-side, and the CLI's only account-management surface is `list` and `disconnect`. The `account` cobra group has a `Long:` description pointing at `<instance>/accounts`, and `account list` against an empty workspace prints the URL to the web UI so the path stays discoverable. Unit tests cover the URL-construction and empty-state helpers.

### Fixed

- Fixed `GET /api/v1/posts` ordering so the Bun query builder treats `COALESCE(scheduled_at, created_at) DESC` as a SQL expression instead of parsing `created_at) DESC` as an invalid sort direction. This removes the `unsupported sort direction sort_dir="CREATED_AT) DESC"` backend log and preserves newest-first dashboard/post list ordering.
- CLI list/single-resource endpoints (`ListAccounts`, `ListMedia`, `ListPosts`, `ListJobs`, `GetWorkspaceSettings`, `CreatePost`, `GetPost`, `CreateAPIToken`) used to decode Huma responses into a `struct{ Body T }` envelope. Huma v2 flattens the `Body` field on the wire, so the decode failed with `cannot unmarshal array into Go value of type struct { Body … }` and the CLI silently lost media data on `media list` (decoding `null` into a nil slice, then rendering "no media uploaded"). All endpoints now decode the flat wire format directly. 8 new `httptest`-backed regression tests in `cli/internal/api/client_test.go` lock the format for the next refactor.
- Legacy Echo media routes (`/api/v1/media/upload`, `/api/v1/media/batch-upload`, `/api/v1/media/metadata`) only accepted JWT web sessions because they wired `middleware.JWTMiddleware(h.auth)`. CLI users got a 401 (`invalid or expired token`) on every upload. New `middleware.BearerMiddleware(Authenticator)` is the Echo-shaped counterpart of `AuthMiddleware` and accepts both JWT and `op_cli_…` tokens via the unified `CompositeService`. The three legacy routes now use it. The bare `"Bearer"` literal was lifted to a `bearerPrefix` const to satisfy `goconst` across all three middleware implementations. 4 new `httptest` tests in `backend/internal/api/middleware/auth_test.go` cover success, missing header, malformed header, and rejected-token paths.
- Fixed the account slug backend contract used by `openpost account rename`: social accounts now have migrated/backfilled slugs, list responses include `slug`, and duplicate active slugs are rejected per workspace.
- Fixed `POST /api/v1/sets` so the response includes the initial accounts supplied during creation, matching list/get/update responses and making CLI set summaries accurate.

### Changed

- Expanded the README launch messaging around the Typefully-like workflow, target users, support snapshot, and current limitations.
- Filled in the thin operator docs with a more complete quickstart, single-binary install guide, backup and restore process, provider support matrix, and stronger security guidance.

## [1.0.9] - 2026-05-16

### Fixed

- Corrected Bluesky video service auth to use the user's PDS DID from the access JWT audience instead of assuming `bsky.social`.
- Corrected LinkedIn video status polling to percent-encode video URNs as Rest.li path variables.

## [1.0.8] - 2026-05-16

### Changed

- Media library deletion now allows media that is unused or only attached to already published posts, while still blocking media needed by draft, scheduled, publishing, or failed posts.

### Added

- Added a media library download action for saved images and videos.

## [1.0.7] - 2026-05-16

### Fixed

- Corrected Bluesky video service auth to use the documented GET query endpoint, parse wrapped video job responses, and poll video jobs with the service token.
- Prevented LinkedIn video posts from sending image-only media overrides and waited for finalized videos to become available before creating the post.
- Allowed dropdown sub-menus to overflow the quick-settings menu surface so the language picker is not clipped in production builds.

## [1.0.6] - 2026-05-14

### Changed

- Clarified the README and docs to reflect the actual provider-by-provider video implementation state instead of treating video support as universally absent.

### Fixed

- Corrected the launch TODO and public docs after auditing the current X, Mastodon, Bluesky, LinkedIn, and Threads video code paths.
- Reduced repeated backend string literals called out by `golangci-lint` `goconst` checks so local Go linting passes again.
- Added a real Bluesky video embed path, MIME-aware Threads media publishing, and LinkedIn video upload finalization with required file sizes.
- Updated composer and social previews to render attached videos as videos and warn about provider-specific media limitations.

## [1.0.5] - 2026-05-10

### Changed

- Refactored composer preview rendering so desktop and mobile previews share the same derived Svelte state model.
- Extended account-specific post variants to track media attachments independently from the synced post media.

### Fixed

- Fixed stale composer preview and textarea sizing when switching between synced and account-specific social media variants.
- Prevented media that is only attached to account-specific variants from being deleted as unused media.

## [1.0.4] - 2026-05-09

### Added

- Documentation page explaining why to self-host OpenPost, plus clearer provider/platform limitations coverage.
- Capacitor app asset generation and refreshed Android launcher/splash assets derived from the project brand icon.
- PWA manifest configuration for the frontend build.

### Changed

- Refreshed launch messaging across the README and docs site around the self-hosted Buffer/Hootsuite positioning, target users, and current product limitations.
- Android release builds now use the consolidated `build:capacitor` flow so frontend build, Capacitor sync, and mobile asset generation stay in one path.
- Asset sync now prepares the frontend logo source used by Capacitor asset generation.

### Fixed

- Stopped tracking the repository root `TODO.md` while ignoring the local file, so personal launch notes can remain in the working directory without showing up in git.
- Corrected Bluesky token expiry handling by deriving expiry times from the JWT on login and refresh, which keeps automatic refresh jobs scheduled correctly instead of relying on a hardcoded login window or stale timestamps.

## [1.0.3] - 2026-05-04

### Fixed

- Restored authenticated media rendering in the frontend by allowing media image requests to authorize with the current JWT and updating UI image URLs to include that access token.

## [1.0.2] - 2026-05-04

### Fixed

- Restored Mastodon OAuth validation and callback state handling so missing `server_name` requests fail cleanly and browser redirects can complete without requiring the callback query to repeat the server selection.
- Corrected workspace-scoped job listing to apply visibility filtering before `limit`, so non-admin users get full pages of jobs from accessible workspaces.
- Signed Threads media URLs now target the app media endpoint by media ID instead of the underlying file basename.

## [1.0.1] - 2026-05-03

### Fixed

- Docker release builds now copy the repo `scripts/` directory so the frontend asset-sync step works in GitHub Actions and container releases complete successfully.

## [1.0.0] - 2026-05-03

### Added

- Account-level MFA with QR-based TOTP enrollment, passkey registration, and step-up login verification, plus settings UI for managing both methods.
- VitePress documentation site scaffold under `docs-site/`, including landing page, sidebar/navigation config, OpenPost-themed styling, and first-pass operator/contributor docs.
- Shared asset sync pipeline that copies canonical repo assets into frontend and docs public directories.
- GitHub Pages workflow for building and deploying the docs site.
- Token refresh job scheduling plus backend tests covering queued refresh execution and provider-specific refresh credentials.
- Dedicated account-connection success callback page for returning OAuth users to `/accounts`.
- Workspace migration scaffold for configurable draft gap minutes.
- Workspace setting for `draft_gap_minutes`, used by suggested queue times when a day's configured schedule slots are already occupied.

### Changed

- Settings now include account-security controls, while login can require a second factor when TOTP or passkeys are enabled.
- Optimized GitHub Actions CI by priming a shared Nix store cache before lint/test jobs, caching Go/lint/Bun dependencies, skipping unaffected backend/frontend jobs, and moving Go race tests off pull request runs.
- README reduced to a shorter front door that points detailed setup and operations content at the docs site.
- Docs site base-path handling now defaults to `/` for custom-domain hosting, with `OPENPOST_DOCS_BASE` available as an explicit override for repository-path deployments like `/openpost/`.
- README docs links now point at the custom docs domain `https://op.rgo.pt`.
- Docs now include a Nix module deployment page backed by a build-time sync of the production module from `rodrgds/nix-config`.
- Token refresh handling now declares platform capabilities explicitly, retries publish attempts on any supported expired account, and routes OAuth success redirects through the new callback screen.
- Workspace settings no longer auto-overwrite shared timezone and week-start values from the first browser locale that opens a workspace.
- Posting schedule settings now use a local-time weekly grid with per-day toggles and row-based time management instead of a flat UTC slot list.
- Suggested posting times now consider already scheduled posts and fall back to the configured minimum draft gap when a day has no unused schedule slots left.
- Weekly posting schedules now preserve the configured workspace-local time across DST changes instead of drifting by the current UTC offset.

### Fixed

- Mastodon accounts now persist their configured `instance_url` as the canonical provider key, avoiding publish/token-refresh mismatches after OAuth connection.
- The default Mastodon callback URI now matches the documented backend callback endpoint on `localhost:8080`.
- Mastodon server listings now avoid duplicate entries when adapters are registered with both UI labels and canonical instance-url keys.

## [0.4.4] - 2026-04-19

Changes since `v0.4.3`.

### Added

- X OAuth request store handler for temporary request-state persistence.
- Frontend OpenAPI snapshot and generated API TypeScript declarations tracked in-repo for CI consistency.
- Placeholder file in embedded web public directory to keep `go:embed` stable in clean checkouts.

### Changed

- X OAuth handler and platform integration flow refinements.
- Backend model and database updates supporting the latest auth/request-state behavior.
- Frontend pre-commit/devenv validation flow now runs deterministic generation/check steps for i18n and OpenAPI types.
- Frontend dashboard and media routes fixed strict TypeScript nullability errors found in CI.
- Frontend ignore/format rules adjusted to avoid generated-file drift during hooks.

## [0.4.3] - 2026-04-19

Changes since `v0.4.2`.

### Added

- Prompt management backend API (`/prompts`, `/prompts/random`, `/prompts/categories`, create/delete custom prompts).
- Built-in prompt catalog seeding and prompt category support.
- Posting schedule backend API (`/posting-schedules` list/create/update/delete).
- Prompt browsing UI at `/prompts` with category filtering, random prompt selection, and custom prompt creation.
- Compose flow integration for using prompts directly in new posts.
- Settings UI support for posting schedule slot management.

### Changed

- Post handler logic expanded for improved post management and scheduling workflows.
- Media handler behavior updated for media lifecycle and cleanup flow alignment.
- Authentication middleware updated for request auth handling refinements.
- Database/model layer updated with new scheduling and prompt entities.
- Queue worker updated to process scheduling-related jobs.
- Frontend layout refactors for improved page consistency (`PageContainer`, `EmptyState`, sidebar and dashboard updates).
- Favicon assets refreshed.

### Project And Docs

- Frontend page layout refactor and onboarding/UI refinements.
- Added AI agent skill definitions and repo agent guideline updates.
- Added/expanded roadmap and planning documentation updates.

### Commit Summary Since v0.4.2

- `681e3ab` refactor(frontend): unify page layouts with PageContainer and EmptyState components
- `bde9cc1` docs(agents): add conventional commits and branches requirement
- `a6f60ee` feat(frontend): add onboarding page and UI refinements
- `a53ef22` feat(agents): add AI agent skill definitions
- `7289963` feat: implement Phase 3 - Media Management & Cleanup
- `87a1901` feat: implement Phase 2 - Platform Customization & Social Media Sets
- `80c302c` feat: enhance post management features
- `cb8a110` feat: add comprehensive roadmap for OpenPost features and priorities
