# OpenPost audit remediation TODO

> Created: 2026-08-09
>
> Repository baseline: `50513cef3e1cd5e16efaf06d26a913beac686520`
>
> Last reconciled: 2026-08-15 against reviewed revision `b921c06b60b2a6da8faa3dd43299e1669a0d663f` (Unreleased).
>
> Scope: the application-checklist audit, the deep source/dead-code audit, the follow-up marketing/pricing/privacy/legal/billing review, the shared provider-kernel plan for Pinterest/Google Business Profile/Reddit, the approved operator-connector design for #32, and the installable `n8n-nodes-openpost` package plan. This is a remediation backlog, not a claim that every optional checklist pattern belongs in OpenPost.
>
> This reconciliation excludes unrelated worktree changes and does not treat uncommitted code as shipped. A user-supplied live observation is labeled as such; current-source findings should still be rechecked immediately before implementation.

The older launch checklist remains useful for clean-install and provider verification. It is not duplicated here unless the newer audits found a concrete defect or incomplete experience.

Inventory: **64 unfinished task headings**: **1 P0**, **10 P1**, and **53 P2**. The P2 set contains **14 Pinterest/GBP/provider-delivery tasks**, **10 other active improvements**, and **29 explicitly deferred Reddit/Connector/n8n tasks**. Completed and currently out-of-scope task headings have been removed. Nested implementation/certification checkboxes, product decisions, guardrails, and the external-verification queue are not separate task headings.

## Reconciled state and next work

The remaining backlog is not one equally urgent queue:

1. **Close the active privacy mismatch:** meme generation remains enabled by operator decision, so complete PRIV-001's processor, policy, retention, and disclosure evidence without treating runtime disablement as the remediation.
2. **Make Pinterest and GBP the primary feature stream:** start their independent access/policy gates, finish only the shared-kernel gaps each slice needs, and add the first-party registration path. Build Pinterest under Trial, obtain Standard before public production, then deliver GBP under its approved execution mode. Reddit, Connector Protocol, and n8n are deferred lanes and do not block this work.
3. **Finish the remaining acceptance and operator work:** MOBILE-001 still needs exact signed-artifact and device proof, and TRUST-001 needs operator evidence.
4. **Keep the remaining recovery boundary explicit:** local application recovery is complete. External status infrastructure remains deferred under STATE-001 and requires an operator-owned service outside the primary failure domain.
5. **Batch structural work deliberately:** ARCH-004/005, DATA-001–005, and BUILD-002 are valid debt, but should not interrupt the first safe Pinterest/GBP slice unless a dependency says otherwise.

About, global search, a generic wizard, and an integration marketplace are recorded product decisions, not assumed missing features. Unchecked operator rows still require evidence outside this repository.

## How to use this backlog

Priority means:

- **P0:** active security/privacy/data-integrity emergency, or a non-negotiable safety gate before enabling a new external-write path. PRIV-001 is the current P0 because managed external processing is enabled ahead of the matching disclosure/register boundary.
- **P1:** fix before the next broad release or paid-growth push. These affect correctness, account recovery, legal/trust accuracy, billing continuity, access control, or a core user journey.
- **P2:** planned product or engineering work. The feature exists but is incomplete, misleading, inefficient, or hard to maintain.

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

## P0 — active privacy and integration-expansion safety gates

PRIV-001 is an active managed-service disclosure/configuration mismatch.

### PRIV-001 — Disclose and govern managed meme processing

- [ ] **Problem — Active/operator evidence required:** managed configuration keeps `OPENPOST_MEME_GENERATOR_ENABLED=true` by operator decision. The production Memegen/OpenRouter processor, legal, routing, retention, ZDR, media-lease, and disclosure evidence is incomplete, so runtime availability currently leads the reviewed policy boundary.
- **Required remediation:** keep the feature's enabled state explicit; verify the configured services and data paths; complete minimization, expiry, no-secret-log, processor, transfer, and acceptance evidence; align Privacy, Trust, the operator register, and deployed behavior. Runtime disablement is not the selected remediation.
- **Done when:** managed configuration resolves to a reviewed private service or a fully disclosed processor; captions, ideas, recipes, and media leases have tested minimization/expiry/no-secret-log behavior; provider-side terms and OpenRouter routing/ZDR evidence are recorded; public policies, the operator register, acceptance metadata, and deployed behavior agree with the enabled feature.
- **Evidence:** `/Users/rgo/.config/home/hosts/rgo-vps/default.nix`, `docs-site/configuration/environment-variables.md`, and `docs-site/configuration/production-checklist.md`. Declarative configuration resolves the managed value to `true`; processor and disclosure verification remains open.

## P1 — release, correctness, recovery, billing, and trust

### TRUST-001 — Publish managed-cloud residency, subprocessors, and human-access facts

- [ ] **Problem — Partial/operator evidence required:** a dated managed-service register and public Trust page cover the recorded providers, residency, data categories, transfer statements, human-access boundary, change notice, and review dates. Managed Memegen remains enabled and must be covered by PRIV-001's evidence and disclosures. The Purelymail transfer mechanism and operational access approval, logging, review, and revocation evidence remain unproved.
- **Fix:** obtain and record the remaining Purelymail transfer/legal basis; verify role approval, access logging, emergency access, review, and revocation evidence; keep the register current before any new managed processor receives data.
- **Done when:** every current managed store/provider has a reviewed transfer entry and date; internal access evidence matches the public boundary; no unsupported certification, GDPR, or audit badge is added.
- **Evidence:** `marketing-site/src/routes/trust/+page.svelte`, `packages/legal-policy/src/managed-service.json:92`, `packages/legal-policy/src/security-assurance.json`.

### MOBILE-001 — Publish and prove an installable Android candidate

