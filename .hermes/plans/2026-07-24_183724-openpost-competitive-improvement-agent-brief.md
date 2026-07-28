# OpenPost competitive product improvement agent brief

> **Status:** planning and prompt artifact only. Do not execute this document automatically.
>
> **Prepared:** 24 July 2026
>
> **OpenPost path:** `/workspace/development/openpost`
>
> **Current observed state:** `main` at `5ff9142`; Studio is now committed. The worktree had six paths when this brief was written: release workflow, changelog, two CLI installation docs, CLI installer, and `docs/research/`. The executing agent must inspect the live state again.

## Purpose

This document gives Rodrigo:

1. a detailed description of the useful features Shoutrrr has that OpenPost lacks;
2. a description of shared jobs where Shoutrrr currently executes better;
3. product and architecture guidance for an OpenPost-native implementation;
4. a bounded first implementation pass;
5. later passes in the right order;
6. copy-paste prompts for an implementation agent.

The goal is not to clone Shoutrrr or Postiz. The goal is to close OpenPost's weakest product loop while preserving what OpenPost already does better.

OpenPost should become excellent at:

**prepare → publish → know what happened → respond → improve**

It already does most of **prepare → publish**. The next work should improve trust, outcomes and repeated daily use.

---

# 1. Product principles the agent must preserve

## Keep OpenPost's stronger foundations

Do not replace or weaken:

- the Publication/Rendition/RenditionSegment model for destination-specific output;
- the broad provider and format support;
- the typed Huma/OpenAPI contract;
- the generated frontend client;
- the provider adapter boundary under `backend/internal/platform/`;
- encrypted provider tokens;
- durable database-backed jobs;
- the single Go binary and embedded static frontend;
- SQLite-by-default and Postgres-hosted support;
- REST, CLI and MCP safety boundaries;
- the Studio/Media architecture now committed to `main`;
- OpenPost's detailed lifecycle events and Activity trail.

## Do not deepen the old content-model split

OpenPost still has legacy `Post`, `PostVariant` and `ThreadDraft` concepts beside Publication/Rendition. Before changing draft, metrics, engagement or notifications, trace which domain each real user flow uses.

New long-lived product data should attach to Publication/Rendition unless a current flow still requires a temporary compatibility path. Do not create a third content domain. Do not add analytics to one model and engagement to another without one explicit normalization boundary.

## Copy product lessons, not source shape

Shoutrrr is Laravel/React/Inertia. Postiz is a large TypeScript product. OpenPost is Go/Svelte. Read both competitors, but implement in OpenPost's architecture and visual language.

- Shoutrrr is Apache-2.0.
- Postiz is AGPL-3.0.
- OpenPost is AGPL. Even where licences are compatible, avoid blind source copying. Reimplement the user job and preserve attribution if any meaningful code is reused.

## Do not fake provider parity

Analytics, replies and actions differ by provider and account type. Every new read capability needs explicit provider capability metadata and a real unsupported state. Never show a zero where the provider returned no metric. Never display a reply, like or delete action that the provider cannot perform.

## Do not turn this into distribution avoidance

These passes should remain bounded. Do not add every competitor feature before customer asks. After each pass, release, dogfood and collect evidence.

---

# 2. Detailed feature catalogue

## A. Analytics dashboard

### User job

A user wants to know which posts worked, whether an account is growing and what to change next without opening every social app.

### How Shoutrrr does it

Shoutrrr stores time-series snapshots instead of only the latest value:

- account snapshots: follower count, following count and post count;
- post-target snapshots: likes, comments/replies, reposts/shares, impressions/views;
- 7-, 30- and 90-day ranges;
- account trend charts;
- post-performance views;
- explicit unsupported metric states;
- scheduled capture jobs;
- persistent rate-limit and unsupported state per account;
- global and per-platform polling controls.

Read these first:

- `app/Models/AccountMetric.php`
- `app/Models/PostTargetMetric.php`
- `app/Jobs/CaptureAccountMetrics.php`
- `app/Jobs/CapturePostTargetMetrics.php` or the current equivalent discovered in the tree
- `app/Enums/Platform.php`
- `resources/js/pages/analytics/index.tsx`
- analytics controllers, services, migrations and tests

### OpenPost-native version

Build metrics around Renditions because a Rendition represents one provider/account output.

Likely concepts:

- `AccountMetricSnapshot`
- `RenditionMetricSnapshot`
- provider `MetricsReader` capability or equivalent narrow optional interface;
- normalized metric keys with provider-specific provenance;
- `supported`, `temporarily_unavailable`, `rate_limited` and `not_supported` states;
- durable capture jobs with tiered cadence;
- per-account polling state and next-eligible time;
- charts that never pretend incompatible provider metrics are identical.

Start with two or three providers whose APIs and account types can be verified. Do not build nine empty adapters.

### What Postiz may teach

Inspect `gitroomhq/postiz-app` for:

- how analytics are normalized across many providers;
- which metrics it refuses to compare;
- date range and account filters;
- loading/empty/error states;
- rate-limit strategy;
- whether analytics are current snapshots or time series;
- how hosted and self-hosted modes differ.

Treat Postiz as a mature UX/reference corpus, not an architecture to import.

---

## B. Engagement/replies inbox

### User job

A user wants to see and answer replies to posts published through OpenPost without checking each network.

### How Shoutrrr does it

Shoutrrr limits the first job correctly: replies to posts it already published. It does not pretend to be full social listening.

It provides:

