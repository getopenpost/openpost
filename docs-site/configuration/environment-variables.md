# Environment Variables

This page summarizes the env vars used by the backend. Some values in `.env.example` are recommended deployment examples; code defaults may differ.

## File-backed values

Most variables loaded through the main backend config loader can also be loaded from `<VARIABLE>_FILE`. OpenPost checks the direct variable first, then its file variant, then any legacy aliases and their file variants. File contents are trimmed before use.

Adapter-only variables read directly by provider code, such as `META_GRAPH_API_VERSION`, do not currently support `_FILE` variants.

This is useful for Docker, Podman, Kubernetes, NixOS, and sops-managed secrets:

```sh
OPENPOST_JWT_SECRET_FILE=/run/secrets/openpost-jwt-secret
OPENPOST_ENCRYPTION_KEY_FILE=/run/secrets/openpost-encryption-key
OPENPOST_DATABASE_URL_FILE=/run/secrets/openpost-database-url
```

Leave the direct variable unset when you want the file value to win.

## Admin-managed optional settings

Instance administrators can manage account policy, Whop billing, authentication, email, Studio, stock media, feedback, provider behavior, and provider-app settings in **Settings → Instance → Configuration**. OpenPost encrypts every database-backed value with `OPENPOST_ENCRYPTION_KEY`; secret values are write-only and the API only reports whether one exists.

Configuration precedence is:

1. a direct environment variable or its `_FILE` variant;
2. an encrypted administrator setting in the database;
3. the documented application default.

Environment-managed values appear read-only in the interface. If a database fallback exists beneath an environment value, the screen identifies it and lets an administrator remove it so deleting the environment variable cannot unexpectedly reactivate old configuration. Database changes are validated and saved together, then take effect after the next server restart. Removing any other database override returns the setting to its environment value or default.

Bootstrap and data-plane settings stay deployment-only because OpenPost needs them before it can read the database: edition, port, database driver and DSN, public application origins and CORS, `OPENPOST_JWT_SECRET`, `OPENPOST_ENCRYPTION_KEY`, and storage. Whop billing values can come from either the deployment environment or the encrypted instance-admin registry; configure the complete required set before restarting a cloud instance. Adapter-only variables such as `META_GRAPH_API_VERSION` also remain deployment-only.

## Core settings

