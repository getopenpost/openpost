# Billing And Usage Foundation

This page is for contributors changing hosted billing, entitlements, or usage accounting.

Hosted service billing uses saved plan limits and durable usage counters. The backend does not call Paddle on normal API requests.

## Current pieces

- `packages/plan-catalog/src/catalog.json`: the versioned source for hosted plan names, monthly and annual USD list prices, limits, trial length, card requirement, and amount due when the trial starts. Frontend and marketing code read it directly; `scripts/plan-catalog.mjs` generates the Go projection and checks for drift.
- `POST /api/v1/billing/purchase-choice`: creates or revalidates a signed 24-hour continuation for one canonical plan and billing period. The response carries the exact catalogue version, list price, trial, card, due-today, and expiry facts shown during signup.
- Hosted password and explicit identity-provider signup require that purchase choice. Password signup carries it through email verification; identity-provider signup validates it before redirecting and rebuilds the stored onboarding return path from the verified claims. Missing, invalid, expired, or mismatched choices fail closed and require a new pricing selection.
- `POST /api/v1/billing/welcome`: confirms the first Workspace name and exact signed purchase choice. It creates the Organization, Workspace, Owner memberships, and bound checkout attempt in one transaction. An exact retry returns the same attempt; a replay with different Workspace, plan, period, or return path fails closed.
- `GET /api/v1/billing/checkout/{attempt_id}`: resumes the browser-safe checkout configuration for the authenticated user who created the attempt. It never creates another Workspace or checkout attempt.
- `GET /api/v1/workspaces/{id}/setup`: projects the current user's applicable setup guidance from the Workspace name, hosted subscription, active destinations, and scheduled or submitted Publications. It stores no separate onboarding state. Organization Owners receive the complete applicable journey; Organization administrators receive authorized billing guidance; Workspace administrators and editors receive only destination and Publication actions they may perform; viewers receive no setup steps or actions; self-hosted deployments receive no Hosted service plan or checkout steps. The composer and Settings surfaces re-read this projection after refresh and return flows.
- `entitlements.Service`: evaluates plan limits and keeps self-hosted defaults unlimited.
- `usage_counters`: monthly durable counters keyed by workspace, metric, and UTC month.
- `billing_customers`: Paddle customer mirrors keyed by organization, with no payment-card data.
- `billing_subscriptions`: current Paddle subscription snapshots keyed by organization, fenced by Paddle's `updated_at` value so an older fetch cannot replace a newer recovery state.
- `billing_checkout_attempts`: opaque OpenPost checkout attempt mapping, including the selected Paddle price, product plan, billing period, and a unique confirmation key for first-Workspace retries.
- `billing_webhook_events`: webhook event ledger for idempotent Paddle processing, including Paddle's event occurrence time and OpenPost's processing time.
- `GET /api/v1/organizations/{id}/billing/status`: returns the local subscription snapshot and current-month usage counters for an organization.
- `POST /api/v1/organizations/{id}/billing/checkout`: records an opaque checkout attempt and returns the Paddle.js environment, browser-safe client token, selected price, period price map, authenticated email, and OpenPost return URL.
- `POST /api/v1/organizations/{id}/billing/portal`: creates a fresh, short-lived Paddle customer portal session after organization-admin authorization.
- Workspace billing endpoints resolve the same organization-scoped contract for web and CLI clients. `POST /api/v1/billing/portal` accepts `purpose: "update_payment_method"` to return only the exact subscription's payment-method form.
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

Review these prices when X changes its pay-per-use catalog. OpenPost exposes confirmed cost estimates and unresolved reserved exposure under **Settings → Organization → Plan & usage**. Reserved exposure protects the safety limit after an ambiguous result, but it is not presented as billed cost. X pricing and the X Developer Console remain authoritative.

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

