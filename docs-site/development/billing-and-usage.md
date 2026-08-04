# Billing And Usage Foundation

Managed OpenPost billing uses saved plan limits and durable usage counters. The backend does not call Whop on normal API requests.

## Current pieces

- `entitlements.Service`: evaluates plan limits and keeps self-hosted defaults unlimited.
- `usage_counters`: monthly durable counters keyed by workspace, metric, and UTC month.
- `billing_subscriptions`: current Whop membership snapshots keyed by organization.
- `billing_checkout_attempts`: OpenPost-to-Whop checkout configuration mapping, including the selected product plan and billing period.
- `billing_webhook_events`: webhook event ledger for idempotent Whop processing.
- `GET /api/v1/organizations/{id}/billing/status`: returns the local subscription snapshot and current-month usage counters for an organization.
- `POST /api/v1/organizations/{id}/billing/checkout`: creates a Whop checkout configuration and returns the OpenPost embedded-checkout URL.
- `POST /api/v1/organizations/{id}/billing/portal`: returns the current Whop membership management URL.
- Workspace billing endpoints resolve the same organization-scoped contract for web and CLI clients.
- `POST /api/v1/billing/whop/webhook`: verifies Whop Standard Webhooks signatures, stores the event once, and queues reconciliation.
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

## Whop configuration

Hosted/cloud deployments need the complete set below. Set it in the deployment environment or through **Settings → Instance → Configuration → Billing**; environment values stay authoritative and appear read-only in the app. Database-backed secrets are encrypted and write-only, and every saved change requires a server restart.

- `OPENPOST_WHOP_API_KEY`
- `OPENPOST_WHOP_API_BASE_URL`
- `OPENPOST_WHOP_WEBHOOK_SECRET`
- `OPENPOST_WHOP_ACCOUNT_ID`
- `OPENPOST_WHOP_PRODUCT_ID`
- `OPENPOST_WHOP_CHECKOUT_RETURN_URL`
- `OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID`
- `OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID`
- `OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID`
- `OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID`
- `OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID`
- `OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID`
- `OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID`
- `OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID`
- `OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID`
- `OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID`

`OPENPOST_WHOP_CHECKOUT_RETURN_URL` is the OpenPost checkout completion URL. It normally points to `/checkout?status=success`; OpenPost then waits for the signed webhook and local membership reconciliation before granting access.

`OPENPOST_WHOP_API_BASE_URL` defaults to `https://api.whop.com/api/v1`.

Checkout endpoints return `503` when Whop is missing required server-side configuration such as `OPENPOST_WHOP_API_KEY` or a monthly/annual plan ID. User input errors, such as an unknown OpenPost plan ID, remain `400`.

Checkout metadata carries the OpenPost organization, workspace, user, plan, and billing period. Webhooks may be duplicated or arrive out of order, so the worker retrieves the current Whop membership before writing the local subscription snapshot. API handlers consume that local snapshot only.

All managed plans use a card-required 14-day trial. Prices are USD-first: Starter $15 monthly or $150 annually, Creator $29 or $290, Pro $49 or $490, Team $99 or $990, and Agency $199 or $1,990.
