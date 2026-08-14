# Environment Variables

This reference is for operators looking up common environment variables.

This page lists the most common core and provider variables. Use [Environment Variables](/configuration/environment-variables) for required values, defaults, file-backed configuration, legacy aliases, and complete deployment notes.

## OpenPost Image Editor

| Variable                               | Default                | Purpose                                                                                          |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `OPENPOST_IMAGE_EDITOR_ENABLED`        | `true`                 | Enable the OpenPost Image Editor UI and API. Disabling it leaves the Media library operational.  |
| `OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL` | `/image-editor-models` | Serve the pinned background-removal model and runtime from another operator-controlled base URL. |

## Automatic image alt text

| Variable                             | Default               | Purpose                                                                                                         |
| ------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                 | empty                 | Server-only OpenRouter key that enables automatic alt text for images without saved alt text; supports `_FILE`. |
| `OPENPOST_IMAGE_CAPTION_MODEL`       | `openai/gpt-5.6-luna` | Model used with a 400px JPEG thumbnail and up to 1,000 characters of relevant post or thread segment text.      |
| `OPENPOST_IMAGE_CAPTION_PROVIDER`    | empty                 | Optional exact OpenRouter provider slug allowed for automatic image alt text.                                   |
| `OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR` | `false`               | Require a zero-data-retention endpoint for automatic image alt text.                                            |

## Meme generator

| Variable                          | Default                    | Purpose                                                                                          |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `OPENPOST_MEME_GENERATOR_ENABLED` | `false`                    | Enable authenticated Memegen template search, previews, rendering, and saved generation recipes. |
| `OPENPOST_MEMEGEN_URL`            | `https://api.memegen.link` | Hosted or operator-controlled Memegen API base URL.                                              |
| `OPENPOST_MEMEGEN_API_KEY`        | empty                      | Optional server-only Memegen key; supports `_FILE`.                                              |
| `OPENPOST_MEME_GENERATION_MODEL`  | `openai/gpt-5.6-luna`      | OpenRouter model used only for optional template and caption suggestions.                        |

## OpenPost Video Editor and stock media

| Variable                        | Default                | Purpose                                                                                        |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `OPENPOST_VIDEO_MODEL_BASE_URL` | `/video-editor-models` | Serve the pinned local transcription and voice-detection files from another operator base URL. |
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

Most variables loaded through the main backend config loader can also be loaded from `<VARIABLE>_FILE`; direct env values win over file-backed values. Instance admins can manage the optional account, email, authentication, OpenPost Image Editor, feedback, and provider behavior values from **Settings → Instance → Configuration**. An encrypted admin override takes precedence over those environment values after restart, and the screen keeps the environment source visible as the fallback. Provider apps use a separate environment-first merge path. Legacy aliases support the same suffix, for example `DATABASE_URL_FILE`, `JWT_SECRET_FILE`, and `ENCRYPTION_KEY_FILE`. Adapter-only variables read directly by provider code, such as `META_GRAPH_API_VERSION`, do not currently support `_FILE` variants.

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
| `OPENPOST_PUBLIC_PROFILES_ENABLED`              | Enable opt-in public profiles and their public routes                                             |
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
| `OPENROUTER_API_KEY`                            | Enable server-side automatic image alt text; supports `_FILE`                                     |
| `OPENPOST_IMAGE_CAPTION_MODEL`                  | OpenRouter model ID for automatic image alt text                                                  |
| `OPENPOST_IMAGE_CAPTION_PROVIDER`               | Exact OpenRouter provider slug allowed for automatic image alt text                               |
| `OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR`            | Require a zero-data-retention endpoint for automatic image alt text                               |
| `OPENPOST_MEME_GENERATOR_ENABLED`               | Enable authenticated Memegen template and rendering APIs                                          |
| `OPENPOST_MEMEGEN_URL`                          | Hosted or self-hosted Memegen API base URL                                                        |
| `OPENPOST_MEMEGEN_API_KEY`                      | Optional server-only Memegen API key; supports `_FILE`                                            |
| `OPENPOST_MEME_GENERATION_MODEL`                | OpenRouter model ID for optional meme suggestions                                                 |
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
| `OPENPOST_PADDLE_API_KEY`                       | Server-only Paddle API key                                                                        |
| `OPENPOST_PADDLE_ENVIRONMENT`                   | Explicit Paddle environment: sandbox or production                                                |
| `OPENPOST_PADDLE_CLIENT_TOKEN`                  | Browser-safe Paddle.js client token                                                               |
| `OPENPOST_PADDLE_WEBHOOK_SECRET`                | Paddle webhook verification secret                                                                |
| `OPENPOST_PADDLE_CHECKOUT_RETURN_URL`           | OpenPost return URL after checkout                                                                |
| `OPENPOST_PADDLE_STARTER_MONTHLY_PRICE_ID`      | Paddle Starter monthly price ID                                                                   |
| `OPENPOST_PADDLE_STARTER_ANNUAL_PRICE_ID`       | Paddle Starter annual price ID                                                                    |
| `OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID`      | Paddle Founder monthly price ID                                                                   |
| `OPENPOST_PADDLE_FOUNDER_ANNUAL_PRICE_ID`       | Paddle Founder annual price ID                                                                    |
| `OPENPOST_PADDLE_PRO_MONTHLY_PRICE_ID`          | Paddle Pro monthly price ID                                                                       |
| `OPENPOST_PADDLE_PRO_ANNUAL_PRICE_ID`           | Paddle Pro annual price ID                                                                        |
| `OPENPOST_PADDLE_TEAM_MONTHLY_PRICE_ID`         | Paddle Team monthly price ID                                                                      |
| `OPENPOST_PADDLE_TEAM_ANNUAL_PRICE_ID`          | Paddle Team annual price ID                                                                       |
| `OPENPOST_PADDLE_AGENCY_MONTHLY_PRICE_ID`       | Paddle Agency monthly price ID                                                                    |
| `OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID`        | Paddle Agency annual price ID                                                                     |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD`            | Cloud-only per-workspace X provider-cost safety limit                                             |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD`          | Estimated X post-create price without a URL                                                       |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD` | Estimated X post-create price with a URL                                                          |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS`        | Immutable provider-cost event retention                                                           |
| `OPENPOST_PROVIDER_APPS`                        | Structured provider app registry JSON; entries override matching encrypted database rows          |
| `OPENPOST_DISABLED_PROVIDERS`                   | Emergency provider deny-list; overrides readiness-ledger controls after restart                   |
| `OPENPOST_PROVIDER_CERTIFICATION_ENFORCED`      | Cloud-only strict provider evidence gate; defaults to `false`                                     |
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
