# Native workflows

Workflows turn GitHub releases, RSS/Atom items, scheduled intervals, manual inputs, new posts, and publishing outcomes into ordered content actions. Nodes create drafts, use the native AI Builder, request review, schedule posts, wait, branch, read metrics, queue replies, call APIs, generate text, and transform data. Existing repost policies appear alongside these definitions in Workflows. The native repost service remains their single execution owner.

## Authoring and execution

The saved document is a structured program, not the canvas graph. A condition or AI decision owns its `then` and `else` steps. The canvas and keyboard-accessible node modal edit the same document. Organize resets only the canvas layout and fits the graph; it never changes execution order. Canvas placement is local view state. Node moves and organization share undo history with document edits, without saving positions into workflow definitions. Ctrl/Cmd+Z, redo, and save operate within the workflow editor; text inputs and nested dialogs retain their own keyboard ownership. Node context menus expose configuration, insertion, duplication and deletion. Duplicating a branch allocates new IDs and rewrites only bindings inside its copied subtree; upstream bindings and JavaScript remain unchanged. Recipes insert ordinary connected steps in one undoable edit. Step IDs are stable and references can only address earlier steps on the same path. Whole-field references retain their JSON type. Text interpolation supports field paths without executing expressions or code. Missing fields fail the step before a native write. Equality preserves exact text when both operands are text. When one operand is a number or boolean, entered text is parsed as that type; invalid or non-finite values fail the step.

Saving updates the draft through optimistic revision checking. Publishing copies the exact draft into the active definition. Automatic admission and each run retain an immutable snapshot. Draft edits never alter an existing run. The editor preserves newer local edits while a save is pending, and reports conflicts without overwriting another editor's work.

The editor uses a standalone full-screen route, a categorized node picker in a sheet, and a large node-inspection dialog with input/configuration/output panels. On phones, inspection uses a bottom sheet with data tabs. Connection forms use dialogs. Graphs in templates and run history project the stored definitions. Required fields and invalid references share field and node diagnostics. CodeMirror renders variables as atomic chips in single-line and multiline fields. One field accepts text and variables without a mode switch. Searchable insertion, typing `{{`, and dragging input fields share this editor. Numeric, JSON and condition fields containing exactly one variable store a typed reference. Text fields retain interpolation so numbers and booleans become text.

A preview resolves bindings and branches with explicitly simulated native outputs. It skips timers and approval waits and never dispatches native actions. Reading a source example is a separate, real read that does not advance source admission. Live runs use the saved draft and perform the configured actions. Node tests execute one data, HTTP, feed, or AI node using explicitly supplied input data, without running later steps. They require administration, store resolved inputs before dispatch, and use normal durable jobs and run history. Publication actions remain in full workflow runs. Test data is never evaluated as JavaScript source.

## Durable boundaries

`apps/server/internal/services/workflows/` owns definitions, sources, admission, and checkpoints. Database jobs execute one step at a time, including persisted timers and approval waits. A sweep restores runnable checkpoints after worker interruption. Run leases fence competing workers; workspace locks serialize admission, deletion, cancellation, and checkpoint writes where those operations intersect.

`handlers/workflow_actions.go` adapts native publication, Builder, analytics, and reply commands. Stable run/step keys drive the existing native idempotency receipts. Builder recovery finds the original build by its key before resolving any current settings. Provider writes remain in the existing publishing and provider-write queues, with their readiness checks and authorization receipts. Scheduling retains the native per-rendition outcomes in its output, including receipt replay. Blocking validation details originate in the publication service and reach workflow errors without reimplementing provider checks.

Draft destinations reuse `SocialSetControl`, including its format and account-resolved settings dialogs. The workflow stores either a Social Set ID or explicit account IDs. A selected set resolves its current members and defaults through native publication or Builder creation for each new draft. Replaying an accepted step uses its original receipt, even if that set later changes or disappears. Created posts own their destination snapshots; reviewing or scheduling must not reapply set defaults.

Stored authority carries the activating user's identity assurance. Current workspace membership, organization policy, and action permissions are rechecked. Live runs require administration; editors can save and preview; viewers can inspect. The stored-authority context is internal and cannot be supplied by HTTP clients. Native commands verify that its workspace and user match the target.

Approval reads the current native post and binds the decision to the revision displayed to the reviewer. Scheduling must reference the approval step's `publication_id` and `revision` to enforce that decision after a wait or subsequent edit. Cancelling stops remaining steps and retains any outcome already accepted by a native action. It does not undo a created draft or cancel an already queued publication job. Pausing stops automatic admission; existing runs continue.

## Sources and credentials

Activation establishes a baseline before reporting success. RSS/Atom uses GUIDs or links, with a stable fallback when neither exists. Feed history is limited to the items the publisher still exposes. GitHub uses release IDs. Every poll checks recent releases and a persisted cursor scans older pages, allowing catch-up beyond the first 100 releases without unbounded requests. Reconciliation of older pages can take multiple polls.

Published-variant sources read successful native lifecycle events, deduplicate by variant, and drain unadmitted records in bounded pages. Poll failures never advance away from unadmitted native events. Source admission and job creation share a transaction. When capacity is limited, a poll admits only the available slots and retains its cursor for the remainder. Publishing commits the completed variant and its lifecycle event atomically, including thread completion.