- durable reply ingestion;
- workspace inbox;
- unread state;
- account, platform, post and read-state filters;
- reply threads;
- text and media replies;
- like/unlike where supported;
- hide/delete where supported;
- links to the native network;
- account-level rate-limit state;
- background refresh.

Read:

- `app/Models/PostTargetReply.php`
- `app/Jobs/FetchPostTargetReplies.php`
- `app/Http/Controllers/EngagementController.php`
- `resources/js/pages/engagement/index.tsx`
- `resources/js/pages/engagement/`
- provider reply/engagement methods and tests
- `app/Enums/Platform.php` capability methods

### OpenPost-native version

OpenPost already has comment operations in `backend/internal/api/handlers/comments.go` and provider adapters. The missing product is persistence, unread state, ingestion and UI.

V1 boundary:

- only comments/replies on OpenPost-published Renditions;
- no DMs;
- no arbitrary mentions;
- no social listening;
- no unified action shown unless the adapter supports it;
- retain provider IDs, parent relationships and native URLs;
- store safe normalized text/media metadata;
- make ingestion idempotent by provider comment ID;
- model edited/deleted provider comments;
- mark read locally without changing provider state;
- use a durable polling job and persistent rate-limit state.

---

## C. Personal notifications

### User job

A user needs a concise answer to “what needs my attention?”

### How Shoutrrr does it

Shoutrrr has a personal unread centre for:

- publication success;
- publication failure;
- partial outcomes;
- accounts needing reconnection;
- invitations;
- subscription events.

Users can mark, delete, clear and configure preferences.

### OpenPost-native version

OpenPost Activity already has richer lifecycle data. Notifications should be a user-facing projection of those events, not a second competing truth.

Examples:

- “Instagram failed; LinkedIn and X published.”
- “Reconnect the company Facebook account.”
- “Three new replies need attention.”
- “Your scheduled post is still waiting because X asked us to retry after 12 minutes.”

Use durable notification rows with dedupe keys, recipient, workspace, event type, read state and safe action metadata. Do not store raw provider responses or secrets.

---

## D. Account sets

### User job

A user repeatedly publishes to the same account combinations and should not reselect them each time.

### How Shoutrrr does it

`AccountSet` and `AccountSetMember` create named groups. The destination selector treats a set as a first-class choice while still showing the resulting accounts.

Read:

- account-set models, migrations, controller and tests;
- `resources/js/components/compose/destination-selector.tsx`;
- API routes for account sets.

### OpenPost-native version

Add workspace-scoped named account sets with stable membership. Composer selection should expand the set into explicit destinations while preserving the user's ability to remove one account for the current Publication.

Decide and document what happens when:

- an account is disconnected;
- an account is deleted;
- a set becomes empty;
- a user lacks access to one account;
- set membership changes after a draft was created.

Existing drafts should not silently gain new destinations because someone edited a set later. The set is a selection shortcut, not a live dynamic publication rule.

---

## E. Cross-platform mention mappings

### User job

A user wants to mention the same person or brand across platforms even though the handles differ.

### How Shoutrrr does it

Shoutrrr stores a logical workspace mention and provider-specific handles. A Tiptap picker inserts the logical mention, then target rendering resolves it for each platform.

Read:

- `WorkspaceMention` model, migration and endpoints;
- `resources/js/components/compose/mention-picker.tsx`;
- `resources/js/components/compose/editor-body.tsx`;
- mention serialization and provider-output tests.

### OpenPost-native version

Keep a workspace mention directory:

- display name;
- optional avatar;
- provider → handle/profile mapping;
- optional native profile URL;
- last-used time.

When destinations are chosen, resolve the logical mention into each Rendition. Keep the resolved text editable. If no mapping exists, show a clear warning and either retain plain text or require a choice; do not invent a handle.

Do not make the publisher perform hidden text mutation at delivery time. Users should be able to preview the exact Rendition output.

---

## F. Command palette and keyboard workflow

### User job

A frequent desktop user wants to navigate and start work without hunting through menus.

### How Shoutrrr does it

`Cmd/Ctrl+K` can:

- search and open posts;
- open recent items;
- navigate to major pages;
- compose for an account or account set;
- connect an account;
- switch workspace;
- jump to a calendar date;
- switch theme;
- sign out.

Composer also uses direct shortcuts and `Cmd/Ctrl+Enter`.

Read:

- `resources/js/components/layout/command-palette.tsx`
- `app/Http/Controllers/CommandSearchController.php`
- keyboard shortcut tests

### OpenPost-native version

Use one searchable action registry shared by desktop palette and accessible buttons where possible. Commands must enforce permissions server-side and hide actions the user cannot perform. Do not put OAuth credential collection in the CLI; account connection remains web-only.

---

## G. Better calendar interaction

### User job

A user wants to place and move posts at exact times while understanding queue density.

### How Shoutrrr does it

- month view;
- week/time grid;
- mobile agenda;
- 15-minute drag snapping;
- filters;
- click empty time to compose;
- queue and calendar as distinct but linked jobs.

Read:

- `resources/js/pages/posts/calendar/index.tsx`
- calendar grid/components and tests
- queue page/components

### OpenPost-native version

Preserve OpenPost's slot model and existing month/agenda views. Add a responsive week grid and timed drag only when scheduling data proves it useful. Mobile should use an agenda or bottom sheet rather than a compressed desktop grid.

---

## H. Public post-review links

### User job

A user wants to show a draft or scheduled post to a client without creating an account.

### How Shoutrrr does it

- random unguessable share token;
- optional expiry;
- copy and revoke;
- noindex public page;
- post preview without workspace navigation.

