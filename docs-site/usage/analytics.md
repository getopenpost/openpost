# Analytics

Use this page when reviewing saved account and Publication results.

OpenPost saves the account and post numbers that each platform provides. The Analytics page reads saved data, so it does not wait for each platform to reply.

## What the page shows

- Account follower history and the latest account counters
- Post results, such as likes, comments, reposts, quotes, shares, saves, and clicks
- Views, impressions, and reach as separate metrics
- Results for 7, 30, or 90 days
- Clear notices for reconnects, unsupported data, API limits, and update errors
- Account filtering that updates summary totals, content rows, and the follower chart together
- Content sorting by engagement, views, or publish time, plus direct native-post links
- The last successful update and when OpenPost can try again

A missing number is not shown as zero. Platforms define these numbers in different ways, so OpenPost keeps views, impressions, and reach separate.

## Collection timing

OpenPost updates analytics in the background. No Redis service is required.

- Account numbers start with one update per day.
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

You may need to reconnect Instagram, Threads, or TikTok accounts that were added before OpenPost requested analytics access. OpenPost keeps the last good result while you restore access.

## Stored data

OpenPost saves the numbers it needs and their update status. Analytics records do not store full platform replies, access tokens, post text, or direct messages.

Analytics and the inbox are separate. The opt-in inbox can collect messages from X, Bluesky, Facebook Pages, Instagram, and Mastodon. See [Engagement, Inbox, and Notifications](/usage/communications).
