package handlers

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func TestTextCardsStaySeparateFromAuthoredMediaAndRefreshAfterEditing(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Set("account_username = 'founder'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	storage := mediastore.NewLocalStorage(t.TempDir(), "https://media.example")
	h := srv.handler.publicationHandler()
	h.SetTextCardStorage(storage)
	app := h.publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", ContentProfile: "short_text", SourceText: "A small release worth sharing.", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	require.Len(t, created.Renditions, 1)
	variant := created.Renditions[0]
	require.Equal(t, "text_only", variant.Settings["text_card"])
	require.Empty(t, created.Media)
	require.Empty(t, variant.Media)
	require.Empty(t, variant.Segments[0].Media)
	require.Len(t, variant.Segments[0].OutputMedia, 1)
	first := variant.Segments[0].OutputMedia[0]
	require.Equal(t, "text_card", first.Role)
	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("id = ?", first.ID).Scan(ctx))
	reader, err := storage.Open(ctx, filepath.Base(media.FilePath))
	require.NoError(t, err)
	decoded, err := jpeg.Decode(reader)
	require.NoError(t, err)
	require.NoError(t, reader.Close())
	require.Equal(t, 1080, decoded.Bounds().Dx())
	require.Equal(t, 1350, decoded.Bounds().Dy())
	issues, err := h.validatePublicationByIDWithDB(ctx, srv.db, created.ID)
	require.NoError(t, err)
	for _, issue := range issues {
		require.NotEqual(t, "error", issue.Severity, "%+v", issue)
	}
	changed := "The release now includes keyboard navigation."
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: created.Revision, SourceText: &changed}))
	updated, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	segment := updated.Renditions[0].Segments[0]
	require.Equal(t, changed, segment.Body)
	require.Len(t, segment.OutputMedia, 1)
	require.NotEqual(t, first.ID, segment.OutputMedia[0].ID)
	require.Equal(t, changed, segment.OutputMedia[0].AltText)
	oldExists, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", first.ID).Exists(ctx)
	require.NoError(t, err)
	require.False(t, oldExists, "replaced cards must not accumulate billable media")
	// A no-op save keeps the exact rendered file; it never adds another card.
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: updated.Revision, SourceText: &changed}))
	again, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Equal(t, segment.OutputMedia, again.Renditions[0].Segments[0].OutputMedia)
	// The stored delivery relation includes the generated image used by the worker.
	var relations []models.RenditionMedia
	require.NoError(t, srv.db.NewSelect().Model(&relations).Where("rendition_id = ?", again.Renditions[0].ID).Scan(ctx))
	require.Len(t, relations, 1)
	require.Equal(t, segment.OutputMedia[0].ID, relations[0].MediaID)
}

func TestTextCardAccountIdentityChangeRerendersSameText(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Set("alias = 'Founder'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	dir := t.TempDir()
	h := srv.handler.publicationHandler()
	h.SetTextCardStorage(mediastore.NewLocalStorage(dir, "https://media.example"))
	app := h.publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "A steady release note.", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	first := created.Renditions[0].Segments[0].OutputMedia[0]
	// A no-op save reuses the exact card without another render.
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: created.Revision, SourceText: &created.Segments[0].Body}))
	reused, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Equal(t, first.ID, reused.Renditions[0].Segments[0].OutputMedia[0].ID)
	// Renaming the account invalidates the saved output even though the
	// authored text is unchanged, so the preview and the next save agree.
	_, err = srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("alias = 'Renamed Founder'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: reused.Revision, SourceText: &created.Segments[0].Body}))
	renamed, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.NotEqual(t, first.ID, renamed.Renditions[0].Segments[0].OutputMedia[0].ID, "an identity change must re-render the saved card")
}

func writeTestAvatarPNG(t *testing.T, dir, name string) {
	t.Helper()
	photo := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			photo.Set(x, y, color.RGBA{R: uint8(x * 4), G: uint8(y * 4), B: 128, A: 255})
		}
	}
	var buffer bytes.Buffer
	require.NoError(t, png.Encode(&buffer, photo))
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), buffer.Bytes(), 0o644))
}

