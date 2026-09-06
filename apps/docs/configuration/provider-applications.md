# Provider Applications

This page is for operators configuring provider OAuth applications.

A provider application identifies the OpenPost installation to a social network during OAuth. It is instance configuration, not a user's connected social-account token and not an OpenPost API or CLI token.

OpenPost manages encrypted provider-application rows for `x`, `mastodon`, `linkedin`, `threads`, `facebook`, `instagram`, `tiktok`, `youtube`, `pinterest`, `telegram`, and Discord bot mode. Bluesky app passwords and Discord incoming webhooks remain user-owned connection modes, so the administrator API rejects those credential shapes.

A configured provider application is not a public availability claim. Pinterest, Telegram bot mode, and Discord bot mode remain hidden or blocked for public Hosted use until their exact approval, scope, policy, runtime-control, and current live-certification evidence passes. Existing Discord incoming-webhook connections use a separate mode and remain supported.

## Ownership

Provider console access, app review, callback registration, and the client credentials belong to the operator of the OpenPost instance.

| Deployment              | Responsible party                                                                                                                                                                                      | Recommended credential source                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| OpenPost Hosted service | The service operator owns the production provider projects, approvals, callbacks, and deployment secrets. Workspace users and workspace administrators do not provide the shared provider application. | Deployment secret storage exposed through legacy provider variables or `OPENPOST_PROVIDER_APPS_FILE`. |
| Self-hosted instance    | The self-hosted operator owns each provider project and grants instance-admin access only to people trusted to manage instance secrets.                                                                | Either deployment secret storage or encrypted database rows managed in the app or API.                |

OpenPost does not use the edition setting to remove the encrypted database API. An instance administrator on either edition can manage database fallback rows. On the Hosted service, an operator-owned environment entry remains authoritative, so an instance administrator cannot replace it through the database API.

## Where to configure an app

An instance administrator can open **Settings → Instance → Configuration → Provider apps** for the existing OAuth form. Pinterest, Telegram, and Discord bot contract fields can be configured through `OPENPOST_PROVIDER_APPS` or the administrator API. Database-backed operations are available at:

| Method   | Route                              | Result                                                                                                       |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/admin/provider-apps`      | Lists non-secret metadata for database rows and effective environment entries.                               |
| `POST`   | `/api/v1/admin/provider-apps`      | Creates or updates one encrypted database row. Omitting a secret field on update preserves its stored value. |
| `DELETE` | `/api/v1/admin/provider-apps/{id}` | Deletes a database row. It cannot delete an environment entry.                                               |

All three routes require a signed-in browser session for an unscoped instance administrator. API, CLI, and MCP bearer tokens are rejected, including tokens owned by an instance administrator. A workspace role, including workspace administrator, does not grant instance administration. The Settings navigation hides the page from other users, but the backend authorization check is the security boundary.

The database identity is the provider key for every listed provider except Mastodon. Mastodon uses the provider key plus its normalized `instance_url`, which permits one configured app per server. The API rejects `instance_url` for other providers.

## Source precedence

OpenPost builds the effective adapter registry during server startup. For the same provider identity, the order from highest to lowest precedence is:

1. Operator-owned provider configuration from legacy variables or `OPENPOST_PROVIDER_APPS` and its `_FILE` form.
2. An active encrypted `provider_apps` database row.
3. A dynamically registered Mastodon application for the same server.

Environment-defined apps appear in Settings with non-secret metadata, but they are read-only and cannot be deleted through the API. If a database fallback exists for the same identity, it remains visible as a stored fallback. It cannot be edited while shadowed, but it can be deleted. To change or disable an environment-defined app, update the deployment configuration and restart OpenPost.

Bluesky and Discord webhook adapters are built in and do not use this precedence chain. A Discord bot application is a separate instance-owned configuration. Mastodon applications created automatically from the Accounts flow are stored separately from administrator-managed `provider_apps` rows.

## Secret handling

- Database-backed client secrets, bot tokens, and webhook verification secrets are encrypted with AES-256-GCM using the key derived from `OPENPOST_ENCRYPTION_KEY`. The table stores only encrypted secret columns.
- List and save responses return presence booleans such as `secret_configured`, `bot_token_configured`, and `webhook_secret_configured`, never stored secret values. They return only non-secret metadata such as client/application ID, callback URL, bot username, provider name, and Mastodon instance URL.
- API clients must omit a secret field to preserve its existing ciphertext. Supplying a new value replaces OpenPost's stored copy; rotate the provider-side credential as part of the same procedure.
- Environment and file-backed secrets remain in deployment configuration. OpenPost does not copy them into `provider_apps`.
- Back up `OPENPOST_ENCRYPTION_KEY` separately from the database and protect both. OpenPost cannot decrypt database-backed provider apps after the key is lost or replaced.

Do not put `OPENPOST_PROVIDER_APPS` JSON with client secrets in a Compose file, shell history, image, or repository. Prefer `OPENPOST_PROVIDER_APPS_FILE` or the secret-file mechanism of the deployment platform. A client ID is public application metadata; a client secret is sensitive.

## Applying and removing changes

The provider adapter registry is not rebuilt during a request. A save or delete response therefore reports `requires_restart: true`, and the Settings page shows the same restart requirement. Restart through the deployment's normal controlled process, then verify the provider's callback and readiness before allowing production connections.

Deleting or deactivating a database row does not revoke credentials at the social network and does not erase existing connected-account tokens. After restart, removing the effective app can prevent new OAuth connections and provider operations that require its adapter. Revoke provider-side access in the provider console when that is the intended outcome.

If an active database row cannot be decrypted, startup fails instead of silently loading a broken provider adapter. Restore the matching encryption key before retrying the start. If that key is unavailable, recover a database-and-key backup that was captured as one matched set.

See [Environment Variables](/configuration/environment-variables) for the JSON schema and legacy variables, [Callback URLs](/reference/callback-urls) for exact redirect paths, and [Provider Readiness and Launch Gate](/operations/provider-launch-matrix) for the separate approval and live-verification requirements.
