package passwordmail

import (
	"net/mail"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNewSMTPSenderRejectsUnencryptedRemoteServer(t *testing.T) {
	_, err := NewSMTPSender(SMTPConfig{
		Host:    "smtp.example.com",
		Port:    25,
		From:    "OpenPost <support@example.com>",
		TLSMode: "none",
	})
	require.ErrorContains(t, err, "loopback")
}

func TestBuildResetEmailContainsOnlyResetDetails(t *testing.T) {
	from, err := mail.ParseAddress("OpenPost <support@example.com>")
	require.NoError(t, err)
	recipient, err := mail.ParseAddress("person@example.com")
	require.NoError(t, err)

	raw := string(buildResetEmail(from, recipient, ResetMessage{
		Recipient: recipient.Address,
		ResetURL:  "https://app.example.com/reset-password#token=secret-token",
		ExpiresAt: time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC),
	}))

	require.Contains(t, raw, "Subject: Reset your OpenPost password")
	require.Contains(t, raw, "https://app.example.com/reset-password#token=secret-token")
	require.Contains(t, raw, "single-use link expires")
	require.NotContains(t, raw, "PasswordHash")
}
