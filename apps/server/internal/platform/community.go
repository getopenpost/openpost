package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Community posting is one publishing experience shared by Lemmy, PieFed,
// and future community software. A community is a destination, not a post
// type: one rendition pairs one connected account with one concrete
// community and carries its own title, body, validation, published URL, and
// delivery result.
//
// Identity rules:
//   - Authenticate against the account's home server, resolve the selected
//     community through that server, and publish through that server's API.
//   - The canonical identity is the community's actor ID (its ap_id URL).
//     The API-specific numeric identifier is resolved per publish and never
//     used as the global identity.
//   - The same community viewed through different servers stays one
//     destination; two communities with the same name on different origins
//     stay different destinations.
type CommunityIdentity struct {
	// ActorID is the canonical community actor URL (ap_id).
	ActorID string
	// Host is the community's origin host, derived from the actor ID.
	Host string
	// Name is the community short name.
	Name string
	// Title is the human-readable community title.
	Title string
	// Description carries the community sidebar/description shown alongside
	// the editor so posting rules stay in the workflow.
	Description string
	// PostingRestrictedToMods marks communities where submission may fail
	// for ordinary members.
	PostingRestrictedToMods bool
	// NSFW marks communities flagged not-safe-for-work.
	NSFW bool
	// LocalID is the API-specific numeric identifier on the connected
	// instance. It is resolved per publish, never stored as identity.
	LocalID string
}

// CommunitySettingsKeys are the composer settings shared by every community
// adapter. Provider-specific requirements stay in the adapter.
const (
	CommunitySettingCommunity  = "community"
	CommunitySettingTitle      = "title"
	CommunitySettingBody       = "body"
	CommunitySettingURL        = "url"
	CommunitySettingNSFW       = "nsfw"
	CommunitySettingLanguageID = "language_id"
)

// ParseCommunityRef normalizes what a user typed or picked: a "!name@host"
// or "name@host" handle, or a community actor/page URL. It returns the short
// name and origin host.
func ParseCommunityRef(raw string) (name, host string, ok bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", "", false
	}
	trimmed = strings.TrimPrefix(trimmed, "!")
	if strings.Contains(trimmed, "://") {
		parsed, err := url.Parse(trimmed)
		if err != nil || parsed.Hostname() == "" {
			return "", "", false
		}
		name = communityNameFromPath(parsed.Path)
		if name == "" {
			return "", "", false
		}
		return name, strings.ToLower(parsed.Hostname()), true
	}
	trimmed = strings.TrimPrefix(trimmed, "m/")
	parts := strings.Split(trimmed, "@")
	if len(parts) == 2 && validCommunityName(parts[0]) && validCommunityHost(parts[1]) {
		return parts[0], strings.ToLower(parts[1]), true
	}
	if validCommunityName(trimmed) {
		return trimmed, "", true
	}
	return "", "", false
}

func communityNameFromPath(path string) string {
	segments := []string{}
	for _, segment := range strings.Split(path, "/") {
		if trimmed := strings.TrimSpace(segment); trimmed != "" {
			segments = append(segments, trimmed)
		}
	}
	if len(segments) == 0 {
		return ""
	}
	// Community pages look like /c/name or /m/name; the actor ID may also
	// point deeper, in which case the last meaningful segment still names it.
	candidate := segments[len(segments)-1]
	if !validCommunityName(candidate) {
		return ""
	}
	return candidate
}

func validCommunityName(name string) bool {
	if name == "" || len(name) > 100 {
		return false
	}
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func validCommunityHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" || len(host) > 253 || strings.Contains(host, " ") || strings.Contains(host, "/") {
		return false
	}
	return strings.Contains(host, ".") || host == "localhost"
}

// CommunityTargetKey builds the stable destination key from the canonical
// community identity: "<provider>:community:<host>:<name>".
func CommunityTargetKey(provider, host, name string) string {
	return strings.ToLower(strings.TrimSpace(provider)) + ":community:" +
		strings.ToLower(strings.TrimSpace(host)) + ":" + strings.TrimSpace(name)
}

// ParseCommunityTargetKey splits a community destination key back into its
// provider, host, and name.
func ParseCommunityTargetKey(target string) (provider, host, name string, ok bool) {
	parts := strings.Split(strings.TrimSpace(target), ":")
	if len(parts) != 4 || parts[1] != "community" || parts[0] == "" || parts[2] == "" || parts[3] == "" {
		return "", "", "", false
	}
	return parts[0], parts[2], parts[3], true
}

// CommunityDisplayRef renders the canonical "!name@host" handle.
func CommunityDisplayRef(name, host string) string {
	if host == "" {
		return "!" + name
	}
	return "!" + name + "@" + host
}

// ValidateCommunityPost enforces the shared community contract: a concrete
// community and an independently authored title. Provider adapters add their
// own representation rules on top.
func ValidateCommunityPost(provider, communityRef, title string) error {
	if strings.TrimSpace(communityRef) == "" {
		return fmt.Errorf("%s posts require a community: search, paste a community address, or choose a saved destination", provider)
	}
	_, host, ok := ParseCommunityRef(communityRef)
	if !ok || (host == "" && strings.Contains(communityRef, "@")) {
		return fmt.Errorf("%s community %q is not a valid community address (use !name@host or paste the community URL)", provider, communityRef)
	}
	if strings.TrimSpace(title) == "" {
		return fmt.Errorf("%s posts require a title written for that community", provider)
	}
	return nil
}

