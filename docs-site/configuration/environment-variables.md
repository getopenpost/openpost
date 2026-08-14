# Environment Variables

This reference is for operators configuring an OpenPost instance.

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

Instance administrators can manage account policy, Paddle billing, authentication, email, OpenPost Image Editor, stock media, feedback, provider behavior, and provider-app settings in **Settings → Instance → Configuration**. OpenPost encrypts every database-backed value with `OPENPOST_ENCRYPTION_KEY`; secret values are write-only and the API only reports whether one exists.

For these administrator-managed values, except provider apps, configuration precedence is:

1. an encrypted administrator override in the database;
2. a direct environment variable or its `_FILE` variant;
3. the documented application default.

When an environment value already exists, the screen names its variable and clearly labels both a pending override and an active override. The environment value stays configured as the fallback but is not returned separately by the API. Database changes are validated and saved together, then take effect after the next server restart. Removing an administrator override returns the setting to its environment value or default after restart.

Bootstrap and data-plane settings stay deployment-only because OpenPost needs them before it can read the database: edition, port, database driver and DSN, public application origins and CORS, `OPENPOST_JWT_SECRET`, `OPENPOST_ENCRYPTION_KEY`, and storage. Paddle billing values can come from either the deployment environment or the encrypted instance-admin registry; configure the complete required set before restarting a cloud instance. Provider apps keep their separate environment-first precedence, as described below. Adapter-only variables such as `META_GRAPH_API_VERSION` also remain deployment-only.

## Core settings

