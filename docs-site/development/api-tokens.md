# API Tokens

OpenPost API tokens are account credentials for the REST API, MCP clients, the CLI, and automation. Create one token per client in **Settings → Personal → Developer access**, give it the narrowest scope and workspace boundary that works, and revoke it when that client no longer needs access.

## Create and store a token

1. Enter a name that identifies the client or job.
2. Choose a scope and, when possible, one workspace.
3. Choose 30 days, 90 days, one year, or a custom expiration date. The server rejects dates in the past or more than one year away.
4. Create the token and copy the full secret from the one-time result.

The full secret is never stored in plaintext and cannot be shown again. OpenPost lists only a short prefix, scope, workspace boundary, creation time, last use, expiration, and active, expired, or revoked status. If the secret is lost, revoke it and create a replacement.

An omitted or JSON `null` `expires_at` uses the finite 90-day default. Existing tokens created under older versions may have no expiration; the settings list labels those explicitly. New tokens cannot request an unlimited lifetime.

## REST scopes

Use an `Authorization: Bearer <token>` header. REST scopes are operation allowlists, not route-prefix guesses. Unknown operations and legacy Echo routes fail closed, except for the named instance-hosted upload-session content step returned by the documented create-session operation.

`api:read` permits the documented read operations for workspaces, workspace settings, publishing accounts, provider readiness and capabilities, social sets, media metadata and usage, publications and events, validation, and posting schedules.

`api:write` includes `api:read` and permits the publication create, edit, rendition, schedule, publish-now, and retry operations; the complete media upload-session flow (create, a returned instance-hosted content URL when applicable, and complete), metadata update, favorite, trash, restore, batch delete, and analysis-retry operations; social-set changes; and posting-schedule changes. It does not grant the older direct or batch upload routes, account administration, billing, identity, token-management, or arbitrary MCP access.

The generated [API Reference](/development/api-reference) is the source for paths and request bodies. A `403` from a valid token means its scope or workspace boundary does not permit that operation.

## MCP and CLI scopes

- `mcp:read` exposes only query operations through MCP.
- `mcp:full` adds MCP operations that change OpenPost or call a social provider. The MCP client still controls its approval prompt.
- `cli:full` preserves the CLI and existing automation contract. It has broad REST access, including account- and organization-level commands. A workspace binding limits workspace-owned resources, blocks organization-level resources, and retains account-level abilities. An unbound token owned by an instance administrator may set `intent=certification_test` when starting provider authorization and `execution_intent=certification_test` when queuing publication work. These test intents are separate from the provider-readiness ledger routes under `/api/v1/admin/provider-readiness`, which require a signed-in browser session, as does the rest of the instance control plane.

REST scopes cannot call MCP, and MCP scopes cannot be used as generic REST credentials. This separation keeps each credential tied to its real client contract.

## Workspace boundaries

A workspace-bound token can use workspace-owned resources only in that exact workspace, subject to the user's current role there. Losing workspace membership also removes that workspace access. Organization-level resources are unavailable to workspace-bound tokens. Account-level operations remain available when the token's scope permits them; for example, workspace binding does not narrow the broad account-level commands in `cli:full`. An all-workspace token follows the account into workspaces joined later and retains the account- and organization-level commands allowed by its scope, so reserve it for deliberate account-wide automation.

If an organization requires SSO, its token policy can deny app tokens or require a one-workspace boundary. Creating a token for that workspace requires a current browser-session assurance from one of the organization's approved identity providers. The token inherits that provider and assurance time, cannot use organization-level resources, and is rejected after the configured assurance age.

Migration 084 changes older organization-wide token policies to workspace-scoped mode. It does not auto-bind existing unbound credentials; those tokens can no longer access required-SSO resources. Revoke them and issue one assured token per required workspace, or choose the deny policy.

The browser CLI approval page lets the user choose a workspace or all workspaces. The backend verifies current membership before saving a bound approval. CLI and MCP approval endpoints require a signed-in browser session, so an existing bearer token cannot authorize a new credential. See [CLI authentication](/cli/authentication) for the device flow.

## Rotation and revocation

Create the replacement first, update the client, confirm it works, and then revoke the old token. Revocation is immediate and irreversible. Expired and revoked tokens are rejected before the requested operation runs, and their full secrets never appear in lists, logs, or activity views.
