package providerlimits

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const InstagramMaxCollaborators = 3

// InstagramAltTextMaxCharacters is the alt_text maximum Meta documents for
// image containers. Verified 2026-10-31 against Meta's IG User Media
// reference ("Alternative text, up to 1000 character, for an image. Only
// supported on a single image or image media in a carousel. Reels and
// stories are not supported."):
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
const InstagramAltTextMaxCharacters = 1000

// ValidateInstagramAltText checks alt text projected onto an Instagram
// image container. It counts code points, matching the capability
// catalogue's Instagram text counter.
func ValidateInstagramAltText(altText string) error {
	if utf8.RuneCountInString(altText) > InstagramAltTextMaxCharacters {
		return fmt.Errorf("instagram alt text is limited to %d characters", InstagramAltTextMaxCharacters)
	}
	return nil
}

const (
	InstagramTrialReelProfileRequired      = "instagram_trial_reel_profile_required"
	InstagramTrialReelCollaboratorConflict = "instagram_trial_reel_collaborators_conflict"
	InstagramCollaboratorLimitExceeded     = "instagram_collaborator_limit_exceeded"
)

type InstagramSettingsViolation struct {
	Code    string
	Message string
	Field   string
}

// InstagramLoginSettingUnavailable describes direct-login restrictions shared
// by capability admission and delivery. Shopping tags are unavailable, and
// OpenPost's location picker requires Facebook Page search permissions.
// Verified 2026-10-17 against Meta's Content Publishing guide:
// https://developers.facebook.com/documentation/instagram-platform/content-publishing
func InstagramLoginSettingUnavailable(key string) bool {
	switch key {
	case "location_id", "product_tags":
		return true
	default:
		return false
	}
}

func InstagramCollaborators(raw string) []string {
	values := strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' })
	clean := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			clean = append(clean, value)
		}
	}
	return clean
}

func InstagramOmitsCollaborators(profile string) bool {
	return profile == "story"
}

func ValidateInstagramSettings(profile string, trialReel bool, collaborators []string) []InstagramSettingsViolation {
	violations := []InstagramSettingsViolation{}
	if !InstagramOmitsCollaborators(profile) && len(collaborators) > InstagramMaxCollaborators {
		violations = append(violations, InstagramSettingsViolation{
			Code:    InstagramCollaboratorLimitExceeded,
			Message: "Instagram supports at most 3 collaborators.",
			Field:   "collaborators",
		})
	}
	if !trialReel {
		return violations
	}
	if profile != "short_video" {
		return append(violations, InstagramSettingsViolation{
			Code:    InstagramTrialReelProfileRequired,
			Message: "Instagram Trial Reels require the Reel format.",
			Field:   "is_trial_reel",
		})
	}
	if len(collaborators) > 0 {
		return append(violations, InstagramSettingsViolation{
			Code:    InstagramTrialReelCollaboratorConflict,
			Message: "Instagram Trial Reels cannot include collaborators.",
			Field:   "collaborators",
		})
	}
	return violations
}
