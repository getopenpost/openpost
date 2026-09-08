# Logs

## Docker Compose

```bash
docker compose logs -f openpost
```

## Docker

```bash
docker logs -f openpost
```

## systemd

```bash
journalctl -u openpost -f
```

## Request reachability

Each HTTP request log includes both the requested path and the normalized matched route, such as `/api/v1/publications/:id`. The normalized route lets operators aggregate endpoint use without treating every resource ID as a separate path.

The `consumer` field is a low-cardinality hint: `web`, `cli`, `mcp`, `mcp-media`, `n8n`, or `api`. OpenPost derives it from known client User-Agent prefixes, a browser marker, and the MCP route, then discards the full User-Agent from this request log. Callers can set that header themselves, so the field is useful for deprecation and reachability review but is not an authentication, authorization, billing, or audit identity.

## Instance audit evidence

Instance administrators can inspect consequential identity, impersonation,
billing, provider, MCP, access, Publication, and destructive outcomes in
**Settings → Instance → Instance audit**. This is a read projection over each domain's
authoritative records. It does not replace application logs or drive domain
state.

The list and JSON or CSV exports contain opaque IDs, actions, results, times,
and allowlisted changed fields. They exclude emails, authored content, secrets,
tokens, invitation links, credentials, arbitrary identity details, provider
payloads, and provider responses. Access requires a signed-in browser session
for a current instance administrator; scoped tokens and non-browser credentials
are rejected.

Before retiring an API route, review this normalized request evidence for a representative period and inspect known CLI, MCP, frontend, and automation consumers. A static reachability check cannot prove that an external client no longer calls a supported endpoint.

When a post fails, start with sign-in callback errors, media link failures, and social network errors.
