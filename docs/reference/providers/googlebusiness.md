---
description: Understand Google Business Profile's implemented adapter boundary and why public connections remain unavailable without Google API access and live certification.
---

# Google Business Profile

This page is for operators reviewing Google Business Profile's certification boundary.

Google Business Profile is **not publicly available in OpenPost**. The repository contains adapter and contract paths for controlled development and certification, but an implementation, configured credential, or mocked test is not a Hosted service availability claim.

Do not advertise or enable public Google Business connection, publishing, discovery, or analytics operations unless the exact app, account, scopes, output profile, policy mode, runtime controls, and current live evidence pass the [Provider Readiness and Launch Gate](../operations/provider-launch-matrix.md).

## Required readiness

Production use requires Google approval for the Business Profile APIs on the operator's own Google Cloud project. Google enables the legacy Local Posts surface (`mybusiness.googleapis.com`) only after an access request is approved; new projects without that approval receive `SERVICE_DISABLED` even when the Business Information and Account Management APIs are enabled. Approval can take days and must not be treated as granted until the project can create a post against a live location.

Each intended operation must remain fail-closed until its own evidence is current:

- OAuth connection and refresh through an instance-owned Google app;
- location selection across every account in the grant, filtered to locations that report local-post operability;
- STANDARD, EVENT, and OFFER local post publishing with durable reconciliation;
- location analytics through the performance surface (no per-post insights exist).

## Implemented contract inventory

The controlled certification paths include OAuth token exchange, refresh, and revocation, multi-account location enumeration with operability filtering, STANDARD/EVENT/OFFER payload validation, create-then-reconcile publishing, and provider-returned `searchUrl` handling. These facts describe repository code only; they do not make Google Business selectable for public Hosted accounts.

Posting content requires a selected location. The summary supports at most 1500 characters. At most one JPEG or PNG photo is attached by public HTTPS URL, and Google fetches the bytes itself, so the Google-compatible derivative must stay alive until moderation finishes. EVENT posts require an event title of at most 58 characters plus a start date; OFFER posts additionally require a coupon code or redemption URL and carry no call-to-action button because Google ignores it on that type. Call-to-action buttons on STANDARD and EVENT posts use Book, Order, Shop, Learn more, Sign up, or Call.

Create acceptance is never publication: every created post reconciles through a durable reference until Google reports LIVE, stays pending through PROCESSING and SCHEDULED states without replaying the write, and settles rejected posts as terminal. Location analytics remain pending; Google offers no per-post insights for local posts, so content analytics stay unsupported.

## Operator boundary

Keep Google Business readiness controls disabled for normal production traffic until current live certification exists. Store OAuth credentials through the encrypted provider-app boundary, never in workspace data, logs, jobs, or documentation.

Use the [provider application configuration guide](../configuration/provider-applications.md) for the private operator contract and the [launch matrix](../operations/provider-launch-matrix.md) for the evidence required before any public claim changes.
