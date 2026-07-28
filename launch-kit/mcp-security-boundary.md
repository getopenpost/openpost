# MCP Connection and Security Boundary

OpenPost keeps social-provider credentials inside the server while exposing authenticated publishing operations through MCP. That reduces credential exposure, but the OpenPost token still carries authority and must be scoped deliberately.

## Data flow

```text
MCP client
  -> OpenPost MCP token
  -> OpenPost authorization and workspace checks
  -> read-only query or approved mutation
  -> OpenPost validation, quota, and durable queue
  -> provider call made by OpenPost with its encrypted provider token
  -> provider result recorded in OpenPost
```

The MCP client does not need the X, Meta, LinkedIn, Bluesky, Mastodon, TikTok, or Google credential. OpenPost stores provider access and refresh tokens encrypted at rest and uses them internally when a provider call is required.

## Choose the token for the task

| Scope | Appropriate use | Server behavior |
| --- | --- | --- |
| `mcp:read` | Workspace, account, media, draft, schedule, readiness, status, and lifecycle inspection | Exposes only read-safe discovery/query paths and rejects every mutation |
| `mcp:full` | Create or update drafts and renditions, upload media, schedule, publish, cancel, reply, or moderate | Keeps read and mutation operations separated, but permits approved `execute_operation` calls |

Bind either token to one workspace unless the client genuinely needs more. Start a campaign rehearsal with `mcp:read`. Issue or approve `mcp:full` only for the preparation or execution step that requires it, then revoke it when the integration no longer needs access.

## Read and mutation separation

OpenPost advertises a compact MCP surface:

- `search_operations` discovers relevant operations and returns the required execution tool;
- `query_operation` runs guaranteed read-only operations and rejects mutations;
- `execute_operation` runs state-changing or external operations and rejects read-only calls;
- `render_scheduler_widget` renders a read-only scheduler summary in compatible clients.

With `mcp:read`, discovery omits mutation operations and the server rejects attempts to execute them. With `mcp:full`, the server still enforces the catalog classification, while the MCP client can place an approval prompt around `execute_operation`.

## What OpenPost enforces

- bearer-token authentication and MCP scope;
- optional single-workspace token boundaries;
- workspace membership, role, account ownership, and media ownership;
- operation input and output schemas;
- provider capability, media, quota, and readiness checks;
- separation of read-only and state-changing operation dispatch;
- server-side rejection of mutations for `mcp:read`;
- durable scheduling and lifecycle records;
- recent MCP activity with client attribution for dedicated tokens;
- token revocation from Settings;
- blocked private, loopback, link-local, and local destinations for media URL fetches.

## What still requires operator judgment

- `mcp:full` can execute publication operations when the client allows it. Provider-token secrecy is not the same as read-only access.
- Human review is not a mandatory server-side approval stage. It is a process enforced by token choice, client approval, and the person operating the campaign.
- Provider configuration or OAuth initiation does not prove that a specific format can publish.
- External provider approval, quotas, outages, and API changes remain outside OpenPost.
- Protect the OpenPost database, encryption key, application secrets, backups, logs, and host. Encryption at rest does not protect a fully compromised running server.

## Connection guidance

Use the remote endpoint:

```text
https://your-openpost-host.example/mcp
```

Or use the local proxy:

```sh
openpost --profile local auth login https://your-openpost-host.example
openpost-mcp --profile local
```

Prefer a workspace-scoped `mcp:read` token for audit and readiness work. Switch to `mcp:full` only when the agent must create or change OpenPost data. Never paste provider credentials, `OPENPOST_ENCRYPTION_KEY`, `OPENPOST_JWT_SECRET`, or server secrets into an agent prompt.

See the [MCP documentation](https://docs.openpost.social/mcp/) for current connection steps.