| Variable                                        |                                                  Required | Default                                      | Description                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------: | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENPOST_PORT`                                 |                                                        No | `8080`                                       | HTTP server port.                                                                                                                                                                        |
| `OPENPOST_EDITION`                              |                                                        No | `selfhost`                                   | Product edition. Valid values: `selfhost`, `cloud`. Cloud mode enforces hosted storage requirements at startup.                                                                          |
| `OPENPOST_DATABASE_DRIVER`                      |                      Required as `postgres` in cloud mode | `sqlite`                                     | Database driver. Valid values: `sqlite`, `postgres`. SQLite remains the self-hosted default.                                                                                             |
| `OPENPOST_DATABASE_PATH`                        |                                                        No | `file:openpost.db?cache=shared&mode=rwc`     | SQLite database path or DSN. Also acts as a legacy fallback DSN for Postgres if `OPENPOST_DATABASE_URL` is unset.                                                                        |
| `OPENPOST_DATABASE_URL`                         |                      Required for Postgres and cloud mode | empty                                        | Postgres connection URL used when `OPENPOST_DATABASE_DRIVER=postgres`.                                                                                                                   |
| `OPENPOST_APP_URL`                              |                        No, but set it in real deployments | `http://localhost:8080`                      | Public frontend origin used for CORS and auth flow assumptions.                                                                                                                          |
| `OPENPOST_PUBLIC_URL`                           |                                                        No | falls back to `OPENPOST_APP_URL`             | Canonical browser origin used when configuring WebAuthn/passkeys. Set this to your real app URL in production.                                                                           |
| `OPENPOST_EXTRA_CORS_ORIGINS`                   |                                                        No | empty                                        | Extra comma-separated origins to allow. Cloud mode allows only `OPENPOST_APP_URL` plus these explicit origins and rejects `*`.                                                           |
| `OPENPOST_DISABLE_REGISTRATIONS`                |                                                        No | `false`                                      | Disables new self-service signups after setup. The first account on a fresh instance is still allowed and becomes the instance admin automatically.                                      |
| `OPENPOST_LEGAL_ACCEPTANCE_REQUIRED`            |                                    Required in cloud mode | `false` for self-host, `true` for cloud      | Requires explicit registration acceptance of the configured Terms and Privacy Policy versions.                                                                                           |
| `OPENPOST_TERMS_URL`                            |                                    Required in cloud mode | hosted URL in cloud, empty otherwise         | Public Terms of Service URL shown during registration.                                                                                                                                   |
| `OPENPOST_PRIVACY_URL`                          |                                    Required in cloud mode | hosted URL in cloud, empty otherwise         | Public Privacy Policy URL shown during registration.                                                                                                                                     |
| `OPENPOST_TERMS_VERSION`                        |                                    Required in cloud mode | hosted policy date in cloud, empty otherwise | Version stored on the user record when the terms are accepted.                                                                                                                           |
| `OPENPOST_PRIVACY_VERSION`                      |                                    Required in cloud mode | hosted policy date in cloud, empty otherwise | Version stored on the user record when the privacy policy is acknowledged.                                                                                                               |
| `OPENPOST_SUPPORT_EMAIL`                        |                                    Required in cloud mode | `openpost@rgo.pt` in cloud, empty otherwise  | Support contact shown when password recovery is unavailable.                                                                                                                             |
| `OPENPOST_EMAIL_VERIFICATION_REQUIRED`          |                                    Required in cloud mode | `false` for self-host, `true` for cloud      | Requires a new email-and-password account to confirm a six-digit code before OpenPost creates a session. Existing users are marked verified during migration.                            |
| `OPENPOST_EMAIL_PROVIDER`                       |                                                        No | inferred when possible                       | Optional mail transport: `smtp`, `resend`, or `cloudflare`. When verification is required but no transport is ready, password registration is unavailable until an admin configures one. |
| `OPENPOST_EMAIL_FROM`                           |                      Required when a mail provider is set | falls back to `OPENPOST_SMTP_FROM`           | Verified sender used for signup codes and password resets.                                                                                                                               |
| `OPENPOST_RESEND_API_KEY`                       |                         Required for the Resend transport | empty                                        | Resend API key. Supports `OPENPOST_RESEND_API_KEY_FILE`.                                                                                                                                 |
| `OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID`          |                     Required for the Cloudflare transport | empty                                        | Cloudflare account ID for Email Service.                                                                                                                                                 |
| `OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN`           |                     Required for the Cloudflare transport | empty                                        | Cloudflare API token with Email Sending permission. Supports `OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN_FILE`.                                                                                 |
| `OPENPOST_SMTP_HOST`                            |                           Required for the SMTP transport | empty                                        | SMTP host used for signup verification and password-reset mail.                                                                                                                          |
| `OPENPOST_SMTP_PORT`                            |                                                        No | `587`                                        | SMTP port. Use 587 with STARTTLS or 465 with implicit TLS.                                                                                                                               |
| `OPENPOST_SMTP_USERNAME`                        |                                                        No | empty                                        | SMTP authentication username.                                                                                                                                                            |
| `OPENPOST_SMTP_PASSWORD`                        |                        Required when SMTP username is set | empty                                        | SMTP authentication password. Supports `OPENPOST_SMTP_PASSWORD_FILE`.                                                                                                                    |
| `OPENPOST_SMTP_FROM`                            |                                                        No | empty                                        | Legacy SMTP sender fallback for `OPENPOST_EMAIL_FROM`.                                                                                                                                   |
| `OPENPOST_SMTP_TLS_MODE`                        |                                                        No | `starttls`                                   | `starttls`, `tls`, or `none`. Plaintext mode is rejected for non-loopback hosts.                                                                                                         |
| `OPENPOST_SMTP_SERVER_NAME`                     |                                                        No | SMTP hostname                                | Optional TLS server-name override.                                                                                                                                                       |
| `OPENPOST_JWT_SECRET`                           |                                                       Yes | none                                         | Secret used to sign JWTs. Must be at least 32 characters.                                                                                                                                |
| `OPENPOST_ENCRYPTION_KEY`                       |                                                       Yes | none                                         | Secret used to encrypt stored OAuth tokens. Must be at least 32 characters.                                                                                                              |
| `OPENPOST_AUTH_GOOGLE_CLIENT_ID`                |                                                        No | empty                                        | Google OAuth client ID. Enables first-party Google sign-in and account linking when paired with its secret.                                                                              |
| `OPENPOST_AUTH_GOOGLE_CLIENT_SECRET`            |          Required when the Google client ID is configured | empty                                        | Google OAuth client secret. Prefer `OPENPOST_AUTH_GOOGLE_CLIENT_SECRET_FILE` in production.                                                                                              |
| `OPENPOST_OIDC_ISSUER`                          |                                                        No | empty                                        | Exact issuer for the optional instance-wide OIDC provider. Private network issuers are allowed because this is trusted operator configuration.                                           |
| `OPENPOST_OIDC_CLIENT_ID`                       |                          Required when OIDC issuer is set | empty                                        | Client ID for the instance-wide OIDC provider.                                                                                                                                           |
| `OPENPOST_OIDC_CLIENT_SECRET`                   |                                                        No | empty                                        | OIDC client secret. Prefer `OPENPOST_OIDC_CLIENT_SECRET_FILE` in production.                                                                                                             |
| `OPENPOST_OIDC_NAME`                            |                                                        No | `Single sign-on`                             | Provider label shown on the login page.                                                                                                                                                  |
| `OPENPOST_OIDC_SCOPES`                          |                                                        No | `openid profile email`                       | Space- or comma-separated OIDC scopes. OpenPost always includes `openid`.                                                                                                                |
| `OPENPOST_OIDC_JIT_ENABLED`                     |                                                        No | `false`                                      | Creates a passwordless local user after a verified first login. Existing accounts with the same email are never linked automatically.                                                    |
| `OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST`             |                                                        No | empty                                        | Comma-separated exact issuer-and-subject pairs or emails that may become instance admin during environment-provider JIT.                                                                 |
| `OPENPOST_SSO_BREAK_GLASS_EMAILS`               |                                                        No | empty                                        | Existing instance admins that may bypass required workspace SSO. Each account must already have a local password and TOTP or passkey.                                                    |
| `OPENPOST_OIDC_NATIVE_CALLBACK_URL`             |                                                        No | `openpost://oidc/callback`                   | Universal or app link that receives an opaque, one-time native handoff code. It never receives an OpenPost JWT.                                                                          |
| `OPENPOST_STORAGE_DRIVER`                       |                            Required as `s3` in cloud mode | `local`                                      | Media storage driver. Valid values: `local`, `s3`.                                                                                                                                       |
| `OPENPOST_MEDIA_PATH`                           |                                                        No | `./media`                                    | Local directory for uploaded media.                                                                                                                                                      |
| `OPENPOST_MEDIA_URL`                            | No, but required for public-URL provider media publishing | `/media`                                     | Public base URL for media files.                                                                                                                                                         |
| `OPENPOST_S3_ENDPOINT`                          |          Required for R2 or non-AWS S3-compatible storage | empty                                        | S3-compatible API endpoint. Native AWS S3 can leave this empty.                                                                                                                          |
| `OPENPOST_S3_REGION`                            |         Required for S3-compatible storage and cloud mode | empty                                        | S3 region. R2 commonly uses `auto`.                                                                                                                                                      |
| `OPENPOST_S3_BUCKET`                            |         Required for S3-compatible storage and cloud mode | empty                                        | Bucket name for uploaded media.                                                                                                                                                          |
| `OPENPOST_S3_ACCESS_KEY_ID`                     |         Required for S3-compatible storage and cloud mode | empty                                        | S3 access key ID.                                                                                                                                                                        |
| `OPENPOST_S3_SECRET_ACCESS_KEY`                 |         Required for S3-compatible storage and cloud mode | empty                                        | S3 secret access key.                                                                                                                                                                    |
| `OPENPOST_S3_PUBLIC_BASE_URL`                   |                                    Required in cloud mode | empty                                        | Public media base URL for provider fetches and preview links.                                                                                                                            |
| `OPENPOST_S3_FORCE_PATH_STYLE`                  |                                                        No | `false`                                      | Force path-style S3 addressing for compatible providers that require it.                                                                                                                 |
| `OPENPOST_STUDIO_ENABLED`                       |                                                        No | `true`                                       | Enables Studio routes and APIs. Set `false` for an operational rollback; Media upload and library features remain available and Studio migrations still run.                             |
| `OPENPOST_STUDIO_MODEL_BASE_URL`                |                                                        No | `/studio-models`                             | Base URL for the background-removal model, WASM, and runtime assets. Leave unset to use the files embedded with OpenPost.                                                                |
| `OPENPOST_VIDEO_STUDIO_ENABLED`                 |                                                        No | `false`                                      | Enables the private-beta Video Studio routes and authenticated cloud-project APIs. Keep disabled on public instances until the beta gates pass.                                          |
| `OPENPOST_VIDEO_MODEL_BASE_URL`                 |                                                        No | `/video-studio-models`                       | Base URL for the pinned transcription and voice-detection model files. Leave unset to use embedded files.                                                                                |
| `OPENPOST_STOCK_MEDIA_ENABLED`                  |                                                        No | `false`                                      | Enables rate-limited stock search for providers that also have a configured server-side key.                                                                                             |
| `OPENPOST_PEXELS_API_KEY`                       |                                                        No | empty                                        | Server-only Pexels API key for photo and video search.                                                                                                                                   |
| `OPENPOST_UNSPLASH_ACCESS_KEY`                  |                                                        No | empty                                        | Server-only Unsplash access key for photo search and required selection tracking.                                                                                                        |
| `OPENPOST_PIXABAY_API_KEY`                      |                                                        No | empty                                        | Server-only Pixabay API key for image and video search.                                                                                                                                  |
| `OPENPOST_FEEDBACK_ENABLED`                     |                                                        No | `false`                                      | Shows the authenticated feedback form only when a valid destination and recipient are also configured.                                                                                   |
| `OPENPOST_FEEDBACK_DESTINATION_URL`             |                         Required when feedback is enabled | empty                                        | Server-only HTTPS Discord-compatible webhook. Use `OPENPOST_FEEDBACK_DESTINATION_URL_FILE` for a managed secret.                                                                         |
| `OPENPOST_FEEDBACK_RECIPIENT`                   |                         Required when feedback is enabled | empty                                        | Plain recipient name shown to users before they send a report, such as `OpenPost team` or `Example operator`.                                                                            |
| `OPENPOST_FEEDBACK_SUPPORT_URL`                 |                                                        No | OpenPost GitHub new-issue URL                | HTTPS support link shown when the report form is disabled. Query strings and fragments are removed.                                                                                      |
| `OPENPOST_UPDATE_CHECK_ENABLED`                 |                                                        No | `true`                                       | Enables the read-only stable release check for self-hosted instance admins. Cloud mode never checks.                                                                                     |
| `OPENPOST_WHOP_API_KEY`                         |                                    Required in cloud mode | empty                                        | Server-only Whop API key used to create checkout configurations and reconcile memberships.                                                                                               |
| `OPENPOST_WHOP_API_BASE_URL`                    |                                                        No | `https://api.whop.com/api/v1`                | Whop API base URL.                                                                                                                                                                       |
| `OPENPOST_WHOP_WEBHOOK_SECRET`                  |                                    Required in cloud mode | empty                                        | Whop Standard Webhooks secret used to verify billing events.                                                                                                                             |
| `OPENPOST_WHOP_ACCOUNT_ID`                      |                                    Required in cloud mode | empty                                        | Whop business account ID that owns the OpenPost product.                                                                                                                                 |
| `OPENPOST_WHOP_PRODUCT_ID`                      |                                    Required in cloud mode | empty                                        | Whop product ID for OpenPost managed plans.                                                                                                                                              |
| `OPENPOST_WHOP_CHECKOUT_RETURN_URL`             |                                                        No | `<OPENPOST_APP_URL>/checkout?status=success` | Browser return URL after an embedded checkout completes.                                                                                                                                 |
| `OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID`         |                                    Required in cloud mode | empty                                        | Whop Starter monthly plan ID.                                                                                                                                                            |
| `OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID`          |                                    Required in cloud mode | empty                                        | Whop Starter annual plan ID.                                                                                                                                                             |
| `OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID`         |                                    Required in cloud mode | empty                                        | Whop Creator monthly plan ID.                                                                                                                                                            |
| `OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID`          |                                    Required in cloud mode | empty                                        | Whop Creator annual plan ID.                                                                                                                                                             |
| `OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID`             |                                    Required in cloud mode | empty                                        | Whop Pro monthly plan ID.                                                                                                                                                                |
| `OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID`              |                                    Required in cloud mode | empty                                        | Whop Pro annual plan ID.                                                                                                                                                                 |
| `OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID`            |                                    Required in cloud mode | empty                                        | Whop Team monthly plan ID.                                                                                                                                                               |
| `OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID`             |                                    Required in cloud mode | empty                                        | Whop Team annual plan ID.                                                                                                                                                                |
| `OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID`          |                                    Required in cloud mode | empty                                        | Whop Agency monthly plan ID.                                                                                                                                                             |
| `OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID`           |                                    Required in cloud mode | empty                                        | Whop Agency annual plan ID.                                                                                                                                                              |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD`            |                                                        No | `5000000`                                    | Cloud-only per-workspace X request safety limit in millionths of a US dollar. `0` blocks hosted X publishing.                                                                            |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD`          |                                                        No | `15000`                                      | Estimated cloud X cost for a post without a URL, in millionths of a US dollar. Keep this aligned with current X pricing.                                                                 |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD` |                                                        No | `200000`                                     | Estimated cloud X cost for a post with a URL, in millionths of a US dollar. Keep this aligned with current X pricing.                                                                    |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS`        |                                                        No | `180`                                        | Retention for confirmed provider-cost events and unresolved reservations. Startup pruning is bounded and never removes the open month.                                                   |

