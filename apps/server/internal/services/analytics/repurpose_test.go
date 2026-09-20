package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestResolveRepurposeSourceRejectsInvalidAndCrossWorkspaceSources(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-1", now)
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, TargetKey: "post",
		SocialAccountID: account.ID, Platform: account.Platform, Profile: "short_text",
		Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&rendition).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})

	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "external", PublicationID: publication.ID, RenditionID: rendition.ID}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrInvalidRepurposeReference)
	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "openpost"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrInvalidRepurposeReference)
	_, err = service.ResolveRepurposeSource(t.Context(), "another-workspace", ContentReference{Type: "openpost", PublicationID: publication.ID, RenditionID: rendition.ID}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceNotFound)
}