| Variable                               |                              Required | Default                                         | Description                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------: | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENPOST_PORT`                        |                                    No | `8080`                                          | HTTP server port.                                                                                                                                                                                                                  |
| `OPENPOST_EDITION`                     |                                    No | `selfhost`                                      | Product edition. Valid values: `selfhost`, `cloud`. Cloud mode enforces hosted storage requirements at startup.                                                                                                                    |
| `OPENPOST_DATABASE_DRIVER`             |  Required as `postgres` in cloud mode | `sqlite`                                        | Database driver. Valid values: `sqlite`, `postgres`. SQLite remains the self-hosted default.                                                                                                                                       |
| `OPENPOST_DATABASE_PATH`               |                                    No | `file:openpost.db?cache=shared&mode=rwc`        | SQLite database path or DSN. Also acts as a legacy fallback DSN for Postgres if `OPENPOST_DATABASE_URL` is unset.                                                                                                                  |
| `OPENPOST_DATABASE_URL`                |  Required for Postgres and cloud mode | empty                                           | Postgres connection URL used when `OPENPOST_DATABASE_DRIVER=postgres`.                                                                                                                                                             |
| `OPENPOST_APP_URL`                     |    No, but set it in real deployments | `http://localhost:8080`                         | Public frontend origin used for CORS and auth flow assumptions.                                                                                                                                                                    |
| `OPENPOST_PUBLIC_URL`                  |                                    No | falls back to `OPENPOST_APP_URL`                | Canonical browser origin used when configuring WebAuthn/passkeys. Set this to your real app URL in production.                                                                                                                     |
| `OPENPOST_EXTRA_CORS_ORIGINS`          |                                    No | empty                                           | Extra comma-separated origins to allow. Cloud mode allows only `OPENPOST_APP_URL` plus these explicit origins and rejects `*`.                                                                                                     |
| `OPENPOST_DISABLE_REGISTRATIONS`       |                                    No | `false`                                         | Disables new self-service signups after setup. The first account on a fresh instance is still allowed and becomes the instance admin automatically.                                                                                |
| `OPENPOST_PUBLIC_PROFILES_ENABLED`     |                                    No | `true`                                          | Allows users to publish username-based profiles. Set `false` to disable the public API and return `404` from direct profile pages.                                                                                                 |
| `OPENPOST_LEGAL_ACCEPTANCE_REQUIRED`   |                Required in cloud mode | `false` for self-host, `true` for cloud         | Requires explicit registration acceptance of the configured Terms and Privacy Policy versions.                                                                                                                                     |
| `OPENPOST_TERMS_URL`                   |                Required in cloud mode | hosted URL in cloud, empty otherwise            | Public Terms of Service URL shown during registration.                                                                                                                                                                             |
| `OPENPOST_PRIVACY_URL`                 |                Required in cloud mode | hosted URL in cloud, empty otherwise            | Public Privacy Policy URL shown during registration.                                                                                                                                                                               |
| `OPENPOST_TERMS_VERSION`               |                Required in cloud mode | `2026-08-05` in cloud, empty otherwise          | Version stored on the user record when the terms are accepted.                                                                                                                                                                     |
| `OPENPOST_PRIVACY_VERSION`             |                Required in cloud mode | `2026-08-11` in cloud, empty otherwise          | Version stored on the user record when the privacy policy is acknowledged.                                                                                                                                                         |
| `OPENPOST_SUPPORT_EMAIL`               |                Required in cloud mode | `openpost@rgo.pt` in cloud, empty otherwise     | Support contact shown when password recovery is unavailable.                                                                                                                                                                       |
| `OPENPOST_EMAIL_VERIFICATION_REQUIRED` |                Required in cloud mode | `false` for self-host, `true` for cloud         | Requires a new email-and-password account to confirm a six-digit code before OpenPost creates a session. Existing users are marked verified during migration.                                                                      |
| `OPENPOST_EMAIL_PROVIDER`              |                                    No | inferred when possible                          | Optional mail transport for authentication and user notifications: `smtp`, `resend`, or `cloudflare`. When verification is required but no transport is ready, password registration is unavailable until an admin configures one. |
| `OPENPOST_EMAIL_FROM`                  |  Required when a mail provider is set | falls back to `OPENPOST_SMTP_FROM`              | Verified sender used for signup codes, password resets, Transactional Workspace invitations, and user notifications.                                                                                                               |
| `OPENPOST_TELEMETRY_ENABLED`           |                Required in cloud mode | `false` for self-host, `true` for cloud         | Enables privacy-limited PostHog browser, service, and error telemetry after restart. Self-hosted operators must opt in explicitly.                                                                                                 |
| `OPENPOST_POSTHOG_PROJECT_TOKEN`       |    Required when telemetry is enabled | empty                                           | Browser-safe write token for the operator-owned PostHog project. This is not a personal API key.                                                                                                                                   |
| `OPENPOST_POSTHOG_API_HOST`            |    Required when telemetry is enabled | empty                                           | Direct PostHog ingestion endpoint used by the backend, such as `https://eu.i.posthog.com`.                                                                                                                                         |
| `OPENPOST_POSTHOG_BROWSER_HOST`        |                                    No | API host for self-host, managed proxy for cloud | Browser ingestion endpoint or first-party reverse proxy. Cloud mode defaults to `https://cool.openpost.social`; an explicit value overrides that default.                                                                          |
| `OPENPOST_POSTHOG_UI_HOST`             |           Required with browser proxy | empty for self-host, EU UI for cloud            | Real PostHog application host, such as `https://eu.posthog.com`, used separately from an ingestion proxy.                                                                                                                          |
| `OPENPOST_TELEMETRY_ENVIRONMENT`       |                                    No | `selfhost` or `production` by edition           | Stable environment label attached to events. Use separate PostHog projects for production, staging, and development.                                                                                                               |
| `OPENPOST_RESEND_API_KEY`              |     Required for the Resend transport | empty                                           | Resend API key. Supports `OPENPOST_RESEND_API_KEY_FILE`.                                                                                                                                                                           |
| `OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID` | Required for the Cloudflare transport | empty                                           | Cloudflare account ID for Email Service.                                                                                                                                                                                           |
| `OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN`  | Required for the Cloudflare transport | empty                                           | Cloudflare API token with Email Sending permission. Supports `OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN_FILE`.                                                                                                                           |

