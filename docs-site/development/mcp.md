# MCP And ChatGPT App

This page is for MCP implementation and protocol details. For setup-oriented user docs, see [Agent-Assisted Publishing With MCP](/mcp/).

OpenPost exposes an authenticated MCP foundation at:

```txt
POST /mcp
```

The endpoint is JSON-RPC over HTTP and requires a bearer token:

```http
Authorization: Bearer <jwt-or-api-token>
```

OpenPost accepts MCP `ping` requests and Streamable HTTP JSON-RPC
notifications. Notification POSTs such as `notifications/initialized` return
HTTP `202 Accepted` with no response body.

ChatGPT Apps-compatible clients can also discover and load the scheduler widget
resource:

```txt
resources/list
resources/read ui://widget/openpost-scheduler-v1.html
```

The widget is a self-contained `text/html;profile=mcp-app` resource. The
read-only `render_scheduler_widget` tool points at that resource through
`_meta.ui.resourceUri` and `_meta["openai/outputTemplate"]`, then passes
structured OpenPost data into the widget for rendering.

OpenPost emits the standard MCP Apps keys under `_meta.ui` and keeps legacy
ChatGPT aliases mirrored under `_meta["openai/..."]`. For example, widget CSP
uses camelCase `connectDomains` and `resourceDomains` under `_meta.ui.csp`,
while `_meta["openai/widgetCSP"]` keeps the snake_case alias expected by older
ChatGPT clients. The render tool is model-visible only; the current widget does
not call tools directly.

For ChatGPT Apps and other OAuth-aware MCP clients, OpenPost also publishes
protected-resource and authorization-server metadata:

```txt
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-authorization-server
```

The advertised tool surface uses progressive discovery to keep model context small. `mcp:full` clients receive `search_operations`, `query_operation`, `execute_operation`, and the Apps widget renderer. `mcp:read` clients receive the same surface without `execute_operation`; search results and prompt discovery are filtered to read-only operations. `search_operations` returns
the exact input/output schema, safety annotations, and required execution tool
for relevant OpenPost operations on demand. It returns no match for ambiguous
mutations or tasks outside OpenPost instead of guessing. `query_operation`
accepts only catalog operations guaranteed to be read-only;
`execute_operation` accepts only state-changing or external-action operations.
Both delegate through the existing authorization, workspace-scope, schema
validation, quota, and audit path.
Operation documentation omits repeated OAuth and Apps metadata because those
details already live on the four advertised descriptors.

The scheduler widget remains directly advertised because its OAuth metadata and
`_meta.ui.resourceUri` are needed by Apps-compatible clients to load the output
template. Previously advertised operation names remain callable for cached
clients. The old `search`, `query`, and `execute` aliases also remain callable
but are not advertised. New clients should discover operations with
`search_operations` and invoke them through the returned `query_operation` or
`execute_operation` path. Cached direct descriptors keep their
operation-specific safety annotations and do not weaken the generic tool
boundary.

OAuth-aware clients can start account linking at the browser authorization page,
then exchange the returned code for an MCP-scoped bearer token:

```txt
GET /oauth/authorize
POST /oauth/token
```

The authorization request can ask for `mcp:read` or `mcp:full`; omitted scope defaults to `mcp:full`. The approval page can bind the resulting token to the current workspace. A
workspace-scoped token can only list that workspace and MCP tools reject any
request whose `workspace_id` targets another workspace. Manual tokens created in
Settings support the same optional workspace boundary.

Desktop MCP clients can use the local stdio proxy from the CLI module:

```sh
openpost --profile local auth login https://your-openpost-host.example
openpost-mcp --profile local
```

The proxy loads the same OpenPost CLI profile and token, then forwards MCP
JSON-RPC frames to the remote `/mcp` endpoint. It uses the MCP standard's
newline-delimited JSON framing on stdin/stdout, accepts legacy `Content-Length`
framing from older clients, advertises both Streamable HTTP response types, and
forwards the negotiated `MCP-Protocol-Version` on later requests.

Recent MCP tool calls are available in Settings under **CLI Devices & API
Tokens**. The same data is exposed to authenticated API clients at:

```txt
GET /api/v1/mcp/activity?limit=20
GET /api/v1/mcp/activity?workspace_id=<workspace-id>
```

## Advertised tools

- `search_operations`: accepts a plain-language capability query and returns up
  to ten matching operation definitions with their exact input/output schemas,
  safety annotations, and an `executionTool` routing field.
- `query_operation`: accepts a read-only `operation` returned by
  `search_operations` plus its `arguments`. The server rejects every mutation
  before dispatch.
- `execute_operation`: accepts a state-changing or external-action `operation`
  returned by `search_operations` plus its `arguments`. The server rejects every
  read-only operation before dispatch so clients can require approval for this
  tool as a whole.
