# Billing And Usage Foundation

Managed OpenPost billing uses saved plan limits and durable usage counters. The backend does not call Paddle on normal API requests.

## Current pieces

- `entitlements.Service`: evaluates plan limits and keeps self-hosted defaults unlimited.
- `usage_counters`: monthly durable counters keyed by workspace, metric, and UTC month.
- `billing_customers`: Paddle customer mirrors keyed by organization, with no payment-card data.
- `billing_subscriptions`: current Paddle subscription snapshots keyed by organization.
- `billing_checkout_attempts`: opaque OpenPost checkout attempt mapping, including the selected Paddle price, product plan, and billing period.
- `billing_webhook_events`: webhook event ledger for idempotent Paddle processing.
- `GET /api/v1/organizations/{id}/billing/status`: returns the local subscription snapshot and current-month usage counters for an organization.
- `POST /api/v1/organizations/{id}/billing/checkout`: records an opaque checkout attempt and returns the Paddle.js environment, browser-safe client token, selected price, period price map, authenticated email, and OpenPost return URL.
- `POST /api/v1/organizations/{id}/billing/portal`: creates a fresh, short-lived Paddle customer portal session after authorization.
- Workspace billing endpoints resolve the same organization-scoped contract for web and CLI clients.
- `POST /api/v1/billing/paddle/webhook`: verifies the raw request body and `Paddle-Signature`, stores each event once, and queues canonical reconciliation.
- Cloud mode reads `billing_subscriptions.entitlement_snapshot` for organization-scoped quota checks.
- Workspace creation checks `LimitWorkspaces` before inserting a new workspace. In cloud mode, users get a one-workspace bootstrap allowance before checkout; after a subscription is active, workspace creation uses the active organization subscription snapshot.
- Provider connection flows check `social_accounts` before inserting a new active social account.
- Workspace invitation creation checks `team_members` before issuing a link. The check counts active members plus non-expired pending invitations so a plan cannot over-reserve seats.
- Media uploads check `media_bytes_uploaded_monthly` and `media_bytes_stored`; successful new uploads increment monthly uploaded-byte usage.
- Scheduled single posts and threads check `scheduled_posts_monthly` before inserting posts or jobs; successful scheduled creates increment monthly scheduled-post usage.
- The publishing worker checks `published_posts_monthly` and `provider_write_calls_monthly` before publishing. It records provider write attempts when a provider request is sent and records published posts only after the provider returns success.
- When cloud mode has X configured, the publisher creates a durable cost reservation before each X post-create request. It classifies posts with and without URLs using operator-configured prices, then atomically checks confirmed cost plus reservations against a per-workspace monthly safety limit.
- A confirmed provider success turns the reservation into an immutable estimated-cost event. A definite provider error releases it. A network, timeout, response-decoding, or other ambiguous result remains reserved without being reported as confirmed billed cost.
- `provider_usage_period_counters` keeps reconciled UTC-month confirmed and reserved totals for fast workspace-visible reads. Startup reconciliation rebuilds the open month from immutable events and active reservations; bounded pruning never removes open-month events or reservations.
- Provider cost estimates are separate from product subscriptions and entitlement counters. They are a guardrail, not an invoice. X pricing and the X Developer Console remain authoritative.
- Self-hosted mode never installs a provider-cost policy, so these counters cannot block self-hosted publishing.

## Hosted X cost guardrail

The X guardrail is active only when both conditions are true:

1. `OPENPOST_EDITION=cloud`
2. An X adapter is configured

Each reservation and confirmed event uses a hashed idempotency key derived from the workspace, durable job execution, subject, and request phase. Both store the provider, priced operation, units, unit price, estimated cost, and UTC occurrence time. They do not store post text, provider tokens, or provider response bodies.

The default per-workspace budget is $5.00 per UTC month. A request that would make confirmed cost plus reservations exceed the budget is rejected before the provider call. `0` blocks all hosted X publishing. Prices and budgets use millionths of a US dollar so calculations stay integer-only:

- `OPENPOST_X_MONTHLY_BUDGET_MICROUSD=5000000`
- `OPENPOST_X_POST_CREATE_COST_MICROUSD=15000`
- `OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD=200000`

