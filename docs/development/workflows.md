# Native workflows

Workflows turn GitHub releases, RSS/Atom items, manual inputs, and newly published OpenPost variants into ordered content actions. The initial actions create drafts, use the native AI Builder, request review, schedule posts, wait, branch, read collected metrics, and queue prepared replies. Existing repost policies appear alongside these definitions in Workflows. The native repost service remains their single execution owner.

## Authoring and execution

The saved document is a structured program, not the canvas graph. A condition owns its `then` and `else` steps. The canvas and keyboard-accessible configuration panel edit the same document. Step IDs are stable and references can only address earlier steps on the same path. Whole-field references retain their JSON type. Text interpolation supports field paths without executing expressions or code. Missing fields fail the step before a native write. Equality preserves exact text when both operands are text. When one operand is a number or boolean, entered text is parsed as that type; invalid or non-finite values fail the step.

Saving updates the draft through optimistic revision checking. Publishing copies the exact draft into the active definition. Automatic admission and each run retain an immutable snapshot. Draft edits never alter an existing run. The editor preserves newer local edits while a save is pending, and reports conflicts without overwriting another editor's work.

A preview resolves bindings and branches with explicitly simulated native outputs. It skips timers and approval waits and never dispatches native actions. Reading a source example is a separate, real read that does not advance source admission. Live runs use the saved draft and perform the configured actions.

## Durable boundaries

`apps/server/internal/services/workflows/` owns definitions, sources, admission, and checkpoints. Database jobs execute one step at a time, including persisted timers and approval waits. A sweep restores runnable checkpoints after worker interruption. Run leases fence competing workers; workspace locks serialize admission, deletion, cancellation, and checkpoint writes where those operations intersect.

`handlers/workflow_actions.go` adapts native publication, Builder, analytics, and reply commands. Stable run/step keys drive the existing native idempotency receipts. Builder recovery finds the original build by its key before resolving any current settings. Provider writes remain in the existing publishing and provider-write queues, with their readiness checks and authorization receipts.

Stored authority carries the activating user's identity assurance. Current workspace membership, organization policy, and action permissions are rechecked. Live runs require administration; editors can save and preview; viewers can inspect. The stored-authority context is internal and cannot be supplied by HTTP clients. Native commands verify that its workspace and user match the target.

Approval reads the current native post and binds the decision to the revision displayed to the reviewer. Scheduling must reference the approval step's `publication_id` and `revision` to enforce that decision after a wait or subsequent edit. Cancelling stops remaining steps and retains any outcome already accepted by a native action. It does not undo a created draft or cancel an already queued publication job. Pausing stops automatic admission; existing runs continue.

## Sources and credentials

Activation establishes a baseline before reporting success. RSS/Atom uses GUIDs or links, with a stable fallback when neither exists. Feed history is limited to the items the publisher still exposes. GitHub uses release IDs. Every poll checks recent releases and a persisted cursor scans older pages, allowing catch-up beyond the first 100 releases without unbounded requests. Reconciliation of older pages can take multiple polls.

Published-variant sources read successful native lifecycle events, deduplicate by variant, and drain unadmitted records in bounded pages. Poll failures never advance away from unadmitted native events. Source admission and job creation share a transaction. When capacity is limited, a poll admits only the available slots and retains its cursor for the remainder. Publishing commits the completed variant and its lifecycle event atomically, including thread completion.

Source reads use the shared network guard, validate redirect destinations, limit response sizes, and reject private network targets. Authenticated GitHub reads stay on HTTPS at the original host. Connection secrets are encrypted, omitted from every response and run snapshot, and included in encryption-key rotation. Connections belong to a workspace. Deletion and definition changes share a workspace lock and recheck references before committing.

Limits are enforced in the service: 40 steps, four nested branch levels, 100 workflows per workspace, 1,000 active runs, and a 30-day run lifetime. These are execution bounds, not sellable plan promises. Runs are inspected through `/workflow-runs`; the list returns the latest 50.

## Schema and recovery

Migration 145 adds workflow definitions, runs, admitted events, and encrypted connections. It is additive. Before rolling back to a binary without workflow execution, pause the workflows and cancel or finish outstanding runs. Retain the tables for recovery and inspection. A worker running old code cannot resume new workflow jobs.

The editor lives at `/workflows` and `/workflows/[id]`. Reads use the shared query catalogue and workspace cache boundaries. The REST API uses Huma contracts. Scoped API credentials receive explicit read/write operation policy; the connector catalogue does not automatically expose these operations in external automation adapters.

## Evidence

Service and HTTP tests cover immutable snapshots, conditions and typed references, safe previews, timers, approval revision checks, access revocation, cancellation during an action, source baselines, GitHub page reconciliation, native backlog draining, credential secrecy, and native draft/scheduling replay. Browser tests exercise saving and reopening, preview versus live draft creation, approval, templates, keyboard selection, and desktop/phone layouts.

## Repost migration

This is an in-place migration of the product surface. Existing `RepostPolicy` records appear in the Workflows library without conversion, reactivation, or a second generic definition. `/settings?tab=reposts` redirects to `/workflows/reposts`. Native editing, account grants, stage schedules, and execution history live there. The history includes custom per-post executions without a policy ID. First comments remain owned by the publication settings and are not copied into follow-up workflows.

The existing repost executor retains original-publication-relative times, all/any thresholds, plateau checks, deadlines, unrepost checkpoints, account grants, and per-rendition/target delivery identity. Enabled and paused rules keep their state. Pausing prevents new admissions; accepted executions continue from their immutable rule snapshots. Composer `off` and `custom` overrides keep precedence.

Saving rules updates retained IDs in place, preserving creator, creation time, and execution foreign keys. The editor sends the collection revision and stale saves fail with 409. Deleting a rule leaves accepted execution snapshots intact. Native repost history exposes the latest 50 executions. No data-copy migration or job restart is required, and rolling back the UI leaves these native tables and jobs usable by the prior release.
