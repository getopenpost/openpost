# OpenPost audit remediation TODO

> Created: 2026-08-09
>
> Repository baseline: `50513cef3e1cd5e16efaf06d26a913beac686520`
>
> Scope: the application-checklist audit, the deep source/dead-code audit, the follow-up marketing/pricing/privacy/legal/billing review, the shared provider-kernel plan for Pinterest/Google Business Profile/Reddit, the approved operator-connector design for #32, and the installable `n8n-nodes-openpost` package plan. This is a remediation backlog, not a claim that every optional checklist pattern belongs in OpenPost.
>
> The checkout was already dirty. This file does not claim that current uncommitted work is shipped. A user-supplied live observation is labeled as such; attachment findings should be rechecked against the implementation immediately before work starts.

The older launch checklist remains useful for clean-install and provider verification. It is not duplicated here unless the newer audits found a concrete defect or incomplete experience.

Inventory: **5 P0 expansion gates**, **26 P1**, **121 P2**, and **11 P3** task headings, plus explicit product decisions, preservation guardrails, and an external-verification queue. Some P2 entries are deliberate decision gates rather than assumed feature commitments.

## How to use this backlog

Priority means:

- **P0:** active security/privacy/data-integrity emergency, or a non-negotiable safety gate before enabling a new external-write path. The original audits found no active P0 incident; the later provider plan adds five P0 expansion gates.
- **P1:** fix before the next broad release or paid-growth push. These affect correctness, account recovery, legal/trust accuracy, billing continuity, access control, or a core user journey.
- **P2:** planned product or engineering work. The feature exists but is incomplete, misleading, inefficient, or hard to maintain.
- **P3:** polish, cleanup, or preventive maintenance. Batch these only after behavior is covered.

Evidence labels mean:

- **Current source:** reproduced or traced in the current baseline.
- **Baseline audit:** source-grounded at the SHA above; recheck first because the worktree may have moved.
- **User-reported live:** the supplied review states the production behavior was observed; keep it P1 until a fresh live check clears it.
- **Operator facts required:** do not invent public copy. Obtain deployment, provider, legal, or business evidence first.
- **Conditional:** make an explicit product decision; absence alone is not a defect.

For every code or copy item, completion also means:

- add focused regression coverage at the boundary that failed;
- run the relevant project checks and representative desktop, 390 px, and 320 px browser checks when UI changes;
- check keyboard, screen-reader naming, touch targets, reduced motion, overflow, loading, empty, error, and retry states where relevant;
- update generated contracts, docs, public claims, and `CHANGELOG.md` when behavior changes;
- distinguish local validation from deployed verification.

## P0 — integration expansion safety gates

These do not assert a newly observed production incident. They block Pinterest, GBP, Reddit, protocol connectors, and any new automated external-write path until their invariants are proven.

### PROV-AUTH-001 — Separate OAuth grants from provider destinations

- [x] **Problem — Confirmed architecture gate:** multi-destination saves duplicate one credential into each `SocialAccount`, while refresh updates one row. Sibling locations/channels can diverge after rotating-token refresh.
- **Fix:** add `oauth_grants` with provider/project identity, encrypted access and refresh tokens, both expiries, scopes, subject, execution mode/evidence, token version, refresh lease, consent, revocation, and validation timestamps. Let many destination accounts reference one grant; update rotating refresh tokens atomically with a DB lease/lock and compare-and-swap.
- **Done when:** concurrent refresh cannot split sibling destinations; grant rotation/revocation is atomic; the UI distinguishes “disconnect this destination” from “revoke the grant and disconnect every destination”; SQLite/Postgres race tests pass.
- **Evidence:** `backend/internal/services/account_saver/account_saver.go:155`, `backend/internal/services/tokenmanager/manager.go:124`.

### PROV-AUTHZ-001 — Persist an immutable publication authorization receipt

- [x] **Problem — Confirmed architecture gate:** durable jobs do not carry a complete immutable record of who authorized which revision, targets, content/media/settings, schedule, and provider execution policy.
- **Fix:** add `publication_authorizations` with actor/origin (browser, API, MCP, CLI, worker), user/session/token/client identity, publication revision, account and `target_key`, scheduled time, content/media/settings hashes, policy mode, and confirmation time.
- **Done when:** every external write can be tied to the exact consent, revision, targets, and policy that authorized it; changes after scheduling cannot silently alter the receipt; audit/export tests redact sensitive values.

### PROV-WRITE-001 — Fence ambiguous external writes durably

- [x] **Problem — Confirmed architecture gate:** `Adapter.Publish` returns only an external ID and normal publishing flattens acceptance into `published`; stale sending jobs can be retried even when a provider accepted the write but OpenPost lost the response.
- **Fix:** add `provider_write_attempts` (`prepared → sending → accepted | definite_failure | ambiguous`) and structured `PublishResult` fields for external ID/URL, submission/provider state, retry safety, and reconciliation delay. Persist payload fingerprint and safe error class, never raw response/token. A stale `sending` attempt becomes reconcile-only `ambiguous`.
- **Done when:** crash tests before send, during send, after acceptance, and before DB commit prove an unknown outcome cannot be recreated automatically; only definitely pre-send, definitely rejected, or provider-idempotent work retries.
- **Evidence:** `backend/internal/platform/adapter.go:223`, `backend/internal/services/publisher/publisher.go:295`, `backend/internal/queue/worker.go:209`.

### PROV-MEDIA-001 — Repair rendition-owned provider media state

- [x] **Problem — Reproduced schema gate:** migration 020 makes `provider_media_states.post_id` reference `posts`, while rendition publishing writes a rendition ID into the ownership fields. Upgraded SQLite foreign-key enforcement fails.
- **Fix:** migrate to typed owner/owner ID or a dedicated rendition-media-delivery table containing provider upload ID, resumable session state, progress, expiry, cover/thumbnail relation, last check, and retry classification.
- **Done when:** populated fresh/upgrade SQLite and Postgres migrations pass, the reproduced FK failure is gone, interrupted uploads resume safely, and no media record can attach to the wrong aggregate. This gates Pinterest video.
- **Evidence:** `backend/internal/database/migrations/020_provider_media_states.sql`, `backend/internal/services/publisher/publisher.go:1467`.

### PROV-READY-001 — Make provider readiness evidence-based

- [x] **Problem — Confirmed product/release gate:** an adapter’s registration is too easily treated as readiness even when approval tier, scopes, account/format live proof, policy mode, refresh/revocation, or test freshness is missing.
- **Fix:** create a certification ledger with provider app/environment, approval, scopes, account/format, policy mode, exact SHA/test date, immediate/scheduled result, safe external result reference, refresh/revocation result, operator, and retest expiry.
- **Done when:** no provider/format is advertised because an adapter merely exists; healthy state stays quiet; only approval-required, reconnect-required, trial-only, policy-restricted, degraded, or expired-proof states surface.
- **Evidence:** `backend/internal/api/handlers/provider_readiness.go:44`, `docs-site/providers/launch-matrix.md:3`.

## P1 — release, correctness, recovery, billing, and trust

### REL-001 — Stamp a stable version into the immutable release candidate

- [x] **Problem — Baseline audit:** CI embeds `candidate-${SHA}` into the image and promotion retags that exact image. Production therefore reports a candidate version, and the update checker treats it as a development build and stops checking releases.
- **Fix:** generate one release manifest containing SemVer and revision before candidate CI; embed it into the candidate; preserve no-rebuild digest promotion; verify both values before promotion, after deployment, and at `/api/v1/version`.
- **Done when:** candidate and promoted digest expose the intended stable SemVer plus exact SHA; update checks run on production builds; a mismatch blocks promotion or rolls deployment back.
- **Evidence:** `.github/workflows/ci.yml:213`, `.github/workflows/release.yml:89`, `.github/workflows/release.yml:124`, `scripts/release.mjs:406`, `backend/internal/services/updatestatus/service.go:119`.

### PUB-001 — Give REST and MCP one publication-creation command

- [x] **Problem — Baseline audit:** REST persists `CreationPreset`; MCP persists only `Intent`, so Bun can default Thread, Story, and video creations to the `post` preset and resolve the wrong capabilities.
- **Fix:** immediately write both fields in MCP, then move validation, defaults, persistence, and initial job behavior into a shared application command used by Huma, MCP, and CLI adapters.
- **Done when:** REST and MCP create identical stored values and resolved capabilities for post, thread, story, and video; parity tests cover every mode.
- **Evidence:** `backend/internal/api/handlers/publications.go:550`, `backend/internal/api/handlers/mcp.go:3345`, `backend/internal/models/models.go:751`, `backend/internal/capabilities/capabilities.go:595`.

### EDIT-001 — Restore the Video Editor ↔ composer round trip

- [x] **Problem — Baseline audit:** the editor can complete a handoff token, but the unified composer no longer creates or consumes the video handoff even though the docs promise it.
- **Fix:** add an editor-agnostic handoff coordinator shared by Image and Video editors. Preserve the composer draft across launch, cancel, error, and completion; return media plus relevant metadata to the exact originating draft.
- **Done when:** a user can start editing a selected video from the composer and return it to the same draft without losing text, destinations, schedule, or media; both editor directions have browser tests and accurate docs.
- **Evidence:** `frontend/src/lib/video-editor/api.ts:206`, `frontend/src/routes/video-editor/[id]/+page.svelte:3245`, `frontend/src/lib/components/compose-text-post.svelte:4391`, `docs-site/usage/video-editor.md:49`.

### DOC-001 — Remove the live Studio docs dead end

- [x] **Problem — Baseline audit:** the docs sidebar links to `/usage/studio`, which has no page; the Markdown-only link check does not inspect configured navigation.
- **Fix:** point navigation to the Image and Video Editor guides or add an intentional Studio overview; preserve an inbound redirect if old links exist; make CI crawl every configured sidebar/nav target.
- **Done when:** the deployed route is valid or redirects intentionally, all navigation targets return success, and a config-nav regression test fails on future dead links.
- **Evidence:** `docs-site/.vitepress/config.ts:34`, `docs-site/usage/index.md:22`, `scripts/check-doc-links.mjs:14`.

### JOB-001 — Make media-cleanup scheduling exactly deduplicated and atomic

- [x] **Problem — Baseline audit:** cleanup uniqueness uses a substring search over serialized JSON, includes completed jobs, and performs a non-transactional check-then-insert; the recurring successor has no idempotency guard.
- **Fix:** add exact typed `scope_id`/`dedupe_key` fields, a partial unique constraint for active jobs, and transactional/upsert enqueue through a typed job registry.
- **Done when:** substring-collision, completed-job, concurrent-enqueue, crash-recovery, and recurring-successor tests prove at most one active cleanup chain per scope.
- **Evidence:** `backend/internal/queue/worker.go:540`, `backend/internal/queue/worker.go:603`.

### SEC-001 — Add MFA recovery codes and prove recovery before enabling TOTP

- [x] **Problem — Current source audit:** TOTP/passkey security is substantial, but TOTP enrollment has no one-time recovery-code set or required save/copy acknowledgement. Loss of the authenticator can become a support-led lockout.
- **Fix:** generate hashed, single-use recovery codes; show them exactly once; require download/copy acknowledgement before setup completes; expose regeneration and remaining-code count behind recent re-authentication; invalidate old codes on regeneration or MFA reset.
- **Done when:** setup cannot finish before backup-code acknowledgement; each code works once; regeneration revokes the old set; disabling/resetting MFA requires re-authentication; login and recovery paths are covered end to end.
- **Evidence:** `frontend/src/routes/settings/+page.svelte` security section and `backend/internal/api/handlers/auth.go` security/MFA handlers.

### NOTIF-001 — Scope notification bulk actions to the visible workspace

- [x] **Problem — Current source:** `/notifications` lists one workspace, but “Mark all read” sends only `{all:true}` and the service updates every unread notification for the user. A click can silently mark unseen alerts in other workspaces as read. Delete-all has the same global backend scope and needs explicit product wording if that is intentional.
- **Fix:** include and authorize `workspace_id` for workspace-local bulk mutations and apply the same selected-workspace-plus-deliberate-global-item rule as the list, or change the list and copy to an intentionally global inbox. Give delete-all its own clearly stated scope and confirmation.
- **Done when:** multi-workspace tests prove a workspace action cannot mutate another workspace; the UI states whether an action is workspace or account wide.
- **Evidence:** `frontend/src/routes/notifications/+page.svelte:49`, `frontend/src/routes/notifications/+page.svelte:62`, `backend/internal/api/handlers/notifications.go:34`, `backend/internal/services/notifications/service.go:244`, `backend/internal/services/notifications/service.go:293`.

### EDIT-002 — Reset editor catalog state on workspace changes

- [x] **Problem — Current source audit:** `/editors` does not react to workspace switches and keeps bounded design/video results from the previous workspace. That is both confusing and a cross-workspace data-separation UX defect.
- **Fix:** key editor queries, selection, loading, errors, and caches by workspace; cancel/ignore stale requests; clear old results immediately; add real pagination or scoped search beyond the current fixed caps.
- **Done when:** switching workspaces never shows or opens assets from the prior workspace; race tests cover slow old requests; users can reach more than 100 designs and 50 videos.
- **Evidence:** `frontend/src/routes/editors/+page.svelte` workspace/query lifecycle.

### TEAM-001 — Complete member access lifecycle, not only invitations

- [x] **Problem — Current source audit:** workspace invites, roles at invite time, pending revoke, and seat limits exist, but admins cannot change an accepted member’s role, deactivate/remove a member, resend an invite, or quickly search/filter the team. Non-admins can see an invite form that the API correctly rejects.
- **Fix:** add authorized role change, temporary deactivation, permanent removal, resend, revoke, search/filter, and optional bulk invite; hide or disable admin actions for non-admins; preserve last-owner/admin safeguards and audit every access change.
- **Done when:** admin/member/viewer permissions are enforced server-side and reflected in UI; pending and accepted users have complete state transitions; seat counts update atomically; tests cover self-removal, last-admin, revoked invite, and unauthorized mutations.
- **Evidence:** team/invitation section in `frontend/src/routes/settings/+page.svelte` and workspace invitation handlers/services.

### BILL-001 — Give past-due accounts an explicit recovery path

- [x] **Problem — Current source audit:** `past_due` is rendered as a status label only. There is no prominent explanation, deadline/access impact, or direct payment-update recovery action.
- **Fix:** add an account-wide past-due notice and billing-page recovery card with the failed state, what may happen, the safe next action, and a Paddle portal deep link or native update flow. Keep access gating and retry state consistent with webhook truth.
- **Done when:** simulated failed-payment/webhook states surface recovery everywhere relevant; the user can reach payment update in one action; successful recovery clears the warning; tests cover stale and repeated webhooks.
- **Evidence:** `frontend/src/routes/settings/+page.svelte:354`, `frontend/src/routes/settings/+page.svelte:2440`.

### PRICE-001 — Make all five public plans selectable

