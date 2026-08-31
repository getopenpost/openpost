# Changes fragments

Create per-issue changelog entries here as `changes/<issue>.md`.

Each file should group items under `### Added`, `### Changed`, `### Fixed`, etc.:

```
### Fixed

- Describe the user-visible fix.
```

`bun scripts/merge-changelog-fragments.mjs` merges fragments into `CHANGELOG.md`
under `[Unreleased]` before `bun scripts/prepare-release-changelog.mjs` prepares the
release. Fragments are deleted after merge so parallel tickets do not conflict.
