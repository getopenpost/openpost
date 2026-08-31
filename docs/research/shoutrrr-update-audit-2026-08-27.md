# Shoutrrr update audit: 2026-07-28 through 2026-08-27

## Conclusion

Shoutrrr shipped five releases and 26 main-branch commits in the window. The latest release, [`v1.4.4`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.4), is identical to its main branch at `0e4f179`, so there was no additional unreleased main-branch work as of 2026-08-27.

OpenPost should take four actions:

1. Fix transient OAuth refresh classification now. OpenPost currently marks every provider refresh error as `refresh_failed`, including retryable 429, 5xx, and timeout failures.
2. Add a blocking X video aspect-ratio precheck now. OpenPost records dimensions but does not enforce X's 1:3 through 3:1 range.
3. Live-test LinkedIn Organization connection now. Shoutrrr's still-open Pages OAuth fix came from a real failed connection flow, while OpenPost's provider verification log still says LinkedIn is not checked.
4. Add a general **Copy as draft** action. OpenPost already has most of the client-side save-as-copy path, so this is a small, useful workflow improvement.

Outgoing DM attachments are the most meaningful feature gap, but they are a larger P1 project. Most of Shoutrrr's other headline work is already covered in OpenPost.

## Scope and method

The exact window is 2026-07-28 00:00 UTC through 2026-08-27 23:59 UTC, inclusive. I checked Shoutrrr's Git history, releases, merged and open pull requests, and source in `references/shoutrrr`. I then traced each relevant change through the current OpenPost source and docs.

Shoutrrr released [`v1.4.0`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.0) and [`v1.4.1`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.1) on August 5, [`v1.4.2`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.2) and [`v1.4.3`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.3) on August 9, and [`v1.4.4`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.4) on August 24. `v1.4.0` also shipped several changes merged shortly before July 28. They are included because users first received them inside the audit window.

## Recommended work

### Adopt now

#### 1. Keep transient token-refresh failures retryable

Shoutrrr's [PR #173](https://github.com/coollabsio/shoutrrr/pull/173), merged August 24, stopped 429, 5xx, and timeout responses during token refresh from marking healthy accounts as needing attention. It also increased the per-account refresh lock from 60 to 120 seconds.

OpenPost already serializes refreshes with a database lease in `backend/internal/services/tokenmanager/manager.go`. The missing part is error classification. `refreshGrant` sends every `RefreshToken` error to `releaseRefreshLease`, and that function always sets the grant to `refresh_failed` and tells every linked account to reconnect. The refresh job can retry, but the UI can show a false reconnect state while those retries are pending.

Change the token manager so 429, 5xx, and transport timeouts release the lease without invalidating the grant or accounts. Preserve the transient failure for diagnostics and let the durable job retry. Mark reconnect-required only for permanent OAuth errors such as `invalid_grant` or a confirmed authentication failure. Reuse `platform.HTTPError`, `RetryAfter`, and the existing publisher failure taxonomy.

Risk: a broad retry rule could delay a real reconnect. Keep the classification narrow and test both transient and permanent failures at the token-manager boundary.

#### 2. Block invalid X video aspect ratios before publish

Shoutrrr's [PR #170](https://github.com/coollabsio/shoutrrr/pull/170), merged August 24, added client and server validation for X's 1:3 through 3:1 video aspect-ratio range. It also made terminal X processing failures non-retryable and surfaced the provider's processing error.

OpenPost's `MediaConstraint` in `backend/internal/capabilities/capabilities.go` supports exact aspect ratios, but X's `xVideo` constraint has none. Exact-ratio validation is also currently a warning, while this provider rule must block scheduling and publishing.

Add a min/max aspect-ratio range to the shared media constraint or a precise X predicate, enforce it in server preflight and the composer, and classify terminal X processing failures as validation errors. Cover feed video and thread-segment video.

Risk: do not encode the continuous range as a list of exact ratios. That would reject valid videos between common presets.

#### 3. Expose Copy as draft

Shoutrrr's [PR #139](https://github.com/coollabsio/shoutrrr/pull/139), merged August 4, clones an existing post into a fresh draft while resetting publish state.

OpenPost already supports `saveDraft({ saveAsCopy: true })` in `frontend/src/lib/components/compose-text-post.svelte` for conflict recovery. Expose the same outcome from published and scheduled publication actions. Preserve canonical segments, rendition overrides, destinations, provider settings, and shared Media-library references, but reset IDs, schedule, statuses, provider receipts, errors, metrics, and authorization records.

This is useful for repurposing a strong post and for repeating campaigns without editing the original. It is smaller than the other feature gaps.

### Verify now, change only if reproduced

#### LinkedIn Organization OAuth

Shoutrrr's open [PR #152](https://github.com/coollabsio/shoutrrr/pull/152) proposes a separate OAuth app and connection route for LinkedIn Pages. It responds to [issue #150](https://github.com/coollabsio/shoutrrr/issues/150), where Page connection returned without showing the picker. Shoutrrr says its Community Management app could not share the personal OpenID configuration.

