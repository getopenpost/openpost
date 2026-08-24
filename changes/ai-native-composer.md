### Added

- Added a source-first AI Publication Builder that turns ideas, public links, and Workspace media into reviewed, destination-native drafts for LinkedIn, X, Mastodon, Bluesky, and Threads.
- Added reusable Voice Profiles with Workspace defaults, account assignments, preferred writing language, representative writing, corrections, opinions, and tone limits.
- Added guarded, cited content opportunity discovery that uses the selected Voice Profile and recent Publications before handing a chosen angle to the Builder.

### Changed

- The new-post flow now opens the Builder when server-side AI is configured, while Manual keeps the existing composer available.
- Builder work runs as a durable, idempotent job and creates one normal draft Publication only after review.
- Source-bound media plans now carry one exact approved source into the relevant destination editor or attach it only to Renditions that use the raw source.
- Builder destinations now freeze the same live connected-account limits used by the composer, including X subscription limits and Mastodon instance limits.
- Native platform prompts now carry separate LinkedIn, X, Mastodon, Bluesky, and Threads distribution, writing, media, safety, and plain-language rules into generation and review.
- Builder, Voice Profile, result-review, and composer controls now share consistent heights, clearer line-tab focus, denser review metadata, and active destination scrolling.
