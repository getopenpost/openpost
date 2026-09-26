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

A dash means the catalogue has no fixed limit for that field. It does not mean unlimited. Your upload plan, server configuration, provider account, and connected instance can impose lower limits. Sizes below are exact bytes; duration is in seconds. Attachment counts apply to each thread segment.

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

Catalogue and publisher validation reviewed: **26 September 2026**. The following API references were checked on that date:

- **Bluesky:** [image specifications](https://docs.bsky.app/docs/tutorials/creating-a-post) and [video schema](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json). Images are limited to 2,000,000 bytes. MP4 video is limited to 300,000,000 bytes and [10 minutes](https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r). A segment can contain images or one video.
- **X:** [media upload documentation](https://docs.x.com/x-api/media/introduction), [best practices](https://docs.x.com/x-api/media/quickstart/best-practices), and [chunked upload guide](https://docs.x.com/x-api/media/quickstart/media-upload-chunked). Post video uses media_category tweet_video, capped at 20 minutes / 8 GiB by default and 125 minutes / 16 GiB for X Premium or verified accounts; the older 512 MiB / 140-second values describe Direct Message video, which OpenPost never uploads. Connected-account capabilities adjust the default. A segment can contain images or one video.
- **TikTok:** [media transfer specifications](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide). MP4, MOV, and WebM are supported. Direct Post uses the connected creator's available duration and privacy options. URL uploads require a verified domain and an accessible HTTPS file.
- **YouTube:** [video upload API](https://developers.google.com/youtube/v3/docs/videos/insert). OpenPost's default file-size cap is lower than YouTube's API upload maximum. Unverified API projects can be restricted to private uploads. YouTube now supports [custom Shorts thumbnails for eligible channels](https://blog.youtube/news-and-events/youtube-studio-custom-thumbnail-updates/). OpenPost therefore does not impose a blanket Shorts restriction.
- **LinkedIn:** [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api). Video formats and account permissions differ from documents and image posts.
- **Mastodon:** [instance configuration](https://docs.joinmastodon.org/methods/instance/#v2). OpenPost uses the connected instance's advertised MIME types, attachment count, and image/video size limits when available.
- **Pixelfed:** [Mastodon-compatible statuses and media APIs](https://github.com/pixelfed/pixelfed/blob/dev/routes/api.php). Photo and album publishing reuse the compatible transport with Pixelfed's own identity and capability reporting. The connected instance's advertised configuration wins over catalogue defaults.
- **PeerTube:** [REST API quick start](https://docs.joinpeertube.org/api/rest-getting-started) and [OpenAPI specification](https://github.com/Chocobozzz/PeerTube/blob/develop/support/doc/api/openapi.yaml). Videos upload through the resumable protocol to a selected channel; transcoding state is reconciled before delivery is reported. Instance quota and transcoding policy apply.
- **Lemmy:** [API documentation](https://join-lemmy.org/docs/contributors/04-api.html) (v3, as used by the 0.19 series). Community posts carry a required title with an optional link and body. Lemmy 1.x instances using API v4 are refused with an explicit error until a v4 adapter is certified.
- **PieFed:** [alpha API documentation](https://freamon.github.io/piefed-api/). Community posting shares the Lemmy authoring model through PieFed's native post, community, and comment endpoints.
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
