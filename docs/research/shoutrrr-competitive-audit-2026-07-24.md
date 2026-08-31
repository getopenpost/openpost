# Shoutrrr vs OpenPost — deep product and code audit

> **Historical note:** This file records the product state on 24 July 2026. It is not a current feature comparison. OpenPost added analytics, comments and replies, opt-in inboxes, feedback, Discord webhooks, and other features after this review. See the [current user docs](https://docs.openpost.social/usage/) and [provider catalogue](https://docs.openpost.social/providers/) for current facts.

**Audit date:** 24 July 2026
**Shoutrrr:** `coollabsio/shoutrrr` at `b3c4789` (`v1.3.1`)
**OpenPost release baseline:** `getopenpost/openpost` at `9515440` (`v1.1.8`)
**OpenPost worktree:** 61 dirty paths. Studio/media work is unreleased and labelled separately.

## Executive verdict

Shoutrrr is currently the better **complete social-management loop**. A user can compose, schedule, publish, see performance and respond to replies without leaving the product. Its narrower seven-platform scope has let it polish the common workflow hard: account sets, saved cross-network mentions, direct image/video editing, command search, analytics, an engagement inbox, notifications, public shares and built-in feedback capture.

OpenPost is the better **publishing and automation system**. It supports more platforms and formats, models provider differences more honestly, has a broader typed API/CLI/MCP surface, stronger token and session controls, a richer operational trail, and a much stronger native media/Studio direction. Publication/Rendition is better for genuinely different destination outputs than Shoutrrr's base-post-plus-overrides model.

The uncomfortable part: OpenPost has built more breadth than its current product loop justifies. It can prepare and deliver complex work, but it does not tell the user what happened **on the social networks after delivery**. Shoutrrr does. That makes Shoutrrr feel like a social product while OpenPost can still feel like publishing infrastructure with a UI.

Do not answer this by copying every feature. The highest-value work is:

1. built-in feedback capture so real users steer changes;
2. atomic, revisioned draft saving;
3. a thin, credible analytics loop;
4. a focused replies inbox over OpenPost's existing comment adapters/API;
5. then repeated-work wins: account sets, mention mappings, command search and calendar time editing.

Everything else should wait for customer evidence.

## Scope and evidence

This covers <https://shoutrrr.com/> and <https://github.com/coollabsio/shoutrrr>, not the unrelated `containrrr/shoutrrr` notification library.

At audit time Shoutrrr had 244 stars, 31 forks, four actual open issues (seven open issues and PRs combined) and v1.3.1. The repository was created on 12 June 2026. OpenPost had 16 stars, three forks, no open issues and v1.1.8. Stars do not prove quality, but the gap is a distribution signal: Shoutrrr benefits from Coolify's audience and a clearer category story.

Managed Shoutrrr Cloud is live at <https://app.shoutrrr.com/> with public registration, although one landing-page label still says “coming soon”. The public offer is $10/month and includes $5 of X API usage. Self-hosting remains free under Apache 2.0 without paid seats or feature locks. This live hosted path materially lowers trial friction compared with a self-host-only product and the stale contradictory copy is a small credibility defect.

The comparison uses committed OpenPost v1.1.8. The dirty worktree contains unreleased Studio, brand/template, media-library, camera, background-removal, direct-upload and Composer integration work. It is not counted as shipped.

Evidence combines the live Shoutrrr site/product tour; current source, routes, models, jobs, tests, releases, issues and PRs; and OpenPost's frontend, API, services, models, jobs, providers, CLI, MCP and docs. No provider writes or private Shoutrrr login were used.

## Product scorecard

| Area                  | Leader            | Why                                                            |
| --------------------- | ----------------- | -------------------------------------------------------------- |
| Publishing breadth    | OpenPost          | More platforms, formats and per-destination controls           |
| Composer speed/polish | Shoutrrr          | Clear base flow, compact overrides, direct media editing       |
| Scheduling            | Rough parity      | Timezones, slots, next-slot and durable jobs in both           |
| Calendar UX           | Shoutrrr          | Month, week grid, mobile agenda and timed drag                 |
| Analytics             | Shoutrrr          | Account/post metrics; absent in OpenPost                       |
| Engagement            | Shoutrrr          | Persistent replies inbox; OpenPost has backend primitives only |
| Notifications         | Shoutrrr          | Personal unread centre and preferences                         |
| Teams                 | Split             | Shoutrrr ownership transfer; OpenPost finer roles/orgs         |
| API/CLI/MCP           | OpenPost          | Broader API, released CLI, safer scalable MCP catalog          |
| Security controls     | OpenPost          | Revocable sessions, scoped tokens, export/deletion             |
| Self-hosting          | OpenPost slightly | One embedded Go binary/container                               |
| Operational audit     | OpenPost          | Rich lifecycle events and Activity UI                          |
| User feedback         | Shoutrrr          | Screenshot and diagnostics widget                              |
| Positioning           | Shoutrrr          | Clear self-hosted Buffer/Hootsuite alternative                 |

## What Shoutrrr has that OpenPost does not

### 1. Analytics — the largest product gap

Shoutrrr stores account snapshots (followers, following, post count) and post-target snapshots (likes, comments/replies, reposts/shares, impressions/views). The UI has 7/30/90-day ranges, account trend charts and post performance. Unsupported metrics remain unsupported rather than becoming fake zeroes.

Evidence: `AccountMetric`, `PostTargetMetric`, `CaptureAccountMetrics`, `Platform::supportsPostMetrics()`, `Platform::supportsAccountMetrics()` and `resources/js/pages/analytics/index.tsx`.

Capture uses durable jobs. Instance owners can disable metrics globally/per platform. Accounts persist rate-limit and unsupported state.

OpenPost Activity is not analytics; it records delivery lifecycle. No shipped account metric model, rendition-performance model, analytics route or metrics-reader contract was found.

**Why it matters:** publishing without outcomes is an open loop. Users cannot learn what worked. Another output profile does not fix that.

**Do not copy blindly:** Shoutrrr polls. OpenPost should use provider capability contracts, tiered cadence, durable rate budgets and webhooks where reliable. Start with a few verified providers, not a theoretical full matrix.

### 2. A replies/engagement inbox

Shoutrrr pulls replies/comments to product-published posts into a workspace inbox. It provides unread counts; account/platform/post/read filters; threads; text/media replies; like/unlike; hide/delete where supported; mark-read; and background refresh with rate-limit state.

Evidence: `FetchPostTargetReplies`, `PostTargetReply`, `EngagementController`, `resources/js/pages/engagement/*` and `Platform::supportsEngagement()`.

It is not a universal inbox. It centres on replies to posts Shoutrrr knows about. Discord webhooks are write-only and provider actions differ.

OpenPost is closer than the UI suggests. `backend/internal/api/handlers/comments.go` and adapters already expose listing/actions. The shipped frontend has no engagement route, normalized inbox, unread model or ingestion loop.

Ship replies on OpenPost-published content first. Do not start with DMs, arbitrary mentions or social listening.

### 3. Personal notifications

Shoutrrr has an unread centre for publish success/failure, account attention, invitations and subscription events, with mark/delete/clear and preferences.

OpenPost's Activity stream is an operator log, not a personal alert centre. A user should not inspect an audit feed to learn that Instagram failed while X and LinkedIn succeeded.

### 4. Reusable account sets

Shoutrrr groups accounts into named sets and exposes them in composer/API (`AccountSet`, `AccountSetMember`, `destination-selector.tsx`). OpenPost requires repeated individual selection. Sets turn “personal”, “company” or “client A” into stable objects.

### 5. Saved cross-network mention mappings

One logical mention can map to different handles per platform. Users save mappings at workspace level and reuse them through an inline Tiptap picker (`WorkspaceMention`, `mention-picker.tsx`, `editor-body.tsx`).

OpenPost Renditions are more general but more manual. Resolve logical mentions into Renditions, then keep results editable.

### 6. Direct image/video editing in compose

The image editor supports crop, aspect, alt text, zoom, padding, gradients, radius, shadows and batch progression. The video editor supports trim, crop, aspect, capability probing and browser remux/transcode/compression.

Evidence: `image-editor.tsx`, `video-editor.tsx`, `lib/image-editor/*`, `lib/video-editor/*`.

OpenPost's shipped flow is less direct. Its unreleased Studio is deeper and better aligned: editable designs, pages, brand assets, templates, background removal and Media/Composer integration.

Do not copy wholesale. An issue reported 5–10 second cloud image apply times. Browser conversion burns local resources and has device/codec limits. Keep “attach as-is” fast and editing optional.

### 7. Strong autosave with conflict handling

Shoutrrr autosaves after 500 ms, serializes saves, flushes before dependent actions/tab hide and avoids empty drafts. Updates carry `expected_updated_at`; stale writes return 409 and open a word diff with “keep mine/use theirs”.

Evidence: `use-autosave.ts`, `conflict-dialog.tsx`, `DraftService.php`.

OpenPost autosaves after two seconds and guards stale local request generations, but sends no server revision. Existing-publication save performs two calls: Publication update, then Rendition replacement. If the second fails, a half-updated draft can remain. Another tab or teammate can overwrite newer work.

This is a correctness gap. Shoutrrr is imperfect too: its diff only shows base text although media, targets and overrides can conflict.

### 8. Command palette and keyboard workflow

Shoutrrr's `Ctrl/Cmd+K` searches posts, opens recents, navigates, composes for an account/set, connects platforms, switches workspace, jumps to dates, changes theme and signs out. Composer supports direct shortcuts and `Ctrl/Cmd+Enter`.

OpenPost has no equivalent. Not a launch blocker, but valuable daily polish.

### 9. Better calendar interaction

Shoutrrr provides month, week/time grid, mobile agenda, date drag, 15-minute snapping, filters and click-to-compose. OpenPost has month/agenda, filters and day-level drag, but no week grid/direct time drag.

OpenPost's slot model is strong. The gap is interaction precision, not architecture.

### 10. Expiring public post links

Shoutrrr creates, copies, revokes and expires a noindex public post URL (`PostShare`, `ShareService`, `share-dialog.tsx`). Useful for clients/review, but not a full approval workflow. OpenPost lacks it.

### 11. Ownership transfer

Shoutrrr transfers workspace ownership transactionally, demotes the old owner and blocks deletion that would orphan a team. OpenPost has organisation ownership/finer workspace roles, but no transfer flow was found.

### 12. Optional social login

Shoutrrr can enable Google, X and LinkedIn sign-in. OpenPost has password, TOTP, passkeys, recovery, revocable sessions and API tokens. Low priority: passkeys solve much of the friction without more dependencies.

### 13. Discord webhooks

Shoutrrr publishes Discord messages/threads with files through webhooks. OpenPost does not. Cheap relative to OAuth providers, but not necessarily buyer-critical.

### 14. Built-in feedback capture

Shoutrrr mounts a bug/idea/question widget across the app. It can attach a screenshot, route/component, viewport/browser data and recent console/network/navigation breadcrumbs. Cross-origin images degrade to placeholders instead of breaking capture.

OpenPost has no equivalent. For a product needing users more than speculative engineering, this is one of the highest expected-value gaps.

Copy with stricter privacy: no page props, request bodies or post content by default; show what will be sent.

### 15. Update visibility and instance controls

Shoutrrr shows running version and available releases. Instance owners can toggle platforms, metrics, engagement and per-platform polling; manage admins; inspect workspace usage; edit quotas.

Most polling controls are irrelevant until OpenPost has outcome features. The update indicator is a small self-hosting win.

### 16. Auto-repost direction — not shipped

Open PR #124 proposes performance-based auto-repost for X, LinkedIn and Bluesky using timing, plateau and historical percentile gates, with account/post controls.

It is **not** in v1.3.1. Do not count it or race it. Auto-repost without proven analytics and anti-spam safeguards is a shiny feature on a missing foundation.

### 17. Hosted billing and provider-cost metering

Shoutrrr has more than a pricing page. Hosted mode includes Stripe subscription gating, per-workspace usage events and durable period counters, reconciliation/pruning commands, API and MCP usage metering, an explicit monthly X budget, and operation-level X API unit costs. Self-hosted mode disables the subscription gate.

Evidence: `config/subscriptions.php`, `config/usage.php`, `config/usage_pricing.php`, `WorkspaceSubscriptionGate`, `UsageRecorder`, `UsageEvent`, `UsagePeriodCounter`, `RecordApiUsage`, `PruneUsageEvents` and `ReconcileUsageCounters`.

OpenPost has hosted-plan and billing foundations, but Shoutrrr's explicit pass-through handling of an expensive provider is a useful commercial pattern: charge for the product separately, make variable API cost visible, and do not silently absorb uncapped X usage. This matters more than generic per-seat pricing for self-hosted buyers.

## Web-app and UX assessment

Shoutrrr's web app is not visually revolutionary. It is a disciplined shadcn-style application with a compact inset sidebar, restrained neutral palette, small typography and consistent dense controls. Its advantage is interaction design:

- Compose is the primary action rather than one module among many.
- Base content and account overrides live in one focused surface.
- Account-attention warnings appear where destinations are chosen.
- The sidebar unread badge makes engagement state hard to miss.
- Queue, Calendar, Posts, Analytics and Engagement have clear separate jobs.
- Mobile layouts deliberately replace dense desktop views with sheets and agenda streams rather than shrinking the desktop UI.
- Empty states link to the next useful action instead of merely explaining the absence of data.
- The command palette removes navigation friction once the app grows.

The public product tour is also better at proving the normal workflow than OpenPost's current public material. It shows concrete Compose, Queue/Calendar, Analytics and Engagement surfaces under one plain category promise. OpenPost spends more attention on capability breadth, agent boundaries and provider caveats before the buyer has seen the everyday loop.

Shoutrrr's weaknesses are visible too:

- Much of the UI looks like a well-executed component-library product rather than a distinct brand.
- Small type and muted contrast can become tiring in analytics and engagement-heavy screens.
- Image/video editors open a large mandatory-feeling modal around what can be a simple attachment action.
- The composer, engagement inbox and editors are dense enough that code and interaction complexity are already high.
- The floating feedback button competes with app chrome.
- Some capability controls remain visible but inert when provider APIs do not support the action; clear disabled explanations matter.

OpenPost should not visually clone Shoutrrr. Its stronger media-led product can be more distinctive. It should copy the hierarchy: one obvious primary workflow, progressive disclosure, visible status at the point of action, and mobile-specific interaction decisions. The authenticated OpenPost app could not be visually dogfooded in the isolated browser without credentials, so this comparison does not claim a complete live side-by-side UI test; OpenPost observations are grounded in its shipped Svelte components, routes and public screenshot.

## Jobs OpenPost does worse

### Draft persistence

Add a monotonic Publication revision; require `expected_revision`; provide one transactional replace-draft endpoint covering Publication, Renditions, segments and media; return 409 with current revision and changed-domain summary. Do not build CRDT collaboration.

### Destination isolation

Shoutrrr creates one durable `PublishPostTarget` job and attempt history per account. It classifies failures (`rate_limited`, `auth_expired`, `validation`, `duplicate_content`, `billing_required`, `network`, `server_error`, `unknown`), applies exponential backoff capped near one hour with bounded jitter, preserves provider media-upload state, supports manual target retry, and distinguishes late catch-up from posts that are too stale and become `missed`.

OpenPost publishes eligible Renditions sequentially inside one Publication job. It skips already-published Renditions on retry, reuses provider media state and has richer lifecycle events, but one slow target delays the rest and errors retry at publication level. Its generic worker retry does not visibly classify permanent validation/auth failures from transient failures or consistently honor provider `Retry-After` data.

When failure/load evidence justifies it, use one job per Rendition with unique idempotency and aggregate finalization. Not the first low-volume task.

### Failure communication

OpenPost Activity is strong but operational. Derive personal alerts from lifecycle events: “Instagram failed; X and LinkedIn published; reconnect or retry.” Keep one source of truth.

### Composer legibility

OpenPost's depth costs speed. Collapse advanced controls until required; clarify base-versus-destination state; preserve a fast text/image path. Shoutrrr's “editing override for [platform]” banner and one-click reset are useful references.

### Public story

Shoutrrr says “open-source, self-hosted Buffer/Hootsuite; write once, publish everywhere” and proves the flow quickly. OpenPost mixes scheduler, agent layer, provider engine, managed subscription, CLI/MCP and caveats.

The locked call is right: lead with **self-hosted social scheduler**. Agent/MCP is a differentiator, not the category.

## Where OpenPost is materially stronger

### Publishing breadth and data model

OpenPost covers nine platforms versus seven, including Mastodon, TikTok and YouTube. It handles text, links, chains, images, documents, carousels, Stories, short/long video, TikTok photo posts, YouTube thumbnails and provider settings.

Publication/Rendition/RenditionSegment allows text, title, description, media, format, profile and settings to differ per account. Shoutrrr's base-plus-overrides model is elegant for normal cross-posting but weaker for genuinely different outputs.

Borrow workflow clarity, not model limits.

### Automation surfaces

OpenPost has a broad typed API, generated OpenAPI, released CLI, stdio/HTTP MCP, searchable operation catalog, read-only versus mutation separation and scoped revocable tokens.

Shoutrrr REST covers core accounts, sets, calendar, schedule, media, posts/actions and shares. Its 24 direct MCP tools do not match OpenPost breadth or scalable safety. No comparable CLI was found.

### Security and operations

Both encrypt tokens and support TOTP/passkeys. OpenPost adds revocable login sessions, scoped API tokens, export/deletion, legal acceptance and clearer API/MCP boundaries.

OpenPost lifecycle events cover validation, queueing, upload, provider processing, success, failure, retry, cancellation and schedule changes. Build notifications/analytics on this.

### Packaging and Studio

OpenPost's embedded Go binary/container is lighter than Laravel plus worker/scheduler and also ships binaries, Docker, NixOS and Android artifacts. Shoutrrr packages its Octane web process, queue worker and scheduler into one supervised container, so its operational UX is still reasonable even though the runtime has more moving parts. Do not add Redis/infrastructure to OpenPost before load proves it.

OpenPost's shipped media layer is also stronger than the first audit summary suggested: it already has local and S3-compatible storage, direct browser-to-object-storage upload sessions, hash deduplication, provider-aware validation, usage-aware deletion, favourites, thumbnails and provider-upload-state reuse across retries. Studio extends that base rather than rescuing a missing media system.

The dirty Studio/media direction can be a real advantage over Shoutrrr's utility editors. It does not count until finished, verified, released and shown to users.

## Code and architecture notes

Shoutrrr is Laravel 13/React 19/Inertia/Tiptap using Passport, Laravel MCP, Octane/FrankenPHP, SQLite/Postgres, DB/Redis queues and local/S3 media. Its domain is cohesive: `Post` → one `PostTarget` per account → `PostTargetAttempt`, metrics and replies.

OpenPost's Go/Huma/Bun/Svelte architecture and Publication/Rendition model are stronger for broad typed integration. The remaining `Post/PostVariant/ThreadDraft` domain beside Publication/Rendition increases maintenance cost. New analytics/engagement should attach to Renditions, not deepen the legacy split.

OpenPost's reliability debt is broader than draft conflicts: lifecycle-event idempotency is good, but there is no universal HTTP idempotency-key contract and no scheduler can guarantee exactly-once publication across the crash window where a provider accepts a post but the local worker dies before saving the remote ID. That limitation applies to both products unless each provider supports reconciliation. OpenPost should document the boundary and add provider-specific reconciliation where feasible rather than claim impossible global exactly-once delivery.

Tracked test-file counts:

| Repository | Backend |     Frontend |
| ---------- | ------: | -----------: |
| Shoutrrr   | 332 PHP |   110 TS/TSX |
| OpenPost   |  118 Go | 26 TS/Svelte |

Counts are not quality scores, but Shoutrrr has much more focused frontend test-file coverage around its state-heavy composer/editors. Its manifests show no durable browser E2E suite, so OAuth/media/provider claims still need live verification.

Strengths worth borrowing: optimistic concurrency; target-level jobs/attempt metadata; persistent rate-limit/unsupported state; explicit metrics/engagement capability gates; focused UI tests; instance feature switches; feedback diagnostics.

Risks: six-week-old codebase with 40 migrations and very wide scope; 800-line image editor and near-1,000-line video editor; text-only conflict preview; polling/restricted-scope dependence; unavailable LinkedIn personal metrics and Discord reads; browser conversion limits; incomplete REST exposure of analytics/engagement; direct MCP list growth; provider approval reality behind broad claims.

## Prioritized roadmap

### P0 — protect work and collect evidence

1. **Privacy-safe feedback capture.** Optional screenshot, route/version/viewport and sanitized failed-request breadcrumbs. Small/medium.
2. **Atomic revisioned saves.** Publication revision, expected revision, transactional replace, conflict UI. Medium and a trust requirement.

### P1 — close the social loop

3. **Analytics v1.** Start with two or three verified providers. Use `RenditionMetricSnapshot`, `AccountMetricSnapshot`, provider `MetricsReader`, and persistent unsupported/rate-limit state. No misleading universal engagement rate.
4. **Replies inbox v1.** Build on comments API: replies to OpenPost-published content, unread/filter/reply/hide/delete/network link. No DMs/listening.
5. **Personal publish/failure notifications.** Derive from lifecycle events and show partial success.

### P2 — repeated workflow wins

6. account sets;
7. saved mention mappings resolved into editable Renditions;
8. command palette for navigation/search/compose/workspace/date;
9. week calendar/time drag only after scheduling use proves demand.

### P3 — useful, not urgent

- expiring review links;
- ownership transfer;
- update indicator;
- optional social login;
- Discord webhooks;
- richer notification/instance controls.

### Do not build yet

- performance auto-repost;
- universal inbox/DMs/listening;
- complex approvals;
- a second editor beside Studio;
- Redis/queue infrastructure without evidence;
- fake metric parity;
- a feature-copy sprint before 30 real customer asks.

## Sequence against the 90-day focus

1. Finish/release the coherent Studio/media work already open; do not branch into five competitor features.
2. Add privacy-safe feedback capture.
3. Make the 30 offers. Ask: **“After scheduling, what do you need to see or do here to avoid opening every social app?”**
4. Pick one next cycle from analytics, replies or account-set/mention friction based on answers.
5. Implement revisioned saves before team use grows, even if nobody asks. Lost work is reported after trust breaks.

## Bottom line

Shoutrrr's threat is not that it supports more. It does not. It chose a narrower job and made the full job feel complete.

OpenPost already has enough technical breadth. Its next advantage comes from turning publishing into a loop:

**prepare → publish → know what happened → respond → improve.**

Take Shoutrrr's feedback discipline, draft safety, outcome visibility and repeated-work shortcuts. Keep OpenPost's stronger Rendition model, provider honesty, automation boundary, Studio direction and packaging.

Do not use this audit to avoid distribution. Shoutrrr reached 244 stars in six weeks partly through Coolify's audience and a category anyone understands. OpenPost has 16 stars and a stronger engine. The immediate gap is also attention, proof, positioning and direct customer contact.

## Primary sources

### Shoutrrr

- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/README.md>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/app/Enums/Platform.php>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/app/Jobs/PublishPostTarget.php>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/app/Services/Posts/DraftService.php>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/hooks/compose/use-autosave.ts>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/components/compose/conflict-dialog.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/components/compose/image-editor.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/components/compose/video-editor.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/pages/analytics/index.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/pages/engagement/index.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/components/layout/command-palette.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/resources/js/components/feedback/feedback-widget.tsx>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/config/subscriptions.php>
- <https://github.com/coollabsio/shoutrrr/blob/b3c4789/config/usage_pricing.php>
- <https://app.shoutrrr.com/>
- <https://github.com/coollabsio/shoutrrr/pull/124>

### OpenPost

- <https://github.com/getopenpost/openpost/tree/9515440>
- <https://github.com/getopenpost/openpost/blob/9515440/backend/internal/capabilities/capabilities.go>
- <https://github.com/getopenpost/openpost/blob/9515440/backend/internal/services/publisher/publisher.go>
- <https://github.com/getopenpost/openpost/blob/9515440/backend/internal/queue/worker.go>
- <https://github.com/getopenpost/openpost/blob/9515440/backend/internal/api/handlers/comments.go>
- <https://github.com/getopenpost/openpost/blob/9515440/frontend/src/lib/components/compose-focused-publication.svelte>
- <https://github.com/getopenpost/openpost/blob/9515440/frontend/src/routes/calendar/+page.svelte>
- <https://github.com/getopenpost/openpost/blob/9515440/frontend/src/routes/activity/+page.svelte>
