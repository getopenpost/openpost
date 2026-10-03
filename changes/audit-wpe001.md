### Fixed

- Post-created workflow events expose the post’s creation time as `created_at` and omit `published_at` for unscheduled drafts. Source examples and the variable picker use the same fields.

### Changed

- Workflows using Post created with `source.published_at` must change that binding to `source.created_at`. Existing workflow definitions and historical run snapshots are not rewritten. Publication timestamps for feeds, releases and published variants remain unchanged.
