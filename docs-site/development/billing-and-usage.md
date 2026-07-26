# Billing And Usage Foundation

OpenPost Cloud billing is built around local entitlement snapshots and durable usage counters. The backend should not call Polar on every API request.

## Current pieces

- `entitlements.Service`: evaluates plan limits and keeps self-hosted defaults unlimited.
- `usage_counters`: monthly durable counters keyed by workspace, metric, and UTC month.
- `billing_subscriptions`: local Polar subscription snapshots keyed by organization, with legacy workspace metadata preserved for compatibility.
- `billing_webhook_events`: webhook event ledger for idempotent Polar processing.
- `GET /api/v1/organizations/{id}/billing/status`: returns the local subscription snapshot and current-month usage counters for an organization.
- `POST /api/v1/organizations/{id}/billing/checkout`: creates a Polar checkout for the requested plan and organization.
- `POST /api/v1/organizations/{id}/billing/portal`: creates a Polar customer portal session for the organization.
- Legacy workspace billing endpoints remain for compatibility while clients move to organization routes.
- `POST /api/v1/billing/polar/webhook`: verifies Standard Webhooks signatures and upserts local subscription state.
- Cloud mode reads `billing_subscriptions.entitlement_snapshot` for organization-scoped quota checks.
- Workspace creation checks `LimitWorkspaces` before inserting a new workspace. In cloud mode, users get a one-workspace bootstrap allowance before checkout; after a subscription is active, workspace creation uses the active organization subscription snapshot.
- Provider connection flows check `social_accounts` before inserting a new active social account.
- Workspace invitation creation checks `team_members` before issuing a link. The check counts active members plus non-expired pending invitations so a plan cannot over-reserve seats.
- Media uploads check `media_bytes_uploaded_monthly` and `media_bytes_stored`; successful new uploads increment monthly uploaded-byte usage.
- Scheduled single posts and threads check `scheduled_posts_monthly` before inserting posts or jobs; successful scheduled creates increment monthly scheduled-post usage.
- The publishing worker checks `published_posts_monthly` and `provider_write_calls_monthly` before publishing. It records provider write attempts when a provider request is sent and records published posts only after the provider returns success.

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

## Polar configuration

Set these only on hosted/cloud deployments:

- `OPENPOST_POLAR_ACCESS_TOKEN`
- `OPENPOST_POLAR_API_BASE_URL`
- `OPENPOST_POLAR_WEBHOOK_SECRET`
- `OPENPOST_POLAR_CHECKOUT_SUCCESS_URL`
- `OPENPOST_POLAR_RETURN_URL`
- `OPENPOST_POLAR_STARTER_PRODUCT_ID`
- `OPENPOST_POLAR_CREATOR_PRODUCT_ID`
- `OPENPOST_POLAR_PRO_PRODUCT_ID`
- `OPENPOST_POLAR_TEAM_PRODUCT_ID`
- `OPENPOST_POLAR_AGENCY_PRODUCT_ID`

`OPENPOST_POLAR_RETURN_URL` is the OpenPost app URL Polar should return users to after hosted checkout or customer portal flows, usually `Settings -> Organization -> Billing`. `OPENPOST_POLAR_CUSTOMER_PORTAL_URL` is still accepted as a legacy alias.

`OPENPOST_POLAR_API_BASE_URL` defaults to `https://api.polar.sh/v1`. Set it to `https://sandbox-api.polar.sh/v1` for Polar sandbox testing.

Checkout and customer portal endpoints return `503` when Polar is missing required server-side configuration such as `OPENPOST_POLAR_ACCESS_TOKEN` or a plan product ID. User input errors, such as an unknown plan ID, remain `400`.

Checkout metadata uses primitive `limit_<metric>` keys, for example `limit_scheduled_posts_monthly`, because Polar metadata values are primitive values. The webhook processor rebuilds those keys into the local entitlement snapshot. API handlers consume local snapshots only; they do not call Polar on quota checks.