- [x] **Problem — User-reported live:** public pricing visibly offers CTAs only for Starter, Founder, and Pro; Team and Agency appear later as limits without a purchase action. The current checkout also contains an in-flight `plans.slice(0, 3)` implementation, so this remains a release blocker even if production is rechecked.
- **Fix:** present all sellable plans in one coherent decision model with “best for” guidance and an action for every plan; keep monthly/annual state synchronized across cards, mobile details, comparisons, registration, and checkout.
- **Done when:** all five plans have discoverable monthly and annual CTAs, generated URLs select the right plan/period, mobile and desktop agree, and browser tests cover every plan.
- **Evidence:** `marketing-site/src/routes/_components/PricingShowcase.svelte:13`, `marketing-site/src/routes/pricing/+page.svelte:74`.

### LEGAL-001 — Align the encrypted-backup claim with controlled-cloud reality

- [ ] **Problem — Current source plus operator configuration:** Privacy says “Encrypted database backups,” while the controlled cloud job pipes `pg_dump` through gzip into `/var/backup/openpost` with no encryption step shown. This proves a disclosure/evidence gap, not that every underlying storage layer is unencrypted.
- **Fix:** either encrypt each backup artifact with managed, rotated keys and prove restore/key recovery, or document and evidence the exact storage-layer encryption boundary and revise the policy to match. Cover database and media backups, access, retention, deletion, monitoring, and restore drills.
- **Done when:** the policy names the verified encryption boundary accurately; a restore drill from the encrypted artifact succeeds; key loss/rotation and operator access are documented without exposing secrets.
- **Evidence:** `marketing-site/src/routes/privacy/+page.svelte:218`, `/Users/rgo/.config/home/modules/services/openpost/default.nix:396`.

### LEGAL-002 — Use one canonical legal-policy version everywhere

- [x] **Problem — Current source:** Privacy, Terms, and Refunds say “Effective date: 5 August 2026,” while production acceptance configuration records `2026-08-04`. Re-prompt logic compares exact version strings, so users can be recorded against the wrong version and miss a required re-acceptance.
- **Fix:** create one canonical policy-version source consumed by public documents, hosted configuration, acceptance records, and release checks; decide whether Refunds requires separate acceptance; migrate or re-prompt affected users deliberately.
- **Done when:** displayed date/version, API configuration, stored acceptance, and changelog agree; a substantive version bump forces re-acceptance; cosmetic changes follow the documented policy; migration tests cover existing `2026-08-04` records.
- **Evidence:** `marketing-site/src/routes/privacy/+page.svelte:5`, `marketing-site/src/routes/terms/+page.svelte:5`, `marketing-site/src/routes/refunds/+page.svelte:5`, `/Users/rgo/.config/home/modules/services/openpost/default.nix:352`, `backend/internal/api/handlers/auth.go:1721`.

### TRUST-001 — Publish managed-cloud residency, subprocessors, and human-access facts

- [ ] **Problem — Operator facts required:** the managed service does not disclose hosting/data residency, a complete subprocessor list, international-transfer basis, or the policy for human production access. This is a procurement and trust blocker, not evidence of insecure handling.
- **Fix:** obtain operator/legal-approved facts; publish a dated subprocessor/residency page and change-notification process; document role-based/support access, approval, logging, emergency access, review, and revocation at an appropriate level.
- **Done when:** every managed data store/provider and transfer is accounted for; customers can see region, purpose, data category, and update date; internal access procedure and audit evidence exist; no unsupported certification or GDPR logo is added.
- **Evidence:** `marketing-site/src/routes/privacy/+page.svelte`, `marketing-site/src/routes/security/+page.svelte`.

### APP-001 — Return a real, recoverable app 404 instead of a blank HTTP 200

- [x] **Problem — User-reported live/current source:** an unknown app URL falls through the SPA handler, returns `index.html` with HTTP 200, and can render a blank page plus a console “Not found” error. Users have no route home and crawlers receive the wrong status.
- **Fix:** introduce a route-aware app not-found experience with brand, explanation, back/home, primary product destinations, docs/support, and optional search. Make direct unknown-document requests return a real 404 while preserving adapter-static deep links for known SPA routes.
- **Done when:** direct and client-side unknown routes show the same recovery UI, return correct status where the server can know it, preserve accessibility/theme/mobile behavior, and produce no console error.
- **Evidence:** `backend/cmd/openpost/web.go:90`, `frontend/svelte.config.js:6`.

### LEGAL-003 — Correct the camera-recording disclosure

- [x] **Problem — Current source:** Privacy says camera video is not recorded, but the Video Editor can record an enabled camera stream locally through `MediaRecorder`. The policy later says recording runs in-browser, leaving a direct contradiction.
- **Fix:** state plainly that camera recording is optional and local to the browser until the user chooses cloud save, Media save, or post handoff; distinguish still-photo capture, live preview, local project data, export, and upload.
- **Done when:** Privacy/Legal approves consistent wording across Privacy, tool pages, permission prompts, and editor UX; browser behavior matches each disclosed transition.
- **Evidence:** `marketing-site/src/routes/privacy/+page.svelte:117`, `marketing-site/src/routes/privacy/+page.svelte:247`, `frontend/src/lib/video-editor/recorder.ts:85`, `frontend/src/lib/video-editor/recorder.ts:217`, `frontend/src/lib/video-editor/recorder.ts:246`. Resolved in the legal inventories commit `c4584d1e`, which states camera recording is optional and local to the browser until an explicit cloud save, Media save, or post handoff; the Video Editor docs and tool pages state the same boundary.

### Shared provider kernel — required before new provider delivery

### PROV-SELECT-001 — Normalize asynchronous destination discovery

- [ ] **Problem — Confirmed architecture gap:** OAuth callback discovery is eager, stores a whole selection list in one expiring JSON blob, and hard-codes multi-select to LinkedIn. It cannot safely serve large GBP agencies or thousands of Pinterest boards.
- **Fix:** add normalized selection-session/options tables with state, progress, cursor, totals, errors, policy mode, selection/entitlement limit, expiry, consumed/version fields, safe display values, encrypted internal references, eligibility/reason, and provenance. Discover in background; finish with one CAS transaction that enforces entitlement, creates accounts, and consumes the session.
- **Done when:** large sets page/search/resume safely, direct/expired/canceled returns are clear, concurrent completion cannot create duplicate identities or seats, and DB uniqueness covers workspace/provider/installation/external identity.
- **Evidence:** `backend/internal/api/handlers/oauth.go:763`, `backend/internal/api/handlers/oauth.go:1168`, `frontend/src/routes/accounts/callback/+page.svelte:41`.

### PROV-TARGET-001 — Give every provider subdestination its own rendition

- [ ] **Problem — Confirmed model gap:** one rendition per publication/account cannot represent independent Pinterest board/section or Reddit community results.
- **Fix:** add normalized `target_key`; use a uniqueness boundary of publication + social account + target. GBP stays one location per account; Pinterest uses board/section; Reddit uses community.
- **Done when:** each target has its own authorization, external ID, delivery state, retry/manual-resolution, and partial-failure outcome; no hidden loop publishes to several boards/communities inside one rendition.
- **Evidence:** `backend/internal/database/migrations/027_format_first_publications.sql:16`.

### PROV-DELIVERY-001 — Model provider delivery and reconciliation

- [ ] **Problem — Confirmed lifecycle gap:** provider processing, native scheduling, rejection, and outcome-unknown states are flattened into `published`/`failed`.
- **Fix:** add `provider_deliveries` with external ID/URL, provider state, terminal reason, current attempt, last/next reconciliation, plus an optional status/reconciliation capability.
- **Done when:** queued, submitted, processing, provider-scheduled, live, rejected, ambiguous, and manual-resolution are distinct; PUB-003 and COMPOSE-002 render the exact target outcome; reconciliation cannot mutate another attempt.

### PROV-CAP-001 — Expand capability and cross-field validation contracts

- [ ] **Problem — Confirmed model gap:** capabilities cover many maxima but not separate title/body/description/alt limits, hard vs recommended rules, media minimums, dimensions/codecs/frame rate/audio, local date/time intervals, timezone/language, dependencies, exclusions, or target-specific validation.
- **Fix:** expand the schema and add a provider validator registry; key caches by every account/target input that affects behavior.
- **Done when:** backend, browser, REST, MCP, and CLI reject the same invalid payload; community/location/account rules cannot leak from a stale cache; unsupported schema combinations fail closed.
- **Evidence:** `backend/internal/capabilities/capabilities.go:76`, `backend/internal/api/handlers/capability_resolver.go:280`.

### PROV-PICKER-001 — Build one paged remote-option picker

- [ ] **Problem — Confirmed UX gap:** the backend can return option cursors, but the composer requests a fixed 100 options and ignores cursor/context.
- **Fix:** add append/deduplication, search, dependency context/invalidation, disabled reasons, progress/error/resume, keyboard navigation, touch-safe phone/320 px layouts, and stale-request protection.
- **Done when:** large boards, locations, communities, and existing provider options are all reachable without eager loading; a parent-field change clears incompatible child choices.
- **Evidence:** `frontend/src/lib/components/compose-text-post.svelte:1313`.

### PROV-POLICY-001 — Enforce provider execution mode at enqueue and execution

- [ ] **Problem — Policy gate:** hiding UI/API controls cannot enforce restrictions that may change between authorization and delivery.
- **Fix:** persist and enforce `disabled`, `interactive_only`, `authorized_delayed`, `owner_project_full`, or `written_provider_approval` on the grant/authorization. Check once when enqueueing and again before the external write.
- **Done when:** a policy change after scheduling blocks delivery safely, records an actionable audit event, and applies equally to browser, REST, MCP, CLI, repost, and worker origins.

### PROV-RETENTION-001 — Enforce provider-aware provenance, expiry, and deletion

- [ ] **Problem — Confirmed policy/data gap:** provider-returned data lacks a universal provenance/expiry contract, and long-lived analytics/communications storage can conflict with short retention or deletion rules. Deleted engagement scrubbing can retain author/attachment details after body removal.
- **Fix:** attach `fetched_at`, `expires_at`, provider/source, allowed use, and purge policy; keep restricted data out of immutable/aggregated stores; scrub body, author, and attachment fields on provider deletion.
- **Done when:** expiry, revoke, disconnect, and provider-deletion cascade tests prove timely removal and no forbidden aggregation; legal/public retention copy can cite implementation evidence.
- **Evidence:** `backend/internal/services/communications/service.go:349`.

### PROV-LEASE-001 — Issue stable, scoped provider media leases

- [ ] **Problem — Confirmed delivery gap:** current public media URLs expire after 15 minutes and readiness often relies on HEAD, which is not a dependable contract for delayed provider fetch/processing.
- **Fix:** create provider/object/operation-scoped leases long enough for the certified processing window, revocable at terminal state or retention expiry; verify delayed GET, redirects, MIME, length, dimensions, and range support.
- **Done when:** delayed-fetch live tests pass for every claimed provider/media workflow and a connector/provider cannot access unrelated library media.
- **Evidence:** `backend/internal/services/publicurl/media.go:16`.

### PROV-META-001 — Generate one provider metadata and certification catalogue

- [ ] **Problem — Confirmed drift gap:** provider names, icons, availability, readiness, docs, and public claim lists are repeated across surfaces.
- **Fix:** generate a canonical catalogue containing stable identity, supported/approved formats, approval tier, execution policy, certification age, and actionable degraded state; keep healthy state quiet.
- **Done when:** app, docs, marketing, readiness, CLI/MCP, and release checks cannot disagree and no custom provider ID is inferred by splitting its string.

### PROV-SCHEDULE-001 — Make native-provider scheduling a real execution path

- [ ] **Problem — Confirmed product gap:** native scheduling exists as catalogue metadata but not as a complete creation/edit/reschedule/cancel/reconciliation lifecycle.
- **Fix:** define immediate creation of a provider-native scheduled resource, durable external identity, ambiguity rules, policy enforcement, edit/reschedule/cancel, and status reconciliation.
- **Done when:** “native scheduled” describes provider state rather than a label; user and audit history distinguish it from a future OpenPost worker job.

## P2 — ordered provider, connector, and n8n delivery program

These are three distinct products sharing foundations:

- **First-party providers:** Pinterest, Google Business Profile, and conditional Reddit adapters delivered by OpenPost.
- **Operator connectors:** provider-like services installed by a self-hosting operator and reached through Connector Protocol v1.
- **n8n nodes:** a generated `n8n-nodes-openpost` package that users install **inside n8n**; it calls OpenPost’s curated REST API. It is not a provider adapter, MCP client, or in-app marketplace.

Implementation order:

1. Run external access/license/tool feasibility gates in parallel.
2. Complete the P0 and shared-provider P1 kernel above.
3. Open the provider registry/connector protocol and OpenAPI automation contract as independent lanes.
4. Ship the operator API reference connector and n8n action-node alpha.
5. Add Pinterest, then restricted GBP, then Reddit only after transport approval.
6. Add n8n upload/triggers, isolated Playwright connector, later provider depth, and existing-provider hardening only after the core paths are proven.

### Phase 0 — access, policy, license, and feasibility gates

### PROV-GATE-001 — Resolve Pinterest, GBP, and Reddit access before public work

- [ ] Pinterest: obtain Standard access plus written confirmation of permitted operational storage for board, section, Pin, upload, and reconciliation identifiers.
- [ ] GBP: create a dedicated Organization-owned project separate from YouTube; secure API approval/quota and OAuth verification; request only `business.manage`; obtain written answers for hosted native scheduling, delayed automation/reconciliation, token refresh, API/MCP/CLI use, and self-hosted project tenancy.
- [ ] Reddit: register before the stated deadline; obtain written decisions on commercial/delayed user-attributed publishing, Data API vs Devvit, media, community rules/flair, engagement, retention, and API/MCP/CLI/repost origins.
- **Done when:** each decision has owner, evidence, date, expiry/review date, and enforceable PROV-POLICY-001 mode. Do not advertise any provider during this phase; recheck all current vendor policies at implementation time.

### N8N-001 — Approve the n8n package license and distribution boundary

- [ ] **Gate:** verified n8n community packages currently require MIT while OpenPost is AGPL-3.0.
- **Fix:** confirm contributor rights and approve package-level MIT licensing if acceptable; reserve `n8n-nodes-openpost`; record package owner/publication authority; recheck current n8n verification rules. A separate repository does not automatically solve licensing.
- **Done when:** license notice, contributor-rights decision, registry ownership, and trusted-publishing authority are documented before code generation.
- **Evidence:** `LICENSE:1`.

### N8N-002 — Prove n8n tooling in the Bun monorepo

- [ ] Spike `n8n-node dev`, lint, build, `npm pack --dry-run`, and loading the packed node in the current supported n8n release from `packages/n8n-nodes-openpost/`.
- **Fix:** keep Bun as monorepo owner; introduce only a narrow package-manager exception if the spike proves current n8n tooling requires it; use a separate repository only as the last fallback.
- **Done when:** a minimal packaged node loads and executes, Node/minimum n8n versions are recorded, package inputs/outputs are declared, and no speculative package-manager migration occurs.
- **Evidence:** `package.json:56`.

### CONNECT-001 — Specify Connector Protocol v1 and its threat boundary

