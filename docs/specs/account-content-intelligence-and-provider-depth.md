# Account content intelligence and provider depth

**Status:** Proposed

## Goal

OpenPost should understand the connected account, not only work published through OpenPost. It will discover eligible provider content, persist truthful metric history, explain the evidence behind each insight, and let the user repurpose any useful item into a new draft Publication.

The same program adds date-bounded YouTube Analytics, a complete Pinterest provider, a Telegram bot provider, and a Discord bot connection alongside existing Discord webhooks.

## Product decisions

- Provider content published outside OpenPost is read-only. It never becomes a Publication or Rendition automatically.
- A user may repurpose provider content into a new unsaved draft Publication. Repurposing never edits the remote item or consumes AI quota before the user reviews a direction.
- Analytics distinguishes `all`, `openpost`, and `external` content. OpenPost-managed content is never double counted after provider discovery finds it.
- Insights are deterministic projections of stored measurements. They include the reporting period, metric, value, measured count, comparison sample, and content reference.
- Discovery is rate-aware and provider-specific. Manual refresh does not bypass provider budgets, concurrency limits, `Retry-After`, or stored backoff.
- Hosted uses shared OpenPost Telegram and Discord bots. Self-hosted operators provide their own bot credentials through instance configuration.
- Existing Discord webhook accounts remain supported as a separate connection mode.

## UX brief

### Job and audience

A solo founder opens Analytics to understand what works across an established account, including posts created before OpenPost or published elsewhere. The page is an operating surface, not a report builder. It must let the user verify coverage, inspect evidence, and act on one useful result without learning provider API details.

### Outcome and proof

The page answers three questions in order:

1. What happened across the connected accounts?
2. Which measured content contributed to the result?
3. What can I repurpose now?

Every claim links to measured content and states its range and comparison population. Coverage copy states when history begins, how many items were discovered, and whether a provider cap, permission, cost limit, or installation date makes the result partial.

### Interaction and layout

- Keep the existing page header, reporting window, refresh action, metric ledger, and trend hierarchy.
- Add `All content`, `Published with OpenPost`, and `Published elsewhere` as one compact source filter for content totals, insights, and the content list. Account growth metrics remain account-wide and say so.
- Replace browser-derived highlights with server-owned evidence cards. The primary action is `Repurpose`; evidence detail is secondary.
- Render managed and external content in one scan order. Managed rows retain their Publication link. External rows use a quiet `Published elsewhere` label and never show edit, schedule, retry, or delivery actions.
- Expanding either row shows provider-native metrics with their unit, aggregation meaning, reporting period, collection time, and availability state.
- `Repurpose` sends only an opaque content reference and range to the composer. The composer loads an authorized source, creates a fresh unsaved draft, preselects still-valid destinations, and opens the existing Builder direction step. No model call starts automatically.
- During initial discovery, show stored analytics immediately and a compact `Building account history` state. Do not block the page behind a progress dialog.
- On phones, filters remain 44px targets, evidence stacks before the content list, row actions stay visible without horizontal scrolling, and expanded metrics use the existing disclosure pattern.

### UX boundaries

- Do not present a provider-capped result as the whole account.
- Do not call raw engagement totals `best-performing`; use factual copy such as `Most engagement actions`.
- Do not create a second analytics route, generic AI-advice panel, decorative chart set, or external-content editing surface.
- Do not put post text, metrics, bot credentials, or provider payloads in URLs.

## Architecture

### Provider content inventory

Add an analytics-owned `AccountContent` model rather than synthesizing Publications:

- Workspace, Social Account, platform, stable provider content ID, optional provider parent ID.
- Content profile, bounded title and text, safe external URL, and provider publish time.
- `origin` of `openpost` or `external`, an origin confidence, and an optional exact Rendition link.
- First discovered, last seen, and provider-confirmed unavailable times.
- Unique provider identity per Social Account.

Store no raw provider response and download no remote media. Text is normalized and bounded to 10,000 characters. Remote URLs must pass provider-specific safe URL validation. Account deletion cascades through imported content, snapshots, discovery state, and webhook observations.

