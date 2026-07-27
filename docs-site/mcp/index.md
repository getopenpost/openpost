# Agent-Assisted Publishing With MCP

OpenPost's MCP support lets ChatGPT-style clients and local desktop assistants prepare and operate publishing work through the same authenticated OpenPost instance you use in the web app and CLI. The MCP client receives OpenPost data and operation results; it does not receive decrypted social-provider credentials.

::: warning Credentials and publishing authority are different
Use `mcp:read` when a client only needs to inspect OpenPost; the server hides mutation tools and rejects mutation attempts. An `mcp:full` token can run state-changing or external operations through `execute_operation` when the client allows them. Bind either token to one workspace when possible, review every destination, and require explicit approval before scheduling or publishing.
:::

Use it when you want an assistant to:

- inspect workspaces, connected accounts, media, drafts, providers, and scheduled posts
- turn a rough idea into a draft, then adapt that draft for each destination
- adapt copy for each destination before scheduling
- attach existing workspace media or upload media from a public URL
- suggest the next posting slot, schedule approved posts, or cancel queued posts

## Ways to connect

### ChatGPT-style clients

Use the remote MCP endpoint from your OpenPost instance:

```txt
https://your-openpost-host.example/mcp
```

OAuth-aware clients can use OpenPost's browser account-linking flow. Clients that need a manual token can create `mcp:read` or `mcp:full` access from **Settings -> Account -> CLI Devices & API Tokens**. OAuth requests default to `mcp:full` when they omit a scope, so choose `mcp:read` explicitly for inspection-only connections.

When approving OAuth or creating a manual token, prefer the current-workspace boundary unless the client truly needs every workspace you can access.

### Desktop MCP clients

Install and authenticate the OpenPost CLI with the MCP proxy, then run the local stdio proxy:

```sh
curl -fsSL https://raw.githubusercontent.com/rodrgds/openpost/main/scripts/install-cli.sh | sh -s -- --with-mcp
openpost --profile local auth login https://your-openpost-host.example
openpost-mcp --profile local
```

The proxy reads the selected CLI profile and forwards MCP frames to the remote `/mcp` endpoint. It does not open the database and does not need provider secrets on the client machine.

## Current assistant tools

OpenPost advertises a compact tool surface so connecting it does not load every scheduling schema into the assistant's context.

An `mcp:read` connection receives three tools:

- `search_operations`, limited to read-only operation results;
- `query_operation`, which runs guaranteed read-only operations;
- `render_scheduler_widget`, which displays a read-only scheduler summary in compatible clients.

An `mcp:full` connection also receives `execute_operation`. Across the full surface:

- `search_operations` finds relevant OpenPost operations and returns only the
  schemas needed for the current task, including whether each result must use
  `query_operation` or `execute_operation`. It returns no result instead of
  guessing when a request is ambiguous or outside OpenPost.
- `query_operation` runs only guaranteed read-only operations and rejects
  mutations.
- `execute_operation` runs only state-changing or external-action operations
  and rejects read-only work, giving clients a hard approval boundary.
- `render_scheduler_widget` displays a visual scheduler summary in clients that
  support MCP Apps resources.

The discoverable operations still cover workspaces, providers, accounts, media,
drafts, renditions, format-first publications, validation, scheduling,
publishing, status, cancellation, lifecycle events, comments, and slot
suggestions. You can usually ask for the outcome in plain language; the
assistant should use `search_operations` before `query_operation` or
`execute_operation` when it needs an operation schema.

## Safe workflow

1. Start with a workspace-scoped `mcp:read` token. Ask the assistant to inspect the current workspace, provider catalog, accounts, recent media, and provider readiness.
2. If the agent must create or change drafts and destination-specific renditions, switch to a workspace-scoped `mcp:full` token and approve only those exact mutations. Keep any unverified account or format out of the campaign until the exact path has passed a fresh live rehearsal.
3. Open the campaign in the web app. Review each account, rendition, media attachment, accessibility text, format, and schedule.
4. Approve `execute_operation` only after the final content and accounts are correct.
5. Inspect the queue and lifecycle events. Record published URLs or failures from OpenPost instead of treating a scheduled state as proof of publication.

MCP tools validate workspace membership, optional token workspace boundaries, and account ownership before reading or changing data. Scheduling and media uploads use the same quota and usage accounting as the web app and CLI.

For a worked brief, prompt, sample renditions, verification log, and review checklist, use the public [OpenPost Launch Kit](https://github.com/rodrgds/openpost/tree/main/launch-kit). The samples are illustrative and are not published campaign evidence.

## What the boundary does and does not protect

| Boundary | What OpenPost enforces | What the operator still decides |
| --- | --- | --- |
| Provider credentials | Provider access and refresh tokens remain encrypted in OpenPost and are not returned by MCP tools. | Protect the OpenPost encryption key, database, backups, and server access. |
| Workspace access | OAuth and manual MCP tokens can be limited to one workspace; tools validate membership and account ownership. | Choose the smallest useful workspace and revoke access when the task ends. |
| Read versus mutation | `mcp:read` exposes read-safe discovery/query tools and rejects every mutation. Under `mcp:full`, `query_operation` rejects mutations and `execute_operation` rejects read-only operations. | Start with `mcp:read`; require client approval for every `execute_operation` after granting `mcp:full`. |
| Provider validation | Scheduling uses current media, capability, quota, and account checks. | Rehearse the exact provider account and format; provider approval and API behavior remain external. |
| Human review | Drafts and renditions remain visible and editable in the web app. | Review is a workflow step, not an enforced approval gate. |

## Activity and revocation

Recent MCP tool calls appear in **Settings -> Account -> CLI Devices & API Tokens** with client attribution when the request used a dedicated MCP or CLI token. Revoke the token there to disconnect a client.

For protocol details, Apps SDK metadata, OAuth discovery, and implementation notes, see [MCP And ChatGPT App](/development/mcp) in the developer docs.