- [ ] Write an ADR accepting operator-installed protocol services and rejecting Go `.so`, in-process Playwright, volume-mounted executable code, and arbitrary hosted-tenant endpoints.
- [ ] Define versioned OpenAPI 3.1/JSON Schema wire DTOs, compatibility policy, conformance fixtures, `GET /v1/manifest`, health, connection start/advance/status, capability resolution, option search, `POST /v1/publishes`, and operation polling.
- [ ] Manifest: protocol/implementation versions, connector/capability revision, profiles/formats/media/settings, connection modes, optional operations, idempotency, and async guarantees. Namespace pass-through settings and allowlist host-owned pipeline keys.
- [ ] Use `application/problem+json` with machine-readable `kind`, `provider_code`, `retry_after`, `action`, and `outcome`; never expose internal Go structs as the ABI.
- **Done when:** valid/adversarial fixtures validate deterministically, version/operation/schema conflicts fail closed, and the threat model covers SSRF, credential crossover, malicious manifests, duplicate writes, and removal.

### Phase 2A — operator-installed connector platform

### PROVIDER-001 — Centralize provider identity and optional capabilities

- [ ] Split mandatory `platform.Adapter` responsibilities into small optional capabilities so API/webhook connectors do not fake OAuth/profile/media methods.
- [ ] Create one immutable `ProviderRegistry` snapshot containing opaque stable provider ID, built-in family/installation identity, sanitized display metadata, availability/health, connection modes, optional operations, publishing capabilities/revision, and internal capability implementations.
- [ ] Route discovery, connection, publishing, token management, readiness, capability resolution, analytics, communications, and reposts through the registry; preserve built-ins with compatibility wrappers.
- **Done when:** copied startup maps and hard-coded catalogue disagreement are gone, built-in identities/behavior are unchanged, optional invalid connectors are quarantined, and only explicitly required connectors affect readiness.
- **Evidence:** `backend/internal/platform/registry.go:92`, `backend/cmd/openpost/main.go:324`, `backend/internal/api/handlers/oauth.go:242`.

### CONNECT-002 — Add installation-aware persistence and zero-loss backfills

- [ ] Add `provider_installations`, `provider_account_bindings`, `provider_operations`, and durable connection sessions; add installation ID/manifest revision to accounts and renditions.
- [ ] Replace workspace + platform + account plus Mastodon special casing with generic installation-aware identity and DB uniqueness.
- [ ] Backfill current accounts into built-in installations without changing visible IDs; cache only sanitized descriptors and retain archived revisions/snapshots for history.
- **Done when:** fresh/upgraded SQLite and Postgres agree, multiple installations cannot collide, interrupted migration/reinstall is safe, and connector removal preserves accounts, drafts, schedules, renditions, and history while blocking only new work.
- **Evidence:** `backend/internal/services/account_saver/account_saver.go:236`.

### CONNECT-003 — Implement operator configuration, safe transport, validation, and health

- [ ] Support a read-only `OPENPOST_CONNECTORS_FILE` containing IDs, transport policy, workspace allowlists, required/optional state, and token/mTLS secret-file references—never code or inline secrets.
- [ ] Support `public_https`, exact operator-owned `private_allowlist` hosts/CIDRs/ports, and one configured Unix socket; workspace input never controls base URL.
- [ ] Disable credential-request redirects, bypass proxies, pin/validate DNS, cap bodies, enforce deadlines, redact secrets/bodies, authenticate by secret file or mTLS, validate/sanitize/cache manifests, and implement the remote client.
- **Done when:** SSRF/rebinding/redirect/proxy/oversize/timeout/secret-log/workspace-crossover tests pass; optional failures quarantine locally; required readiness is explicit.

### CONNECT-004 — Build one host-controlled connection state machine

- [ ] Support `redirect | form | selection | pending | complete | failed`; the browser calls only OpenPost and renders a closed set of text/password/URL/textarea/select/radio/checkbox controls. Unknown controls fail closed.
- [ ] Replace built-in Accounts switches/special flows only after parity: Bluesky/Discord forms, Mastodon callback, LinkedIn-only selection.
- [ ] Support `openpost_managed` encrypted versioned credentials and `connector_managed` opaque `connection_ref`; use connector-managed for Playwright.
- **Done when:** built-ins and a fixture connector share the flow, sessions resume/expire/cancel safely by workspace, credentials never cross boundaries, and desktop/390 px/320 px browser tests pass.
- **Dependencies:** CONNECT-003, PROV-SELECT-001, ARCH-002.

### CONNECT-005 — Implement connector publishing, polling, and scoped media

- [ ] Derive deterministic `operation_id` from rendition/segment/phase; send connection reference, intent/profiles, manifest revision, content/title/description/reply target, validated settings, and ordered media descriptors.
- [ ] Accept `published`, `pending`, structured failure, or persisted `unknown`; require connector-side journaling before an external write; reuse operation IDs across restart/retry.
- [ ] Serve operation-scoped media URLs with MIME, size, filename, alt text, digest, and relevant thumbnail/caption descriptors. Never send base64 or broad media-library access.
- **Done when:** timeout-after-write cannot duplicate, pending/partial threads survive OpenPost/connector restart, large-media cancellation/authorization passes, and OpenPost remains canonical publication/media owner.
- **Dependencies:** PROV-WRITE-001, PROV-DELIVERY-001, PROV-LEASE-001, PUB-001, ARCH-004, CONNECT-002–004.

### CONNECT-006 — Make frontend identity and capabilities connector-safe

- [ ] Expose sanitized authenticated workspace-scoped descriptors, never custom/internal providers in public cached capabilities; add shared presentation resolver/`ProviderBadge`; treat IDs as opaque.
- [ ] Permit built-in icon, sanitized cached raster, or visible monogram only—never connector Svelte/JS/HTML/raw SVG. Add generic/unavailable previews and account-scoped validation.
- [ ] Carry capability revision through publication payloads, revalidate at execution after connector upgrades, and require action when scheduled settings become incompatible.
- **Done when:** custom/removed providers remain identifiable across Accounts, Calendar, Activity, Publications, Analytics, Engagement, and Messages; upgrades cannot silently reinterpret work; responsive/a11y tests pass.
- **Evidence:** `frontend/src/lib/utils.ts:13`, `frontend/src/lib/components/compose/modes.ts:274`.

### CONNECT-007 — Ship one complete API reference connector

- [ ] Build a minimal operator-managed API-key connector supporting connection, text, threads, media, deterministic writes, pending polling, typed errors, generic UI, degraded state, SDK helpers, and a conformance command. Document Compose/Nix/security examples.
- **Done when:** it can be discovered, connected, capability-resolved, drafted, scheduled, restarted, and published with media/threads; outage after external write does not duplicate; removal preserves history.
- **Dependencies:** CONNECT-001–006 and all P0/shared-kernel gates.

### CONNECT-008 — Add Playwright only as an isolated reference connector

- [ ] Use a pinned browser image, non-root sandboxed user, connector-only session volume, destination-specific egress, resource/trace limits, per-account serialization, pre-click durable dedupe, and structured reconnect/MFA/CAPTCHA/session-expired results.
- [ ] Never mount OpenPost `/data`, database, environment, or encryption keys; never add Node/browser to the OpenPost image.
- **Done when:** credential isolation, sandbox, timeout-after-click, crash/restart, partial-thread, retention, and duplicate-prevention tests pass.
- **Dependencies:** successful CONNECT-007 API path and ambiguity/isolation proof.

### CONNECT-009 — Defer optional connector extensions

- [ ] Add analytics, comments, inbox, deletion, reposting, hot reload, executable transport, gRPC, WASI, or a read-only JS/TS runner only as separately advertised/versioned extensions after Protocol v1 stabilizes.
- **Done when:** demand, security model, compatibility, lifecycle, and conformance coverage exist for each extension. Do not broaden this into a hosted endpoint marketplace.

### Phase 2B — generated nodes installed and used inside n8n

Maintenance contract for this lane: a new social provider requires no n8n package change; a normal optional API field requires regeneration/review; a newly exposed operation requires one automation annotation plus a small presentation entry; a breaking selected contract fails CI and requires a compatibility/typeVersion decision; MCP presentation changes have no n8n impact.

### N8N-003 — Correct the shared OpenAPI foundation

- [ ] Extract one shared Huma API configuration; add the accurate relative `/api/v1` server, bearer security scheme, and explicit public-route overrides; make frontend types, docs, and the n8n generator consume the same document.
- **Done when:** generated clients identify base/auth/public routes correctly and contract tests prevent divergent configurations.
- **Evidence:** `backend/internal/api/routes.go:91`, `backend/cmd/openpost-openapi/main.go:14`, `scripts/check-contracts.mjs:14`.

### N8N-004 — Define a curated, fail-closed automation contract

- [ ] Add vendor-neutral `x-openpost-automation` metadata for explicit exposure, stability, `query | local-mutation | external-action | destructive` effect, retry/idempotency, pagination/result extraction, and selector/capability hints.
- [ ] Select only the publication-centred v0.1 surface. Exclude OAuth connection, admin, billing, account security, editor internals, destructive deletion, legacy `/posts`, and every unannotated/unsupported operation.
- **Done when:** Go tests cover every metadata dimension and the generator cannot accidentally expose the full API.

### N8N-005 — Add generic REST idempotency before write nodes

- [ ] Support `Idempotency-Key` on selected local mutations, scoped by principal + workspace + operation + key; persist normalized request hash and original result transactionally; replay identical requests and return `409` for same key/different payload.
- [ ] Accept upstream event IDs as preferred keys, include OpenPost `X-Request-ID` in n8n errors, and never automatically retry ambiguous external-provider writes.
- **Done when:** replay, conflict, concurrency, workspace isolation, and rollback tests pass; publication creation cannot duplicate after a client timeout.
- **Evidence:** `backend/internal/api/handlers/publications.go:129`.

### N8N-006 — Finish safe API-token setup before publishing n8n docs

- [ ] Complete APIKEY-001/002 and the workspace-binding/generic-scope parts of APIKEY-003. Initially document a workspace-bound `cli:full` token; later prefer generic `api:read`/`api:write`, never an n8n-only scope.
- **Done when:** credential creation, expiry, workspace binding, revocation, and effective permissions agree across UI, runtime, OpenAPI, and n8n setup docs.

### N8N-007 — Build a deterministic selected-contract generator

- [ ] Resolve `$ref`, OpenAPI 3.1 nullable unions, scalar/date/number/boolean/enum/simple-array controls, and omit read-only fields such as generated `$schema`; use validated Advanced JSON for complex provider objects first; fail closed on unsupported constructs.
- [ ] Generate declarative routing, fields, documentation tables, and selected-contract snapshots into committed clearly marked files; run from `check:contracts` with semantic checks for removal, new required fields, type changes, and enum narrowing.
- **Done when:** output is deterministic, stale output fails CI, breaking selected-contract changes require a compatibility/typeVersion decision, and no HTTP method/path/schema is duplicated in the presentation manifest.

### N8N-008 — Scaffold `packages/n8n-nodes-openpost/`

- [ ] Add `OpenPostApi` credentials (base URL + secret API token), declarative OpenPost node/generated/resources/methods/errors/upload/test structure, and only `n8n-workflow` as the production peer dependency.
- [ ] Use n8n’s authenticated request helper; never manually retrieve/interpolate tokens. Use searchable `resourceLocator` selectors with manual-ID fallback; load providers/profiles/destinations/capabilities from OpenPost at runtime.
- [ ] Make the credential usable by n8n’s generic HTTP Request node; do not add a duplicate raw-request operation. n8n calls REST, never Connector Protocol or MCP.
- **Done when:** URL normalization, authenticated test, token redaction, selector fallback, and long-tail generic HTTP Request access pass.

### N8N-009 — Deliver the publication-focused action node

- [ ] Generate: Workspace Get Many; Account Get Many/Get Destination Options/Provider Readiness; Social Set Get/Get Many; Posting Schedule Get Next Slot; Media Get Many; Publication Create/Get/Get Many/Update/Validate/Schedule/Publish Now/Retry Failed/Get Events.
- [ ] Keep Create, Schedule, and Publish Now separate; preserve `expected_revision`; never refetch and overwrite a newer revision. Use native controls for common fields and Advanced JSON for renditions/segments/metadata/provider settings initially.
- [ ] Support pagination, list search, multiple input items, error mapping, item linking, and continue-on-fail.
- **Done when:** a disposable OpenPost+n8n workflow completes list → create draft → validate → schedule without live provider posting; adding a social provider requires no n8n release.

### N8N-010 — Package and publish a verified `0.1.x` alpha

- [ ] Test hosted/self-hosted OpenPost; run `n8n-node` lint/build, package scan, `npm pack --dry-run`, tarball allowlist, and packed-node smoke against declared-minimum/current n8n versions; add pinned PR matrix and weekly floating-latest canary.
- **Done when:** the tarball installs with only declared files, supported versions pass, provenance can be attached later, and all public copy still labels availability alpha.

### N8N-011 — Add isolated streamed binary upload

- [ ] Keep upload as the one initial imperative exception; use a small companion `OpenPost Upload` node if needed. Stream through n8n binary APIs and OpenPost upload sessions; add no S3 SDK; never forward the OpenPost bearer token to a presigned storage URL.
- **Done when:** buffer/streaming/large-file/cancel paths stay bounded and tests prove no credential reaches storage hosts.

### N8N-012 — Expand action operations only from verified demand

- [ ] Consider richer rendition controls, comments, moderation, analytics, and jobs only after usage evidence. Promote advanced operations to stable only with explicit automation metadata, a small presentation entry, compatibility coverage, and production-like tests.
- **Done when:** no hand-maintained endpoint client or speculative full-API node grows beside the generator.

### N8N-013 — Build a general automation-event API before triggers

- [ ] Add workspace-scoped monotonic cursors, durable event IDs, signed webhook subscriptions, retry jobs, delivery history, secret rotation, observability, and complete subscription lifecycle. Do not ship timestamp polling.
- **Done when:** delivery is ordered, replayable, workspace-isolated, signature-verified, recoverable, and safely purgeable.

### N8N-014 — Implement the programmatic OpenPost Trigger node

- [ ] Implement subscription create/check/delete, activation health, secret rotation, failed-delivery recovery, disable/reinstall, and event deduplication.
- **Done when:** workflow activation/deactivation/reinstall cannot leak subscriptions or duplicate events and credentials rotate without data loss.

### N8N-015 — Complete a verified stable n8n-node release

- [ ] Keep npm SemVer independent of OpenPost app SemVer; use namespaced tags such as `n8n-nodes-openpost-v1.0.0`; change n8n `typeVersion` only for saved-workflow behavior; use GitHub trusted publishing/npm provenance; submit through Creator Portal.
- [ ] Update README, docs, roadmap, surface-parity table, marketing, and `CHANGELOG.md` only after install/current-version/Creator Portal availability is verified.
- **Done when:** provenance is verifiable, supported installs pass, portal status is recorded, and public claims match actual package availability.

### Phase 3 — Pinterest first-party integration

### PIN-001 — Connect Pinterest and discover boards/sections at scale

