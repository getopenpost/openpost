### Added

- Added a source-first AI Publication Builder that turns ideas, public links, and Workspace media into reviewed, destination-native drafts for LinkedIn, X, Mastodon, Bluesky, and Threads.
- Added reusable Voice Profiles with Workspace defaults, account assignments, representative writing, corrections, opinions, and tone limits.
- Added cited content opportunity discovery that uses the selected Voice Profile and recent Publications before handing a chosen angle to the Builder.

### Changed

- The new-post flow now opens the Builder when server-side AI is configured, while Manual keeps the existing composer available.
- Builder work runs as a durable, idempotent job and creates one normal draft Publication only after review.