Read:

- `PostShare` model and migration;
- `ShareService`;
- share routes/controller;
- `resources/js/components/posts/share-dialog.tsx`.

### OpenPost-native version

A share should be a read-only snapshot or a clearly versioned live view. Decide whether later edits update the share. Never expose provider tokens, internal IDs, Activity events or private media URLs. Serve media through bounded signed/public access. Add rate limits, expiry, revocation and `noindex`.

This is not an approval workflow. Do not add comments, statuses and approval chains until customers ask.

---

## I. Ownership transfer

### User job

A team owner needs to leave without orphaning the workspace.

### How Shoutrrr does it

The operation is transactional: validate the destination member, promote them to owner, demote the old owner to admin, and prevent destructive paths that leave no owner.

### OpenPost-native version

OpenPost has richer role granularity and organisations. Add ownership transfer only after defining whether ownership belongs to an organisation, workspace or both. Require recent authentication, clear confirmation and an audit event.

---

## J. Social login

Shoutrrr can enable Google, X and LinkedIn sign-in. OpenPost has passkeys, TOTP and session controls, so this is not urgent. Add only if hosted-conversion evidence shows authentication friction. Do not add three OAuth providers for aesthetic parity.

---

## K. Discord publishing

Shoutrrr publishes Discord messages, threads and files through channel webhooks. This is relatively cheap because it does not require a broad OAuth product integration. Add only if real users treat Discord as a publishing destination. Model it honestly as a write-only webhook target; do not imply analytics or engagement reads.

---

## L. Built-in feedback capture

### User job

A user should report a bug or idea at the moment it happens without manually describing the screen, browser and failed request.

### How Shoutrrr does it

- floating bug/feedback/question trigger;
- authenticated and verified users only;
- feature flag and configured webhook required;
- five submissions per minute rate limit;
- captures a page screenshot when opened;
- user can exclude screenshot and diagnostics;
- screenshot caps pixel ratio and skips fonts;
- cross-origin images become transparent placeholders instead of breaking capture;
- diagnostics include bounded console/network/navigation breadcrumbs;
- page data is redacted and bounded;
- self-hosted hostnames are stripped;
- screenshots and diagnostics are size-limited;
- server sends a Discord webhook embed and attachments;
- widget is disabled when no destination exists.

Read all of:

- `routes/feedback.php`
- `app/Http/Controllers/FeedbackController.php`
- `app/Services/Feedback/FeedbackService.php`
- `app/Support/FeedbackConfig.php`
- `app/Dto/Feedback/FeedbackReport.php`
- `resources/js/components/feedback/feedback-widget.tsx`
- `resources/js/components/feedback/build-feedback-payload.ts`
- `resources/js/lib/diagnostics-collector.ts`
- `resources/js/lib/redact-inertia-props.ts`
- feedback tests and the cross-origin screenshot fix

### OpenPost-native version

Use a destination interface, not a hardcoded Rodrigo webhook.

Recommended first version:

- config flag and destination URL;
- hosted OpenPost config routes reports to the OpenPost team;
- self-hosted widget is off unless the operator configures their own destination or explicitly opts into a clearly disclosed maintainer endpoint;
- UI states exactly who receives the report;
- bug, idea and question categories;
- message required;
- screenshot and diagnostics independently optional and previewable;
- sanitize before transmission, then sanitize again server-side;
- never collect provider tokens, authorization headers, cookies, request bodies, post text, uploaded media contents or arbitrary page state;
- redact self-hosted origin and private IP/hostnames;
- capture only bounded method/path/status/duration for failed API requests;
- include app version, route, component name if known, viewport, browser and recent safe navigation breadcrumbs;
- authentication, rate limit, body/file limits and timeouts;
- do not block UI on a slow webhook;
- clear success/failure state;
- no hidden telemetry.

A local-only feedback table is not enough for hosted product learning. Silent forwarding from self-hosted instances is unacceptable. Make the destination and consent explicit.

---

## M. Update-available indicator and instance controls

Shoutrrr shows the running version and available release and lets admins enable/disable platforms, metrics, engagement and polling. OpenPost should eventually expose version/update status, but polling controls only matter once read-side jobs exist. Do not build an empty control panel first.

---

## N. Hosted billing and expensive-provider metering

Shoutrrr Cloud is live at `app.shoutrrr.com`. The public plan is $10/month and includes $5 of X API usage.

Code includes:

- Stripe subscription gating;
- per-workspace usage events;
- durable period counters;
- API and MCP usage metering;
- operation-level X API unit prices;
- reconciliation and pruning commands;
- self-hosted bypass of subscription gating.

Read:

- `config/subscriptions.php`
- `config/usage.php`
- `config/usage_pricing.php`
- `WorkspaceSubscriptionGate`
- `UsageRecorder`
- `UsageEvent`
- `UsagePeriodCounter`
- usage middleware and commands

OpenPost should not absorb unbounded X cost. If hosted demand reaches this point, separate the product subscription from visible variable provider cost. Do not build detailed billing before usage exists.

---

## O. Lightweight image and video editing

Shoutrrr ships direct image crop/aspect/padding/gradient/radius/shadow/alt-text controls and browser video trim/crop/remux/transcode/compression.

OpenPost Studio is now committed and is much deeper for raster image design. Do not add a second image editor. Integrate fast crop/resize paths through Studio or Media while preserving “attach as-is”.

OpenPost intentionally lacks video editing. Do not copy Shoutrrr's browser transcoder until users ask. Browser conversion has memory, CPU, codec and device failure modes. A future V1 should probably be trim/crop/poster-frame without pretending to be a full editor.

