# Accounts

Connected accounts are the social accounts inside a workspace.

## Common flow

1. Open the accounts screen.
2. Choose a platform.
3. Sign in to that platform and approve access.
4. Return to OpenPost and confirm the account is listed.

## Notes

- OpenPost stores provider tokens, app passwords, and webhook credentials encrypted at rest. One saved authorization can serve several destinations, such as a LinkedIn member and the organizations that member manages.
- When destinations share an authorization, **Disconnect this destination** removes only the selected destination. The other destinations and their saved credentials remain active.
- **Remove saved authorization** deletes OpenPost's encrypted credentials and disconnects every destination that uses them. When only one destination remains, **Remove connection** is the only removal action so a live credential cannot be left behind without an active destination.
- Removing a saved authorization does not disable the token, app password, or webhook at the provider. Use the provider's connected-app, app-password, or webhook settings when provider-side access must also be revoked.
- These account actions do not delete the operator's provider app configuration from environment variables, `OPENPOST_PROVIDER_APPS`, or the provider app registry.
- Each platform has its own callback and permission needs.
- Authenticated clients can call `GET /api/v1/accounts/providers` to discover which provider apps are configured before showing connect actions.
- Mastodon can use either preconfigured instances or the custom instance field on the Accounts screen. Custom instances must be public HTTPS servers.
