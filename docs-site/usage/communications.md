# Engagement, Inbox, and Notifications

OpenPost keeps provider reads out of page requests. Background jobs collect normalized records, write them to the database, and update separate sync state for engagement and messages. The Engagement and Messages pages read stored data only, so a slow or unavailable provider does not block the interface.

## Engagement

The Engagement page combines comments and replies from supported published renditions. It keeps provider-specific actions behind one normalized model without pretending every provider has the same controls.

| Provider | Read | Reply | Like | Hide or moderate | Delete own |
| --- | --- | --- | --- | --- | --- |
| X | Yes | Yes | Yes | No | Yes |
| Mastodon | Yes | Yes | Yes | No | Yes |
| Bluesky | Yes | Yes | No | No | Yes |
| LinkedIn | Yes | Yes | No | No | Where LinkedIn permits |
| Threads | Yes | Yes | No | Yes | Yes |
| Facebook Pages | Yes | Yes | No | Yes | Yes |
| Instagram Professional | Yes | Yes | No | Yes | Yes |
| YouTube | Yes | Yes | No | Moderate | Yes |

The page groups reply threads under the OpenPost publication and connected account, with filters for provider, account, publication, read state, and archive state. Safe attachment links, edited state, provider-deleted state, and the native post link stay attached to each normalized item. OpenPost does not retain raw provider responses or attachment contents.

OpenPost syncs recent published content on an adaptive cadence. It preserves the last successful records when a provider reports a permission, rate-limit, unsupported, or transient failure, and shows the next eligible collection time when it has one. Replies and moderation actions use one-attempt durable jobs and are never performed by a page-load request. Like controls appear only for X and Mastodon because those are the reaction writes verified in this release.

## Unified inbox

Inbox connectors are available for X, Bluesky, Facebook Pages, Instagram Professional accounts, and Mastodon direct-visibility posts. Each connected account starts with inbox sync **off**. An editor must opt in from the account details screen before OpenPost collects conversations.

The inbox stores normalized conversations, messages, attachment references, delivery state, and provider reply-window deadlines. It does not retain raw provider responses or tokens. Duplicate provider message IDs are idempotent.

Important provider behavior:

- Facebook and Instagram replies are limited by Meta's active customer-service window. OpenPost blocks a send after the stored deadline.
- Mastodon direct posts are not end-to-end encrypted. The mentioned accounts and involved servers can read them.
- Bluesky chat requires an app-password session.
- X requires the app and connected account to have direct-message access.

OpenPost currently polls supported provider APIs. The capability contracts and sync state are separate from publishing so webhook ingestion, provider notifications, richer attachments, and additional inbox providers can be added without changing the core publishing adapter.

## Personal notifications

OpenPost creates per-user in-app notifications for publish failures, account attention, new engagement, new messages, reply failures, workspace invitations, and successful publishes. Partial publishing notifications name the successful and failed destinations and provide the relevant edit, reconnect, or retry action. A retry action queues only retryable failed renditions and leaves successful destinations unchanged.

Workspace invitations for an already registered email use an authenticated invitation ID in the notification. The raw invitation token is not stored in the notification payload. Each user can mark items read, delete them, or change preferences. Critical failures remain enabled in-app.

Notification preferences are separate from provider inbox opt-in. Turning off an OpenPost notification does not start or stop collection from a social account.