Scheduled intervals start at activation and admit the latest elapsed slot, without replaying missed slots after downtime. New-post triggers exclude the publication owner's `autopost` origin to prevent automation feedback loops. Failed-publication triggers consume durable lifecycle events, deduplicated by failure event ID, so retrying a rendition before the next poll cannot hide its failure.

Source reads use the shared network guard, validate redirect destinations, limit response sizes, and reject private network targets. Authenticated GitHub reads stay on HTTPS at the original host. Connection secrets are encrypted, omitted from every response and run snapshot, and included in encryption-key rotation. Connections belong to a workspace. Deletion and definition changes share a workspace lock and recheck references before committing.

Limits are enforced in the service: 40 steps, four nested branch levels, 100 workflows per workspace, 1,000 active runs, and a 30-day run lifetime. These are execution bounds, not sellable plan promises. Runs are inspected through `/workflow-runs`; the list returns the latest 50.

## Custom tools and usage

HTTP nodes support method, query, headers, body, timeout and response format. cURL import parses supported options into these fields and rejects shell constructs, file reads and unsupported flags. HTTP and feed reads use the shared public-network guard. HTTP output is bounded to 256 KiB, with a 30-second maximum timeout. Feed-node output is also bounded to 256 KiB; RSS triggers process larger feeds one entry at a time.

GitHub, Bearer, API-header and Basic credentials live in workspace connections. Custom credentials bind to one exact HTTPS host. Rotation retains the connection ID. Authentication headers cannot be stored directly in workflow definitions. Raw and encoded secret values are removed from response bodies and permitted headers before persistence.

External HTTP and AI effects claim a run/step receipt under the workspace lock, checking the running state and lease before dispatch. A completed receipt replays its saved output. An interrupted or failed receipt stops for inspection instead of repeating an uncertain remote action. Cancellation after acceptance may leave a completed effect, but prevents subsequent admission.

`internal/workflowcode` evaluates JavaScript in a fresh QuickJS WebAssembly guest through Wazero. It has no filesystem, sockets, environment, host callbacks, or asynchronous work. The total guest memory, JavaScript heap, execution deadline and input/output sizes are bounded. Keep its upstream notices and isolation tests with the engine. Never substitute an in-process JavaScript evaluator or shell execution.

AI text uses the configured text-generation model with an optional system message and a required user message. Existing `instructions` and `text` storage keys retain their meaning. AI decisions use a separate `ai.Decider` adapter to OpenRouter’s Decisions API, with `typesafe/jev-1.13` as the default. The adapter uses the maintained OpenAI SDK transport and preserves data-collection denial and the configured ZDR requirement. Decisions route to Yes at probability 0.5 or above and otherwise to No. The output exposes `probability`; the legacy `reason` field remains an empty string because Jev does not generate explanations. Malformed probabilities fail the run. Provider calls are not retried by this adapter after uncertain acceptance.

AI text and decision calls record workspace, user, workflow, run, step, configured/returned model, provider request ID, token counts, reported cost when available, and outcome in `workflow_ai_usage`. Usage survives provider errors and invalid structured output. Costs are nullable, not inferred as zero. Native Builder usage remains in `publication_builds`, linked by its stable workflow run/step key. No workflow spending cap is enforced.

## Schema and recovery

Migration 145 adds workflow definitions, runs, admitted events, and encrypted connections. Migration 146 adds credential host metadata, external effect receipts, and AI usage. Both are additive. Before rolling back to a binary without workflow execution, pause the workflows and cancel or finish outstanding runs. Retain the tables for recovery and inspection. A worker running old code cannot resume new workflow jobs.

The editor lives at `/workflows` and `/workflows/[id]`. Reads use the shared query catalogue and workspace cache boundaries. The REST API uses Huma contracts. Scoped API credentials receive explicit read/write operation policy; the connector catalogue does not automatically expose these operations in external automation adapters.

## Evidence

Service and HTTP tests cover immutable snapshots, conditions and typed references, safe previews, timers, approval revision checks, access revocation, cancellation during an action, source baselines, GitHub page reconciliation, native backlog draining, credential secrecy, and native draft/scheduling replay. Browser tests exercise saving and reopening, preview versus live draft creation, approval, templates, keyboard selection, and desktop/phone layouts.

## Repost migration

This is an in-place migration of the product surface. Existing `RepostPolicy` records appear in the Workflows library without conversion, reactivation, or a second generic definition. `/settings?tab=reposts` redirects to `/workflows/reposts`. Native editing, account grants, stage schedules, and execution history live there. The history includes custom per-post executions without a policy ID. First comments remain owned by the publication settings and are not copied into follow-up workflows.

The existing repost executor retains original-publication-relative times, all/any thresholds, plateau checks, deadlines, unrepost checkpoints, account grants, and per-rendition/target delivery identity. Enabled and paused rules keep their state. Pausing prevents new admissions; accepted executions continue from their immutable rule snapshots. Composer `off` and `custom` overrides keep precedence.

Saving rules updates retained IDs in place, preserving creator, creation time, and execution foreign keys. The editor sends the collection revision and stale saves fail with 409. Deleting a rule leaves accepted execution snapshots intact. Native repost history exposes the latest 50 executions. No data-copy migration or job restart is required, and rolling back the UI leaves these native tables and jobs usable by the prior release.
