# Agentic Image and Video Editing

Status: implementation contract. This document records the agreed product behavior and the work required to deliver it. It does not assert that a tool exists until the shared operation catalog advertises it.

## Outcome

A user can ask Codex CLI, Claude Code, or the paid Hosted assistant to edit an OpenPost Video or Image project. They can watch completed edits appear in the open browser editor, inspect the result, stop the run, and undo the assistant's work. The same authored-editing operations serve manual UI, MCP, and the Hosted assistant. No OpenPost desktop installation is required for the initial connected-browser path. The browser remains the editing and rendering executor for local projects and locally available assets. When it disconnects, pending execution stops and the client receives a recoverable disconnected state.

The Hosted assistant replaces the existing Video Editor assistant for paid Hosted users. Its model runs through the maintained OpenRouter adapter and uses the same operation catalog as external MCP clients. Model selection is configurable and must be evaluated with real editing tasks; no model name is hard-coded into the editing domain. Image and Video Editor share session, evidence, revision, job, and history contracts, but keep separate document and operation schemas.

Local-first describes where original project files and media processing live. An external assistant connected to Hosted is a separate transport choice. Source frames, rendered previews, transcript text, and bounded results may cross the relay to that assistant. The paid Hosted assistant may send those results to its configured model provider. The original project need not be uploaded merely because a remote MCP client invokes an operation.

## Domain contract

- A Project Asset is a source file. A clip occurrence is one use of an asset within a particular sequence or nested composition path. Source range and sequence range are distinct. Image pages and layers are separate authored entities.
- Authored video ranges use half-open integer frame intervals with a sequence ID and explicit frame rate. Source ranges use presentation timestamps and their timebase. Source words and scenes are qualified by media identity and an immutable analysis version. Image coordinates state whether they are page, layer, or source-image pixels.
- Existing `c1`-style, order-derived clip aliases can appear as display labels only. Operations require stable entity IDs or revision-bound evidence handles. A repeated source passage yields one handle per occurrence.
- Inspection never changes authored state or the user's playhead, selection, panels, or viewport. `editor_reveal` changes view state explicitly. View state remains device-local.
- A missing or ambiguous target, stale revision or analysis, locked object, unsupported capability, or unavailable source is a typed failure. Nothing falls back to the current selection or all media. A verified already-satisfied operation returns `no_change` with no history entry.
- Retryable mutations use an idempotency key and expected authored revision. Repeating a key with identical arguments returns the original receipt; reusing it with different arguments fails.
- All editing mutations run through the same owner as manual UI actions, including lock checks, linked media, ripple effects, transition repair, caption reconciliation, asset import, and save feedback. No raw document patches or arbitrary script execution are exposed to an editing model.
- A short coherent batch is atomic and yields one history change. A creative run comprises multiple visible batches. The run, pass, and change have separate IDs. Export, analysis, and preparation are jobs pinned to a source or project revision. Their late results cannot author into a stopped run or another project.
- A committed change immediately updates the open editor's authored state. A receipt distinguishes document commit, preview rendered at that revision, local persistence, and Cloud persistence. The UI identifies the current action, shows changed objects, and provides optional Follow assistant behavior.
- Stop cancels uncommitted work and leaves already committed edits intact. Head undo reverses the current history entry. Selective revert creates a new change and succeeds only when later work, including human edits, can be preserved. Otherwise it reports the affected dependency conflict. Whole snapshots are not selective revert.
- Every evidence result states its source/composition identity, revision or analysis version, examined ranges and samples, provenance, omissions, and unavailable dependencies. Search returns candidates and coverage, not certainty. Source thumbnails cannot verify final composited pixels or audio.
- An operation receipt reports actual frames, created/changed/removed IDs, linked and ripple consequences, affected ranges/pages, warnings, save state, preview state, and an undo reference. A successful operation alone does not establish visual quality.

## Tool surface

The initial MCP surface groups exact domain operations behind typed edit tools. The catalog owns schemas, support checks, documentation, and result types; adapters may present relevant operations directly to models without changing semantics.

