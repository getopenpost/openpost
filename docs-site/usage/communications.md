# Engagement, Inbox, and Notifications

This page is for people reviewing and responding to saved engagement and messages in a Workspace.

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

The conversation list loads older conversations in stable pages and keeps the active Workspace, platform, account, archive filter, and selected conversation. If an older page fails, the loaded list stays available with an in-place retry.

Open a conversation to start with its newest saved messages. As you approach the top, OpenPost loads older messages in stable pages and keeps the message you were reading in the same place. **Load older messages** provides the same action for keyboard and assistive technology users. A failed older page leaves the active history in place so you can retry it. New messages and late responses from another conversation or Workspace do not reorder or replace the history you have open.

Important provider behavior:

- Facebook and Instagram replies are limited by Meta's active customer-service window. OpenPost blocks a send after the stored deadline.
- Mastodon direct posts are not end-to-end encrypted. The mentioned accounts and involved servers can read them.
- Bluesky chat requires an app-password session.
- X requires the app and connected account to have direct-message access.

OpenPost now checks supported platform APIs on a timer. Messaging stays separate from publishing, so more inbox platforms and file types can be added later.

## Personal notifications

OpenPost sends in-app alerts for failed posts, accounts that need help, new replies, new messages, failed replies, workspace invites, and successful posts. If only some accounts fail, the alert names the accounts that worked and failed and links to the right fix. Retry only runs for failed accounts that can be tried again.

Open **Settings → Notifications** to choose Off, Immediate, or Daily email for each optional event. In-app notifications remain immediate. Email is Immediate by default for failed publishing and failed replies. Successful posts, account attention, new engagement, and new messages stay in the app unless you change their email frequency. Critical failure alerts always remain on in the app.

Daily email defaults to 09:00 in the browser timezone for a new choice. The settings page saves the time with an explicit IANA timezone, such as `Europe/Lisbon`, and does not replace an existing choice when you use another browser. Changing that saved window moves pending items that have not started delivery to the next occurrence of the new window. The old scheduled Job then sends nothing. OpenPost batches daily items for one user and local delivery window, deduplicates repeated events, and escapes notification content before rendering it.

Email alerts use the same SMTP, Resend, or Cloudflare Email provider as account messages. OpenPost stores immediate and daily delivery as database Jobs, retries temporary failures up to five attempts, and checks the current preference before sending. A daily batch advances only after the mail provider accepts the send; a retry uses the same idempotency key. If delivery reaches its retry limit, the Job remains failed and its pending daily items remain available for operator diagnosis instead of being marked sent. If an administrator has not configured email delivery, the settings page shows email as unavailable.

Security actions, access changes, Workspace invitations, and critical billing actions are Transactional notifications. They bypass optional email preferences and daily timing. Their email frequency remains Immediate and cannot be changed to Off or Daily.

You can also start a temporary Mute for every Workspace or only the selected Workspace. Choose an exact future end time on the **Notifications** page or in **Settings → Notifications**. Both surfaces show each active scope and its end time, remove it when that time passes, and offer **End now** to restore your saved email frequencies immediately. Repeating **End now** for the same existing Mute is safe. Expiry does the same automatically; a Mute is an overlay and never rewrites those choices. Workspace-bound API and CLI credentials can create, read, reconcile, and end only Mutes for their bound Workspace; they do not receive account preferences or Mutes from another scope.

A Workspace Mute is more specific than an account-wide Mute. When both apply, OpenPost resolves the Workspace Mute first; after it expires or ends, an active account-wide Mute applies. OpenPost compares the saved absolute end times, so the result does not change with a browser timezone. Optional Immediate and Daily email created or delivered while the effective Mute is active is skipped rather than sent later. In-app notifications remain immediate, and Transactional security, access, invitation, and critical billing email always bypasses Mutes.

Workspace invites for an existing user do not store the raw invite token in the alert. The Notifications page shows alerts for the selected workspace plus account-wide notices such as workspace invitations. Marking the inbox read or deleting its history changes the workspace alerts in that inbox and its account-wide notices; alerts tied to other workspaces stay unchanged. Because account-wide notices appear in every workspace, reading or deleting one applies everywhere it appears. Deletion is permanent.

The sidebar bell and Notifications page share the same selected-workspace inbox. Successful read and delete actions update both immediately; failed actions keep the prior unread state so you can try again. While the app is open, it checks for new alerts on a bounded timer and when the window regains focus. The feed loads older alerts in pages, keeps the same read-status filter while loading, and offers a separate retry for the first page and for an older-page failure. Alerts are grouped under Today, Yesterday, or their full date, and each row names its event type, read state, time, and available actions.

Alert settings do not control inbox collection. Turn inbox collection on or off from the social account.
