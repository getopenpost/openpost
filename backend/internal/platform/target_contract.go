package platform

import (
	"errors"
	"strings"
	"unicode"
)

type TargetContract struct {
	Provider       string
	BaseKey        string
	Subdestination string
	Example        string
}

func PublishingTargetContract(provider string) TargetContract {
	provider = strings.ToLower(strings.TrimSpace(provider))
	switch provider {
	case providerPinterest:
		return TargetContract{Provider: provider, BaseKey: provider, Subdestination: "board", Example: "pinterest:board:<board_id>"}
	case providerTelegram:
		return TargetContract{Provider: provider, BaseKey: provider, Subdestination: "chat", Example: "telegram:chat:<chat_id>"}
	case providerDiscord:
		return TargetContract{Provider: provider, BaseKey: provider, Subdestination: "channel", Example: "discord:channel:<channel_id>"}
	default:
		return TargetContract{Provider: provider, BaseKey: provider}
	}
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