Review these prices when X changes its pay-per-use catalog. OpenPost exposes confirmed cost estimates and unresolved reserved exposure under **Settings → Plan & usage**. Reserved exposure protects the safety limit after an ambiguous result, but it is not presented as billed cost. X pricing and the X Developer Console remain authoritative.

## Monthly metrics

Initial metrics match the production-readiness plan:

- `scheduled_posts_monthly`
- `published_posts_monthly`
- `media_bytes_uploaded_monthly`
- `media_bytes_stored`
- `provider_write_calls_monthly`
- `social_accounts`
- `workspaces`
- `team_members`

## Next enforcement points

- Approval workflows, shared calendars, or other future team-only features should use the same entitlement service instead of checking plan IDs directly.

## Paddle configuration

Hosted/cloud deployments need the complete set below. Set it in the deployment environment or through **Settings → Instance → Configuration → Billing**. An instance administrator can intentionally override an existing environment value; the screen names the environment source and labels the override before and after saving. Database-backed secrets are encrypted and write-only, and every saved change requires a server restart.

This integration replaces Whop billing. Before upgrading an existing cloud deployment, create the Paddle products and prices, configure the notification destination at `/api/v1/billing/paddle/webhook`, and migrate each active customer to a Paddle subscription. OpenPost keeps old Whop subscription rows as historical data, but only Paddle subscriptions grant cloud entitlements after this release.

- `OPENPOST_PADDLE_API_KEY`
- `OPENPOST_PADDLE_ENVIRONMENT`
- `OPENPOST_PADDLE_CLIENT_TOKEN`
- `OPENPOST_PADDLE_WEBHOOK_SECRET`
- `OPENPOST_PADDLE_CHECKOUT_RETURN_URL`
- `OPENPOST_PADDLE_STARTER_MONTHLY_PRICE_ID`
- `OPENPOST_PADDLE_STARTER_ANNUAL_PRICE_ID`
- `OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID`
- `OPENPOST_PADDLE_FOUNDER_ANNUAL_PRICE_ID`
- `OPENPOST_PADDLE_PRO_MONTHLY_PRICE_ID`
- `OPENPOST_PADDLE_PRO_ANNUAL_PRICE_ID`
- `OPENPOST_PADDLE_TEAM_MONTHLY_PRICE_ID`
- `OPENPOST_PADDLE_TEAM_ANNUAL_PRICE_ID`
- `OPENPOST_PADDLE_AGENCY_MONTHLY_PRICE_ID`
- `OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID`

`OPENPOST_PADDLE_ENVIRONMENT` must be exactly `sandbox` or `production`. The API-key and client-token prefixes must match the selected environment, which prevents a sandbox browser from sending a checkout to the live catalog or the reverse.

`OPENPOST_PADDLE_CHECKOUT_RETURN_URL` is the OpenPost checkout completion URL. It normally points to `/checkout?status=success`; OpenPost then waits for the signed webhook and local subscription reconciliation before granting access.

Checkout endpoints return `503` when Paddle is missing required configuration such as `OPENPOST_PADDLE_CLIENT_TOKEN`, an explicit environment, or a monthly/annual price ID. User input errors, such as an unknown OpenPost plan ID, remain `400`.

The browser sends only the opaque checkout attempt ID in Paddle custom data. It initializes Paddle.js with the server-selected environment, asks Paddle `PricePreview` for localized totals, and mounts Paddle's one-page inline checkout inside an OpenPost dialog. OpenPost owns the surrounding plan summary, theme, responsive layout, and close behavior; Paddle continues to own the sensitive payment fields and final localized totals.

Set both the minimum and maximum quantity to `1` on every Paddle plan price. OpenPost subscriptions are workspace plans rather than per-seat line items, so allowing Paddle's default maximum of `100` exposes an invalid quantity stepper at checkout.

Webhooks may be duplicated or arrive out of order. The worker therefore retrieves the current Paddle customer, subscription, or completed transaction before writing local mirrors. Access is granted only for `active` and `trialing` subscriptions. A scheduled cancellation keeps access through the paid period; only Paddle's final `canceled` state removes it. API handlers consume the local snapshot only.

All managed plans use a card-required 14-day trial. Prices are USD-first: Starter $15 monthly or $150 annually, Founder $25 or $250, Pro $49 or $490, Team $99 or $990, and Agency $199 or $1,990.