OpenPost already supports personal profiles and Organization Pages in `backend/internal/platform/linkedin.go`, but both use `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. The operator docs claim Organization support, while `launch-kit/provider-verification-log.md` still records LinkedIn as not checked. LinkedIn's [Community Management migration notice](https://www.linkedin.com/developers/news/featured-updates/community-management-migration) also required affected integrations to create a new developer app, but that does not prove every current OpenPost configuration needs two apps.

Run the live provider certification flow with the actual approved Hosted credentials. If the Organization picker or callback reproduces the failure, add separate Pages credentials and an explicit Pages connection route. If it passes, do not copy Shoutrrr's split.

### P1 backlog

#### Outgoing DM media

Shoutrrr's [PR #136](https://github.com/coollabsio/shoutrrr/pull/136), merged July 30, added one outbound image, video, or GIF for X, Instagram, and Facebook DMs. Bluesky remains text-only in Shoutrrr.

OpenPost has inbound `MessageAttachment` data, but `platform.SendMessageRequest` contains only text and identifiers. `services/messaging/send.go` creates outbound messages with `AttachmentsJSON: "[]"`. This is a real gap in the otherwise complete unified inbox.

Implement it as a provider capability, not a generic unrestricted attachment field. Extend the messaging request, durable send job, stored outbound message, API contract, and composer picker. Reuse the Media library and provider-specific upload paths. Keep the provider-write fence and ambiguous-write handling intact, especially for X chunked uploads and Meta's sequential sends.

#### GIF, sticker, and clip search

Shoutrrr's [PR #133](https://github.com/coollabsio/shoutrrr/pull/133), merged July 28, added KLIPY search, trending media, recents, favorites, and a server-side media fetch. [PR #157](https://github.com/coollabsio/shoutrrr/pull/157) later added the required attribution, and [PR #151](https://github.com/coollabsio/shoutrrr/pull/151) fixed validation so a GIF in one thread segment did not invalidate another segment.

OpenPost has stock photo/video search and a Video Editor sticker catalog, but no general composer GIF provider. Backlog this behind higher-value publishing reliability and DM attachments. If adopted, keep provider attribution, SSRF-safe fetching, workspace media ownership, per-segment validation, and license terms explicit.

#### Longer queue runway

Shoutrrr's [PR #153](https://github.com/coollabsio/shoutrrr/pull/153), merged August 6, returns the next ten free queue slots and scans 90 days.

OpenPost's `GET /posting-schedules/next-slot` returns one slot and `findNextConfiguredScheduleSlotTime` scans 30 days. A weekly schedule normally fits, but a heavily occupied or sparse schedule can exhaust the window. Add a multi-slot preview and longer scan when queue users show this failure. It is useful, but not urgent.

#### Backend image decode ceiling

Shoutrrr's [PR #146](https://github.com/coollabsio/shoutrrr/pull/146), merged August 5, calibrated its GD decode pixel limit and made upload errors visible.

OpenPost has explicit pixel ceilings for feedback screenshots, Meme Maker, and Image Editor canvases, but the general media upload path reads image dimensions without an obvious global decoded-pixel ceiling. Audit thumbnail and metadata decoding under large compressed images. Add an early dimension limit only if the general path can allocate the full decoded image. Do not copy Shoutrrr's 16-megapixel number without measuring the Go path and worker memory budget.

### P2 candidates

#### Google Business Profile Local Posts

Shoutrrr's open [PR #163](https://github.com/coollabsio/shoutrrr/pull/163), created August 13, proposes OAuth, location discovery, readiness checks, media, CTA/event/offer fields, publishing, and reconciliation for Google Business Profile Local Posts. It is not shipped.

This fits local businesses, but OpenPost has no Google Business Profile adapter and the provider has meaningful operational cost. Google's [prerequisites](https://developers.google.com/my-business/content/prereqs) require project approval and an organization account; its [Local Posts API](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create) supports creation after that access is granted. Validate customer demand and Hosted approval feasibility before adding the provider. If those pass, Shoutrrr's PR is a useful behavior reference, not code to port blindly.

#### Desktop MCP OAuth callbacks

Shoutrrr's [PR #161](https://github.com/coollabsio/shoutrrr/pull/161), merged August 9, allows configured redirect domains and custom URI schemes such as `cursor://` for dynamically registered MCP clients.

OpenPost currently supports OAuth metadata, PKCE, URL-based client metadata, a predefined ChatGPT client, and a CLI stdio proxy for desktop clients. It does not expose the same dynamic registration model. Keep custom schemes out until OpenPost deliberately adds dynamic client registration or a supported desktop client cannot use the proxy. Custom schemes expand the redirect security surface.

## Already covered

These Shoutrrr changes do not create OpenPost work:

