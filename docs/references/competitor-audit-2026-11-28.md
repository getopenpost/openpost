# Competitor and reference audit, October 24 to November 28, 2026

OpenPost baseline: `5f2cbe93044b15037e0d0f93231a3d6951261e76`. Window: `2026-10-24T00:00:00Z` through `2026-11-28T23:59:59Z`, synthesizing five weekly competitor reports (Oct 24–31, Oct 31–Nov 7, Nov 7–14, Nov 14–21, and Nov 21–28) against freshly fast-forwarded local reference checkouts.

## Refreshed publishing references

| Reference | Fetched revision | License |
| --- | --- | --- |
| `postiz` | `6086870d668a` | AGPL-3.0 |
| `trypost` | `43c456169eef` | AGPL-3.0 |
| `shoutrrr` | `d8879bdb1e8e` | Apache-2.0 |
| `posthive` | `d3179798280d` | AGPL-3.0 |
| `trypost-docs` | `6c7be6f730ab` | Reference docs |

All fixes below were implemented independently against provider contracts; no competitor source was vendored.

## Already handled on baseline `main`

Verification against current source confirmed that many items across the five weekly reports were already implemented before this pass:

- **MCP local-upload widget gateway prefixing** (Postiz #2334): `apps/server/internal/api/handlers/mcp_upload_widget.html` already performs the MCP Apps `ui/initialize` handshake to resolve prefixed tool names with fallback and explicit diagnostics.
- **X photo tagging handle resolution and validation** (Shoutrrr #199): `platform/x.go`, `services/publisher/tagged_users.go`, and `capabilities/capabilities.go` already resolve `@handles` to numeric IDs with cost reservation, enforce the 10-user limit, and restrict tags to photo attachments.
- **Discord bot-token 401 classification** (Postiz #2354): `platform/discord_bot.go` and `services/publisher/failures.go` already classify `discord:bot_token_invalid` as an admin-facing permission error rather than a user-account reconnect (extended below to remaining read/reconcile paths).
- **Instagram 1,000-character alt-text server constraint** (Postiz #2355): `providerlimits/instagram.go`, `capabilities/capabilities.go`, `platform/instagram.go`, and `destination-settings-dialog.svelte` already enforce the 1,000-character limit while preserving longer descriptions in the provider-agnostic media library (extended below to the inline media-tile alt editor counter).
- **Instagram published ID recovery on `PUBLISHED` reconciliation** (Postiz #2361): `platform/instagram.go` `recoverPublishedMediaID` already matches `media_type` and exact trimmed caption before adopting a single candidate ID.
- **Threads text length counting** (Postiz #2397): OpenPost PR `#513` (`74ad2c3d6`) already fixed the UTF-8 byte bug by counting non-emoji grapheme clusters as 1 and emoji clusters by UTF-8 bytes per Meta's documented rule (`docs/reference/providers/threads.md`). Do not revert `#513` to plain code points.
- **TikTok short-lived access tokens & chunk count over 64 MiB** (Postiz #2429, PostHive `e6d57cc`): `platform/tiktok.go` already stores TikTok's returned `expires_in` directly (5-minute refresh lead time in `tokenmanager`) and computes `total_chunk_count = video_size / chunk_size` rounded down.
- **Facebook video identity aliases & analytics deduplication** (TryPost #493): OpenPost analytics keys on `openpost:<rendition_id>` and keeps `imported_posts` out of analytics tables; `platform/postimport_meta.go` deduplicates via `IdentityAliases`.
- **Unfinished Page-selection states** (Postiz #2453/#2459/#2460/#2462): `handlers/oauth_account_selection.go` stages pending selections in `oauth_account_selections` and creates `social_accounts` only on completion.
- **OAuth token-exchange diagnostics** (Postiz #2486): `handlers/oauth_flow.go` and `oauth_feedback.go` distinguish `token_exchange_failed` with sanitized status/code/subcode/trace from missing scopes.
- **Meta Unified Login (`config_id`)** (Postiz #2350/#2404): `AppConfig.ConfigID` and `InstagramAdapter.GenerateAuthURL` already support `config_id` and are documented in `apps/docs/content/docs/self-hosting/integrations/instagram.mdx` (live verification against a fresh Meta app remains open).
- **LinkedIn Community Management `/v2/me` + `r_basicprofile` + `/rest/organizationAcls`** (TryPost #534, Postiz #2496): Already supported when `OPENPOST_LINKEDIN_AUTH_MODE=community_management`.
- **Other baseline parity**: Facebook `pages_read_user_content` + `pages_manage_engagement` scopes, Mastodon `/api/v2/media`, YouTube `containsSyntheticMedia`, Threads `24/4279009` propagation retry, Bluesky GIFs & aspect ratios, LinkedIn GIFs, Mastodon/Threads polls, Instagram reconciliation rate-limit backoff (`#529`), TikTok inbox `publish_id` reconciliation (`#528`), Meta Business Portfolio least-privilege discovery (`#524`), and SQLite UTC timestamp guards (`#536`).

## Adopted in this pass

1. **TikTok per-chunk 429/5xx upload retries** (Postiz #2379): `uploadTikTokChunk` in `apps/server/internal/platform/tiktok.go` retries transient 429, 5xx, and transport failures up to 4 attempts with fresh byte readers, identical `Content-Range`, bounded backoff / `Retry-After`, and context cancellation without re-initializing the upload or retrying non-429 4xx errors.
2. **Instagram reject sentinel container ID `"0"`** (Postiz #2385): `validateInstagramCheckpointID` in `apps/server/internal/platform/instagram.go` rejects `"0"` and all-zero numeric IDs immediately so HTTP 200 `{"id":"0"}` is never checkpointed.
3. **Instagram 20-item carousels** (Postiz #2408): Raised Instagram carousel `MaxCount` from 10 to 20 in `capabilities/capabilities.go`, `platform/instagram.go` (publish and checkpoint validation, keeping Stories at 10), `packages/platform-text/src/index.ts`, and regenerated `apps/docs/content/docs/guides/media-limits.mdx`.
4. **Threads invalid link attachment `4279047`** (Postiz `fb6f29c9b`): Normalized Meta subcode `4279047` to `meta:invalid_link_attachment:4279047` as non-retryable `FailureValidation` with a curated user message.
5. **Facebook `FileUrlProcessingError` / `robots.txt` crawler diagnostic & docs** (TryPost #542): `doFacebookRupload` in `platform/facebook.go` inspects bounded JSON diagnostics for `FileUrlProcessingError` + `robots.txt` without retaining raw response text, classifies it as `meta:media_url_blocked_by_robots` pointing to `meta-externalfetcher` / Cloudflare AI crawler rules, and documents proxy/Cloudflare requirements in `apps/docs/content/docs/self-hosting/integrations/facebook.mdx`.
6. **Pinterest code 21 ambiguous-write safety & code 1 temporary refusal** (Postiz #2471, TryPost #543): Normalized Pinterest code `21` to `pinterest:create_timeout:21`, fenced `providerwrite.definitelyRejected()` and `safeError()` so code `21` stays ambiguous (`StatusAmbiguous`, `PublishRetryNever`, never auto-retried, instructing the user to check Pinterest), and normalized explicit HTTP 400 code `1` refusals to retryable `pinterest:temporarily_refused:1`.
7. **YouTube Shorts custom thumbnails after processing** (Postiz #2487, PostHive `efc888c`): Propagated `Profile` / `OutputProfile` onto `UploadMediaRequest`; for Shorts, `finalizeYouTubeUpload` polls `processingDetails.processingStatus == "succeeded"` before calling `thumbnails.set` and defers cleanly with `MediaRetrySafeResume` if still processing while keeping `ProviderMediaID` checkpointed so the video is never re-uploaded.
8. **YouTube `AuthorizationRevoker` parity** (TryPost #520): Extracted shared `revokeGoogleOAuthToken` into `platform/google_oauth.go` and implemented `YouTubeAdapter.RevokeAuthorization` alongside `GoogleBusinessAdapter`.
9. **LinkedIn first-comment propagation 404 retry & 422 duplicate classification** (TryPost #475, TryPost #537): Added bounded HTTP 404 retry on `LinkedInAdapter.PostFirstComment`, classified LinkedIn HTTP 422 duplicate-URN rejections as `linkedin:duplicate_content` (`FailureDuplicateContent`, non-retryable, never blindly adopting the URN or leaking raw response text), and added a `providerwrite` regression proving text-only LinkedIn HTTP 401 is a definite, retry-safe rejection after refresh.
10. **Meta Page-token short-lived fallback fix** (Postiz #2464): `exchangeMetaAuthCode` in `platform/facebook.go` now fails instead of silently falling back to a short-lived user token whose Page token would otherwise be stored with `ExpiresIn = 0`.
11. **Instagram connection-method grant isolation** (Postiz #2477): `InstagramAdapter.AuthorizationGrantDescriptor()` now separates `oauth2:instagram_login` (`graph.instagram.com`) from Facebook Login `oauth2` (`graph.facebook.com`) so grants cannot collide across API hosts.
12. **Discord bot-token 401 normalization on remaining read/reconcile paths** (Postiz #2354): Wrapped remaining bot-token `discordGetJSON` callers (`RefreshAccountMetadata`, analytics, `botInstalledInGuild`, `ReconcilePublish`) with `normalizeDiscordBotTokenError`.
13. **Background token refresh permanent failure notifications** (Shoutrrr v1.5.8, Postiz #2358): Wired `notifications.Service` into `TokenManager` so permanent background refresh failures atomically claim `credential_failure_generation`, mark `preflight_failure`, notify `ConsentedByID` and active workspace admins once per generation, and reset on recovery.
14. **Google Business `OFFER` & `EVENT` capability validation** (Postiz #2432): Added `validateGoogleBusinessSettings` in `capabilities/capabilities.go` (requiring `event_title`, `event_start_date`, `event_end_date >= event_start_date`, `offer_coupon_code` or `offer_redeem_url`, and rejecting CTA buttons on `OFFER`) and enforced `end >= start` in `platform/googlebusiness.go`.
15. **Secret redaction hardening** (TryPost #536): Wired `slog.SetDefault(runtimeLogger.Slog())` in `cmd/openpost/main.go` so package-level `slog` calls pass through `operational/logging`, extended `logging.go` to redact multi-segment credential keys (`fb_exchange_token`), `accessJwt` / `refreshJwt`, and bare `eyJ...` JWT tokens.
16. **SSRF `netguard` hardening** (Postiz `59e9af4c9`): Blocked IPv4-translated SIIT (`::ffff:0:0:0/96`) and NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`) prefixes in `internal/netguard/netguard.go`.
17. **Per-token MCP operation rate limiting** (TryPost #518): Added per-token minute/hour budgets on `MCPHandler.callTool` backed by `ratelimit.NewShared(db)` in production.
18. **Composer blocking validation visibility & inline alt-text counter** (TryPost #522, Postiz #2355): Surfaced blocking `resolvedCapabilities[account.id]?.issues` errors in `targetedRuntimeIssues` (with destination attribution and deduplication against server validation) and added a live character counter to `GridAltEditor` driven by the active destination's `alt_text` capability limit without truncating library text.
19. **Legacy IANA timezone alias regression coverage** (TryPost #488): Added regression tests for `Europe/Kiev` and `Asia/Calcutta` in `schedule-timezone.test.ts`.

## Deliberately not copied

- **Automatic retry of Pinterest code 21** (Postiz #2471): Timed-out `POST /v5/pins` is ambiguous; replaying it risks duplicate Pins.
- **Reverting Threads counting to plain Unicode code points** (Postiz #2397): OpenPost `#513` already fixed non-ASCII graphemes while matching Meta's documented UTF-8 byte rule for emoji.
- **Unmerged Instagram 40–80s carousel settling delays / auto-recreation** (Postiz #2385): Unverified heuristics from a closed PR; OpenPost already creates children sequentially and now rejects `"0"`.
- **Shoutrrr's agent-first UI split** (#198), **TryPost's per-platform resident Horizon workers** (#538), **TryPost's strict 9:16-only YouTube Shorts restriction** (#545), **TryPost's posting-streak/heatmap gamification** (#528/#530), **TryPost's Kanban Board view** (#499), **Postiz's Git-backed blog provider** (#2469), and **Postiz's non-transactional check-then-act workflow recheck** (#2392).

## Deferred product & architectural decisions for the owner

1. **Meta deauthorization & data-deletion callbacks** (TryPost #520): Signed callback routes, deletion-status persistence/confirmation codes, and asynchronous revocation preserving shared business publications vs individual connections.
2. **LinkedIn separate personal vs organization developer apps** (TryPost #534, Postiz #2496): Multi-app registry/UI split (`linkedin` vs `linkedin:organizations`) for self-hosters whose Community Management app cannot coexist with OpenID Connect.
3. **Facebook video & Reel custom covers** (TryPost #541): Multipart `thumb` for feed videos and durable post-publish `/{video-id}/thumbnails` retry with non-fatal warning on cover failure.
4. **Threads Inbox durable container-ID checkpointing** (Shoutrrr #202): Currently runs asynchronously on the `sendWorker` queue rather than blocking HTTP, but `ReplyToComment` still waits up to 30s inside the worker without a resume checkpoint.
5. **Remote media-import durable job refactor** (TryPost #514): Moving `upload_media_from_url` into a durable background job with per-source MIME restrictions and reconnect-safe status polling.
6. **Analytics additions**: Share chart as PNG (TryPost #458), Instagram Reel retention metrics (`ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`, `reposts`; Postiz #2495), X/Mastodon/Threads poll results collection (TryPost #463/#512), and piggybacked remote-deletion detection (TryPost #464).
7. **Live verification of Meta Unified Login (`config_id`)** on a newly created Meta app, plus optional Admin UI/DB `config_id` field and LinkedIn org metadata periodic refresh/TTL.