Hosted/cloud deployments need the complete set below. Set it in the backend process environment or through **Settings → Instance → Configuration → Billing** - this is the single runtime location. In local devenv, use `backend/.env`; in Docker/production, use the backend container environment. Bare `PADDLE_*` without the `OPENPOST_` prefix is never consumed and triggers a startup warning that lists the ignored names without printing values. An instance administrator can intentionally override an existing environment value; the screen names the environment source and labels the override before and after saving. Database-backed secrets are encrypted and write-only, and every saved change requires a server restart. In cloud mode the backend validates all required Paddle variables at startup and fails with the exact missing `OPENPOST_PADDLE_*` names without printing secret values.

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

## Billing data and portal boundary

The billing status API reads the local Paddle subscription and customer mirrors plus OpenPost usage counters. It returns the billing contact only when a Paddle customer snapshot contains an email. It does not synthesize missing plan, status, date, limit, contact, or amount facts. OpenPost has no dedicated payment-method, card, invoice, or receipt records. Raw provider payloads remain available for reconciliation and audit, but the product does not parse them into locally managed payment methods or invoice documents.

Portal requests accept `manage`, `update_payment_method`, `cancel_subscription`, `invoices`, or `billing_details`. Paddle currently returns purpose-specific subscription URLs for payment-method updates and cancellation. The service verifies that such a URL belongs to the local subscription. Invoices and billing details use Paddle's general portal because Paddle does not expose purpose-specific URLs for them. A missing exact link also falls back to the general URL. The response reports `used_generic_fallback`, and every request creates a new temporary session whose URL is not persisted.

The browser sends only the opaque checkout attempt ID in Paddle custom data. It initializes Paddle.js with the server-selected environment, asks Paddle `PricePreview` for localized totals, and mounts Paddle's one-page inline checkout directly in the standalone OpenPost checkout page. OpenPost owns the surrounding plan summary, responsive layout, loading and error states, and a contrast-safe light payment canvas; Paddle continues to own the sensitive payment fields and final localized totals.

Set both the minimum and maximum quantity to `1` on every Paddle plan price. OpenPost subscriptions are workspace plans rather than per-seat line items, so allowing Paddle's default maximum of `100` exposes an invalid quantity stepper at checkout.

Webhooks may be duplicated or arrive out of order. The worker therefore retrieves the current Paddle customer, subscription, or completed transaction before writing local mirrors. Event `occurred_at` is retained for delivery audit, but it never overrides a newer canonical subscription snapshot. The subscription mirror applies only a strictly newer Paddle `updated_at` value; an identical snapshot is an idempotent no-op, and conflicting payloads with the same provider version fail closed.

## Failed-payment recovery

Paddle changes an automatically collected subscription to `past_due` after a failed payment and runs the recovery schedule configured for the Paddle account. OpenPost does not invent a payment deadline because retry timing and the final action can differ by account. It records when the current canonical `past_due` state began, restricts paid-plan actions immediately, and shows the issue to every affected organization member.

Organization owners and admins can start recovery in one action. OpenPost creates a new Paddle portal session for each click, requests links for the exact local subscription, and verifies that Paddle returned the same customer. It returns the exact temporary `update_subscription_payment_method` URL when Paddle provides one, or the new general portal URL as a safe fallback. The URL is never stored. Members without billing permission see the same account-wide state and are told to contact an organization owner or admin.

Paddle remains the source of truth after the payment method changes. The notice stays visible until a signed webhook job fetches a strictly newer canonical subscription with `active` status. That recovery clears `past_due_since` and restores paid-plan access. A stale or repeated `past_due` event cannot reinstate the failure after the newer active snapshot has been saved.

See Paddle's documentation for [`past_due` subscription recovery](https://developer.paddle.com/webhooks/subscriptions/subscription-past-due), [webhook delivery and ordering](https://developer.paddle.com/webhooks/about/how-webhooks-work), and [temporary payment-method portal links](https://developer.paddle.com/build/subscriptions/update-payment-details/).

Access is granted only for `active` and `trialing` subscriptions. A scheduled cancellation keeps access while Paddle still reports one of those states. `past_due`, paused, and canceled subscriptions do not grant paid-plan access. API handlers consume the local snapshot only.

See the [canonical Hosted service pricing](https://openpost.social/pricing) for current plan names, prices, trial terms, and limits.
