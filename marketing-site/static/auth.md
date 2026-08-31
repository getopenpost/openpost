# OpenPost Auth.md

This file tells agents and machine clients how a user grants access to OpenPost. Never ask a user to paste a password, session cookie, or raw token into a prompt.

## Hosted service

- Register or sign in: https://app.openpost.social/register
- API base: https://app.openpost.social/api/v1
- MCP endpoint: https://app.openpost.social/mcp
- OpenAPI contract: https://docs.openpost.social/openapi.json
- Authentication guide: https://docs.openpost.social/development/api-tokens

## MCP OAuth

MCP clients should discover the supported authorization flow from these public documents:

- Protected resource metadata: https://app.openpost.social/.well-known/oauth-protected-resource
- Authorization server metadata: https://app.openpost.social/.well-known/oauth-authorization-server

The hosted service uses the OAuth authorization-code flow with PKCE. It supports `mcp:read` and `mcp:full`. A browser opens so the signed-in user can review and approve access.

This is a standard OAuth client authorization flow. OpenPost does not currently advertise the separate auth.md agent-registration protocol, so agents must not assume that `/agent-auth`, identity-assertion, claim, or revocation endpoints exist.

## API tokens

A signed-in user can create a revocable token under **Settings -> Developer access** and limit it by scope and Workspace. Send it only in an HTTP header:

```http
Authorization: Bearer <token>
```

Use `api:read` for read-only API work, `api:write` for API mutations, `mcp:read` for read-only MCP tools, or `mcp:full` for MCP mutations. Use `cli:full` only for the OpenPost CLI. Keep each token in a secret store, never put one in a URL, and revoke it when the client no longer needs access.

Self-hosted OpenPost instances expose the same API, MCP, metadata, scopes, and header format at their own origin.