## Update status

When enabled in `selfhost` mode, the Instance settings page lets an instance admin compare the running version and build revision with the latest stable OpenPost release. The server checks the fixed public GitHub release endpoint only when an admin requests this page. It sends no hostname, account data, content, or credentials.

Successful responses are cached for 24 hours. Failed checks retry after 15 minutes, use a three-second timeout, and keep the last successful result as stale. Responses are limited to 64 KiB and release links must point back to the official OpenPost GitHub repository. The feature never downloads or installs an update. See [Update Status](/configuration/update-status) for the full boundary.

## Provider app registry

OpenPost builds provider adapters at startup from active encrypted `provider_apps` database rows, legacy provider env vars, and optional `OPENPOST_PROVIDER_APPS` JSON. Environment-defined apps are authoritative over matching database rows.

Database rows are intended for administrator-managed installs. They store `client_secret_encrypted` with the same `OPENPOST_ENCRYPTION_KEY` used for account tokens and act as fallbacks when no matching environment app exists. They require a server restart after changes. Matching is by provider, except Mastodon uses provider plus `instance_url`.

Instance admins can manage encrypted database rows through `GET /api/v1/admin/provider-apps`, `POST /api/v1/admin/provider-apps`, and `DELETE /api/v1/admin/provider-apps/{id}`. API responses never return client secrets; send `client_secret` only when creating a row or rotating the existing secret.

