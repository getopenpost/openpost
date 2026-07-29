# Engagement, Inbox, and Notifications

OpenPost checks social networks in the background and saves the results. The Engagement and Messages pages read saved data, so a slow or unavailable network does not block the page.

## Engagement

The Engagement page brings comments and replies from supported posts into one list. It only shows the actions that each platform supports.

| Provider               | Read | Reply | Like | Hide or moderate | Delete own             |
| ---------------------- | ---- | ----- | ---- | ---------------- | ---------------------- |
| X                      | Yes  | Yes   | Yes  | No               | Yes                    |
| Mastodon               | Yes  | Yes   | Yes  | No               | Yes                    |
| Bluesky                | Yes  | Yes   | No   | No               | Yes                    |
| LinkedIn               | Yes  | Yes   | No   | No               | Where LinkedIn permits |
| Threads                | Yes  | Yes   | No   | Yes              | No                     |
| Facebook Pages         | Yes  | Yes   | No   | Yes              | Yes                    |
| Instagram Professional | Yes  | Yes   | No   | Yes              | Yes                    |
| YouTube                | Yes  | Yes   | No   | Moderate         | Yes                    |

The page groups replies under the OpenPost post and connected account. You can filter by platform, account, post, read state, and archive state. Each item keeps safe file links, edit and delete state, and a link to the post on the social network. OpenPost does not save full platform replies or file contents.

OpenPost checks new posts more often and older posts less often. It keeps the last good data if a platform reports a permission error, API limit, unsupported action, or short outage. Replies and moderation run as saved background jobs, not during a page load. OpenPost only shows Like for X and Mastodon because those are the verified like actions.

## Unified inbox

Inbox connectors are available for X, Bluesky, Facebook Pages, Instagram Professional accounts, and Mastodon direct-visibility posts. Each connected account starts with inbox sync **off**. An editor must opt in from the account details screen before OpenPost collects conversations.

The inbox saves conversations, messages, file links, send status, and reply deadlines. It does not save full platform replies or tokens. If a platform sends the same message ID twice, OpenPost saves it once.

Important provider behavior:

- Facebook and Instagram replies are limited by Meta's active customer-service window. OpenPost blocks a send after the stored deadline.
- Mastodon direct posts are not end-to-end encrypted. The mentioned accounts and involved servers can read them.
- Bluesky chat requires an app-password session.
- X requires the app and connected account to have direct-message access.

OpenPost now checks supported platform APIs on a timer. Messaging stays separate from publishing, so more inbox platforms and file types can be added later.

## Personal notifications

OpenPost sends in-app alerts for failed posts, accounts that need help, new replies, new messages, failed replies, workspace invites, and successful posts. If only some accounts fail, the alert names the accounts that worked and failed and links to the right fix. Retry only runs for failed accounts that can be tried again.

Workspace invites for an existing user do not store the raw invite token in the alert. Each user can mark alerts as read, delete them, or change alert settings. OpenPost always keeps key failure alerts on.

Alert settings do not control inbox collection. Turn inbox collection on or off from the social account.
