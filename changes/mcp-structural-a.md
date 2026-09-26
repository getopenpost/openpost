### Added

- MCP execute-mode mutations accept an optional `idempotency_key` routed into the existing REST idempotency path, so retried `create_post`, `update_post`, `set_post_variants`, `schedule_post`, `cancel_post`, `publish_post_now`, `reply_to_variant`, comment actions, `upload_media_from_url`, and upload-ticket calls replay the stored result instead of running twice.
- MCP can now delete posts through `delete_post` (post ID plus expected revision with a `confirm=true` second call), manage media through `get_media`, `update_media` (favorite, alt text), and `delete_media` (with `confirm=true`), and retry delivery through `retry_failed_variants` and `retry_variant` using the post-action shape.
- MCP `schedule_post` and `publish_post_now` accept `dry_run` to validate readiness without enqueueing, and post results accept `detail: summary|full` to choose between the unified summary plus job ID shape and the complete post.
- MCP comment mutations now report `job_id` instead of `id`, and every post mutation returns the unified summary plus job ID shape.

### Changed

- MCP marks every state-changing operation `destructiveHint=true`, keeps `openWorldHint` for operations that reach external provider systems only, and requires a machine-enforceable `confirm=true` second call for `delete_post`, `publish_post_now`, `delete_media`, and `delete_comment`.
- MCP `list_posts` constrains `status` and `content_profile` to enums so typos fail with `-32602`, and `create_post` documents that `scheduled_at` only stores a desired time while `schedule_post` validates and enqueues.
- MCP `render_local_media_upload` is read-only end to end: it needs only workspace read access and stays visible to `mcp:read` connections, while the upload-ticket tool remains `mcp:full` only.
