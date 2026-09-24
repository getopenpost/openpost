package platform

import (
	"errors"
	"strings"
	"unicode"
)

// ResolveTargetKey derives provider subdestination identity from typed
// rendition settings and rejects an explicit key that disagrees with them.
func ResolveTargetKey(provider, base, requested string, settings map[string]interface{}) (string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	base = strings.TrimSpace(base)
	requested = strings.TrimSpace(requested)
	derived, mismatch := derivedTargetKey(provider, base, settings)
	if derived != "" {
		if requested == "" || requested == base {
			requested = derived
		} else if requested != derived {
			return "", errors.New(mismatch)
		}
	}
	if requested == "" {
		requested = base
	}
	if err := ValidateTargetKey(provider, base, requested); err != nil {
		return "", err
	}
	return requested, nil
}

func derivedTargetKey(provider, base string, settings map[string]interface{}) (string, string) {
	switch provider {
	case providerPinterest:
		if boardID := settingString(settings, "board_id"); boardID != "" {
			return base + ":board:" + boardID, "target_key does not match the selected Pinterest board"
		}
	case providerPeerTube:
		if channel := settingString(settings, "channel"); channel != "" {
			return base + ":channel:" + channel, "target_key does not match the selected PeerTube channel"
		}
	case providerLemmy, providerPieFed:
		if name, host, ok := ParseCommunityRef(settingString(settings, CommunitySettingCommunity)); ok && host != "" {
			return CommunityTargetKey(provider, host, name), "target_key does not match the selected community"
		}
	}
	return "", ""
}

// ValidateTargetKey preserves legacy account-owned target suffixes while
// rejecting provider-crossing, oversized, or malformed keys.
func ValidateTargetKey(provider, base, target string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	base = strings.TrimSpace(base)
	target = strings.TrimSpace(target)
	if provider == "" || (base != provider && !strings.HasPrefix(base, provider+":")) {
		return errors.New("target_key base must belong to the selected social account provider")
	}
	if len(target) > 255 {
		return errors.New("target_key must be at most 255 bytes")
	}
	for _, char := range target {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return errors.New("target_key cannot contain whitespace or control characters")
		}
	}
	if target == base {
		return nil
	}
	if !strings.HasPrefix(target, base+":") {
		return errors.New("target_key must belong to the selected social account provider")
	}
	return nil
}