- `render_scheduler_widget`: renders structured OpenPost scheduler data in the
  ChatGPT Apps widget and stays directly visible for UI resource discovery.

For `mcp:read`, `tools/list` omits `execute_operation`, `search_operations` omits mutation results, and direct or cached mutation calls are rejected before dispatch. Read-only connections receive only the `review_schedule` prompt; prompts that create or adapt work require `mcp:full`.

Example discovery and execution calls:

```json
{
  "name": "search_operations",
  "arguments": { "query": "list connected accounts" }
}
```

```json
{
  "name": "query_operation",
  "arguments": {
    "operation": "list_accounts",
    "arguments": { "workspace_id": "workspace-id" }
  }
}
```

Mutation discovery uses the same shape with `"name": "execute_operation"`;
clients should use the `executionTool` returned by `search_operations` rather
than infer safety from an operation name.

### Why the delegated tools do not evaluate JavaScript

Cloudflare's full [Code Mode pattern](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)
runs model-written JavaScript in an isolated Worker, blocks direct outbound
network access, and exposes only a host-controlled request function. OpenPost's
portable Go binary does not currently include an equivalent sandbox or
pause/approval runtime. Evaluating model-written code in the application process
would create an avoidable security and resource-exhaustion boundary.

The current `search_operations`/`query_operation`/`execute_operation` design
takes the part that produces the immediate context saving—progressive schema
discovery—while delegating each operation to the existing typed handler. A
future sandboxed or declarative batch executor can add loops, filtering, and
multi-operation composition without collapsing the hard read/mutation safety
boundary.

## Discoverable operations

- `list_workspaces`: returns the workspaces available to the authenticated user.
- `list_provider_catalog`: returns provider launch status so assistants know which platforms are available, need server configuration, or are still planned.
- `list_accounts`: returns active social accounts for a workspace.
- `list_media`: returns recent workspace media attachments so assistants can reuse existing assets.
- `get_provider_readiness`: returns provider configuration, account, app-review, and public-media readiness checks.
- `create_draft`: creates a draft post in a workspace and assigns destination accounts and media attachments.
- `list_drafts`: returns editable draft posts for a workspace so an assistant can inspect existing work before creating more drafts.
- `update_draft`: updates a draft's source content and optionally replaces destination accounts or source media.
- `set_post_renditions`: creates or updates destination-specific copy for draft and scheduled posts. Renditions can only target accounts already attached as post destinations.
- `schedule_post`: creates a scheduled post with destination accounts and optional media, then queues the `publish_post` job.
- `schedule_draft`: schedules an existing draft and queues the `publish_post` job without duplicating the post. It can optionally replace source media before scheduling.
- `get_post_status`: returns the post status, scheduled run time, source media, and per-destination status.
- `list_scheduled_posts`: returns upcoming scheduled posts for queue inspection.
- `cancel_post`: cancels a queued scheduled post and returns it to drafts.
- `suggest_next_slot`: returns the next free configured posting slot for a workspace.
- `upload_media_from_url`: fetches a public HTTP(S) media URL and stores it in a workspace.
- `create_publication`: creates a format-first publication with renditions and destination-specific settings.
- `list_publications`: lists format-first publications for a workspace.
- `get_publication`: returns a publication with its destination renditions and delivery state.
- `update_publication`: updates editable source fields and schedule time while preserving omitted values.
- `set_publication_renditions`: replaces a publication's destination-specific outputs and media roles.
- `reply_to_rendition`: queues an explicit provider reply immediately or at a requested time.
- `validate_publication`: validates a publication before scheduling or publishing.
- `schedule_publication`: schedules an existing publication.
- `publish_publication_now`: queues an existing publication for immediate publishing.
- `list_publication_events`: returns lifecycle events for a publication.
- `list_rendition_comments`: lists comments for a published rendition.
- `reply_to_comment`: replies to an opaque comment ID returned by `list_rendition_comments`.
- `hide_comment`: hides a supported provider comment.
- `delete_comment`: permanently deletes a supported provider comment.

The directly advertised `render_scheduler_widget` is intentionally outside the
delegated operation catalog; clients call it only when they want the Apps UI.

## Registry listing version and compatibility

The `version` in the repository's `server.json` belongs to the immutable **Official MCP Registry listing**. It is not the OpenPost application version and it is not the date-based MCP protocol version negotiated during `initialize`. The application reports its release through `/api/v1/version`; each MCP session reports and validates its negotiated protocol version separately.

OpenPost changes the registry version only when it publishes a new registry entry for the Hosted service `https://app.openpost.social/mcp` endpoint. Registry versions use stable semantic versioning:

- Major: an intentionally incompatible transport, authentication, tool-name, required-input, or result-contract change.
- Minor: a backward-compatible tool, prompt, resource, optional input, or result addition.
- Patch: metadata, description, example, or other behavior-preserving correction.

