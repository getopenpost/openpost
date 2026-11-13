### Fixed

- Server and CLI builds use Go 1.27.4, fixing the standard library HTTP vulnerability GO-2026-6859.
- CI retries transient media-tool downloads and waits for SQLite write locks in the Messages recovery fixture.

### Changed

- The mobile app uses the current compatible Expo patch versions.
