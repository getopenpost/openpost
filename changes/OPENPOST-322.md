### Features

- Rebuild Workflows as a full-screen editor with a compact toolbar, searchable node picker, drag-to-add connections, required-field attention, variable chips, a large node-inspection modal with input/output panels, and graph previews for templates and runs.
- Add scheduled, new-post, and failed-publication triggers; AI text and decisions; HTTP requests with cURL import; isolated JavaScript; and content/data transformations. Add digest, relevance-review, API-to-post, and weekly draft templates.
- Manage encrypted GitHub and custom API credentials on a Connections page. Restrict custom credentials to a selected HTTPS host and replace secrets without rebuilding workflows.
- Test individual data, HTTP, feed, and AI nodes without running later publishing steps. Record AI token usage and provider-reported costs without imposing a spending cap.

### Fixes

- Show the provider, account identity, and avatar when choosing workflow destinations.
- Preserve publishing failures through retries and keep external requests from repeating after an uncertain outcome. Cancellation fences new external effects and response snapshots redact saved credentials.

### Operations

- Migration 146 adds credential metadata, external-effect receipts, and workflow AI usage. Existing repost policies, grants, executions, and per-post overrides retain their native owners and IDs. Pause workflows and finish or cancel their runs before rolling back to a version without these node types.
