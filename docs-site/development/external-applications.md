---
description: Register external applications, request delegated OpenPost access, exchange OAuth credentials, and receive signed publication events.
---

# External applications

OpenPost can authorize third-party applications without sharing a user's password, social-provider tokens, or broad API token. External applications use OAuth authorization code with PKCE, receive short-lived REST access tokens and rotating refresh tokens, and can call only the operations mapped to their approved scopes.

This authorization is separate from provider OAuth. An external application can inspect approved social accounts and publish through them. It cannot connect, reconnect, or remove a social account.

## Register an application

An instance administrator opens **Settings → Instance → External applications** and registers:

- a display name;
- a public or confidential client type;
- one or more exact HTTPS redirect URLs;
- the largest set of scopes the application may request.

OpenPost returns the client ID and, for a confidential client, its secret. The secret is shown once. Rotating it invalidates the previous client secret. Revoking the application revokes every installation and access credential issued to it.

Registration is operator-controlled by default. An operator can enable RFC 7591-style dynamic registration with `OPENPOST_OAUTH_DYNAMIC_REGISTRATION_ENABLED=true`. When enabled, the authorization-server metadata advertises `/oauth/register`. The endpoint accepts at most 10 registrations per source IP each hour, 10 redirect URLs per client, 120 characters in a client name, and 2,048 characters in each redirect URL. Do not enable it unless the instance is intended to accept unreviewed clients.

## OAuth flow

Discover the server at `/.well-known/oauth-authorization-server`. The authorization endpoint is `/oauth/authorize`, the token endpoint is `/oauth/token`, and the RFC 7009 revocation endpoint is `/oauth/revoke`.

Use authorization code with an S256 PKCE challenge. Public clients use `token_endpoint_auth_method=none`. Confidential clients can use `client_secret_post` or `client_secret_basic`.

The consent screen lets a workspace administrator select one, several, or all currently eligible workspaces. "All" is a shortcut that records each current workspace as its own grant. It does not include workspaces joined later. Each selected workspace also records selected social accounts or all social accounts that exist at approval time. Accounts connected later are not added automatically.

One installation owns one refresh-token family and separate workspace grants. Access tokens last one hour. Refresh tokens last up to 90 days and rotate on every use. Reusing a rotated refresh token revokes the whole family. Losing administrator access suspends the affected workspace grant immediately. Organization SSO and token policy are checked when consent is granted and whenever the credential is used.

## Scopes

| Scope                   | Access                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `workspace:read`        | List approved workspaces.                                              |
| `accounts:read`         | List approved social accounts.                                         |
| `publications:read`     | Read and validate publications and lifecycle events.                   |
| `drafts:write`          | Create and edit drafts and renditions.                                 |
| `media:read`            | Read media metadata.                                                   |
| `media:write`           | Create, upload, and complete media upload sessions.                    |
| `publications:schedule` | Schedule a publication.                                                |
| `publications:publish`  | Publish a publication now.                                             |
| `publications:cancel`   | Cancel a scheduled publication.                                        |
| `events:subscribe`      | Create and inspect signed webhook subscriptions and delivery attempts. |

Unknown operations fail closed. Provider connection routes, account removal, billing, identity, administration, and arbitrary REST routes are never implied by these scopes.

## Signed webhooks

Create a subscription with `POST /api/v1/external-webhooks`. Choose one granted workspace, an HTTPS endpoint, and lifecycle event types. OpenPost returns the signing secret once.

Deliveries are durable jobs. The event record, delivery record, and queued job are created in the same database transaction. Retries use the normal bounded job policy, and the `(subscription_id, event_id)` constraint prevents duplicate enqueues.

Each request includes:

- `X-OpenPost-Delivery`, the delivery ID;
- `X-OpenPost-Event`, the lifecycle event type;
- `X-OpenPost-Timestamp`, the timestamp used for signing;
- `X-OpenPost-Signature`, `v1=` followed by the lowercase HMAC-SHA256 digest.

Compute the HMAC over `<timestamp>.<raw request body>` with the signing secret, compare it in constant time, and reject stale timestamps before processing the event. Return any `2xx` status only after the event has been accepted durably.

Users can disconnect the whole application or remove one workspace in **Settings → Personal → Developer access**. Applications with `events:subscribe` can list subscriptions and recent delivery attempts through the typed API.

## Existing clients

MCP remains a protected-resource adapter with its existing `mcp:read` and `mcp:full` scopes and Client ID Metadata Document support. Manual `api:*`, `mcp:*`, and `cli:full` tokens remain compatible. External application access uses `external:delegated` internally and cannot be created from the manual token form.

The generated [API Reference](/development/api-reference) is authoritative for request and response bodies.
