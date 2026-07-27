package handlers

import (
	"context"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
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
