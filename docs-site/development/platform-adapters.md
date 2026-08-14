# Platform Adapters

This page is for contributors adding or changing a provider adapter.

Provider integrations live under `backend/internal/platform/`.

## Current adapters

- `x.go`
- `mastodon.go`
- `bluesky.go`
- `linkedin.go`
- `threads.go`
- `facebook.go`
- `instagram.go`
- `tiktok.go`
- `youtube.go`
- `discord.go`

Publishing uses the base `platform.Adapter`. Other features use optional interfaces:

- `AnalyticsAdapter` reads account and post results.
- `CommentAdapter` and `EngagementAdapter` read and manage comments.
- `MessagingAdapter` reads account inboxes after a workspace editor turns sync on.
- `AccountSelectionAdapter` lets a user choose a Page, Instagram account, or YouTube channel after OAuth.
- `AuthorizationGrantDescriber` identifies the non-secret provider project and execution mode that issued a credential.

Keep these interfaces separate. A network can support publishing without supporting every read or moderation action.

## Provider app configuration

Provider app credentials are normalized into `platform.AppConfig` before startup builds the adapter registry. Self-hosted installs can use legacy env vars or `OPENPOST_PROVIDER_APPS`; hosted/operator-managed installs can store encrypted rows in `provider_apps`.

Instance admins can manage encrypted database rows through:

- `GET /api/v1/admin/provider-apps`
- `POST /api/v1/admin/provider-apps`
- `DELETE /api/v1/admin/provider-apps/{id}`

The write API encrypts `client_secret`, never returns stored secrets, and reports `requires_restart: true` because adapter changes are applied on server startup. If `client_secret` is omitted on update, the existing encrypted secret is preserved.

## Account selection

Most providers can save a connected account directly after OAuth profile lookup. Some larger platforms need a second step:

- Facebook uses this flow to select a Page and save the Page token.
- Instagram uses this flow to select a connected Business or Creator account behind a Facebook Page.
- YouTube uses this flow to select a channel and preserve the Google refresh token.

Adapters for those providers should implement `platform.AccountSelectionAdapter` in addition to the base adapter. The OAuth callback stores encrypted pending tokens in `oauth_account_selections`, redirects with `status=selection_required`, and exposes:

- `GET /api/v1/accounts/selections/{connection_id}` for non-secret account/page/channel options.
- `POST /api/v1/accounts/selections/{connection_id}/complete` to resolve the selected option and save the final account through `AccountSaver`.

Do not store page/channel access tokens in selection options. Keep secrets in the encrypted pending token row or fetch provider-specific page tokens during `SelectAccount`.

Pending selections preserve both access-token and refresh-token expiry. The authorizing provider subject is resolved before selection so destinations created from one authorization can share the correct grant without treating a Page or organization ID as the authorizing user.

## Saved authorization grants

Migration 073 owns the `oauth_grants` table and backfills every legacy account credential without decrypting or rewriting its ciphertext. `social_accounts.oauth_grant_id` links destinations to the grant; legacy account token columns remain only for rolling-upgrade compatibility and are cleared by the migration and all current writes.

The grant records the workspace, provider, provider project, authorizing subject, instance, execution mode, scopes, both expiries, token type and version, consent and validation state, non-secret authorization evidence, refresh lease state, and revocation metadata. `AccountSaver` reuses a grant only when its normalized workspace/provider/project/subject/instance/execution authority matches the new connection. A destination reauthorized under another authority moves to a new grant without rotating credentials for its siblings.

Credential refresh is grant-scoped. `TokenManager` acquires an expiring refresh lease, calls the provider outside a database transaction, and persists rotating access and refresh tokens with a token-version compare-and-swap. Sibling requests wait for that version change instead of exchanging the same rotating refresh credential again. Revocation clears both encrypted tokens, increments the version, releases the lease, disconnects the grant's destinations, and cancels its pending refresh job. Every runtime account-to-grant lookup and sibling update also requires the same workspace, so a corrupt cross-workspace reference fails closed.

The removal APIs have intentionally different effects:

- `DELETE /api/v1/accounts/{account_id}` disconnects one destination only. It returns a conflict for the final active destination so it cannot leave an unused live grant and refresh job.
- `DELETE /api/v1/accounts/{account_id}/grant` removes OpenPost's saved credential and disconnects all destinations using it. It does not call the provider's revocation API; clients must describe provider-side revocation separately.

SQLite runs with serialized write access, while PostgreSQL uses the same grant-row update as the refresh/disconnect serialization point. Keep the SQLite concurrency tests and the conditional `OPENPOST_TEST_POSTGRES_URL` integration tests green when changing lease, rotation, disconnect, or migration behavior.

## Adding a new platform

- [ ] Create `internal/platform/newplatform.go`
- [ ] Implement the publishing adapter
- [ ] Add only the optional analytics, comment, inbox, or account-selection interfaces the platform supports
- [ ] Implement `AccountSelectionAdapter` if OAuth needs page, account, or channel selection
- [ ] Implement `AuthorizationGrantDescriber` with a stable non-secret project ID and execution mode
- [ ] Register the provider in backend startup
- [ ] Add env vars to `.env.example`
- [ ] Add the frontend connect flow
- [ ] Add the platform icon
- [ ] Add provider docs
- [ ] Add tests or a manual test checklist
