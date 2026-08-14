# OpenPost agents

This file is always loaded. Keep it useful and compact. Code and config are the source of truth.

## What OpenPost is

OpenPost is an all-in-one social publishing workspace. It helps solo founders, creators, teams, and agencies turn ideas into channel-ready content, publish it, and track what happened.

The main user is a solo founder without a content team. The app should remove repeat work without hiding provider rules or publishing state. The Hosted service is the main product. Self-hosting is a deployment option, not a separate product.

## Core product

- A **Publication** is the user-visible post. It owns the source idea, schedule, status, and destination outputs.
- A **Rendition** is one destination-specific version. Each account can have its own text, media, format, timing, and provider settings.
- The composer supports posts, threads, stories, short videos, and videos.
- Social Sets save reusable account groups and format defaults.
- Media stays in a shared library. OpenPost Image Editor and OpenPost Video Editor create reusable, editable assets.
- A calendar and durable queue handle scheduling, publishing, failures, and retries.
- Analytics, engagement, and inbox views use stored provider data so page loads stay fast and safe.
- Workspaces hold accounts, publications, media, members, roles, billing, and usage.
- The web app, Android wrapper, HTTP API, CLI, and MCP server share the same terms, permissions, and workspace boundaries.
- The app supports English and Portuguese, light and dark themes, managed hosting, and portable self-hosting.

## Product direction

- Start with the user's work: launches, updates, lessons, and ideas.
- Preserve provider truth. Show real limits, capabilities, review needs, and failures.
- Make every outcome clear: draft, scheduled, queued, published, failed, or retrying.
- Keep one coherent product across app, automation, mobile, and self-hosting.
- Reuse established UI patterns. Consistency builds trust.
- Keep keyboard access, visible focus, readable contrast, reduced motion, and touch targets.

## Writing and product copy

- Avoid stock metaphors, similes, idioms, and other figures of speech. Prefer short, familiar words when they keep the exact meaning. Cut every word or section that adds no meaning.
- Prefer active voice when it makes the actor and action clearer. Replace jargon, foreign phrases, and needless scientific or academic terms with everyday English.
- Apply these rules in context, not as blind word replacements. Break them when accuracy, natural phrasing, tone, legal meaning, accessibility, or readability requires it.
- Keep code, commands, API fields, proper nouns, citations, quotes, legal wording, and exact technical terms intact unless they are themselves copy being improved.
- Finish every copy change with a line-by-line prose review for meaning, facts, voice, consistency, and useful detail.

## Architecture

- SvelteKit builds the interface. A Go server embeds it into one production binary.
- Echo serves HTTP. Huma owns OpenAPI. Bun ORM owns database access. SQLite is the default; PostgreSQL supports hosted use.
- Persistent work uses database jobs, not in-memory goroutines.
- Media goes through `BlobStorage`, not direct filesystem assumptions.
- Provider API code lives in `backend/internal/platform/`. Publishing, analytics, engagement, and messaging stay separate capabilities.
- Page reads use stored state. Provider calls happen in explicit sync or job flows.
- Publications are the canonical user-visible content inventory.
- Svelte code uses runes, the typed API client, and shared UI/page controls. Visible form fields belong in shared primitives.
- Secrets stay out of code and logs. Stored provider tokens are encrypted.

## Reference repositories

- Publishing, scheduling, automation, or provider work: inspect `references/postiz/` and `references/shoutrrr/` when either has similar behavior. Postiz is useful for multi-account reposts, delays, and thresholds. Shoutrrr is useful for durable repost jobs, engagement gates, plateau checks, and per-post overrides.
- Image Editor work: inspect `references/miniPaint/` for tools, raster workflows, effects, import/export, and desktop/mobile UX.
- Keep these checkouts shallow and Git-ignored. Use them as references, never dependencies. OpenPost's architecture, security, accessibility, provider rules, and product language win.
- Never commit or vendor them. Refresh with `git -C references/<name> pull --ff-only`.
- Missing checkout: clone with `git clone --depth 1 <url> references/<name>` using `https://github.com/gitroomhq/postiz-app.git`, `https://github.com/coollabsio/shoutrrr.git`, or `https://github.com/viliusle/miniPaint.git`.

## Read only what applies

- Code: use the [repository map](docs/agents/repository-map.md). Confirm paths with `rg`.
- Domain or copy: read [CONTEXT.md](CONTEXT.md).
- UI or product: read [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).
- Large, unclear, or multi-ticket work: follow the [agent workflow](.agents/skills/agent-workflow/SKILL.md).
- GitHub issues or triage: read the [issue guide](docs/agents/issue-tracker.md) and [labels](docs/agents/triage-labels.md).
- Domain docs: follow the [domain guide](docs/agents/domain.md).

## Work

- Use Devenv to enter or repair the project environment. Run verification, build, and release work through the root `bun run` commands.
- Preserve unrelated changes. Stay inside the requested scope.
- Follow the owning code. Edit sources, then regenerate outputs with repo scripts.
- Reconcile uncertain external writes before retrying.
- Behavior changes: sync relevant docs, product copy, contracts, and `CHANGELOG.md` under `Unreleased`.

## Verify and deliver

- Run the closest root gate first with a surface scope or named policy selector. The commit and push hooks enforce changed-file checks. Run `bun run doctor` before broad, browser, or release work. Use `bun run release -- check` before releases and `bun run verify` only for high-risk local build proof.
- Broad UI: test desktop and phone, controls, overflow, settled state, and console errors.
- Commits and branches use Conventional format. Commit, push, release, or deploy only when asked.
- Release scripts stage the whole tree. Release only a clean, explicit scope.
- A push is not a deployment. Require passing CI and release jobs, live readiness, and the exact live revision.
