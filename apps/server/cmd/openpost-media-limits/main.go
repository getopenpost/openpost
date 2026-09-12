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

These are OpenPost's default publishing limits, generated from the same capability catalogue used by the composer, API, CLI, and MCP. They are not a promise that every connected account can publish every format. The destination preview applies account-specific limits, permissions, and provider readiness.

A dash means the catalogue has no fixed limit for that field. It does not mean unlimited. Your upload plan, server configuration, provider account, and Mastodon instance can impose lower limits. Sizes below are exact bytes; duration is in seconds. Attachment counts apply to each thread segment.

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
## Provider specifications and exceptions

Catalogue and publisher validation reviewed: **12 September 2026**. The following API references were checked on that date:

- **Bluesky:** [image specifications](https://docs.bsky.app/docs/tutorials/creating-a-post) and [video schema](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json). Images are limited to 2,000,000 bytes. MP4 video is limited to 300,000,000 bytes and [10 minutes](https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r). A segment can contain images or one video.
- **X:** [media upload documentation](https://docs.x.com/x-api/media/introduction). OpenPost currently uses the legacy OAuth 1.0a upload route. Its default 512 MiB / 140-second limit is deliberate; the newer v2 route's 8 GB / 20-minute limits do not describe this adapter. Connected-account capabilities can adjust the default. A segment can contain images or one video.
- **TikTok:** [media transfer specifications](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide). MP4, MOV, and WebM are supported. Direct Post uses the connected creator's available duration and privacy options. URL uploads require a verified domain and an accessible HTTPS file.
- **YouTube:** [video upload API](https://developers.google.com/youtube/v3/docs/videos/insert). OpenPost's default file-size cap is lower than YouTube's API upload maximum. Unverified API projects can be restricted to private uploads. YouTube now supports [custom Shorts thumbnails for eligible channels](https://blog.youtube/news-and-events/youtube-studio-custom-thumbnail-updates/). OpenPost therefore does not impose a blanket Shorts restriction.
- **LinkedIn:** [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api). Video formats and account permissions differ from documents and image posts.
- **Mastodon:** [instance configuration](https://docs.joinmastodon.org/methods/instance/#v2). OpenPost uses the connected instance's advertised MIME types, attachment count, and image/video size limits when available.
- **Telegram:** [Bot API file sending](https://core.telegram.org/bots/api#sending-files). File limits depend on the sending method and whether the deployment uses the hosted or local Bot API. The catalogue does not currently express every Telegram transfer limit.

Other destinations retain their catalogue defaults. Check their current provider requirements before relying on a boundary value. OpenPost's preflight also checks analysed media, codecs, dimensions, and account restrictions that are not all shown in this table.

For access or approval failures, see [connecting accounts](/guides/accounts) and the [integration setup guides](/self-hosting/integrations).
`)
}

func limit(value int64) string {
	if value == 0 {
		return "-"
	}
	return strconv.FormatInt(value, 10)
}