---

# 3. Shared jobs where Shoutrrr currently does better

## Composer clarity

Shoutrrr makes base-versus-platform override state obvious and keeps the ordinary cross-post flow short. OpenPost should keep its stronger Rendition model but improve progressive disclosure:

- show the base/source clearly;
- label the active destination override;
- one-click reset to source;
- show effective output and validation per destination;
- collapse provider details until needed;
- preserve a fast text/image path;
- do not make Studio mandatory for attaching media.

## Draft concurrency and atomicity

Shoutrrr serializes 500 ms autosaves, flushes before dependent actions and tab hide, sends `expected_updated_at`, returns 409 on stale writes and presents “keep mine/use theirs”.

OpenPost must inspect all active composer domains. The audit found a two-step Publication update followed by Rendition replacement and no server revision, but current `main` may have moved since then. Studio already has revision compare-and-set and recovery behaviour; reuse its proven concepts.

The correct end state:

- every editable draft aggregate has a server revision;
- client sends expected revision;
- aggregate save is one transaction;
- stale writes return structured 409;
- autosaves are serialized;
- dependent actions flush pending saves;
- conflict UI identifies which domains changed, not only text;
- user can reload server state or save their work as a copy;
- no silent last-writer-wins across tabs or teammates.

Do not build live multiplayer editing or CRDTs.

## Per-destination publishing reliability

Shoutrrr runs one `PublishPostTarget` job per account and stores attempt details. It classifies:

- rate limit;
- expired authentication;
- validation;
- duplicate content;
- billing required;
- network;
- provider server errors;
- unknown errors.

It uses capped exponential backoff with jitter, retains provider media-upload state, allows manual target retry, and distinguishes late catch-up from posts that should become `missed`.

OpenPost already skips successful Renditions on retry and has rich lifecycle events. Improve the error contract before restructuring jobs:

- typed safe error kind;
- permanent versus transient;
- provider code where safe;
- `Retry-After`/retry-at metadata;
- reconnect-required action;
- no raw response/secrets in UI;
- correct partial-success summary;
- no repeated retry for validation or revoked auth.

Only move to one job per Rendition when tests and production evidence justify the queue/model migration. Do not do it because Shoutrrr does.

## Calendar interaction

Keep OpenPost's slots and calendar data. Borrow the week grid, exact time drag and mobile-specific agenda only after measured scheduling use.

## Failure communication

OpenPost has better event data. Turn it into plain user language and direct actions. Activity remains the audit trail; notifications become the personal attention layer.

## Media interaction

OpenPost's storage, deduplication, direct upload and Studio are stronger. Shoutrrr's lesson is speed: attach first, edit only when wanted, and return to Composer without losing context.

---

# 4. Reference protocol for every pass

The agent must inspect current source rather than rely on this brief's paths as eternal truth.

## OpenPost

1. Work in `/workspace/development/openpost`.
2. Read `AGENTS.md`.
3. Record branch, HEAD and every dirty path.
4. Read the relevant frontend route/component, Huma handler, service, model/migration, job/worker, provider adapter, generated client, tests and docs.
5. Distinguish committed, dirty, shipped, live and documented-only behaviour.
6. Preserve unrelated dirty files.
7. Use current Devenv/direnv toolchain and targeted NAS checks.
8. Do not release, push or deploy unless Rodrigo explicitly asks.

## Shoutrrr

Use the existing read-only clone if present at `/opt/data/research/shoutrrr`; otherwise clone `https://github.com/coollabsio/shoutrrr` into a temporary research path. Fetch current `main` and record commit/tag before citing it.

For each feature, trace:

- frontend interaction;
- request/route;
- controller/service;
- model/migration;
- durable jobs;
- provider capability;
- error/rate-limit state;
- tests;
- admin/config controls.

Do not infer behaviour from README claims alone.

## Postiz

Use <https://github.com/gitroomhq/postiz-app> as the canonical product repository and <https://postiz.com> / official docs as public references. Clone read-only into a temporary research path if deeper inspection is useful.

Postiz is useful because it has a larger installed/user base and mature analytics, collaboration, integrations and automation surfaces. Study:

- analytics information architecture;
- integration/provider capability boundaries;
- composer destination workflow;
- calendar and scheduling UX;
- team comments/approvals;
- notification and failure language;
- API/SDK/n8n/Make surfaces;
- hosted versus self-hosted behaviour;
- empty/loading/error states.

Do not import its heavier infrastructure or TypeScript architecture into OpenPost without need. Do not copy AI features merely because Postiz markets them.

---

# 5. Pass sequence

## Pass 1 — trust and feedback foundation

This is the first implementation prompt below.

### Scope

1. Audit all current draft save paths and document the aggregate boundary.
2. Implement server-revision conflict protection and atomic save for every active user-facing draft path in scope.
3. Reuse Studio's conflict/recovery concepts rather than creating inconsistent UX.
4. Add a normalized provider error taxonomy and correct retry metadata handling without restructuring the whole queue.
5. Improve partial-success/failure presentation using existing lifecycle events.
6. Add privacy-safe, configurable feedback capture.

### Why first

- Draft loss destroys trust.
- Permanent failures should not retry as transient failures.
- Feedback capture lets real use decide later passes.
- None requires pretending every provider supports read-side APIs.

### Exit criteria

