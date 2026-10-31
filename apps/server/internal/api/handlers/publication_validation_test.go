package handlers

import (
	"context"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/providerlimits"
	"github.com/stretchr/testify/require"
)

func TestValidatePublicationIncludesNativeProcessingFailure(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.SocialAccount)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Publication{
		ID:             "publication-1",
		WorkspaceID:    "ws-1",
		CreatedByID:    "user-1",
		Title:          "Launch",
		ContentProfile: models.ContentProfileLongVideo,
		SourceText:     "Launch",
		SourceContent:  "Launch",
		Status:         models.PublicationStatusPublished,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   "publication-1",
		SocialAccountID: "account-1",
		Platform:        "youtube",
		Profile:         models.ContentProfileLongVideo,
		Body:            "Launch",
		Title:           "Launch video",
		SettingsJSON:    `{"privacy":"private"}`,
		Status:          models.RenditionStatusFailed,
		ErrorMessage:    "provider processing failed",
	}).Exec(ctx)
	require.NoError(t, err)

	issues, err := (&PublicationHandler{db: db}).validatePublicationByID(ctx, "publication-1")

	require.NoError(t, err)
	requirePublicationIssueCode(t, issues, "native_processing_failed")
}

func TestValidatePublicationIncludesMissingScope(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.SocialAccount)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Publication{
		ID:             "publication-scopes",
		WorkspaceID:    "ws-1",
		CreatedByID:    "user-1",
		Title:          "Launch",
		ContentProfile: models.ContentProfileLongVideo,
		SourceText:     "Launch",
		SourceContent:  "Launch",
		Status:         models.PublicationStatusDraft,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "youtube-account",
		WorkspaceID:    "ws-1",
		Platform:       "youtube",
		AccountID:      "channel-1",
		AccessTokenEnc: []byte("token"),
		GrantedScopes:  "https://www.googleapis.com/auth/youtube",
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "youtube-rendition",
		PublicationID:   "publication-scopes",
		SocialAccountID: "youtube-account",
		Platform:        "youtube",
		Profile:         models.ContentProfileLongVideo,
		Body:            "Launch",
		Title:           "Launch video",
		SettingsJSON:    `{"privacy":"private"}`,
		Status:          models.RenditionStatusDraft,
	}).Exec(ctx)
	require.NoError(t, err)

	issues, err := (&PublicationHandler{db: db}).validatePublicationByID(ctx, "publication-scopes")

	require.NoError(t, err)
	requirePublicationIssueCode(t, issues, "missing_scope")
}

func TestInstagramLoginReconnectionRejectsRetainedShoppingTagsBeforeScheduling(t *testing.T) {
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

func TestValidatePublicationRejectsOverLimitInstagramAltText(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil),
		(*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil), (*models.MediaAttachment)(nil), (*models.SocialAccount)(nil))
	overLimitAltText := strings.Repeat("a", providerlimits.InstagramAltTextMaxCharacters+1)
	for _, row := range []any{
		&models.Publication{ID: "pub", WorkspaceID: "ws-1", CreatedByID: "user-1", ContentProfile: models.ContentProfileImagePost, Status: models.PublicationStatusDraft},
		&models.SocialAccount{ID: "account", WorkspaceID: "ws-1", Platform: "instagram", AccountID: "ig-user", AccessTokenEnc: []byte("token"), IsActive: true, GrantedScopes: "instagram_basic instagram_content_publish"},
		&models.MediaAttachment{ID: "photo", WorkspaceID: "ws-1", FilePath: "photo.jpg", MimeType: "image/jpeg", Size: 100, PublicURLReady: true},
		&models.PublicationSegment{ID: "source", PublicationID: "pub", Body: "Launch"},
		&models.PublicationSegmentMedia{SegmentID: "source", MediaID: "photo"},
		&models.Rendition{ID: "rendition", PublicationID: "pub", SocialAccountID: "account", Platform: "instagram", Profile: models.ContentProfileImagePost, OutputProfile: "instagram.feed", Status: models.RenditionStatusDraft},
		&models.RenditionSegment{ID: "segment", RenditionID: "rendition", PublicationSegmentID: "source", MediaInherited: true, Status: models.RenditionStatusDraft},
		&models.RenditionSegmentMedia{RenditionSegmentID: "segment", MediaID: "photo", AltText: overLimitAltText},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	issues, err := (&PublicationHandler{db: db}).validatePublicationByID(t.Context(), "pub")

	require.NoError(t, err)
	var altIssues []capabilities.ValidationIssue
	for _, issue := range issues {
		if issue.Code == "alt_text_too_long" {
			altIssues = append(altIssues, issue)
		}
	}
	require.Len(t, altIssues, 1)
	require.Equal(t, "photo", altIssues[0].MediaID)
	require.Equal(t, "segment", altIssues[0].SegmentID)
	require.Contains(t, altIssues[0].Message, "1000 character limit")
}

func TestValidateDynamicXConstraintsUseTheResolvedAccountTier(t *testing.T) {
	rendition := models.Rendition{
		ID:       "x-rendition",
		Platform: capabilities.ProviderX,
		Profile:  models.ContentProfileShortText,
	}
	segment := RenditionSegmentResponse{
		ID:   "x-segment",
		Body: strings.Repeat("界", 141),
		Media: []MediaSummary{{
			MimeType:   "video/mp4",
			DurationMS: int64(platform.XStandardVideoDurationSeconds+1) * 1000,
			Size:       int64(platform.XStandardVideoSizeBytes) + 1,
		}},
	}

	standardIssues := validateDynamicConstraints(
		rendition,
		segment,
		0,
		nil,
		platform.XPublishingCapabilities(platform.XSubscriptionTypeUnknown).Constraints,
	)
	requirePublicationIssueCode(t, standardIssues, "dynamic_text_limit")
	requirePublicationIssueCode(t, standardIssues, "dynamic_video_duration")
	requirePublicationIssueCode(t, standardIssues, "dynamic_video_size")

	premiumIssues := validateDynamicConstraints(
		rendition,
		segment,
		0,
		nil,
		platform.XPublishingCapabilities(platform.XSubscriptionTypePremium).Constraints,
	)
	require.Empty(t, premiumIssues)
}

func requirePublicationIssueCode(t *testing.T, issues []capabilities.ValidationIssue, code string) {
	t.Helper()
	for _, issue := range issues {
		if issue.Code == code {
			return
		}
	}
	require.Failf(t, "missing validation issue", "code %q not found in %#v", code, issues)
}
