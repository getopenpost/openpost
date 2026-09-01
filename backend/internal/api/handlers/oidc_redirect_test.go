package handlers

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLegalAcceptanceURLPreservesSafeOIDCReturnPath(t *testing.T) {
	t.Parallel()

	redirect := legalAcceptanceURL(
		"https://app.openpo.st/",
		"/onboarding?plan=founder&billing_period=annual&source=signup",
	)
	parsed, err := url.Parse(redirect)
	require.NoError(t, err)
	require.Equal(t, "https://app.openpo.st/legal-acceptance", parsed.Scheme+"://"+parsed.Host+parsed.Path)
	require.Equal(t, "/onboarding?plan=founder&billing_period=annual&source=signup", parsed.Query().Get("redirect"))
}

func TestLegalAcceptanceURLRejectsCrossOriginOIDCReturnPath(t *testing.T) {
	t.Parallel()

	redirect := legalAcceptanceURL("https://app.openpo.st", "https://attacker.example/checkout")
	parsed, err := url.Parse(redirect)
	require.NoError(t, err)
	require.Equal(t, "/", parsed.Query().Get("redirect"))
}
