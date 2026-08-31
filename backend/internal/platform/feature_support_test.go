package platform

import "testing"

func TestSupportsAnalyticsParity(t *testing.T) {
	tests := []struct {
		platform string
		capState string
		want     bool
	}{
		{"x", "", true},
		{"bluesky", "", true},
		{"mastodon", "", true},
		{"facebook", "", true},
		{"instagram", "", true},
		{"threads", "", true},
		{"youtube", "", true},
		{"tiktok", "", true},
		{"linkedin", "", true},
		{"linkedin", `{"linkedin_account_type":"community_management"}`, false},
		{"discord", "", false},
		{"discord", `{"connection_type":"webhook"}`, false},
		{"discord", `{"connection_type":"bot"}`, true},
		{"unknown", "", false},
	}
	for _, tc := range tests {
		if got := SupportsAnalytics(tc.platform, tc.capState); got != tc.want {
			t.Errorf("SupportsAnalytics(%q,%q)=%v want %v", tc.platform, tc.capState, got, tc.want)
		}
	}
}

func TestSupportsAnalyticsLinkedInCommunityManagementParsing(t *testing.T) {
	tests := []struct {
		name     string
		capState string
		want     bool
	}{
		{"exact match", `{"linkedin_account_type":"community_management"}`, false},
		{"person type", `{"linkedin_account_type":"person"}`, true},
		{"organization type", `{"linkedin_account_type":"organization"}`, true},
		{"unrelated key with community_management value", `{"other_key":"community_management"}`, true},
		{"unrelated string containing substring", `{"note":"not_community_management_related"}`, true},
		{"similar value with suffix", `{"linkedin_account_type":"community_management_extra"}`, true},
		{"similar value with prefix", `{"linkedin_account_type":"xcommunity_management"}`, true},
		{"extra fields alongside exact match", `{"linkedin_account_type":"community_management","extra":"foo"}`, false},
		{"malformed JSON fail-safe", `not-json`, true},
		{"malformed JSON with substring fail-safe", `{"linkedin_account_type":"community_management"`, true},
		{"empty object", `{}`, true},
		{"null JSON", `null`, true},
		{"whitespace around JSON", `  {"linkedin_account_type":"community_management"}  `, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := SupportsAnalytics("linkedin", tc.capState)
			if got != tc.want {
				t.Errorf("SupportsAnalytics(linkedin,%q)=%v want %v", tc.capState, got, tc.want)
			}
		})
	}
}

func TestSupportsEngagementParity(t *testing.T) {
	enabled := map[string]bool{
		"facebook": true, "instagram": true, "linkedin": true, "threads": true,
		"mastodon": true, "bluesky": true, "x": true, "youtube": true,
	}
	for _, p := range []string{"facebook", "instagram", "linkedin", "threads", "mastodon", "bluesky", "x", "youtube", "discord", "tiktok"} {
		got := SupportsEngagement(p)
		want := enabled[p]
		if got != want {
			t.Errorf("SupportsEngagement(%q)=%v want %v", p, got, want)
		}
	}
}

func TestSupportsGrowParity(t *testing.T) {
	if !SupportsGrow("bluesky") || !SupportsGrow("mastodon") {
		t.Error("grow should support bluesky and mastodon")
	}
	if SupportsGrow("x") || SupportsGrow("discord") {
		t.Error("grow should not support x or discord")
	}
}
