### Fixed

- When `post create --schedule` creates a draft but scheduling fails, the CLI reports the publication ID and a command to retry scheduling without creating another draft. Add `post schedule <id> --at <time>` as an alias for `publication schedule`.
- If scheduling succeeds but the status lookup fails, the CLI reports that scheduling was accepted and provides a command to check the existing publication.