| `OPENPOST_SMTP_HOST` | Required for the SMTP transport | empty | SMTP host used for authentication, Transactional Workspace invitations, and user notification mail. |
| `OPENPOST_SMTP_PORT` | No | `587` | SMTP port. Use 587 with STARTTLS or 465 with implicit TLS. |
| `OPENPOST_SMTP_USERNAME` | No | empty | SMTP authentication username. |
| `OPENPOST_SMTP_PASSWORD` | Required when SMTP username is set | empty | SMTP authentication password. Supports `OPENPOST_SMTP_PASSWORD_FILE`. |
| `OPENPOST_SMTP_FROM` | No | empty | Legacy SMTP sender fallback for `OPENPOST_EMAIL_FROM`. |
| `OPENPOST_SMTP_TLS_MODE` | No | `starttls` | `starttls`, `tls`, or `none`. Plaintext mode is rejected for non-loopback hosts. |
| `OPENPOST_SMTP_SERVER_NAME` | No | SMTP hostname | Optional TLS server-name override. |
| `OPENPOST_JWT_SECRET` | Yes | none | Secret used to sign JWTs. Must be at least 32 characters. |
| `OPENPOST_ENCRYPTION_KEY` | Yes | none | Secret used to encrypt stored OAuth tokens. Must be at least 32 characters. |
| `OPENPOST_AUTH_GOOGLE_CLIENT_ID` | No | empty | Google OAuth client ID. Enables first-party Google sign-in and account linking when paired with its secret. |
| `OPENPOST_AUTH_GOOGLE_CLIENT_SECRET` | Required when the Google client ID is configured | empty | Google OAuth client secret. Prefer `OPENPOST_AUTH_GOOGLE_CLIENT_SECRET_FILE` in production. |
| `OPENPOST_OIDC_ISSUER` | No | empty | Exact issuer for the optional instance-wide OIDC provider. Private network issuers are allowed because this is trusted operator configuration. |
| `OPENPOST_OIDC_CLIENT_ID` | Required when OIDC issuer is set | empty | Client ID for the instance-wide OIDC provider. |
| `OPENPOST_OIDC_CLIENT_SECRET` | No | empty | OIDC client secret. Prefer `OPENPOST_OIDC_CLIENT_SECRET_FILE` in production. |
| `OPENPOST_OIDC_NAME` | No | `Single sign-on` | Provider label shown on the login page. |
| `OPENPOST_OIDC_SCOPES` | No | `openid profile email` | Space- or comma-separated OIDC scopes. OpenPost always includes `openid`. |
| `OPENPOST_OIDC_JIT_ENABLED` | No | `false` | Creates a passwordless local user after a verified first login. Existing accounts with the same email are never linked automatically. |
| `OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST` | No | empty | Comma-separated exact issuer-and-subject pairs or emails that may become instance admin during environment-provider JIT. |
| `OPENPOST_SSO_BREAK_GLASS_EMAILS` | No | empty | Existing instance admins that may bypass required workspace SSO. Each account must already have a local password and TOTP or passkey. |
| `OPENPOST_OIDC_NATIVE_CALLBACK_URL` | No | `openpost://oidc/callback` | Universal or app link that receives an opaque, one-time native handoff code. It never receives an OpenPost JWT. |
| `OPENPOST_STORAGE_DRIVER` | Required as `s3` in cloud mode | `local` | Media storage driver. Valid values: `local`, `s3`. |
| `OPENPOST_MEDIA_PATH` | No | `./media` | Local directory for uploaded media. |
| `OPENPOST_MEDIA_URL` | No | `/media`, resolved against the public app URL | Public base URL for media files. Set an absolute URL only for a separate media origin or path. |
| `OPENPOST_S3_ENDPOINT` | Required for R2 or non-AWS S3-compatible storage | empty | S3-compatible API endpoint. Native AWS S3 can leave this empty. |
| `OPENPOST_S3_REGION` | Required for S3-compatible storage and cloud mode | empty | S3 region. R2 commonly uses `auto`. |
| `OPENPOST_S3_BUCKET` | Required for S3-compatible storage and cloud mode | empty | Bucket name for uploaded media. |
| `OPENPOST_S3_ACCESS_KEY_ID` | Required for S3-compatible storage and cloud mode | empty | S3 access key ID. |
| `OPENPOST_S3_SECRET_ACCESS_KEY` | Required for S3-compatible storage and cloud mode | empty | S3 secret access key. |
| `OPENPOST_S3_PUBLIC_BASE_URL` | Required in cloud mode | empty | Public media base URL for provider fetches and preview links. |
| `OPENPOST_S3_FORCE_PATH_STYLE` | No | `false` | Force path-style S3 addressing for compatible providers that require it. |
| `OPENPOST_IMAGE_EDITOR_ENABLED` | No | `true` | Enables OpenPost Image Editor routes and APIs. Set `false` for an operational rollback; Media upload and library features remain available and OpenPost Image Editor migrations still run. |
| `OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL` | No | `/image-editor-models` | Base URL for the background-removal model, WASM, and runtime assets. Leave unset to use the files embedded with OpenPost. |
| `OPENPOST_VIDEO_MODEL_BASE_URL` | No | `/video-editor-models` | Base URL for the pinned transcription and voice-detection model files. Leave unset to use embedded files. |
| `OPENPOST_STOCK_MEDIA_ENABLED` | No | `false` | Enables rate-limited stock search for providers that also have a configured server-side key. |
| `OPENPOST_PEXELS_API_KEY` | No | empty | Server-only Pexels API key for photo and video search. |
| `OPENPOST_UNSPLASH_ACCESS_KEY` | No | empty | Server-only Unsplash access key for photo search and required selection tracking. |
| `OPENPOST_PIXABAY_API_KEY` | No | empty | Server-only Pixabay API key for image and video search. |
| `OPENROUTER_API_KEY` | No | empty | Server-only OpenRouter key that enables automatic alt text for images without saved alt text when they are added to the text-and-thread composer. Supports `OPENROUTER_API_KEY_FILE`. |
| `OPENPOST_IMAGE_CAPTION_MODEL` | No | `openai/gpt-5.6-luna` | OpenRouter model ID used for automatic image alt text. |
| `OPENPOST_IMAGE_CAPTION_PROVIDER` | No | empty | Exact OpenRouter provider slug allowed for automatic image alt text. An empty value uses normal eligible-provider routing. |
| `OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR` | No | `false` | Require OpenRouter to use a zero-data-retention endpoint for automatic image alt text. Verify the configured model/provider pair supports ZDR before enabling. |
| `OPENPOST_MEME_GENERATOR_ENABLED` | No | `false` | Enables authenticated Memegen template search, previews, rendering, and durable OpenPost recipes. |
| `OPENPOST_MEMEGEN_URL` | No | `https://api.memegen.link` | Base URL of the hosted or operator-controlled Memegen API. |
| `OPENPOST_MEMEGEN_API_KEY` | No | empty | Optional server-only Memegen key. Use `OPENPOST_MEMEGEN_API_KEY_FILE` for a managed secret. |
| `OPENPOST_MEME_GENERATION_MODEL` | No | `openai/gpt-5.6-luna` | OpenRouter model used for optional meme template and caption suggestions. |
| `OPENPOST_FEEDBACK_ENABLED` | No | `false` | Shows the authenticated feedback form only when a valid destination and recipient are also configured. |
| `OPENPOST_FEEDBACK_DESTINATION_URL` | Required when feedback is enabled | empty | Server-only HTTPS Discord-compatible webhook. Use `OPENPOST_FEEDBACK_DESTINATION_URL_FILE` for a managed secret. |
| `OPENPOST_FEEDBACK_RECIPIENT` | Required when feedback is enabled | empty | Plain recipient name shown to users before they send a report, such as `OpenPost team` or `Example operator`. |
| `OPENPOST_FEEDBACK_SUPPORT_URL` | No | OpenPost GitHub new-issue URL | HTTPS support link shown when the report form is disabled. Query strings and fragments are removed. |
| `OPENPOST_UPDATE_CHECK_ENABLED` | No | `true` | Enables the read-only stable release check for self-hosted instance admins. Cloud mode never checks. |
| `OPENPOST_PADDLE_API_KEY` | Required in cloud mode | empty | Server-only Paddle API key used to reconcile customers and subscriptions and create portal sessions. |
| `OPENPOST_PADDLE_ENVIRONMENT` | Required in cloud mode | empty | Explicit Paddle environment: `sandbox` or `production`. API-key and client-token prefixes must match. |
| `OPENPOST_PADDLE_CLIENT_TOKEN` | Required in cloud mode | empty | Browser-safe Paddle.js client token used for localized price previews and checkout. |
| `OPENPOST_PADDLE_WEBHOOK_SECRET` | Required in cloud mode | empty | Paddle notification destination secret used to verify raw webhook requests. |
| `OPENPOST_PADDLE_CHECKOUT_RETURN_URL` | No | `<OPENPOST_APP_URL>/checkout?status=success` | OpenPost success URL supplied to Paddle checkout. |
| `OPENPOST_PADDLE_STARTER_MONTHLY_PRICE_ID` | Required in cloud mode | empty | Paddle Starter monthly price ID. |
| `OPENPOST_PADDLE_STARTER_ANNUAL_PRICE_ID` | Required in cloud mode | empty | Paddle Starter annual price ID. |
| `OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID` | Required in cloud mode | empty | Paddle Founder monthly price ID. |
| `OPENPOST_PADDLE_FOUNDER_ANNUAL_PRICE_ID` | Required in cloud mode | empty | Paddle Founder annual price ID. |
| `OPENPOST_PADDLE_PRO_MONTHLY_PRICE_ID` | Required in cloud mode | empty | Paddle Pro monthly price ID. |
| `OPENPOST_PADDLE_PRO_ANNUAL_PRICE_ID` | Required in cloud mode | empty | Paddle Pro annual price ID. |
| `OPENPOST_PADDLE_TEAM_MONTHLY_PRICE_ID` | Required in cloud mode | empty | Paddle Team monthly price ID. |
| `OPENPOST_PADDLE_TEAM_ANNUAL_PRICE_ID` | Required in cloud mode | empty | Paddle Team annual price ID. |
| `OPENPOST_PADDLE_AGENCY_MONTHLY_PRICE_ID` | Required in cloud mode | empty | Paddle Agency monthly price ID. |
| `OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID` | Required in cloud mode | empty | Paddle Agency annual price ID. |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD` | No | `5000000` | Cloud-only per-workspace X request safety limit in millionths of a US dollar. `0` blocks hosted X publishing. |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD` | No | `15000` | Estimated cloud X cost for a post without a URL, in millionths of a US dollar. Keep this aligned with current X pricing. |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD` | No | `200000` | Estimated cloud X cost for a post with a URL, in millionths of a US dollar. Keep this aligned with current X pricing. |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS` | No | `180` | Retention for confirmed provider-cost events and unresolved reservations. Startup pruning is bounded and never removes the open month. |

