### Changed

- Run the public artifact contract in a dedicated CI job, reuse the local Turbo cache across jobs, and keep changelog-only pull requests out of the full matrix.

### Fixed

- Bound local task steps and CI jobs so a hung build or a missing binary fails in minutes instead of blocking a run for hours.
- Stop every process in a timed-out task step, not only the direct command, and keep a changelog entry beside a documentation change from enabling the complete CI matrix.