- Two tabs cannot silently overwrite a newer draft.
- Aggregate saves cannot leave source and Renditions partially updated.
- Scheduled/publish actions flush or reject pending stale saves.
- Validation/auth failures do not enter useless generic retry loops.
- Rate-limit errors retain safe retry time.
- Partial success clearly names successful and failed destinations.
- Hosted feedback reaches the configured destination.
- Self-hosted feedback does not transmit anywhere unless explicitly configured/consented.
- Screenshot and diagnostics can each be excluded.
- Tests cover conflicts, transactions, redaction, size/rate limits and failure classification.
- OpenAPI/generated client/docs/changelog are coherent.
- No release or deployment without separate approval.

## Pass 2 — analytics vertical slice

Implement one complete provider-to-UI path, then a second provider. Include account snapshots, Rendition snapshots, capability metadata, rate-limit state, durable polling, 7/30/90-day UI and explicit unsupported states. Do not build a broad empty matrix.

## Pass 3 — replies inbox and personal notifications

Build persistent replies on OpenPost-published Renditions, unread state, filters and supported actions. Derive personal publication/account/reply notifications from existing lifecycle and engagement events.

## Pass 4 — repeated workflow speed

Add account sets and mention mappings first. Then add command palette. Add week/time calendar only if calendar usage and customer asks justify it.

## Pass 5 — collaboration and operations

Consider public review links, ownership transfer, update status and hosted usage metering. Treat social login, Discord publishing and video editing as demand-triggered options, not automatic scope.

## Pass 6 — whole-product polish and evidence

Dogfood every route on desktop/mobile, run a whole-site taste pass, fix onboarding and failure language, update screenshots/docs, instrument safe product usage where consented, and compare live conversion/use against Shoutrrr and Postiz. Remove features that add maintenance without use.

---

# 6. Copy-paste prompt: Pass 1

```text
You are implementing Pass 1 of OpenPost's competitive product improvement work: trust, draft correctness, publishing failure semantics and privacy-safe feedback capture.

Work in:
/workspace/development/openpost

Do not delegate this prompt elsewhere unless I explicitly ask. Do not push, release or deploy. Do not discard, restore, stage or reformat unrelated work.

PRIMARY GOAL

Make OpenPost safer to use before adding analytics or engagement:

1. prevent silent draft overwrite across tabs/users;
2. make active draft aggregate saves atomic;
3. classify publishing failures so permanent errors do not retry like transient errors;
4. present partial success/failure clearly;
5. add an explicit, privacy-safe feedback path that works for hosted OpenPost and does not silently exfiltrate self-hosted instance data.

MANDATORY DISCOVERY BEFORE CODE

1. Read `/workspace/development/openpost/AGENTS.md` in full.
2. Record `git status --short`, branch, HEAD and recent commits. Classify every pre-existing dirty path and preserve it.
3. Inspect the current committed Studio/media implementation. It now contains revision compare-and-set, conflict and recovery patterns; reuse or unify those ideas rather than creating a second incompatible system.
4. Trace every currently active editable content path end-to-end:
   - standard composer;
   - focused Publication/Rendition composer;
   - thread/reply-chain composer;
   - format-specific composer flows;
   - Studio return/save paths where they interact with drafts.
5. For each path, identify frontend state, API calls, handler, service, transaction boundary, models, migrations, generated client, scheduling/publish action and tests.
6. Confirm whether the previous two-call Publication-update then Rendition-replace behaviour still exists. Do not assume the old audit is current.
7. Inspect the current queue worker, publisher, lifecycle events, provider HTTP helpers and provider errors. Map where `Retry-After`, auth expiry, validation, rate limits and provider errors are currently lost or flattened.
8. Inspect the existing global shell, toast/notice components, error conventions, configuration layer and safe server-to-external-webhook patterns.

COMPETITOR RESEARCH — REQUIRED, READ-ONLY

Shoutrrr:
- use `/opt/data/research/shoutrrr` if present, otherwise clone `https://github.com/coollabsio/shoutrrr` into a temporary research path;
- fetch current main and record the commit/tag;
- inspect, not just read the README:
  - `app/Services/Posts/DraftService.php`
  - `resources/js/hooks/compose/use-autosave.ts`
  - `resources/js/components/compose/conflict-dialog.tsx`
  - `app/Jobs/PublishPostTarget.php`
  - platform exception/error classes
  - post-target attempt model/migrations
  - missed-post scheduling/catch-up logic
  - `routes/feedback.php`
  - `app/Http/Controllers/FeedbackController.php`
  - `app/Services/Feedback/FeedbackService.php`
  - `app/Support/FeedbackConfig.php`
  - `resources/js/components/feedback/feedback-widget.tsx`
  - diagnostics collector, redaction helpers and tests.

Learn from Shoutrrr's serialized autosave, expected revision, 409 conflict, target-level error taxonomy, bounded jitter, manual retry, feedback feature flag, configurable Discord webhook, rate limit, screenshot fallback and self-host hostname redaction. Identify its weaknesses too: text-only conflict diff, potentially overshared page props, large screenshot/diagnostic payloads and direct webhook coupling.

Postiz:
- inspect the current official `gitroomhq/postiz-app` repository and public docs where relevant;
- study draft/save conflict handling, publish error language, notification patterns and feedback/support entry points;
- do not copy its architecture or add unrelated AI/infrastructure.

Before implementation, write a short in-repo plan under `.hermes/plans/` with:
- current-state findings;
- exact files likely to change;
- chosen aggregate save boundary;
- migration/API design;
- frontend conflict UX;
- error taxonomy;
- feedback destination/privacy design;
- focused tests and verification commands;
- risks and explicit exclusions.

