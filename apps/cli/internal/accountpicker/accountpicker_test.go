package accountpicker

import (
	"strings"
	"testing"

	"github.com/openpost/cli/internal/api"
)

func TestResolve(t *testing.T) {
	accounts := []api.SocialAccount{
		{
			ID:              "acct-x-1",
			Platform:        "x",
			AccountUsername: "alice",
			IsActive:        true,
		},
		{
			ID:              "acct-linkedin-1",
			Platform:        "linkedin",
			AccountUsername: "alice",
			IsActive:        true,
		},
		{
			ID:              "acct-x-2",
			Platform:        "x",
			AccountUsername: "bob",
			IsActive:        true,
		},
	}

	tests := []struct {
		name        string
		selectors   []string
		accounts    []api.SocialAccount
		want        []string
		wantErr     bool
		errContains []string
	}{
		{
			name:      "empty input returns nil",
			selectors: nil,
			accounts:  accounts,
			want:      nil,
		},
		{
			name:      "single token returns matching account",
			selectors: []string{"acct-linkedin-1"},
			accounts:  accounts,
			want:      []string{"acct-linkedin-1"},
		},
		{
			name:      "slug match returns account directly",
			selectors: []string{"mastodon-masto"},
			accounts: []api.SocialAccount{{
				ID:              "acct-m-1",
				Slug:            "mastodon-masto",
				Platform:        "mastodon",
				AccountUsername: "alice",
				IsActive:        true,
			}},
			want: []string{"acct-m-1"},
		},
		{
			name:      "slug match beats bare platform match",
			selectors: []string{"x"},
			accounts: []api.SocialAccount{
				{
					ID:              "acct-x-1",
					Slug:            "x",
					Platform:        "x",
					AccountUsername: "alice",
					IsActive:        true,
				},
				{
					ID:              "acct-x-2",
					Platform:        "x",
					AccountUsername: "bob",
					IsActive:        true,
				},
			},
			want: []string{"acct-x-1"},
		},
		{
			name:      "slug match beats platform username form",
			selectors: []string{"x:bob"},
			accounts: []api.SocialAccount{
				{
					ID:              "acct-x-1",
					Slug:            "x:bob",
					Platform:        "x",
					AccountUsername: "alice",
					IsActive:        true,
				},
				{
					ID:              "acct-x-2",
					Platform:        "x",
					AccountUsername: "bob",
					IsActive:        true,
				},
			},
			want: []string{"acct-x-1"},
		},
		{
			name:      "platform alias returns account when there is one",
			selectors: []string{"x"},
			accounts: []api.SocialAccount{{
				ID:              "acct-x-1",
				Platform:        "x",
				AccountUsername: "alice",
				IsActive:        true,
			}},
			want: []string{"acct-x-1"},
		},
		{
			name:      "multiple matches includes disambiguation hint",
			selectors: []string{"x"},
			accounts:  accounts,
			wantErr:   true,
			errContains: []string{
				`multiple matches for "x"`,
				"Disambiguate with",
				"--accounts x:@alice",
				"--accounts x:@bob",
				"raw account id",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resolve("workspace-1", tt.selectors, tt.accounts)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				for _, part := range tt.errContains {
					if !strings.Contains(err.Error(), part) {
						t.Fatalf("error %q does not contain %q", err.Error(), part)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.want == nil && got != nil {
				t.Fatalf("got %v, want nil", got)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("got %v, want %v", got, tt.want)
				}
			}
		})
	}
}
