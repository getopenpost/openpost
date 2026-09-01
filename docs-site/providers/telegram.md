---
description: Understand Telegram bot mode's implemented boundary and why it remains publicly unavailable without current live certification.
---

# Telegram bot mode

This page is for operators reviewing Telegram bot mode's certification boundary.

Telegram bot mode is **not publicly available in OpenPost**. The repository contains controlled connection, publishing, observation, and analytics paths, but a configured bot or passing fixture test is not a Hosted service availability claim.

Do not advertise or enable public Telegram bot operations unless the exact bot, destination, operation, policy mode, runtime controls, and current live evidence pass the [Provider Readiness and Launch Gate](/operations/provider-launch-matrix).

## Required readiness

Connect, publish, observation, and analytics are independent gates. Evidence for one operation never enables another.

The bot is instance-owned. Its token and webhook secret remain in encrypted operator configuration and must not be copied into workspace data, jobs, logs, connection links, or later API responses. A one-time `/connect` command is returned only through its authenticated issuance response and expires after 15 minutes.

## Implemented contract inventory

The controlled certification paths can bind an eligible channel or supergroup, recheck destination identity and bot permissions, send text and media, preserve accepted message receipts, observe channel posts from installation onward, and record reaction counts. These facts describe repository code only; they do not make Telegram selectable for public Hosted accounts.

Implemented publishing limits include 4,096 characters for a text message, 1,024 characters for a media caption, and up to 10 media items in one group. Caption overflow becomes a visible ordered follow-up. OpenPost does not invent historical coverage: observation begins at bot installation and does not backfill earlier messages.

## Operator boundary

Keep every Telegram readiness control disabled for normal production traffic until current live certification exists. Reject webhook requests without the configured secret header, and never log raw update payloads or bot credentials.

Use the [provider application configuration guide](/configuration/provider-applications) for the private operator contract and the [launch matrix](/operations/provider-launch-matrix) for the evidence required before any public claim changes.