Then implement the plan task-by-task. If current source invalidates a product assumption, update the plan and explain the better path; do not force the brief onto the code.

FEATURE A — REVISIONED, ATOMIC DRAFT SAVES

Requirements:

- Every active editable draft aggregate in scope must have a server revision or equivalent monotonic compare-and-set value.
- The client sends its expected revision when saving.
- The server checks the revision inside the same database transaction as all aggregate writes.
- Source Publication/Post data, destination Renditions/Variants, segments/thread parts and media relationships relevant to that save must not be left partially updated.
- A stale write returns HTTP 409 through the typed Huma contract with:
  - stable error code;
  - current server revision;
  - safe updated-at/editor metadata where available;
  - enough changed-domain information for UI decisions;
  - no secrets or full unrelated workspace data.
- Autosaves must be serialized. A slower older response must never replace a newer client state.
- Pending autosave must flush before schedule, publish, duplicate or navigation actions that depend on current content.
- Tab-hide/unload behaviour should make a best effort without pretending unreliable unload requests are guaranteed.
- Conflict UI must offer at least:
  - reload server version;
  - preserve local work as a copy or explicitly overwrite after fetching the latest revision, depending on permissions and product fit.
- Do not show only a misleading text diff if destinations/media/settings changed. A compact changed-domain summary is acceptable.
- Reuse Studio's recovery/conflict patterns and shared UI where clean.
- Do not add CRDTs, live cursors or multiplayer editing.
- Preserve SQLite and Postgres behaviour.
- Add migration tests for idempotence and constraints.
- Add service/handler tests for successful compare-and-set, stale conflict, transaction rollback and permission boundaries.
- Add frontend tests for serialized autosave, 409 handling, pending-save flush and recovery actions.

If legacy Post/Variant and Publication/Rendition both remain active, do not quietly fix only the convenient path. Either unify the save boundary cleanly or apply one consistent revision contract to every exposed editor and document the remaining architectural debt.

FEATURE B — STRUCTURED PUBLISH FAILURE SEMANTICS

Add or normalize a safe internal error contract such as:

- `validation` — permanent until content changes;
- `auth_expired` / `reconnect_required` — permanent until account action;
- `permission` — permanent until provider/account permission changes;
- `billing_required` — permanent until provider billing changes;
- `duplicate_content` — usually permanent for that payload;
- `rate_limited` — transient with retry-at where supplied;
- `network` — transient;
- `provider_server` — transient unless provider says otherwise;
- `provider_processing` — pending/polling state where applicable;
- `unknown` — safe fallback.

Requirements:

- provider adapters and shared HTTP helpers preserve safe provider code/status and `Retry-After` metadata;
- worker distinguishes permanent from transient errors;
- permanent errors do not exhaust generic retry loops;
- transient retries use bounded backoff and jitter;
- never log or expose tokens, authorization headers, raw sensitive payloads or full provider bodies;
- preserve provider media-upload IDs across safe retries;
- keep lifecycle events as the authoritative operational history;
- present direct user actions: edit, retry, reconnect or open provider;
- show partial outcomes per Rendition rather than one vague Publication failure;
- do not restructure to one job per Rendition in this pass unless current architecture makes the narrower error fix impossible and the plan proves the migration/test scope.

Add focused tests for each error kind, `Retry-After`, permanent retry suppression, partial success and safe serialization.

FEATURE C — PRIVACY-SAFE FEEDBACK CAPTURE

Build a global authenticated feedback entry point for bug, idea and question.

Destination model:

- use a small server-side destination interface;
- first implementation may support a configured Discord-compatible webhook or existing project-standard external destination;
- hosted OpenPost can configure the OpenPost team destination;
- self-hosted widget is disabled unless the operator configures a destination or explicitly enables a clearly disclosed maintainer endpoint;
- never ship a hidden hardcoded webhook;
- UI must say who receives the report;
- if there is no destination, show a useful support/GitHub path rather than a dead form.

User control:

- message required;
- screenshot optional with preview/remove;
- diagnostics independently optional with a short human explanation;
- show what categories of diagnostics are included before send;
- no hidden telemetry.

Safe diagnostic allowlist:

- OpenPost version/build;
- current route path, not self-host origin;
- component/page name when explicitly known;
- viewport and browser family/version;
- recent navigation paths;
- bounded failed OpenPost API breadcrumbs: method, route template/path, status, duration and timestamp;
- sanitized client error names/messages with strict length limits.

Never collect:

- cookies;
- authorization headers;
- provider tokens or OAuth codes;
- request/response bodies;
- post text;
- uploaded media contents except the user-approved screenshot;
- arbitrary Svelte state/page props;
- local filesystem paths;
- private hostnames/IPs;
- third-party query secrets.

Screenshot rules:

- capture only after the user opens the widget;
- exclude the widget and sensitive-marked nodes;
- support `[data-feedback-redact]` and `[data-feedback-ignore]` or equivalent;
- cap dimensions/pixel ratio and encoded bytes;
- omit cross-origin images or replace them with a safe placeholder;
- fail gracefully if capture fails;
- never make screenshot mandatory.

Server rules:

- authenticated users only;
- clear feature/config gate;
- rate limit;
- strict message/file/body limits;
- MIME validation;
- request timeout;
- server-side origin/private-host redaction as defence in depth;
- asynchronous/durable delivery if the existing jobs architecture makes this simple; otherwise bounded synchronous delivery with honest UI and no lost-success claim;
- no raw diagnostics in normal logs;
- stable success/failure responses;
- tests for disabled destination, auth, rate limiting, redaction, size/MIME limits, optional fields and webhook failure.

