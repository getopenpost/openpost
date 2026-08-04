# Environment Variables

This page lists the most common core and provider variables. Use [Environment Variables](/configuration/environment-variables) for required values, defaults, file-backed configuration, legacy aliases, and complete deployment notes.

## Studio

| Variable                         | Default          | Purpose                                                                                          |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `OPENPOST_STUDIO_ENABLED`        | `true`           | Enable the Studio UI and API. Disabling it leaves the Media library operational.                 |
| `OPENPOST_STUDIO_MODEL_BASE_URL` | `/studio-models` | Serve the pinned background-removal model and runtime from another operator-controlled base URL. |

## Video Studio and stock media

| Variable                        | Default                | Purpose                                                                                        |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `OPENPOST_VIDEO_STUDIO_ENABLED` | `false`                | Enable the private-beta Video Studio routes and APIs. Local projects remain browser-owned.     |
| `OPENPOST_VIDEO_MODEL_BASE_URL` | `/video-studio-models` | Serve the pinned local transcription and voice-detection files from another operator base URL. |
| `OPENPOST_STOCK_MEDIA_ENABLED`  | `false`                | Enable the public, rate-limited stock search API for providers with configured server keys.    |
| `OPENPOST_PEXELS_API_KEY`       | empty                  | Server-only Pexels photo and video API key.                                                    |
| `OPENPOST_UNSPLASH_ACCESS_KEY`  | empty                  | Server-only Unsplash photo API access key.                                                     |
| `OPENPOST_PIXABAY_API_KEY`      | empty                  | Server-only Pixabay image and video API key.                                                   |

## User feedback

| Variable                            | Default                       | Purpose                                                                                      |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `OPENPOST_FEEDBACK_ENABLED`         | `false`                       | Enable the authenticated report form when the destination and recipient are also configured. |
| `OPENPOST_FEEDBACK_DESTINATION_URL` | empty                         | Server-only HTTPS Discord-compatible webhook.                                                |
| `OPENPOST_FEEDBACK_RECIPIENT`       | empty                         | Recipient name disclosed in the form before send.                                            |
| `OPENPOST_FEEDBACK_SUPPORT_URL`     | OpenPost GitHub new-issue URL | Support link shown when delivery is not configured.                                          |

## Operations

| Variable                                        | Default   | Purpose                                                                       |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------------------- |
| `OPENPOST_UPDATE_CHECK_ENABLED`                 | `true`    | Enable read-only stable release checks for self-hosted instance admins.       |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD`            | `5000000` | Cloud-only per-workspace X request safety limit in millionths of a US dollar. |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD`          | `15000`   | Estimated X post-create cost without a URL, in millionths of a US dollar.     |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD` | `200000`  | Estimated X post-create cost with a URL, in millionths of a US dollar.        |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS`        | `180`     | Immutable provider-cost event retention; the current month is never pruned.   |

Most variables loaded through the main backend config loader can also be loaded from `<VARIABLE>_FILE`; direct env values win over file-backed values. Instance admins can manage the optional account, email, authentication, Studio, feedback, provider behavior, and provider-app values from **Settings → Instance → Configuration**. Environment values remain authoritative over encrypted database settings. Legacy aliases support the same suffix, for example `DATABASE_URL_FILE`, `JWT_SECRET_FILE`, and `ENCRYPTION_KEY_FILE`. Adapter-only variables read directly by provider code, such as `META_GRAPH_API_VERSION`, do not currently support `_FILE` variants.

