package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
)

func main() {
	document, err := generate()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Print(document)
}

func generate() (string, error) {
	uploadLimits, err := serverUploadLimits()
	if err != nil {
		return "", err
	}
	var document strings.Builder
	document.WriteString(`---
title: Media limits
description: Default attachment limits used by OpenPost before publishing.
icon: FileCheck
---

These defaults apply before publishing. The destination preview shows account-specific limits and readiness.

Sizes are exact bytes, durations are seconds, and attachment counts apply to each thread segment. A dash means no fixed catalogue limit, not unlimited. Your plan, server, account, or connected instance can impose lower limits.

## Upload limits

`)
	document.WriteString(uploadLimits)
	document.WriteString(`
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
		document.WriteString(row)
	}
	document.WriteString(`
## Provider exceptions

Reviewed **26 September 2026**. The table above comes from OpenPost's capability catalogue. Preflight also checks codecs, dimensions, and account restrictions.

| Provider | What to check |
| --- | --- |
| [Bluesky](https://docs.bsky.app/docs/tutorials/creating-a-post) | A segment can contain images, one animated GIF, or one [video](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json). |
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
	return document.String(), nil
}

// serverUploadLimits renders the workspace upload-limits sentence from the
// enforced uploader constants in internal/api/handlers/media.go, so a limit
// change flows into the guide through this generator instead of leaving
// hand-authored prose stale. It fails closed when the constants cannot be
// read: silently falling back to old numbers would reintroduce the drift.
func serverUploadLimits() (string, error) {
	maxBytes, maxPixels, err := readUploaderConstants()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Workspace uploads accept files up to %s (%s bytes). Images must decode successfully and contain no more than %s (%s pixels). This bounds the memory needed to open compressed files. Destination publishing limits below are separate.\n",
		humanBytes(maxBytes), groupThousands(maxBytes), humanPixels(maxPixels), groupThousands(maxPixels)), nil
}

var uploaderConstantPattern = regexp.MustCompile(`(?m)^\s*(MaxBufferedMediaUploadBytes|mediaUploadMaxImagePixels)\s+int64\s*=\s*(.+?)\s*$`)

func readUploaderConstants() (maxBytes, maxPixels int64, err error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return 0, 0, fmt.Errorf("cannot locate media upload constants")
	}
	source, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "internal", "api", "handlers", "media.go"))
	if err != nil {
		return 0, 0, fmt.Errorf("read media upload constants: %w", err)
	}
	values := map[string]int64{}
	for _, match := range uploaderConstantPattern.FindAllStringSubmatch(string(source), -1) {
		value, parseErr := evalConstExpr(match[2])
		if parseErr != nil {
			return 0, 0, fmt.Errorf("parse %s: %w", match[1], parseErr)
		}
		values[match[1]] = value
	}
	maxBytes, okBytes := values["MaxBufferedMediaUploadBytes"]
	maxPixels, okPixels := values["mediaUploadMaxImagePixels"]
	if !okBytes || !okPixels || maxBytes <= 0 || maxPixels <= 0 {
		return 0, 0, fmt.Errorf("media upload constants not found in handlers/media.go")
	}
	return maxBytes, maxPixels, nil
}

// evalConstExpr evaluates simple integer constant expressions such as
// "50 * 1024 * 1024" or "64_000_000".
func evalConstExpr(expr string) (int64, error) {
	result := int64(1)
	matched := false
	for _, part := range strings.Split(expr, "*") {
		literal := strings.ReplaceAll(strings.TrimSpace(part), "_", "")
		if literal == "" {
			return 0, fmt.Errorf("empty term in %q", expr)
		}
		value, err := strconv.ParseInt(literal, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("unsupported term %q in %q", part, expr)
		}
		result *= value
		matched = true
	}
	if !matched {
		return 0, fmt.Errorf("empty expression")
	}
	return result, nil
}

func humanBytes(value int64) string {
	if value%(1024*1024) == 0 {
		return strconv.FormatInt(value/(1024*1024), 10) + " MB"
	}
	return groupThousands(value) + " bytes"
}

func humanPixels(value int64) string {
	if value%1_000_000 == 0 {
		return strconv.FormatInt(value/1_000_000, 10) + " million"
	}
	return groupThousands(value)
}

func groupThousands(value int64) string {
	digits := strconv.FormatInt(value, 10)
	sign := ""
	if strings.HasPrefix(digits, "-") {
		sign, digits = "-", digits[1:]
	}
	remainder := len(digits) % 3
	var grouped strings.Builder
	grouped.WriteString(sign)
	if remainder > 0 {
		grouped.WriteString(digits[:remainder])
	}
	for i := remainder; i < len(digits); i += 3 {
		if grouped.Len() > len(sign) {
			grouped.WriteString(",")
		}
		grouped.WriteString(digits[i : i+3])
	}
	return grouped.String()
}

func limit(value int64) string {
	if value == 0 {
		return "-"
	}
	return strconv.FormatInt(value, 10)
}