func textCardReceiptSettings(t *testing.T, srv *mcpTestServer, segmentID string) []models.RenditionSegmentMedia {
	t.Helper()
	var rows []models.RenditionSegmentMedia
	require.NoError(t, srv.db.NewSelect().Model(&rows).Where("rendition_segment_id = ? AND role = 'text_card'", segmentID).Order("display_order ASC").Scan(t.Context()))
	require.NotEmpty(t, rows)
	return rows
}

func TestTextCardFailedAvatarRetriesOnNextSave(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Set("account_avatar_url = '/avatars/retry.png'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	dir := t.TempDir()
	h := srv.handler.publicationHandler()
	h.SetTextCardStorage(mediastore.NewLocalStorage(dir, "https://media.example"))
	app := h.publicationApplication()
	// Saving stays possible while the optional photo is unavailable; the card
	// uses the monogram fallback.
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "A release worth sharing.", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	segmentID := created.Renditions[0].Segments[0].ID
	fallback := created.Renditions[0].Segments[0].OutputMedia[0]
	require.Contains(t, textCardReceiptSettings(t, srv, segmentID)[0].SettingsJSON, `"text_card_avatar":"failed"`)
	// Editing the body during the outage renders the new body, never the
	// previous complete card.
	changed := "The release now includes keyboard navigation."
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: created.Revision, SourceText: &changed}))
	edited, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Equal(t, changed, edited.Renditions[0].Segments[0].OutputMedia[0].AltText)
	require.NotEqual(t, fallback.ID, edited.Renditions[0].Segments[0].OutputMedia[0].ID)
	// Once the photo is available, an explicit save retries it without any
	// authored-text edit solely to break the cache key.
	writeTestAvatarPNG(t, dir, "retry.png")
	require.NoError(t, app.Update(ctx, "user-1", edited.ID, PublicationUpdateBody{ExpectedRevision: edited.Revision, SourceText: &changed}))
	retried, err := app.Get(ctx, "user-1", edited.ID)
	require.NoError(t, err)
	require.NotEqual(t, edited.Renditions[0].Segments[0].OutputMedia[0].ID, retried.Renditions[0].Segments[0].OutputMedia[0].ID, "a recovered avatar must re-render the saved card")
	require.Equal(t, changed, retried.Renditions[0].Segments[0].OutputMedia[0].AltText)
	require.Contains(t, textCardReceiptSettings(t, srv, segmentID)[0].SettingsJSON, `"text_card_avatar":"ok"`)
	// The recovered card is then reused without further renders.
	require.NoError(t, app.Update(ctx, "user-1", retried.ID, PublicationUpdateBody{ExpectedRevision: retried.Revision, SourceText: &changed}))
	stable, err := app.Get(ctx, "user-1", retried.ID)
	require.NoError(t, err)
	require.Equal(t, retried.Renditions[0].Segments[0].OutputMedia, stable.Renditions[0].Segments[0].OutputMedia)
}

func TestTextCardReplacementNearQuotaAndRollback(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	dir := t.TempDir()
	h := srv.handler.publicationHandler()
	h.SetTextCardStorage(mediastore.NewLocalStorage(dir, "https://media.example"))
	app := h.publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Release one", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	first := created.Renditions[0].Segments[0].OutputMedia[0]
	h.entitlement = entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitMediaBytesStored: first.Size * 3 / 2}})
	h.SetTextCardStorage(mediastore.NewLocalStorage(dir, "https://media.example"))
	changed := "Release two"
	require.NoError(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: created.Revision, SourceText: &changed}))
	updated, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("source = 'text_card'").Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	filesBefore, err := filepath.Glob(filepath.Join(dir, "*.jpg"))
	require.NoError(t, err)
	jobsBefore, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	h.entitlement = entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitMediaBytesStored: 1}})
	h.SetTextCardStorage(mediastore.NewLocalStorage(dir, "https://media.example"))
	changed = "This replacement must roll back"
	require.Error(t, app.Update(ctx, "user-1", created.ID, PublicationUpdateBody{ExpectedRevision: updated.Revision, SourceText: &changed}))
	after, err := app.Get(ctx, "user-1", created.ID)
	require.NoError(t, err)
	require.Equal(t, updated.Renditions[0].Segments[0].OutputMedia, after.Renditions[0].Segments[0].OutputMedia)
	filesAfter, err := filepath.Glob(filepath.Join(dir, "*.jpg"))
	require.NoError(t, err)
	require.Equal(t, filesBefore, filesAfter, "rollback must remove newly written blobs")
	jobsAfter, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, jobsBefore, jobsAfter, "rollback must not enqueue deletion of the restored card")
}

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