Add immutable account-content snapshots beside existing account and Rendition snapshots. Reuse the generic analytics sync-state table with an `account_content` subject type. Add a dedicated per-account discovery state for opaque cursor, backfill watermark, coverage description, last attempt/success, safe failure, and next eligible run.

### Discovery seam

Add an optional provider seam without widening the publishing `Adapter` interface:

```go
type AccountContentDiscoverer interface {
    AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport
    DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error)
}
```

The request carries account identity, opaque cursor, lower time bound, and bounded page size. Each discovered item carries stable identity, normalized content fields, publish time, coverage metadata, and optional measurements already returned by the listing endpoint.

Providers that can measure several discovered items efficiently may implement a second optional batch seam. The result is keyed by stable provider content ID so one aggregate map can never be written to several items.

### Metric semantics

Keep normalized integer values, but add metadata per metric:

- Unit: count, milliseconds, or basis points.
- Aggregation: current snapshot, lifetime total, reporting-period total, or reporting-period average.
- Provider source and reporting-period start/end when applicable.
- Optional scale for display, with percentages stored as basis points rather than floats.

Persist metadata beside values in every new snapshot. Existing snapshots without metadata remain readable and default only to established canonical count semantics. Summary totals and trends combine only compatible units and aggregations. A lifetime counter captured during a 30-day UI range must remain labeled lifetime, not activity during that range.

### Durable and rate-aware collection

- Discovery runs in durable jobs, one bounded page per job. The cursor is committed before the next page is queued.
- Only one discovery job may be active per Social Account. Provider-level concurrency and per-account daily read budgets bound fan-out.
- Initial backfill targets the last 90 days and at most 250 items per account. A provider may return less. Future sync continues forward without discarding older stored measurements.
- Routine external-content discovery runs no more than daily. OpenPost-managed content remains immediately known through publishing.
- Recent discovered content may use adaptive metric collection. Older imported content receives one baseline capture and then only provider-efficient or manual refresh within budget.
- Batch endpoints are preferred. A provider that would require one request per historical item must lower its cap or skip deeper item metrics rather than burst requests.
- `Retry-After`, classified rate limits, app quotas, and provider cost classes override requested refreshes. X history discovery is disabled unless the operator or Hosted policy grants a bounded read budget.
- Discovery state records `complete`, `partial`, `permission_required`, `rate_limited`, `cost_limited`, `unsupported`, and `failed` outcomes with safe messages.

### Read contract

Extend analytics reads with:

- `source=all|openpost|external`, bound into pagination cursors.
- A flat content result that uses a discriminated content reference and never invents Publication IDs.
- Per-account discovery coverage and last-success state.
- Metric metadata and provider-native measurements.
- Server-owned insights calculated over the complete filtered population rather than the returned page.

The first insight set is:

- Most engagement actions, with deterministic tie-breaking and no result when engagement was not measured.
- Strongest measured destination, with measured destination count.
- Follower decline, only when comparable account snapshots establish it.

The contract uses stable insight kinds and structured evidence. Clients localize prose.

### Repurpose contract

Add an authorized analytics repurpose-source endpoint accepting Workspace ID, a discriminated content reference, and range. It returns bounded source text, provider context, still-valid destination IDs, and recomputed evidence.

The composer:

1. Creates a new local draft state.
2. Uses source text as publishable Builder material.
3. Adds performance evidence as bounded, non-publishable private context.
4. Opens direction selection before any paid request.
5. Lets the user change destinations, source text, and direction.
6. Preserves the original imported item or Publication unchanged.

## Provider delivery

### YouTube

- Discover channel uploads through the uploads playlist and stable video IDs.
- Reuse batched Data API video statistics for lifetime counters.
- Add `yt-analytics.readonly` and surface reconnect-required state for existing grants that lack it.
- Query the YouTube Analytics reports endpoint with explicit dates for views, estimated watch time, average view duration, average view percentage, subscriber gains/losses, likes, comments, and shares where supported.
- Keep Data API lifetime channel/video values under distinct lifetime semantics.
- Treat missing report columns as missing, not zero.

### Pinterest

Pinterest becomes a first-party provider and consumes the existing provider-app, grant, readiness, target, delivery, authorization, media-lease, and capability modules.

