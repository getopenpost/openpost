# OpenPost AI Agents & Development Guidelines

This document serves as a guideline for autonomous AI agents (like Copilot, Cursor, Codeium, or CLI agents) and human developers contributing to **OpenPost**. It outlines the core tech stack, architectural rules, and specific instructions for AI behavior.

Treat this as a living file: add concise repo learnings when they would save future agents time, and trim entries that become stale or too obvious.

## 1. Core Architecture & Tech Stack

**Frontend:**
- **Framework:** SvelteKit (using `@sveltejs/adapter-static` for simple SPA deployment).
- **Styling:** TailwindCSS.
- **i18n:** Paraglide.
- **Testing:** Vitest.
- **Package Manager:** pnpm.

**Backend:**
- **Language:** Go (1.26.5+).
- **Framework:** Echo (`github.com/labstack/echo/v4`). Huma for OpenAPI spec generation.
- **Database:** SQLite by default; Postgres is supported and required for hosted cloud mode.
- **ORM:** Bun (`github.com/uptrace/bun`).
- **Background Jobs:** Custom database-backed polling worker using the `jobs` table (no external Redis dependency).
- **Media Storage:** Local filesystem via `BlobStorage` interface (configurable via `OPENPOST_MEDIA_PATH`).

**Deployment:**
- **Strategy:** Single Go binary. SvelteKit's static output is embedded directly into the Go executable using `go:embed`.
- **Hosted app:** `app.openpost.social` runs from the Docker image published by the GitHub `Build and Release` workflow and is pinned in `~/.config/home/hosts/rgo-vps/default.nix`.
- **Push-to-deploy:** Production releases are tag-driven. `pnpm release:prod` derives the next SemVer tag from Conventional Commits (`feat` is minor, `!` or `BREAKING CHANGE` is major, otherwise patch), pushes `main` and the tag, then waits for `.github/workflows/release.yml`. The workflow verifies the release, publishes the GHCR image, and calls the signed `deploy-openpost` VPS hook. The NixOS deploy script and readiness checks live in `~/.config/home/modules/hosting/deployments/default.nix`, while the container declaration lives in `~/.config/home/modules/services/openpost/default.nix`.
- **Keep delivery fast and reproducible:** Preserve Devenv/Cachix and dependency caches in CI and the per-image BuildKit cache in the release workflow. Cache keys must track the relevant Devenv, pnpm, Go, frontend, and Docker inputs. Do not restore `no-cache` Docker builds unless investigating cache correctness; BuildKit invalidates changed layers. Validate workflow edits and confirm the tag run reaches `app.openpost.social/api/v1/ready` before considering a release delivered.

## 2. Platform Adapter Architecture

All social platform integrations follow the unified `platform.Adapter` interface defined in `internal/platform/adapter.go`. Each platform implements this interface in its own file within `internal/platform/`:

| File | Platform | Auth Method |
|------|----------|-------------|
| `x.go` | Twitter/X | OAuth 1.0a |
| `mastodon.go` | Mastodon | OAuth 2.0 (per-instance) |
| `bluesky.go` | Bluesky | App Passwords |
| `linkedin.go` | LinkedIn | OAuth 2.0 |
| `threads.go` | Threads | Meta OAuth 2.0 |
| `facebook.go` | Facebook Pages | Meta OAuth 2.0 |
| `instagram.go` | Instagram Business | Meta OAuth 2.0 |
| `tiktok.go` | TikTok | OAuth 2.0 |
| `youtube.go` | YouTube | Google OAuth 2.0 |

Adapters are registered in `main.go` via a `map[string]platform.Adapter` and passed to the token manager, publisher, and OAuth handler. Provider selection uses adapter-map and capability-catalog lookups; switches internal to a single adapter may still dispatch that provider's content modes.

Shared HTTP helpers are in `internal/platform/http.go`:
- `DoRequest` — generic HTTP request with error handling
- `DoJSON` — JSON marshaled request
- `DoMultipart` — multipart file upload
- `DoFormURLEncoded` — form-encoded request

