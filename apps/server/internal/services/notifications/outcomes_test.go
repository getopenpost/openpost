package notifications

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

// A credential failure is identified by the account plus the claimed
// generation, so every failure inside one break coalesces per recipient
// while a repaired account that breaks again starts a fresh identity.
func TestAccountCredentialFailureOutcomeIsAccountScopedByGeneration(t *testing.T) {
	outcome, err := NewAccountCredentialFailureOutcome(AccountCredentialFailureFacts{
		RecipientUserID: "connector-1", WorkspaceID: "workspace-1",
		AccountID: "account-1", Generation: 3,
		Provider: "x", AccountLabel: "X @Founder",
	})
	require.NoError(t, err)

	value := outcome.notificationOutcome()
	require.Equal(t, TypeAccountNeedsAttention, value.topic)
	require.Equal(t, "account-1:3", value.eventID)
	require.Equal(t, "connector-1", value.recipientID)
	require.Equal(t, map[string]any{
		"account_id": "account-1", "provider": "x",
		"account_label": "X @Founder", "credential_generation": "3",
	}, value.payload)

	// The transition shares the account attention presentation: the same
	// topic, the reconnect copy, and the account-scoped dedup key that
	// collapses repeated failures within one generation.
	input, err := materializeOutcome(value)
	require.NoError(t, err)
	require.Equal(t, "account_needs_attention:account-1:3", input.DedupKey)
	require.Equal(t, "Connected account needs attention", input.Title)
	require.Equal(t, "Publishing is paused until the account is reconnected.", input.Body)
	require.Equal(t, "/settings?tab=accounts", input.Href)
	require.Equal(t, []models.NotificationAction{{Label: "Reconnect account", Href: input.Href, Kind: "primary"}}, input.Actions)

	// The per-publication warning stays publication-scoped, so the two
	// identities never collide for the same account.
	publicationOutcome, err := NewAccountNeedsAttentionOutcome(AccountAttentionFacts{
		RecipientUserID: "connector-1", WorkspaceID: "workspace-1",
		AccountID: "account-1", PublicationID: "publication-1",
		Provider: "x", AccountLabel: "X @Founder",
	})
	require.NoError(t, err)
	require.Equal(t, "account-1:publication-1", publicationOutcome.notificationOutcome().eventID)

	// A different generation is a different break and must not dedupe
	// against the claimed one.
	next, err := NewAccountCredentialFailureOutcome(AccountCredentialFailureFacts{
		RecipientUserID: "connector-1", WorkspaceID: "workspace-1",
		AccountID: "account-1", Generation: 4,
		Provider: "x", AccountLabel: "X @Founder",
	})
	require.NoError(t, err)
	nextInput, err := materializeOutcome(next.notificationOutcome())
	require.NoError(t, err)
	require.Equal(t, "account_needs_attention:account-1:4", nextInput.DedupKey)

	_, err = NewAccountCredentialFailureOutcome(AccountCredentialFailureFacts{
		WorkspaceID: "workspace-1", AccountID: "account-1", Generation: 1,
		Provider: "x", AccountLabel: "X @Founder",
	})
	require.ErrorIs(t, err, ErrInvalidOutcome, "a recipient is required")
}
