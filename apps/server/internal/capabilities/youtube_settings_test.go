package capabilities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestYouTubePublishTimeReadiness(t *testing.T) {
	for _, scenario := range []struct {
		name, privacy, publishAt string
		wantCode                 string
	}{
		{"private scheduled video", "private", "2030-10-12T20:00:00+08:00", ""},
		{"private unscheduled video", "private", "", ""},
		{"past time follows YouTube behavior", "private", "2020-10-12T12:00:00Z", ""},
		{"invalid time", "private", "tomorrow", "setting_datetime_invalid"},
		{"missing timezone", "private", "2030-10-12T20:00:00", "setting_datetime_invalid"},
		{"public schedule", "public", "2030-10-12T12:00:00Z", "setting_dependency"},
		{"unlisted schedule", "unlisted", "2030-10-12T12:00:00Z", "setting_dependency"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			resolved := Resolve(ProviderYouTube, ResolveInput{
				RequestedOutputProfile: "youtube.video",
				Segments: []ResolveSegment{{ID: "source", Title: "Launch", Media: []MediaItem{{
					ID: "video", MimeType: "video/mp4", Size: 1024, Width: 1920, Height: 1080, DurationMS: 300_000, AnalysisStatus: "ready",
				}}}},
				Settings: map[string]any{"privacy": scenario.privacy, "category_id": "22", "publish_at": scenario.publishAt},
			})
			if scenario.wantCode == "" {
				require.True(t, resolved.Compatible, "%+v", resolved.Issues)
			} else {
				require.False(t, resolved.Compatible)
				requireIssueForField(t, resolved.Issues, scenario.wantCode, "publish_at")
			}
		})
	}
}

func TestYouTubePublishTimeCannotBecomeSocialSetDefault(t *testing.T) {
	resolved := Resolve(ProviderYouTube, ResolveInput{
		RequestedOutputProfile: "youtube.video", Context: ResolveContextSocialSetDefaults,
	})
	for _, field := range resolved.Settings {
		require.NotEqual(t, "publish_at", field.Key, "absolute publish times belong to individual posts")
	}
	values := map[string]any{"privacy": "private", "publish_at": "2030-10-12T12:00:00Z"}
	issues := ValidateDefaultSettings(resolved.Capability, SettingScopeDestination, values, values)
	requireIssueForField(t, issues, "unsupported_setting", "publish_at")
}
