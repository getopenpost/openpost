### Added

- Support up to 20 items in Instagram carousels across validation, publishing, and docs.
- Add per-token minute and hour operation rate limits for MCP tool calls.
- Show a live character counter on inline media alt-text editors based on active destination limits.

### Fixed

- Retry transient HTTP 429 and 5xx errors per chunk during TikTok video uploads without restarting the upload.
- Reject Meta's sentinel `"0"` container ID on Instagram publishes and separate standalone Instagram Login grants from Facebook Login grants.
- Fence Pinterest creation timeout error code `21` as an ambiguous write so OpenPost never auto-replays `POST /v5/pins`, and retry explicit HTTP 400 code `1` refusals.
- Wait for YouTube Shorts video processing to complete before applying custom thumbnails, and revoke YouTube OAuth grants at Google on disconnect.
- Retry transient HTTP 404 responses on LinkedIn first comments and classify HTTP 422 duplicate-URN rejections clearly.
- Classify Threads invalid link attachment (`4279047`) and Facebook `robots.txt` media-crawler blocks (`FileUrlProcessingError`) with actionable diagnostics, and fail closed when Meta long-lived token exchange fails.
- Notify account connectors and workspace administrators once per break when background token refreshes fail permanently.
- Enforce Google Business Event and Offer settings during pre-publish validation, normalize Discord bot-token 401 errors across read/reconcile paths, route default `slog` logging through secret/JWT redaction, block NAT64/SIIT SSRF prefixes, and surface blocking capability errors in the composer validation summary.
