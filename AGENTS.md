# OpenPost AI Agents & Development Guidelines

This document serves as a guideline for autonomous AI agents (like Copilot, Cursor, Codeium, or CLI agents) and human developers contributing to **OpenPost**. It outlines the core tech stack, architectural rules, and specific instructions for AI behavior.

Treat this as a living file: add concise repo learnings when they would save future agents time, and trim entries that become stale or too obvious.

## Agent skills

### Issue tracker

Issues and specs are tracked in this repository’s GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-role label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.

## 1. Core Architecture & Tech Stack

**Frontend:**

- **Framework:** SvelteKit (using `@sveltejs/adapter-static` for simple SPA deployment).
- **Styling:** TailwindCSS.
- **i18n:** Paraglide.
- **Testing:** Vitest.
- **Package Manager:** Bun 1.3.11 with the committed text `bun.lock`.

**Backend:**

- **Language:** Go (1.26.5+).
- **Framework:** Echo (`github.com/labstack/echo/v4`). Huma for OpenAPI spec generation.
- **Database:** SQLite by default; Postgres is supported and required for hosted cloud mode.
- **ORM:** Bun (`github.com/uptrace/bun`).
- **Background Jobs:** Custom database-backed polling worker using the `jobs` table (no external Redis dependency).
- **Media Storage:** Local filesystem via `BlobStorage` interface (configurable via `OPENPOST_MEDIA_PATH`).

**Deployment:**

- **Strategy:** Single Go binary. Production builds embed SvelteKit's static output with `go:embed`; development runs, tests, vulnerability scans, and lint use the `dev` build tag to serve the same output from disk and keep large frontend archives out of the persistent Go cache.
- **Hosted app:** `app.openpost.social` runs from the Docker image published by the GitHub `Build and Release` workflow and is pinned in `~/.config/home/hosts/rgo-vps/default.nix`.
- **Push-to-deploy:** Production releases are tag-driven. `bun run release:prod "<commit>"` derives SemVer from Conventional Commits, runs the cheap release-contract checks, pushes `main`, waits for GitHub CI as the correctness authority for that immutable SHA, and only then creates the tag. CI builds and restart-smokes `ghcr.io/rodrgds/openpost:sha-<revision>` once and retains the unsigned Android candidate. `.github/workflows/release.yml` creates or reuses a matching draft release, uploads the exact evidence, server, CLI, MCP, and signed-or-verified Android asset set, promotes the tested image without rebuilding it, and calls the signed VPS hook with the revision, tag, and digest. The NixOS deploy script validates the production config, deploys the immutable digest, verifies `/api/v1/version`, and automatically restores the prior image if readiness fails. The workflow publishes the draft only after the artifact matrices, digest promotion, deployment, public readiness, and exact revision checks succeed.
- **Keep delivery fast and reproducible:** Preserve Bun, Go, Docker BuildKit, and GitHub Actions caches. Cache keys must track `bun.lock`, `bunfig.toml`, Go modules, frontend inputs, and Docker inputs. Do not restore `no-cache` Docker builds unless investigating cache correctness; BuildKit invalidates changed layers. Local release checks bound unused BuildKit cache to 20 GB by default and try to restore 20 GB of host free space without deleting images, containers, or volumes. Validate workflow edits and confirm both `app.openpost.social/api/v1/ready` and the exact revision from `/api/v1/version` before considering a release delivered.
- **Keep the published image contract explicit:** `docker/image-policy.json` owns the supported container platform, digest-pinned runtime base, lifecycle review, scanner versions, and probe roles. The published image is currently `linux/amd64` only. Keep container health on process liveness, gate traffic and rollouts on database-backed readiness, and require the restart smoke, SPDX SBOM, and full final-image scan before registry publication.

## 2. Platform Adapter Architecture

All social platform integrations follow the unified `platform.Adapter` interface defined in `internal/platform/adapter.go`. Each platform implements this interface in its own file within `internal/platform/`:

