package handlers

import (
	"encoding/json"

	"testing"

	"github.com/openpost/backend/internal/models"

	"github.com/stretchr/testify/require"
)

func TestMCPTextCardPreviewIsReadOnlyAndWorkspaceAuthorized(t *testing.T) {
	srv := newMCPTestServer(t)
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'instagram'").Where("id = 'account-1'").Exec(t.Context())
	require.NoError(t, err)
	response := mcpCallOperation(t, srv, "preview", mcpToolPreviewTextCard, map[string]any{"social_account_id": "account-1", "text": "A private preview.", "output_profile": "instagram.story"})
	encoded, err := json.Marshal(response)
	require.NoError(t, err)
	var decoded struct {
		Result struct {
			Content           []mcpContent `json:"content"`
			StructuredContent struct {
				Count int `json:"image_count"`
			} `json:"structuredContent"`
		} `json:"result"`
	}
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.Equal(t, 1, decoded.Result.StructuredContent.Count, string(encoded))
	require.Equal(t, "image/jpeg", decoded.Result.Content[0].MimeType)
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "a preview must not save media")
	input := &PreviewTextCardInput{}
	input.Body.SocialAccountID = "account-1"
	input.Body.Text = "Cannot see this identity"
	_, err = srv.handler.publicationHandler().previewTextCardForUser(t.Context(), "user-without-access", input)
	require.Error(t, err)
}

func TestTextCardsJoinExplicitSourcesAndRespectMediaOmission(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'instagram'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{ID: "video", WorkspaceID: "ws-1", MimeType: "video/mp4", Width: 1080, Height: 1920, DurationMS: 10000, AnalysisStatus: "ready", ProcessingStatus: "ready"}).Exec(ctx)
	require.NoError(t, err)
	app := srv.handler.publicationHandler().publicationApplication()
	omit := false
	custom := "First, edited"
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", Segments: []PublicationSegmentInput{{ID: "first", Body: "First", Media: []PublicationMediaInput{{MediaID: "video"}}}, {ID: "second", Body: "Second"}}, Renditions: []RenditionInput{{SocialAccountID: "account-1", Segments: []RenditionSegmentInput{{PublicationSegmentID: "first", BodyOverride: &custom, MediaInherited: &omit}, {PublicationSegmentID: "second"}}}}})
	require.NoError(t, err)
	variant := created.Renditions[0]
	require.Equal(t, "instagram.feed", variant.OutputProfile)
	require.Len(t, variant.Segments, 1)
	require.Equal(t, "First, edited\n\nSecond", variant.Segments[0].Body)
	require.Len(t, variant.Segments[0].OutputMedia, 1)
	require.Equal(t, "text_card", variant.Segments[0].OutputMedia[0].Role)
	require.Empty(t, variant.Segments[0].Media)
	require.Len(t, variant.Segments[0].SourceOverrides, 2)
}

func TestNewTextCardDestinationDefaultsDoNotChangeExistingVariants(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	app := srv.handler.publicationHandler().publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Ready for another destination"})
	require.NoError(t, err)
	require.NoError(t, app.ReplaceRenditions(ctx, "user-1", created.ID, created.Revision, []RenditionInput{{SocialAccountID: "account-1"}}))
	updated, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Equal(t, "text_only", updated.Renditions[0].Settings["text_card"])
	require.Len(t, updated.Renditions[0].Segments[0].OutputMedia, 1)
	// An explicit off selection survives replacing the same destination.
	require.NoError(t, app.ReplaceRenditions(ctx, "user-1", created.ID, updated.Revision, []RenditionInput{{SocialAccountID: "account-1", Settings: map[string]any{"text_card": "off"}}}))
	off, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Empty(t, off.Renditions[0].Segments[0].OutputMedia)
}

func TestTextCardIsRemovedWhenAutomaticFormatBecomesReel(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'instagram'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{ID: "reel", WorkspaceID: "ws-1", MimeType: "video/mp4", Width: 1080, Height: 1920, DurationMS: 10000, AnalysisStatus: "ready", ProcessingStatus: "ready"}).Exec(ctx)
	require.NoError(t, err)
	app := srv.handler.publicationHandler().publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Now with a video", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	require.Equal(t, "text_card", created.Renditions[0].Segments[0].OutputMedia[0].Role)
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: created.Revision, Segments: []PublicationSegmentInput{{ID: created.Segments[0].ID, Body: "Now with a video", Media: []PublicationMediaInput{{MediaID: "reel"}}}}}))
	updated, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Equal(t, "instagram.reel", updated.Renditions[0].OutputProfile)
	require.Len(t, updated.Renditions[0].Segments[0].OutputMedia, 1)
	require.Equal(t, "reel", updated.Renditions[0].Segments[0].OutputMedia[0].ID)
	var media []models.RenditionMedia
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("rendition_id = ?", updated.Renditions[0].ID).Scan(ctx))
	require.Len(t, media, 1)
	require.Equal(t, "reel", media[0].MediaID)
}

func TestJoinedTextCardEchoedMediaKeepsInheritance(t *testing.T) {
	canonical := []models.PublicationSegment{{ID: "first", Body: "First"}, {ID: "second", Body: "Second"}}
	sources := []PublicationSegmentInput{{ID: "first", Body: "First", Media: []PublicationMediaInput{{MediaID: "photo"}}}, {ID: "second", Body: "Second"}}
	joined, err := joinTextCardSources(RenditionInput{Segments: []RenditionSegmentInput{
		{PublicationSegmentID: "first", Media: []PublicationMediaInput{{MediaID: "photo"}}},
		{PublicationSegmentID: "second"},
	}}, canonical, sources)
	require.NoError(t, err)
	require.True(t, joined.SourceOverrides[0].MediaInherited)
}