The official hosted policy URLs and versions come from `packages/legal-policy/src/manifest.json`. Run `bun scripts/legal-policy-manifest.mjs env` to print the four non-secret environment values. Cloud startup fails closed when the configured official URLs or versions drift from that manifest, so a policy change cannot silently record acceptance against old text. A substantive Terms or Privacy change advances its version and causes existing accounts to see the acceptance screen again. Spelling, formatting, and link-only corrections keep the existing version. The Refund Policy is incorporated into the Terms and does not have a separate acceptance record.

## Automatic image alt text

Automatic alt text is off when `OPENROUTER_API_KEY` is empty. When it is configured, adding an image with no saved alt text to the text-and-thread composer sends a 400px JPEG thumbnail from the server to OpenRouter. When present, OpenPost also sends up to 1,000 characters of the current relevant post or thread segment as untrusted context to help the model distinguish what the image means in that post. The model is instructed to treat this text as context, not as instructions. OpenPost restricts routing to eligible providers that declare they do not collect request data. Operators can also pin one exact provider and require OpenRouter's zero-data-retention classification. The result is saved as the media item's shared base alt text only if that field is still blank. The original image is not sent for this task. The managed service pins `azure/eu`, disables provider fallback, and requires ZDR; cloud startup fails closed if that boundary drifts.

