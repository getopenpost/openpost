# Bluesky

This page is for users connecting a Bluesky account.

Bluesky is the simplest provider to enable.

## What you need

- A Bluesky account handle
- A Bluesky app password

## Setup

1. In Bluesky, open Settings.
2. Create an app password.
3. Connect the account in OpenPost using the handle and app password.

## Analytics

Analytics is an optional feature per connected Bluesky account. It starts off for a new account. Enable it after connection or in Account details. OpenPost collects follower, following, and post totals plus published-post likes, replies, reposts, and quotes when enabled. These counters come from Bluesky's public AppView endpoints and do not require another account permission. Disabling Analytics stops future Bluesky analytics collection without deleting stored metrics or revoking the app password.

## Comments and inbox

Direct messages and Comments and replies are separate optional features per connected Bluesky account. Each starts off for a new account. Enable them after connection or in Account details.

- Comments and replies: OpenPost can list replies, send replies, and delete replies posted by the connected account when enabled. Disabling it stops future Bluesky comment collection and reply actions without deleting stored replies or revoking the app password.
- Direct messages: OpenPost can collect and send Bluesky chat messages when enabled. Chat needs an app-password connection. Disabling it stops future message collection and sending without deleting stored messages or revoking the app password.

Availability for each feature depends on provider support, required scopes, and plan access as distinct facts.

## Grow

Grow is an optional feature per connected Bluesky account. It starts off for a new account. Enable it after connection or in Account details to discover candidates and follow them through OpenPost. Disabling Grow stops future discovery and follow checks without deleting stored recommendations or revoking the app password. OpenPost never follows automatically, each follow remains an explicit action and requires Grow to stay enabled.

## Notes

- No server-side OAuth app is required.
- OpenPost publishes images through `app.bsky.embed.images` and videos through `app.bsky.embed.video`.
- Bluesky video support is limited to one video attachment per post in OpenPost.
