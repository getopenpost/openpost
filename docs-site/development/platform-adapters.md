# Platform Adapters

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
- Instagram Business uses this flow to select the connected Instagram account behind a Facebook Page.
- YouTube uses this flow to select a channel and preserve the Google refresh token.

Adapters for those providers should implement `platform.AccountSelectionAdapter` in addition to the base adapter. The OAuth callback stores encrypted pending tokens in `oauth_account_selections`, redirects with `status=selection_required`, and exposes:

- `GET /api/v1/accounts/selections/{connection_id}` for non-secret account/page/channel options.
- `POST /api/v1/accounts/selections/{connection_id}/complete` to resolve the selected option and save the final account through `AccountSaver`.

Do not store page/channel access tokens in selection options. Keep secrets in the encrypted pending token row or fetch provider-specific page tokens during `SelectAccount`.

## Adding a new platform

- [ ] Create `internal/platform/newplatform.go`
- [ ] Implement the platform adapter interface
- [ ] Implement `AccountSelectionAdapter` if OAuth needs page, account, or channel selection
- [ ] Register the provider in backend startup
- [ ] Add env vars to `.env.example`
- [ ] Add the frontend connect flow
- [ ] Add the platform icon
- [ ] Add provider docs
- [ ] Add tests or a manual test checklist
