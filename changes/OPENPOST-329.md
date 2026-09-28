### Changed

- Video recording prefers native H.264 when supported and appends capture data in a storage worker, reducing encoding and disk work while preserving recovery files.
- The Video Editor recorder separates source setup, recording controls, and saving progress, with fewer controls visible during capture.

### Fixed

- Cameras, screen sharing, and microphone monitoring stop before the recording finishes saving. Capture duration no longer includes storage delays.
- Saving a new recording no longer briefly displays recovery warnings. Preparing previews no longer counts as a media issue.