// communityTitle resolves the post title from the rendition title first,
// then the explicit per-destination setting.
func communityTitle(title string, settings map[string]interface{}) string {
	if trimmed := strings.TrimSpace(title); trimmed != "" {
		return trimmed
	}
	return settingString(settings, CommunitySettingTitle)
}

// communityBody resolves discussion text from the rendition content first,
// then the explicit per-destination setting.
func communityBody(content string, settings map[string]interface{}) string {
	if trimmed := strings.TrimSpace(content); trimmed != "" {
		return trimmed
	}
	return settingString(settings, CommunitySettingBody)
}

func communityAuthHeaders(token string) map[string]string {
	if strings.TrimSpace(token) == "" {
		return map[string]string{}
	}
	return map[string]string{headerAuthorization: bearerPrefix + token}
}

func communityJSONGet[T any](ctx context.Context, instanceURL, path string, query url.Values, token, label string) (T, error) {
	var zero T
	endpoint := strings.TrimRight(instanceURL, "/") + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, communityAuthHeaders(token))
	if err != nil {
		return zero, fmt.Errorf("%s: %w", label, err)
	}
	var result T
	if err := json.Unmarshal(body, &result); err != nil {
		return zero, fmt.Errorf("decoding %s: %w", label, err)
	}
	return result, nil
}

func communityJSONPost[T any](ctx context.Context, instanceURL, path string, payload any, token, label string) (T, error) {
	var zero T
	data, err := json.Marshal(payload)
	if err != nil {
		return zero, fmt.Errorf("encoding %s: %w", label, err)
	}
	headers := communityAuthHeaders(token)
	headers[headerContentType] = contentTypeJSON
	body, err := DoRequest(ctx, http.MethodPost, strings.TrimRight(instanceURL, "/")+path, bytes.NewReader(data), headers)
	if err != nil {
		return zero, fmt.Errorf("%s: %w", label, err)
	}
	var result T
	if err := json.Unmarshal(body, &result); err != nil {
		return zero, fmt.Errorf("decoding %s: %w", label, err)
	}
	return result, nil
}

type communityResolveResponse[T any] struct {
	Community *T `json:"community"`
}

func resolveCommunity[T any](ctx context.Context, provider, instanceURL, path, token, ref, label string, identity func(T) CommunityIdentity) (CommunityIdentity, error) {
	queryAddress, err := communityResolveQuery(provider, ref)
	if err != nil {
		return CommunityIdentity{}, err
	}
	resolved, err := communityJSONGet[communityResolveResponse[T]](
		ctx, instanceURL, path, url.Values{"q": {queryAddress}}, token, label,
	)
	if err != nil {
		return CommunityIdentity{}, err
	}
	if resolved.Community == nil {
		return CommunityIdentity{}, fmt.Errorf("%s community %q was not found on this instance", provider, ref)
	}
	return identity(*resolved.Community), nil
}

func communityResolveQuery(provider, ref string) (string, error) {
	name, host, ok := ParseCommunityRef(ref)
	if !ok {
		return "", fmt.Errorf("%s community %q is not a valid community address", provider, ref)
	}
	if host != "" {
		return CommunityDisplayRef(name, host), nil
	}
	if !strings.Contains(ref, "://") {
		return "!" + name, nil
	}
	return ref, nil
}

func firstCommunityMediaURL(req *PublishRequest) string {
	if req == nil {
		return ""
	}
	for _, id := range req.PlatformMediaIDs {
		if trimmed := strings.TrimSpace(id); strings.HasPrefix(trimmed, "http") {
			return trimmed
		}
	}
	return ""
}

func communityCommentRef(provider string, postID int64, commentID string) string {
	return provider + ":" + strconv.FormatInt(postID, 10) + ":" + commentID
}

func replyToCommunityComment[T any](ctx context.Context, provider, instanceURL, path, contentField, token, commentID, message, label string, extractID func(T) int64) (string, error) {
	postID, parentID, err := splitCommunityCommentRef(provider, commentID)
	if err != nil {
		return "", err
	}
	response, err := communityJSONPost[T](ctx, instanceURL, path, map[string]any{
		contentField: strings.TrimSpace(message),
		"post_id":    postID,
		"parent_id":  parentID,
	}, token, label)
	if err != nil {
		return "", err
	}
	return communityCommentRef(provider, postID, strconv.FormatInt(extractID(response), 10)), nil
}

func splitCommunityCommentRef(provider, ref string) (int64, int64, error) {
	parts := strings.Split(strings.TrimSpace(ref), ":")
	if len(parts) != 3 || parts[0] != provider {
		return 0, 0, fmt.Errorf("%s reply reference is invalid", provider)
	}
	postID, postErr := strconv.ParseInt(parts[1], 10, 64)
	commentID, commentErr := strconv.ParseInt(parts[2], 10, 64)
	if postErr != nil || commentErr != nil || postID <= 0 || commentID <= 0 {
		return 0, 0, fmt.Errorf("%s reply reference is invalid", provider)
	}
	return postID, commentID, nil
}