The backend exposes this registry through the instance-admin API and **Settings → Instance → Configuration → Provider apps**. Environment-defined apps appear as read-only. A matching database fallback stays visible and can be deleted while the environment app remains active. Admin-added client secrets are encrypted and never returned. Saves and deletes take effect after the next OpenPost server restart.

## X

| Variable                 |  Required | Default                         | Description                                                                                                        |
| ------------------------ | --------: | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `OPENPOST_PROVIDER_APPS` |        No | empty                           | Structured JSON provider app registry. Entries override matching legacy env providers and encrypted database rows. |
| `X_CLIENT_ID`            | Yes for X | empty                           | X OAuth client ID. Leave empty to disable X.                                                                       |
| `X_CLIENT_SECRET`        | Yes for X | empty                           | X OAuth client secret.                                                                                             |
| `X_REDIRECT_URI`         |        No | derived from `OPENPOST_APP_URL` | X OAuth callback URL override.                                                                                     |

## Mastodon

| Variable                | Required | Default                     | Description                                                                                                                                       |
| ----------------------- | -------: | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MASTODON_REDIRECT_URI` |       No | `urn:ietf:wg:oauth:2.0:oob` | Mastodon redirect URI. The default uses the OOB flow and does not need a public callback URL.                                                     |
| `MASTODON_SERVERS`      |       No | `[]`                        | JSON array of operator-pinned Mastodon apps and instance URLs. Leave empty when relying on custom instance registration from the Accounts screen. |

## LinkedIn

| Variable                                   |         Required | Default                         | Description                                                                                                                |
| ------------------------------------------ | ---------------: | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `LINKEDIN_CLIENT_ID`                       | Yes for LinkedIn | empty                           | LinkedIn OAuth client ID. Leave empty to disable LinkedIn.                                                                 |
| `LINKEDIN_CLIENT_SECRET`                   | Yes for LinkedIn | empty                           | LinkedIn OAuth client secret.                                                                                              |
| `LINKEDIN_REDIRECT_URI`                    |               No | derived from `OPENPOST_APP_URL` | LinkedIn callback URL override.                                                                                            |
| `OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES` |               No | `false`                         | Disable LinkedIn comment-style child replies for thread posts. Legacy `LINKEDIN_DISABLE_THREAD_REPLIES` remains supported. |
| `OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED`  |               No | `false`                         | Request approved LinkedIn organization permissions and offer administered Pages during connection.                         |
| `LINKEDIN_API_VERSION`                     |               No | previous calendar month         | Override the LinkedIn REST API version. Read directly by the adapter; `_FILE` is not supported.                            |

## Threads

| Variable                 |        Required | Default                         | Description                                                                 |
| ------------------------ | --------------: | ------------------------------- | --------------------------------------------------------------------------- |
| `THREADS_CLIENT_ID`      | Yes for Threads | empty                           | Meta app ID. Leave empty to disable Threads.                                |
| `THREADS_CLIENT_SECRET`  | Yes for Threads | empty                           | Meta app secret.                                                            |
| `THREADS_REDIRECT_URI`   |              No | derived from `OPENPOST_APP_URL` | Threads callback URL override. Threads production redirects must use HTTPS. |
| `META_GRAPH_API_VERSION` |              No | `v25.0`                         | Meta Graph API version used by the Facebook Pages and Instagram adapters.   |

## Facebook

Facebook Pages publishing is configured through the provider app registry instead of legacy provider-specific env vars. Use `OPENPOST_PROVIDER_APPS` for bootstrap/self-hosting or the instance-admin provider app API for hosted/operator-managed credentials.

Example:

```json
[
  {
    "provider": "facebook",
    "client_id": "your-meta-app-id",
    "client_secret": "your-meta-app-secret"
  }
]
```

If `redirect_uri` is omitted, OpenPost derives `https://your-domain.com/api/v1/accounts/facebook/callback` from `OPENPOST_APP_URL`. Facebook media publishing requires `OPENPOST_MEDIA_URL` or `OPENPOST_S3_PUBLIC_BASE_URL` to point at public HTTPS media URLs.

