# MCP And ChatGPT App

This page is for MCP implementation and protocol details. For setup-oriented user docs, see [AI assistants](https://openpo.st/docs/mcp).

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
notifications. Successful tool calls retain their human summary and append the
serialized `structuredContent` as a JSON text block for text-only clients, as
recommended by the [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content).
Private `_meta` values, including upload credentials, never enter that text.

Notification POSTs such as `notifications/initialized` return
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

### Connected editor tools

The Image and Video Editors register a short-lived session while an editable
project is open in a signed-in browser. Codex CLI, Claude Code, and other MCP
clients can connect to the existing `/mcp` endpoint with OAuth or a workspace
scoped `mcp:full` token. No OpenPost desktop runtime is required. Start with
`editor_sessions` and `editor_reference`, then read `editor_context` and the
relevant `timeline_inspect` or `image_inspect` output. The stable project, item,
page, layer, and session IDs in those results are the targets for edits.

`media_library` lists all Video Project sources, even those not on the timeline.
`media_inspect` reads source metadata and available transcript words;
`media_analyze` starts the editor's local source transcription and
`media_analysis_status` reports its progress or result. Use
`media_analysis_cancel` to stop a running transcription.
`media_frame` decodes a source frame; `media_storyboard` samples 2 to 9
source-video frames into a contact sheet with exact timestamps and coverage.
Neither proves what happens between samples. `preview_render` returns an actual
composited Video Editor frame or rendered Image Editor page as bounded JPEG
image content. The preview requires the current revision and does not move the
user's view. `editor_reveal` explicitly selects an item or layer or moves the
playhead when the user wants to follow the agent's work.
For audio-capable MCP clients, `preview_audio` renders up to four seconds of
the actual Video Editor timeline mix as WAV content at the current revision.
The Hosted assistant does not receive that audio because its configured model
input path currently supports images, not audio.

`scene_analysis_status` checks cached visual analysis. `scene_analyze` starts
the editor's cancellable local scene detection and captioning for a named
source; `scene_analysis_cancel` stops it. `scene_inspect` returns bounded source
ranges and descriptions. `scene_search` ranks available captions by keyword
and fuzzy text, and reports sources without analysis or captions. Long shots
can change between detected cuts, so use `media_storyboard` or `media_frame`
inside a candidate range before making a precise claim.

`video_edit` and `image_edit` require `project_id`, `expected_revision`, a
stable `request_id`, and typed actions. Retry an identical request with the
same key after a lost reply. A changed request with that key is rejected.
Each short batch commits as one undoable change. Edits run in the open browser
and appear in its existing timeline or canvas.
`export_start` renders the active Video Editor sequence as MP4 or WebM into
the Video Project's export storage, or one Image Editor page as PNG, JPEG, or
WebP into Workspace Media. Pass the exact current authored revision and a
stable request key. It returns an export ID immediately. Poll `export_status`
for progress and the saved file path or Media ID, and use `export_cancel` to
abort a running job. The result records the revision rendered, even if the
user continues editing. These interactive jobs require the browser to remain
open; their progress records are held in that browser session.
The browser owns original local files. Source frames, rendered previews, and
short audio previews can cross the relay as bounded media results; transcript words and scene captions
can cross as bounded text results. The paid Hosted assistant may send these
results to its configured model provider. The relay does not store original
project files. Source transcript search reports missing
analysis coverage, so an empty match list is not proof that speech is absent.
`editor_work_status` and `editor_work_cancel` distinguish pending work from a
committed edit.
`editor_history_inspect`, `editor_history_undo`, and `editor_history_redo`
operate only on the latest agent change when its revision still matches.

When the browser closes or stops polling, the session expires. Queued requests
fail with `editor_disconnected`; a leased request becomes `indeterminate`
because its edit may have committed before the reply was lost. Inspect the
project and receipt before submitting a new request key. Open the project
again and start from the new session and revision. A connected-browser
operation is interactive; future Workflow editing nodes need a durable
headless executor and must not depend on these sessions. See
[the editing contract](../specs/editor-agent-mcp.md).

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
- `list_provider_catalog`: returns provider launch status so assistants know which platforms are available, need server configuration, or are still planned. Then call `list_accounts` for workspace destinations and `get_provider_readiness` for account-scoped checks.
- `list_accounts`: returns active social accounts for a workspace. Pair with `list_provider_catalog` for platform availability and `get_provider_readiness` before scheduling.
- `list_media`: returns workspace media attachments in newest-first order with an opaque `cursor` input and `has_more`, `next_cursor`, and `total_count` outputs. Defaults to 20 items per response, up to 100.
- `get_provider_readiness`: returns provider configuration, account, app-review, and public-media readiness checks. Start from `list_provider_catalog` for platform availability, then `list_accounts` for the destinations these checks evaluate.
- `create_post`: creates a format-first post with variants and destination-specific settings.
- `list_posts`: lists format-first posts for a workspace. Results are newest-first, default 20 per response up to 100, with an opaque `cursor` input and `has_more`, `next_cursor`, and `total_count` outputs for stable paging. Prefer narrow calendar windows and follow `next_cursor` instead of widening the window. Each item includes a safe failure summary (`failed_variant_count` plus the curated `error_kind`, `error_action`, and `error_message` of the first failed destination); raw provider response bodies are never exposed. `status` and `content_profile` accept only their documented enum values so typos fail with `-32602`. Failed destinations name `get_post` for delivery detail and `retry_failed_variants` for safe retries.
- `get_post`: returns a post with its destination variants and delivery state.
- `update_post`: updates editable source fields, schedule time, and an optional random-delay range while preserving omitted values.
- `set_post_variants`: replaces a post's destination-specific outputs and media roles.
- `reply_to_variant`: queues an explicit provider reply immediately or at a requested time.
- `validate_post`: validates a post before scheduling or publishing. When `valid` is false, the result names `get_post` for delivery detail and `retry_failed_variants` for safe retries after the issues are fixed.
- `schedule_post`: schedules an existing post. The saved random-delay range is explicit or inherited from the Workspace, and the resulting Job time is authorized exactly. Accepts `idempotency_key` for safe retries and `dry_run` to validate without enqueueing.
- `cancel_post`: cancels a scheduled post and its pending delivery Job.
- `publish_post_now`: queues an existing post for immediate publishing. Accepts `dry_run` to validate without queueing. This action is irreversible once a worker picks it up: repeat the call with `confirm=true` to proceed.
- `delete_post`: permanently deletes an editable post, its destination variants, and any linked draft. Repeat the call with `confirm=true` to proceed; a repeated call with the same `idempotency_key` replays the stored deletion.
- `retry_failed_variants`: queues one retry batch for the remaining safely retryable failed destination variants.
- `retry_variant`: queues a retry for one failed destination variant with a confirmed safe delivery outcome. Both retry operations use the post-action shape (`post_id` plus `expected_revision`) and return the post state with the durable retry Job ID.
- `get_media`: returns one workspace media asset with its usage and deletion eligibility.
- `update_media`: updates a workspace media asset's favorite flag or alt text.
- `delete_media`: moves a workspace media asset to Trash when `list_media` reports `can_delete`. Repeat the call with `confirm=true` to proceed.
- `list_post_events`: returns lifecycle events for a post with an opaque `cursor` input and `has_more`, `next_cursor`, and `total_count` outputs. Defaults to 100 events per response, up to 200.
- `list_variant_comments`: lists comments for a published variant with a `limit` input (1-100, default 50). Results beyond the limit are truncated in provider order and the response text notes the truncation.
- `get_post_metrics`: returns stored analytics per variant (normalized `views`, `reactions`, `engagements`, `impressions`, and `reach`) plus post totals. Read-only against stored snapshots; it triggers no provider calls.
- `get_dashboard_link`: builds an app-origin dashboard URL for a `post`, `media`, `account`, or `calendar` view so agents can hand users a link to the visualization. Pure URL builder besides the workspace access check.
- `search_docs`: searches the curated offline registry of documentation and assistant skill pages, returning titles, `/docs` paths, and snippets.
- `reply_to_comment`: replies to an opaque comment ID returned by `list_variant_comments`.
- `hide_comment`: hides a supported provider comment.
- `delete_comment`: permanently deletes a supported provider comment. Repeat the call with `confirm=true` to proceed.
- `suggest_next_slot`: returns the next free configured posting slot for a workspace.
- `upload_media_from_url`: fetches a public HTTP(S) media URL and stores it through the configured media pipeline.
- `upload_media_base64`: uploads local file bytes for clients without a file picker. Requires workspace editor access and `mcp:full`. Pass `workspace_id`, `filename`, and `content_base64`; optional fields are `mime_type` and `alt_text`. Standard base64 and `data:<mime-type>;base64,` URLs are accepted. Files are limited to 8 MiB decoded; the MCP JSON request limit is 12 MiB. Larger files use the local file picker or `upload_media_from_url`. Repeated bytes deduplicate within the workspace; this operation does not accept an idempotency key. Validation, quota, deduplication, processing, and usage accounting belong to the shared MediaHandler.

  Public URL verification runs during upload and explicit validation. Failed checks expire after one minute. `list_media` returns stored state without network checks, and failures retain their HTTP status and error until a new check replaces them.

- `render_local_media_upload`: opens the MCP Apps local file picker. The widget
  receives a one-use, ten-minute ticket bound to the workspace and authenticated
  actor. OpenPost consumes the ticket before reading the body, sanitizes the
  filename, and streams the file through the normal validation, quota, storage,
  deduplication, analysis, and usage pipeline.

Operations whose schemas include `idempotency_key` route it into
the existing REST idempotency path (`mutationIdempotencyRequest` plus
`idempotency.Execute` and the idempotent application methods), so a retried
call replays the stored result instead of running the mutation again.
Irreversible tools (`delete_post`, `publish_post_now`, `delete_media`,
`delete_comment`) additionally require a machine-enforceable `confirm=true`
second call: the first call describes the irreversible effect and is rejected,
and only the confirmed repeat runs. Post mutations return a unified shape, a
summary status plus `job_id` (empty when no durable work is enqueued), with an
optional `detail: summary|full` input selecting the complete post instead.
Comment mutations report `job_id`.

The directly advertised render tools are intentionally outside the delegated
operation catalog; clients call them only when they want their Apps UI.
Both render tools are read-only and stay visible to `mcp:read` connections:
`render_scheduler_widget` renders model-visible structured data, while
`render_local_media_upload` opens the picker and its one-use upload ticket
tool (`create_local_media_upload_ticket`) is app-only and requires `mcp:full`.

Read operations share paging conventions: `list_posts` and `list_media`
default to 20 items per response capped at 100, `list_post_events`
defaults to 100 capped at 200, and `list_variant_comments` defaults to 50
capped at 100 with provider-order truncation. Cursor pages return
`has_more`, `next_cursor`, and `total_count` with the same opaque
timestamp-plus-ID pattern everywhere.

## Retired operation names and sunset policy

The post/variant names above replaced the original publication/rendition
names. `tools/list`, `search_operations`, and `prompts/list` advertise the new
names only. The retired names below remain callable through `tools/call`,
`query_operation`, and `execute_operation`, and retired argument keys
(`publication_id`, `rendition_id`, `renditions`, `failed_rendition_count`) are
accepted wherever their replacements (`post_id`, `variant_id`, `variants`,
`failed_variant_count`) are documented; when a call sends both forms, the new
key wins. Audit rows record the canonical name. Structured output uses the new
names, except the top-level `publication` and `publications` keys, which are
unchanged:

| Retired                            | Canonical                    |
| ---------------------------------- | ---------------------------- |
| `create_publication`               | `create_post`                |
| `list_publications`                | `list_posts`                 |
| `get_publication`                  | `get_post`                   |
| `update_publication`               | `update_post`                |
| `set_publication_renditions`       | `set_post_variants`          |
| `reply_to_rendition`               | `reply_to_variant`           |
| `validate_publication`             | `validate_post`              |
| `schedule_publication`             | `schedule_post`              |
| `cancel_publication`               | `cancel_post`                |
| `publish_publication_now`          | `publish_post_now`           |
| `list_publication_events`          | `list_post_events`           |
| `list_rendition_comments`          | `list_variant_comments`      |
| prompt `adapt_platform_renditions` | prompt `adapt_post_variants` |

The scheduler widget accepts both `renditions` and `variants` views. Retired
names follow the same precedent as the legacy `search`/`query`/`execute`
aliases: they stay callable indefinitely for cached clients, are never
advertised, and are removed only by an explicitly announced breaking change
that names the removal version, the migration window, and the replacement
names. REST paths and bodies, OpenAPI, CLI nouns, database columns, and
internal identifiers keep the publication/rendition terms; only the MCP
assistant-facing surface uses post/variant names.

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

- `plan_social_post`: guides an assistant from a rough idea to a workspace-aware Post.
- `adapt_post_variants`: guides destination-specific copywriting for an existing Post.
- `review_schedule`: guides queue inspection and next-action recommendations without mutating Posts.

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
- Keeps draft iteration agent-friendly: assistants can create, list, update, validate, schedule, cancel, and publish Posts through the canonical Post tools, set per-destination variants through `set_post_variants`, and inspect lifecycle events.
- Validates rendition targets against the Publication destination list so assistants do not create outputs that would never publish.
- Rejects media URL fetches that resolve to private, loopback, link-local, multicast, or otherwise local addresses.
- Enforces the same scheduled-publication and media-upload entitlement and usage accounting as the web/API paths.
- Records MCP tool calls in `mcp_tool_calls` with user, workspace, tool name, success/error status, error message, duration, and timestamp, and exposes recent calls in settings.
- Records API-token client ID, name, scope, and token prefix for MCP tool calls when a request uses a dedicated CLI/MCP token, so Settings can attribute activity to ChatGPT, Claude, CI, or another configured client.
- Returns structured content so assistants can inspect workspace, account, publication, destination, media, and suggested slot IDs without parsing prose.
- Returns provider catalog structured content so assistants can avoid trying to connect or schedule to planned providers before adapters exist.
- Lets assistants attach workspace-owned source media to Posts through `media`, while preserving destination-specific media overrides through `set_post_variants`.
- Accepted gaps (kept out deliberately; specced follow-ups, not oversights): no account connect/disconnect tools, no bulk operations, and no webhook management tools. Assistants connect accounts through the web settings flow and link users there with `get_dashboard_link` (`account` kind).
- OAuth has no per-client allow-listing: any standards-compliant OAuth client can start the flow with a valid client-metadata URL (matching redirect, `none` auth, code flow), and non-URL client IDs additionally work through the ChatGPT connector and loopback redirect fallbacks. The recorded client name is attribution for Settings activity only, never an access gate.

## Recommended toolsets per client

- Full-catalog clients (ChatGPT, Claude Desktop, IDE assistants that handle dozens of tools): use the default `/mcp` endpoint. Every operation is directly advertised with its own schema, and the Apps widgets load through the render tools.
- Token-constrained or search-first clients (coding agents, CLI-driven flows): use `/mcp/code`. Start each task with `search_operations`, run reads through `query_operation`, mutations through `execute_operation`, and render through `render_scheduler_widget` only when a visual summary helps.
- Self-hosted operators choose with `OPENPOST_MCP_MODE`: `direct` (default) for full-catalog clients, `search` for constrained ones, `both` while migrating. Changing the list never changes permissions; `mcp:read` connections always lose `execute_operation` and the ticket tool regardless of mode.