- [ ] **Problem — Partial/release acceptance required:** candidate CI builds the standalone Expo app and the release workflow fails instead of publishing an unsigned APK as the installable asset. The exact published signed APK still needs install/certificate/version/revision and native lifecycle/permission/restore proof in candidate/release automation and on the bounded device matrix.
- **Fix delivered locally:** make `mobile/` the only Android app, remove the obsolete web wrapper, build and check the Expo candidate in CI, retain its SHA-256 digest, require the signing secret, sign and verify the same candidate bytes, and align installation docs and release-contract tests. Complete exact-byte emulator/device acceptance in the release lane before checking this item off.
- **Done when:** the release matrix installs the exact published signed artifact, asserts its certificate/package/version/revision, and fails or omits Android publication when signing is unavailable; native navigation, permission, deep-link, or restore regressions fail without rebuilding different application bytes.
- **Evidence:** `mobile/app.json`, `mobile/plugins/with-android-release-signing.js`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `docs-site/installation/android.md`.

### Shared provider kernel — required before new provider delivery

### PROV-SELECT-001 — Normalize asynchronous destination discovery

- [ ] **Problem — Current source/missing:** OAuth callback discovery is still eager, stores the whole list in one expiring `OAuthAccountSelection` JSON blob, and exposes `AccountSelectionAdapter` as an all-at-once slice. It has no normalized paging, background progress, resumable cursor, or generic completion transaction for large GBP account/location sets.
- **Fix:** add normalized selection-session/options tables with state, progress, cursor, totals, errors, policy mode, selection/entitlement limit, expiry, consumed/version fields, safe display values, encrypted internal references, eligibility/reason, and provenance. Discover in background; finish with one CAS transaction that enforces entitlement, creates accounts, and consumes the session.
- **Done when:** large sets page/search/resume safely, direct/expired/canceled returns are clear, concurrent completion cannot create duplicate identities or seats, and DB uniqueness covers workspace/provider/effective built-in app-project-instance identity/external identity. Deferred connector installation IDs may later occupy the same typed identity slot; this task does not depend on CONNECT-002.
- **Evidence:** `backend/internal/models/models.go:920`, `backend/internal/platform/adapter.go:536`, `backend/internal/api/handlers/oauth.go`, `frontend/src/routes/accounts/callback/+page.svelte`.

### PROV-TARGET-001 — Give every provider subdestination its own rendition

- [ ] **Problem — Partial:** migration and API work make `target_key` a first-class rendition identity, but a prefixed caller-provided target is not yet derived from or checked against the provider destination setting that controls the external write. Authorization and delivery can therefore name an identity that the adapter has not independently bound to its settings.
- **Fix delivered:** migration 088 adds and backfills normalized `target_key`, replaces account-only uniqueness with publication + account + target, carries the target through REST/generated contracts, snapshots authorization identity, and makes upsert/retry/delete target-aware. Legacy Mastodon renditions retain their instance-qualified target.
- **Remaining:** define the canonical target-bearing capability field, derive or validate the target identity from normalized destination settings, and pass the bound identity through adapter execution and reconciliation.
- **Done when:** each target has its own authorization, external ID, delivery state, retry/manual-resolution, and partial-failure outcome; no hidden loop publishes to several boards/communities inside one rendition.
- **Evidence:** `backend/internal/database/migrations/088_rendition_targets.sql`, `backend/internal/database/migrations/rendition_targets_test.go`, `backend/internal/api/handlers/publications.go`, `backend/internal/services/publicationauth/snapshot.go`, `backend/internal/api/handlers/publications_renditions_test.go`; focused SQLite/handler/authorization tests and generated contracts pass, with the Postgres migration regression enabled when its test URL is configured.

### PROV-CAP-001 — Expand capability and cross-field validation contracts

- [ ] **Problem — Partial:** the shared schema and validator can express structured content/media constraints, and cached rules cannot cross target-setting boundaries. Production provider catalogues do not yet populate the new content, dimension, codec, frame-rate, audio, or local-time constraints, so real provider payloads and every transport have not demonstrated the required parity.
- **Fix delivered:** added required/min/max/recommended title, body, description, and alt-text rules; hard dimension, codec, frame-rate, and audio rules; local date/time semantics; and media analysis inputs. The resolver cache identity includes account, target settings, profile, intent, media shape, locale, and region using canonical JSON hashing, and the composer sends destination alt text through the same contract.
- **Remaining:** populate the applicable constraints from current certified provider contracts and add REST, browser, MCP, and CLI parity tests for representative real providers and cross-field failures.
- **Done when:** backend, browser, REST, MCP, and CLI reject the same invalid payload; community/location/account rules cannot leak from a stale cache; unsupported schema combinations fail closed.
- **Evidence:** `backend/internal/capabilities/capabilities.go`, `backend/internal/capabilities/capabilities_test.go`, `backend/internal/api/handlers/capability_resolver.go`, `backend/internal/api/handlers/capability_resolver_test.go`, `frontend/src/lib/components/compose-text-post.svelte`; focused backend tests, generated contracts, Svelte autofixer, and frontend checks pass.

### PROV-POLICY-001 — Enforce provider execution mode at enqueue and execution

- [ ] **Problem — Partial/policy gate:** authorizations persist policy fields and readiness is rechecked, but there is no complete execution-mode vocabulary bound to the OAuth grant, authorization origin, enqueue decision, and worker execution. Hiding UI/API controls cannot enforce a provider restriction that changes before delivery.
- **Fix:** extend the existing readiness/authorization policy with enforceable execution modes such as `disabled`, `interactive_only`, `authorized_delayed`, and `owner_project_full`; keep written approval, reviewed operations/origins, owner, and expiry as evidence that selects an allowed mode rather than treating evidence as a runtime mode. Check the allowed operation/origin at authorization/enqueue and immediately before the external write instead of creating a second policy subsystem.
- **Done when:** a policy change after scheduling blocks delivery safely, records an actionable audit event, and applies equally to browser, REST, MCP, CLI, repost, and worker origins.
- **Evidence:** `backend/internal/models/models.go:1440`, `backend/internal/services/providerreadiness`.

### PROV-RETENTION-001 — Enforce provider-aware provenance, expiry, and deletion