- OAuth with approved board, Pin, and account scopes, refresh rotation, reconnect, revocation, and readiness state.
- Complete paginated board discovery and lazy section discovery. A Rendition targets one board and optional section.
- Single-image, multi-image, and video Pins with title, description, destination link, alt text, current organic media limits, and AI disclosure fields where the approved contract requires them.
- Durable video flow: register, upload, checkpoint, poll, create Pin, then reconcile. Never replay an ambiguous final create.
- Account and Pin analytics with explicit reporting windows: impressions, engagements, saves, Pin clicks, outbound clicks, and supported video views.
- Derive click rate from compatible total clicks and impressions. Do not average daily rates without weighting.
- Discover Pins as read-only account content and link exact OpenPost-created Pin IDs to Renditions.
- Trial access remains a development state. Public production availability and claims require current Standard access and live certification.

### Telegram

- Add a first-party bot provider. Hosted uses the OpenPost bot; self-hosted operators configure bot token, username, and webhook secret.
- Connect a channel or group through a 15-minute signed code posted to that chat. Persist a single-use nonce so replay protection works across web and worker processes.
- Require the bot permissions needed for the selected destination and verify them before connection and publishing.
- Publish plain text, photos, videos, documents, and media groups within current Bot API limits. Long text that cannot fit a media caption becomes a visible follow-up segment, and every resulting message ID is retained.
- Verify webhook secret headers and subscribe only to required update types.
- Track account member/subscriber count as account context. Persist reaction-count updates as content measurements. Never label subscriber count as post engagement and never claim Bot API post views.
- Observe new channel posts after bot installation, including posts created outside OpenPost. Telegram offers no Bot API history backfill, so coverage begins at installation and says so.
- Ignore ordinary group conversation for analytics. Groups support publishing only.

### Discord bot

- Preserve incoming-webhook accounts. Add `bot` as a separate Discord connection mode selected by account capability state.
- Hosted uses the shared OpenPost bot. Self-hosted operators configure application ID, client secret, bot token, and redirect URI.
- OAuth installs the bot into one selected guild. Persist the guild as the Social Account without copying the global bot token into workspace credentials.
- List only text or announcement channels where the bot can view and send messages. Recheck channel ownership and permission at publish time.
- Support text, attachments, explicit embeds, and user-selected mentions. Default `allowed_mentions` suppresses every implicit mention. Role/member search is enabled only when approved permissions allow it.
- Store guild member count as approximate account context. Fetch reactions and thread reply count for OpenPost-published messages.
- Do not ingest arbitrary guild messages, request broad message-content history, or present Discord as having impressions, reach, or views.

### Existing providers

After the YouTube tracer proves the inventory seam, add bounded discovery where current approved scopes and provider contracts permit it:

1. Instagram, Threads, TikTok, Mastodon, and Bluesky.
2. Facebook Pages.
3. X only under an explicit cost budget.
4. LinkedIn organizations and member identities only where current certification proves discovery access.

Each provider owns ID normalization, pagination, caps, coverage copy, safe URLs, and managed-Rendition matching fixtures.

## API, automation, and contracts

- The HTTP analytics contract is authoritative for source filters, coverage, insights, and repurpose sources.
- CLI and MCP analytics reads expose the same source and coverage terms when their generated surfaces include the updated operation.
- Pinterest board/section settings, Telegram chat identity, and Discord channel settings use typed Rendition settings. Source contracts are regenerated; generated files are never edited alone.
- Bot setup and provider application secrets stay in instance administration and environment-backed provider apps, not Workspace requests, API responses, logs, or task payloads.

## Privacy and security

- Account connection explains that OpenPost will store bounded text and analytics for eligible provider content, including content published elsewhere.
- Do not retain raw provider payloads, remote media bytes, access tokens, webhook secrets, or bot tokens in analytics records.
- All discovery, insight, and repurpose reads enforce Workspace membership. Repurpose evidence is recomputed server-side and cannot be supplied by query text.
- Account deletion removes imported content and observations. Provider disconnection stops new reads and preserves or removes existing history according to the existing account-deletion choice, not an analytics-only rule.
- Telegram webhook codes are signed, expiring, durable single-use credentials. Discord OAuth state and guild selection use the existing connection intent and grant lifecycle.
- Provider and bot errors are normalized into safe stable codes. Raw response bodies never reach persisted state or user-visible copy.