Analytics is an optional provider capability defined by `platform.AnalyticsAdapter`; do not add reporting methods to the core publishing `Adapter`. The analytics service stores normalized immutable account and rendition snapshots plus the latest safe sync state, and never retains raw provider responses or tokens. `GET /api/v1/analytics` reads stored data only. The worker runs a unique pending sweep every 15 minutes, checks accounts on an adaptive daily cadence, and checks published renditions at 1/3/12/24-hour bands through day 7; manual refresh covers the last 90 days. Preserve the separate meanings of views, impressions, and reach. Permission, unsupported, rate-limit, not-found, and failed states must keep the last successful counters. Existing Instagram, Threads, and TikTok accounts may need reconnection when analytics scopes change.

## 3. Agent Guidelines & Coding Mandates

When an AI agent is invoked to assist with this repository, it MUST adhere to the following rules:

### A. Commit & Branch Conventions
- **Always use Conventional Commits** (e.g., `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`). Follow https://www.conventionalcommits.org/
- **Always use Conventional Branches** (e.g., `feature/add-login`, `fix/header-alignment`, `hotfix/emergency-patch`)
- **Always update the Changelog** for any major features, bug fixes, or breaking changes. Use the `## [Unreleased]` section to document changes since the last release.
- **Use the project-owned Devenv environment.** Provision Nix, Devenv, and direnv through the durable Hermes/NAS host configuration; do not install project tools globally. After cloning, run `direnv allow`, `devenv shell -- install`, and `devenv shell -- setup`. Once direnv loads, use named commands directly; otherwise use `devenv shell -- <command>`. The supported gates are `check`, `lint`, `test`, `build`, and `verify`, with `backend-*`, `frontend-*`, and `cli-*` variants for targeted work. (`test` is a shell builtin in some interactive shells; use `devenv shell -- test` or `test-all` there.)
- **Keep setup reproducible and non-destructive.** `install` uses the committed pnpm and Devenv lockfiles and a frozen pnpm install. `setup` creates `backend/.env` only when it is absent and never replaces an existing file. Treat dotenv as data: never `source` or `eval` it. The Go application safely loads `backend/.env` when launched from the backend directory. Keep secrets out of Nix expressions and the Nix store.
- **Keep hooks fast and run broad gates explicitly.** Devenv installs the tracked `scripts/pre-push-lint.sh` gate, which checks backend formatting/lint and frontend lint without running tests or builds. Use `verify` before release tags or high-risk changes; CI remains authoritative for the full matrix.
- **Keep Go format checks inside source trees.** Project commands may create module-local `.devenv` state containing the Go toolchain's intentionally invalid parser fixtures. Preserve the `.devenv` prune in backend and CLI format checks; never run recursive `gofmt` across generated environment state.
- **Run the project doctor before broad or release work.** Use `devenv shell -- doctor` to catch low disk space, dirty or divergent Git state, stale linked worktrees, missing pinned Chromium, and missing project tools before a long gate. Linked worktrees share the primary checkout's Devenv dependency caches; remove completed temporary worktrees after their branches are clean and verified remotely.
- **Production release flow:** for normal “commit, push, release, deploy prod” requests, run `pnpm release:prod "<conventional commit message>"`. The script pushes `main`, creates the required SemVer tag from every commit since the last release, and waits for GitHub `Build and Release`; after preflight and image publication, that workflow calls the authenticated VPS deploy hook and verifies readiness. `RELEASE_BUMP` may only raise the inferred impact; `RELEASE_VERSION` is reserved for an intentional greater version-line correction and cannot undercut commit impact. If a tag fails, do not retag it; fix forward with a new SemVer tag.
- **Keep release scope explicit.** `pnpm release:prod` stages the whole worktree. Audit `git status -sb`, tracked diffs, and untracked files first; if any file is unrelated or the branch diverges, commit/rebase deliberately and release from a clean linked worktree. A push is not a deployment: completion requires the tag workflow, GitHub release, public readiness, and deployed container revision.
- **Go Backend:** Use Echo for HTTP handlers and Huma for OpenAPI endpoints. Follow the dependency injection pattern in `main.go`. Maintain separation of concerns: Handlers -> Services -> Database.
- **Platform Adapters:** Implement `platform.Adapter`. Never put provider API logic outside the `internal/platform/` package. Use shared HTTP helpers from `http.go`.
- **SvelteKit Frontend:** Always use standard Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`, `$bindable`). Use `+page.svelte`/`+page.ts` structures. Use the openapi-fetch typed client against `/api/v1` routes.
- **Frontend page states:** Use `PageContainer`/`PageHeader`, `SectionHeader`, `PageLoading`, `EmptyState`, `InlineNotice`, `AppToast`, `DestructiveConfirmDialog`, and `StandaloneShell` instead of rebuilding page chrome or feedback per route. Keep authenticated route `h1` headings at the shared application scale, choose the loading recipe that matches the eventual content, and keep wide calendar/table layouts behind content-safe breakpoints with touch-accessible alternatives.
- **Keep healthy provider state quiet.** Do not add “available” or “configured” badges for normal provider state; surface only actionable setup, degraded, unsupported, or planned states.
- **Name the active authoring paths accurately.** Use “text-and-thread composer” for the fast Post/Thread authoring surface, never “legacy composer.” Reserve “legacy” for historical schemas, migrations, and compatibility fallbacks.
- **Treat publications as the canonical user-visible post inventory.** Every text/thread publication must have a linked text-and-thread editor row; story, short-video, and video publications stay in their focused composers. Build Posts, Calendar, and agent-created drafts from publications so every content mode appears once. Keep browser fixtures and waits on `/publications` with complete `PublicationResponse` shapes when these surfaces change; stale `/posts` mocks can hide release-only loading failures.
- **Resolve X limits per connected account.** Read the authenticated X `subscription_type`, persist only the normalized capability state, and fail closed to the 280-character, 140-second, and 512 MiB standard profile when the tier is missing, stale, or cannot be refreshed. Keep frontend counters and backend validation on the shared X weighted-text rules.
- **Broad UI requests require an implementation and QA matrix.** Inventory routes and shared primitives first, then complete the requested remediation before calling the audit done. Run one browser suite at a time with the pinned Playwright Chromium; verify representative desktop and phone widths, overflow, action visibility, keyboard/touch access, and console health.
- **Treat “corresponding places” as a cross-surface inventory.** Check the authenticated app, `marketing-site`, `docs-site`, README, and canonical assets before placing demos, screenshots, public copy, or product links. `pnpm release:prod` does not prove the separately hosted marketing site is live; verify that delivery independently when it changes.
- **Regenerate contracts at their source boundary.** After changing Huma routes, CLI commands, or message catalogs, run `pnpm check:contracts` and `frontend-check` before debugging downstream type errors. Keep generated OpenAPI, TypeScript, CLI docs, and Paraglide changes in the same behavior cohort as their source; do not hand-edit them.
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

*If you are an agent, read these context hints before performing actions:*

- **"Add a new social platform"**: Create a new file in `internal/platform/` implementing `platform.Adapter`. Register it in `main.go` under the provider map. Add its icon and capability-driven composer treatment to the frontend, then update the accounts page (`/accounts`) with connect UI.
- **"Modify database schema"**: Update `internal/models/models.go` struct fields with appropriate bun tags and add a numbered SQL migration in `internal/database/migrations/`. Base tables are bootstrapped with `.IfNotExists()`, but upgrades run through `RunMigrations`; add a corresponding migration regression test.
- **"Handle thread drafts"**: Thread drafts (the in-progress state of a multi-post thread) live in the `thread_drafts` table — one row per parent post, keyed by `post_id` with `ON DELETE CASCADE`. The encoded draft JSON is the same `__openpost_thread__:` blob the frontend has always used; the backend now stores it in its own column instead of smearing it into `posts.content`. The composer sends/reads it through the typed `thread_draft` field on the post create/update/get endpoints. The legacy `posts.content` blob is still accepted on input and migrated on write, and is still readable as a fallback, so existing drafts survive the migration.
- **"Handle publication schedules"**: Supplying `scheduled_at` creates or updates a proposed future time but does not queue a draft by itself; only the schedule action atomically creates the primary job and marks the publication/renditions scheduled. Use `clear_schedule` to return them to draft. When replacing or clearing a schedule, remove only the pending primary publication job—never reply jobs, processing work, or completed/failed history—and keep REST and MCP semantics aligned.
- **"Create a background job"**: Do not use `goroutine` blindly for tasks that must survive server restarts. Insert a row into the `models.Job` table so the `BackgroundWorker` can pick it up.
- **"Modify analytics"**: Implement provider reads through the optional `platform.AnalyticsAdapter`, return normalized counters with missing keys distinct from measured zero, and keep page loads provider-free. Preserve snapshot immutability, workspace scoping, account-deletion cleanup, adaptive cadence, active-subject job uniqueness, and the pending-sweep lifecycle. A running sweep queues its successor; stale recovery completes the old sweep when that successor already exists. Keep the analytics tables owned by migration 043 instead of the Bun bootstrap list so fresh databases retain the same cascade constraints as upgrades.
- **"Handle media uploads"**: Use the `BlobStorage` interface for file storage. Upload sessions stream to local storage, use presigned single-request S3/R2 uploads up to 5 GB, and stream larger objects through bounded 8 MiB S3 multipart parts; keep reverse-proxy request limits aligned with the largest supported video. The publisher opens media through `BlobStorage` and passes a reader plus known metadata to adapters that support metadata-aware uploads. For Threads, media must be served at a publicly accessible URL. Direct browser uploads to S3/R2 also require a bucket CORS rule allowing `PUT` and `Content-Type` from `OPENPOST_APP_URL`; application HTTP CORS cannot replace it.
- **"Implement threading"**: Use `Post.ParentPostID` and `Post.ThreadSequence`. The publisher detects thread chains and publishes sequentially. Each adapter's `Publish` method handles `ReplyToID` platform-specifically.
- **"Provider app admin UI"**: The in-app Instance Admin provider-app page was removed. Hosted/operator credentials should be configured through environment/Nix secrets or `OPENPOST_PROVIDER_APPS`; backend admin provider-app APIs still exist for operator tooling.
- **"Modify MCP tools"**: Keep the model-facing catalog compact. Add each operation to the typed `mcpOperationCatalog()` with exactly one execution mode: `query_operation` for guaranteed read-only work or `execute_operation` for state changes/external actions. `search_operations` reveals the schema and required execution tool; both delegated paths enforce the catalog classification before routing through `callMCPOperation()`. Give every tool and parameter a distinct description, add examples and enums where appropriate, declare required and unknown-field behavior explicitly, and keep the recursive catalog-quality test passing. Only add a tool to `mcpAdvertisedTools()` when clients must see its descriptor up front (for example, Apps UI metadata). Preserve authorization, workspace scoping, schema validation, quota, tool-call auditing, origin checks, protocol-version negotiation, and standard newline-delimited stdio framing.

## 5. Media & Threading Per Platform

| Platform | Media Upload | Threading |
|----------|-------------|-----------|
| X/Twitter | `POST /1.1/media/upload.json` with OAuth 1.0a (chunked for video) | `reply.in_reply_to_tweet_id` |
| Mastodon | `POST /api/v2/media` (async poll for large files) | `in_reply_to_id` |
| Bluesky | `com.atproto.repo.uploadBlob` (raw binary) | `reply: {root, parent}` with uri+cid JSON |
| LinkedIn | Vector Assets API (register→PUT→URN) | Comments API (`/socialActions/{urn}/comments`) |
| Threads | Public URL in `image_url`/`video_url` | `reply_to_id` |
| Facebook Pages | Public HTTPS URL for image/video publishing | Page comments |
| Instagram Business | Public HTTPS URL for feed, carousel, Story, and Reel media | Comment replies |
| TikTok | Public URL for Direct Post; binary upload for Inbox mode | No |
| YouTube | Resumable video upload | No |

## 6. Provider Key Convention

Provider keys in the `providers` map follow specific formats:

| Platform | Provider Key Format | Example |
|----------|---------------------|---------|
| X/Twitter | `"x"` | `"x"` |
| Mastodon | `"mastodon:" + server.InstanceURL` | `"mastodon:https://masto.pt"` |
| Bluesky | `"bluesky"` | `"bluesky"` |
| LinkedIn | `"linkedin"` | `"linkedin"` |
| Threads | `"threads"` | `"threads"` |
| Facebook Pages | `"facebook"` | `"facebook"` |
| Instagram Business | `"instagram"` | `"instagram"` |
| TikTok | `"tiktok"` | `"tiktok"` |
| YouTube | `"youtube"` | `"youtube"` |

**Important:** For Mastodon, the `instanceURL` stored in `SocialAccount.InstanceURL` must match exactly with the key used to register the adapter. The canonical adapter key is `"mastodon:" + server.InstanceURL` (the full URL from config, e.g., `https://masto.pt`). When looking up the provider, use `"mastodon:" + account.InstanceURL` without modification. Human-friendly server names may still be used as OAuth selection labels, but not as the persisted provider key.
