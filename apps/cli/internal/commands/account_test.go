package commands

import (
	"strings"
	"testing"
)

func TestAccountSettingsURL(t *testing.T) {
	tests := []struct {
		name     string
		instance string
		want     string
	}{
		{
			name:     "empty instance",
			instance: "",
			want:     "",
		},
		{
			name:     "no scheme",
			instance: "op.example.com",
			want:     "",
		},
		{
			name:     "unparseable",
			instance: "ht!tp://broken",
			want:     "",
		},
		{
			name:     "https with trailing slash",
			instance: "https://op.example.com/",
			want:     "https://op.example.com/settings?tab=accounts",
		},
		{
			name:     "https with subpath",
			instance: "https://op.example.com/op/",
			want:     "https://op.example.com/op/settings?tab=accounts",
		},
		{
			name:     "drops query and fragment",
			instance: "https://op.example.com?x=1#y",
			want:     "https://op.example.com/settings?tab=accounts",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := accountSettingsURL(tt.instance)
			if got != tt.want {
				t.Fatalf("accountSettingsURL(%q) = %q, want %q", tt.instance, got, tt.want)
			}
		})
	}
}

func TestEmptyAccountsMessage(t *testing.T) {
	const url = "https://op.example.com/settings?tab=accounts"
	tests := []struct {
		name     string
		platform string
		instance string
		wantHas  []string // substrings the message must contain
		wantNot  []string // substrings it must not contain
	}{
		{
			name:     "no platform, instance given, points at account settings",
			platform: "",
			instance: "https://op.example.com",
			wantHas:  []string{"No accounts are connected", url, "web UI"},
		},
		{
			name:     "platform filter, no instance, generic message",
			platform: "bluesky",
			instance: "",
			wantHas:  []string{"No bluesky accounts are connected", "web UI"},
			wantNot:  []string{"http://", "https://"},
		},
		{
			name:     "no platform, no instance, generic message",
			platform: "",
			instance: "",
			wantHas:  []string{"No accounts are connected", "web UI"},
		},
		{
			name:     "garbage instance falls back to generic",
			platform: "",
			instance: "op.example.com",
			wantHas:  []string{"No accounts are connected", "web UI"},
			wantNot:  []string{"op.example.com/settings"}, // would be a malformed URL
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := emptyAccountsMessage(tt.platform, tt.instance)
			for _, want := range tt.wantHas {
				if !strings.Contains(got, want) {
					t.Errorf("emptyAccountsMessage(%q, %q) = %q; missing %q", tt.platform, tt.instance, got, want)
				}
			}
			for _, banned := range tt.wantNot {
				if strings.Contains(got, banned) {
					t.Errorf("emptyAccountsMessage(%q, %q) = %q; must not contain %q", tt.platform, tt.instance, got, banned)
				}
			}
		})
	}
}
