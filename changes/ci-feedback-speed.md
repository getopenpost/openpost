### Changed

- Run the public artifact contract in a dedicated CI job, reuse the docs and marketing artifacts that job needs, persist the local Turbo cache across jobs, and keep changelog-only pull requests out of the full matrix.

### Fixed

- Bound local task steps and CI jobs so a hung build or a missing binary fails in minutes instead of blocking a run for hours.