| Tool                                                   | Required result or effect                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `editor_sessions`                                      | Connected editor sessions, project identity, permission scope, and capabilities.                                                      |
| `editor_context`                                       | Current project, authored revision, active sequence/page, selection, playhead, save state, missing assets, and work.                  |
| `editor_reference`                                     | Filtered operation schemas, units, prerequisites, consequences, errors, examples, and common-task recipes.                            |
| `project_create`, `project_open`, `project_inspect`    | Explicit project lifecycle and paginated inventory. Opening respects active work.                                                     |
| `timeline_inspect`, `image_inspect`                    | Bounded authored structure with stable IDs, effective locks, dependencies, and timing/layout.                                         |
| `media_import`                                         | Authorized source import, asset identity, and readiness.                                                                              |
| `media_analyze`                                        | Requested and available source transcription, scene, visual, screen-text, or audio analysis; cached result or cancellable job.        |
| `media_search`                                         | Ranked candidate ranges with evidence references and full coverage or gap reporting.                                                  |
| `media_inspect`                                        | Bounded source frames, transcript, audio, metadata, and analysis provenance.                                                          |
| `timeline_resolve`                                     | Source/evidence references mapped to exact occurrences and authored frame ranges at a revision.                                       |
| `edit_preview`                                         | A validated, revision-bound change plan with all affected entities, actual timing, conflicts, and consequences. No authored mutation. |
| `video_edit`, `image_edit`                             | A typed, short atomic operation batch or still-valid plan; change receipt and immediate live document update.                         |
| `preview_render`                                       | Actual composed video frames/short AV preview or rendered image page, with revision and fidelity limits.                              |
| `output_check`                                         | Deterministic requirement checks with explicit coverage and unsupported checks.                                                       |
| `history_inspect`, `history_revert`, `history_reapply` | Actor-aware receipts and dependency-checked reversal.                                                                                 |
| `work_status`, `work_cancel`                           | Job and run lifecycle with completed versus pending edits distinguished.                                                              |
| `editor_reveal`                                        | Explicit, device-local seek, selection, or reveal.                                                                                    |
| `library_search`, `library_inspect`, `library_save`    | Favorites, recipes, dependencies, previews, and explicit reusable saves.                                                              |
| `export_start`                                         | Export of a named immutable revision with progress and artifact identity.                                                             |

Each editing operation receives `session_id`, `project_id`, explicit sequence/page and target IDs, `expected_revision`, `request_id`, optional `run_id`, and operation-specific arguments. The server validates a discriminated operation schema, not an arbitrary `args` bag. Advanced operation descriptions are discoverable on demand. An operation may only be advertised when its actual owner, browser capabilities, assets, and permission scope support it.

### Initial video operation catalog

- Sequences: create, duplicate, configure, rename, remove, assemble ordered source passages, nest.
- Tracks: create, configure with explicit setters, reorder, group, ungroup, remove.
- Clips: insert, duplicate, move, split, join, trim, slip, lift/ripple remove, close gaps, retime, set speed points.
- Relationships: link, unlink, detach audio, create/dissolve compound, set transform parent.
- Appearance: set static transforms and crop, apply layouts, add/configure/reorder/remove effects, set clip or sequence grade, set/remove keyframes and easing, apply animation.
- Graphics: insert/edit/style text, create/correct/style source-linked captions, insert shape, background, timer, or library recipe.
- Sound: set gain and mute, fades, ducking, and supported processing by explicit units and targets.
- Transitions and markers: add, configure, remove.

`remove` declares lift versus ripple, linked-item policy, and ripple scope. `move` declares collision behavior. `trim` returns the actual source window and affected transitions. `transform.set` declares static versus keyed editing and never inherits hidden auto-key mode. Caption text changes do not delete speech. The catalog's schemas specify valid effects and parameters rather than accepting arbitrary timeline item properties.

### Initial image operation catalog

- Pages: create, duplicate, resize, reorder, remove, set background.
- Layers: insert, duplicate, remove, reorder, configure, group, ungroup, align, distribute, transform.
- Text: edit grapheme-indexed text and run styles, using existing asset-specific font identity.
- Appearance: crop, mask, grade, configure effects, apply supported library recipes.
- Raster: only implemented operations such as remove background, rasterize, merge, or flatten, with explicit source and page pixel coordinates.

Image operations respect effective ancestor locks and use the Image Editor controller. The Fabric preview and static renderer establish rendered-page evidence; a viewport screenshot alone is insufficient export proof.

## Media understanding

Analysis is source-scoped, versioned, cached by source identity, and requested only when needed. At minimum the assistant can discover metadata; transcribe and inspect source speech where supported; inspect sampled source frames and audio; search available scene and transcript evidence; resolve source words into particular timeline occurrences; render final composition frames/pages and short cut-boundary previews. Analysis reports examined ranges and unavailable ranges. A clip-wide thumbnail does not stand for frame-specific evidence. Within-shot sampling is needed for long screen recordings with few cuts. An unavailable analysis or an empty search over partial coverage cannot become a confident claim that content is absent.

