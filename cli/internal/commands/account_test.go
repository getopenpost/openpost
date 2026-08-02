package commands

import (
	"strings"
	"testing"

	"github.com/openpost/cli/internal/api"
)

func TestAccountsWebURL(t *testing.T) {
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
			name:     "whitespace instance",
			instance: "   ",
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
			want:     "https://op.example.com/accounts",
		},
		{
			name:     "https with subpath",
			instance: "https://op.example.com/op/",
			want:     "https://op.example.com/op/accounts",
		},
		{
			name:     "http local",
			instance: "http://localhost:8080",
			want:     "http://localhost:8080/accounts",
		},
		{
			name:     "drops query and fragment",
			instance: "https://op.example.com?x=1#y",
			want:     "https://op.example.com/accounts",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := accountsWebURL(tt.instance)
			if got != tt.want {
				t.Fatalf("accountsWebURL(%q) = %q, want %q", tt.instance, got, tt.want)
			}
		})
	}
}

func TestEmptyAccountsMessage(t *testing.T) {
	const url = "https://op.example.com/accounts"
	tests := []struct {
		name     string
		platform string
		instance string
		wantHas  []string // substrings the message must contain
		wantNot  []string // substrings it must not contain
	}{
		{
			name:     "no platform, instance given, points at /accounts",
			platform: "",
			instance: "https://op.example.com",
			wantHas:  []string{"No accounts are connected", url, "web UI"},
		},
		{
			name:     "platform filter, instance given",
			platform: "mastodon",
			instance: "https://op.example.com/",
			wantHas:  []string{"No mastodon accounts are connected", url},
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
			wantNot:  []string{"op.example.com/accounts"}, // would be a malformed URL
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

func TestFilterAccountsByPlatform(t *testing.T) {
	accounts := []api.SocialAccount{
		{ID: "a1", Platform: "x"},
		{ID: "a2", Platform: "mastodon"},
		{ID: "a3", Platform: "bluesky"},
		{ID: "a4", Platform: "x"},
	}

	t.Run("filters to a single platform", func(t *testing.T) {
		got := filterAccountsByPlatform(accounts, "x")
		if len(got) != 2 || got[0].ID != "a1" || got[1].ID != "a4" {
			t.Fatalf("filterAccountsByPlatform(_, x) = %v, want [a1 a4]", got)
		}
	})

	t.Run("returns empty slice when nothing matches", func(t *testing.T) {
		got := filterAccountsByPlatform(accounts, "linkedin")
		if len(got) != 0 {
			t.Fatalf("filterAccountsByPlatform(_, linkedin) = %v, want []", got)
		}
	})

	t.Run("returns empty slice on empty input", func(t *testing.T) {
		got := filterAccountsByPlatform(nil, "x")
		if len(got) != 0 {
			t.Fatalf("filterAccountsByPlatform(nil, x) = %v, want []", got)
		}
	})
}
