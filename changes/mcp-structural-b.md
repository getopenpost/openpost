### Added

- MCP `list_media` and `list_post_events` now page with an opaque `cursor` input and `has_more`, `next_cursor`, and `total_count` outputs, using the same shape as `list_posts`. Events default to 100 items per response and cap at 200.
- MCP `list_variant_comments` accepts a `limit` input (1-100, default 50); results beyond the limit are truncated in provider order and the response text notes the truncation.
- MCP `get_post_metrics` returns stored analytics per variant (normalized `views`, `reactions`, `engagements`, `impressions`, and `reach`) plus post totals, reading stored snapshots without provider calls.
- MCP `get_dashboard_link` builds an app-origin dashboard URL for `post`, `media`, `account`, and `calendar` views so agents can hand users a link to the visualization.
- MCP `search_docs` searches a curated offline registry of documentation and assistant skill pages, returning titles, `/docs` paths, and snippets.
- MCP documents recommended toolsets per client (direct `/mcp` for full-catalog clients, compact `/mcp/code` for constrained ones) and records the accepted gaps: no account connect/disconnect, no bulk operations, and no webhook tools.

### Changed

- MCP read paging is now consistent: `list_posts` and `list_media` default to 20 and cap at 100, while `list_post_events` is explicitly 100/200.
- MCP provider catalog, social account, and readiness descriptions name each other as next steps; `list_posts` and `validate_post` failure text names `get_post` for delivery detail and `retry_failed_variants` for safe retries.
- MCP clarifies widget renderer scope: both render tools are read-only and visible to `mcp:read`, while the upload ticket tool stays app-only and requires `mcp:full`.
- MCP OAuth has no per-client allow-listing: any standards-compliant OAuth client can connect, and the recorded client name is attribution only.
