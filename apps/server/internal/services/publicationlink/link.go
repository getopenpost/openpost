// Package publicationlink resolves an account's authored URL choice for delivery.
package publicationlink

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"strings"

	"github.com/openpost/backend/internal/platform"
)

const SettingsKey = "link"

type Mode string

const (
	ModePost   Mode = "post"
	ModeCustom Mode = "custom"
	ModeLegacy Mode = "legacy"
)

type Destination struct {
	Mode Mode   `json:"mode"`
	URL  string `json:"url,omitempty"`
}
type Draft struct {
	Destinations map[string]Destination `json:"destinations"`
}

func Decode(source map[string]any) (*Draft, error) {
	value := source[SettingsKey]
	if value == nil {
		return nil, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("invalid link settings: %w", err)
	}
	var draft Draft
	if err := json.Unmarshal(data, &draft); err != nil {
		return nil, fmt.Errorf("invalid link settings: %w", err)
	}
	return &draft, nil
}

// Resolve leaves old destination settings alone until an explicit URL choice adopts them.
func Resolve(source map[string]any, accountID, provider, body string, settings map[string]any, mediaCount int) (map[string]any, error) {
	draft, err := Decode(source)
	if err != nil || draft == nil {
		return settings, err
	}
	choice, found := draft.Destinations[accountID]
	if !found {
		choice.Mode = ModePost
	}
	if choice.Mode == ModeLegacy {
		return settings, nil
	}
	values := maps.Clone(settings)
	if values == nil {
		values = map[string]any{}
	}
	values["url"] = ""
	values["link_url"] = ""
	targetURL, err := choiceURL(choice, body)
	if err != nil {
		return values, err
	}
	key, targetURL, err := nativeURL(provider, choice.Mode, targetURL, values, mediaCount)
	if key != "" {
		values[key] = targetURL
	}
	return values, err
}

func choiceURL(choice Destination, body string) (string, error) {
	switch choice.Mode {
	case ModePost:
		return platform.DetectFirstURL(body), nil
	case ModeCustom:
		targetURL := strings.TrimSpace(choice.URL)
		parsed, err := url.Parse(targetURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			return "", fmt.Errorf("enter a valid HTTP or HTTPS link URL")
		}
		return targetURL, nil
	default:
		return "", fmt.Errorf("choose a link URL for this account")
	}
}

func nativeURL(provider string, mode Mode, targetURL string, values map[string]any, mediaCount int) (string, string, error) {
	if targetURL == "" {
		return "", "", nil
	}
	provider = strings.ToLower(strings.SplitN(provider, ":", 2)[0])
	if mediaCount > 0 {
		if provider == "bluesky" && mode == ModeCustom {
			return "", "", fmt.Errorf("bluesky link cards cannot be combined with media")
		}
		return "", "", nil
	}
	switch provider {
	case "bluesky":
		if quote, _ := values["quote_url"].(string); quote != "" {
			if mode == ModeCustom {
				return "", "", fmt.Errorf("bluesky link cards cannot be combined with a quote")
			}
			return "", "", nil
		}
		return "link_url", targetURL, nil
	case "linkedin", "facebook", "threads", "x", "mastodon", "pixelfed", "lemmy", "piefed":
		// Polls keep URLs in text without implying a second native card.
		if options, _ := values["poll_options"].(string); mode == ModePost && options != "" {
			return "", "", nil
		}
		return "url", targetURL, nil
	default:
		return "", "", nil
	}
}

// ResolveEffective checks provider rules against merged settings while storing only
// segment-owned projections. Destination settings keep their original owner.
func ResolveEffective(source map[string]any, accountID, provider, body string, destination, segment map[string]any, mediaCount int) (map[string]any, error) {
	effective := maps.Clone(destination)
	if effective == nil {
		effective = map[string]any{}
	}
	maps.Copy(effective, segment)
	resolved, err := Resolve(source, accountID, provider, body, effective, mediaCount)
	draft, decodeErr := Decode(source)
	if decodeErr != nil || draft == nil || draft.Destinations[accountID].Mode == ModeLegacy {
		return segment, err
	}
	values := maps.Clone(segment)
	if values == nil {
		values = map[string]any{}
	}
	values["url"] = resolved["url"]
	values["link_url"] = resolved["link_url"]
	return values, err
}

// Generated URL values are projections; the canonical choice owns their authorship.
func AuthoredDestinationSettings(source map[string]any, accountID string, settings map[string]any) map[string]any {
	draft, err := Decode(source)
	if err != nil || draft == nil || draft.Destinations[accountID].Mode == ModeLegacy {
		return settings
	}
	values := maps.Clone(settings)
	delete(values, "url")
	delete(values, "link_url")
	return values
}
