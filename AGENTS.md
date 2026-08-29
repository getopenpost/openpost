# OpenPost agents

This file is always loaded. Keep it useful and compact. Code and config are the source of truth.

## Identity

OpenPost is an all-in-one social publishing workspace. It helps solo founders, creators, teams, and agencies turn ideas into channel-ready content, publish it, and track what happened. The main user is a solo founder without a content team; the app removes repeat work without hiding provider rules or publishing state. The Hosted service is the primary product; self-hosting is a deployment option.

- A **Publication** is the user-visible post; it owns the source idea, schedule, status, and destination outputs.
- A **Rendition** is one destination-specific version: per-account text, media, format, timing, and provider settings.
- The composer (posts, threads, stories, short videos, videos), Social Sets, shared Media library, Image and Video Editors, calendar and durable queue, analytics/engagement/inbox, and Workspaces make up the product.
- The web app, native mobile app, HTTP API, CLI, and MCP server share the same terms, permissions, and workspace boundaries.

## Product direction

- Start with the user's work: launches, updates, lessons, and ideas.
- Preserve provider truth. Show real limits, capabilities, review needs, and failures.
- Make every outcome clear: draft, scheduled, queued, published, failed, or retrying.
- UX and visual consistency is the highest product priority.
- One coherent product across app, automation, mobile, and self-hosting.
- Reuse established UI patterns. Consistency builds trust.
- Keep keyboard access, visible focus, readable contrast, reduced motion, and touch targets.

## Project state and memory

- The **OpenPost** Vikunja project is the authority for private/internal active work, specs, priorities and execution state. Create and update those tasks through Executor. GitHub Issues remain only for public reports and contributor-facing discussion.
- Hindsight bank `rodrigo` is the authority for durable cross-agent product context, domain language, decisions, constraints and project history. Recall with `project:openpost` before substantial work. Retain only verified durable facts with `project:openpost` and `source:<agent>`; never retain secrets, raw logs, temporary task state, completed-work reports or unverified claims.
- Code, tests, generated contracts, build commands, public docs and hard engineering constraints remain versioned here. Do not create new `CONTEXT.md`, mutable ADR folders, local issue stores, task boards or agent-memory files.
- Treat recalled memory as historical context, not proof of current behavior. Verify it against code, Vikunja or the live system. Correct superseded memories rather than adding contradictions.

## Working model

- Substantial, ambiguous, or multi-ticket work follows the `agent-workflow` skill; tiny, well-scoped fixes skip the flow.
- Match the work to its reference: UI/UX/visual/copy → `ux-consistency` (plus `impeccable` for design critique), `DESIGN.md`, `PRODUCT.md`; interaction sounds → `cuelume`; Go API → `huma`; TypeScript client → `openapi-typescript`; durable domain/decision context → Hindsight plus current code; paths and seams → `docs/agents/repository-map.md` (confirm with `rg`); internal work → Vikunja; public issue/PR triage → GitHub.
- Use Devenv for the environment; run verification, build, and release through the root `bun run` commands.
- Do routine, non-destructive work yourself rather than delegating manual steps; production, external, and reputational mutations stay gated (see Delivery).
- Canonical backlog: the OpenPost Vikunja project. P0 = active security/privacy/data-integrity emergency or a safety gate before an external-write path; P1 = before the next broad release or paid-growth push; P2 = planned work. Treat it as an ordered queue, not one flat list.

## Architecture

