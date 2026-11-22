package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

// IDENTITY-15: rendition reads must carry a bounded destination account
// identity so list surfaces do not join GET /accounts client-side.
func TestLoadPublicationResponsesProjectsDestinationAccountIdentity(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.ProviderDelivery)(nil),
		(*models.SocialAccount)(nil),
	)
	ctx := context.Background()
	now := time.Date(2026, time.October, 18, 12, 0, 0, 0, time.UTC)

	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.SocialAccount{
		{
			ID: "account-photo", WorkspaceID: "workspace-1", Slug: "x-founder",
			Platform: "x", AccountID: "remote-1", AccountUsername: "founder",
			AccountAvatarURL: "https://cdn.example/founder.jpg",
			AccessTokenEnc:   []byte("token"), IsActive: true,
		},
		{
			ID: "account-bare", WorkspaceID: "workspace-1",
			Platform: "mastodon", AccountID: "remote-2",
			AccessTokenEnc: []byte("token"), IsActive: true,
		},
		{
			ID: "account-foreign", WorkspaceID: "workspace-2", Slug: "intruder",
			Platform: "x", AccountID: "remote-3", AccountUsername: "intruder",
			AccountAvatarURL: "https://cdn.example/intruder.jpg",
			AccessTokenEnc:   []byte("token"), IsActive: true,
		},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-identity", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Identity", Intent: models.PublishingIntentPost,
		ContentProfile: models.ContentProfileShortText, SourceText: "Identity source",
		SourceContent: "Identity source", Status: models.PublicationStatusDraft,
		Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Rendition{
		{
			ID: "rendition-photo", PublicationID: "publication-identity",
			SocialAccountID: "account-photo", TargetKey: "x", Platform: "x",
			Profile: models.ContentProfileShortText, SettingsJSON: "{}",
			Status: models.RenditionStatusDraft, CreatedAt: now,
		},
		{
			ID: "rendition-bare", PublicationID: "publication-identity",
			SocialAccountID: "account-bare", TargetKey: "mastodon", Platform: "mastodon",
			Profile: models.ContentProfileShortText, SettingsJSON: "{}",
			Status: models.RenditionStatusDraft, CreatedAt: now,
		},
		{
			ID: "rendition-foreign", PublicationID: "publication-identity",
			SocialAccountID: "account-foreign", TargetKey: "x", Platform: "x",
			Profile: models.ContentProfileShortText, SettingsJSON: "{}",
			Status: models.RenditionStatusDraft, CreatedAt: now,
		},
		{
			ID: "rendition-missing", PublicationID: "publication-identity",
			SocialAccountID: "account-gone", TargetKey: "x", Platform: "x",
			Profile: models.ContentProfileShortText, SettingsJSON: "{}",
			Status: models.RenditionStatusDraft, CreatedAt: now,
		},
	}).Exec(ctx)
	require.NoError(t, err)

	publication := models.Publication{
		ID: "publication-identity", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Identity", Intent: models.PublishingIntentPost,
		ContentProfile: models.ContentProfileShortText, SourceText: "Identity source",
		SourceContent: "Identity source", Status: models.PublicationStatusDraft,
		Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}
	responses, err := (&PublicationHandler{db: db}).loadPublicationResponses(ctx, []models.Publication{publication})
	require.NoError(t, err)
	require.Len(t, responses, 1)
	require.Len(t, responses[0].Renditions, 4)

	var response struct {
		Renditions []struct {
			ID      string `json:"id"`
			Account *struct {
				Platform    string `json:"platform"`
				DisplayName string `json:"display_name"`
				AvatarURL   string `json:"avatar_url"`
			} `json:"account"`
		} `json:"renditions"`
	}
	encoded, err := json.Marshal(responses[0])
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(encoded, &response))
	for _, rendition := range response.Renditions {
		switch rendition.ID {
		case "rendition-photo":
			require.NotNil(t, rendition.Account)
			require.Equal(t, "x", rendition.Account.Platform)
			require.Equal(t, "x-founder", rendition.Account.DisplayName)
			require.Equal(t, "https://cdn.example/founder.jpg", rendition.Account.AvatarURL)
		case "rendition-bare":
			require.NotNil(t, rendition.Account)
			require.Equal(t, "mastodon", rendition.Account.Platform)
			require.Equal(t, "mastodon", rendition.Account.DisplayName)
			require.Empty(t, rendition.Account.AvatarURL)
		default:
			require.Nil(t, rendition.Account)
		}
	}
}
