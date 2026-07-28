package platform

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

var (
	safeContentID  = regexp.MustCompile(`^[A-Za-z0-9._~:@-]+$`)
	numericContent = regexp.MustCompile(`^[0-9]+$`)
)

// DeterministicContentURL returns a public post URL when a provider's stored
// publish result contains everything needed to build one without another API
// request. Providers with opaque IDs use ContentURLResolver instead.
func DeterministicContentURL(provider, _ string, username, instanceURL, externalID string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	username = strings.TrimPrefix(strings.TrimSpace(username), "@")
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return ""
	}
	if IsSafeContentURL(externalID) {
		return externalID
	}

	switch provider {
	case "x":
		return xContentURL(externalID)
	case "mastodon":
		return mastodonContentURL(username, instanceURL, externalID)
	case "bluesky":
		return blueskyContentURL(externalID)
	case "linkedin":
		return linkedinContentURL(externalID)
	case "tiktok":
		return tiktokContentURL(username, externalID)
	case "youtube":
		return youtubeContentURL(externalID)
	}
	return ""
}

func xContentURL(externalID string) string {
	if !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://x.com/i/web/status/" + externalID
}

func mastodonContentURL(username, instanceURL, externalID string) string {
	base, err := url.Parse(strings.TrimSpace(instanceURL))
	if err != nil || base.Scheme != "https" || base.Host == "" || username == "" ||
		!safeContentID.MatchString(externalID) {
		return ""
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/@" + username + "/" + externalID
	base.RawQuery = ""
	base.Fragment = ""
	return base.String()
}

func blueskyContentURL(externalID string) string {
	uri := blueskyPublishedURI(externalID)
	if uri == "" {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(uri, "at://"), "/")
	if len(parts) != 3 || parts[1] != "app.bsky.feed.post" ||
		!safeContentID.MatchString(parts[0]) || !safeContentID.MatchString(parts[2]) {
		return ""
	}
	return "https://bsky.app/profile/" + parts[0] + "/post/" + parts[2]
}

func linkedinContentURL(externalID string) string {
	if !strings.HasPrefix(externalID, "urn:li:") || !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://www.linkedin.com/feed/update/" + externalID
}

func tiktokContentURL(username, externalID string) string {
	if username == "" || !numericContent.MatchString(externalID) {
		return ""
	}
	return "https://www.tiktok.com/@" + username + "/video/" + externalID
}

func youtubeContentURL(externalID string) string {
	if !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://www.youtube.com/watch?v=" + url.QueryEscape(externalID)
}

func IsSafeContentURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}

func blueskyPublishedURI(externalID string) string {
	if strings.HasPrefix(externalID, "at://") {
		return externalID
	}
	var payload struct {
		URI string `json:"uri"`
	}
	if json.Unmarshal([]byte(externalID), &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.URI)
}