| File           | Platform           | Auth Method              |
| -------------- | ------------------ | ------------------------ |
| `x.go`         | Twitter/X          | OAuth 1.0a               |
| `mastodon.go`  | Mastodon           | OAuth 2.0 (per-instance) |
| `bluesky.go`   | Bluesky            | App Passwords            |
| `linkedin.go`  | LinkedIn           | OAuth 2.0                |
| `threads.go`   | Threads            | Meta OAuth 2.0           |
| `facebook.go`  | Facebook Pages     | Meta OAuth 2.0           |
| `instagram.go` | Instagram Business | Meta OAuth 2.0           |
| `tiktok.go`    | TikTok             | OAuth 2.0                |
| `youtube.go`   | YouTube            | Google OAuth 2.0         |
| `discord.go`   | Discord Webhooks   | Incoming webhook URL     |

Adapters are registered in `main.go` via a `map[string]platform.Adapter` and passed to the token manager, publisher, and OAuth handler. Provider selection uses adapter-map and capability-catalog lookups; switches internal to a single adapter may still dispatch that provider's content modes.

Shared HTTP helpers are in `internal/platform/http.go`:

- `DoRequest` — generic HTTP request with error handling
- `DoJSON` — JSON marshaled request
- `DoMultipart` — multipart file upload
- `DoFormURLEncoded` — form-encoded request

Analytics is an optional provider capability defined by `platform.AnalyticsAdapter`; do not add reporting methods to the core publishing `Adapter`. The analytics service stores normalized immutable account and rendition snapshots plus the latest safe sync state, and never retains raw provider responses or tokens. `GET /api/v1/analytics` reads stored data only. The worker runs a unique pending sweep every 15 minutes, checks accounts on an adaptive daily cadence, and checks published renditions at 1/3/12/24-hour bands through day 7; manual refresh covers the last 90 days. Preserve the separate meanings of views, impressions, and reach. Permission, unsupported, rate-limit, not-found, and failed states must keep the last successful counters. Existing Instagram, Threads, and TikTok accounts may need reconnection when analytics scopes change.

Engagement and inbox reads use the optional `CommentAdapter`/`EngagementAdapter` and `MessagingAdapter` capabilities. Keep them separate from publishing. The communications worker persists normalized records and separate safe sync state; page requests never call provider APIs. Inbox collection is opt-in per account. Provider writes use one-attempt durable jobs because an ambiguous timeout cannot be retried safely without a portable provider idempotency key.

### Local scheduler references

Keep shallow, Git-ignored checkouts of Postiz and Shoutrrr in `references/postiz/` and `references/shoutrrr/`. Before designing or implementing a social publishing, scheduling, automation, or provider feature—and whenever the requested behavior or UX is uncertain—check whether either project has an equivalent feature and inspect its current implementation. Postiz is especially useful for multi-account repost selection, delays, and plug-style thresholds. Shoutrrr is especially useful for durable repost jobs, engagement gates, plateau checks, and per-post overrides. Use them as references, not dependencies: OpenPost's architecture, security rules, provider capabilities, and product language remain authoritative. Never commit or vendor either checkout. If a checkout is missing, recreate it with `git clone --depth 1`; refresh an existing checkout with `git -C references/<name> pull --ff-only`.

Keep a shallow, Git-ignored miniPaint checkout in `references/miniPaint/` as a source reference for Image Editor tools, raster workflows, effects, import/export behavior, and desktop/mobile editor UX. Use it as a reference, not a dependency; OpenPost's document model, storage rules, accessibility, and social-output workflows remain authoritative. Never commit or vendor the checkout. If it is missing, recreate it with `git clone --depth 1 https://github.com/viliusle/miniPaint.git references/miniPaint`; refresh it with `git -C references/miniPaint pull --ff-only`.

## 3. Agent Guidelines & Coding Mandates

When an AI agent is invoked to assist with this repository, it MUST adhere to the following rules:

### A. Commit & Branch Conventions

