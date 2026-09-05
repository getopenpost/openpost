### Fixed

- Fixed cached navigation leaving Plan & usage, Accounts, Audit, and Ownership settings hidden behind loading placeholders.
- Kept billing and account settings subscribed to query updates and reconnect refreshes.
- Kept Grow polling until queued work completes, even when successive responses are unchanged.
- Preserved draft and broad publication invalidations while avoiding unrelated refreshes for draft-only saves.
- Showed background refresh failures in Activity without hiding cached content.
- Removed duplicate theme catalog requests and refreshed affected workspace theme caches after organization changes.
- Refreshed media search results after a rename changes which files match.
- Kept saved theme draft revisions current when publishing fails, so retries use the latest draft.
