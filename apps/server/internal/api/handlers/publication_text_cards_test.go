package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestReplacingTextCardsPreservesOtherOwners(t *testing.T) {
	for _, owner := range []string{"post", "favorite", "tag", "editor", "trashed editor", "published JSON", "pending editor indexing"} {
		t.Run(owner, func(t *testing.T) {
			srv := newMCPTestServer(t)
			ctx := t.Context()
			_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(ctx)
			require.NoError(t, err)
			app := srv.handler.publicationHandler().publicationApplication()
			input := CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Keep this card", SocialAccountIDs: []string{"account-1"}}
			created, err := app.Create(ctx, "user-1", input)
			require.NoError(t, err)
			cardID := created.Renditions[0].Segments[0].OutputMedia[0].ID
			switch owner {
			case "post":
				shared, err := app.Create(ctx, "user-1", input)
				require.NoError(t, err)
				require.Equal(t, cardID, shared.Renditions[0].Segments[0].OutputMedia[0].ID)
			case "favorite":
				_, err = srv.db.NewUpdate().Model((*models.MediaAttachment)(nil)).Set("is_favorite = true").Where("id = ?", cardID).Exec(ctx)
				require.NoError(t, err)
			case "tag":
				_, err = srv.db.NewInsert().Model(&models.MediaTag{ID: "tag", WorkspaceID: "ws-1", Name: "Saved"}).Exec(ctx)
				require.NoError(t, err)
				_, err = srv.db.NewInsert().Model(&models.MediaTagAssignment{TagID: "tag", MediaID: cardID}).Exec(ctx)
				require.NoError(t, err)
			case "editor", "trashed editor", "pending editor indexing":
				document := &models.DesignDocument{ID: "design", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Saved design", WidthPX: 1080, HeightPX: 1350}
				if owner == "editor" || owner == "trashed editor" {
					document.CoverPreviewMediaID = cardID
				}
				if owner == "trashed editor" {
					document.DeletedAt = time.Now()
				}
				_, err = srv.db.NewInsert().Model(document).Exec(ctx)
				require.NoError(t, err)
				if owner == "pending editor indexing" {
					_, err = srv.db.NewInsert().Model(&models.DesignRevision{ID: "revision", DesignDocumentID: "design", Revision: 1, Kind: "save", Snapshot: []byte("{}"), CreatedByID: "user-1"}).Exec(ctx)
					require.NoError(t, err)
				}
			case "published JSON":
				_, err = srv.db.NewInsert().Model(&models.Publication{ID: "published", WorkspaceID: "ws-1", Status: models.PublicationStatusPublished}).Exec(ctx)
				require.NoError(t, err)
				_, err = srv.db.NewInsert().Model(&models.Rendition{ID: "published-variant", PublicationID: "published", SocialAccountID: "account-1", SettingsJSON: `{"cover_media_id":"` + cardID + `"}`}).Exec(ctx)
				require.NoError(t, err)
			}
			require.NoError(t, app.ReplaceRenditions(ctx, "user-1", created.ID, created.Revision, []RenditionInput{{SocialAccountID: "account-1", Settings: map[string]any{"text_card": "off"}}}))
			exists, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", cardID).Exists(ctx)
			require.NoError(t, err)
			require.True(t, exists, "another owner must retain its card")
		})
	}
}

func TestTextCardCarouselKeepsAttachmentOrderAndExplicitOverrides(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	for _, id := range []string{"photo-b", "photo-a"} {
		_, err = srv.db.NewInsert().Model(&models.MediaAttachment{ID: id, WorkspaceID: "ws-1", MimeType: "image/jpeg", Width: 1080, Height: 1350, FilePath: id + ".jpg", StorageType: "local", AnalysisStatus: "ready", ProcessingStatus: "ready"}).Exec(ctx)
		require.NoError(t, err)
	}
	app := srv.handler.publicationHandler().publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", ContentProfile: "image_post", SourceText: "Source text", Media: []PublicationMediaInput{{MediaID: "photo-b"}, {MediaID: "photo-a"}}, Renditions: []RenditionInput{{SocialAccountID: "account-1", Settings: map[string]any{"text_card": "always"}}}})
	require.NoError(t, err)
	variant := created.Renditions[0]
	require.Equal(t, "pixelfed.carousel", variant.OutputProfile)
	output := variant.Segments[0].OutputMedia
	require.Len(t, output, 3)
	require.Equal(t, "text_card", output[0].Role)
	require.Equal(t, "photo-b", output[1].ID)
	require.Equal(t, "photo-a", output[2].ID)
	require.Nil(t, output[0].Settings, "internal render receipts are not client settings")
	// Existing posts may contain JSON null from omitted media settings.
	_, err = srv.db.NewUpdate().Model((*models.PublicationSegmentMedia)(nil)).Set("settings_json = ?", "null").Where("segment_id = ?", created.Segments[0].ID).Exec(ctx)
	require.NoError(t, err)
	// Explicitly empty text removes the card; it must not inherit the source.
	empty := ""
	inherit := true
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: created.Revision, Renditions: []RenditionInput{{SocialAccountID: "account-1", Settings: map[string]any{"text_card": "always"}, Segments: []RenditionSegmentInput{{PublicationSegmentID: created.Segments[0].ID, BodyOverride: &empty, MediaInherited: &inherit}}}}}))
	updated, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Empty(t, updated.Renditions[0].Segments[0].Body)
	require.Len(t, updated.Renditions[0].Segments[0].OutputMedia, 2)
	var authoredRows []models.RenditionSegmentMedia
	require.NoError(t, srv.db.NewSelect().Model(&authoredRows).Where("rendition_segment_id = ? AND role != ?", updated.Renditions[0].Segments[0].ID, "text_card").Scan(ctx))
	require.Len(t, authoredRows, 2)
	for _, row := range authoredRows {
		require.Equal(t, "{}", row.SettingsJSON, "refreshing inherited attachments must preserve object settings")
	}
}

func TestMCPTextCardPreviewIsReadOnlyAndWorkspaceAuthorized(t *testing.T) {
	srv := newMCPTestServer(t)
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'instagram'").Where("id = 'account-1'").Exec(t.Context())
	require.NoError(t, err)
	response := mcpCallOperation(t, srv, "web-token", "preview", mcpToolPreviewTextCard, map[string]any{"social_account_id": "account-1", "text": "A private preview.", "output_profile": "instagram.story"})
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

func TestSocialSetTextCardDefaultsSupportAutomaticFormats(t *testing.T) {
	server := newSocialSetsTestServer(t)
	response := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{"workspace_id": "ws-1", "name": "Photo feeds", "accounts": []map[string]any{{"social_account_id": "acc-2", "default_settings": map[string]any{"text_card": "always", "text_card_appearance": "dark", "text_card_background": "mesh", "text_card_shadow": false}}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var set SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &set))
	require.Empty(t, set.Accounts[0].DefaultOutputProfile)
	require.Equal(t, "always", set.Accounts[0].DefaultSettings["text_card"])
	invalid := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{"workspace_id": "ws-1", "name": "Invalid", "accounts": []map[string]any{{"social_account_id": "acc-2", "default_settings": map[string]any{"text_card": "always", "text_card_color": "url(https://example.test)"}}}})
	require.Equal(t, http.StatusBadRequest, invalid.Code, invalid.Body.String())
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
