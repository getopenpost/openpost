---
description: Understand Pinterest's implemented adapter boundary and why public connections remain unavailable without Standard access and live certification.
---

# Pinterest

This page is for operators reviewing Pinterest's certification boundary.

Pinterest is **not publicly available in OpenPost**. The repository contains adapter and contract paths for controlled development and certification, but an implementation, configured credential, or mocked test is not a Hosted service availability claim.

Do not advertise or enable public Pinterest connection, publishing, discovery, or analytics operations unless the exact app, account, scopes, output profile, policy mode, runtime controls, and current live evidence pass the [Provider Readiness and Launch Gate](/operations/provider-launch-matrix).

## Required readiness

Production use requires Pinterest Standard API access. Trial access is limited to development and certification work and must not be treated as production approval.

Each intended operation must remain fail-closed until its own evidence is current:

- OAuth connection and refresh;
- board and optional board-section targeting;
- image or video Pin publishing;
- account-content discovery;
- account and Pin analytics.

## Implemented contract inventory

The controlled certification paths include OAuth token refresh and revocation, board targeting, bounded Pin discovery, analytics measurement, image Pins, and resumable video processing. These facts describe repository code only; they do not make Pinterest selectable for public Hosted accounts.

Pinterest content requires a board. A board section is optional and must belong to the selected board. Implemented validation accepts one to five JPEG, PNG, or WebP images, or one MP4 video with its required cover and metadata. Pin titles and descriptions use separate provider limits.

## Operator boundary

Keep Pinterest readiness controls disabled for normal production traffic until current live certification exists. Store OAuth credentials through the encrypted provider-app boundary, never in workspace data, logs, jobs, or documentation.

Use the [provider application configuration guide](/configuration/provider-applications) for the private operator contract and the [launch matrix](/operations/provider-launch-matrix) for the evidence required before any public claim changes.