Common-task recipes teach the model the needed sequence without hiding another creative model: find interview selects, remove reviewed filler or silence ranges, assemble a short cut, reframe vertical, add captions, mix music, make a thumbnail, inspect cut joins, and export. The recipe says what to inspect and what an operation changes. The model chooses the content and aesthetic intent; deterministic tools apply and verify the mechanics.

## Browser connection and Hosted assistant

The signed-in web editor makes an outbound, authenticated connection to an OpenPost session relay. The relay routes workspace-authorized MCP requests to the correct open editor session and returns typed results. It does not take ownership of local project files. Session IDs have connection epochs so late replies from a disconnected tab cannot be applied to a reopened project. Browser storage access and media decoding stay behind the existing editor repository and rendering boundaries. Local-only projects are discoverable only while their authorized browser session is connected.

The MCP server exposes the tool catalog through the existing OAuth and token authorization model, with one workspace scope and editor session per invocation. Tool descriptions state required editor availability. Large media bytes are returned as bounded MCP image/audio content or resource references when supported, rather than an unbounded JSON blob. Long work returns a job ID and can be polled or cancelled. A local agent can connect to the Hosted MCP endpoint without installing OpenPost. An optional direct local bridge can be considered later for accountless/offline use, after the connected-browser path is proven.

The paid Hosted assistant runs a bounded iterative tool loop via the maintained AI/OpenRouter adapter. It discovers capabilities, inspects evidence, makes a short edit, receives the actual receipt, checks the composed output, and corrects when needed. It uses the same authorization and session broker as external MCP. Paid entitlement gates Hosted inference, not the editor's deterministic editing rules. Model or provider changes do not create a second operation implementation.

## Workflow reuse boundary

Workflow nodes will need deterministic editing too. The reusable unit is a versioned operation and receipt, not an MCP request or browser polling endpoint. Keep operation names, validated arguments, project revision checks, media references, and results independent of the caller. MCP, the Hosted assistant, manual UI, and future Workflow nodes may submit the same domain command through their respective admission and execution adapters. A Workflow run records an immutable input snapshot and stable run/step ID, then invokes a durable worker against assets available to that worker. It cannot depend on a user's open tab, local-only media, view selection, or the editor's in-memory undo stack. A browser-connected tool may use the live browser executor for interactive work, but that transport must never be presented as a durable Workflow node. Define the headless execution and rendering adapter before advertising any video/image node. Workflow retries use their run/step identity for idempotency, and late job results respect the Workflow cancellation fence. Changes authored by a Workflow appear in an open editor through the normal project revision/conflict path, not by silently patching its state.

## Reuse and style

Expose existing library favorites, reusable selections, text styles, transitions, effects, animations, fonts, and brand assets with their actual dependencies and device availability. Applying a recipe creates an independent authored instance and imports needed assets through the destination project's existing boundary. Favorites inform suggestions; they do not mandate application. Temporary instructions apply to one run. A durable named style requires an explicit save and remains editable. Inferred preferences can later rank suggestions but do not silently become rules. Style learning and broad reference-video imitation follow the core editing path.

## Delivery and verification

The first complete delivery must cover both Video and Image Editor, external MCP editing from Codex CLI or Claude Code, and replacement of the Hosted Video Editor assistant for paid users. Verify these end-user tasks through the real UI and MCP boundary:

1. Inspect a project with repeated source footage; select and edit only the requested occurrence. Verify timebase and stale-reference errors.
2. Assemble a short cut, remove reviewed speech/silence ranges, reframe it, add/edit captions and graphics, configure audio, inspect final composed frames/audio, and export the identified revision.
3. Create or edit a layered image, including page size, text, layer order/layout, appearance, rendered preview, and export.
4. Observe every committed agent step in the open editor, with save/render state distinguished. Browsing the editor during agent inspection does not move the user's view.
5. Retry a mutation after a lost reply without duplication. Reject stale, locked, missing, ambiguous, or unsupported operations without collateral edits.
6. Stop during a long job. Keep completed edits; prevent late authoring. Undo the head change, selectively revert a safe older change, and report a conflict when later human work depends on it.
7. Inspect and apply available favorites or templates. Report missing device-local recipes or assets accurately.
8. Prove paid Hosted entitlement, OpenRouter tool-loop accounting, Workspace authorization, that original local project files remain in the connected browser unless explicitly imported or exported, and that preview/transcript disclosure matches the documented transport.

Unit and integration tests should protect observable behavior at the shared operation and transport boundaries. Browser tests should exercise real timeline/canvas changes in both themes and at desktop and phone widths. Existing editor checks, backend tests, contract generation, and MCP compatibility tests remain required for their affected surfaces. Use focused gates first, then complete the repository's required gates. Do not treat a successful tool response as proof that a composed frame rendered or an export saved.