| Shoutrrr change                                                                                                      |       Shipped | OpenPost coverage                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified DM inbox for X, Bluesky, Instagram, and Facebook, [PR #131](https://github.com/coollabsio/shoutrrr/pull/131) |        Jul 28 | Per-account opt-in unified inbox, durable sync jobs, history, unread state, and the same provider family. Only outbound attachments are missing.                              |
| Per-thread-post media, [PR #138](https://github.com/coollabsio/shoutrrr/pull/138)                                    |         Aug 4 | Canonical publication segments, rendition segments, per-segment media relations, composer media picker, validation, publishing, and authorization fingerprints already exist. |
| Select or clear all accounts, [PR #142](https://github.com/coollabsio/shoutrrr/pull/142)                             |         Aug 4 | `social-set-control.svelte` already calls `selectAllAccounts` and `clearAllAccounts`; Social Sets cover reusable groups.                                                      |
| Queue redelivery recovery, [PR #147](https://github.com/coollabsio/shoutrrr/pull/147)                                |         Aug 5 | Stale jobs are recovered durably, provider writes are fenced, accepted writes are reused after a crash, and already-published thread segments are skipped on resume.          |
| Bluesky refresh serialization, [PR #158](https://github.com/coollabsio/shoutrrr/pull/158)                            |         Aug 8 | The token manager already uses a database refresh lease with versioned compare-and-swap across providers. Do not add a second Bluesky-only lock.                              |
| X quota calculation, [PR #160](https://github.com/coollabsio/shoutrrr/pull/160)                                      |         Aug 9 | OpenPost reserves and settles provider costs with confirmed, unknown, and capped exposure rather than counting every X operation as one post.                                 |
| Calendar timezone date keys, [PR #169](https://github.com/coollabsio/shoutrrr/pull/169)                              |        Aug 24 | Calendar date keys and today/past checks already use the workspace timezone, with focused tests.                                                                              |
| Create on occupied calendar days, [PR #171](https://github.com/coollabsio/shoutrrr/pull/171)                         |        Aug 24 | Month and week cells expose create actions even when posts already exist; item and overflow interactions are separate.                                                        |
| Calendar multi-account glyphs, [PR #128](https://github.com/coollabsio/shoutrrr/pull/128)                            | Aug 5 release | Calendar cards already show a bounded platform/account icon stack and count.                                                                                                  |
| LinkedIn Page publishing, [PR #117](https://github.com/coollabsio/shoutrrr/pull/117)                                 | Aug 5 release | Organization discovery, explicit operator enablement, Page selection, posting, media, and analytics already exist. Live OAuth certification remains open.                     |
| Auto repost/boost pipeline, [PR #124](https://github.com/coollabsio/shoutrrr/pull/124)                               | Aug 5 release | Durable Auto Reposts already support X, Mastodon, Bluesky, and LinkedIn with engagement gates, stable-growth checks, per-post overrides, and cross-workspace authorization.   |
| X premium detection and video length, [PR #83](https://github.com/coollabsio/shoutrrr/pull/83)                       | Aug 5 release | X account constraints already update text, video duration, and size limits with safe fallback when subscription data is unavailable or stale.                                 |

## Skip

- Discord mention picker, [PR #156](https://github.com/coollabsio/shoutrrr/pull/156): OpenPost's current Discord integration is webhook-based and deliberately sends `allowed_mentions: {parse: []}`. Do not add bot OAuth or weaken mention safety only for this convenience.
- Cursor pagination alias fix, [PR #145](https://github.com/coollabsio/shoutrrr/pull/145): the failure was tied to Shoutrrr's Laravel query. It is not evidence of the same Bun query bug in OpenPost.
- Image Editor export compression, [PR #129](https://github.com/coollabsio/shoutrrr/pull/129), and saved Meta mention persistence, [PR #130](https://github.com/coollabsio/shoutrrr/pull/130): different implementations; no matching OpenPost defect was found.
- Lazy Inertia props, [PR #135](https://github.com/coollabsio/shoutrrr/pull/135), Docker worker launch in [`v1.4.1`](https://github.com/coollabsio/shoutrrr/releases/tag/v1.4.1), and Passport key generation, [PR #172](https://github.com/coollabsio/shoutrrr/pull/172): Laravel, Supervisord, or FrankenPHP-specific.
- Hugeicons, gradient styling, colored toasts, healthcheck, LAN HMR, and dependency bumps: implementation or visual choices with no OpenPost product advantage.

## Priority order

1. Transient refresh classification.
2. X aspect-ratio and terminal-processing validation.
3. Live LinkedIn Organization certification.
4. Copy as draft.
5. Outgoing DM attachments.
6. Queue runway, GIF search, and media decode audit as evidence warrants.
7. Google Business Profile only after demand and API approval are credible.

The highest-value lessons are reliability constraints, not feature parity. OpenPost already covers most of Shoutrrr's August headline features and often has the deeper durable implementation.