UX:

- integrate with OpenPost's existing shell/components, not a floating visual clone of Shoutrrr;
- accessible keyboard/focus behaviour;
- good mobile sheet/dialog;
- concise plain language;
- no intrusive permanent obstruction over app controls.

OUT OF SCOPE FOR PASS 1

Do not implement:
- analytics;
- engagement inbox;
- DMs or social listening;
- notification centre as a full product;
- account sets;
- mention mappings;
- command palette;
- week calendar;
- public review links;
- ownership transfer;
- social login;
- Discord publishing;
- auto-repost;
- video editing;
- Redis/new queue infrastructure;
- a rewrite of all content domains;
- production deployment.

DELIVERABLES

1. Current-state and competitor findings.
2. The implementation plan with exact paths and decisions.
3. Working code for Features A, B and C.
4. Focused backend/frontend/migration/generated-contract tests.
5. OpenAPI/generated client updates where required.
6. Changelog and concise user/admin documentation, including all feedback privacy/config behaviour.
7. A final diff audit that classifies every changed path and preserves all pre-existing dirty work.
8. Real targeted test outputs. Use the repo Devenv/direnv toolchain. Keep NAS checks bounded; leave broad heavy matrix checks to CI when appropriate.
9. A short list of unresolved product decisions or provider limitations. Do not hide them behind stubs.

QUALITY BAR

- OpenPost-native design, not a Shoutrrr clone.
- Plain language.
- No fake success states.
- No silent data loss.
- No secret leakage.
- No hidden self-host telemetry.
- No unused abstraction for later passes.
- Small coherent commits if committing is appropriate, but do not push.
- Stop after Pass 1 and report. Do not begin analytics or engagement without a new instruction.
```

---

# 7. Copy-paste prompt: Pass 2 — analytics

```text
Implement OpenPost competitive improvement Pass 2: a narrow, real analytics vertical slice.

Work in `/workspace/development/openpost`. Read `AGENTS.md`, inspect current Git state, preserve unrelated work, and do not push/release/deploy.

First verify that Pass 1's draft/error foundations are present and stable. Then inspect current Shoutrrr main and Postiz as read-only references.

Shoutrrr reference areas:
- account/post-target metric models and migrations;
- `CaptureAccountMetrics` and post-target metric jobs;
- `Platform` metric capabilities;
- account rate-limit/unsupported state;
- `resources/js/pages/analytics/index.tsx`;
- analytics tests and instance controls.

Postiz reference areas:
- analytics dashboard information architecture;
- metric normalization and provider differences;
- account/date filters;
- empty/loading/error states;
- hosted/self-hosted polling behaviour.

Goal:
Ship analytics that is honest and useful for a small verified provider set, not a broad mock matrix.

Required architecture:
- attach post performance to Renditions;
- add account and Rendition metric snapshots with timestamp and provider provenance;
- define explicit provider read capability through a narrow optional adapter interface/capability;
- persist supported, unsupported, rate-limited and temporary-failure state;
- use durable jobs, tiered polling and bounded retries;
- prevent duplicate snapshots or uncontrolled polling;
- honor provider `Retry-After` and account-level budgets;
- keep SQLite/Postgres support;
- expose typed Huma/OpenAPI endpoints and generated client types;
- add admin polling controls only for capabilities that exist.

V1 UI:
- 7/30/90-day range;
- account selector;
- follower/account trend where supported;
- post/Rendition performance table;
- likes/replies/reposts/impressions only when each metric is supported;
- clear last-updated and stale/rate-limited states;
- native post link;
- no fabricated engagement-rate comparison across incompatible networks;
- responsive loading, empty, unsupported and error states.

Provider scope:
Choose one provider with strong account/post metrics and implement it end-to-end. Add a second only after the first is tested through provider fixture responses and UI. Explain why each provider/account type is supported. Do not add empty methods for every platform.

Testing:
- migration idempotence and constraints;
- snapshot dedupe/order;
- capability and unsupported states;
- provider response mapping;
- rate-limit scheduling;
- endpoint permissions and filters;
- frontend range/account/state rendering;
- no zero substitution for missing metrics.

Update docs/changelog and report exact targeted test output. Stop after analytics. Do not begin engagement.
```

---

# 8. Copy-paste prompt: Pass 3 — engagement and notifications

```text
Implement OpenPost competitive improvement Pass 3: replies inbox and personal attention notifications.

Work in `/workspace/development/openpost`. Read `AGENTS.md`, inspect live Git state, preserve unrelated work, and do not push/release/deploy.

Inspect OpenPost's current `backend/internal/api/handlers/comments.go`, provider comment methods, lifecycle events, Activity UI, queue/job patterns and account capability catalog before designing anything.

Inspect current Shoutrrr main as a read-only reference:
- `PostTargetReply` model/migration;
- `FetchPostTargetReplies`;
- engagement controller/routes;
- `resources/js/pages/engagement/`;
- provider reply/action capabilities;
- notification models, types, preferences and UI;
- account rate-limit state and tests.

Inspect Postiz for inbox, collaboration comments, notification language, filters, provider limitations and empty/error states.

V1 engagement boundary:
- replies/comments on OpenPost-published Renditions only;
- durable idempotent ingestion by provider comment ID;
- account/platform/post/read filters;
- unread local state;
- thread/parent relationships;
- text/media metadata;
- reply action;
- hide/delete/like only where the provider capability supports it;
- native network link;
- edited/deleted provider state;
- durable polling and persistent rate-limit/unsupported state;
- no DMs, arbitrary mentions, listening or sentiment AI.

