package providerlimits

// Verified 2026-09-12 against app.bsky.embed.video and Bluesky's video update:
// https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json
// https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r
const (
	BlueskyVideoMaxBytes           = 300_000_000
	BlueskyVideoMaxDurationSeconds = 10 * 60
)
