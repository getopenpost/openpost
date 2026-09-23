### Fixed

- X posts containing characters the X API never accepts (U+FFFE, U+FEFF, U+FFFF) now fail validation before any upload or post is dispatched.
- Bluesky posts trim trailing punctuation from link facets, drop overlapping facets instead of sending provider-rejected records, skip mentions with malformed DIDs, and enforce the 300-character and 3000-byte limits before the record is built.