- [ ] **Problem — Partial:** provider-deleted engagement now scrubs body, author identifiers/profile fields, attachment metadata, and write capabilities for both sync-reported and locally completed deletion. A universal provenance/expiry/allowed-use/purge contract and expiry/revoke/disconnect enforcement across analytics, communications, and future discovery data are still missing.
- **Fix:** attach `fetched_at`, `expires_at`, provider/source, allowed use, and purge policy; keep restricted data out of immutable/aggregated stores; scrub body, author, and attachment fields on provider deletion.
- **Done when:** expiry, revoke, disconnect, and provider-deletion cascade tests prove timely removal and no forbidden aggregation; legal/public retention copy can cite implementation evidence.
- **Evidence:** `backend/internal/services/communications/service.go`, `backend/internal/services/communications/service_test.go`; provider-deletion regression coverage and the full backend suite pass. Provenance/expiry work remains open.

### PROV-LEASE-001 — Issue stable, scoped provider media leases

- [ ] **Problem — Current source/missing:** public media URLs still expire after 15 minutes and readiness relies largely on HEAD. There is no provider/object/operation scope, delayed-GET/range proof, or terminal revocation. Pinterest video covers and GBP `sourceUrl` images depend on this.
- **Fix:** create provider/object/operation-scoped leases long enough for the certified processing window, revocable at terminal state or retention expiry; verify delayed GET, redirects, MIME, length, dimensions, and range support.
- **Done when:** delayed-fetch live tests pass for every claimed provider/media workflow and a connector/provider cannot access unrelated library media.
- **Evidence:** `backend/internal/services/publicurl/media.go:16`.

### PROV-META-001 — Generate one provider metadata and certification catalogue

- [ ] **Problem — Partial:** provider identity, applications, capabilities, readiness, icons, docs, and public claim lists remain separate/static sources. Existing checks compare some duplicated sets but do not generate one canonical provider/certification catalogue.
- **Fix:** make this the canonical generated public/certification fact catalogue containing stable identity, supported/approved formats, approval tier, execution policy, certification age, and actionable degraded state; keep healthy state quiet. PROV-FIRSTPARTY supplies built-in registration input, while deferred PROVIDER-001 consumes that same identity input into its runtime installation snapshot rather than defining parallel facts.
- **Done when:** app, docs, marketing, readiness, CLI/MCP, and release checks cannot disagree; no second catalogue/registry owns conflicting provider facts; no custom provider ID is inferred by splitting its string.

### PROV-FIRSTPARTY-001 — Add one complete first-party provider registration path

- [ ] **Problem — Current architecture gap:** adding Pinterest or GBP still requires coordinated edits across provider constants/builders, provider-app administration, OAuth routing, capabilities/readiness, account presentation, docs, public catalogues, i18n, generated contracts, and release proof. The connector-oriented PROVIDER-001 does not supply this built-in onboarding path.
- **Fix:** adopt the canonical typed descriptor defined by PROV-META and add one first-party registration workflow consumed by those surfaces, while keeping secret-bearing implementations internal. Use it for Pinterest and require GBP to follow it; preserve provider-specific OAuth, validation, policy, and publishing code inside `internal/platform` and the appropriate services.
- **Done when:** one built-in can register end to end through the reviewed boundary and every later first-party provider is required to adopt it; missing app credentials or certification stay quiet/actionable rather than appearing available; contracts, app UI, docs, marketing, privacy, and release checks cannot omit a newly enabled provider. This is the built-in registration input to PROV-META and, later, PROVIDER-001—not a parallel runtime registry or public catalogue.
- **Dependencies:** PROV-META-001 and the relevant policy/capability/selection tasks; this does not depend on Connector Protocol or n8n.

## P2 — first-party provider priority and deferred extension lanes

These are three distinct products sharing foundations:

- **First-party providers:** Pinterest, Google Business Profile, and conditional Reddit adapters delivered by OpenPost.
- **Operator connectors:** provider-like services installed by a self-hosting operator and reached through Connector Protocol v1.
- **n8n nodes:** a generated `n8n-nodes-openpost` package that users install **inside n8n**; it calls OpenPost’s curated REST API. It is not a provider adapter, MCP client, or in-app marketplace.

Implementation order:

1. Start PIN-GATE-001 and GBP-GATE-001 independently; access work can run while the shared code foundations are built. Pinterest Trial approval enables implementation, while Standard approval is a later public-production gate.
2. Complete PRIV-001 and keep the shipped P0 foundations green, then build the minimum shared P1 set for the slice: PROV-FIRSTPARTY plus TARGET/DELIVERY/CAP/PICKER/POLICY/RETENTION/LEASE/META. SELECT is required before large GBP discovery; SCHEDULE is required before GBP native scheduling, not before immediate publishing.
3. Ship Pinterest: OAuth/boards/sections and image Pins, then the durable video pipeline, then certification and later depth.
4. Ship GBP: approved hosted/owner-project policy, account/location discovery, immediate Standard/Event/Offer image posts, then native one-off/recurring schedules only after policy approval and PROV-SCHEDULE.
5. Apply PROV-HARDEN/QA and enable public claims only from current live evidence.
6. Treat Reddit, Connector Protocol, and n8n as deferred independent lanes. They remain valid plans but do not block Pinterest or GBP.

The section order below keeps each existing specification readable; it is not the execution priority. Do not start connector/n8n implementation merely because those sections appear before the first-party provider sections.

### Phase 0 — access, policy, license, and feasibility gates

### PIN-GATE-001 — Stage Pinterest Trial development and Standard production approval

