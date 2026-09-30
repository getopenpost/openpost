### Fixed

- Bluesky hashtags are detected the way Bluesky detects them: tags in any script (`#café`, `#日本語`, `#São_Paulo`) are linked whole instead of being cut at the first non-ASCII letter or skipped, a tag must follow a space, number-only tags stay plain text, and a tag longer than 64 characters is left unlinked instead of producing a facet the post record does not allow.
