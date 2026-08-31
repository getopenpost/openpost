package platform

import (
	"net/url"
	"strings"
)

// CanonicalSocialAccountContentID scopes federated provider identifiers to the
// server that issued them. It also extracts Bluesky's stable record URI from
// the publishing receipt without retaining the receipt payload.
func CanonicalSocialAccountContentID(provider, serverURL, accountID, externalID string) (string, bool) {
	base, ok := canonicalProviderServerURL(serverURL)
	if !ok {
		return "", false
	}
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerMastodon:
		statusID := strings.TrimSpace(externalID)
		if statusID == "" || strings.ContainsAny(statusID, "/?#") {
			return "", false
		}
		return base + "/api/v1/statuses/" + url.PathEscape(statusID), true
	case providerBluesky:
		uri := blueskyPublishedURI(externalID)
		repo, collection, recordKey, ok := parseBlueskyPostURI(uri)
		if !ok || (strings.TrimSpace(accountID) != "" && repo != strings.TrimSpace(accountID)) {
			return "", false
		}
		params := url.Values{"collection": {collection}, "repo": {repo}, "rkey": {recordKey}}
		return base + "/xrpc/com.atproto.repo.getRecord?" + params.Encode(), true
	default:
		identity := strings.TrimSpace(externalID)
		return identity, identity != ""
	}
}

func canonicalProviderServerURL(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	return strings.TrimRight(parsed.String(), "/"), true
}

func parseBlueskyPostURI(raw string) (repo, collection, recordKey string, ok bool) {
	if !strings.HasPrefix(raw, "at://") {
		return "", "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(raw, "at://"), "/")
	if len(parts) != 3 || !strings.HasPrefix(parts[0], "did:") || parts[1] != "app.bsky.feed.post" ||
		!safeContentID.MatchString(parts[0]) || !safeContentID.MatchString(parts[2]) {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}
