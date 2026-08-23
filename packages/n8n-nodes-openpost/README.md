# @openpost/n8n-nodes-openpost

Official n8n community node for OpenPost. The package is MIT licensed and calls the normal OpenPost `/api/v1` REST API with API tokens.

## Credentials

Create an OpenPost API token in OpenPost settings. For write workflows, prefer a workspace-bound `api:write` token named after the n8n workflow or instance.

In n8n, set:

- **Base URL**: your OpenPost origin, for example `https://app.openpost.dev`. Do not include `/api` or `/api/v1`.
- **API Token**: the OpenPost API token.

If n8n runs in Docker, `localhost` means the n8n container. Use the OpenPost Compose service name or `host.docker.internal` when needed.

## Actions

The node exposes a curated automation surface generated from OpenPost's canonical OpenAPI `x-openpost-automation` metadata:

- Workspace: Get Many
- Account: Get Many, Get Destination Options, Get Provider Readiness
- Social Set: Get, Get Many
- Posting Schedule: Get Next Available Slot
- Media: Get Many, Upload Binary
- Publication: Create, Get, Get Many, Update, Set Renditions, Validate, Schedule, Cancel, Publish Now, Retry Failed Renditions, Get Events

Create, Schedule, and Publish Now are separate operations. Creating a Publication never publishes as a hidden side effect.

## Reliability and safety

- Write actions send an `Idempotency-Key`. If you leave it blank, the node uses the n8n execution ID, action, and input item index.
- Read actions retry transient network, `429`, `502`, `503`, and `504` failures.
- Write actions retry only when an idempotency key is present.
- Errors include OpenPost `X-Request-ID` when the server returns it.
- Multiple input items preserve n8n item linking and support continue-on-fail.
- Binary upload creates an OpenPost upload session, uploads bytes to the returned target with only target headers, then completes the session through authenticated OpenPost REST. The OpenPost bearer token is never sent to storage upload URLs.

## Contract report

See [`docs/selected-contract-report.md`](docs/selected-contract-report.md) for the generated action list and known catalog metadata gaps.