Notifications:
- derive user notifications from existing lifecycle, account and engagement events;
- do not create a second operational truth beside Activity;
- durable dedupe key, recipient, workspace, type, read state and safe action metadata;
- partial publication success must name failed/successful destinations;
- reconnect-required and new-reply notifications;
- mark read, clear and basic preferences;
- concise direct copy and useful actions.

Architecture:
- attach engagement to Renditions;
- explicit optional provider capability interfaces;
- Huma/OpenAPI endpoints and generated client;
- workspace permission enforcement;
- SQLite/Postgres support;
- safe provider text/media handling;
- no raw tokens/provider responses in storage or UI.

Testing:
- ingestion idempotency;
- thread relationships;
- unread transitions;
- capability-gated actions;
- rate limits/retries;
- deleted/edited replies;
- notification dedupe and recipient permissions;
- responsive inbox UI and all page states.

Update docs/changelog, provide real targeted test output and stop after this pass.
```

---

# 9. Copy-paste prompt: Pass 4 — repeated workflow speed

```text
Implement OpenPost competitive improvement Pass 4 in this order: account sets, cross-platform mention mappings, then a command palette. Do not add the week calendar unless current usage/customer evidence is supplied.

Work in `/workspace/development/openpost`; read `AGENTS.md`; inspect Git state; preserve unrelated work; do not push/release/deploy.

Use current Shoutrrr main as a read-only reference:
- AccountSet/AccountSetMember model, controller, API and destination selector;
- WorkspaceMention model/API and Tiptap mention picker/resolution;
- command palette and command search controller;
- related permissions and tests.

Use Postiz as a secondary reference for account groups, composer account selection, mentions, global search and keyboard interaction.

Account sets requirements:
- workspace-scoped name and stable membership;
- permission-aware CRUD;
- composer can select a set and visibly expand accounts;
- user can remove one destination for the current Publication;
- existing drafts do not silently change when set membership changes;
- disconnected/deleted accounts produce clear state;
- no dynamic rules engine.

Mention mappings:
- workspace logical mention with provider-specific handles/URLs;
- searchable insert flow;
- resolve into exact editable Rendition output before publishing;
- clear warning/fallback when a destination mapping is absent;
- no hidden mutation at delivery time;
- validate provider handle syntax only where reliable;
- preserve plain text when no mapping is chosen.

Command palette:
- `Cmd/Ctrl+K`;
- searchable action registry;
- navigation, recent Publications, compose, account/account-set choice, workspace switch and calendar-date jump;
- permissions reflected in UI and enforced by endpoints;
- accessible focus/keyboard behaviour;
- mobile remains usable without the palette;
- no account credential connection in CLI; account connection stays web-only.

Add migrations, Huma/OpenAPI contracts, generated client, focused tests, docs/changelog and real verification output. Stop after these three features.
```

---

# 10. Copy-paste prompt: Pass 5 — collaboration and operations

```text
Plan and implement only the customer-supported subset of OpenPost competitive improvement Pass 5: public review links, ownership transfer, update status and hosted provider-cost metering.

Before code, inspect current customer asks/usage evidence and recommend which items to build now. Do not implement every item merely because it appears in this prompt.

Work in `/workspace/development/openpost`; read `AGENTS.md`; inspect Git state; preserve unrelated work; do not push/release/deploy.

Use Shoutrrr current main as a read-only reference for PostShare/ShareService/share dialog, ownership transfer transaction, update availability, subscription config, UsageRecorder, UsageEvent, UsagePeriodCounter, X operation prices and reconciliation/pruning commands. Use Postiz for public collaboration/review, team workflows, hosted pricing and integration usage controls.

Public review link boundary:
- read-only;
- unguessable token;
- expiry/revoke/noindex/rate limit;
- explicit snapshot-versus-live semantics;
- safe bounded media access;
- no Activity, internal IDs, provider tokens or workspace chrome;
- not a full approval workflow.

Ownership transfer:
- define organisation versus workspace ownership;
- recent-auth confirmation;
- transactional one-owner invariant;
- audit event;
- safe effect on old owner role.

Update status:
- running version/build;
- safe release lookup with caching/timeouts;
- admin-only update notice where appropriate;
- no auto-update mechanism without a separate design.

Hosted usage metering:
- only if real hosted provider cost exists;
- separate product price from variable provider cost;
- immutable usage events plus reconciled period counters;
- idempotent operation keys;
- clear workspace-visible budget/usage;
- no billing gate in self-hosted mode;
- tests for duplicate events, reconciliation and period boundaries.

Treat social login, Discord publishing and video editing as separate demand-triggered decisions. Report what you deliberately did not build and why.
```

---

# 11. Final guidance to Rodrigo

Do not give one agent all five implementation passes in a single run. It will either create a huge unreviewable diff or silently cut corners across models, jobs, adapters and UI.

Give the agent **Pass 1 only**. Review the plan before it writes code if possible. After implementation, inspect the diff and release it separately. Then choose Pass 2 or Pass 3 based on real user feedback.

The most likely order remains:

1. Pass 1: trust and feedback;
2. distribution and customer asks;
3. analytics or engagement, whichever users need more;
4. the other half of the post-publication loop;
5. account sets and mention mappings;
6. only then collaboration/operations polish.

Shoutrrr should guide workflow clarity and reliability. Postiz should guide mature product breadth and large-user-base UX. OpenPost should keep its own architecture, visual identity, provider honesty and automation strengths.
