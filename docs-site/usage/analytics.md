# Analytics

OpenPost stores supported account and publication counters so the Analytics page can show changes over time without calling every provider while the page loads.

## What the page shows

- Account follower history and the latest account counters
- Publication engagement, such as likes, comments, reposts, quotes, shares, saves, and clicks
- Views, impressions, and reach as separate metrics
- Results for 7, 30, or 90 days
- Actionable reconnect, unsupported, rate-limit, and collection-failure states

A missing metric is not shown as zero. Providers define these counters differently, so OpenPost does not merge views, impressions, and reach into one number.

## Collection timing

OpenPost uses its database-backed job worker. No Redis service is required.

- Account counters start on a daily cadence.
- Publications under 6 hours old are checked hourly.
- Publications from 6 to 24 hours old are checked every 3 hours.
- Publications from 1 to 3 days old are checked every 12 hours.
- Publications from 3 to 7 days old are checked daily.
- Automatic publication checks stop after 7 days.

Repeated unchanged measurements reduce collection frequency, up to 8× the base interval. **Refresh data** queues current account checks and publications from the last 90 days. Provider rate limits can delay a refresh.

## Provider coverage

| Provider                        | Account metrics                        | Publication metrics                                        | Notes                                                                                                                 |
| ------------------------------- | -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| X                               | Followers, following, posts            | Likes, replies, reposts, quotes, bookmarks, impressions    | X API access and quotas apply.                                                                                        |
| Mastodon                        | Followers, following, posts            | Favourites, replies, reblogs                               | Counts come from the connected instance.                                                                              |
| Bluesky                         | Followers, following, posts            | Likes, replies, reposts, quotes                            | Public AppView endpoints are used.                                                                                    |
| LinkedIn                        | Not available for personal connections | Not available for personal connections                     | LinkedIn restricts member-post reads; organization analytics require a different connection type and approved scopes. |
| Threads                         | Followers                              | Views, likes, replies, reposts, quotes, shares             | Requires `threads_manage_insights`.                                                                                   |
| Facebook Pages                  | Followers                              | Reactions, comments, shares                                | OpenPost does not use deprecated impression metrics.                                                                  |
| Instagram professional accounts | Followers, media count                 | Likes, comments, views, reach, saves, shares when returned | Publication insights require `instagram_manage_insights`.                                                             |
| TikTok                          | Followers, following, likes, videos    | Likes, comments, shares, views                             | Requires `user.info.stats` and `video.list`.                                                                          |
| YouTube                         | Subscribers, videos, channel views     | Video views, likes, comments                               | Hidden subscriber counts may be unavailable.                                                                          |

Accounts connected before the new Instagram, Threads, or TikTok permissions were added must be reconnected. OpenPost keeps the last successful measurement while access is restored.

## Stored data

OpenPost stores normalized counters and collection state. It does not store raw provider responses, access tokens, post text, or direct-message data in analytics snapshots.

Analytics do not add a social inbox. Comment moderation remains a separate provider capability, and notifications or direct messages are not collected.