This is external processing: the thumbnail and any relevant segment text leave the OpenPost instance and are handled by OpenRouter and the selected model provider. Review their current privacy and retention terms before enabling the feature. Existing or newly entered manual alt text always wins. With no key, OpenPost makes no caption request. A captioning failure does not stop users from attaching or publishing media.

## Meme generator

The meme generator is off by default. When enabled, OpenPost loads Memegen's template catalog on the server, validates template IDs and caption counts, asks Memegen to render bounded image data, and immediately saves the chosen result in the workspace Media library. OpenPost saves an immutable recipe with captions, overlay media IDs, output format, catalog revision, and a safe template source link when one is available.

Manual template search, caption editing, preview, and rendering need only Memegen. AI suggestions also need `OPENROUTER_API_KEY`: OpenPost sends the idea and a bounded template shortlist to the configured model, validates its structured response, and leaves every caption editable before rendering. It does not send the full template catalog or save the original idea in the recipe.

Memegen is external processing unless you operate it yourself. The service receives unpublished caption text and, for replaceable image slots, short-lived public HTTPS URLs for the selected Media items. Review Memegen's current [client guidance](https://memegen.link/clients/) and [API guide](https://memegen.link/guide/) for privacy, watermark, rate-limit, and access details before enabling its hosted API. A key changes hosted service access but does not establish rights to every community template. Treat any source link OpenPost can safely show as provenance, not a license, and confirm that you can publish each template. Use a private, hardened Memegen deployment when draft confidentiality or service continuity matters.

