# TryPost analytics and AI Generate & Review compared with OpenPost

**Research date:** 2026-08-31

**TryPost revision reviewed:** [`6496588`](https://github.com/trypost-it/trypost/tree/6496588bbc34e0554175255a2912b5839c3b3b9a)

**OpenPost revision reviewed:** local checkout at `169c72d`; cited public source snapshot at [`12ce2e3`](https://github.com/getopenpost/openpost/tree/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1)

## Executive summary

TryPost has a broad, immediately understandable analytics UI and unusually complete per-provider live fetchers, but its claim of “per-account reach and engagement across every connected platform” is not borne out by the current routing. Its account dashboard supports ten connection identifiers, not every platform; personal LinkedIn, Bluesky, Mastodon, and Discord are omitted, Facebook Groups are not a supported account type, and TikTok has no per-post fetcher. Most TryPost analytics are transient provider reads cached for one hour (account) or five minutes (post), not a durable analytics system. Labels are presentation strings rather than canonical metric keys, errors often collapse to an empty grid, and there is no history from which to compute trustworthy trends or deltas.

OpenPost is materially stronger on analytics correctness and architecture. It separates optional analytics capability from publishing, normalizes provider values into canonical keys while preserving “missing” versus measured zero, persists account and Rendition snapshots plus explicit sync state, uses durable adaptive jobs, exposes permission/rate-limit/not-found/stale states, and aggregates Renditions back to the user-visible Publication. OpenPost also covers account and post analytics for LinkedIn profiles, Bluesky, Mastodon, and TikTok, which TryPost does not. TryPost is ahead for Pinterest and Telegram, has a partial Discord implementation, and exposes richer date-bounded YouTube Analytics metrics than OpenPost’s current lifetime channel/video counters.

For AI, the products optimize different jobs. TryPost is better at small, visible composer actions: prompt-to-rewrite, literal-substring review suggestions with one-click apply/apply-all, on-brand carousel creation, generated/template imagery, and clear credit metering. OpenPost’s Publication Builder is substantially stronger for high-integrity multi-destination generation: durable queued builds, source and claim ledgers, per-account native Renditions, strict machine-owned schemas, voice snapshots, platform policies, a separate reviewer with bounded repair and a second review, cancellation/retry/idempotency, persisted usage, and explicit commit into a draft Publication. OpenPost’s key product gap is not model sophistication; it is the absence of TryPost-style lightweight inline rewrite/review and integrated image/carousel generation.

**Priority:** preserve OpenPost’s durable analytics and Publication/Rendition model; add missing providers and richer provider-native metrics rather than adopting TryPost’s live-cache design. For AI, add an inline action layer on top of the existing provider-neutral boundary and voice/prompt infrastructure, while keeping the Builder’s source-fidelity review as the high-assurance path.

## Evidence and limitations

### Method

This review used the current source trees, tests and official documentation as primary evidence. TryPost marketing copy is treated only as a claim. TryPost file links are pinned to the reviewed commit so later changes do not silently alter the evidence. OpenPost conclusions were checked against local commit `169c72d`; the public links cite the earlier `12ce2e3` source snapshot for reviewability.

### Important limitations

- No live social accounts or paid provider applications were exercised. API behavior is inferred from request construction and tests, not production calls.
- Provider APIs and approved scopes can vary by application review, account type, region, and API version. “Implemented” means a source path exists, not that every deployment is approved for it.
- TryPost’s public docs say Discord has an account tab, but the current account-dashboard controller and Vue page do not route Discord. The code is stronger evidence than the doc.
- TryPost’s marketing says automation includes AI generation. The audited AI entry points establish editor Generate/Review/Create, but no MCP AI-generation tool was found; automation-driven AI was not proven to use these flows. This report therefore labels that seam “unverified,” not absent.
- “No persistence” below means no durable metric snapshot/history persistence was found. Provider IDs, post metadata, AI usage, generated drafts, and Telegram reactions are persisted separately.

## 1. TryPost analytics

### 1.1 Architecture and data flow

```text
Analytics page
  -> active accounts filtered by a hard-coded supported-platform list
  -> user selects one account and optional date range
  -> GET account metrics
  -> provider API called on cache miss
  -> [{label, value}] rendered as cards

Published post Metrics tab / REST / MCP
  -> PostMetricsFetcher dispatches by PostPlatform
  -> provider API called on 5-minute cache miss
  -> one result per enabled PostPlatform
  -> [{label, value}] or {unsupported, reason}
```

1. **Account dashboard is live-read plus cache, not stored analytics.** `AnalyticsController` filters active accounts to TikTok, both Instagram connection types, Threads, Facebook, X, LinkedIn Page, Pinterest, YouTube, and Telegram. It parses optional `since`/`until` and dispatches directly to a provider service. Each date-aware service defaults to seven days and uses a production cache TTL of 3,600 seconds. There is no snapshot/history write in these paths. [`AnalyticsController.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Controllers/App/AnalyticsController.php), [`FacebookAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/FacebookAnalytics.php)
2. **Post metrics have a shared dispatcher and a five-minute cache.** Web, REST, and MCP reuse `PostMetricsFetcher`; cache identity is the PostPlatform ID and published entries are dispatched independently. The MCP tool is read-only and workspace-scoped. [`PostMetricsFetcher.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Post/PostMetricsFetcher.php), [`GetPostMetricsTool.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Mcp/Tools/Post/GetPostMetricsTool.php)
3. **Normalization is UI-shaped and lossy.** Services return localized or provider-derived labels plus a number. There is no canonical metric key, unit, period, provenance, measured/unsupported distinction per metric, or raw-provider field. The frontend chooses icons by substring matching translated labels. This makes cross-provider aggregation and schema-safe automation difficult. [`MetricsGrid.vue`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/js/components/analytics/MetricsGrid.vue)
4. **Errors are easy to mistake for no activity.** Account fetchers generally log a redacted provider body and return `[]`; the controller also converts selected connection/platform exceptions to `[]`. The explicit comment prefers empty numbers to a 500, but the UI cannot distinguish zero activity, missing permission, rate limiting, stale cache, or an outage. Post-level failures are somewhat better because they return `unsupported: api_error`. [`AnalyticsController.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Controllers/App/AnalyticsController.php)
5. **Refresh means cache expiry or a new cache key.** The UI refetches when account/date selection changes and exposes a date picker only for a hard-coded platform list. There is no explicit cache-bypass refresh, durable sync state, next-sync time, or stale-data badge. [`Index.vue`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/js/pages/analytics/Index.vue)

### 1.2 Platform-by-platform matrix

<!-- prettier-ignore -->
| Platform / connection | Account-level view and source | Account metrics | Post-level view and source | Constraints, unsupported or synthetic behavior |
|---|---|---|---|---|
| **LinkedIn profile** | **No dashboard route.** | None. | **Unsupported** by the shared dispatcher. | Despite LinkedIn profile publishing support, only `linkedin-page` is included in account analytics and post dispatch. [`AnalyticsController.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Controllers/App/AnalyticsController.php) [`PostMetricsFetcher.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Post/PostMetricsFetcher.php) |
| **LinkedIn company Page** | Yes; LinkedIn `/rest/organizationPageStatistics`, `/organizationalEntityFollowerStatistics`, and `/organizationalEntityShareStatistics`, with `Linkedin-Version: 202601`. | Page views; organic and paid follower gains; impressions, clicks, likes, comments, shares. | `/rest/socialActions/{shareURN}`. | Post view exposes only likes and comments, despite richer organization share statistics. Date endpoints are normalized to UTC midnight; zero-valued account metrics are omitted, conflating measured zero with absence. [`LinkedInPageAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/LinkedInPageAnalytics.php) |
| **X** | Yes; paged `GET /2/users/{id}/tweets?tweet.fields=public_metrics`. | Sum of impressions, likes, retweets, replies, quotes, bookmarks over fetched tweets. | `GET /2/tweets/{id}?tweet.fields=public_metrics`, same six counters. | Not true account metrics: totals are synthesized by summing at most five pages/500 posts. Lookback is clamped to 100 days. Cost is explicitly bounded, but high-volume accounts undercount. [`XAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/XAnalytics.php) |
| **Facebook Page** | Yes; Graph `/{page-id}/insights`. | `page_total_media_view_unique` (page reach label), `post_total_media_view_unique` (posts reach), post engagements, daily follows, media views, summed across daily values. | `/{post-id}/insights` for impressions, unique impressions, likes and clicks. | Page-only connection model. Summing daily follow values produces follows during the window, not current followers; labels do not expose metric semantics. [`FacebookAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/FacebookAnalytics.php) |
| **Facebook Group** | **Not supported/relevant in current platform routing.** | None. | None. | Public docs enumerate Facebook but not a distinct Group connection identifier. No group analytics service or dispatcher branch was found. [`AnalyticsController.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Controllers/App/AnalyticsController.php) |
| **Instagram standalone** | Yes; Instagram Graph base URL selected by account type. | Daily reach and follower count summed over the window; total-value likes, comments, shares, saves, views, total interactions. | `/{media-id}/insights`; Reel: reach, likes, comments, shares, saved, plays; Story: reach, impressions, replies; feed: reach, likes, comments, shares, saved, total interactions. | Proactive token refresh. Summing `follower_count` daily is semantically suspicious if the provider field is a daily count/snapshot; it is not presented as follower-days. [`InstagramAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/InstagramAnalytics.php) |
| **Instagram via Facebook Business** | Same service and metrics as standalone, but account-specific Graph base URL. | Same as above. | Same as above. | A recent fix corrected duplicated version paths, illustrating connection-type sensitivity. [`InstagramAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/InstagramAnalytics.php) [`59380cd`](https://github.com/trypost-it/trypost/commit/59380cd58abb6d6bcea399b55310b6d49e1e1f07) |
| **TikTok** | Yes; `/v2/user/info` and `/v2/video/list` then `/v2/video/query`. | Current followers, following, total account likes, video count; views/likes/comments/shares summed for the most recent **20** returned videos. | **Unsupported** by `PostMetricsFetcher`; `TikTokAnalytics` has no post method. | Date picker disabled. “Recent” totals are synthetic, non-date-bounded, non-paginated last-20-video sums. Requires `user.info.stats` and `video.list` according to official TryPost setup docs. [`TikTokAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/TikTokAnalytics.php) [TryPost TikTok docs](https://docs.trypost.it/platforms/tiktok) |
| **YouTube** | Yes; YouTube Analytics v2 `/reports`, `ids=channel==MINE`. | Date-bounded views, estimated minutes watched, average view duration, average view percentage, subscribers gained/lost, likes. | Same reports endpoint filtered by video; views, minutes watched, average duration, likes, comments, shares from publish date to now. | Strongest TryPost time-series provider integration. Values are rounded to one decimal account-side but post values are cast to integer, potentially truncating averages. [`YouTubeAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/YouTubeAnalytics.php) |
| **Threads** | Yes; `/{user-id}/threads_insights`. | Date-bounded views, likes, replies, reposts, quotes. | `/{thread-id}/insights`, same counters. | Handles either `total_value` or daily arrays, but labels remain untyped strings. Requires valid insight permissions/token. [`ThreadsAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/ThreadsAnalytics.php) |
| **Pinterest** | Yes; `/v5/user_account/analytics`. | Impressions, pin clicks, engagements, saves, average daily pin-click rate. | `/v5/pins/{id}/analytics`, fixed 90-day window: impressions, saves, pin clicks, outbound clicks, MRC video views. | Account click rate is a simple average of daily rates, not weighted by impression volume. Days missing `PIN_CLICK_RATE` are dropped from all totals in the loop, which can undercount other metrics. [`PinterestAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/PinterestAnalytics.php) |
| **Bluesky** | **No dashboard route.** | None. | Public AppView `app.bsky.feed.getPosts` using reconstructed AT URI. Likes, reposts, quotes, replies. | No impressions/reach available. Post-only implementation avoids user PDS auth. [`BlueskyAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/BlueskyAnalytics.php) |
| **Mastodon** | **No dashboard route.** | None. | Public instance `/api/v1/statuses/{id}`. Favourites, reblogs, replies. | Instance-specific; public posts only. It intentionally omits the write-scoped token. No impressions/reach. [`MastodonAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/MastodonAnalytics.php) |
| **Telegram** | Yes; Bot API `getChatMemberCount`. | One live subscriber/member count. | Subscriber count plus reaction rows persisted from webhook data in `PostPlatform.meta.reactions`. | Bot API exposes no post views. Subscriber count attached to a post is account context, not post performance; reactions are the one notable metric persistence exception. [`TelegramAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/Telegram/TelegramAnalytics.php) |
| **Discord** | Class exists (`getGuild` approximate member count), but **not routed into the account dashboard/controller or Vue page**. | Approximate guild member count if called. | Live `getMessage`: reactions by emoji and thread `message_count` as comments, plus guild members. | Official TryPost analytics docs claim a Discord members tab, contradicting current controller/UI. No impressions/reach/views. [`DiscordAnalytics.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Social/Discord/DiscordAnalytics.php) [`AnalyticsController.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Controllers/App/AnalyticsController.php) [TryPost analytics docs](https://docs.trypost.it/knowledge-base/analytics) |

### 1.3 Analytics correctness findings

- **High — marketing/support mismatch:** “Every connected platform” is not accurate. Account analytics omit three publishable networks plus Discord in the actual route; TikTok post metrics are absent. The docs are also stale about Discord.
- **High — no durable history:** cache eviction loses the only account/post values (except Telegram reaction metadata). TryPost cannot reliably calculate deltas, trends, historical comparisons, or audit what a user saw.
- **High — semantic aggregation bugs/ambiguity:** daily follower counts are summed for Instagram; Pinterest totals discard days without click-rate; X is capped to 500 posts; TikTok “recent” means a non-paginated 20-video sample. These need explicit metric definitions in the UI.
- **Medium — missing versus zero is lost:** some services omit zero values, others return zeros, and failures often return an empty array. Consumers cannot safely compare accounts.
- **Medium — presentation labels are the data contract:** localized labels and fuzzy icon matching make API/MCP analytics unstable for machine consumers.
- **Medium — live reads amplify provider cost and outages:** the cache helps, but there is no central budget, persisted fallback, stale indicator, or adaptive scheduling.

## 2. OpenPost analytics comparison

### 2.1 Architecture and data flow

```text
15-minute durable sweep
  -> enumerate active accounts and recently published Renditions
  -> resolve optional provider AnalyticsAdapter and account-specific support
  -> verify feature and required scopes
  -> enqueue account/Rendition jobs
  -> obtain valid decrypted access token at execution time
  -> fetch provider values into canonical AnalyticsValues
  -> transactionally store immutable snapshot + current sync state
  -> back off when unchanged; persist classified failures

GET /analytics
  -> read stored state/snapshots only
  -> account history + follower deltas
  -> Publication summary and per-Rendition detail
  -> measured counts, stale/status/next-sync metadata, trends and pagination
```

OpenPost’s core contract deliberately treats missing keys as distinct from measured zero, defines canonical keys, and exposes status values (`ok`, `pending`, `unsupported`, `permission_required`, `rate_limited`, `not_found`, `failed`). Required scopes can vary by account identity, which is essential for LinkedIn person versus organization. [`backend/internal/platform/analytics.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/platform/analytics.go)

Persistence uses account snapshots, Rendition snapshots, and one current sync-state row containing status, safe error, current metrics, last attempt/success, next sync, and unchanged streak. [`backend/internal/database/migrations/043_analytics.sql`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/database/migrations/043_analytics.sql)

The service sweeps every 15 minutes; accounts target 24-hour syncs; content adapts from hourly in the first six hours, to three-hourly, 12-hourly, daily, then stops after seven days. Manual refresh includes Renditions from the last 90 days. Unchanged values exponentially back off up to 8×, and classified provider failures set their own retry time without triggering generic queue retries. [`backend/internal/services/analytics/service.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/analytics/service.go)

The read API supports 7/30/90-day windows, account filtering, engagement/views/newest sorting and cursor pagination. It returns account support/scopes/status/history, follower/engagement/view trends, Publication-level aggregation, and per-Rendition values with measured counts and stale state. [`backend/internal/api/handlers/analytics.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/api/handlers/analytics.go) [`backend/internal/services/analytics/overview.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/analytics/overview.go)

### 2.2 Capability comparison

<!-- prettier-ignore -->
| Area | TryPost | OpenPost | Better current design |
|---|---|---|---|
| Persistence | Cache only for most metrics | Immutable snapshots + current sync state | **OpenPost** |
| Page reads | Provider call on cache miss | Stored state only | **OpenPost** |
| Refresh | Cache expiry/new date key | Durable sweep, adaptive cadence, explicit refresh queue | **OpenPost** |
| Metric contract | `{label,value}` | Canonical open-ended metric keys; missing ≠ zero | **OpenPost** |
| Error truth | Often empty array | Classified support/permission/rate-limit/not-found/failed + stale | **OpenPost** |
| User content model | `Post` with `PostPlatform` | Publication aggregated from destination Renditions | **OpenPost** |
| Date-bounded provider reports | Broad live date picker; strong YouTube | Reporting windows are over stored captures; some provider values are lifetime counters | **TryPost** for YouTube depth |
| LinkedIn | Page only; post likes/comments | Person and organization, account-specific scopes; rich member/org post metrics | **OpenPost** |
| X | Sums timeline up to 500 posts | Account public metrics plus exact stored Rendition IDs | **OpenPost** correctness/cost |
| Meta | Richer Facebook Page insight set; rich Instagram account period metrics | Simpler account counters, robust content insight fallback one metric at a time | Split |
| TikTok | Account + synthetic recent 20; no post | Account + exact Rendition video query | **OpenPost** |
| YouTube | Analytics API watch-time/subscriber changes/shares | Data API lifetime channel and video counters | **TryPost** depth; **OpenPost** persistence |
| Bluesky/Mastodon | Post only | Account + post | **OpenPost** |
| Pinterest | Account + post | No adapter | **TryPost** |
| Telegram | Subscriber + webhook reactions | No adapter | **TryPost** |
| Discord | Partial code; account UI wiring defect; post reactions/replies | No analytics adapter | **TryPost**, after wiring fix |
| Tests | Provider feature tests exist, but design is cache-centric | Adapter mapping tests plus large service/handler suites for state, cadence, aggregation and errors | **OpenPost** |

OpenPost’s provider implementations also subtract replies authored as part of the same thread from reply/comment engagement on X, Threads, Mastodon and Bluesky, preventing the product’s own thread segments from inflating audience response. [`analytics_x.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/platform/analytics_x.go) [`analytics_meta.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/platform/analytics_meta.go) [`analytics_federated.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/platform/analytics_federated.go)

## 3. TryPost AI Generate, Review and Create

### 3.1 UX and request/response flow

#### Generate

1. In the post editor, the user opens **AI Generate**, enters a prompt, and the dialog sends `prompt`, optional `current_content`, and a client UUID after subscribing to a private user/generation broadcast channel.
2. The controller verifies update authorization and the account-level `useAi` gate, then queues `StreamPostContent` and returns `202` with the channel.
3. The job builds a brand-aware `PostContentStreamer`, broadcasts model chunks, and records token usage after completion.
4. Although the endpoint streams, the model is prompted for a JSON object; the UI suppresses partial output until the accumulated stream parses as complete JSON, then extracts `content`.
5. **Apply** replaces the editor content; **Retry** runs another paid generation. The generated text itself is not saved by this flow until the normal editor save occurs. [`PostAiGenerateController.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Controllers/App/PostAiGenerateController.php) [`StreamPostContent.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Jobs/Ai/StreamPostContent.php) [`AiGenerateDialog.vue`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/js/components/posts/ai/AiGenerateDialog.vue)

**UX risk:** this is not perceptible token streaming; users see `...` until the JSON closes. It combines the complexity/failure modes of streaming and structured output without the responsiveness benefit.

#### Review

1. Opening Review immediately posts the current content synchronously.
2. A structured-output reviewer returns at most eight `{original,suggestion,reason}` entries.
3. `original` must be a literal substring, allowing one-click replacement; users can apply individually or apply all. Results are reset when the dialog closes and are not persisted.
4. The actual criteria are narrower than the docs’ “strengths, weaknesses, actionable suggestions”: grammar, spelling and clarity only, with no stylistic changes, plus a mandatory rule to flag every em/en dash. [`PostContentReviewer.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Ai/Agents/PostContentReviewer.php) [`reviewer.blade.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/views/prompts/post_content/reviewer.blade.php) [`AiReviewDialog.vue`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/js/components/posts/ai/AiReviewDialog.vue)

**Correctness risk:** applying all literal replacements sequentially can misapply when the same substring occurs multiple times or when one replacement changes the text needed by a later suggestion. There are no offsets, occurrence IDs, or revision hash.

#### Create and carousel/image generation

The Create wizard accepts an AI-supported format, optional account, 0–10 images, prompt, date, template and brand-visual toggle. A unique durable job generates structured caption/slide content, optionally runs a fail-open humanizer, assembles template/media output, creates a real draft post, enables the chosen PostPlatform/content type, and broadcasts readiness plus an in-app notification. Carousel output enforces an exact slide count and roles (`hook`, `development`, `proof`, `cta`); prompts ask for concrete English Unsplash search terms. Video-only formats are intentionally excluded. [`StartPostCreationRequest.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Http/Requests/App/Ai/StartPostCreationRequest.php) [`StreamPostCreation.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Jobs/Ai/StreamPostCreation.php) [`generator.blade.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/views/prompts/post_content/generator.blade.php)

The product can generate provider images and also compose zero-credit templates from Unsplash plus brand visuals. Current billing docs identify OpenAI `gpt-image-2` low quality as the default charged image path. [TryPost AI features](https://docs.trypost.it/knowledge-base/ai-features) [TryPost plans](https://docs.trypost.it/knowledge-base/plans-and-billing)

### 3.2 Provider, model, prompts and brand context

- TryPost uses Laravel AI’s provider-neutral agent interface. Text defaults to `AI_TEXT_PROVIDER` (OpenAI by default) and image generation to `AI_IMAGE_PROVIDER` (OpenAI by default); provider entries cover OpenAI, compatible endpoints, Anthropic, Gemini, OpenRouter, xAI and others depending on modality. Models come from environment variables rather than agent-specific constants. [`config/ai.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/config/ai.php)
- Official self-host guidance currently shows `AI_TEXT_MODEL=gpt-5.4`. This is configuration guidance, not proof of the cloud model. [TryPost AI features](https://docs.trypost.it/knowledge-base/ai-features)
- Generate uses workspace name, brand description, detailed voice traits and content language. Review uses name, voice traits and language, but not brand description. The Create generator also resolves a platform copy budget and hard maximum. [`PostContentGenerator.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Ai/Agents/PostContentGenerator.php)
- Prompt quality is pragmatic: anti-cliché rules, no em/en dashes, platform length targets, exact carousel arc, and concrete visual search terms. However, current content is interpolated into the system instructions and the user prompt is passed directly; unlike OpenPost, the prompt does not consistently declare user material untrusted or maintain a source/claim ledger. [`generator.blade.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/resources/views/prompts/post_content/generator.blade.php)

### 3.3 Credits, persistence, errors, privacy and security

<!-- prettier-ignore -->
| Topic | Evidence-based behavior | Risk |
|---|---|---|
| Credits | Cloud includes 2,500 pooled account credits per workspace allocation; text is `ceil((input+output tokens)/150)`, images model-priced (15 for `gpt-image-2`), video 500. Self-host skips credit checks. [`CreditCost.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Ai/CreditCost.php) [`ai-credits.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/config/ai-credits.php) | Gate occurs before generation while usage is recorded afterward. Concurrent calls can overshoot. |
| Usage persistence | `AiUsageLog` records account/workspace/user/post (when supplied), type, provider/model, token counts, credits and metadata. Tracking failures are deliberately swallowed. [`RecordAiUsage.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Services/Ai/RecordAiUsage.php) | Fail-open accounting can grant unmetered calls and make limits/audits inaccurate. Inline Generate does not pass its post ID to the job’s usage record. |
| Content persistence | Generate/Review results are ephemeral until applied/saved; Create persists a draft and media. | Lost review history; no revision binding; weak team auditability. |
| Authorization | Controllers authorize update/create, validate workspace ownership of selected account, gate AI entitlement and use user-scoped private channels. | Sound boundary, though queued jobs rely on saved IDs after admission. |
| Errors | Generate exposes generic localized start/stream failure; Create broadcasts the exception message and logs it; Review shows hard-coded `Network error` for caught frontend failures. | Raw exception messages can disclose provider/internal detail; review hides actionable 402/validation errors. |
| Provider retention | OpenAI config defaults `OPENAI_STORE` to `true`. [`config/ai.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/config/ai.php) | Self-hosters may unintentionally opt into provider storage; privacy docs should make this explicit and default off for social drafts. |
| Prompt injection | Inputs are bounded (prompt 2,000; content 10,000), structured schemas are used, and post authorization is enforced. | Prompt text/current draft are not uniformly framed as untrusted data. No source-fidelity validation prevents invented claims. |

### 3.4 Automation and MCP seams

TryPost’s MCP server exposes post CRUD/publish/preview/metrics, assets, platform capabilities, signatures, labels, accounts, workspace and API-key tools under OAuth 2.1. It does **not** expose the in-product Generate, Review, or Create agents as MCP tools in the current documented tool catalog. An assistant can use its own model to draft text and then call Create Post; that is not the same as invoking TryPost’s brand-aware, metered AI flow. [TryPost MCP introduction](https://docs.trypost.it/ai/introduction) [`GetPostMetricsTool.php`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/app/Mcp/Tools/Post/GetPostMetricsTool.php)

Marketing claims server-side automation with AI generation, but the editor AI jobs reviewed here do not themselves establish an automation node contract. Treat the claim as unverified until the automation executor and node implementation are traced end to end. [`README.md`](https://github.com/trypost-it/trypost/blob/6496588bbc34e0554175255a2912b5839c3b3b9a/README.md)

## 4. OpenPost AI comparison

### 4.1 Current OpenPost flow

OpenPost’s visible AI workspace supports two entry modes: **Ideate** when the composer is empty and **Build drafts** when it has source text. It can discover opportunities, select an angle, show durable phases (sources, directing, drafting, reviewing), cancel/retry, preview the result, keep edits, and apply it into the composer. The apply step builds canonical source segments plus per-account variant content and locks requested output profiles. [`composer-ai-action-button.svelte`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/frontend/src/lib/components/composer-ai-action-button.svelte) [`ai-workspace-dialog.svelte`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/frontend/src/lib/components/post-builder/ai-workspace-dialog.svelte) [`apply.ts`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/frontend/src/lib/post-builder/apply.ts)

The backend is a durable application, not a synchronous helper:

1. Resolve accounts, output profiles, voice snapshot, URLs/notes/assets and permissions.
2. Atomically persist a queued build and durable job with an idempotency key; cap active builds per user.
3. Load bounded source material in the worker.
4. Run a **director** that extracts factual kernel, thesis, claim ledger, route, destination decisions and media treatment.
5. Run per-account **platform adapters** concurrently with exact output-profile schemas and platform policy.
6. Run an independent **reviewer** for source fidelity, voice, native platform fit and plain language.
7. If rejected with bounded replacements, apply them and review again; reject the package if still unsafe.
8. Persist result, model, provider request ID and per-stage usage/cost. Expose get/cancel/retry. Commit only a ready build into a draft Publication for normal composer editing. [`service.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/publicationbuilder/service.go) [`application.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/publicationbuilder/application.go) [`publication_builds.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/api/handlers/publication_builds.go)

OpenPost uses a small provider-neutral `ai.Generator` boundary with strict machine-owned JSON Schema, bounded multimodal parts, optional bounded web search, reasoning effort, usage and sanitized provider errors. The reviewed adapter is OpenRouter; model selection is shared configuration. [`backend/internal/ai/ai.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/ai/ai.go) [`backend/internal/ai/openrouter.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/ai/openrouter.go)

Prompts explicitly mark all user/source/generated content as untrusted data and forbid invented anecdotes, metrics, quotes, events and citations. Claims are typed as `supported`, `user_asserted`, `opinion`, `parody`, or `needs_verification`, with exact source IDs required for supported claims. [`prompts.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/publicationbuilder/prompts.go) [`types.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/publicationbuilder/types.go)

Instance admins can override versioned base/platform post-generation prompts. Overrides are encrypted at rest and the JSON output contract remains machine-owned and non-editable. [`backend/internal/services/aiprompts/service.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/services/aiprompts/service.go) [`backend/internal/api/handlers/ai_prompts.go`](https://github.com/getopenpost/openpost/blob/12ce2e37a2bc7a0639740dfd129b3abbf4ca93f1/backend/internal/api/handlers/ai_prompts.go)

### 4.2 AI capability comparison

<!-- prettier-ignore -->
| Area | TryPost | OpenPost | Judgment |
|---|---|---|---|
| Inline rewrite | Prompt + current content, preview/apply/retry | No equivalent lightweight rewrite action | **TryPost** |
| Inline copy review | Literal substring corrections, apply/apply-all | Package review is automatic and build-scoped, not an editable copy-review UI | **TryPost UX**, OpenPost stronger integrity |
| Multi-platform generation | One selected format/account in Create; shared Post model | Canonical Publication + native per-account Renditions and output profiles | **OpenPost** |
| Review criteria | Grammar/spelling/clarity; mandatory dash removal | Source fidelity, claims, voice, platform fit, plain language, native differentiation | **OpenPost** |
| Review remediation | User applies suggestions | Bounded replacements + second model review before approval | **OpenPost** correctness |
| Brand/voice | Workspace brand name, description, traits, language, colors | Versioned Voice Profile snapshot per destination; identity/guidance/language/avoidances/examples | **OpenPost** auditability; TryPost simpler setup |
| Source grounding | Current text and prompt context | Typed source ledger, publishability, multimodal source IDs, claim statuses | **OpenPost** |
| Carousel/images | Exact-role carousels; templates, Unsplash and provider images | Media treatment planning; no equivalent end-to-end image/carousel generation found | **TryPost** |
| Durability | Generate ephemeral; Review ephemeral; Create queued and persists draft | All builds persisted with phases, lease fencing, idempotency, cancel/retry and explicit commit | **OpenPost** |
| Schemas | Laravel structured output; streamer awkwardly streams JSON | Strict machine-owned JSON Schema at every stage plus validation | **OpenPost** |
| Usage | Per-call credit ledger and hard monthly entitlement | Per-build per-stage token/cost trace; no user-facing credit quota found | **TryPost** monetization/control; OpenPost observability |
| Prompt operations | Blade prompt files in source | Versioned defaults plus encrypted admin overrides; fixed schema contract | **OpenPost** |
| Security/privacy | Bounded inputs and authorization; provider storage defaults on | Untrusted-data framing, bounded media/search, sanitized provider errors, encrypted overrides | **OpenPost** |
| API/automation | Editor AI endpoints are web-oriented; MCP post tools do not call them | Durable REST build endpoints; no Builder MCP tool found | Split; both have an automation seam gap |

## 5. What each product genuinely does better

### TryPost advantages

1. **Faster low-friction authoring:** rewrite and copy correction are one dialog away and preserve user control.
2. **Useful correction interaction:** side-by-side original/replacement/reason and apply-all is tangible value, even though occurrence binding needs hardening.
3. **Visual content completion:** carousel structure, multiple generated images, brand visuals and template/Unsplash paths turn a prompt into a publishable draft.
4. **Provider breadth at the edges:** Pinterest and Telegram analytics are real implementations; Discord post reactions/replies are close to useful after routing cleanup.
5. **YouTube reporting depth:** watch time, average duration/percentage and subscriber changes are more decision-useful than lifetime counters.
6. **Commercial guardrails:** explicit monthly credits, action pricing, 402 behavior and a usage page are clearer than OpenPost’s current per-build observability alone.

### OpenPost advantages

1. **Analytics truth and durability:** stored snapshots, classified sync state, stale indicators, measured counts, adaptive collection and provider-independent reads.
2. **Correct content hierarchy:** metrics attach to Renditions and roll up to Publications without erasing destination differences.
3. **More accurate provider coverage:** LinkedIn person/organization scope resolution, exact TikTok post metrics, account analytics for Bluesky/Mastodon, X account metrics rather than a capped timeline sum.
4. **AI source integrity:** explicit untrusted-data boundaries, claim ledger, source references and a review/repair/re-review gate.
5. **Native multi-destination output:** independent per-account schemas/policies rather than one caption copied across destinations.
6. **Operational resilience:** durable jobs, admission limits, idempotency, leases, cancellation, retry and persisted safe failures/results.
7. **Prompt governance:** encrypted overrides with actor/time metadata while keeping the schema contract out of editable prompt text.

## 6. Prioritized recommendations for OpenPost

### P0 — correctness, privacy, or data-integrity gates

1. **Keep the durable analytics model; do not copy TryPost’s live-fetch-on-page architecture.** Any new provider must implement canonical keys, missing-versus-zero semantics, support/scopes, classified errors, snapshots, adaptive jobs and provider tests through the existing optional adapter interface.
2. **Add semantic metric metadata before expanding the summary UI.** Define unit and aggregation semantics for snapshot counters versus period totals/rates. Prevent errors analogous to TryPost’s summed Instagram follower snapshots and unweighted Pinterest daily rate. Add provider/source/period metadata where a canonical key alone is ambiguous.
3. **Make AI provider retention explicit and default-private.** Keep prompt/media bytes out of logs and persisted error bodies; document provider retention and ensure OpenRouter/provider settings do not opt into storage by default. Add a privacy disclosure before sending private notes, URLs or media.
4. **Bind any future inline review suggestion to a source revision and exact range.** Use start/end offsets plus original hash and reject stale application. Never implement TryPost’s first-occurrence literal replacement for Apply All.

### P1 — high-value next release

1. **Add inline AI “Rewrite” and “Review” using the existing `ai.Generator`, Voice Profile and strict schemas.**
   - Rewrite modes: improve, shorten, expand, change tone, adapt selected Rendition.
   - Return a diff/patch against a specific composer revision; preview before apply; never autosave.
   - Review categories: correctness/claims, clarity, accessibility, platform limit/fit, and voice. Keep style suggestions separable from hard errors.
   - Persist a bounded audit event (model/usage/action/revision), not the full private prompt unless the user saves it.
2. **Close analytics provider gaps in this order:**
   - **Pinterest** account + Pin analytics (high product overlap and TryPost proof of feasibility).
   - **Discord** guild-member context and message reaction/thread metrics, clearly labeled as context versus content metrics.
   - **Telegram** only if publishing is added/committed; preserve webhook reactions as events and do not call subscriber count post engagement.
3. **Upgrade YouTube to YouTube Analytics reports.** Add date-bounded watch time, average duration/percentage, subscriber gains/losses, likes/comments/shares while retaining Data API lifetime counters as separately named metrics.
4. **Expose metric definitions and collection status in the UI.** Tooltips should state source, window, last success, next sync, measured account count, and known sampling/caps. “No data” must not represent permission or provider failure.
5. **Add user-facing AI budgets.** Start with configurable monthly token/cost budgets and atomic reservation/reconciliation around builds. Preserve current per-stage trace, expose usage, and avoid TryPost’s post-hoc fail-open debit race.
6. **Add a guarded MCP/CLI Publication Builder seam.** Expose create/get/cancel/retry/commit with the same workspace authority, idempotency, source publishability and draft-only commit. Do not create a separate prompt or generation path.

### P2 — differentiation and depth

1. **Visual generation as a separate media job.** Add template-based branded cards first (deterministic, cheap, reviewable), then opt-in provider image generation. Keep generated media provenance and AI disclosure metadata. Reuse Image Editor rather than embedding a second editor.
2. **Carousel planning on the Publication/Rendition model.** Represent slides/media roles explicitly, validate per destination, and allow the Builder reviewer to inspect slide sequence and claims. Avoid storing “instagram_carousel” as an alias that later becomes a generic feed post.
3. **Analytics extensibility:** provider-native metrics alongside canonical rollups, export/API/MCP history, comparison windows, and data-retention controls. Preserve raw metric provenance without exposing tokens or unsafe provider payloads.
4. **Prompt experiments with rollback.** Extend encrypted prompt overrides with version history, preview/test fixtures, staged rollout and measured outcomes; never allow editable prompts to change JSON schema or authorization.
5. **AI review history for teams.** Save accepted/rejected flags and applied patches as Publication history events, with content redaction controls and no raw model chain-of-thought.

## 7. Residual risks and validation targets

- Provider endpoint names and scope availability should be verified against each provider’s current official API docs before implementation; TryPost code is useful competitive evidence, not an API specification.
- TryPost’s Discord controller/UI mismatch may be a transient regression at the reviewed commit.
- Neither repository review proves cloud runtime model selection, provider data-retention agreements, or approved app scopes.
- OpenPost’s snapshot cadence is excellent for operational analytics but does not automatically make lifetime counters date-bounded. UI wording must distinguish “current/lifetime value captured in this window” from “activity during this window.”
- OpenPost’s engagement rollup intentionally combines heterogeneous actions. Keep measured denominators and provider breakdown visible; do not rank a save, click, like and comment as intrinsically equivalent without labeling the formula.

## Primary sources

### TryPost kept

- [TryPost source at reviewed revision](https://github.com/trypost-it/trypost/tree/6496588bbc34e0554175255a2912b5839c3b3b9a) — implementation authority.
- [TryPost analytics documentation](https://docs.trypost.it/knowledge-base/analytics) — official UX/support claims, checked against code.
- [TryPost AI features documentation](https://docs.trypost.it/knowledge-base/ai-features) — official flow and self-host configuration claims.
- [TryPost plans and billing](https://docs.trypost.it/knowledge-base/plans-and-billing) — official credit limits/prices.
- [TryPost MCP introduction](https://docs.trypost.it/ai/introduction) — official authentication and tool-surface description.

### OpenPost kept

- OpenPost local source at `169c72d` — implementation authority for the comparison; the exact file links above use the public `12ce2e3` snapshot where the cited behavior is unchanged.
- Analytics service, adapters, handlers, migration, frontend and tests under the exact file links cited above.
- Publication Builder application/service/prompts/types, AI boundary, prompt override service and frontend under the exact file links cited above.

### Dropped or downgraded

- Search snippets, third-party reviews and SEO comparison pages — not primary evidence.
- TryPost README claims such as “analytics across every connected platform” and “automation AI generation” — retained only as marketing claims where source paths did not prove the full statement.
- Historical OpenPost roadmap material — superseded by current implementation.
