# Analytics

Use this page when reviewing saved whole-account content results.

Analytics is an optional feature per connected account. It starts off for a newly connected account. Enable it after connection or in Account details to let OpenPost collect account metrics and discover eligible provider content, including content published outside OpenPost. OpenPost stores normalized metrics plus bounded title and text for eligible discovered items so you can inspect evidence and prepare a repurpose draft. It does not import remote media or turn discovered items into Publications.

Disabling Analytics stops future account, Rendition, and account-content collection for that account without deleting stored history or revoking provider authorization. Availability depends on provider support, required scopes, plan access, provider limits, and operator read policy as distinct facts. Existing accounts keep current Analytics behavior after upgrade. The Analytics page reads saved data, so it does not wait for each platform to reply.

## What the page shows

- Account follower history and the latest account counters, labeled as account-wide
- One content inventory for results published with OpenPost and eligible results published elsewhere
- `All content`, `Published with OpenPost`, and `Published elsewhere` source filters for content totals, measured insights, and content rows
- Views, impressions, reach, and provider-native measurements with their unit, aggregation meaning, reporting period, and collection time
- Deterministic measured insights with the reporting range, measured count, comparison sample, and exact content evidence
- Coverage notices that explain when history begins and whether provider caps, permissions, installation date, cost policy, or failures make it partial
- Results for 7, 30, or 90 days, with account and content filtering and sorting
- A **Repurpose** action that prepares a new unsaved composer state and opens direction review before any AI request
- The last successful update and when OpenPost can try again

A missing number is not shown as zero. Platforms define these numbers in different ways, so OpenPost keeps views, impressions, and reach separate.

## Collection timing

OpenPost updates analytics in the background for accounts where the feature is enabled. No Redis service is required.

- Account numbers start with one update per day.
- Eligible account-content discovery processes one bounded page per durable job. Initial discovery targets at most the last 90 days and 250 items; each provider can return less.
- Routine discovery runs no more than daily and respects stored backoff, provider concurrency, per-account read budgets, and `Retry-After`. Manual refresh does not bypass those limits.
- Posts under 6 hours old update each hour.
- Posts from 6 to 24 hours old update every 3 hours.
- Posts from 1 to 3 days old update every 12 hours.
- Posts from 3 to 7 days old update once a day.
- Automatic post updates stop after 7 days.

If the numbers do not change, OpenPost checks less often, up to eight times the normal wait. **Refresh data** asks for new account numbers and posts from the last 90 days. Platform API limits can delay an update. OpenPost saves each result once even if the same background task runs twice.

## Provider coverage

| Provider                        | Account metrics                     | Publication metrics                                                                                                                              | Notes                                                                                             |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| X                               | Followers, following, posts         | Likes, replies, reposts, quotes, bookmarks, impressions                                                                                          | X API access and limits apply.                                                                    |
| Mastodon                        | Followers, following, posts         | Favourites, replies, reblogs                                                                                                                     | Counts come from the connected instance.                                                          |
| Bluesky                         | Followers, following, posts         | Likes, replies, reposts, quotes                                                                                                                  | Public AppView endpoints are used.                                                                |
| LinkedIn                        | Followers                           | Impressions, reach, reactions, comments, reposts, saves, and clicks for profiles; Organization Pages return the numbers LinkedIn makes available | Requires LinkedIn Community Management API access and the account-specific analytics permissions. |
| Threads                         | Followers                           | Views, likes, replies, reposts, quotes, shares                                                                                                   | Requires `threads_manage_insights`.                                                               |
| Facebook Pages                  | Followers                           | Reactions, comments, shares                                                                                                                      | OpenPost does not use deprecated impression metrics.                                              |
| Instagram professional accounts | Followers, media count              | Likes, comments, views, reach, saves, shares when returned                                                                                       | Publication insights require `instagram_manage_insights`.                                         |
| TikTok                          | Followers, following, likes, videos | Likes, comments, shares, views                                                                                                                   | Requires `user.info.stats` and `video.list`.                                                      |
| YouTube                         | Subscribers, videos, channel views  | Video views, likes, comments                                                                                                                     | Hidden subscriber counts may be unavailable.                                                      |

You may need to reconnect Instagram, Threads, TikTok, or YouTube accounts that were added before OpenPost requested the current analytics access. OpenPost keeps the last good result while you restore access. A plan restriction is shown separately and does not imply that reconnecting will fix billing access.

Pinterest, Telegram bot mode, and Discord bot mode have implementation paths but remain unavailable as public Hosted claims without current approval and live certification. Discord incoming webhooks remain the publicly documented Discord connection and do not support Analytics.

## Stored data and privacy

OpenPost stores normalized account and content measurements, metric meaning, safe sync state, discovery coverage, opaque checkpoints, and bounded title and text for eligible discovered content. The title is limited to 500 characters and text to 10,000 characters. Safe provider links and stable provider-content references can also be retained. OpenPost does not store raw analytics provider responses, remote media bytes, access tokens, bot tokens, webhook secrets, or direct messages in analytics records.

Account-content discovery jobs contain only OpenPost Workspace and Social Account references. Provider cursors remain in server-side discovery state and never enter page URLs or job payloads. The Repurpose request sends a discriminated opaque content reference and range in a POST body; it does not place post text, metrics, or provider payloads in a URL. Workspace access is checked again before any source or evidence is returned.

Analytics, Direct messages, Comments and replies, and Grow are separate per-account choices. The opt-in inbox can collect Direct messages from X, Bluesky, Facebook Pages, Instagram, and Mastodon when enabled. See [Engagement, Inbox, and Notifications](/usage/communications) and [Accounts](/usage/accounts). Grow shows recommendations for eligible accounts and never follows automatically.
