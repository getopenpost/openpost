package providerlimits

// Verified 2026-09-26 against X's media documentation:
// https://docs.x.com/x-api/media/introduction
// https://docs.x.com/x-api/media/quickstart/best-practices
// https://docs.x.com/x-api/media/quickstart/media-upload-chunked
//
// The caps below describe Post video uploaded with media_category=tweet_video,
// the category OpenPost sends. They follow the authenticated user's X Premium /
// verified status, not the developer API plan. Upload and Post-create limits
// are enforced separately: a media_id that finalizes successfully can still be
// rejected by POST /2/tweets with 403 when the video exceeds the posting
// user's cap.
//
// The previous 512 MiB / 140-second defaults describe dm_video (Direct
// Messages), which OpenPost never uploads, not Post video.
const (
	XPostVideoMaxBytes                  = 8 * 1024 * 1024 * 1024
	XPostVideoMaxDurationSeconds        = 20 * 60
	XPremiumPostVideoMaxBytes           = 16 * 1024 * 1024 * 1024
	XPremiumPostVideoMaxDurationSeconds = 125 * 60
)
