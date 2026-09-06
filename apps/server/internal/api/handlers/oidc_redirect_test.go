package handlers

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLegalAcceptanceURLGuardsOIDCReturnPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		base         string
		returnPath   string
		wantPage     string
		wantRedirect string
	}{
		{
			name:         "safe relative return is preserved",
			base:         "https://app.openpo.st/",
			returnPath:   "/onboarding?plan=founder&billing_period=annual&source=signup",
			wantPage:     "https://app.openpo.st/legal-acceptance",
			wantRedirect: "/onboarding?plan=founder&billing_period=annual&source=signup",
		},
		{
			name:         "cross-origin return falls back to root",
			base:         "https://app.openpo.st",
			returnPath:   "https://attacker.example/checkout",
			wantPage:     "https://app.openpo.st/legal-acceptance",
			wantRedirect: "/",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			redirect := legalAcceptanceURL(test.base, test.returnPath)
			parsed, err := url.Parse(redirect)
			require.NoError(t, err)
			require.Equal(t, test.wantPage, parsed.Scheme+"://"+parsed.Host+parsed.Path)
			require.Equal(t, test.wantRedirect, parsed.Query().Get("redirect"))
		})
	}
}
