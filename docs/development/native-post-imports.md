# Native post imports

`services/postimport` owns opt-in, durable jobs, account authorization, request budgets, checkpoints and the read-only library. `platform.NativePostReader` owns provider wire formats and account-authored post selection. Neither library reads nor account-support reads contact a provider.

Register import adapters alongside publishing adapters through `SetProvider`, including dynamically connected instances. Preserve installation flags such as TikTok's disabled Display API and LinkedIn's organization support and approved member read access. Member reads are requested only with `OPENPOST_LINKEDIN_MEMBER_READS_ENABLED=true`, after provider approval. Check required permissions against `oauth_grants` when an account has a canonical grant. Credential mirrors are only a legacy fallback. X has no reader, independently of configured budgets.

## Persistence and recovery

Activation records the current time. Re-enabling moves that floor and retains existing library rows. Every stored item must have an external origin and a publication time strictly after that floor. A completed cycle overlaps its previous start by one minute, clamped to activation. A resumed cycle retains its original start so the next cycle revisits posts created while it was catching up.

Each job reads at most five pages. The default budget is ten provider requests per UTC day per account. A reader using multiple requests implements `NativePostReadEstimator`; YouTube reserves three reads for the first page and two for subsequent pages. Persist the reservation before provider I/O. A timeout or crash does not restore it. Keep unfinished cursors across page or budget limits. Never advance the successful watermark merely because the initial library reached 250 items.

Page rows and their checkpoint commit together. Conditional checkpoint updates require the same activation watermark and enabled choice. A response from a disabled or reactivated cycle cannot restore the old choice or import rows. Database job deduplication owns concurrent execution.

Exclude authored provider IDs from renditions, rendition segments and provider deliveries. Legacy Bluesky URI/CID JSON receipts compare through their URI. Imported rows are unique per account and provider ID. Repeated reads update the observation time without creating an editable Publication, downloading media or dispatching automation.

Only fixed provider endpoints receive credentials. Graph and LinkedIn next URLs supply cursor metadata, never request targets. A repeated or oversized cursor is a failed read. Treat absent timestamps as unimportable; do not replace them with observation time. Providers with unspecified ordering continue through older records instead of assuming they exhaust the window. YouTube uses the video's publication date, never its playlist insertion date.

## API references

Verified on 2026-10-04. These references define wire behavior, not live account certification.

- [Meta Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api): account Threads, owner, timestamp, reply/repost fields and cursor paging.
- [Facebook Page posts](https://developers.facebook.com/docs/graph-api/reference/page/posts/) and [Instagram user media](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/reference/ig-user/media/): Page-authored posts and professional-account media. Keep read permissions separate from publishing.
- [TikTok video list](https://developers.tiktok.com/doc/tiktok-api-v2-video-list/): public videos, descending creation time, millisecond cursor and a maximum of 20 items.
- [YouTube playlist items](https://developers.google.com/youtube/v3/docs/playlistItems/list) and [videos](https://developers.google.com/youtube/v3/docs/videos): uploads discovery followed by channel, publication date and privacy checks.
- [Pinterest Pins](https://developers.pinterest.com/docs/api/v5/pins-list/): token-owned Pins, `exclude_repins`, ownership and bookmark paging.
- [LinkedIn Posts](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06): author finder, restricted member read permission, organization read permission and paging links.
- [PeerTube OpenAPI](https://github.com/Chocobozzz/PeerTube/blob/develop/support/doc/api/openapi.yaml): channel video lists sorted by publication time.
- [Lemmy API](https://join-lemmy.org/api/) and [PieFed OpenAPI](https://piefed.social/api/alpha/swagger.json): person details, original post views and page controls. Lemmy uses the existing v3 adapter contract; PieFed requests `include_content` explicitly.
- [Pixelfed client API implementation](https://github.com/pixelfed/pixelfed/blob/dev/app/Http/Controllers/Api/ApiV1Controller.php): Mastodon-compatible account statuses.
- [Google Business Profile local posts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/list): location-scoped pages, live state and provider share URLs.
- [Telegram Bot API](https://core.telegram.org/bots/api): updates are not a channel-history listing API. Do not substitute a consumer of live updates for native post reads.

## Reference implementation review

Shoutrrr at `85a789ddb98d0fcf0ad8d162f7653f010024ff1c` uses account opt-in time, queued account reads and provider authorship filters. Its Apache-2.0 source was reviewed as a behavioral reference. OpenPost retains its own cursor checkpoints, scopes, request budgets and independent read-only inventory.

Postiz at `374fb202334a4b6db183f2e44c52c83a9db58a8b` supplies publishing and authorization examples, not a complete native-import flow. Its AGPL-3.0 source was used for behavioral comparison only. No reference source was ported.