## Instagram

Instagram professional publishing is configured through the provider app registry instead of legacy provider-specific env vars. Use `OPENPOST_PROVIDER_APPS` for bootstrap/self-hosting or the instance-admin provider app API for hosted/operator-managed credentials.

Example:

```json
[
  {
    "provider": "instagram",
    "client_id": "your-meta-app-id",
    "client_secret": "your-meta-app-secret"
  }
]
```

If `redirect_uri` is omitted, OpenPost derives `https://your-domain.com/api/v1/accounts/instagram/callback` from `OPENPOST_APP_URL`. Instagram media publishing requires `OPENPOST_MEDIA_URL` or `OPENPOST_S3_PUBLIC_BASE_URL` to point at public HTTPS media URLs.

## TikTok

TikTok is configured through the provider app registry instead of legacy provider-specific env vars. Use `OPENPOST_PROVIDER_APPS` for bootstrap/self-hosting or the instance-admin provider app API for hosted/operator-managed credentials.

Example:

```json
[
  {
    "provider": "tiktok",
    "client_id": "your-client-key",
    "client_secret": "your-client-secret",
    "redirect_uri": "https://your-domain.com/api/v1/accounts/tiktok/callback"
  }
]
```

TikTok direct video publishing requires `OPENPOST_MEDIA_URL` or `OPENPOST_S3_PUBLIC_BASE_URL` to point at public HTTPS media URLs.

