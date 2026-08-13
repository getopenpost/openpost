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

The page groups replies under the OpenPost post and connected account. You can filter by platform, account, post, read state, and archive state. The post filter searches saved Publications and loads older results in pages. Select **Load older** below the Engagement list to reach the complete saved history. A failed first page or older page stays in place with a retry action. Successfully loaded pages keep the active filters, open reply form, and visible reply position.

Each item keeps safe file links, edit and delete state, and a link to the post on the social network. OpenPost does not save full platform replies or file contents.

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

Open **Settings → Notifications** to choose in-app and email delivery for each event. Email is on by default for failed publishing, failed replies, and workspace invitations. Successful posts, account attention, new engagement, and new messages stay in the app unless you turn on email for them. This avoids sending a second default email when a publishing failure already explains that an account needs to be reconnected. Critical failure alerts always remain on in the app.

Email alerts use the same SMTP, Resend, or Cloudflare Email provider as account messages. OpenPost queues each alert in the database with the event, retries temporary delivery failures, and checks your current preference again before sending. If an administrator has not configured email delivery, the settings page shows email as unavailable.

Workspace invites for an existing user do not store the raw invite token in the alert. The Notifications page shows alerts for the selected workspace plus account-wide notices such as workspace invitations. Marking the inbox read or deleting its history changes the workspace alerts in that inbox and its account-wide notices; alerts tied to other workspaces stay unchanged. Because account-wide notices appear in every workspace, reading or deleting one applies everywhere it appears. Deletion is permanent.

The sidebar bell and Notifications page share the same selected-workspace inbox. Successful read and delete actions update both immediately; failed actions keep the prior unread state so you can try again. While the app is open, it checks for new alerts on a bounded timer and when the window regains focus. The feed loads older alerts in pages, keeps the same read-status filter while loading, and offers a separate retry for the first page and for an older-page failure. Alerts are grouped under Today, Yesterday, or their full date, and each row names its event type, read state, time, and available actions.

Alert settings do not control inbox collection. Turn inbox collection on or off from the social account.