- [ ] Use the shared grant with minimum approved scopes, both token expiries, atomic rotation, full board cursor pagination (including very large accounts), lazy section loading, search, and one board/optional section per targeted rendition.
- [ ] Cache only provider-permitted operational data with provenance/expiry and revoke/disconnect cleanup.
- **Done when:** Trial and Standard selection is certified, large-board accounts do not eager-load, and a board/section cannot be confused with another target.

### PIN-002 — Ship the conservative complete Pin publishing scope

- [ ] Support single image, 2–5 images, video, board/optional section, title, description, destination link, alt text, available AI-content disclosure, neutral vertical preview, and explicit per-Pin authorization.
- [ ] Accept documented successful `200` and `201`; take title/description/alt/link/media rules from the approved organic contract and live tests, never advertising-only limits or an assumed 2 GiB video limit.
- **Done when:** server/client/API/MCP/CLI validation agrees and Trial/Standard live evidence covers every advertised format without imitating Pinterest UI.

### PIN-003 — Build a durable Pinterest video pipeline

- [ ] Implement validate/prepare → register upload → upload → poll media → create Pin → reconcile. Generate a real JPEG cover and expose it through a stable provider lease; certify base64/key-frame alternatives before relaxing it.
- [ ] Retry only contract-safe registration/upload/poll failures; final Pin create is non-idempotent, so timeout becomes ambiguous/manual reconciliation rather than automatic recreation.
- **Done when:** crash/timeout/restart tests and Trial + Standard live evidence prove no duplicate final Pin and correct cover/media cleanup.

### PIN-004 — Add Pinterest depth only after certification

- [ ] Separately add edit/delete, provider status refresh, revocation/deletion cleanup, and analytics subject to written storage permission. Treat board creation as a separate deliberate operation.
- **Done when:** each operation has lifecycle, retention, authorization, ambiguity, and live-test evidence.

### Phase 4 — Google Business Profile, policy-restricted

### GBP-001 — Separate hosted-interactive and owner-project execution modes

- [ ] Hosted default is `interactive_only`: connect/discover and browser-initiated publish-now. Create a Google-native scheduled post while the user is present only after written approval; no delayed OpenPost worker, MCP/CLI, repost, blind refresh/retry, or automatic reconciliation without approval.
- [ ] An independently approved operator-owned project may use `owner_project_full`; do not launch hosted BYO project tenancy without policy clarification.
- **Done when:** PROV-POLICY-001 enforces the approved mode server-side and UX/docs accurately state what each deployment can do.

### GBP-002 — Discover and select eligible locations asynchronously

- [ ] Page Google accounts/locations, deduplicate a bare location reached through several parents, check local-post eligibility, closure/duplicate state, access, and voice-of-merchant; show only safe title/address/store code/parent label plus disabled reason.
- **Done when:** progress/cancel/resume/search/paging/net-new entitlement counting work at desktop/phone/320 px and concurrent completion cannot duplicate a location.

### GBP-003 — Implement a conservative post/validation surface

- [ ] Support Standard, Event, and Offer; one image first; language; Book/Order/Shop/Learn More/Sign Up/Call CTAs; local/all-day intervals; offer coupon/redemption URL/terms.
- [ ] Enforce complete Event/Offer intervals, Call without URL, Offer-specific semantics, prohibited body phone numbers, and fail-closed lodging restrictions when classification is known. Treat 1,500 characters as guidance until live certification; do not invent a 4,096-byte rule.
- **Done when:** the provider validator registry and every client surface agree on all cross-field rules.

### GBP-004 — Preserve Google delivery, ambiguity, and native schedule state

- [ ] Distinguish queued, submitted, provider-scheduled, processing/review, live, rejected, and outcome unknown. A complete `429` is definite quota; timeout/EOF/crash/malformed success/missing resource name is ambiguous.
- [ ] Never auto-bind a guessed list match, recreate, or show generic Retry for ambiguity; offer bounded possible matches for manual resolution. Add schedule/edit/reschedule/cancel only after approval.
- **Done when:** harmless owned-location live tests prove image delayed fetch, status transitions, schedule lifecycle, cleanup, and manual ambiguity resolution.

### GBP-005 — Add retention-aware GBP depth separately

- [ ] Purge Google-returned data within the applicable policy window and keep previews neutral. Later, separately approve/certify one-attempt review reply/delete, local-post insights, nonaggregating retention-aware Performance analytics, and a real `mediaFormat=VIDEO` experiment.
- **Done when:** each later capability has approval, retention/lifecycle implementation, and live evidence. Do not add a GBP Q&A roadmap; that API surface is discontinued.

### Phase 5 — Reddit, conditional on transport approval

### REDDIT-001 — Approve and isolate the Reddit transport

- [ ] Add a `RedditTransport` boundary only after the decision: approved OAuth/Data API or approved Devvit bridge. Record delayed attribution, auth identity, retention, and permitted execution origins.
- [ ] Never use browser cookies, `reddit_session`, password, or scripted-session authentication.
- **Done when:** policy/transport behavior is server-enforced and test credentials use only an explicitly approved path.

### REDDIT-002 — Ship the first approved text/link scope

- [ ] One community per rendition; text/self and link posts; required title; community/flair; NSFW, spoiler, reply notification; live rules/flair resolution and immediate pre-publish validation.
- [ ] Treat HTTP 200 responses containing `json.errors` as definite failure; timeout after submit is ambiguous/reconcile-only; use approved OAuth/User-Agent/quota behavior and promptly scrub deleted provider content.
- **Done when:** an approved test-community live suite proves validation, attribution, ambiguity handling, external identity, and cleanup.

### REDDIT-003 — Add Reddit media and depth only after transport certification

- [ ] Then add one image/video/video-GIF with durable upload/processing, edit/delete, comments/replies, explicitly approved inbox, and Reddit-native analytics semantics. Never relabel score as likes.
- [ ] Keep galleries, polls, crossposts, bulk multi-community publishing, and autonomous reposts out until separately approved and certified.
- **Done when:** every enabled operation has transport-specific policy, consent, retention, lifecycle, and live proof.

### Phase 6 — harden existing providers and release proof

### PROV-HARDEN-001 — Apply the shared kernel to all current providers

- [ ] X: tier/format certification and ambiguity; Mastodon: representative versions/dynamic per-instance limits; Bluesky: media/replies/app-password failure; LinkedIn: shared grants, no multi-account special case, organization/media certification.
- [ ] Threads: stable media/processing/reply deletion/inbox; Facebook: review/video/multi-photo semantics; Instagram: container/rejection/public-media/Pages discovery; TikTok: Direct vs Inbox/approval/disclosure/reconciliation.
- [ ] YouTube: durable thumbnail/playlist/caption child operations, processing/copyright/rejection, shared channel grants; Discord: readiness inclusion, webhook-secret rotation, probing, explicit send-only limits.
- **Done when:** every public provider/format claim maps to current PROV-READY-001 evidence and the same delivery/policy/retention model.

### PROV-QA-001 — Make provider certification a release gate

- [ ] Automated: exact endpoints/scopes/payloads/parsing, all validation, safe errors, pagination/quota, SQLite/Postgres migration, refresh/selection concurrency, every crash boundary, no replay of ambiguity, retention/revoke cascades.
- [ ] Browser: OAuth progress/resume/expiry, paged pickers/dependencies, all lifecycle states, target errors, desktop/phone/320 px, keyboard/touch/overflow/console.
- [ ] Opt-in live: Pinterest Trial/Standard, verified owned GBP, approved Reddit test community, and maintained claimed-format matrix for existing providers.
- [ ] Release: approval/policy/live proof/revocation/retention/ambiguity, per-provider kill switches, quota/error monitoring, and agreement across app/contracts/API/MCP/CLI/docs/marketing/privacy/config/i18n/`CHANGELOG.md`.
- **Done when:** advertising a provider or format is mechanically blocked until required evidence is current.

## P2 — application UX and product completeness

### Security, login, account, and public profile

### SEC-002 — Make TOTP setup instructions and fallback setup key complete

- [x] **Problem — Current source audit:** TOTP enrollment has QR and verification fundamentals, but the flow needs clearer ordered instructions, app-switch guidance, a reliably copyable manual key, recovery expectations, and a stronger final success state. Passkeys are a second strong factor, but are not a substitute for explaining TOTP setup and recovery.
- **Fix:** use an explicit setup sequence: choose factor, re-authenticate, scan QR or copy setup key, enter code, save recovery codes, confirm enabled. State what disabling/resetting does and require recent re-authentication.
- **Done when:** a user can complete setup without prior authenticator knowledge, QR is comfortably scannable, manual copy has accessible feedback, failure preserves safe progress, and final status names the enabled factor.
- **Evidence:** security/MFA section in `frontend/src/routes/settings/+page.svelte`.

### AUTH-001 — Preserve protected deep links through login

- [x] **Problem — Current source:** the root layout sends an unauthenticated protected URL to bare `/login`; login only resumes a destination when a `redirect` query was already supplied.
- **Fix:** attach the exact same-origin path and query to the login redirect, validate it again after authentication, and keep external or malformed targets rejected.
- **Done when:** `/calendar?view=week` → login → `/calendar?view=week`; manually supplied external destinations still fall back safely; direct-navigation E2E covers both.
- **Evidence:** `frontend/src/routes/+layout.svelte:158`, `frontend/src/routes/login/+page.svelte:50`, `e2e-app/auth-onboarding.spec.ts:160`.

### AUTH-002 — Add password visibility and useful password rules

- [x] **Problem — Current source audit:** login and registration have no show/hide control; registration does not expose password rules or a useful strength/readiness cue before submission.
- **Fix:** add an accessible pressed-state visibility button to password fields; show the actual server rules before entry and update rule satisfaction without pretending a simplistic meter guarantees security.
- **Done when:** reveal state is keyboard/screen-reader accessible, does not move focus or clear autofill, validation matches the backend, and login preserves the entered email after failure.
- **Evidence:** `frontend/src/routes/login/+page.svelte`, `frontend/src/routes/register/+page.svelte`.

### AUTH-003 — Decide session persistence explicitly

- [x] **Problem — Conditional:** there is no “Remember me” control, but the current seven-day session is already persistent. Adding a checkbox without multiple session policies would be misleading.
- **Fix:** either document the fixed session duration and keep login focused, or implement genuinely distinct session-cookie lifetimes and explain the shared-device trade-off.
- **Done when:** UI copy, cookie behavior, security docs, and tests agree; no cosmetic checkbox is added without server behavior.
- **Evidence:** `backend/internal/services/auth/auth.go:12`, authentication cookie handlers in `backend/internal/api/handlers/auth.go`.

### ACCT-001 — Add a verified email-change flow

- [ ] **Problem — Current source audit:** account details expose the existing email but do not offer a safe change flow.
- **Fix:** require recent re-authentication; verify the new address before replacing the old one; notify the old address; handle conflicts and expiration without account enumeration; revoke or review sessions on completion.
- **Done when:** the old email remains active until verification, both addresses receive appropriate notices, duplicate/expired token paths are safe, and legal/billing contacts are not silently changed.
- **Evidence:** profile/account section in `frontend/src/routes/settings/+page.svelte` and auth identity handlers.

### ACCT-002 — Clarify editable profile identity and visibility

- [x] **Problem — Current source audit:** avatar/display name support exists, but the boundary between private account data, public display data, and workspace role/title is not consistently explained. Public visibility is coarse and some profile availability/error behavior is tied to managed-cloud assumptions.
- **Fix:** label public-facing fields at edit time; provide initials/avatar fallback; show a privacy preview; let users choose supported visible fields; make public-profile capability come from instance configuration rather than a hard-coded cloud check.
- **Done when:** public pages expose only opted-in fields; disabled, private-or-missing, loading, and transient-error states are distinct; initials fallback and responsive profile layout are tested.
- **Evidence:** profile section in `frontend/src/routes/settings/+page.svelte`, `frontend/src/routes/u/[username]/+page.svelte`, `backend/cmd/openpost/web.go` public-profile handling.

### ACCT-003 — Treat connected sign-in identities as an account-security surface

- [ ] **Problem — Partial/conditional:** OIDC/social sign-in exists, but users need a clear view of linked login identities and safe disconnect rules if multiple identities are supported. Provider publishing accounts must not be confused with sign-in identities.
- **Fix:** show identity provider, linked address/name, added date, and disconnect action; block removal of the final usable credential; require re-authentication; document provider-initiated logout support or deprecation separately.
- **Done when:** users can distinguish login identities from social publishing connections, cannot lock themselves out, and disconnect/relink/logout tests cover each configured provider.
- **Evidence:** auth/OIDC handlers and account-security settings.

### PUBLIC-001 — Make public-profile errors public-safe and diagnosable

- [x] **Problem — Current source audit:** every load failure can collapse into “private or does not exist,” while not-found, disabled, and backend failure need distinct public states. Enabling the profile publishes activity, top workspaces/platforms, joined date, and plan under coarse visibility, and some links/availability assume the managed cloud.
- **Fix:** define explicit public-profile capability and field-visibility contracts; render branded 404/disabled/error states without leaking private data; add a retry only for transient failures; use configured instance/public URLs; explain any plan/instance restriction before enablement.
- **Done when:** private and disabled profiles never leak, true failures never masquerade as an empty profile, direct requests return appropriate status, and public routes work without an authenticated shell.
- **Evidence:** `frontend/src/routes/u/[username]/+page.svelte`, public-profile handlers in `backend/cmd/openpost/web.go`.

### Notifications and notification preferences

### NOTIF-002 — Keep the persistent unread badge synchronized

- [x] **Problem — Current source:** the sidebar bell fetches on mount/workspace change, while the notifications page mutates only local state. The persistent shell badge stays stale after opening or marking notifications read until reload or workspace switch.
- **Fix:** use one workspace-scoped notification store/query cache; invalidate it after successful mutations; optionally add bounded polling or realtime events with reconnect behavior.
- **Done when:** bell, list, count, and workspace switch agree immediately after read/delete/bulk actions and after server-side arrivals; tests cover a mounted root layout across navigation.
- **Evidence:** `frontend/src/lib/components/notification-bell.svelte:15`, `frontend/src/routes/notifications/+page.svelte:62`.

### NOTIF-003 — Do not show a notification as read when the write failed

- [x] **Problem — Current source:** opening an unread notification ignores the POST error, then unconditionally sets local `read_at` and decrements the count.
- **Fix:** update local/shared state only after confirmed success, or use an optimistic update with rollback and an actionable toast; preserve navigation without lying about server state.
- **Done when:** a forced 500 leaves the notification unread and count unchanged or rolls them back visibly; retry succeeds once without double-decrement.
- **Evidence:** `frontend/src/routes/notifications/+page.svelte:87`.

### NOTIF-004 — Paginate the notification feed and make errors recoverable

- [x] **Problem — Current source:** the page requests 100 items and ignores `next_cursor`, so older alerts are unreachable. Initial load error has no retry.
- **Fix:** implement cursor pagination or “Load more” with stable chronological grouping; preserve filters/workspace; add a retryable error state distinct from an empty feed.
- **Done when:** a fixture with more than 100 notifications can reach every item without duplicates; zero, no-results, and error states are distinct; cursor failures can retry.
- **Evidence:** `frontend/src/routes/notifications/+page.svelte:49`, `backend/internal/services/notifications/service.go:274`.