- [ ] Obtain Trial access and current storage/use permission before implementation; record the business account/app owner, approved scopes/use case, quota/rate-limit evidence, and certification renewal owner. Build and certify the Trial integration needed for Pinterest’s demo/review without presenting Trial entities as production support.
- [ ] After the Trial implementation can demonstrate OAuth and the intended Pin flows, apply for and obtain Standard access before public production, public claims, or non-Trial customer use.
- [ ] Obtain and record current permission for the operational board, section, Pin, upload, reconciliation, and analytics identifiers OpenPost must store; define revocation/deletion handling and the PROV-POLICY-001 mode.
- **Done when:** the dated Trial and Standard evidence has an owner and review/expiry date, Trial-only entities cannot be advertised as public, and Pinterest production can proceed without waiting for GBP or Reddit.
- **External references reviewed 2026-08-12:** [access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/), [OAuth and token refresh](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/), [organic Pin guide](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/), and Pinterest’s [official current OpenAPI](https://github.com/pinterest/api-description/blob/main/v5/openapi.json) for request variants and success responses.

### GBP-GATE-001 — Obtain GBP access and a written execution-policy decision

- [ ] Create a dedicated Organization-owned project separate from YouTube; satisfy the verified active-profile/website prerequisites; secure Business Profile API approval/quota and OAuth verification; request only `business.manage`; record that Google provides no sandbox.
- [ ] Obtain written clarification for the hosted human-present publish-now and native schedule flows, delayed automation/reconciliation, token refresh, API/MCP/CLI origins, and owner-project/self-hosted tenancy. Map each approved origin to PROV-POLICY-001 rather than inferring permission from API reachability.
- **Done when:** approval, scopes, execution modes, retention obligations, owner, date, and review/expiry are recorded, and the GBP lane can proceed without waiting for Pinterest or Reddit.
- **External references reviewed 2026-08-12:** [prerequisites](https://developers.google.com/my-business/content/prereqs), [third-party/retention policy](https://developers.google.com/my-business/content/policies), [Local Posts resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts), [2026 scheduling changes](https://developers.google.com/my-business/content/change-log), [Q&A discontinuation](https://developers.google.com/my-business/content/qanda/change-log).

### REDDIT-GATE-001 — Defer Reddit until its transport is approved

- [ ] When Reddit becomes a priority, obtain written decisions on commercial/delayed user-attributed publishing, Data API versus Devvit, media, community rules/flair, engagement, retention, and API/MCP/CLI/repost origins. Never use cookies, passwords, or browser-session authentication.
- **Done when:** the transport and policy have dated owner/evidence and an enforceable PROV-POLICY-001 mode. This deferred gate does not block Pinterest or GBP.

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

### Deferred lane 2A — operator-installed connector platform

### PROVIDER-001 — Centralize provider identity and optional capabilities

- [ ] Split mandatory `platform.Adapter` responsibilities into small optional capabilities so API/webhook connectors do not fake OAuth/profile/media methods.
- [ ] Create one immutable runtime `ProviderRegistry` snapshot containing opaque stable provider ID, built-in family/installation identity, sanitized display metadata, availability/health, connection modes, optional operations, publishing capabilities/revision, and internal capability implementations. Consume built-in identity/certification inputs from PROV-FIRSTPARTY/PROV-META; do not create a competing public fact catalogue.
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
- **Dependencies:** CONNECT-003 and PROV-SELECT-001.

### CONNECT-005 — Implement connector publishing, polling, and scoped media

- [ ] Derive deterministic `operation_id` from rendition/segment/phase; send connection reference, intent/profiles, manifest revision, content/title/description/reply target, validated settings, and ordered media descriptors.
- [ ] Accept `published`, `pending`, structured failure, or persisted `unknown`; require connector-side journaling before an external write; reuse operation IDs across restart/retry.
- [ ] Serve operation-scoped media URLs with MIME, size, filename, alt text, digest, and relevant thumbnail/caption descriptors. Never send base64 or broad media-library access.
- **Done when:** timeout-after-write cannot duplicate, pending/partial threads survive OpenPost/connector restart, large-media cancellation/authorization passes, and OpenPost remains canonical publication/media owner.
- **Dependencies:** PROV-WRITE-001, PROV-LEASE-001, PUB-001, ARCH-004, and CONNECT-002–004.

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

### Deferred lane 2B — generated nodes installed and used inside n8n

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
- [ ] Generate declarative routing, fields, documentation tables, and selected-contract snapshots into committed clearly marked files; run from `bun run check -- contracts` with semantic checks for removal, new required fields, type changes, and enum narrowing.
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

- [ ] Keep npm SemVer independent of OpenPost app SemVer; require a package version increase for publishable changes; publish from the app release only after exact production readiness; change n8n `typeVersion` only for saved-workflow behavior; use GitHub trusted publishing/npm provenance; submit through Creator Portal.
- [ ] Update README, docs, roadmap, surface-parity table, marketing, and `CHANGELOG.md` only after install/current-version/Creator Portal availability is verified.
- **Done when:** provenance is verifiable, supported installs pass, portal status is recorded, and public claims match actual package availability.

### Phase 3 — Pinterest first-party integration

### PIN-001 — Connect Pinterest and discover boards/sections at scale

- [ ] Use the shared grant with minimum approved scopes, the current 30-day access-token and 60-day continuously refreshable refresh-token expiries, atomic rotation, full board cursor pagination (including very large accounts), lazy section loading, search, and one board/optional section per targeted rendition.
- [ ] Cache only provider-permitted operational data with provenance/expiry and revoke/disconnect cleanup.
- **Done when:** Trial and Standard OAuth/refresh/revocation and selection are certified, creator-only Trial entities cannot be presented as production proof, large-board accounts do not eager-load, and a board/section cannot be confused with another target.

### PIN-002 — Ship image and multi-image Pins before video depth

- [ ] Support one image or the current 2–5-image `multiple_image_base64`/`multiple_image_urls` schema, board/optional section, title, description, destination link, alt text, the current AI-content disclosure field, a neutral vertical preview, and explicit per-Pin authorization. Confirm how per-item alt text and media ownership behave before advertising multi-image depth.
- [ ] Accept the current documented `200` or `201` success response only with a valid Pin ID; take title/description/alt/link/media rules from the approved organic contract, Pinterest’s current OpenAPI, and live tests. Do not import carousel labels or limits from advertising/catalog endpoints.
- **Done when:** server/client/API/MCP/CLI validation agrees and Trial plus Standard live evidence covers every advertised single- or multi-image format without imitating Pinterest UI.

### PIN-003 — Build a durable Pinterest video pipeline

- [ ] Implement validate/prepare → register upload → upload → poll media → create Pin → reconcile. Generate a real JPEG cover and expose it through a stable provider lease; certify base64/key-frame alternatives before relaxing it.
- [ ] Retry only contract-safe registration/upload/poll failures; final Pin create is non-idempotent, so timeout becomes ambiguous/manual reconciliation rather than automatic recreation.
- **Done when:** crash/timeout/restart tests and Trial + Standard live evidence prove no duplicate final Pin and correct cover/media cleanup.

### PIN-004 — Add Pinterest depth only after certification

- [ ] Separately add edit/delete, provider status refresh, revocation/deletion cleanup, and analytics subject to written storage permission. Treat board creation as a separate deliberate operation.
- **Done when:** each operation has lifecycle, retention, authorization, ambiguity, and live-test evidence.

### Phase 4 — Google Business Profile, policy-restricted

### GBP-001 — Separate hosted-interactive and owner-project execution modes

- [ ] Keep hosted execution `disabled` until a dated policy decision is recorded. If written clarification permits the intended human-present flow, enable only `interactive_only`: manual sign-in, connect/discover, and browser-initiated publish-now. Permit a Google-native scheduled/recurring post while the user is present only when that exact flow is approved; no delayed OpenPost worker, MCP/CLI, repost, blind refresh/retry, or automatic reconciliation by inference.
- [ ] An independently approved operator-owned project may use `owner_project_full`; do not launch hosted BYO project tenancy without policy clarification.
- **Done when:** PROV-POLICY-001 enforces the approved mode server-side and UX/docs accurately state what each deployment can do.

### GBP-002 — Discover and select eligible locations asynchronously

- [ ] Use Account Management v1 and Business Information v1 to page accounts and locations; retain canonical full resource names and parent context, deduplicate a bare location reached through several parents, and check local-post eligibility, closure/duplicate state, access, and voice-of-merchant. Show only safe title/address/store code/parent label plus disabled reason.
- [ ] Apply PROV-RETENTION-001 before storing Google-returned content: no more than 30 calendar days, secure storage, no prohibited manipulation or aggregation, and prompt disconnect/revocation cleanup.
- **Done when:** progress/cancel/resume/search/paging/net-new entitlement counting work at desktop/phone/320 px, concurrent completion cannot duplicate a location, and expiry tests remove restricted data without losing OpenPost-owned publication history.

### GBP-003 — Implement a conservative post/validation surface

- [ ] Support Standard, Event, and Offer; one leased HTTPS `sourceUrl` image first; language; Book/Order/Shop/Learn More/Sign Up/Call CTAs; local/all-day intervals; offer coupon/redemption URL/terms.
- [ ] Enforce complete Event/Offer intervals, Call without URL, Offer-specific semantics, prohibited body phone numbers, and any current location/category restrictions confirmed by the approved contract and live tests. Treat 1,500 characters as guidance until live certification; do not invent a 4,096-byte rule or encode an unverified lodging exception.
- **Done when:** the provider validator registry and every client surface agree on all cross-field rules.

### PROV-SCHEDULE-001 — Make native-provider scheduling a real execution path

- [ ] **Problem — Current source/missing, later GBP depth:** native scheduling exists only as catalogue metadata. There is no creation/edit/reschedule/cancel/reconciliation lifecycle. GBP now exposes `scheduledTime` and recurring posts, but this work is not required for the immediate-only Pinterest/GBP slices and becomes a gate only before advertising native scheduling.
- **Fix:** define immediate creation of a provider-native scheduled resource, durable external identity, ambiguity rules, policy enforcement, edit/reschedule/cancel, and status reconciliation.
- **Done when:** “native scheduled” describes provider state rather than a label; user and audit history distinguish it from a future OpenPost worker job; GBP-004 cannot ship or be advertised before this passes.

### GBP-004 — Preserve Google delivery, ambiguity, and native schedule state

- [ ] Distinguish queued/submitted OpenPost state from Google `PROCESSING`, `SCHEDULED`, `RECURRING`, `LIVE`, `REJECTED`, and outcome unknown. A complete `429` is definite quota; timeout/EOF/crash/malformed success/missing resource name is ambiguous.
- [ ] Never auto-bind a guessed list match, recreate, or show generic Retry for ambiguity; offer bounded possible matches for manual resolution. After policy approval and PROV-SCHEDULE-001, support top-level `scheduledTime`; compatible Event/Offer shapes may use recurrence nested under `event`. Include edit/reschedule, cancel/delete, and reconciliation as provider-native resources.
- **Done when:** harmless owned-location live tests prove delayed image fetch, exact state transitions, one-off and recurring schedule lifecycles, cleanup, and manual ambiguity resolution.

### GBP-005 — Add approved GBP depth separately

- [ ] After the core retention contract is already enforced, separately approve/certify one-attempt review-reply update/delete, local-post insights, nonaggregating retention-aware Performance analytics, and a real `mediaFormat=VIDEO` experiment. This manages the business owner’s reply; it never deletes a customer review.
- **Done when:** each later capability has specific consent/policy approval, retention/lifecycle implementation, and live evidence. Do not add a GBP Q&A roadmap; Google discontinued that API on 2025-11-03.

### Deferred lane 5 — Reddit, conditional on transport approval

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

- [ ] X: tier/format certification and ambiguity; Mastodon: representative versions/dynamic per-instance limits; Bluesky: media/replies/app-password failure; LinkedIn: certify shared-grant multi-destination refresh/revocation plus organization/media behavior without restoring provider-specific account special cases.
- [ ] Threads: stable media/processing/reply deletion/inbox; Facebook: review/video/multi-photo semantics; Instagram: container/rejection/public-media/Pages discovery; TikTok: Direct vs Inbox/approval/disclosure/reconciliation.
- [ ] YouTube: durable thumbnail/playlist/caption child operations, processing/copyright/rejection, and shared-channel grant certification; Discord: webhook-secret rotation, probing, explicit send-only limits, and webhook/server/channel-specific live certification through the existing readiness path.
- **Done when:** every public provider/format claim maps to current PROV-READY-001 evidence and the same delivery/policy/retention model.

### PROV-QA-001 — Make provider certification a release gate

- [ ] Automated: exact endpoints/scopes/payloads/parsing, all validation, safe errors, pagination/quota, SQLite/Postgres migration, refresh/selection concurrency, every crash boundary, no replay of ambiguity, retention/revoke cascades.
- [ ] Browser: OAuth progress/resume/expiry, paged pickers/dependencies, all lifecycle states, target errors, desktop/phone/320 px, keyboard/touch/overflow/console.
- [ ] Opt-in live: provider-scoped Pinterest Trial/Standard, verified owned GBP, and—only when its deferred lane starts—an approved Reddit test community, plus a maintained claimed-format matrix for existing providers.
- [ ] Release: approval/policy/live proof/revocation/retention/ambiguity, per-provider kill switches, quota/error monitoring, and agreement across app/contracts/API/MCP/CLI/docs/marketing/privacy/config/i18n/`CHANGELOG.md`.
- **Done when:** advertising a provider or format is mechanically blocked until that provider’s required evidence is current. The shared machinery and Pinterest evidence can close the Pinterest release gate without GBP or deferred Reddit proof; later providers add their own required certification rows.

## P2 — application UX and product completeness

### Recovery boundary

### STATE-001 — Add external maintenance and outage status

- [ ] **Problem — External infrastructure deferred:** local loading, retryable request, offline, forbidden, not-found, server-error, and destructive-failure states now have distinct recovery, focus, announcement, and responsive behavior. OpenPost does not yet have an operator-owned status service outside the primary failure domain or runtime signals for scheduled maintenance and broad unplanned outages.
- **Fix:** retain the completed local recovery boundaries. When an external status service has an owner and operating plan, add dependency-aware maintenance signals, a last-updated time or ETA when one is known, and a status link that remains reachable during a primary outage.
- **Done when:** scheduled maintenance and broad unplanned outages have truthful server/runtime signals and point to an independently reachable status path; local HTTP status and recovery behavior remain unchanged.
- **Evidence:** `docs/evidence/application-state-recovery-browser-matrix.md`, `frontend/src/routes/+error.svelte`, `marketing-site/src/routes/+error.svelte`, and `marketing-site/static/404.html`. External status infrastructure remains deferred by the complete UX program.

## P2 — architecture, data retirement, build, and operations

### ARCH-004 — Finish a shared application command/query boundary

- [ ] **Problem — Partial:** the MCP handler remains about 6,024 lines. Publication create/update/validate/schedule/publish now delegate through the shared publication application boundary, but legacy posts, media, billing, communications, and several query/persistence paths still live in transport code and can drift across HTTP/MCP/CLI.
- **Fix:** continue moving those remaining use cases into shared command/query services; keep transports responsible only for auth, decoding, schema, and response mapping.
- **Done when:** no adapter duplicates persistence/defaulting/job logic; adapter parity tests exercise the same use cases and authorization rules.
- **Evidence:** `backend/internal/api/handlers/mcp.go:1`, `backend/internal/api/handlers/mcp.go:3329`, publication application services.

### ARCH-005 — Split the text-and-thread composer into state-owned feature modules

- [ ] **Problem — Current architecture gap:** `compose-text-post.svelte` is roughly 5,789 lines and combines draft lifecycle/conflicts, destinations/capabilities, variants, media/alt text/editor handoffs, scheduling, publishing, and most rendering. Changes to one concern carry a large regression surface and make independent tests difficult.
- **Fix:** extract cohesive state-owning controllers/components behind one orchestration shell: draft lifecycle, destinations/capabilities, rendition variants, media/editor handoff, schedule/publish, and presentation. Prefer explicit instance-local state and typed callbacks/services; do not replace the monolith with global stores or break multiple simultaneous composers.
- **Done when:** each domain has focused tests, the shell coordinates rather than implements, multi-instance/workspace isolation remains correct, and browser coverage preserves autosave/conflict recovery, target errors, media handoff, scheduling, and publish behavior.
- **Evidence:** `frontend/src/lib/components/compose-text-post.svelte:1`.

### DATA-001 — Retire legacy media collections only after protection-path migration

- [ ] **Problem — Current source:** migration 062 moved collections to tags, but collection tables/models remain in fresh bootstrap and media lifecycle cleanup still reads `media_collection_items`/`media_collections` to protect referenced media. They are compatibility state, not unreachable schema.
- **Fix:** inventory production rows; prove tags or another canonical relation preserve every live collection reference; migrate/remove the cleanup protection branch only after equivalent ownership coverage; then drop tables/models through a forward migration with backup and rollback instructions.
- **Done when:** supported historical databases migrate without loss, protected media remains protected, fresh schema omits the tables, row/checksum evidence is recorded, and rollback is rehearsed.
- **Evidence:** `backend/internal/models/models.go:1868`, `backend/internal/database/database.go:125`, `backend/internal/services/medialifecycle/service.go:576`.

### DATA-002 — Disposition `publication_assets` with zero-loss proof

- [ ] **Problem — Current source:** no current authoring writer remains, but media lifecycle cleanup still reads and deletes `publication_assets` relations to protect historical media references. It cannot be treated as unreachable schema.
- **Fix:** inventory deployed rows; map every live relation to canonical segment/rendition media or a documented retained archive; prove equivalent cleanup protection and remove that compatibility branch before dropping the table through a forward migration.
- **Done when:** every row has a disposition, upgrade tests cover populated historical fixtures, canonical ownership protects the same media, and no application path depends on the table.
- **Evidence:** `backend/internal/models/models.go:1969`, `backend/internal/database/database.go:112`, `backend/internal/services/medialifecycle/service.go:650`, `backend/internal/services/medialifecycle/service.go:978`.

### DATA-003 — Remove `posting_schedules.set_id` through a forward migration

- [ ] **Problem — Baseline audit:** the column is explicitly legacy and unused.
- **Fix:** confirm zero readers/writers, migrate supported databases, remove model/contract remnants, and retain historical migration files.
- **Done when:** fresh and upgraded schemas agree and migration regression tests pass.
- **Evidence:** `backend/internal/models/models.go:2014`, `backend/internal/database/database.go:132`.

### DATA-004 — Stage removal of duplicate publication fields

- [ ] **Problem — Baseline audit:** `SourceContent` mirrors `SourceText`, and `ReleasePlanJSON` mirrors `MetadataJSON`.
- **Fix:** nominate canonical fields; migrate readers; backfill and compare; stop dual-write; observe for a release window; then drop via forward migration.
- **Done when:** comparison telemetry shows no divergence, old-version upgrade fixtures survive, and generated contracts no longer expose retired fields.
- **Evidence:** `backend/internal/models/models.go:953`, `backend/internal/models/models.go:962`.

### DATA-005 — Decide the dormant organization-invitation model

- [ ] **Problem — Current source audit:** `organization_invitations` is created, bootstrapped, and cleaned up, but the active team flow uses workspace invitations and no complete organization-invite product consumes the schema.
- **Fix:** decide whether organizations need organization-wide membership/invites distinct from workspace access. If yes, implement one coherent lifecycle and permission model; if no, inventory rows and remove the schema through a forward migration.
- **Done when:** there is no dormant second invitation concept, existing rows have a zero-loss disposition, and workspace/organization membership semantics are documented and tested.
- **Evidence:** `backend/internal/models/models.go:118`, `backend/internal/database/database.go:78`, `backend/internal/database/migrations/025_organizations_and_profiles.sql:22`.

### BUILD-002 — Replace marketing’s frontend-source alias with real packages

- [ ] **Problem — Baseline audit:** marketing aliases all of `frontend/src/lib`, imports frontend CSS, and writes generated Paraglide output into frontend source, bypassing package boundaries and Turbo inputs.
- **Fix:** expose supported UI/theme/i18n APIs through declared workspace packages; keep generated output within its owner; migrate imports without visual drift.
- **Done when:** no package writes into another package’s source, dependency graphs are explicit, cache invalidation works, and app/marketing UI checks pass.
- **Evidence:** `marketing-site/svelte.config.js:11`.

## P2 — public product, pricing, legal clarity, and proof

### LEGAL-005 — Revalidate Paddle and managed-service legal assertions

- [ ] **Problem — Partial/external verification required:** managed PostHog configuration, Privacy policy version `2026-08-11`, and Trust review date `2026-08-11` are verified. Merchant-of-Record status, tax/customer documents, refund/withdrawal rules, portal/cancellation behavior, controller identity, and legal review of the material-change process still cannot be proven from repository source alone. TRUST-001 separately owns the Purelymail transfer basis and operational human-access evidence.
- **Fix:** review the live Paddle account/config/contracts, controller evidence, and applicable legal advice; consume approved TRUST-001 facts where public legal copy depends on them; record owner/evidence/review date; update Terms/Privacy/Refunds, Trust, and billing UX together where facts change.
- **Done when:** every assertion has current provider/deployment/legal evidence and a named review owner; checkout and portal behavior match the documents.
- **Evidence:** `marketing-site/src/routes/terms/+page.svelte:161`, `marketing-site/src/routes/refunds/+page.svelte:40`, `marketing-site/src/routes/privacy/+page.svelte:205`.

## Explicit product decisions and non-actions

These checklist rows are not open defects unless the product decision changes:

- **Global search:** keep permission-safe scoped search, filters, and paging. Validate a cross-entity discovery need before building a global index/results surface.
- **Generic integrations marketplace:** CONNECT approves self-hosted operator-installed publishing connectors and N8N approves nodes used inside n8n. Neither approves a public in-app marketplace, categories, request form, or arbitrary tenant-supplied endpoints.
- **Generic save-and-resume wizard:** the first-use journey resumes from authoritative product state. Extract broader wizard infrastructure only when a genuinely long form needs it.
- **About page:** do not create generic mission/team/backer copy. Add a route only after operator-approved names, roles, timeline, company/contact facts, imagery permissions, and update ownership exist.
- **Remember me:** keep the current fixed persistent-session model or implement real alternative lifetimes; do not add a cosmetic checkbox.
- **SMS/email MFA:** TOTP plus passkeys provide strong method choice. Do not add weaker or costly channels just to satisfy a generic checklist; add a method only after threat, deliverability, recovery, and operating-cost review.
- **Public-profile contact/follow:** do not add it until OpenPost has a supported messaging/follow model. Never expose email by default.
- **Enterprise/contact sales:** add only when there is an operator-owned sales/support process and a real custom plan. Do not relabel Agency as Enterprise without facts.
- **Login testimonials/news:** keep login focused. Add proof content only if it is verified, optional, responsive, and does not distract from authentication.
- **Phone number/job title:** do not collect extra account fields without a concrete product, support, or legal purpose and retention rule.
- **Account deactivation:** add a reversible pause only if it has a defined effect on billing, scheduled publications, shared ownership, and data visibility; the existing permanent-deletion flow should not be weakened to satisfy a generic checklist.

Do not delete or rewrite these merely because they look old or unused:

- `/studio` and `/video-studio` redirects; `/posts/[id]`; `GET/DELETE /posts`; `/posts/thread`.
- historical/no-op migrations; use new forward migrations.
- generated OpenAPI, Paraglide, CLI docs, social catalogues, or embedded frontend output.
- ONNX declarations/models, dynamically imported lossless-export workers, or runtime asset manifests.
- intentional transitive pins such as `estree-walker` and `svelte-toolbelt` without rechecking their recorded reason.
- capability-asserted provider adapters/interfaces and navigation-menu primitives reached through dynamic/shared imports.
- the `/prompts` backend/random API.
- Alpine solely because it is old; OPS-001 is maintenance hardening, not a proven vulnerability claim.
- current dynamic marketing routes/sitemap entries without a fresh mismatch; the baseline audit found the sets equal.

Integration/provider guardrails:

- Never build Pinterest, GBP, or Reddit as isolated one-off systems; they consume the shared grant/authorization/write/delivery/capability/policy/retention kernel.
- Allocate the next free migration number at implementation time; earlier proposal numbers are stale because this reconciliation already includes migration `084`.
- Never store raw provider responses or tokens in authorization/delivery/certification records, blindly replay an ambiguous write, auto-bind a guessed GBP result, or hide multi-board/community loops inside one rendition.
- Keep provider previews neutral and OpenPost-native; do not imitate Pinterest, Google Search/Maps, or Reddit UI.
- Do not enable hosted GBP delayed automation, native schedules/recurrence, video, or BYO-project tenancy without the exact approved execution mode; do not add GBP Q&A because Google discontinued it. Never use Reddit cookie/password/session auth, bulk multi-community publishing, or autonomous reposts, or import Pinterest advertising-derived formats/limits into organic publishing without current approval and certification.
- Do not copy Postiz provider implementations wholesale. Postiz and Shoutrrr remain behavioral references only.
- Never load Go `.so` plugins, run Playwright inside OpenPost, let hosted tenants register endpoints, put executable code/inline secrets in connector config, let manifests declare arbitrary host pipeline settings, accept connector executable UI/raw SVG, send base64 media, or give broad media-library access.
- Treat provider IDs as opaque, keep optional connector failures local, preserve history after connector removal, and keep connector transport credentials separate from OpenPost API tokens.
- `n8n-nodes-openpost` is installed and used inside n8n. It calls curated REST operations; it is not a social provider, Connector Protocol client, MCP client, generic raw-request node, or generated copy of all API endpoints.
- Do not ship a timestamp-polling n8n trigger. Build the durable automation-event/webhook API first.

For all public API, MCP, CLI, and schema removals, production telemetry/inventory plus a documented deprecation window are prerequisites. Repository-only non-use is insufficient.

## Operator and external verification queue

These cannot be closed from repository source alone:

- [ ] Inventory deployed `media_collections`, `publication_assets`, `posting_schedules.set_id`, duplicate publication fields, `organization_invitations`, and API/MCP/CLI endpoint usage before migration/removal.
- [ ] Verify live Paddle Merchant-of-Record configuration, tax/VAT/customer documents, invoices, portal deep links, discounts, refunds, cancellation, failed-payment recovery, and withdrawal terms.
- [ ] Close the remaining TRUST-001/LEGAL-005 evidence: controller/company identity, Purelymail transfer basis, operational access-review/revocation proof, incident-procedure ownership/evidence, and legal review dates. The public incident and human-access wording itself is shipped.
- [ ] Verify provider-side OpenRouter/Azure configuration for both image descriptions and meme suggestions: exact `azure/eu` route, data collection denied, no fallback, current ZDR classification, and provider review date. Source and Nix fail closed but cannot prove the live provider-side policy.
- [ ] Complete PRIV-001 provider/legal evidence for the enabled managed Memegen target or move it to a reviewed private deployment.
- [ ] After migration 084, inventory pre-existing unbound API tokens for required-SSO organizations; revoke or deliberately reissue workspace-bound tokens because the schema migration cannot infer their intended workspace.
- [ ] Obtain approved team, mission, timeline, company/contact, funding/backer, and imagery facts before reconsidering an About page; absence is not an implementation defect.
- [ ] Decide whether independent pentest/audit work is funded; publish scope and date only after completion. Do not add SOC 2, ISO, GDPR, or pentest badges without proof.
- [ ] Close PIN-GATE-001 and GBP-GATE-001 independently and reverify their access tiers, policies, limits, quotas, permitted origins, retention, and approval evidence at every certification renewal. Revisit Reddit only when REDDIT-GATE-001 becomes a priority.
- [ ] Reverify n8n’s current MIT/verification/tooling/Node requirements, npm name availability, supported-version matrix, provenance support, and Creator Portal status before N8N-001/002/015 closure.
- [ ] Re-run clean Docker Compose and binary install, provider publishing, billing, MFA/recovery, and production browser checks from the older launch checklist where still open.

## Suggested delivery order

1. **Close the live privacy gap now:** keep the managed meme path enabled by operator decision and complete PRIV-001's provider, legal, retention, routing, and disclosure boundary against the deployed configuration.
2. **Start the two wanted access gates in parallel:** GBP approval/policy work can begin immediately; Pinterest Trial approval precedes implementation and Standard approval follows the working Trial demo before public production. Do not wait for Reddit, connector, or n8n decisions.
3. **Run a parallel bounded-correctness lane now:** MOBILE-001 should progress alongside access and provider foundations—not wait for provider certification.
4. **Finish only the shared provider prerequisites the first slices need:** PROV-FIRSTPARTY plus TARGET/DELIVERY/CAP/POLICY/RETENTION/LEASE/META; complete SELECT before large GBP discovery and SCHEDULE before native GBP scheduling.
5. **Deliver Pinterest first:** PIN-001 OAuth/boards/sections → PIN-002 single/multi-image Pins → PIN-003 video → PIN-004 later depth, with Trial implementation evidence and Standard approval before public claims.
6. **Deliver GBP second:** GBP-001 approved execution mode → GBP-002 accounts/locations and retention → GBP-003 immediate image posts → GBP-004 native one-off/recurring schedules only after approval → GBP-005 later depth.
7. **Certify and harden provider by provider:** PROV-HARDEN-001 and PROV-QA-001 apply the contracts and mechanically gate each advertised provider/format without making Pinterest wait for GBP or deferred Reddit proof.
8. **Then improve daily UX and structure:** keep STATE-001's external status boundary explicit, then schedule ARCH/DATA/BUILD work according to dependency and capacity.
9. **Deferred lanes:** start Connector Protocol, n8n, or Reddit only after an explicit priority decision.
