package handlers

import (
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"

	"github.com/stretchr/testify/require"
)

func TestInstagramLoginReconnectionRejectsRetainedShoppingTagsBeforeScheduling(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil),
		(*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil), (*models.MediaAttachment)(nil), (*models.SocialAccount)(nil))
	for _, row := range []any{
		&models.Publication{ID: "pub", WorkspaceID: "ws-1", CreatedByID: "user-1", ContentProfile: models.ContentProfileImagePost, Status: models.PublicationStatusDraft},
		&models.SocialAccount{ID: "account", WorkspaceID: "ws-1", Platform: "instagram", AccountID: "ig-user", AccessTokenEnc: []byte("token"), IsActive: true, GrantedScopes: "instagram_basic instagram_content_publish"},
		&models.MediaAttachment{ID: "photo", WorkspaceID: "ws-1", FilePath: "photo.jpg", MimeType: "image/jpeg", Size: 100, PublicURLReady: true},
		&models.PublicationSegment{ID: "source", PublicationID: "pub", Body: "Launch"},
		&models.PublicationSegmentMedia{SegmentID: "source", MediaID: "photo", SettingsJSON: `{"product_tags":"[{\"product_id\":\"123\"}]"}`},
		&models.Rendition{ID: "rendition", PublicationID: "pub", SocialAccountID: "account", Platform: "instagram", Profile: models.ContentProfileImagePost, OutputProfile: "instagram.feed", Status: models.RenditionStatusDraft},
		&models.RenditionSegment{ID: "segment", RenditionID: "rendition", PublicationSegmentID: "source", MediaInherited: true, Status: models.RenditionStatusDraft},
		&models.RenditionSegmentMedia{RenditionSegmentID: "segment", MediaID: "photo", SettingsJSON: `{"product_tags":"[{\"product_id\":\"123\"}]"}`},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	handler := &PublicationHandler{db: db}
	before, err := handler.validatePublicationByIDWithDB(t.Context(), db, "pub")
	require.NoError(t, err)
	for _, issue := range before {
		require.NotEqual(t, "unsupported_setting", issue.Code)
	}
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("capability_state_json = ?", `{"connection_type":"instagram_login","instagram_account_type":"business"}`).
		Set("granted_scopes = ?", "instagram_business_basic instagram_business_content_publish").Where("id = 'account'").Exec(t.Context())
	require.NoError(t, err)
	after, err := handler.validatePublicationByIDWithDB(t.Context(), db, "pub")
	require.NoError(t, err)
	var tagIssues []capabilities.ValidationIssue
	for _, issue := range after {
		if issue.Code == "unsupported_setting" && issue.Field == "product_tags" {
			tagIssues = append(tagIssues, issue)
		}
		require.NotEqual(t, "missing_scope", issue.Code, "Instagram Login grants must use their own publishing permission family")
	}
	require.Len(t, tagIssues, 1)
	require.Equal(t, "photo", tagIssues[0].MediaID)
	require.Equal(t, "segment", tagIssues[0].SegmentID)
}
