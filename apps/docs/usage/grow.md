# Grow

Use this page when reviewing account recommendations for growth.

Grow suggests accounts to follow for eligible connected accounts. It is an optional feature per connected account.

## Optional feature per account

Grow starts off for a newly connected account. Enable it after connection or in Account details. Disabling it stops future recommendation discovery and provider follow actions for that account without deleting stored recommendations and without revoking provider authorization.

Availability depends on three distinct facts: provider support for that account, required provider scopes, and plan access. An unsupported feature is omitted. A missing scope tells you to reconnect with additional permission. A plan restriction stays a billing matter and does not imply that reconnecting will fix it.

Existing accounts keep their current behavior after upgrade. Grow becomes enabled only where OpenPost already has stored Grow sync state for that account, and other accounts receive explicit off choices so the prompt does not appear on routine reauthorization.

## Provider coverage

| Provider                                                            | Discovery | Follow | Notes                                                                                                                     |
| ------------------------------------------------------------------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Bluesky                                                             | Yes       | Yes    | Discovery uses follows and suggestions, then enriched profiles. Following requires the account to be enabled for Grow.    |
| Mastodon                                                            | Yes       | Yes    | Discovery uses suggestions, familiar followers, and relationships. Following requires the account to be enabled for Grow. |
| X, LinkedIn, Threads, Facebook, Instagram, TikTok, YouTube, Discord | No        | No     | These providers do not expose Grow discovery or follow through OpenPost.                                                  |

## How it works

- Enabling Grow queues an initial durable discovery refresh for that account. The Grow page then populates from saved data.
- Disabling Grow removes that account from the Grow account selector and stops queued discovery and follow work for that account. Stored recommendations stay visible but no new provider calls are made. A queued Job rechecks the effective state before contacting the provider.
- Following a recommendation always requires Grow to remain enabled for that account and remains an explicit user action. OpenPost never follows an account automatically.
- The Grow page reads saved recommendations and shows notices for reconnects, unsupported accounts, missing permission, plan restrictions, and update errors.

The account selector scopes recommendations to one connected account. Use **Show** to focus on people who already follow that account, **Minimum mutuals** to require stronger shared-network evidence, and **Sort** to choose Best match, Follow-back potential, or Most mutuals. Reset returns all controls to their defaults and the result count always reflects the current choices.

Follow-back potential is an estimate, not a promised probability. It puts known followers first, then uses mutual connections and the balance between follower and following counts. OpenPost does not display a percentage because providers do not supply enough evidence for a reliable probability.

## Stored data

OpenPost saves recommendation data and its update status for the account. Grow records do not store provider tokens, post text, or raw provider responses. Changing the feature choice does not revoke provider authorization. Use provider settings or account removal to revoke provider authorization.

See [Accounts](/usage/accounts) for choosing features after connection or in Account details, and [Analytics](/usage/analytics) and [Engagement, Inbox, and Notifications](/usage/communications) for the other optional account features.