## Update status

When enabled in `selfhost` mode, the Instance settings page lets an instance admin compare the running version and build revision with the latest stable OpenPost release. The server checks the fixed public GitHub release endpoint only when an admin requests this page. It sends no hostname, account data, content, or credentials.

Successful responses are cached for 24 hours. Failed checks retry after 15 minutes, use a three-second timeout, and keep the last successful result as stale. Responses are limited to 64 KiB and release links must point back to the official OpenPost GitHub repository. The feature never downloads or installs an update. See [Update Status](/configuration/update-status) for the full boundary.

## Provider app registry

OpenPost builds provider adapters at startup from active encrypted `provider_apps` database rows, legacy provider env vars, and optional `OPENPOST_PROVIDER_APPS` JSON. Environment-defined apps are authoritative over matching database rows.

`OPENPOST_DISABLED_PROVIDERS` is an emergency comma-, space-, or newline-separated deny-list of provider keys. It has priority over database runtime-control events and fails closed across connection, capability and schedule decisions, and queued worker writes after restart. Use append-only runtime-control events for normal operator changes and the environment list when the database control plane must not be trusted.

`OPENPOST_PROVIDER_CERTIFICATION_ENFORCED` is a cloud-only strict evidence gate and defaults to `false`. Enable it only after every enabled production subject has current runtime-control, approval, local-test, live-test, and OAuth-scope evidence. Production identity and public certification claims remain production-scoped when this flag is off; the flag only controls whether missing certification evidence blocks connection and publishing.

Database rows are intended for administrator-managed installs. They store `client_secret_encrypted` with the same `OPENPOST_ENCRYPTION_KEY` used for account tokens and act as fallbacks when no matching environment app exists. They require a server restart after changes. Matching is by provider, except Mastodon uses provider plus `instance_url`.

Instance admins can manage encrypted database rows through `GET /api/v1/admin/provider-apps`, `POST /api/v1/admin/provider-apps`, and `DELETE /api/v1/admin/provider-apps/{id}`. API responses never return client secrets; send `client_secret` only when creating a row or rotating the existing secret.

The backend exposes this registry through the instance-admin API and **Settings → Instance → Configuration → Provider apps**. Environment-defined apps appear as read-only. A matching database fallback stays visible and can be deleted while the environment app remains active. Admin-added client secrets are encrypted and never returned. Saves and deletes take effect after the next OpenPost server restart.

## X

| Variable                                   |  Required | Default                         | Description                                                                                                        |
| ------------------------------------------ | --------: | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `OPENPOST_PROVIDER_APPS`                   |        No | empty                           | Structured JSON provider app registry. Entries override matching legacy env providers and encrypted database rows. |
| `OPENPOST_PROVIDER_CERTIFICATION_ENFORCED` |        No | `false`                         | In cloud mode, require complete certification evidence before connection or publishing.                            |
| `X_CLIENT_ID`                              | Yes for X | empty                           | X OAuth client ID. Leave empty to disable X.                                                                       |
| `X_CLIENT_SECRET`                          | Yes for X | empty                           | X OAuth client secret.                                                                                             |
| `X_REDIRECT_URI`                           |        No | derived from `OPENPOST_APP_URL` | X OAuth callback URL override.                                                                                     |

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