### NOTIF-005 — Improve notification semantics and scanability

- [x] **Problem — Current source audit:** the feed has basic chronological/read state, but type, action, timestamp detail, date grouping, and assistive semantics are inconsistent or thin.
- **Fix:** group by Today/Yesterday/earlier; include text labels with type icons; use relative times for recent items and complete date/time for older items; expose unread state programmatically; make row actions explicit instead of turning every surface into an ambiguous link.
- **Done when:** color is never the only unread/type signal; screen readers announce type, unread state, time, and action; mark-all-read has a correct disabled state and live confirmation.
- **Evidence:** `frontend/src/routes/notifications/+page.svelte` and `frontend/src/lib/components/notification-bell.svelte`.

### NOTIF-006 — Add frequency controls and a global mute model

- [ ] **Problem — Current source audit:** notification settings have useful topic/channel controls, but no immediate/digest cadence where appropriate and no temporary global mute. Save feedback must remain explicit when preferences autosave.
- **Fix:** add only meaningful per-topic channel/frequency combinations; support account- or workspace-scoped mute with an end time and visible banner; preserve mandatory security/critical billing messages where policy requires; announce autosave success/failure.
- **Done when:** invalid channel/frequency combinations cannot be selected, mute expiry restores prior choices, mandatory alerts are explained, and persistence/race/failure tests pass.
- **Evidence:** notification-preference section in `frontend/src/routes/settings/+page.svelte` and notification preference service.

### Billing and checkout

### BILL-002 — Preserve the original task through hosted checkout

- [ ] **Problem — Current source:** onboarding carries `redirect` into `/checkout`, but the checkout request and provider success URL do not preserve it, so the success screen cannot continue to the original task.
- **Fix:** bind a validated same-origin return path to the checkout attempt on the server (or sign it), and restore it only for the matching completion. Never pass through an unchecked raw redirect.
- **Done when:** onboarding → Paddle → success resumes the original path/query; refresh and replay are safe; external redirect attempts are rejected.
- **Evidence:** `frontend/src/routes/onboarding/+page.svelte:36`, `frontend/src/routes/checkout/+page.svelte:181`, `backend/internal/api/handlers/billing.go:326`, `backend/internal/services/billing/service.go:386`.

### BILL-003 — Make the Paddle/native billing boundary explicit and useful

- [ ] **Problem — Current source audit:** native settings show plan, status, period end, limits, usage, and a generic portal button. Payment method, next charge amount/date, invoices/PDFs, charge/tax/VAT history, promo state, billing contact, and cancellation mechanics are provider-hosted or unverified.
- **Fix:** choose a boundary. Either surface essential read-only facts and deep links natively, or state clearly that Paddle manages payment methods, invoices, discounts, and cancellation. Include last four only, never full card data; expose business invoice identity/VAT where supported.
- **Done when:** users can identify the next charge and payment route, retrieve invoices/receipts, manage the correct billing email, understand cancellation, and reach the right portal page; live Paddle capability is verified separately.
- **Evidence:** `frontend/src/routes/settings/+page.svelte:2440`, `frontend/src/lib/api/types.d.ts:3856`.

### BILL-004 — Hide or explain the portal action when no subscription exists

- [x] **Problem — Current source audit:** the customer-portal button is shown even when the user has no subscription/customer context, which can produce a dead or confusing action.
- **Fix:** gate the action on a valid portal-capable customer/subscription, or label the destination accurately for customers who only have transaction history; provide plan selection as the primary no-subscription action.
- **Done when:** none/trial/active/past-due/canceled states each expose a valid next action and portal failures show recovery guidance.
- **Evidence:** `frontend/src/routes/settings/+page.svelte:2448`.

### BILL-005 — Reconcile checkout consent copy with the actual control

- [x] **Problem — In-flight release risk:** the inline frame can load automatically while copy still says “By continuing,” even when no continue action exists.
- **Fix:** either restore an explicit continuation action or rewrite the disclosure to name the actual payment/submit action; obtain legal review.
- **Done when:** the consent sentence points to a real user action, is shown before that action, and tests cover the final checkout state.
- **Evidence:** `frontend/messages/en.json:3514`, `frontend/src/routes/checkout/+page.svelte:561`.

### Onboarding, settings, administration, and destructive actions

### ONB-001 — Replace the automatic generic-workspace checkout jump with a durable onboarding state

- [ ] **Problem — Current source audit:** onboarding auto-creates “My workspace” and immediately redirects managed users to checkout. The only visible step marker appears later and disappears after account connection; there is no durable completion state or first-value handoff. A missing plan is normalized to Founder, so an unselected plan can look like the user’s choice.
- **Fix:** model 3–5 persisted steps: welcome/goal, minimal identity/workspace, explicit plan if required, connect first destination, create/schedule first publication. Allow safe skip/defer where payment policy permits and preserve progress across refresh/sign-in/provider return.
- **Done when:** users know step count and purpose, can rename the workspace before it becomes shared context, resume interrupted setup, and receive an explicit completion state leading to the fastest first post.
- **Evidence:** `frontend/src/routes/onboarding/+page.svelte:71`, `frontend/src/routes/accounts/+page.svelte:747`, `e2e-app/auth-onboarding.spec.ts:126`.

### ADMIN-001 — Complete the organization administration surface

- [ ] **Problem — Current source audit:** role-gated admin tabs and a strong searchable instance-user inventory already exist. The broader organization lifecycle is incomplete: usage export, a general consequential-action audit log, ownership transfer, and operator-approved organization/instance deletion are absent or fragmented; organization identity/logo/domains/SSO and seat/billing facts need one clear overview.
- **Fix:** complete the existing role-gated administration sections rather than replacing them; keep routine member work separate from organization-wide actions; add an append-only audit log for impersonation, role/member, provider/config, billing, and destructive mutations; use typed confirmation and recent re-authentication for irreversible actions.
- **Done when:** non-admins cannot fetch or render admin data/actions; usage can be exported; ownership transfer and deletion enforce invariants; every role/billing/deletion action has actor/time/result evidence.
- **Evidence:** settings/admin routes and organization handlers; no complete admin route exists in the audited baseline.

### ADMIN-002 — Make danger zones consistent and informative

- [ ] **Problem — Partial:** account deletion exists, but destructive actions across account, workspace, member, token, connection, publication, and version restore do not share consistent consequence copy, re-authentication, typed confirmation, or separation.
- **Fix:** use `DestructiveConfirmDialog` with action-specific impact, retention/recovery, ownership/dependency blockers, and typed confirmation only where proportional; keep reversible archive/deactivate distinct from permanent removal.
- **Done when:** each destructive action states what is lost, what remains, and whether undo exists; accidental primary-action styling is impossible; authorization and confirmation tests cover each scope.
- **Evidence:** settings danger-zone and destructive actions across detail pages.

### TEAM-002 — Deliver invitations to people who do not yet have an account

- [ ] **Problem — Current source audit:** existing registered recipients can receive in-app and opt-in email notice, but a new recipient can depend on the inviter manually copying the raw invitation link.
- **Fix:** send a branded, expiring invitation email for unregistered addresses through the configured email provider; keep copy-link as a fallback; add resend with rate limits, revoke, delivery status, and generic failure copy that does not enumerate accounts.
- **Done when:** new and existing recipients can complete acceptance, revoked/expired links fail safely, resends do not create duplicate active seats/invites, and admin UI shows actionable delivery state.
- **Evidence:** workspace invitation handlers/services and team settings UI.

### STATE-001 — Add app/public error boundaries and a real maintenance experience

- [ ] **Problem — Current source audit:** the frontend has no route `+error.svelte`/global error page or maintenance surface. Marketing has only a basic static 404, and dynamic public routes fall through generic errors. Scheduled maintenance and unexpected outage have no distinct message, ETA, external status link, or urgent support path.
- **Fix:** implement branded app and public error boundaries; create maintenance variants for scheduled and unplanned outages; host/link a status page outside the main failure domain; include retry, home/back, docs, and support actions appropriate to state.
- **Done when:** 404, 403, 500, offline/load failure, scheduled maintenance, and unplanned outage are visually and semantically distinct; correct HTTP status is preserved where possible; 320 px/light/dark/keyboard tests pass.
- **Evidence:** absence of `frontend/src/routes/+error.svelte`; `marketing-site/static/404.html:1`; dynamic public routes under `marketing-site/src/routes/*/[slug]`.

### STATE-002 — Standardize zero, no-results, load-error, and retry states

- [ ] **Problem — Cross-app checklist gap:** shared empty-state primitives exist and many pages use them well, but several bounded/search/list surfaces still turn load errors into empty-looking states or offer no reset/retry escape route.
- **Fix:** inventory every data surface; give first-use zero states a contextual action that creates the first item; give no-results states active filter/query summary plus clear/reset; give errors a distinct notice and retry; use contextual icons rather than one generic illustration.
- **Done when:** automated fixtures cover zero, filtered zero, server error, offline, and success for notifications, users, publications, activity, media, editor catalog, accounts, and integrations.
- **Evidence:** shared `frontend/src/lib/components/empty-state.svelte`/state primitives and route-specific list errors, including `frontend/src/routes/notifications/+page.svelte:175`.

### FORM-001 — Apply multi-step form conventions where a workflow is genuinely multi-step

- [ ] **Problem — Conditional:** onboarding and checkout span multiple states, but OpenPost does not need a generic wizard for every form. Long future workflows will need progress, step validation, back navigation, save/resume, and review.
- **Fix:** extract a reusable persisted flow-state pattern only after onboarding proves it; group related fields, validate before advancing, keep back navigation lossless, and provide review/edit links when final submission is consequential.
- **Done when:** onboarding/checkout meet these rules without duplicate wizard frameworks; ordinary short forms remain single-page.
- **Evidence:** onboarding and checkout routes.

### SEARCH-001 — Decide whether OpenPost needs global search

- [ ] **Problem — Conditional:** scoped search exists in places, but there is no unified search-results surface with cross-type results, count, filters, snippets, recent searches, and recoverable zero results. This is not automatically required for the current product.
- **Fix:** first validate a real discovery problem across publications, media, people, and accounts. If warranted, define permission-safe indexing and a typed result contract; otherwise document scoped search as the product decision and focus on missing list filters.
- **Done when:** either a tested global search meets the checklist without leaking cross-workspace/private data, or the decision is recorded and every high-volume list has adequate scoped search/filter/pagination.
- **Evidence:** route inventory; no global search-results route in the audited baseline.

### INTEG-001 — Keep approved connectors and n8n nodes separate from a marketplace