func TestTextCardWorkflowReplayKeepsExactDeliveryImage(t *testing.T) {
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	app := srv.handler.publicationHandler().publicationApplicationForTesting()
	input := CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Created by a workflow", SocialAccountIDs: []string{"account-1"}}
	request := idempotency.Request{PrincipalID: "workflow:run-1", WorkspaceID: "ws-1", OperationID: "create-publication", Key: "step-1", ExpiresAt: time.Now().Add(time.Hour)}
	first, err := app.CreateFromWorkflow(ctx, "user-1", input, request)
	require.NoError(t, err)
	replay, err := app.CreateFromWorkflow(ctx, "user-1", input, request)
	require.NoError(t, err)
	require.Equal(t, first.ID, replay.ID)
	require.Equal(t, first.Renditions[0].Segments[0].OutputMedia, replay.Renditions[0].Segments[0].OutputMedia)
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
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

func TestTextCardUnrenderableDraftCannotBePublished(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	h := srv.handler.publicationHandler()
	created, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "First" + strings.Repeat("\n", 400) + "Last", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err, "incomplete drafts stay editable")
	issues, err := h.validatePublicationByIDWithDB(ctx, srv.db, created.ID)
	require.NoError(t, err)
	found := false
	for _, issue := range issues {
		if issue.Code == "text_card_unavailable" && issue.Severity == "error" {
			found = true
		}
	}
	require.True(t, found, "%+v", issues)
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

func TestTextCardKeepsExplicitStoryWithoutFormatLock(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'instagram'").Where("id = 'account-1'").Exec(ctx)
	require.NoError(t, err)
	app := srv.handler.publicationHandler().publicationApplication()
	created, err := app.Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID: "ws-1", SourceText: "A story for today",
		Renditions: []RenditionInput{{SocialAccountID: "account-1", OutputProfile: "instagram.story"}},
	})
	require.NoError(t, err)
	require.Equal(t, "instagram.story", created.Renditions[0].OutputProfile)
	require.Equal(t, 1920, created.Renditions[0].Segments[0].OutputMedia[0].Height)
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

func TestTextCardPreviewRateLimitProtectsAllPreviewCallers(t *testing.T) {
	srv := newMCPTestServer(t)
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = 'pixelfed'").Where("id = 'account-1'").Exec(t.Context())
	require.NoError(t, err)
	userID := "preview-rate-" + uuid.NewString()
	_, err = srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("user_id = ?", userID).Where("workspace_id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	h := srv.handler.publicationHandler()
	input := &PreviewTextCardInput{}
	input.Body.SocialAccountID = "account-1"
	input.Body.Text = "Preview"
	input.Body.Settings = map[string]any{"text_card_shadow": false}
	// Fill prior admissions directly; only the final allowed call needs a real
	// image. Rendering 30 cards under -race can outlast the one-minute window.
	for range 29 {
		require.True(t, textCardPreviewLimiter.Allow("text-card-preview:"+userID, 30, time.Minute))
	}
	_, err = h.previewTextCardForUser(t.Context(), userID, input)
	require.NoError(t, err)
	_, err = h.previewTextCardForUser(t.Context(), userID, input)
	require.ErrorContains(t, err, "rate limited")
	var status interface{ GetStatus() int }
	require.ErrorAs(t, err, &status)
	require.Equal(t, http.StatusTooManyRequests, status.GetStatus())
}
