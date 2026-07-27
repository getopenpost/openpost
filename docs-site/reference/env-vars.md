# Environment Variables

This page lists the most common core and provider variables. Use [Environment Variables](/configuration/environment-variables) for required values, defaults, file-backed configuration, legacy aliases, and complete deployment notes.

## Studio

| Variable                         | Default          | Purpose                                                                                          |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `OPENPOST_STUDIO_ENABLED`        | `true`           | Enable the Studio UI and API. Disabling it leaves the Media library operational.                 |
| `OPENPOST_STUDIO_MODEL_BASE_URL` | `/studio-models` | Serve the pinned background-removal model and runtime from another operator-controlled base URL. |

## User feedback

| Variable                            | Default                       | Purpose                                                                                      |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `OPENPOST_FEEDBACK_ENABLED`         | `false`                       | Enable the authenticated report form when the destination and recipient are also configured. |
| `OPENPOST_FEEDBACK_DESTINATION_URL` | empty                         | Server-only HTTPS Discord-compatible webhook.                                                |
| `OPENPOST_FEEDBACK_RECIPIENT`       | empty                         | Recipient name disclosed in the form before send.                                            |
| `OPENPOST_FEEDBACK_SUPPORT_URL`     | OpenPost GitHub new-issue URL | Support link shown when delivery is not configured.                                          |

## Operations

| Variable                                          | Default   | Purpose                                                                                           |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `OPENPOST_UPDATE_CHECK_ENABLED`                   | `true`    | Enable read-only stable release checks for self-hosted instance admins.                           |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD`              | `5000000` | Cloud-only per-workspace X request safety limit in millionths of a US dollar.                     |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD`            | `15000`   | Estimated X post-create cost without a URL, in millionths of a US dollar.                         |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD`   | `200000`  | Estimated X post-create cost with a URL, in millionths of a US dollar.                            |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS`          | `180`     | Immutable provider-cost event retention; the current month is never pruned.                       |

Most variables loaded through the main backend config loader can also be loaded from `<VARIABLE>_FILE`; direct env values win over file-backed values. Legacy aliases support the same suffix, for example `DATABASE_URL_FILE`, `JWT_SECRET_FILE`, and `ENCRYPTION_KEY_FILE`. Adapter-only variables read directly by provider code, such as `META_GRAPH_API_VERSION`, do not currently support `_FILE` variants.

