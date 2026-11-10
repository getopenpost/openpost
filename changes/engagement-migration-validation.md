### Fixed

- SQLite upgrades no longer stop at migration 171 because of unrelated historical foreign-key violations in sync-state tables. The engagement table rebuild still validates its own foreign keys and incoming references, preserving existing data.
