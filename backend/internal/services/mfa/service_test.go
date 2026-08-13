package mfa

import (
	"bytes"
	"crypto/subtle"
	"encoding/base32"
	"image/png"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGenerateTOTPProducesPortableAuthenticatorSetup(t *testing.T) {
	service, err := NewService("OpenPost", RelyingPartyConfig{
		Name:    "OpenPost",
		ID:      "example.com",
		Origins: []string{"https://example.com"},
	})
	require.NoError(t, err)

	key, qrCodePNG, err := service.GenerateTOTP("user@example.com")
	require.NoError(t, err)

	setupURL, err := url.Parse(key.URL())
	if err != nil {
		t.Fatal("authenticator setup URI must be parseable")
	}
	require.Equal(t, "otpauth", setupURL.Scheme)
	require.Equal(t, "totp", setupURL.Host)
	require.Equal(t, "/OpenPost:user@example.com", setupURL.Path)
	require.Equal(t, "OpenPost", setupURL.Query().Get("issuer"))
	require.Equal(t, "SHA1", setupURL.Query().Get("algorithm"))
	require.Equal(t, "6", setupURL.Query().Get("digits"))
	require.Equal(t, "30", setupURL.Query().Get("period"))

	manualEntryKey := key.Secret()
	if manualEntryKey == "" {
		t.Fatal("manual setup key must not be empty")
	}
	if subtle.ConstantTimeCompare(
		[]byte(manualEntryKey),
		[]byte(setupURL.Query().Get("secret")),
	) != 1 {
		t.Fatal("manual setup key must match the QR setup URI secret")
	}
	if strings.Contains(manualEntryKey, "=") || manualEntryKey != strings.ToUpper(manualEntryKey) {
		t.Fatal("manual setup key must use unpadded uppercase Base32")
	}
	decodedSecret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(manualEntryKey)
	require.NoError(t, err)
	require.Len(t, decodedSecret, 20)

	qrCode, err := png.Decode(bytes.NewReader(qrCodePNG))
	require.NoError(t, err)
	require.Equal(t, 240, qrCode.Bounds().Dx())
	require.Equal(t, 240, qrCode.Bounds().Dy())
}