| Variable                                        | Purpose                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `OPENPOST_PORT`                                 | Backend port                                                                                      |
| `OPENPOST_EDITION`                              | Product edition: `selfhost` or `cloud`                                                            |
| `OPENPOST_DATABASE_DRIVER`                      | Database driver: `sqlite` or `postgres`                                                           |
| `OPENPOST_DATABASE_PATH`                        | SQLite path or DSN                                                                                |
| `OPENPOST_DATABASE_URL`                         | Postgres URL when using the Postgres driver                                                       |
| `OPENPOST_APP_URL`                              | Public frontend URL                                                                               |
| `OPENPOST_PUBLIC_URL`                           | Canonical browser origin used for WebAuthn/passkeys                                               |
| `OPENPOST_EXTRA_CORS_ORIGINS`                   | Extra CORS allowlist                                                                              |
| `OPENPOST_DISABLE_REGISTRATIONS`                | Disable new signups after bootstrap                                                               |
| `OPENPOST_EMAIL_VERIFICATION_REQUIRED`          | Require six-digit email confirmation before email-and-password signup completes                   |
| `OPENPOST_EMAIL_PROVIDER`                       | Mail transport: `smtp`, `resend`, or `cloudflare`                                                 |
| `OPENPOST_EMAIL_FROM`                           | Verified sender for confirmation and password-reset mail                                          |
| `OPENPOST_RESEND_API_KEY`                       | Resend API key                                                                                    |
| `OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID`          | Cloudflare account ID for Email Service                                                           |
| `OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN`           | Cloudflare Email Service API token                                                                |
| `OPENPOST_FEEDBACK_ENABLED`                     | Enable the configured authenticated feedback form                                                 |
| `OPENPOST_FEEDBACK_DESTINATION_URL`             | Server-only Discord-compatible webhook                                                            |
| `OPENPOST_FEEDBACK_RECIPIENT`                   | Recipient label disclosed to users                                                                |
| `OPENPOST_FEEDBACK_SUPPORT_URL`                 | Fallback support URL                                                                              |
| `OPENPOST_UPDATE_CHECK_ENABLED`                 | Enable read-only stable release checks for self-hosted instance admins                            |
| `OPENPOST_JWT_SECRET`                           | JWT signing secret                                                                                |
| `OPENPOST_ENCRYPTION_KEY`                       | OAuth token encryption secret                                                                     |
| `OPENPOST_AUTH_GOOGLE_CLIENT_ID`                | Google OAuth client ID for first-party sign-in and linking                                        |
| `OPENPOST_AUTH_GOOGLE_CLIENT_SECRET`            | Google OAuth client secret; supports `_FILE`                                                      |
| `OPENPOST_OIDC_ISSUER`                          | Exact issuer for the optional instance-wide OIDC provider                                         |
| `OPENPOST_OIDC_CLIENT_ID`                       | Client ID for the instance-wide OIDC provider                                                     |
| `OPENPOST_OIDC_CLIENT_SECRET`                   | Client secret for the instance-wide OIDC provider; supports `_FILE`                               |
| `OPENPOST_OIDC_NAME`                            | Login label for the instance-wide OIDC provider                                                   |
| `OPENPOST_OIDC_SCOPES`                          | Space- or comma-separated OIDC scopes; `openid` is always included                                |
| `OPENPOST_OIDC_JIT_ENABLED`                     | Create a user on first verified provider login                                                    |
| `OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST`             | Exact issuer-and-subject pairs or emails allowed to become instance admin through JIT             |
| `OPENPOST_SSO_BREAK_GLASS_EMAILS`               | Existing MFA-protected instance admins allowed through required SSO during an IdP outage          |
| `OPENPOST_OIDC_NATIVE_CALLBACK_URL`             | Native one-time handoff link; defaults to `openpost://oidc/callback`                              |
| `OPENPOST_STORAGE_DRIVER`                       | Media storage driver: `local` or `s3`                                                             |
| `OPENPOST_MEDIA_PATH`                           | Local media directory                                                                             |
| `OPENPOST_MEDIA_URL`                            | Public media base URL                                                                             |
| `OPENPOST_S3_ENDPOINT`                          | S3-compatible endpoint for R2 or non-AWS storage                                                  |
| `OPENPOST_S3_REGION`                            | S3 region                                                                                         |
| `OPENPOST_S3_BUCKET`                            | S3 bucket                                                                                         |
| `OPENPOST_S3_ACCESS_KEY_ID`                     | S3 access key ID                                                                                  |
| `OPENPOST_S3_SECRET_ACCESS_KEY`                 | S3 secret access key                                                                              |
| `OPENPOST_S3_PUBLIC_BASE_URL`                   | Public media base URL for S3-backed media                                                         |
| `OPENPOST_S3_FORCE_PATH_STYLE`                  | Force path-style S3 addressing                                                                    |
| `OPENPOST_WHOP_API_KEY`                         | Server-only Whop API key                                                                          |
| `OPENPOST_WHOP_API_BASE_URL`                    | Whop API base URL                                                                                  |
| `OPENPOST_WHOP_WEBHOOK_SECRET`                  | Whop webhook verification secret                                                                  |
| `OPENPOST_WHOP_ACCOUNT_ID`                      | Whop business account ID                                                                           |
| `OPENPOST_WHOP_PRODUCT_ID`                      | Whop OpenPost product ID                                                                            |
| `OPENPOST_WHOP_CHECKOUT_RETURN_URL`             | OpenPost return URL after checkout                                                                  |
| `OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID`         | Whop Starter monthly plan ID                                                                        |
| `OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID`          | Whop Starter annual plan ID                                                                         |
| `OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID`         | Whop Creator monthly plan ID                                                                        |
| `OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID`          | Whop Creator annual plan ID                                                                         |
| `OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID`             | Whop Pro monthly plan ID                                                                            |
| `OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID`              | Whop Pro annual plan ID                                                                             |
| `OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID`            | Whop Team monthly plan ID                                                                           |
| `OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID`             | Whop Team annual plan ID                                                                             |
| `OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID`          | Whop Agency monthly plan ID                                                                          |
| `OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID`           | Whop Agency annual plan ID                                                                            |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD`            | Cloud-only per-workspace X provider-cost safety limit                                             |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD`          | Estimated X post-create price without a URL                                                       |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD` | Estimated X post-create price with a URL                                                          |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS`        | Immutable provider-cost event retention                                                           |
| `OPENPOST_PROVIDER_APPS`                        | Structured provider app registry JSON; entries override matching encrypted database rows          |
| `X_CLIENT_ID`                                   | X client ID                                                                                       |
| `X_CLIENT_SECRET`                               | X client secret                                                                                   |
| `X_REDIRECT_URI`                                | X callback override                                                                               |
| `MASTODON_REDIRECT_URI`                         | Mastodon callback override                                                                        |
| `MASTODON_SERVERS`                              | Mastodon server JSON                                                                              |
| `LINKEDIN_CLIENT_ID`                            | LinkedIn client ID                                                                                |
| `LINKEDIN_CLIENT_SECRET`                        | LinkedIn client secret                                                                            |
| `LINKEDIN_REDIRECT_URI`                         | LinkedIn callback override                                                                        |
| `OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES`      | Disable LinkedIn thread replies; legacy `LINKEDIN_DISABLE_THREAD_REPLIES` remains supported       |
| `OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED`       | Request approved LinkedIn organization permissions and offer administered Pages during connection |
| `LINKEDIN_API_VERSION`                          | Optional LinkedIn REST API version override; direct adapter variable without `_FILE` support      |
| `THREADS_CLIENT_ID`                             | Threads client ID                                                                                 |
| `THREADS_CLIENT_SECRET`                         | Threads client secret                                                                             |
| `THREADS_REDIRECT_URI`                          | Threads callback override                                                                         |
| `META_GRAPH_API_VERSION`                        | Meta Graph API version for Facebook Pages and Instagram                                           |

Facebook, Instagram, TikTok, and YouTube are configured through the provider app registry with providers `facebook`, `instagram`, `tiktok`, and `youtube`; no legacy env vars are required.

Legacy aliases still work for upgrades: `DATABASE_URL`, `OPENPOST_DB_PATH`, `OPENPOST_FRONTEND_URL`, `OPENPOST_CORS_EXTRA_ORIGINS`, `JWT_SECRET`, `ENCRYPTION_KEY`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_REDIRECT_URI`, and `LINKEDIN_DISABLE_THREAD_REPLIES`.
