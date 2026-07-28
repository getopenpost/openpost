# Accounts

Connected accounts are provider-specific identities inside a workspace.

## Common flow

1. Open the accounts screen.
2. Choose a provider.
3. Complete the provider auth flow.
4. Return to OpenPost and confirm the account is listed.

## Notes

- Disconnecting an account does not delete server-side provider app credentials from env vars, `OPENPOST_PROVIDER_APPS`, or the provider app registry.
- Stored OAuth tokens are encrypted at rest.
- Each provider has its own callback and permission requirements.
- Authenticated clients can call `GET /api/v1/accounts/providers` to discover which provider apps are configured before showing connect actions.
- Mastodon can use either preconfigured instances or the custom instance field on the Accounts screen. Custom instances must be public HTTPS servers.
