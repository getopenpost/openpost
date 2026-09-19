# MCP And ChatGPT App

This page is for MCP implementation and protocol details. For setup-oriented user docs, see [AI assistants](https://docs.openpo.st/mcp).

OpenPost exposes an authenticated MCP foundation at:

```txt
POST /mcp       # full, directly advertised tool catalog (default)
POST /mcp/code  # compact search/query/execute catalog
```

The endpoint is JSON-RPC over HTTP and requires a bearer token:

```http
Authorization: Bearer <jwt-or-api-token>
```

OpenPost accepts MCP `ping` requests and Streamable HTTP JSON-RPC
notifications. Notification POSTs such as `notifications/initialized` return
HTTP `202 Accepted` with no response body.

ChatGPT Apps-compatible clients can also discover and load the scheduler and
local-upload widget resources:

```txt
resources/list
resources/read ui://widget/openpost-scheduler-v1.html
resources/read ui://widget/openpost-local-upload-v1.html
```

The widget is a self-contained `text/html;profile=mcp-app` resource. The
read-only `render_scheduler_widget` tool points at that resource through
`_meta.ui.resourceUri` and `_meta["openai/outputTemplate"]`, then passes
structured OpenPost data into the widget for rendering.

OpenPost emits the standard MCP Apps keys under `_meta.ui` and keeps legacy
ChatGPT aliases mirrored under `_meta["openai/..."]`. For example, widget CSP
uses camelCase `connectDomains` and `resourceDomains` under `_meta.ui.csp`,
while `_meta["openai/widgetCSP"]` keeps the snake_case alias expected by older
ChatGPT clients. The scheduler render tool is model-visible. The local-upload
widget calls an app-only ticket tool whose credential stays in result `_meta`
and is never placed in model-visible structured content.

For ChatGPT Apps and other OAuth-aware MCP clients, OpenPost also publishes
protected-resource and authorization-server metadata:

```txt
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
GET /.well-known/oauth-protected-resource/mcp/code
GET /.well-known/oauth-authorization-server
```

The `/mcp` protected-resource identifier deterministically maps to the metadata
path ending in `/mcp` under RFC 9728. The root protected-resource path remains
available because MCP authentication challenges name it explicitly. Both paths
describe the same `https://app.openpo.st/mcp` resource on Hosted. The compact
endpoint shares that OAuth resource and audience. Authorization-server metadata
advertises RFC 9207 issuer identification, and approval and denial redirects
include the exact discovery issuer as `iss`.

OpenPost also publishes its experimental MCP Server Card at
`/.well-known/mcp/server-card.json` and `/mcp/server-card`. The card describes
the real Streamable HTTP endpoint and supported protocol versions. OAuth details
remain in the RFC 9728 metadata instead of a card-specific auth object.

The default `/mcp` endpoint advertises every operation directly. `/mcp/code` is
the token-light surface: `mcp:full` clients receive `search_operations`,
`query_operation`, `execute_operation`, and the Apps widget renderers.
`mcp:read` clients receive the same compact surface without
`execute_operation`; search results and prompt discovery are filtered to
read-only operations. `search_operations` returns
the exact input/output schema, safety annotations, and required execution tool
for relevant OpenPost operations on demand. It returns no match for ambiguous
mutations or tasks outside OpenPost instead of guessing. `query_operation`
accepts only catalog operations guaranteed to be read-only;
`execute_operation` accepts only state-changing or external-action operations.
Both delegate through the existing authorization, workspace-scope, schema
validation, quota, and audit path.
Operation documentation omits repeated OAuth and Apps metadata because those
details already live on the four advertised descriptors.

The Apps widgets remain directly advertised because their OAuth metadata and
`_meta.ui.resourceUri` are needed by Apps-compatible clients to load the output
template. Previously advertised operation names remain callable for cached
clients. The old `search`, `query`, and `execute` aliases also remain callable
but are not advertised. Clients using `/mcp/code` should discover operations
with `search_operations` and invoke them through the returned `query_operation`
or `execute_operation` path. Cached direct descriptors keep their
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
JSON-RPC frames to the remote `/mcp` endpoint. Remote clients that prioritize a
small initial context can use `/mcp/code`. The proxy uses the MCP standard's
newline-delimited JSON framing on stdin/stdout, accepts legacy `Content-Length`
framing from older clients, advertises both Streamable HTTP response types, and
forwards the negotiated `MCP-Protocol-Version` on later requests.

Recent MCP tool calls are available under **Settings → Personal → Developer access**. The same data is exposed to authenticated API clients at:

```txt
GET /api/v1/mcp/activity?limit=20
GET /api/v1/mcp/activity?workspace_id=<workspace-id>
```

## Advertised tools

`/mcp` advertises the discoverable operations below with their exact schemas.
`/mcp/code` advertises this compact routing surface:

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
- `render_local_media_upload`: opens a local file picker for a selected
  workspace. Its app-only ticket tool is hidden from the model.

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
- `create_publication`: creates a format-first publication with renditions and destination-specific settings.
- `list_publications`: lists format-first publications for a workspace.
- `get_publication`: returns a publication with its destination renditions and delivery state.
- `update_publication`: updates editable source fields, schedule time, and an optional random-delay range while preserving omitted values.
- `set_publication_renditions`: replaces a publication's destination-specific outputs and media roles.
- `reply_to_rendition`: queues an explicit provider reply immediately or at a requested time.
- `validate_publication`: validates a publication before scheduling or publishing.
- `schedule_publication`: schedules an existing publication. The saved random-delay range is explicit or inherited from the Workspace, and the resulting Job time is authorized exactly.
- `cancel_publication`: cancels a scheduled publication and its pending delivery Job.
- `publish_publication_now`: queues an existing publication for immediate publishing.
- `list_publication_events`: returns lifecycle events for a publication.
- `list_rendition_comments`: lists comments for a published rendition.
- `reply_to_comment`: replies to an opaque comment ID returned by `list_rendition_comments`.
- `hide_comment`: hides a supported provider comment.
- `delete_comment`: permanently deletes a supported provider comment.
- `suggest_next_slot`: returns the next free configured posting slot for a workspace.
- `upload_media_from_url`: fetches a public HTTP(S) media URL and stores it in a workspace.
- `render_local_media_upload`: opens the MCP Apps local file picker. The widget
  receives a one-use, ten-minute ticket bound to the workspace and authenticated
  actor. OpenPost consumes the ticket before reading the body, sanitizes the
  filename, and streams the file through the normal validation, quota, storage,
  deduplication, analysis, and usage pipeline.

The directly advertised render tools are intentionally outside the delegated
operation catalog; clients call them only when they want their Apps UI.

## Registry listing version and compatibility

The `version` in the repository's `config/mcp/server.json` belongs to the immutable **Official MCP Registry listing**. It is not the OpenPost application version and it is not the date-based MCP protocol version negotiated during `initialize`. The application reports its release through `/api/v1/version`; each MCP session reports and validates its negotiated protocol version separately.

OpenPost changes the registry version only when it publishes a new registry entry for the Hosted service `https://app.openpo.st/mcp` endpoint. Registry versions use stable semantic versioning:

- Major: an intentionally incompatible transport, authentication, tool-name, required-input, or result-contract change.
- Minor: a backward-compatible tool, prompt, resource, optional input, or result addition.
- Patch: metadata, description, example, or other behavior-preserving correction.

Every published registry version is immutable. During a coordinated endpoint migration, `config/mcp/server.json` and `docs/launch-kit/listings.md` may identify the same prepared version before publication. The listing must state that it is prepared, name the publication blocker, and preserve the currently published version. After publication, replace that preparation note with the live registry evidence. The repository check rejects ranges, prereleases, a changed Hosted service endpoint, or unexplained version drift.

The Hosted MCP endpoint is `https://app.openpo.st/mcp`. Clients configured with another origin must reconnect so the OAuth issuer and resource audience match the canonical endpoint.

The registry identity remains `io.github.rodrgds/openpost` after the source repository moved to `getopenpost/openpost`. Registry names identify immutable published records; the `repository.url` field points clients to the current organization-owned source.

This policy follows the [Official MCP Registry versioning guidance](https://modelcontextprotocol.io/registry/versioning), reviewed 2026-08-09. Clients should use MCP capability negotiation—not registry SemVer alone—to decide whether a specific operation is available.

## Current prompts

- `plan_social_post`: guides an assistant from a rough idea to a workspace-aware Publication.
- `adapt_platform_renditions`: guides destination-specific copywriting for an existing Publication.
- `review_schedule`: guides queue inspection and next-action recommendations without mutating Publications.

## Current scope

- Uses the same Bearer authentication path as the CLI and API tokens.
- Dedicated `mcp:read` and `mcp:full` tokens can be created in Settings for ChatGPT, Claude, and other MCP clients. Existing `cli:full` tokens also remain accepted by `/mcp` so `openpost-mcp` profiles continue to work.
- Publishes MCP protected-resource metadata and returns `WWW-Authenticate` plus `_meta["mcp/www_authenticate"]` challenges for unauthenticated MCP requests.
- Rejects untrusted browser origins, non-JSON requests, oversized request bodies, unsupported post-initialization protocol versions, and authenticated tokens with insufficient scope.
- Supports MCP `ping` and accepts `notifications/*` messages with HTTP `202 Accepted`, which keeps standard initialization handshakes quiet.
- Publishes OAuth authorization-server metadata for public PKCE clients, including `S256`, `mcp:read`, `mcp:full`, client ID metadata document support, and RFC 9207 issuer identification.
- Provides a browser approval page at `/oauth/authorize` and a form-encoded `/oauth/token` code exchange that mints the requested `mcp:read` or `mcp:full` API token; omitted scope defaults to `mcp:full`.
- Validates client metadata redirect URIs for URL-based client IDs, accepts ChatGPT fallback redirects for predefined clients, and binds OAuth-issued MCP tokens to the `/mcp` resource audience.
- Advertises and enforces `mcp:read` and `mcp:full` OAuth scopes, with optional single-workspace session boundaries for API-token and OAuth-issued MCP clients. Read tokens never receive `execute_operation` and the server rejects cached or direct mutation calls.
- Advertises a guaranteed read-only `query_operation` boundary separately from mutation-capable `execute_operation`, and enforces the catalog classification server-side before operation dispatch.
- Documents every advertised and discoverable parameter with examples, uses enums for fixed values, declares required fields and unknown-field behavior explicitly, and validates both operation input and structured output against the advertised schemas.
- Adds Apps SDK-friendly `_meta["openai/toolInvocation/invoking"]`, `_meta["openai/toolInvocation/invoked"]`, and `outputSchema` metadata to every tool descriptor.
- Exposes ChatGPT Apps-compatible scheduler and local-upload widget resources.
- Keeps data tools reusable across MCP clients and attaches widget UI metadata only to the two render tools. The local ticket tool is app-only.
- Provides `openpost-mcp` for local stdio clients without duplicating server tool logic.
- Advertises MCP prompt templates for common agentic scheduling workflows: planning a post, adapting platform renditions, and reviewing the publishing queue.
- Validates workspace membership and account ownership before returning, creating, scheduling, canceling, or uploading data.
- Keeps draft iteration agent-friendly: assistants can create, list, update, validate, schedule, cancel, and publish Publications through the canonical Publication tools, set per-destination renditions through `set_publication_renditions`, and inspect lifecycle events.
- Validates rendition targets against the Publication destination list so assistants do not create outputs that would never publish.
- Rejects media URL fetches that resolve to private, loopback, link-local, multicast, or otherwise local addresses.
- Enforces the same scheduled-publication and media-upload entitlement and usage accounting as the web/API paths.
- Records MCP tool calls in `mcp_tool_calls` with user, workspace, tool name, success/error status, error message, duration, and timestamp, and exposes recent calls in settings.
- Records API-token client ID, name, scope, and token prefix for MCP tool calls when a request uses a dedicated CLI/MCP token, so Settings can attribute activity to ChatGPT, Claude, CI, or another configured client.
- Returns structured content so assistants can inspect workspace, account, publication, destination, media, and suggested slot IDs without parsing prose.
- Returns provider catalog structured content so assistants can avoid trying to connect or schedule to planned providers before adapters exist.
- Lets assistants attach workspace-owned source media to Publications through `media`, while preserving destination-specific media overrides through `set_publication_renditions`.
