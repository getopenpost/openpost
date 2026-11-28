package publicationbuilder

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/screenshottemplates"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type visualRendererFunc func(context.Context, string, string, screenshottemplates.ScreenshotTemplateDocument) (models.MediaAttachment, error)

func (fn visualRendererFunc) RenderVisual(ctx context.Context, workspaceID, userID string, document screenshottemplates.ScreenshotTemplateDocument) (models.MediaAttachment, error) {
	return fn(ctx, workspaceID, userID, document)
}

func plannedVisualBuild(t *testing.T, db *bun.DB, renderer VisualRenderer, key string) (*Application, Build) {
	t.Helper()
	request := testBuildRequest(time.Now(), key)
	request.Input.OptionCount = 4
	request.Input.Destinations[0].AllowedOutputProfiles[0].MediaMaxCount = 4
	request.Input.Destinations[0].AllowedOutputProfiles[0].AllowedMIMEs = []string{"image/*"}
	document := &screenshottemplates.ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "meme", Title: "Less code", Appearance: "light", Frame: "natural", TextSize: "normal", Meme: &screenshottemplates.ScreenshotTemplateMeme{TemplateID: "drake", Name: "Drake", Captions: []string{"More code", "Fewer lines"}, Format: "png", OverlayMediaIDs: []string{}}}
	app, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{Options: []PostOption{{ID: "option-1", Destinations: []DestinationPlan{{AccountID: "account-1", Platform: "x", Objective: "shares", Archetype: "artifact_joke", OutputProfile: "x.short_text", Preview: "Less code.", Segments: []SegmentPlan{{Body: "Less code."}}, Media: MediaPlan{Treatment: "meme", Role: "punchline", Brief: "A preference.", TemplateID: "drake", Document: document}}}}}}, nil
	}), ApplicationConfig{AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil }})
	require.NoError(t, err)
	app.SetVisualRenderer(renderer)
	build, _, err := app.Enqueue(t.Context(), request)
	require.NoError(t, err)
	require.NoError(t, app.HandleJob(t.Context(), jobregistry.TypePublicationBuild, `{"build_id":"`+build.ID+`"}`))
	build, err = app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	return app, build
}

func TestCommitRendersPlannedVisualWithoutAClient(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	renders := 0
	app, build := plannedVisualBuild(t, db, visualRendererFunc(func(ctx context.Context, workspaceID, userID string, document screenshottemplates.ScreenshotTemplateDocument) (models.MediaAttachment, error) {
		renders++
		require.Equal(t, "user-1", userID)
		require.Equal(t, "drake", document.Meme.TemplateID)
		media := models.MediaAttachment{ID: "rendered-meme", WorkspaceID: workspaceID, MimeType: "image/png", ProcessingStatus: "ready"}
		_, err := db.NewInsert().Model(&media).Exec(ctx)
		return media, err
	}), "server-rendered-visual")

	publications := &publicationApplicationStub{}
	_, err := app.CommitOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, nil, nil, publications)
	require.NoError(t, err)
	require.Equal(t, 1, renders)
	segment := publications.command.Renditions[0].Segments[0]
	require.Len(t, segment.Media, 1)
	require.Equal(t, "rendered-meme", segment.Media[0].MediaID)
	require.Nil(t, segment.Settings, "a rendered visual leaves no image requirement")
}

func TestCommitKeepsImageRequirementWhenRenderingFails(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	app, build := plannedVisualBuild(t, db, visualRendererFunc(func(context.Context, string, string, screenshottemplates.ScreenshotTemplateDocument) (models.MediaAttachment, error) {
		return models.MediaAttachment{}, errors.New("template image is missing")
	}), "server-render-failure")

	publications := &publicationApplicationStub{}
	_, err := app.CommitOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, nil, nil, publications)
	require.NoError(t, err)
	segment := publications.command.Renditions[0].Segments[0]
	require.Empty(t, segment.Media)
	require.Contains(t, segment.Settings, "attachment_requirement")
}
