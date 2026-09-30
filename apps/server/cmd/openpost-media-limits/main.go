package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
)

func main() {
	fmt.Print(`---
title: Media limits
description: Default attachment limits used by OpenPost before publishing.
icon: FileCheck
---

These defaults apply before publishing. The destination preview shows account-specific limits and readiness.

Sizes are exact bytes, durations are seconds, and attachment counts apply to each thread segment. A dash means no fixed catalogue limit, not unlimited. Your plan, server, account, or connected instance can impose lower limits.

## Default limits

| Destination format | Attachments | File types | Maximum bytes | Image maximum bytes | Video seconds | Additional rules |
| --- | --- | --- | --- | --- | --- | --- |
`)
	seenRows := make(map[string]bool)
	for _, capability := range capabilities.All() {
		media := capability.Media
		if len(media.AllowedMIMEs) == 0 {
			continue
		}
		rules := []string{}
		if media.VideoExclusive {
			rules = append(rules, "Video must be the only attachment")
		}
		if media.RequiresHTTPSFetchable {
			rules = append(rules, "Public HTTPS file required")
		}
		if len(media.AspectRatios) > 0 {
			rules = append(rules, "Aspect ratio: "+strings.Join(media.AspectRatios, ", "))
		}
		row := fmt.Sprintf("| %s | %d–%d | %s | %s | %s | %s | %s |\n", capability.Label, media.MinCount, media.MaxCount, strings.Join(media.AllowedMIMEs, ", "), limit(media.MaxSizeBytes), limit(media.MaxImageSizeBytes), limit(int64(media.MaxDurationSeconds)), strings.Join(rules, "; "))
		if seenRows[row] {
			continue
		}
		seenRows[row] = true
		fmt.Print(row)
	}
	fmt.Print(`
## Provider exceptions

Reviewed **26 September 2026**. The table above comes from OpenPost's capability catalogue. Preflight also checks codecs, dimensions, and account restrictions.

| Provider | What to check |
| --- | --- |
| [Bluesky](https://docs.bsky.app/docs/tutorials/creating-a-post) | A segment can contain images or one [video](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json). |
| [X](https://docs.x.com/x-api/media/quickstart/media-upload-chunked) | Premium and verified accounts can have higher video limits. The destination preview applies them. |
| [TikTok](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide) | The connected creator determines duration and privacy options. URL uploads need a verified domain and accessible HTTPS file. |
| [YouTube](https://developers.google.com/youtube/v3/docs/videos/insert) | OpenPost's default size cap is lower than the API maximum. Unverified API projects may be limited to private uploads. |
| [LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api) | Video permissions differ from image and document permissions. |
| [Mastodon](https://docs.joinmastodon.org/methods/instance/#v2) and [Pixelfed](https://github.com/pixelfed/pixelfed/blob/dev/routes/api.php) | The connected instance's advertised limits override defaults. |
| [PeerTube](https://docs.joinpeertube.org/api/rest-getting-started) | Instance quota and transcoding policy apply. |
| [Lemmy](https://join-lemmy.org/docs/contributors/04-api.html) and [PieFed](https://freamon.github.io/piefed-api/) | Community posts need a title. Lemmy API v4 instances are not supported. |
| [Telegram](https://core.telegram.org/bots/api#sending-files) | Limits depend on the sending method and hosted or local Bot API. Not every transfer limit appears above. |

For access or approval failures, see [connecting accounts](/guides/accounts) and the [integration setup guides](/self-hosting/integrations).
`)
}

func limit(value int64) string {
	if value == 0 {
		return "-"
	}
	return strconv.FormatInt(value, 10)
}