- SvelteKit builds the interface; a Go server embeds it into one binary. Echo serves HTTP, Huma owns OpenAPI, Bun ORM owns database access. SQLite is the default; PostgreSQL supports hosted use.
- Persistent work uses database jobs, not in-memory goroutines. Media goes through `BlobStorage`. Provider code lives in `backend/internal/platform/`.
- Page reads use stored state; provider calls happen in explicit sync or job flows. Publications are the canonical user-visible content inventory.
- Svelte uses runes, the typed API client, and shared UI/page controls; visible form fields belong in shared primitives. Secrets stay out of code and logs; stored provider tokens are encrypted.
- Video Editor on-canvas gestures keep drafts out of undo history and commit once on release. Animated position uses versioned vector keys with temporal easing and spatial Bezier tangents; legacy scalar X/Y tracks promote lazily on the first vector edit.
- CLI, MCP, API, and product surfaces share terms, permissions, and boundaries. Public contract changes are acceptable when deliberate and UX-improving; change the source, then regenerate.
- AI features use maintained SDKs behind a small provider-neutral boundary (`backend/internal/ai/`); reuse the shared model and config choices instead of adding per-feature models.
- Meme Maker embeds a pinned template catalog and renders in process; captions and workspace overlay bytes stay server-side, while optional AI suggestions receive only bounded written template semantics. Refresh the audited snapshot with `scripts/sync-meme-catalog.mjs <pinned-checkout>`.
- Video Editor GPU effects share one WebGL2 ping-pong compositor; use point-scatter vertex passes for exact cross-texel writes that a fragment pass cannot express.
- Video Editor adjustment layers are timed, non-rendering items; preview and export apply their enabled effects, top-first, to active visual items on higher-order tracks.
- Video Editor export workers return in-memory artifacts; only the main thread writes final workspace files. Fall back only for explicit worker limits, availability, runtime, or message-clone failures, and never retry a worker render error as a second render.
- Video Editor Auto preview serializes heavy-media proxy work, keeps proxy visuals separate from original-source audio, and applies a hysteretic render-scale cap to real GPU and stacked canvases. A bounded worker cache predecodes upcoming boundary frames; stalled seeks may present exact prewarm or filmstrip fallbacks until the video element settles. Full preview and export always use the original source at full resolution.
- Non-normal Video Editor blend modes use the shared `CanvasStackCompositor` in preview and export so each transformed layer blends against the finished frame below; keep the exact CPU fallback aligned with the GPU shader.
- Video Editor keyframe views share item keyframe tracks and `keyframeSelectionStore`; batch graph and dope-sheet edits use atomic keyframe actions so parallel metadata arrays and undo stay aligned.
- Video Editor Motion parenting stores bind-space references, resolves parent chains after local animation, links, expressions, and modifiers, and converts direct world-space canvas edits back to child-local values. Controller items participate in transforms but never render. Published composition controls store their schema on the source composition and per-instance overrides on the wrapper; preview and export apply overrides to cloned source items.
- Video Editor color comparison and pickers use `colorPreviewStore` as preview-only state; export always reads the persisted full effect stack, and grade presets clone color-category GPU effects instead of sharing mutable params.
- Video Editor keyboard commands use the closed catalog in `settings/keyboard-shortcuts.ts`; page and timeline handlers resolve saved bindings by command ID and must not add hardcoded key comparisons.
- Video Editor interface sounds use `soundPreferences` as the only Cuelume owner and semantic tokens through `sounds/editor-sounds.ts`; suppress normal cues during preview playback and remove generic control cues when an outcome cue owns the same gesture.
- Video Editor diagnostics use `previewDiagnostics` as the single owner for measured playback and renderer state. Reports must exclude project names, clip labels, media IDs, and file paths; keep repair and fixture tools out of the normal product UI.
- Video Editor ProRes decode uses the lazy `media/prores-decoder.ts` registry in every `CanvasSink` realm except the DOM-video prewarm worker. Browser-undecodable clips must keep their compatibility proxy even at Full preview quality; export still reads the original source.

## Reference repositories

- Publishing, scheduling, automation, or provider work: inspect `references/postiz/` and `references/shoutrrr/` when either has similar behavior (reposts, delays, thresholds; durable jobs, engagement gates, plateau checks, per-post overrides).
- Image Editor work: inspect `references/miniPaint/` for tools, raster workflows, effects, import/export, and desktop/mobile UX.
- OpenPost Studio, recording, or Video Editor work: read `references/README.md`, then inspect OpenScreen, Capptivo, and Cap for capture/cursor seams; FreeCut, Kdenlive, and Shotcut for editing semantics; and OpenCut, OpenVid, OpenReel, or QCut for product and interaction ideas.
- Keep checkouts shallow and Git-ignored. Use them as references, never dependencies; never commit or vendor them. Audit the source and license before porting code. OpenPost's architecture, security, accessibility, provider rules, and product language win.

## Delivery

- Commit directly to `main` with Conventional Commits; commit as work progresses. Preserve unrelated changes and stay inside the requested scope.
- Push, release, and deploy at the end, and only when asked. A push is not a deployment: releases run from `v*` tags after passing CI, live readiness, and an exact-revision check.
- Production-affecting mutations (tag push, release, deploy, destructive live actions) require explicit authorization. State the exact changes and their effect before acting.
- CI reuses Devenv/Nix/Bun/git caches and should stay fast (target under ~2 minutes where realistic).
- n8n package release work must follow `docs/agents/n8n-package-release.md`; npm publication follows exact production readiness and uses its own stable SemVer.

## Verify and deliver

- Tests need an independent reason to exist: reproduce a real failure through the closest stable boundary or check an externally defined contract. Each test must fail on a plausible behavior regression, not merely because the implementation was refactored.
- Remove circular tests that call a new private helper or guard and assert its own literals, branches, fields, or error text. When no meaningful behavior test exists, use focused practical verification and add no test.
- During development, run the nearest relevant check after each edit: `bun run check:frontend:types` for Svelte/TS type checking only, `bun run check:contracts` for generated contracts, `bun run test:file -- <path>` for a single test, `bun run test:backend:pkg -- <package>` for one Go package. Use `bun run check -- <scope>` for a full surface gate once the candidate is stable. Use `bun run doctor` before broad, browser, or release work; `bun run release -- check` before releases; `bun run verify` only for high-risk local build proof.
- UI and copy changes must pass the `ux-consistency` acceptance bar before finishing.
- Behavior changes: sync docs, product copy, and contracts under `Unreleased`. Write changelog entries to `changes/<issue-number>.md`, not directly to `CHANGELOG.md`, to avoid conflicts when parallel tickets are in flight.