Every published registry version is immutable. `server.json` and the live-publication record in `launch-kit/listings.md` must therefore keep the same exact version, and the repository check rejects ranges, prereleases, a changed Hosted service endpoint, or unexplained version drift. Application releases that do not publish a new MCP Registry entry leave this number unchanged.

The registry identity remains `io.github.rodrgds/openpost` after the source repository moved to `getopenpost/openpost`. Registry names identify immutable published records; the `repository.url` field points clients to the current organization-owned source.

This policy follows the [Official MCP Registry versioning guidance](https://modelcontextprotocol.io/registry/versioning), reviewed 2026-08-09. Clients should use MCP capability negotiation—not registry SemVer alone—to decide whether a specific operation is available.

## Current prompts

- `plan_social_post`: guides an assistant from a rough idea to a workspace-aware draft.
- `adapt_platform_renditions`: guides destination-specific copywriting for an existing draft or scheduled post.
- `review_schedule`: guides queue inspection and next-action recommendations without mutating posts.

## Current scope

- Uses the same Bearer authentication path as the CLI and API tokens.
- Dedicated `mcp:read` and `mcp:full` tokens can be created in Settings for ChatGPT, Claude, and other MCP clients. Existing `cli:full` tokens also remain accepted by `/mcp` so `openpost-mcp` profiles continue to work.
- Publishes MCP protected-resource metadata and returns `WWW-Authenticate` plus `_meta["mcp/www_authenticate"]` challenges for unauthenticated MCP requests.
- Rejects untrusted browser origins, non-JSON requests, oversized request bodies, unsupported post-initialization protocol versions, and authenticated tokens with insufficient scope.
- Supports MCP `ping` and accepts `notifications/*` messages with HTTP `202 Accepted`, which keeps standard initialization handshakes quiet.
- Publishes OAuth authorization-server metadata for public PKCE clients, including `S256`, `mcp:read`, `mcp:full`, and client ID metadata document support.
- Provides a browser approval page at `/oauth/authorize` and a form-encoded `/oauth/token` code exchange that mints the requested `mcp:read` or `mcp:full` API token; omitted scope defaults to `mcp:full`.
- Validates client metadata redirect URIs for URL-based client IDs, accepts ChatGPT fallback redirects for predefined clients, and binds OAuth-issued MCP tokens to the `/mcp` resource audience.
- Advertises and enforces `mcp:read` and `mcp:full` OAuth scopes, with optional single-workspace session boundaries for API-token and OAuth-issued MCP clients. Read tokens never receive `execute_operation` and the server rejects cached or direct mutation calls.
- Advertises a guaranteed read-only `query_operation` boundary separately from mutation-capable `execute_operation`, and enforces the catalog classification server-side before operation dispatch.
- Documents every advertised and discoverable parameter with examples, uses enums for fixed values, declares required fields and unknown-field behavior explicitly, and validates both operation input and structured output against the advertised schemas.
- Adds Apps SDK-friendly `_meta["openai/toolInvocation/invoking"]`, `_meta["openai/toolInvocation/invoked"]`, and `outputSchema` metadata to every tool descriptor.
- Exposes a ChatGPT Apps-compatible scheduler widget resource at `ui://widget/openpost-scheduler-v1.html`.
- Keeps data tools reusable across MCP clients and attaches widget UI metadata only to `render_scheduler_widget`.
- Provides `openpost-mcp` for local stdio clients without duplicating server tool logic.
- Advertises MCP prompt templates for common agentic scheduling workflows: planning a post, adapting platform renditions, and reviewing the publishing queue.
- Validates workspace membership and account ownership before returning, creating, scheduling, canceling, or uploading data.
- Keeps draft iteration agent-friendly: assistants can list drafts, update draft copy/destinations, set per-destination renditions, and schedule the same draft when it is ready.
- Validates rendition targets against the post destination list so assistants do not create variants that would never publish.
- Rejects media URL fetches that resolve to private, loopback, link-local, multicast, or otherwise local addresses.
- Enforces the same scheduled-post and media-upload entitlement and usage accounting as the web/API paths.
- Records MCP tool calls in `mcp_tool_calls` with user, workspace, tool name, success/error status, error message, duration, and timestamp, and exposes recent calls in settings.
- Records API-token client ID, name, scope, and token prefix for MCP tool calls when a request uses a dedicated CLI/MCP token, so Settings can attribute activity to ChatGPT, Claude, CI, or another configured client.
- Returns structured content so assistants can inspect workspace, account, post, destination, media, and suggested slot IDs without parsing prose.
- Returns provider catalog structured content so assistants can avoid trying to connect or schedule to planned providers before adapters exist.
- Lets assistants attach workspace-owned source media to drafts and scheduled posts through `media_ids`, while preserving destination-specific media overrides through `set_post_renditions`.