- [ ] **Decision:** operator-installed custom publishing connectors (#32) and installable `n8n-nodes-openpost` nodes are approved directions. A generic in-app integration marketplace, category browser, request-an-integration system, and arbitrary non-social endpoints are still not approved.
- **Fix:** expose installed publishing connectors through the authenticated ProviderRegistry/admin connection UI; publish n8n nodes for use inside n8n; retain ordinary social-provider connection UX. Revisit a generic catalogue only after several real in-app non-social integrations share a lifecycle.
- **Done when:** users/operators can distinguish built-in providers, installed connector services, and external n8n automation; none is marketed as an open marketplace; disconnect data access/impact and health are explicit.
- **Evidence:** PROVIDER-001/CONNECT-001–009/N8N-001–015 and `frontend/src/routes/accounts/+page.svelte`.

### API credentials and version history

### APIKEY-001 — Make one-time token creation safe to complete

- [x] **Problem — Current source audit:** the full token is correctly revealed once, but the success panel has no prominent copy action. The UI neither lets a user choose expiry nor shows expiry/revoked state in the list, and there is no direct API/MCP/CLI documentation link.
- **Fix:** require a useful name; offer safe preset/custom expiry; show the full secret once with copy and accessible confirmation; display created/last-used/expires/status/scope/workspace; link directly to getting-started docs; preserve confirmation before instant irreversible revocation.
- **Done when:** copy is one action and announced, expiration is deliberate and visible, an expired/revoked token cannot look active, secret values never reappear in list/logs, and create/copy/revoke/browser tests pass.
- **Evidence:** `backend/internal/api/handlers/api_tokens.go:29`, `backend/internal/api/handlers/api_tokens.go:47`, `frontend/src/routes/settings/+page.svelte:928`, `frontend/src/routes/settings/+page.svelte:3191`.

### APIKEY-002 — Resolve token-expiry contract drift

- [x] **Problem — Current source audit:** handler documentation says `null` expiry means “never,” while the service defaults an omitted expiry to 90 days. This makes API clients and the settings UI reason from the wrong contract.
- **Fix:** choose a policy, align request schema/docs/service/default/UI, regenerate OpenAPI/types, and migrate or clearly label existing tokens. Prefer finite least-privilege defaults; make “never” explicit and permission-gated if retained.
- **Done when:** generated documentation and observed expiry match for omitted, preset, custom, and explicit no-expiry cases; contract tests fail on future drift.
- **Evidence:** `backend/internal/api/handlers/api_tokens.go:47`, `backend/internal/services/apitokens/service.go:20`, `backend/internal/services/apitokens/service.go:76`.

### APIKEY-003 — Add scopes from real use cases and align CLI workspace binding

- [x] **Problem — Partial/security hardening:** scopes are coarse (`cli:full`, `mcp:read`, `mcp:full`). CLI device approval submits no workspace even though backend tokens can be bound, while some runtime policy expects bound tokens.
- **Fix:** design resource/action scopes from actual integrations; default to least privilege; let the approval flow choose/confirm workspace scope; enforce one matrix in HTTP, MCP, and CLI; preserve existing token semantics through a documented migration.
- **Done when:** read-only and publishing-only automation do not require full access, every operation enforces identical scopes, and bound/unbound CLI behavior is explicit and tested.
- **Evidence:** `frontend/src/routes/settings/+page.svelte:3134`, `frontend/src/routes/cli/authorize/+page.svelte:141`, token authorization services.

### VERSION-001 — Make version restore inspectable and unsurprising

- [x] **Problem — Current source audit:** Image and Video editors have real checkpoints/autosaves and restore, but restore runs immediately from the list with no read-only preview, diff/change summary, actor attribution, or confirmation.
- **Fix:** add version preview, document-model-appropriate change summary, named versions, actor/time for cloud revisions, and confirmation that explains how the current head is preserved. Keep the autosave indicator visible but quiet.
- **Done when:** a user can inspect before restore, current state remains recoverable after restore, conflicts are handled, and confirmation/browser tests cover both editors.
- **Evidence:** `frontend/src/lib/image-editor/components/image-editor-shell.svelte:3587`, `frontend/src/routes/video-editor/[id]/+page.svelte:2933`, `frontend/src/routes/video-editor/[id]/+page.svelte:5592`.

### Content inventory, activity, media, and editor lifecycle

### PUB-002 — Move the calendar day drawer to canonical publications

- [x] **Problem — Baseline audit:** the calendar/planner use publications, but the day drawer still reads and deletes legacy `/posts`, so focused Story/video modes can be omitted or misrepresented.
- **Fix:** load publication responses, use publication deletion/archive behavior, and render every supported mode exactly once with the same status vocabulary as the main inventory.
- **Done when:** fixtures for post, thread, story, short video, and video appear once and open/delete correctly; no new `/posts` dependency is introduced.
- **Evidence:** `frontend/src/lib/components/day-posts-modal.svelte:83`.

### ACTIVITY-001 — Make bounded activity history honest and navigable

- [x] **Problem — Current source audit:** Activity requests at most 200 publications and 100 failed jobs with no pagination or copy saying this is a recent snapshot.
- **Fix:** add cursor pagination/date-range filters and a result/range summary, or deliberately label it “Recent activity” and link to a complete filtered history. Load details on demand.
- **Done when:** older records are reachable or the bounded scope is explicit, failures and publications cannot silently disappear, and large-workspace performance stays bounded.
- **Evidence:** `frontend/src/routes/activity/+page.svelte:164`.

### PERF-001 — Stop full-history hydration on calendar/planner refreshes

- [x] **Problem — Current source audit:** Calendar paginates all publication history across selected workspaces on view changes. The persistent sidebar planner also paginates the entire workspace, and every successful two-second composer autosave triggers its refresh counter.
- **Fix:** query only the visible date range/summary; reuse or adapt `/posts/schedule-overview` only after resolving its legacy/publication contract; debounce/coalesce refreshes; invalidate affected dates rather than the full history.
- **Done when:** composer typing/autosave cannot trigger unbounded history fetches, month/week navigation has bounded request/query volume, and new/updated schedule dots still appear promptly.
- **Evidence:** `frontend/src/lib/components/compose-text-post.svelte:2331`, `frontend/src/lib/components/compose-text-post.svelte:2495`, `frontend/src/lib/components/sidebar-planner.svelte:75`, `frontend/src/lib/components/sidebar-planner.svelte:89`, `backend/internal/api/handlers/posts.go:861`.

### MEDIA-001 — Retire the zombie `media_cleanup_days` setting

- [x] **Problem — Baseline audit:** policy is intentionally fixed at 14 days, but model/API/frontend still imply that a workspace can configure or disable cleanup; the scheduler ignores the supplied value.
- **Fix:** remove or explicitly deprecate the setting and job payload through forward-compatible contracts/migration. Keep the fixed policy and explain it in product/operations copy.
- **Done when:** no UI/API round-trip suggests configurability, old clients receive a defined compatibility response, and cleanup remains fixed at 14 days with tests.
- **Evidence:** `backend/internal/models/models.go:143`, `backend/internal/queue/worker.go:603`, `frontend/src/routes/settings/settings-data.ts:69`.

### MEDIA-002 — Compute protected media once per lifecycle batch

- [x] **Problem — Baseline audit:** each cleanup candidate can trigger roughly 15 queries plus a workspace-wide JSON decode; purge repeats the work.
- **Fix:** normalize remaining media references where appropriate and calculate one protected-media set per batch with joins/CTEs; reuse it for dry-run and purge.
- **Done when:** query count scales with batches, not candidate count; realistic-volume performance tests enforce a budget; safety tests prove referenced media cannot be deleted.
- **Evidence:** `backend/internal/services/medialifecycle/service.go:240`.

### MEDIA-003 — Expose cloud-video deletion in the editor UI

- [x] **Problem — Current source audit:** a cloud-video delete API exists but users cannot invoke it from the editor/project catalogue, leaving obsolete cloud projects without a complete lifecycle.
- **Fix:** add a role-appropriate delete/archive action with dependency/consequence copy, shared destructive confirmation, optimistic-state rollback, and refresh of the correct workspace cache.
- **Done when:** a user can remove an eligible project, failures restore it visibly, referenced/published media are protected according to policy, and unauthorized users cannot see or call the action.
- **Evidence:** video cloud API and `frontend/src/routes/editors/+page.svelte` project actions.

### PUB-003 — Render publication lifecycle history

- [x] **Problem — Current source audit:** backend publication lifecycle events exist, but the detail/activity UX does not show who or what changed status and when.
- **Fix:** add a chronological, permission-safe activity section for creation, edits, schedule changes, publish attempts, retries, provider results, archive/delete, and relevant actor/system attribution.
- **Done when:** users can diagnose a publication without logs, timestamps use exact accessible values, provider-safe errors are shown, and sensitive internal details remain hidden.
- **Evidence:** publication event backend models/endpoints and `frontend/src/routes/publications/[id]/+page.svelte`.

### COMPOSE-001 — Make workspace switching safe while a draft is dirty

- [x] **Problem — Current source audit:** composer workspace changes can discard or strand unsaved context while feedback is limited to a transient toast.
- **Fix:** block or confirm the switch when state cannot move safely; offer save draft/stay/discard; key autosave and requests to the originating workspace; make recovery persistent rather than toast-only.
- **Done when:** rapid workspace switches cannot write a draft/media/schedule into the wrong workspace; cancel preserves all work; discard is explicit; browser races are covered.
- **Evidence:** workspace effects and draft/autosave handling in `frontend/src/lib/components/compose-text-post.svelte`.

### COMPOSE-002 — Attach scheduling failures to the affected destination

- [x] **Problem — Current source audit:** some scheduling/publishing errors surface only as a global message, which is unclear when destination variants fail differently.
- **Fix:** map validation and server errors to the publication segment/rendition/destination that caused them; keep a global summary with focus links; preserve successful destinations only when partial behavior is intentional and clear.
- **Done when:** users can identify and fix the exact failing platform/field; focus moves to the first error; retry semantics are explicit; mixed-success fixtures are covered.
- **Evidence:** scheduling actions/errors in `frontend/src/lib/components/compose-text-post.svelte` and publication handlers.

### VIDEO-001 — Give video Blob URLs editor-scoped ownership

- [x] **Problem — Baseline audit:** global Blob URL cache entries are never released, concurrent identical loads can leak an untracked URL, and stale async preview results are not generation-guarded.
- **Fix:** coalesce in-flight loads; use editor-scoped reference ownership; revoke exactly once on replacement/unmount; ignore stale-generation results.
- **Done when:** tests instrument `URL.createObjectURL`/`revokeObjectURL`, prove no leak across open/replace/close, and prove slow stale loads cannot replace the current preview.
- **Evidence:** `frontend/src/lib/video-editor/source-url.ts:5`, `frontend/src/lib/video-editor/components/video-preview.svelte:143`.

### VIDEO-002 — Define and run disposable-video-cache cleanup

- [x] **Problem — Baseline audit:** cache cleanup has no caller, and reads do not refresh the timestamp used for age, so frequently used artifacts can expire as if unused.
- **Fix:** choose creation-age or last-access semantics, store the matching metadata, run bounded cleanup during idle/quota pressure, and protect active/referenced assets.
- **Done when:** deterministic clock/quota tests cover expiry, recent use, active projects, interrupted cleanup, and storage-pressure recovery.
- **Evidence:** `frontend/src/lib/video-editor/storage.ts:543`.

## P2 — architecture, data retirement, build, and operations

### ARCH-001 — Split Settings into feature-owned, conditionally mounted components

- [ ] **Problem — Baseline audit:** `settings/+page.svelte` is roughly 3,876 lines and owns unrelated profile, workspace, team, identity, billing, security, tokens, brand, scheduling, and instance concerns; hidden sections remain mounted.
- **Fix:** extract feature components/controllers with typed inputs; mount heavy tabs only when active; keep shared load/save/error patterns and direct tab URLs.
- **Done when:** each domain can be tested independently, inactive heavy tabs do no work, permissions/saves/deep links remain correct, and the route becomes coordination rather than implementation.
- **Evidence:** `frontend/src/routes/settings/+page.svelte:1`.

### ARCH-002 — Extract route-independent account settings

- [ ] **Problem — Baseline audit:** Settings imports `accounts/+page.svelte`; that route infers whether it is embedded from global URL state and redirects after mount.
- **Fix:** extract `AccountsSettings`; keep `/accounts` compatibility redirect/loader logic at the route boundary; pass explicit mode/context into the component.
- **Done when:** no route imports another route component, there is no redirect flash, OAuth/error state survives, and direct/embedded browser tests pass.
- **Evidence:** `frontend/src/routes/accounts/+page.svelte:274`.

### ARCH-003 — Remove global compatibility scans from authoring writes

- [ ] **Problem — Baseline audit:** legacy publication compatibility paths synchronously select every unlinked draft/scheduled post on write, making current authoring latency scale with history.
- **Fix:** translate only the changed aggregate transactionally; move global backfills to a resumable startup/maintenance migration with progress and idempotency.
- **Done when:** authoring query count is constant with historical rows; backfill can resume after interruption; old records remain accessible.
- **Evidence:** `backend/internal/database/migrations/legacy_publications.go:36`.

### ARCH-004 — Finish a shared application command/query boundary

- [ ] **Problem — Baseline audit:** the 6,000+ line MCP handler independently implements publication, schedule, legacy-post, and job behavior, allowing HTTP/MCP/CLI drift such as PUB-001.
- **Fix:** move each publication, scheduling, media, billing, and communications use case into one command/query service; keep transports responsible only for auth, decoding, schema, and response mapping.
- **Done when:** no adapter duplicates persistence/defaulting/job logic; adapter parity tests exercise the same use cases and authorization rules.
- **Evidence:** `backend/internal/api/handlers/mcp.go:1`.

### DATA-001 — Retire legacy media collections only after deployed-data inventory

- [ ] **Problem — Baseline audit:** migration 062 moved collections to tags, but collection tables/models remain in fresh bootstrap.
- **Fix:** inventory production rows, write a forward migration that copies/verifies remaining data, then remove tables/models; keep backup and rollback instructions.
- **Done when:** supported historical databases migrate without loss, fresh schema omits the tables, row/checksum evidence is recorded, and rollback is rehearsed.
- **Evidence:** `backend/internal/database/database.go:124`.

### DATA-002 — Disposition `publication_assets` with zero-loss proof

- [ ] **Problem — Baseline audit:** no current reader/writer remains, but historical releases wrote the table.
- **Fix:** inventory deployed rows; map any live data to segment media or a documented retained archive; drop only through a forward migration after verification.
- **Done when:** every row has a disposition, upgrade tests cover populated historical fixtures, and no application path depends on it.
- **Evidence:** `backend/internal/models/models.go:1605`, `backend/internal/database/database.go:111`.

### DATA-003 — Remove `posting_schedules.set_id` through a forward migration

- [ ] **Problem — Baseline audit:** the column is explicitly legacy and unused.
- **Fix:** confirm zero readers/writers, migrate supported databases, remove model/contract remnants, and retain historical migration files.
- **Done when:** fresh and upgraded schemas agree and migration regression tests pass.
- **Evidence:** `backend/internal/models/models.go:1648`.

### DATA-004 — Stage removal of duplicate publication fields

- [ ] **Problem — Baseline audit:** `SourceContent` mirrors `SourceText`, and `ReleasePlanJSON` mirrors `MetadataJSON`.
- **Fix:** nominate canonical fields; migrate readers; backfill and compare; stop dual-write; observe for a release window; then drop via forward migration.
- **Done when:** comparison telemetry shows no divergence, old-version upgrade fixtures survive, and generated contracts no longer expose retired fields.
- **Evidence:** `backend/internal/models/models.go:755`.

### DATA-005 — Decide the dormant organization-invitation model

- [ ] **Problem — Current source audit:** `organization_invitations` is created, bootstrapped, and cleaned up, but the active team flow uses workspace invitations and no complete organization-invite product consumes the schema.
- **Fix:** decide whether organizations need organization-wide membership/invites distinct from workspace access. If yes, implement one coherent lifecycle and permission model; if no, inventory rows and remove the schema through a forward migration.
- **Done when:** there is no dormant second invitation concept, existing rows have a zero-loss disposition, and workspace/organization membership semantics are documented and tested.
- **Evidence:** `backend/internal/models/models.go:116`, `backend/internal/database/database.go:77`, `backend/internal/database/migrations/025_organizations_and_profiles.sql:22`.

### COMPAT-001 — Create an API/schema compatibility retirement registry

- [x] **Problem — Baseline audit:** repository non-use cannot prove that public API-token, MCP, or CLI consumers are absent.
- **Fix:** record owner, consumer telemetry, introduced/deprecated/removal versions, replacement, notice, and migration path for every candidate; define a minimum sunset window.
- **Done when:** no public endpoint/schema is removed from a source-only reachability result and removal gates require observed usage plus announced policy.

Candidate decisions under this registry:

- [x] `GET /posts/schedule-overview`: reconcile with publications; telemetry; replace stale E2E mock; remove only if no valid bounded-calendar use remains.
- [x] `GET /accounts/mastodon/servers`: deprecate only after provider-catalog migration proof.
- [x] `GET /accounts/{id}/destination-options`: n8n v0.1 explicitly consumes this. Retain and stabilize it for automation, or ship a fully equivalent capability endpoint and migrate the node before deprecation.
- [x] legacy `POST /posts` and `PATCH /posts/{id}`: preserve until API/CLI consumers and sunset requirements are handled.
- [x] `GET /organizations` and `GET /organizations/{id}/team`: consolidate only after external-consumer review.
- [x] organization billing status/checkout duplicates: move the live portal to generic `organization_id` endpoints first.
- [x] OIDC provider logout: integrate RP-initiated logout or explicitly deprecate/document it.
- [x] `/prompts`: decide hidden advanced page vs retirement; do not remove the prompt/random backend used by the composer.

### DOC-002 — Correct provider-app administration guidance

- [x] **Problem — Baseline audit:** contributor guidance says the provider-app admin UI was removed, while encrypted provider-app management is live.
- **Fix:** update `AGENTS.md` and operator docs to describe the current scope, authorization, secret handling, and hosted/self-hosted ownership. Do not delete the feature to make stale guidance true.
- **Done when:** guidance and live API/UI agree and security constraints are tested/documented.
- **Evidence:** `frontend/src/lib/components/instance-configuration.svelte:124`.

### BUILD-001 — Fix Turbo input/output ownership

- [x] **Problem — Baseline audit:** Turbo declares package-relative outputs while frontend build writes into a sibling backend path, so cache ownership/invalidation is wrong even though canonical release paths currently bypass it.
- **Fix:** use package-local output plus an explicit packaging task or correct root-relative ownership; declare every frontend/backend embed input.
- **Done when:** clean and cached builds produce identical artifacts, relevant changes invalidate the right tasks, and release reproducibility is unchanged.
- **Evidence:** `turbo.json:14`.

### BUILD-002 — Replace marketing’s frontend-source alias with real packages

- [ ] **Problem — Baseline audit:** marketing aliases all of `frontend/src/lib`, imports frontend CSS, and writes generated Paraglide output into frontend source, bypassing package boundaries and Turbo inputs.
- **Fix:** expose supported UI/theme/i18n APIs through declared workspace packages; keep generated output within its owner; migrate imports without visual drift.
- **Done when:** no package writes into another package’s source, dependency graphs are explicit, cache invalidation works, and app/marketing UI checks pass.
- **Evidence:** `marketing-site/svelte.config.js:11`.

### OPS-001 — Use a supported digest-pinned runtime base with image assurance

- [x] **Problem — Baseline audit:** runtime uses Alpine 3.19, now outside normal support. No specific exploitable CVE was established.
- **Fix:** move to a supported pinned digest; generate an SBOM; scan the final image in CI; document update cadence; smoke readiness and core media dependencies.
- **Done when:** the exact digest and scan evidence are attached to release checks and the image restart smoke passes. Do not market this as a remediated exploit unless one is proven.
- **Evidence:** `docker/Dockerfile:52`.

### OPS-002 — Decide and document ARM64 image support

- [x] **Problem — Baseline audit:** public Docker image is amd64-only.
- **Fix:** either add a tested multi-arch image with CGO/SQLite/FFmpeg and runtime smoke proof, or state amd64-only prominently in install docs/manifests.
- **Done when:** supported architectures are unambiguous and CI tests every published architecture.

### BUILD-003 — Make root `bun run build` honest about docs

- [x] **Problem — Baseline audit:** root build silently omits the actual docs build because docs expose `docs:build`, not `build`.
- **Fix:** include docs explicitly or fail with a clear supported-command message; keep Devenv/CI commands canonical.
- **Done when:** root build contract is documented and CI prevents future task-name gaps.

### CI-001 — Reduce workflow permissions to job scope

- [x] **Problem — Baseline audit:** CI grants `packages: write` globally.
- **Fix:** default to read-only and grant package write only to the production-image publication job.
- **Done when:** non-publishing jobs cannot write packages and image publishing still works.

### REL-002 — Define `server.json` version ownership

- [x] **Problem — Baseline audit:** `server.json` has an apparently independent `1.32.1` with no documented relation to app SemVer.
- **Fix:** document whether it is protocol, catalogue, or app version; derive or validate it in release planning; add a compatibility policy.
- **Done when:** unexplained divergence fails a check and consumers can reason about upgrades.

### CI-002 — Add continuous reachability and release-surface checks

- [x] **Problem — Baseline audit:** deep manual scans found real dead code and route/config blind spots, but these are not continuous gates.
- **Fix:** configure Go `deadcode -test`, TypeScript/Knip with generated/dynamic allowlists, config-derived docs-nav crawling, bidirectional route metadata checks, and API-consumer telemetry.
- **Done when:** gates catch intentional fixtures without recurring false positives and block newly unreachable shipped code/config links.

### OPS-003 — Clarify readiness versus liveness policy

- [x] **Problem — Baseline audit:** Dockerfile/docs use readiness while comments and Compose overrides describe liveness inconsistently.
- **Fix:** define what each endpoint proves and which orchestrator probe uses it; align comments, Compose, container health, runbooks, and tests.
- **Done when:** operators can predict restart/traffic behavior during dependency degradation and checks enforce the chosen policy.

### BUILD-004 — Ship assets through per-surface manifests

- [x] **Problem — Baseline audit:** `sync-assets.mjs` copies the full roughly 1.9 MiB shared tree into app, docs, and marketing.
- **Fix:** declare per-surface assets in one typed manifest; copy only referenced assets; validate missing/extra entries.
- **Done when:** builds fail on undeclared use and measured shipped size drops without broken assets.

### MKT-OPS-001 — Derive route metadata from one manifest

- [x] **Problem — Baseline audit:** prerender, sitemap, and social-image route sets are duplicated; current checks validate only one direction.
- **Fix:** derive all three from a typed route manifest or enforce bidirectional set equality with documented exceptions.
- **Done when:** adding/removing a public route cannot leave stale/missing sitemap or social metadata.

### DOC-003 — Correct stale launch and contributor facts

- [x] **Problem — Baseline audit:** launch-kit/brief retain an old network count, and Copilot instructions retain a superseded design direction.
- **Fix:** update canonical facts, remove duplicated counts where possible, and validate public/provider totals from one catalogue.
- **Done when:** README/docs/launch materials/instructions agree with current capability data.

### REL-003 — Complete release-plan path ownership

- [x] **Problem — Baseline audit:** advisory release planning omits root build/config, Compose, `server.json`, skills, launch-kit, and scripts even though the broad release gate still runs.
- **Fix:** assign every release-relevant path an owner/category or explicit exemption and validate coverage.
- **Done when:** changed relevant files cannot silently fall outside impact planning.

### BUILD-005 — Standardize the Lucide dependency family

- [x] **Problem — Baseline audit:** both `@lucide/svelte` and `lucide-svelte` are installed and used.
- **Fix:** choose the supported package, mechanically migrate imports, remove the duplicate dependency, and compare bundle/types.
- **Done when:** one family remains and application/marketing builds and visual smoke tests pass.

## P2 — public product, pricing, legal clarity, and proof

### LEGAL-004 — Make Privacy and legal change history understandable

- [ ] **Problem — Supplied audit:** the policies are substantive, but lack a plain-language summary, a complete data-category retention schedule, a dedicated cookie/local-storage inventory, a legal-policy changelog, and aligned acceptance metadata. The current cookie section omits at least the app preference cookie.
- **Fix:** add a non-binding summary linked to full terms; publish a retention table by data category and deletion trigger; inventory cookie/local-storage name, purpose, scope, duration, and necessity; keep a dated material-change log tied to LEGAL-002 versions.
- **Done when:** every stored browser identifier and managed data category has an owner/purpose/retention entry; legal review confirms the summary does not override the full policy; automated checks flag undocumented first-party cookies where feasible.
- **Evidence:** `marketing-site/src/routes/privacy/+page.svelte` and legal acceptance configuration.

### SEC-003 — State the security assurance boundary without unsupported badges

- [ ] **Problem — Supplied audit/operator facts required:** Security accurately describes token encryption, password hashing, MFA/passkeys, session controls, and the absence of SOC 2/ISO/pentest claims. Encryption scope, managed human-access policy, incident-history disclosure, and independently tested assurance remain incomplete.
- **Fix:** publish a clear control/responsibility matrix for managed and self-hosted deployments; link the residency/subprocessor/access facts from TRUST-001; define incident-history wording; commission independent testing only when ready and publish scope/date/remediation status.
- **Done when:** every claim has code/operational evidence and review date; no certification, GDPR, audit, or pentest logo/text appears without current proof.
- **Evidence:** `marketing-site/src/routes/security/+page.svelte:19`.

### MKT-001 — Create a complete `/features` hub from verified capabilities

- [x] **Problem — Supplied audit:** strong composer demos, screenshots, platform detail pages, tools, and CTAs exist, but scheduling, analytics, inbox, teams, automation, and editing are scattered. Feature benefits, limits, and proof are inconsistent.
- **Fix:** build a concise hub that links feature-specific pages/sections; state user outcome, supported scope, provider/plan limits, screenshot/demo proof, and next action; derive mutable capability facts from canonical catalogues.
- **Done when:** every promoted feature has one discoverable canonical explanation, factual proof, relevant caveats, and cross-links to docs/pricing; no unsupported roadmap item is presented as live.
- **Evidence:** marketing route inventory; no complete `/features` route in the audited baseline.

### MKT-002 — Put claim-level evidence and review dates on comparisons

- [x] **Problem — Supplied audit:** comparison pages are unusually fair and responsive, but factual competitor rows rely on a generic source block. Switcher proof is unverified and pricing comparisons are largely prose.
- **Fix:** attach source URL, reviewed-on date, region/tier qualifier, and claim owner to each mutable row; distinguish direct evidence from interpretation; add side-by-side pricing/features only where like-for-like facts can be verified.
- **Done when:** every competitor fact can be audited at row level, stale review dates are visible/fail a content check, strengths remain acknowledged, and any interactive switcher is browser-verified.
- **Evidence:** `marketing-site/src/routes/compare` and supplied comparison review.

### PRICE-002 — Improve pricing decision support and accessibility

- [x] **Problem — Supplied audit:** plan names, monthly/annual prices, trial terms, Founder recommendation, and limits exist, but “best for” guidance is thin; refunds and Paddle/Merchant-of-Record reassurance appear too far from the choice; the full card grid is one `aria-live` region.
- **Fix:** add concise audience/outcome guidance per plan; place trial end/charge behavior, cancellation, refund, tax/MoR, and billing-management links near CTAs; limit live announcements to the changed price text and preserve focus when the billing period changes.
- **Done when:** users can explain price, billing frequency, trial outcome, included seats/limits, and management path before checkout; screen readers receive one useful price-change announcement; all five CTA paths work.
- **Evidence:** `marketing-site/src/routes/_components/PricingShowcase.svelte`, `marketing-site/src/routes/pricing/+page.svelte`.

### ABOUT-001 — Add an About page only from approved facts

- [ ] **Problem — Operator facts required:** no About route collects product mission, verified origin story, team, milestones, or backers. Inventing these would be worse than the gap.
- **Fix:** obtain operator-approved names, roles, timeline, funding/backer, company/contact, and imagery permissions; publish only confirmed material with an About CTA in appropriate navigation/footer locations.
- **Done when:** every personal/company claim has approval and update owner; absent facts are omitted rather than filled with generic copy.

### FAQ-001 — Expose the full useful FAQ and a contextual contact path

- [x] **Problem — Current source/supplied audit:** seven useful answers exist in source, but the homepage renders only four; Pricing has no purchase FAQ or clear “all questions” route. Search/TOC is unnecessary until the collection grows.
- **Fix:** add a dedicated FAQ route or a clearly linked complete section; group by setup, providers, billing, privacy, and self-hosting; put purchase-relevant answers on/near Pricing; end with a support/contact action.
- **Done when:** all canonical answers are reachable, duplicated answers are sourced from one data set, structured data matches visible content if used, and contact is contextual.
- **Evidence:** `marketing-site/src/routes/_marketing.ts:1345`, `marketing-site/src/routes/+page.svelte:202`, `marketing-site/src/routes/pricing/+page.svelte`.

### MKT-404-001 — Unify and improve marketing not-found recovery

- [x] **Problem — Supplied/current source:** the static 404 has a title, explanation, and home link, but lacks brand mark, docs/support/search recovery, and personality; static-host and route-level errors differ.
- **Fix:** create one branded error design that can render as static host fallback and Svelte error boundary; add home, docs, support, and relevant navigation; add search only if MKT-001/FAQ scope justifies it.
- **Done when:** unknown static and dynamic routes have equivalent content/status, no broken app dependency, and responsive/a11y checks pass.
- **Evidence:** `marketing-site/static/404.html:7`, dynamic routes under `marketing-site/src/routes/*/[slug]`.

### MKT-005 — Increase footer social-link touch targets

- [x] **Problem — Supplied measurement:** social-icon targets are about 16 × 32 px on mobile, below the project’s 44 px coarse-pointer target.
- **Fix:** expand the interactive box without visually inflating icons; maintain spacing, focus ring, accessible name, and no overflow.
- **Done when:** computed hit boxes are at least 44 × 44 px under coarse pointer at 320/390 px and keyboard focus is visible.
- **Evidence:** marketing footer social links.

### SIGNUP-001 — Show password and purchase expectations before checkout

- [ ] **Problem — Supplied audit:** registration lacks password reveal/rules, and when reached from Pricing it does not keep selected plan, price, billing period, trial length, card timing, and end-of-trial outcome visible enough before checkout.
- **Fix:** implement AUTH-002; preserve and summarize selected plan/period through registration/onboarding; state when card/payment is requested and what happens after 14 days; allow safe plan change.
- **Done when:** the selected plan cannot silently default/change, users see trial/charge outcome before payment, and registration → verification → onboarding → checkout retains context.
- **Evidence:** `frontend/src/routes/register/+page.svelte`, `frontend/src/routes/onboarding/+page.svelte`, `frontend/src/routes/checkout/+page.svelte`.

### CLAIM-001 — Establish provenance for customer/proof claims

- [ ] **Problem — Operator facts required:** customer-count, logo, “Used by builders at,” testimonial, origin, milestone, or backer claims cannot be verified from source alone. Absence of proof is not permission to fabricate it.
- **Fix:** keep a claim register with exact wording, evidence/permission, owner, scope, and review/expiry date; remove or soften unproved claims; do not make login busier merely to add social proof.
- **Done when:** every public proof claim has recorded permission/current-use provenance and an expiry/review process.
- **Evidence:** `marketing-site/src/routes/+page.svelte:101` and public proof components.

### LEGAL-005 — Revalidate Paddle and managed-service legal assertions

- [ ] **Problem — External verification required:** Merchant-of-Record, tax documents, refund/withdrawal rules, customer portal behavior, controller identity, transfer safeguards, PostHog project configuration, and material-change process cannot be proven from repository source alone.
- **Fix:** review the live Paddle account/config/contracts, deployed analytics/configuration, and applicable legal advice; record evidence and review date; update Terms/Privacy/Refunds and billing UX together.
- **Done when:** every assertion has current provider/deployment/legal evidence and a named review owner; checkout and portal behavior match the documents.
- **Evidence:** `marketing-site/src/routes/terms/+page.svelte:161`, `marketing-site/src/routes/refunds/+page.svelte:40`, `marketing-site/src/routes/privacy/+page.svelte:205`.

### QA-001 — Reconcile the marketing browser suite before release

- [x] **Problem — Supplied validation limit:** marketing type/UI checks passed, but the current local Playwright result was 8 passed / 7 failed. Some assertions appear stale and a direct browser check showed the demo dialog works, so this is a test/release-confidence gap rather than seven confirmed production defects.
- **Fix:** classify each failure as product regression, fixture/server contamination, or stale assertion; repair the right side; run the isolated marketing suite against the intended build/server and pin current behavior.
- **Done when:** the suite is green without weakening behavioral coverage, demo/dialog/pricing/navigation checks reflect current UX, and the release candidate runs the same isolated command.
- **Evidence:** `e2e/marketing.spec.ts` and the supplied audit run summary.

## P3 — cleanup and preventive maintenance

These tasks are deliberately lower priority. Remove only code proven unreachable after moving any valuable behavior assertions. Do not mix schema/API removal into a dead-code cleanup commit.

### CLEAN-GO-001 — Remove tracked root debugging commands

- [x] Delete `backend/debug_import.go` and `backend/test_imports.go` after one final import/build check.
- **Done when:** the extra root command/package is gone and backend build/test behavior is unchanged.

### CLEAN-GO-002 — Remove confirmed unreachable backend/CLI symbols

- [x] Review then remove or unexport: `MCPHandler.SetUsage`, `MediaHandler.SetAnalyzer`, `PostHandler.SetEntitlement`, `NewCompositeService`, `ForProfile`, `DateExpr`, `ApproveSession`, `EnvironmentConfigured`, `CallbackURL`, `medialifecycle.Service.Touch`, `videoprocessing.SetAnalyzer`, `StableMediaIDs`, and CLI `FormatHuman`.
- **Done when:** configured `deadcode -test` no longer reports them, no supported external API was accidentally removed, and focused tests pass.
- **Evidence:** supplied deep audit “Confirmed dead code and low-risk removals.”

### CLEAN-GO-003 — Remove the misleading `WorkspaceAccessMiddleware`

- [x] **Problem:** the unused middleware’s name claims workspace authorization but it only authenticates.
- **Fix:** delete it rather than risk future use; verify every live workspace route uses the real membership/role guard.
- **Done when:** authorization tests prove cross-workspace requests fail and no registration/import remains.
- **Evidence:** `backend/internal/api/middleware/auth.go:283`.

### CLEAN-GO-004 — Retire obsolete implementation-only helpers/tests

- [x] Move useful assertions to current Trash behavior, then remove `removeMediaReferences` and `deleteMedia` plus their implementation-only tests.
- [x] Move useful scheduling assertions to configured-slot behavior, then remove `findNextOverflowPostingTime` and its implementation-only tests.
- **Evidence:** `backend/internal/api/handlers/media.go:2622`, `backend/internal/api/handlers/media.go:2807`, `backend/internal/api/handlers/posting_schedules.go:469`.

### CLEAN-CLI-001 — Remove or unexport test-only CLI APIs

- [x] Remove/unexport CLI `CreatePost`, `UpdatePost`, `CreateAPIToken`, and package-internal MCP stdio wrappers after tests use supported helpers.
- **Done when:** production import graph stays clean and CLI tests exercise supported public behavior.
- **Evidence:** `cli/internal/api/client.go:885`, `cli/internal/api/client.go:970`, `cli/internal/api/client.go:1413`, `cli/internal/mcpstdio/stdio.go:39`.

### CLEAN-LIFECYCLE-001 — Decide, then wire or remove unreachable lifecycle hooks

- [x] Make new CLI authorization requests expire older pending sessions; remove `CancelMediaCleanup` because transactional workspace deletion already removes exact workspace jobs and deleting a processing row cannot cancel an in-flight worker.
- **Done when:** each is either called from an explicit tested lifecycle or removed with an approved replacement/non-requirement.

### CLEAN-FE-001 — Remove unused UI primitives and duplicate tombstones

- [x] Remove drawer primitive plus `vaul-svelte`, scroll-area primitive, duplicate sidebar `constants.js`/`constants.ts`, and empty `lib/index.ts`/`types/index.ts` after import checks.
- **Done when:** no import remains, the lockfile is pruned, and UI consistency/type/build checks pass.
- **Evidence:** `frontend/src/lib/components/ui/drawer/index.ts`, `frontend/src/lib/components/ui/scroll-area/index.ts`, `frontend/src/lib/components/ui/sidebar/constants.ts`.

### CLEAN-FE-002 — Move preview tests before deleting the dead wrapper

- [x] Move broad behavior tests from production-dead `platform-preview.svelte` into `packages/social-preview`, then delete the wrapper.
- **Done when:** package-level coverage still proves every supported platform presentation and no shipped import remains.
- **Evidence:** `frontend/src/lib/components/platform-preview.svelte`.

### CLEAN-FE-003 — Prune confirmed unused frontend exports

- [x] Remove imports/re-exports and then delete: `countTotalChars`, `getPostMediaIdsForSave`, `deleteImageEditorTemplate`, `getInstanceUrl`, `settingsPathForPlan`, `ScheduleOverview`, `AuthResponse`, `cleanupDaysOptions`, `uploadMediaFiles`, `cloneProjectDocument`, `hashVideoSource`, `cloudDocumentForTest`, `EXPORT_MINIMUM_BITRATES`, and `ExportJob`.
- **Done when:** TypeScript/Knip with appropriate dynamic/generated allowlists is green and public contracts are unchanged.

### CLEAN-MKT-001 — Prune unreachable marketing/package/script assets

- [x] Delete `PublishingActivityField.svelte`.
- [x] Prune unused `_marketing.ts` exports: `demoVideoThumbnailUrl`, `planIDs`, `platformLimitSummaries`, `launchProviderMatrix`, `illustrativeLaunchRenditions`, `productFeatures`, `workflowBlocks`, `securityItems`, and unused slug types.
- [x] Delete orphaned `scripts/install-cachix-with-retry.sh`.
- [x] Unexport unused private-package `AnalysisSuggestion`, `previewFormats`, and `PreviewCapability`.
- **Done when:** no shipped reference remains and package/marketing tests pass.
- **Evidence:** `marketing-site/src/routes/_components/PublishingActivityField.svelte`, `marketing-site/src/routes/_marketing.ts:33`, `marketing-site/src/routes/_components/postiz-social-logos.ts`, `scripts/install-cachix-with-retry.sh`.

### IA-001 — Clarify account versus workspace preferences

- [x] **Problem — Current source audit:** appearance, language, and sound live in a transient account menu, while timezone/week start are workspace settings; “Profile & security” does not clearly expose all personal preferences.
- **Fix:** label scope explicitly and add a discoverable personal-preferences destination or cross-links without duplicating state.
- **Done when:** users can predict whether a setting follows them or a workspace and can reach appearance, language, sound, profile, and security from Settings.
- **Evidence:** `frontend/src/lib/components/account-preferences-menu.svelte:211`, `frontend/src/routes/settings/+page.svelte:3332`.

## Explicit product decisions and non-actions

These checklist rows are not open defects unless the product decision changes:

- [ ] **Global search:** validate a cross-entity discovery need before building it. If approved, SEARCH-001 defines the minimum safe experience.
- [ ] **Generic integrations marketplace:** CONNECT approves self-hosted operator-installed publishing connectors and N8N approves nodes used inside n8n. Neither approves a public in-app marketplace, categories, request form, or arbitrary tenant-supplied endpoints.
- [ ] **Generic save-and-resume wizard:** fix onboarding/checkout first; extract shared infrastructure only when a genuinely long form needs it.
- [ ] **Remember me:** keep the current fixed persistent-session model or implement real alternative lifetimes; do not add a cosmetic checkbox.
- [ ] **SMS/email MFA:** TOTP plus passkeys provide strong method choice. Do not add weaker or costly channels just to satisfy a generic checklist; add a method only after threat, deliverability, recovery, and operating-cost review.
- [ ] **Public-profile contact/follow:** do not add it until OpenPost has a supported messaging/follow model. Never expose email by default.
- [ ] **Enterprise/contact sales:** add only when there is an operator-owned sales/support process and a real custom plan. Do not relabel Agency as Enterprise without facts.
- [ ] **Login testimonials/news:** keep login focused. Add proof content only if it is verified, optional, responsive, and does not distract from authentication.
- [ ] **Phone number/job title:** do not collect extra account fields without a concrete product, support, or legal purpose and retention rule.
- [ ] **Account deactivation:** add a reversible pause only if it has a defined effect on billing, scheduled publications, shared ownership, and data visibility; the existing permanent-deletion flow should not be weakened to satisfy a generic checklist.

Do not delete or rewrite these merely because they look old or unused:

- `/studio` and `/video-studio` redirects; `/posts/[id]`; `GET/DELETE /posts`; `/posts/thread`.
- historical/no-op migrations; use new forward migrations.
- generated OpenAPI, Paraglide, CLI docs, social catalogues, or embedded frontend output.
- Capacitor plugins, ONNX declarations/models, dynamically imported lossless-export workers, or runtime asset manifests.
- intentional transitive pins such as `estree-walker` and `svelte-toolbelt` without rechecking their recorded reason.
- capability-asserted provider adapters/interfaces and navigation-menu primitives reached through dynamic/shared imports.
- the `/prompts` backend/random API.
- Alpine solely because it is old; OPS-001 is maintenance hardening, not a proven vulnerability claim.
- current dynamic marketing routes/sitemap entries without a fresh mismatch; the baseline audit found the sets equal.

Integration/provider guardrails:

- Never build Pinterest, GBP, or Reddit as isolated one-off systems; they consume the shared grant/authorization/write/delivery/capability/policy/retention kernel.
- Allocate the next free migration number at implementation time; the proposal’s `054` is stale because the audited checkout already reached `070`.
- Never store raw provider responses or tokens in authorization/delivery/certification records, blindly replay an ambiguous write, auto-bind a guessed GBP result, or hide multi-board/community loops inside one rendition.
- Keep provider previews neutral and OpenPost-native; do not imitate Pinterest, Google Search/Maps, or Reddit UI.
- Do not enable hosted GBP delayed automation, video, BYO-project tenancy, or Q&A; Reddit cookie/password/session auth, bulk multi-community publishing, or autonomous reposts; or Pinterest advertising-derived limits without current approval and certification.
- Do not copy Postiz provider implementations wholesale. Postiz and Shoutrrr remain behavioral references only.
- Never load Go `.so` plugins, run Playwright inside OpenPost, let hosted tenants register endpoints, put executable code/inline secrets in connector config, let manifests declare arbitrary host pipeline settings, accept connector executable UI/raw SVG, send base64 media, or give broad media-library access.
- Treat provider IDs as opaque, keep optional connector failures local, preserve history after connector removal, and keep connector transport credentials separate from OpenPost API tokens.
- `n8n-nodes-openpost` is installed and used inside n8n. It calls curated REST operations; it is not a social provider, Connector Protocol client, MCP client, generic raw-request node, or generated copy of all API endpoints.
- Do not ship a timestamp-polling n8n trigger. Build the durable automation-event/webhook API first.

For all public API, MCP, CLI, and schema removals, production telemetry/inventory plus a documented deprecation window are prerequisites. Repository-only non-use is insufficient.

## Preserve these strengths while remediating

- [ ] Keep TOTP disabled until code verification succeeds; keep MFA disable/reset behind password or recent step-up authentication.
- [ ] Keep passkeys, non-enumerating password reset, URL-fragment reset-token cleanup, PKCE OIDC, safe redirect validation, and server-side session revocation.
- [ ] Keep avatar initials fallback, opt-in public profiles, profile dirty-state handling, and clear save confirmation.
- [ ] Keep notification categories, meaningful in-app/email channel controls, explicit save feedback, and mandatory-alert protections. Do not advertise push/SMS until delivery exists.
- [ ] Keep pending-invite revoke, seat enforcement, server-side role checks, and role-gated admin tabs.
- [ ] Keep account/workspace destructive confirmation and strengthen it through ADMIN-002 rather than replacing it with ad hoc dialogs.
- [ ] Keep API secrets one-time-only and hashed at rest; never display an existing full key.
- [ ] Keep publication detail’s clear identifier, textual status, hierarchy, timestamp, and back action. Add edit/archive/activity only where valid for that state.
- [ ] Keep shared `EmptyState`, `InlineNotice`, retry, loading, and destructive-dialog primitives; repair inconsistent consumers instead of creating new local variants.
- [ ] Keep inactive social accounts visible with a text status marker; the earlier “hidden inactive account” concern is resolved in current source (`frontend/src/routes/accounts/+page.svelte:836`).
- [ ] Keep platform pages’ candid setup/limit/provider caveats and comparison pages’ fair acknowledgement of competitor strengths.
- [ ] Keep the verified 320 px/390 px/desktop no-overflow behavior, light/dark modes, reduced-motion handling, focus treatment, lazy screenshots, and working product demo.
- [ ] Keep current plan IDs/prices/limits sourced consistently across marketing, frontend, and backend; the audit found no catalogue mismatch.

## Operator and external verification queue

These cannot be closed from repository source alone:

- [ ] Verify production `/api/v1/version`, update-check behavior, release tag/SHA/digest, and rollback evidence after REL-001.
- [ ] Inventory deployed `media_collections`, `publication_assets`, duplicate publication fields, and API/MCP/CLI endpoint usage before migration/removal.
- [ ] Verify database and media backup encryption boundary, retention, access, deletion, monitoring, off-host resilience, and restore evidence without printing secrets.
- [ ] Verify live Paddle Merchant-of-Record configuration, tax/VAT/customer documents, invoices, portal deep links, discounts, refunds, cancellation, failed-payment recovery, and withdrawal terms.
- [ ] Verify controller/company identity, residency, every managed subprocessor, transfer basis, support/human access, incident process/history wording, and legal review dates.
- [ ] Verify the managed PostHog EU project, cookieless hashing, disabled IP capture and replay, 12-month maximum retention, ingestion proxy, and public Privacy claims before enabling production telemetry; then retire the old Umami service and its stored data under the prior policy.
- [ ] Obtain recorded permission and current-use evidence for every customer logo, testimonial, count, “Used by,” team, milestone, backer, or origin claim.
- [ ] Decide whether independent pentest/audit work is funded; publish scope and date only after completion. Do not add SOC 2, ISO, GDPR, or pentest badges without proof.
- [ ] Reverify Pinterest, GBP, and Reddit access tiers, policies, limits, deadlines, quotas, permitted origins, retention, and approval evidence immediately before implementation and every certification renewal.
- [ ] Reverify n8n’s current MIT/verification/tooling/Node requirements, npm name availability, supported-version matrix, provenance support, and Creator Portal status before N8N-001/002/015 closure.
- [ ] Re-run clean Docker Compose and binary install, provider publishing, billing, MFA/recovery, and production browser checks from the older launch checklist where still open.

## Suggested delivery order

1. **Current trust and correctness first:** LEGAL-001/002/003, REL-001, PUB-001, JOB-001, NOTIF-001, SEC-001, BILL-001, APP-001.
2. **Run integration go/no-go work in parallel:** PROV-GATE-001, N8N-001/002, CONNECT-001. This creates no public provider/n8n availability claim.
3. **Before any new external write:** complete PROV-AUTH/AUTHZ/WRITE/MEDIA/READY P0 gates, then PROV-SELECT/TARGET/DELIVERY/CAP/PICKER/POLICY/RETENTION/LEASE/META/SCHEDULE.
4. **Open two independent extension lanes:** PROVIDER-001 + CONNECT-002–007 for operator-installed publishing connectors; N8N-003–010 for nodes installed and used inside n8n. Both consume shared application/API contracts but n8n does not use Connector Protocol.
5. **Add first-party providers:** PIN-001–004, then GBP-001–005 under its approved execution mode, then REDDIT-001–003 only after approved transport.
6. **Harden and expand:** PROV-HARDEN/QA; N8N-011–015; CONNECT-008/009. Keep advanced scopes/extensions behind demonstrated demand and certification.
7. **Paid-account and daily UX:** BILL-002–005, PRICE-001, TEAM-001/002, AUTH-001, ONB-001, EDIT-001/002, NOTIF-002–006, ACTIVITY-001, PERF-001, PUB-002/003.
8. **Product completeness and architecture:** account/public profile, API keys, version history, admin, public features/pricing/FAQ/error surfaces, then ARCH/DATA/COMPAT/BUILD/CI/OPS.
9. **Cleanup:** run P3 cohorts only after the behavior, migration, compatibility, and telemetry gates they depend on.

## Audit evidence limits

- The attached deep audit reported green repo lint/check, backend/CLI suites, 379 frontend tests, 25 video-project tests, reachability scans, and selected live route/image checks at the baseline SHA.
- It did **not** prove external API/MCP consumers, dormant-table production row counts, or a fresh mutation-heavy browser/build pass over the already dirty checkout.
- The later checklist and public-site review was source-grounded; production-only claims remain labeled user-reported or external verification.
- Checking an item means its specific “Done when” conditions are met, relevant product/docs/contracts are aligned, and deployed behavior is verified when the finding was live.
