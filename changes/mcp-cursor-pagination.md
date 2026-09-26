### Added

- MCP `list_publications` now pages with an opaque `cursor` input and `has_more`, `next_cursor`, and `total_count` outputs, defaulting to 20 items per response and capping at 100. Assistants review large queues by following `next_cursor` over narrow windows instead of requesting wide unbounded windows.
- MCP `list_publications` items now include a safe failure summary: `failed_rendition_count` plus the curated `error_kind`, `error_action`, and `error_message` of the first failed destination. Raw provider response bodies are never exposed.
