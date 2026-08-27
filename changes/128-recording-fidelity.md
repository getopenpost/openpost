### Added

- Video Editor recording now detects browser capabilities, exposes an explicit cursor mode where supported, and preserves honest system/tab audio truth from capture through workspace artifact, media metadata, timeline import, preview, and export. Adds stable persisted capture metadata with migration for legacy media.

### Changed

- Recording setup shows honest capability states for screen, cursor, and system audio and never claims an audio stream exists merely because requested. Cancellation and track teardown are clean and bounded.

### Fixed

- Preview and export use actual captured tracks without duplicating or dropping audio; inactive system audio is reported as unavailable rather than presented as present.
