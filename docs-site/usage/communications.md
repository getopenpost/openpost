# Engagement, Inbox, and Notifications

OpenPost keeps provider reads out of page requests. Background jobs collect normalized records, write them to the database, and update separate sync state for engagement and messages. The Engagement and Messages pages read stored data only, so a slow or unavailable provider does not block the interface.

## Engagement

The Engagement page combines comments and replies from supported published renditions. It keeps provider-specific actions behind one normalized model without pretending every provider has the same controls.

| Provider | Read | Reply | Hide or moderate | Delete own |
| --- | --- | --- | --- | --- |
| X | Yes | Yes | No | Yes |
| Mastodon | Yes | Yes | No | Yes |
| Bluesky | Yes | Yes | No | Yes |
| LinkedIn | Yes | Yes | No | Where LinkedIn permits |
| Threads | Yes | Yes | Yes | Yes |
| Facebook Pages | Yes | Yes | Yes | Yes |
| Instagram Professional | Yes | Yes | Yes | Yes |
| YouTube | Yes | Yes | Moderate | Yes |

OpenPost syncs recent published content on an adaptive cadence. It preserves the last successful records when a provider reports a permission, rate-limit, unsupported, or transient failure. Replies and moderation actions use durable jobs and are never performed by a page-load request.

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

OpenPost creates per-user in-app notifications for publish failures, account attention, new engagement, new messages, reply failures, workspace invitations, and successful publishes. Each user can mark items read, delete them, or change preferences. Critical failures remain enabled in-app.

Notification preferences are separate from provider inbox opt-in. Turning off an OpenPost notification does not start or stop collection from a social account.
