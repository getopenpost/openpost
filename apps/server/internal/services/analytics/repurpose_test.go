package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestResolveRepurposeSourceRejectsUnavailableUnsupportedAndCrossWorkspaceSources(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	contents := []models.AccountContent{
		{ID: "gone", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: account.Platform, ProviderContentID: "gone", ContentProfile: models.ContentProfileShortText, Text: "gone", PublishedAt: now, Origin: string(platform.AccountContentOriginExternal), ProviderUnavailableAt: now, FirstDiscoveredAt: now, LastSeenAt: now},
		{ID: "unsupported", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: account.Platform, ProviderContentID: "unsupported", ContentProfile: "provider_unknown", Text: "text", PublishedAt: now, Origin: string(platform.AccountContentOriginExternal), FirstDiscoveredAt: now, LastSeenAt: now},
	}
	_, err := db.NewInsert().Model(&contents).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})

	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "external", AccountContentID: "gone"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceUnavailable)
	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "external", AccountContentID: "unsupported"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceUnsupported)
	_, err = service.ResolveRepurposeSource(t.Context(), "another-workspace", ContentReference{Type: "external", AccountContentID: "unsupported"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceNotFound)
}