## Compatibility, rollout, and rollback

- Migrations are additive and support SQLite and PostgreSQL from a clean database and the current migration history.
- Existing analytics snapshots, authored Publications, Renditions, and Discord webhook accounts remain valid.
- Connection, publishing, discovery, and analytics have separate provider readiness or feature gates. Disabling discovery stops jobs and hides unsupported claims without deleting stored history.
- Pinterest, Telegram, and Discord bot public claims remain disabled until app credentials, policy evidence, required scopes, and live certification are current.
- Rollback disables new jobs and provider gates. No rollback rewrites authored content or replays provider writes.

## Exclusions

- Editing or deleting externally published content.
- Automatic cross-platform grouping of discovered items.
- Importing remote media into the Media library.
- Arbitrary Discord server-message ingestion or Telegram group-conversation ingestion.
- AI-generated analytics advice without structured evidence.
- Automatic Builder execution or Publication creation from an insight.
- Claiming provider history is complete when the provider caps, scopes, cost policy, or bot installation date make it partial.

## Delivery slices

1. Metric semantics, discovery interfaces, persistence, job definitions, and rate policy.
2. YouTube discovery as the vertical tracer, including whole-account read filters and coverage.
3. Server-owned insights and safe Repurpose handoff for managed and imported content.
4. Remaining feasible current-provider discovery adapters.
5. YouTube Analytics report depth and UI metric definitions.
6. Pinterest connection, targets, image and multi-image publishing.
7. Pinterest durable video, discovery, analytics, and certification gates.
8. Telegram bot connection, publishing, webhooks, observation, and analytics.
9. Discord bot connection, publishing controls, and analytics while preserving webhooks.
10. Contract regeneration, API/CLI/MCP alignment, docs, privacy copy, browser QA, and provider certification evidence.

Each slice is independently testable and committed before the next dependent slice. Provider lanes may proceed in parallel only after the shared contracts stabilize and each writer uses an isolated Worktrunk worktree.

## Acceptance criteria

- A connected YouTube account imports eligible recent videos without creating Publications and shows truthful partial or complete coverage.
- The same provider item discovered after OpenPost publishing links to its Rendition and is counted once.
- Source filters update compatible totals, evidence, and content results while account-wide growth stays explicitly account-wide.
- Insights are independent of content pagination and display sort, and each result carries period, metric, measured count, and sample size.
- Repurpose creates a fresh draft, opens direction review before any model call, and never mutates the source.
- Date-bounded YouTube values and lifetime values remain distinguishable in storage, API responses, and UI.
- Pinterest connects through the first-party provider lifecycle, publishes every certified organic format without duplicate replay, discovers Pins, and persists account and Pin analytics.
- Telegram connects through a durable one-time code, publishes supported content, records all resulting message IDs, observes channel posts from installation onward, and stores reaction counts without inventing views.
- Discord bot OAuth connects one guild, limits channel choices to destinations the bot can use, suppresses implicit mentions, publishes and measures OpenPost messages, and leaves webhook accounts working.
- Discovery processes one bounded page at a time, respects backoff and request budgets, and cannot be forced into a burst through manual refresh.
- Provider payloads and credentials do not appear in analytics rows, jobs, logs, URLs, generated contracts, or user-visible errors.
- Backend, frontend, migration, contract, accessibility, responsive, light/dark, and clean-database verification passes at the documented project gates.

## Reference evidence

- TryPost checkout `references/trypost/` at `6496588bbc34e0554175255a2912b5839c3b3b9a` for Pinterest, Telegram, and shared Discord bot behavior.
- Postiz checkout `references/postiz/` at `7d08f5b6fcac604ffb42420f82ee506407371fc7` for provider workflows and failure cases.
- Official Pinterest access-tier, organic-content, analytics, and API v5 contracts.
- Official Telegram Bot API webhook, channel-post, reaction, media-group, and chat-member contracts.
- Official Discord OAuth2, permission, guild, channel, message, reaction, and thread contracts.
- Official YouTube Data and YouTube Analytics report contracts.