| Variable                              | Purpose                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `OPENPOST_PORT`                       | Backend port                                                                                                |
| `OPENPOST_EDITION`                    | Product edition: `selfhost` or `cloud`                                                                      |
| `OPENPOST_DATABASE_DRIVER`            | Database driver: `sqlite` or `postgres`                                                                     |
| `OPENPOST_DATABASE_PATH`              | SQLite path or DSN                                                                                          |
| `OPENPOST_DATABASE_URL`               | Postgres URL when using the Postgres driver                                                                 |
| `OPENPOST_APP_URL`                    | Public frontend URL                                                                                         |
| `OPENPOST_PUBLIC_URL`                 | Canonical browser origin used for WebAuthn/passkeys                                                         |
| `OPENPOST_EXTRA_CORS_ORIGINS`         | Extra CORS allowlist                                                                                        |
| `OPENPOST_DISABLE_REGISTRATIONS`      | Disable new signups after bootstrap                                                                         |
| `OPENPOST_FEEDBACK_ENABLED`           | Enable the configured authenticated feedback form                                                           |
| `OPENPOST_FEEDBACK_DESTINATION_URL`   | Server-only Discord-compatible webhook                                                                      |
| `OPENPOST_FEEDBACK_RECIPIENT`         | Recipient label disclosed to users                                                                          |
| `OPENPOST_FEEDBACK_SUPPORT_URL`       | Fallback support URL                                                                                        |
| `OPENPOST_UPDATE_CHECK_ENABLED`       | Enable read-only stable release checks for self-hosted instance admins                                      |
| `OPENPOST_JWT_SECRET`                 | JWT signing secret                                                                                          |
| `OPENPOST_ENCRYPTION_KEY`             | OAuth token encryption secret                                                                               |
| `OPENPOST_STORAGE_DRIVER`             | Media storage driver: `local` or `s3`                                                                       |
| `OPENPOST_MEDIA_PATH`                 | Local media directory                                                                                       |
| `OPENPOST_MEDIA_URL`                  | Public media base URL                                                                                       |
| `OPENPOST_S3_ENDPOINT`                | S3-compatible endpoint for R2 or non-AWS storage                                                            |
| `OPENPOST_S3_REGION`                  | S3 region                                                                                                   |
| `OPENPOST_S3_BUCKET`                  | S3 bucket                                                                                                   |
| `OPENPOST_S3_ACCESS_KEY_ID`           | S3 access key ID                                                                                            |
| `OPENPOST_S3_SECRET_ACCESS_KEY`       | S3 secret access key                                                                                        |
| `OPENPOST_S3_PUBLIC_BASE_URL`         | Public media base URL for S3-backed media                                                                   |
| `OPENPOST_S3_FORCE_PATH_STYLE`        | Force path-style S3 addressing                                                                              |
| `OPENPOST_POLAR_ACCESS_TOKEN`         | Polar API access token                                                                                      |
| `OPENPOST_POLAR_API_BASE_URL`         | Polar API base URL                                                                                          |
| `OPENPOST_POLAR_WEBHOOK_SECRET`       | Polar webhook verification secret                                                                           |
| `OPENPOST_POLAR_CHECKOUT_SUCCESS_URL` | Polar checkout success URL                                                                                  |
| `OPENPOST_POLAR_RETURN_URL`           | Polar customer portal return URL                                                                            |
| `OPENPOST_POLAR_STARTER_PRODUCT_ID`   | Polar Starter product ID                                                                                    |
| `OPENPOST_POLAR_CREATOR_PRODUCT_ID`   | Polar Creator product ID                                                                                    |
| `OPENPOST_POLAR_PRO_PRODUCT_ID`       | Polar Pro product ID                                                                                        |
| `OPENPOST_POLAR_TEAM_PRODUCT_ID`      | Polar Team product ID                                                                                       |
| `OPENPOST_POLAR_AGENCY_PRODUCT_ID`    | Polar Agency product ID                                                                                     |
| `OPENPOST_X_MONTHLY_BUDGET_MICROUSD`  | Cloud-only per-workspace X provider-cost safety limit                                                       |
| `OPENPOST_X_POST_CREATE_COST_MICROUSD` | Estimated X post-create price without a URL                                                                |
| `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD` | Estimated X post-create price with a URL                                                      |
| `OPENPOST_PROVIDER_USAGE_RETENTION_DAYS` | Immutable provider-cost event retention                                                                  |
| `OPENPOST_PROVIDER_APPS`              | Structured provider app registry JSON; active encrypted provider app API rows can override matching entries |
| `X_CLIENT_ID`                         | X client ID                                                                                                 |
| `X_CLIENT_SECRET`                     | X client secret                                                                                             |
| `X_REDIRECT_URI`                      | X callback override                                                                                         |
| `MASTODON_REDIRECT_URI`               | Mastodon callback override                                                                                  |
| `MASTODON_SERVERS`                    | Mastodon server JSON                                                                                        |
| `LINKEDIN_CLIENT_ID`                  | LinkedIn client ID                                                                                          |
| `LINKEDIN_CLIENT_SECRET`              | LinkedIn client secret                                                                                      |
| `LINKEDIN_REDIRECT_URI`               | LinkedIn callback override                                                                                  |
| `LINKEDIN_DISABLE_THREAD_REPLIES`     | Disable LinkedIn thread replies                                                                             |
| `OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED` | Request approved LinkedIn organization permissions and offer administered Pages during connection      |
| `LINKEDIN_API_VERSION`                | Optional LinkedIn REST API version override; direct adapter variable without `_FILE` support               |
| `THREADS_CLIENT_ID`                   | Threads client ID                                                                                           |
| `THREADS_CLIENT_SECRET`               | Threads client secret                                                                                       |
| `THREADS_REDIRECT_URI`                | Threads callback override                                                                                   |
| `META_GRAPH_API_VERSION`              | Meta Graph API version for Facebook Pages and Instagram                                                     |

Facebook, Instagram, TikTok, and YouTube are configured through the provider app registry with providers `facebook`, `instagram`, `tiktok`, and `youtube`; no legacy env vars are required.

Legacy aliases still work for upgrades: `DATABASE_URL`, `OPENPOST_DB_PATH`, `OPENPOST_FRONTEND_URL`, `OPENPOST_CORS_EXTRA_ORIGINS`, `OPENPOST_POLAR_CUSTOMER_PORTAL_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_REDIRECT_URI`, and `OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES`.
