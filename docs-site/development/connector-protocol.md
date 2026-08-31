---
description: Implement the authenticated Connector Protocol 1.0 contract for custom text destinations.
---

# Connector Protocol 1.0

For connector authors implementing the authenticated Connector Protocol 1.0 text publishing contract.

Connector Protocol 1.0 lets a self-hosted OpenPost instance publish text through an operator-run service. Use it for a destination that has a stable API and does not fit a built-in provider.

Do not use a connector to load code into OpenPost or to expose an arbitrary user-supplied URL. The connector runs as its own process and keeps all destination credentials.

The reference types live in [`backend/internal/connectors`](https://github.com/getopenpost/openpost/tree/main/backend/internal/connectors). The [Directus connector](https://github.com/getopenpost/openpost/tree/main/examples/connectors/directus) shows a complete server.

## Required behavior

A Protocol 1.0 connector must:

- expose all six routes below
- require the configured bearer token on every route
- return JSON and reject unknown request fields
- complete a preconfigured connection in one request
- declare at least one text-only output profile
- treat each `operation_id` as an idempotency key
- record or reserve the operation before its first destination write
- reconcile an uncertain write through the operation route
- return typed problem JSON for failures
- keep destination secrets out of responses and logs

OpenPost sends `Authorization: Bearer <token>` and `Accept: application/json, application/problem+json` on every request. JSON requests use `Content-Type: application/json`. Keep responses at or below 1 MiB.

## Publish flow

OpenPost follows this order:

1. Read and validate the manifest at startup.
2. Read connector and destination health.
3. Create a Workspace-scoped connection and store the returned account binding.
4. Resolve capabilities for the selected output profile and settings.
5. Store the connector's capability revision with the Rendition.
6. Enter OpenPost's durable provider-write fence.
7. Send one deterministic `operation_id` with the publish request.
8. Store a published result or poll a pending operation.

If a transport error occurs after a possible write, OpenPost treats the result as unknown. It does not make an unsafe blind retry. Your connector must make the same operation safe to repeat or expose its result through `GET /v1/operations/{operation_id}`.

## Manifest

`GET /v1/manifest` describes the connector without exposing secrets.

```json
{
  "protocol_version": "1.0",
  "implementation_version": "0.1.0",
  "provider": {
    "id": "com.example.articles",
    "display_name": "Example articles",
    "description": "Create an article in the configured site."
  },
  "capability_revision": "articles-v1",
  "connection": {
    "modes": ["preconfigured"]
  },
  "publishing": {
    "output_profiles": [
      {
        "id": "example.article",
        "display_name": "Create article",
        "profile": "short_text",
        "intents": ["post"],
        "content": {
          "required": true,
          "max_length": 100000
        },
        "title": {
          "required": false,
          "max_length": 1000
        },
        "description": {
          "required": false,
          "max_length": 10000
        },
        "media": {
          "min_items": 0,
          "max_items": 0
        },
        "settings": [
          {
            "key": "status",
            "label": "Status",
            "help": "Article status",
            "control": "select",
            "required": true,
            "default": "draft",
            "options": ["draft", "published"]
          }
        ]
      }
    ]
  },
  "operations": {
    "polling": true
  }
}
```

Keep `provider.id` stable across installations and releases. It identifies the connector type, not one installed instance. Do not use a built-in provider ID.

Change `capability_revision` when a stored Rendition could become invalid or publish differently because you changed a limit, setting, output profile, or destination rule. OpenPost then requires old account bindings to reconnect before publishing.

Protocol 1.0 accepts only:

- connection mode `preconfigured`
- profile `short_text`
- intent `post`
- zero media items
- setting controls `text`, `textarea`, `number`, `select`, `radio`, and `checkbox`

IDs may contain letters, numbers, `.`, `_`, `:`, `/`, and `-`. They must start with a letter or number and cannot exceed 128 characters.

## Health

`GET /v1/health` checks the connector and any destination service needed to publish.

```json
{
  "status": "ready"
}
```

Return a non-2xx problem response when the connector cannot publish. OpenPost quarantines an optional failed installation. A failed required installation blocks startup.

## Connection

`POST /v1/connections` receives the Workspace that requested the connection.

```json
{
  "workspace_id": "workspace-id"
}
```

Return a stable opaque `connection_ref` and one to 100 accounts:

```json
{
  "state": "complete",
  "connection_ref": "site/primary",
  "accounts": [
    {
      "id": "articles",
      "username": "articles",
      "display_name": "Primary articles"
    }
  ]
}
```

`state` must be `complete`. Account IDs must be unique opaque IDs. `avatar_url`, when present, must be an absolute HTTPS URL. Do not return credentials in account metadata.

## Capability resolution

`POST /v1/capabilities/resolve` asks whether the connection can use an output profile with the selected settings.

```json
{
  "connection_ref": "site/primary",
  "output_profile": "example.article",
  "intent": "post",
  "settings": {
    "status": "draft"
  }
}
```

A usable result returns the current revision:

```json
{
  "capability_revision": "articles-v1",
  "available": true,
  "constraints": {
    "collection": "articles"
  }
}
```

If the destination cannot use this profile or these settings, return `available: false` and an `unavailable_reason`. Do not use this route to mutate destination state.

## Publishing

`POST /v1/publishes` asks the connector to perform one destination write.

```json
{
  "operation_id": "opaque-deterministic-id",
  "connection_ref": "site/primary",
  "capability_revision": "articles-v1",
  "output_profile": "example.article",
  "content": "The article body.",
  "title": "Article title",
  "description": "A short description.",
  "settings": {
    "status": "draft"
  }
}
```

Validate the connection, revision, profile, content, and settings before any external write. Then reserve `operation_id` in durable storage. A repeated request with the same operation ID must return the first operation's current result without creating another destination item.

For an immediate result:

```json
{
  "status": "published",
  "external_id": "42",
  "external_url": "https://cms.example.com/items/42",
  "idempotency_ttl_seconds": 31536000
}
```

`external_id` is required for `published`. `external_url`, when present, must be an absolute HTTPS URL. `idempotency_ttl_seconds` tells OpenPost how long the connector keeps the operation safe to repeat. The maximum is one year.

For work that continues after the request:

```json
{
  "status": "pending",
  "provider_reference": "job-42",
  "poll_after_seconds": 5
}
```

`poll_after_seconds` must fall between 1 and 3600. Set `operations.polling` to `true` in the manifest.

## Operation lookup

`GET /v1/operations/{operation_id}` returns the same `published` or `pending` shape as the publish route.

Return `404` with a typed problem only when the connector knows that the operation does not exist and no destination write occurred. If a write may have occurred, keep the result pending or return a problem with `outcome: "unknown"`. Never report a possible write as safe to retry.

## Problem responses

Use a non-2xx status and typed problem JSON for all failures. `application/problem+json` is the preferred response type. Do not return `status: "failed"` in a successful response.

```json
{
  "title": "Destination rejected the item",
  "status": 422,
  "detail": "The configured collection does not accept this status.",
  "kind": "provider_error",
  "provider_code": "invalid_status",
  "action": "Check the collection status values.",
  "outcome": "rejected"
}
```

| Field           | Use                                                                        |
| --------------- | -------------------------------------------------------------------------- |
| `kind`          | Stable connector error class for OpenPost.                                 |
| `provider_code` | Stable destination-specific code when one exists.                          |
| `action`        | Safe operator action. Do not include a token or response body.             |
| `outcome`       | `rejected` when no write occurred, or `unknown` when it may have occurred. |
| `retry_after`   | Optional delay in seconds for a safe retry.                                |

Keep `kind` and `provider_code` stable enough for logs and support. Write `title`, `detail`, and `action` for a person who does not know the connector's code.

## Idempotency rules

The `operation_id` is the key safety rule in this protocol.

1. Validate everything that can fail without a write.
2. Reserve the operation in durable storage.
3. Start the destination write.
4. Store the destination ID and current state.
5. Return the stored result for every repeat request.
6. Keep an uncertain operation pending until you can reconcile it.

A destination with a unique idempotency field can use that field as the operation journal. Otherwise, the connector needs its own durable store. An in-memory map is not enough because scheduled jobs and retries survive process restarts.

## Security rules

- Compare bearer tokens without timing leaks.
- Do not log authorization headers, request bodies that may contain private post text, destination responses, or secrets.
- Apply short request and destination timeouts.
- Limit request and response bodies.
- Reject unknown JSON fields and extra JSON values.
- Validate every ID, URL, field name, setting, and content limit before use.
- Do not return arbitrary HTML, JavaScript, Svelte, or raw SVG. OpenPost renders only its own controls from validated manifest settings.
- Keep destination access narrow. A connector token should reach only the connector. A destination token should reach only the required destination data.

## Test checklist

Before shipping a connector, prove that it:

- rejects a missing or wrong bearer token on every route
- returns a manifest that OpenPost accepts
- fails health when its required destination is unavailable
- never exposes an account outside the intended preconfigured connection
- rejects an old capability revision before writing
- rejects invalid content and settings before writing
- returns the same result for concurrent requests with one `operation_id`
- returns the same result after the connector restarts
- creates one destination item when the first response times out after the write
- reports an unknown result without causing a blind retry
- redacts tokens, post bodies, and destination responses from logs
- keeps every response at or below 1 MiB

For operator setup and endpoint policy, see [Custom connectors](/configuration/custom-connectors).