## YouTube

YouTube video uploads are configured through the provider app registry instead of legacy provider-specific env vars. Use `OPENPOST_PROVIDER_APPS` for bootstrap/self-hosting or the instance-admin provider app API for hosted/operator-managed credentials.

Example:

```json
[
  {
    "provider": "youtube",
    "client_id": "your-google-oauth-client-id",
    "client_secret": "your-google-oauth-client-secret"
  }
]
```

If `redirect_uri` is omitted, OpenPost derives `https://your-domain.com/api/v1/accounts/youtube/callback` from `OPENPOST_APP_URL`. OpenPost uploads one video per YouTube rendition, uses private visibility by default, accepts explicit YouTube privacy and metadata settings, and derives fallback title and description text from the post or platform variant.

## Notes

- The preferred names above are what new deployments should use.
- `OPENPOST_PROVIDER_APPS` accepts an array of objects with `provider`, `name`, `client_id`, `client_secret`, `redirect_uri`, and `instance_url`. The Configuration screen stores the same logical fields in `provider_apps`, with `client_secret` encrypted into `client_secret_encrypted`. Both support `x`, `mastodon`, `linkedin`, `threads`, `facebook`, `instagram`, `tiktok`, and `youtube`; Bluesky uses app-password login and Discord uses a webhook.
- Backward-compatible aliases still work for existing installs: `DATABASE_URL`, `OPENPOST_DB_PATH`, `OPENPOST_FRONTEND_URL`, `OPENPOST_CORS_EXTRA_ORIGINS`, `JWT_SECRET`, `ENCRYPTION_KEY`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_REDIRECT_URI`, and `LINKEDIN_DISABLE_THREAD_REPLIES`.
- File-backed aliases also work for existing installs, such as `DATABASE_URL_FILE`, `JWT_SECRET_FILE`, and `ENCRYPTION_KEY_FILE`.
- The root `.env.example` is the best copy-paste starting point.
- Set explicit public URLs in production even when defaults exist.
- For Threads, Facebook, Instagram, and TikTok, treat `OPENPOST_MEDIA_URL` as mandatory unless S3/R2 public media URLs are configured.
