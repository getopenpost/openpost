# Accounts

Use this page when you want to connect or manage social accounts in a Workspace.

Connected accounts are the social accounts inside a workspace.

## Common flow

1. Open **Settings → Workspace → Social accounts**.
2. Choose a platform.
3. Sign in to that platform and approve access.
4. Return to OpenPost. A successful first connection opens a fresh composer with the new destination selected.

If you cancel authorization or the provider cannot finish the connection, OpenPost returns to account management with a retry message. Refreshing or signing in again does not create a separate setup state; the Workspace setup guide reads current subscription, destination, first-composition, and Publication data.

**Settings → Workspace → Social accounts** is the account-management screen. OAuth cancellation and error feedback appears there once, then OpenPost removes it from the URL so refresh and browser history do not repeat stale feedback.

## Optional features per connected account

Direct messages, Comments and replies, Analytics, and Grow are optional and per connected account. Each feature starts off for a newly connected account.

Manage these choices in the Account details drawer under **Settings → Workspace → Social accounts**. The drawer keeps feature choices together and collapses the developer shortcut until you need it. Direct messages and Comments and replies appear together under Inbox, but OpenPost saves and enforces them as separate choices.

Enabling a feature queues an initial durable refresh for that account. Disabling a feature stops future provider reads and writes for that account without deleting previously collected messages, replies, metrics, or recommendations and without revoking provider authorization. Use provider settings or account removal to revoke provider authorization.

Whether a feature is available depends on three distinct facts: provider support for that account, required provider scopes, and plan access. An unsupported feature is omitted. A missing scope tells you to reconnect with additional permission. A plan restriction stays a billing matter and does not imply that reconnecting will fix it.

Grow shows recommendations for eligible accounts and never follows any account automatically. Each follow remains an explicit action and requires Grow to stay enabled.

Existing accounts keep their current behavior after upgrade. Previous Inbox opt-ins become Direct messages choices, current Analytics and Engagement behavior remains enabled, Grow becomes enabled only where OpenPost already has stored Grow sync state for that account, and other accounts receive explicit off choices so the prompt does not appear on routine reauthorization.

## Notes

- OpenPost stores provider tokens, app passwords, and webhook credentials encrypted at rest. One saved authorization can serve several destinations, such as a LinkedIn member and the organizations that member manages.
- When destinations share an authorization, **Disconnect this destination** removes only the selected destination. The other destinations and their saved credentials remain active.
- **Remove saved authorization** deletes OpenPost's encrypted credentials and disconnects every destination that uses them. When only one destination remains, **Remove connection** is the only removal action so a live credential cannot be left behind without an active destination.
- Removing a saved authorization does not disable the token, app password, or webhook at the provider. Use the provider's connected-app, app-password, or webhook settings when provider-side access must also be revoked.
- These account actions do not delete the operator's provider app configuration from environment variables, `OPENPOST_PROVIDER_APPS`, or the provider app registry.
- Each platform has its own callback and permission needs.
- OAuth return links contain only the generic status, opaque selection reference, and OpenPost Workspace or destination identifiers needed for the next screen. They never include provider tokens, credentials, or secret-bearing provider data.
- Authenticated clients can call `GET /api/v1/accounts/providers` to discover which provider apps are configured before showing connect actions.
- Mastodon can use either preconfigured instances or the custom instance field on the Accounts screen. Custom instances must be public HTTPS servers.