- **Always use Conventional Commits** (e.g., `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`). Follow https://www.conventionalcommits.org/
- **Always use Conventional Branches** (e.g., `feature/add-login`, `fix/header-alignment`, `hotfix/emergency-patch`)
- **Always update `CHANGELOG.md`.** It is the single source of truth for release history. Add every notable feature, fix, breaking change, migration, or operator action to `## [Unreleased]` under the correct category. Do not maintain separate marketing changelog data or hand-written GitHub release notes: the marketing page reads this file and `release:prod` promotes `Unreleased` into the new version before the tagged workflow publishes those notes.
- **Use the project-owned Devenv environment.** Provision Nix, Devenv, and direnv through the durable Hermes/NAS host configuration; do not install project tools globally. After cloning, run `direnv allow`, `devenv shell -- install`, and `devenv shell -- setup`. Once direnv loads, use named commands directly; otherwise use `devenv shell -- <command>`. The supported gates are `check`, `lint`, `test`, `build`, and `verify`, with `backend-*`, `frontend-*`, and `cli-*` variants for targeted work. (`test` is a shell builtin in some interactive shells; use `devenv shell -- test` or `test-all` there.)
- **Keep the root build contract explicit.** `bun run build` prepares generated docs inputs, builds the frontend, marketing site, and docs through their package-owned Turbo tasks, then atomically packages `frontend/build` into `backend/cmd/openpost/public`. It does not compile the Go backend or CLI; `devenv shell -- build` is the canonical full-repository build. Use `bun run frontend:build` for the cached frontend plus backend packaging boundary, and `bun run verify:frontend-build-cache` when changing that boundary.
- **Keep deployed assets surface-owned.** `scripts/asset-surfaces.ts` is the typed manifest for frontend, documentation, and marketing static assets. Package builds validate only their selected surface; the root asset gate validates all source references and rejects missing, undeclared, or extra staged files. Add a source reference and its manifest entry together instead of restoring whole-tree copies.
- **Keep setup reproducible and non-destructive.** `install` uses the committed Bun and Devenv lockfiles and `bun install --frozen-lockfile`. `setup` creates `backend/.env` only when it is absent and never replaces an existing file. Treat dotenv as data: never `source` or `eval` it. The Go application safely loads `backend/.env` when launched from the backend directory. Keep secrets out of Nix expressions and the Nix store.
- **Keep hooks fast and run broad gates explicitly.** Devenv installs the tracked `scripts/pre-push-lint.sh` gate, which checks backend formatting/lint and frontend lint without running tests or builds. Use `verify` before release tags or high-risk changes; CI remains authoritative for the full matrix.
- **Keep Go format checks inside source trees.** Project commands may create module-local `.devenv` state containing the Go toolchain's intentionally invalid parser fixtures. Preserve the `.devenv` prune in backend and CLI format checks; never run recursive `gofmt` across generated environment state.
- **Run the project doctor before broad or release work.** Use `devenv shell -- doctor` to catch low disk space, dirty or divergent Git state, stale linked worktrees, missing pinned Chromium, and missing project tools before a long gate. Linked worktrees share the primary checkout's Devenv dependency caches; remove completed temporary worktrees after their branches are clean and verified remotely.
- **Keep repository caches bounded.** Use `cache-status` and `cache-prune` for the shared Bun, Go module, Go build, and embedded-frontend state. Devenv checks the persistent Go build cache at most once per day and clears it above 4 GiB by default; set `OPENPOST_GO_CACHE_MAX_MIB` to change the cap or `OPENPOST_GO_CACHE_FORCE_CHECK=1` to rescan. Keep backend development on `-tags dev`, and keep the production embed build on its disposable `GOCACHE`. Use `docker-cache-status` and `docker-cache-prune` for Docker; the latter removes only unused BuildKit cache and defaults to a 20 GB maximum with 20 GB minimum host free-space targets.
- **Give local release builds enough Docker Desktop memory.** On a 16 GiB macOS host, configure Docker Desktop with 10 GB memory and 4 GB swap before running the production-image gate. The current frontend bundle is not reliable with Docker's 8 GB memory and 1 GB swap allocation. Release preflight rejects a macOS Docker VM below 9.5 GiB; set `OPENPOST_DOCKER_MIN_MEMORY_GIB` only when another host has been proven with a different limit.
- **Production release flow:** start with `bun run release:plan` and the fast `bun run release:preflight`, then run `bun run release:prod "<conventional commit message>"`. Preflight checks the worktree, GitHub access, workflows, the deploy secret, and public readiness. The ordinary release path runs only release, changelog, and provider-certification contracts locally; GitHub candidate CI owns the complete correctness matrix for the exact pushed SHA. Keep `release:check` as the explicit manual exhaustive gate for the canonical checks, race and security checks, isolated browser suites, and a restart-smoked production image; it reuses an exact-worktree fingerprint for 24 hours unless `OPENPOST_FORCE_RELEASE_CHECK=1`. Use `release:prepare` to stop after the exact SHA passes hosted CI, and `release:promote <tag>` to tag and deploy that prepared SHA. `RELEASE_BUMP` may only raise inferred impact; `RELEASE_VERSION` is reserved for an intentional greater version-line correction and cannot undercut commit impact. If a tag fails, do not retag it; fix forward with a new SemVer tag.
- **Keep release identity generated and fail closed.** A commit cannot contain its own SHA, so candidate CI derives `release-manifest.json` from the prepared changelog or inferred SemVer plus the exact checked-out revision. Do not commit this generated file or restore candidate-only version strings. The image labels, embedded manifest, server response, CI artifact, requested tag, verified source digest, and deployed `/api/v1/version` must agree on stable version and full revision before promotion or completion.
- **Treat Docker Desktop recovery as a data operation.** If the daemon stops responding after the host fills, stop Docker Desktop before inspecting its VM disk. Inventory Compose bind mounts, containers, and volumes before repair, purge, reset, or reinstall; never factory-reset or prune volumes as a first response. Repository bind mounts remain outside `Docker.raw`, while named and anonymous Docker volumes do not. Prefer a filesystem-preserving repair and unused build-cache prune, then verify the daemon and application data before resuming release work.
- **Keep release scope explicit.** Release preparation stages the whole worktree. Audit `git status -sb`, tracked diffs, and untracked files first; if any file is unrelated or the branch diverges, commit or rebase deliberately and release from a clean linked worktree. A push is not a deployment: completion requires successful candidate CI, the tag workflow, GitHub release, public readiness, and the exact deployed revision.
- **Go Backend:** Use Echo for HTTP handlers and Huma for OpenAPI endpoints. Follow the dependency injection pattern in `main.go`. Maintain separation of concerns: Handlers -> Services -> Database.
- **Platform Adapters:** Implement `platform.Adapter`. Never put provider API logic outside the `internal/platform/` package. Use shared HTTP helpers from `http.go`.
- **SvelteKit Frontend:** Always use standard Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`, `$bindable`). Use `+page.svelte`/`+page.ts` structures. Use the openapi-fetch typed client against `/api/v1` routes.
- **Use the shared Shadcn-svelte form controls everywhere.** Application, public OpenPost Image Editor, and marketing Svelte files must use the shared `Input`, `Textarea`, `Select`/`AppSelect`, `Checkbox`, `RadioGroup`, `Slider`, and related primitives from `frontend/src/lib/components/ui/`. Do not add visible native `input`, `select`, or `textarea` elements outside those primitive implementations. The marketing site shares the same `$lib` component source. Embedded editors whose parent owns the complete visual boundary may use the shared `Textarea` with `unstyled`; the text-and-thread composer and its media alt-text overlay intentionally keep this background-blending treatment. Run `bun run check:ui-consistency` when form UI changes.
- **Frontend page states:** Use `PageContainer`/`PageHeader`, `SectionHeader`, `PageLoading`, `EmptyState`, `InlineNotice`, `AppToast`, `DestructiveConfirmDialog`, and `StandaloneShell` instead of rebuilding page chrome or feedback per route. Keep authenticated route `h1` headings at the shared application scale, choose the loading recipe that matches the eventual content, and keep wide calendar/table layouts behind content-safe breakpoints with touch-accessible alternatives.
- **Keep social previews centralized.** Use `packages/social-preview` for both application and marketing/free-tool previews: `SocialPreview` renders the destination post itself, while `SocialPreviewPage` renders the chrome-free full destination shell used by `/preview`.
- **Keep healthy provider state quiet.** Do not add “available” or “configured” badges for normal provider state; surface only actionable setup, degraded, unsupported, or planned states.
- **Name the active authoring paths accurately.** Use “text-and-thread composer” for the fast Post/Thread authoring surface, never “legacy composer.” Reserve “legacy” for historical schemas, migrations, and compatibility fallbacks.
- **Treat publications as the canonical user-visible post inventory.** Every text/thread publication must have a linked text-and-thread editor row; story, short-video, and video publications stay in their focused composers. Build Posts, Calendar, and agent-created drafts from publications so every content mode appears once. Keep browser fixtures and waits on `/publications` with complete `PublicationResponse` shapes when these surfaces change; stale `/posts` mocks can hide release-only loading failures.
- **Resolve X limits per connected account.** Read the authenticated X `subscription_type`, persist only the normalized capability state, and fail closed to the 280-character, 140-second, and 512 MiB standard profile when the tier is missing, stale, or cannot be refreshed. Keep frontend counters and backend validation on the shared X weighted-text rules.
- **Broad UI requests require an implementation and QA matrix.** Inventory routes and shared primitives first, then complete the requested remediation before calling the audit done. Run one browser suite at a time with the pinned Playwright Chromium; verify representative desktop and phone widths, overflow, action visibility, keyboard/touch access, and console health. Browser suites start isolated servers by default; use `OPENPOST_APP_E2E_REUSE_SERVER=1`, `OPENPOST_MARKETING_E2E_REUSE_SERVER=1`, or `OPENPOST_DOCS_E2E_REUSE_SERVER=1` only for an intentional matching local server.
- **Treat “corresponding places” as a cross-surface inventory.** Check the authenticated app, `marketing-site`, `docs-site`, README, and canonical assets before placing demos, screenshots, public copy, or product links. `bun run release:prod` does not prove the separately hosted marketing site is live; verify that delivery independently when it changes.
- **Keep product facts in sync with the code.** For every feature, provider, plan, limit, workflow, configuration, or command change, update the related app copy, `marketing-site`, comparisons, free tools, `docs-site`, README, provider tables, screenshots, generated references, and `CHANGELOG.md` in the same change when they apply. Check each claim against the current code or an official source, record review dates where facts can change, and remove stale or repeated claims. Do not call the work complete until this cross-surface check and the relevant copy, link, contract, build, and browser checks pass.
- **Version the official hosted policies from one source.** `packages/legal-policy/src/manifest.json` owns the OpenPost-hosted Terms, Privacy, and Refund Policy versions, dates, URLs, and acceptance rules. Run `bun scripts/legal-policy-manifest.mjs generate` after a substantive policy change and commit the generated Go constants. Cloud configuration must use `bun scripts/legal-policy-manifest.mjs env`; substantive Terms or Privacy changes advance their version and re-prompt users, while meaning-preserving copy or link corrections do not. Refunds are incorporated into the Terms and are not accepted separately.
- **Regenerate contracts at their source boundary.** After changing Huma routes, CLI commands, or message catalogs, run `bun run check:contracts` and `frontend-check` before debugging downstream type errors. Keep generated OpenAPI, TypeScript, CLI docs, and Paraglide changes in the same behavior cohort as their source; do not hand-edit them.
- **Retire public contracts from evidence, not source reachability.** `compatibility-surfaces.json` records each candidate route or schema member's owner, consumers, replacement, notice, migration, and sunset state. A static search cannot prove an API-token, older CLI, MCP, or automation consumer is absent. Keep retained operations and schema members in OpenAPI and require the compatibility gate before deprecation or removal.
- **Hosted configuration is declarative.** For production env or secret changes, trace the application config into `~/.config/home`, store secrets through its SOPS/file-secret pattern, and verify non-secret runtime flags, the active host generation, service/container health, and public behavior. Never print a secret to prove it was mounted.
- **ORM Patterns:** Always use `github.com/uptrace/bun` for database operations. Do not write raw SQL strings unless doing complex SQLite pragmas or advanced queue polling.

### B. State Management & Single Binary Constraints

- **Filesystem Constraints:** OpenPost is meant to be highly portable. Local file storage (e.g., SQLite DB file, local media uploads) should be configurable via environment variables (e.g., `OPENPOST_DATABASE_PATH`, `OPENPOST_MEDIA_PATH`).
- **Asset Embedding:** Do not modify the SvelteKit build pipeline in a way that breaks `adapter-static`. The backend relies on a static `build/` directory to embed into the binary.

### C. Security & Credentials

- Tokens for social accounts (Access Tokens, Refresh Tokens) MUST ALWAYS be encrypted at rest using the `TokenEncryptor` service (AES-256-GCM).
- Do NOT hardcode cryptographic secrets in the codebase. Always load from environment variables (e.g., `OPENPOST_ENCRYPTION_KEY`, `OPENPOST_JWT_SECRET`).

### D. Writing and product copy

- Avoid stock metaphors, similes, idioms, and other figures of speech. Prefer short, familiar words when they keep the exact meaning. Cut every word or section that adds no meaning.
- Prefer active voice when it makes the actor and action clearer. Replace jargon, foreign phrases, and needless scientific or academic terms with everyday English.
- Apply these rules in context, not as blind word replacements. Break them when accuracy, natural phrasing, tone, legal meaning, accessibility, or readability requires it.
- Keep code, commands, API fields, proper nouns, citations, quotes, legal wording, and exact technical terms intact unless they are themselves copy being improved.
- Finish every copy change with a line-by-line prose review for meaning, facts, voice, consistency, and useful detail.

### E. Workflow for Feature Implementation

1. **Model First:** If a feature requires data, update the `models.go` and `database.go` schema creation first.
2. **Backend Logic:** Implement the Service and the Echo API Handler.
3. **Frontend Implementation:** Write Svelte components and SvelteKit routes to interact with the new endpoint.
4. **Queue (if applicable):** If the action is async (e.g., publishing a post), insert a payload into the `jobs` table instead of blocking the HTTP request.

## 4. Prompts & Agent Commands (For Quick Context)

_If you are an agent, read these context hints before performing actions:_

- **"Add a new social platform"**: Create a new file in `internal/platform/` implementing `platform.Adapter`. Register it in `main.go` under the provider map. Add its icon and capability-driven composer treatment to the frontend, then update the accounts page (`/accounts`) with connect UI.
- **"Modify database schema"**: Update `internal/models/models.go` struct fields with appropriate bun tags and add a numbered SQL migration in `internal/database/migrations/`. Base tables are bootstrapped with `.IfNotExists()`, but upgrades run through `RunMigrations`; add a corresponding migration regression test.
- **"Handle thread drafts"**: Thread drafts (the in-progress state of a multi-post thread) live in the `thread_drafts` table — one row per parent post, keyed by `post_id` with `ON DELETE CASCADE`. The encoded draft JSON is the same `__openpost_thread__:` blob the frontend has always used; the backend now stores it in its own column instead of smearing it into `posts.content`. The composer sends/reads it through the typed `thread_draft` field on the post create/update/get endpoints. The legacy `posts.content` blob is still accepted on input and migrated on write, and is still readable as a fallback, so existing drafts survive the migration.
- **"Handle publication schedules"**: Supplying `scheduled_at` creates or updates a proposed future time but does not queue a draft by itself; only the schedule action atomically creates the primary job and marks the publication/renditions scheduled. Use `clear_schedule` to return them to draft. When replacing or clearing a schedule, remove only the pending primary publication job—never reply jobs, processing work, or completed/failed history—and keep REST and MCP semantics aligned.
- **"Create a background job"**: Do not use `goroutine` blindly for tasks that must survive server restarts. Insert a row into the `models.Job` table so the `BackgroundWorker` can pick it up.
- **"Modify analytics"**: Implement provider reads through the optional `platform.AnalyticsAdapter`, return normalized counters with missing keys distinct from measured zero, and keep page loads provider-free. Preserve snapshot immutability, workspace scoping, account-deletion cleanup, adaptive cadence, active-subject job uniqueness, and the pending-sweep lifecycle. A running sweep queues its successor; stale recovery completes the old sweep when that successor already exists. Keep the analytics tables owned by migration 043 instead of the Bun bootstrap list so fresh databases retain the same cascade constraints as upgrades.
- **"Handle media uploads"**: Use the `BlobStorage` interface for file storage. Upload sessions stream to local storage, use presigned single-request S3/R2 uploads up to 5 GB, and stream larger objects through bounded 8 MiB S3 multipart parts; keep reverse-proxy request limits aligned with the largest supported video. The publisher opens media through `BlobStorage` and passes a reader plus known metadata to adapters that support metadata-aware uploads. For Threads, media must be served at a publicly accessible URL. Direct browser uploads to S3/R2 also require a bucket CORS rule allowing `PUT` and `Content-Type` from `OPENPOST_APP_URL`; application HTTP CORS cannot replace it.
- **"Implement threading"**: Use `Post.ParentPostID` and `Post.ThreadSequence`. The publisher detects thread chains and publishes sequentially. Each adapter's `Publish` method handles `ReplyToID` platform-specifically.
- **"Provider app administration"**: The live **Settings → Instance → Configuration → Provider apps** surface and `/api/v1/admin/provider-apps` API manage encrypted database fallback rows for X, Mastodon, LinkedIn, Threads, Facebook, Instagram, TikTok, and YouTube. Every route requires an unscoped instance administrator; workspace roles and workspace-scoped tokens are insufficient. Client secrets are write-only, encrypted with `OPENPOST_ENCRYPTION_KEY`, and never returned. Operator-owned legacy env values or `OPENPOST_PROVIDER_APPS`/`OPENPOST_PROVIDER_APPS_FILE` take precedence and appear read-only; a matching database fallback remains deletable. Provider-app environment and database changes require a restart because the effective adapter registry is built at startup. Managed-host operators should own production provider projects and keep their canonical credentials in deployment secret storage; self-hosted operators may choose deployment config or the encrypted UI/API fallback. Keep [the operator provider-app guide](docs-site/configuration/provider-applications.md) aligned with service, handler, and UI behavior.
- **"Modify MCP tools"**: Keep the model-facing catalog compact. Add each operation to the typed `mcpOperationCatalog()` with exactly one execution mode: `query_operation` for guaranteed read-only work or `execute_operation` for state changes/external actions. `search_operations` reveals the schema and required execution tool; both delegated paths enforce the catalog classification before routing through `callMCPOperation()`. Give every tool and parameter a distinct description, add examples and enums where appropriate, declare required and unknown-field behavior explicitly, and keep the recursive catalog-quality test passing. Only add a tool to `mcpAdvertisedTools()` when clients must see its descriptor up front (for example, Apps UI metadata). Preserve authorization, workspace scoping, schema validation, quota, tool-call auditing, origin checks, protocol-version negotiation, and standard newline-delimited stdio framing.

## 5. Media & Threading Per Platform

| Platform           | Media Upload                                                      | Threading                                      |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| X/Twitter          | `POST /1.1/media/upload.json` with OAuth 1.0a (chunked for video) | `reply.in_reply_to_tweet_id`                   |
| Mastodon           | `POST /api/v2/media` (async poll for large files)                 | `in_reply_to_id`                               |
| Bluesky            | `com.atproto.repo.uploadBlob` (raw binary)                        | `reply: {root, parent}` with uri+cid JSON      |
| LinkedIn           | Vector Assets API (register→PUT→URN)                              | Comments API (`/socialActions/{urn}/comments`) |
| Threads            | Public URL in `image_url`/`video_url`                             | `reply_to_id`                                  |
| Facebook Pages     | Public HTTPS URL for image/video publishing                       | Page comments                                  |
| Instagram Business | Public HTTPS URL for feed, carousel, Story, and Reel media        | Comment replies                                |
| TikTok             | Public URL for Direct Post; binary upload for Inbox mode          | No                                             |
| YouTube            | Resumable video upload                                            | No                                             |
| Discord Webhooks   | Multipart files sent with the webhook message                     | Reply references                               |

## 6. Provider Key Convention

Provider keys in the `providers` map follow specific formats:

| Platform           | Provider Key Format                | Example                       |
| ------------------ | ---------------------------------- | ----------------------------- |
| X/Twitter          | `"x"`                              | `"x"`                         |
| Mastodon           | `"mastodon:" + server.InstanceURL` | `"mastodon:https://masto.pt"` |
| Bluesky            | `"bluesky"`                        | `"bluesky"`                   |
| LinkedIn           | `"linkedin"`                       | `"linkedin"`                  |
| Threads            | `"threads"`                        | `"threads"`                   |
| Facebook Pages     | `"facebook"`                       | `"facebook"`                  |
| Instagram Business | `"instagram"`                      | `"instagram"`                 |
| TikTok             | `"tiktok"`                         | `"tiktok"`                    |
| YouTube            | `"youtube"`                        | `"youtube"`                   |
| Discord Webhooks   | `"discord"`                        | `"discord"`                   |

**Important:** For Mastodon, the `instanceURL` stored in `SocialAccount.InstanceURL` must match exactly with the key used to register the adapter. The canonical adapter key is `"mastodon:" + server.InstanceURL` (the full URL from config, e.g., `https://masto.pt`). When looking up the provider, use `"mastodon:" + account.InstanceURL` without modification. Human-friendly server names may still be used as OAuth selection labels, but not as the persisted provider key.
