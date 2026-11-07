package publicationbuilder

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/services/sourcecontext"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

func TestSeriesOnlyGeneratesSelectedConceptAndKeepsSourceSnapshot(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	reads := 0
	app, err := NewApplication(db, packageBuilderFunc(func(_ context.Context, input BuildInput) (BuildResult, error) {
		require.Equal(t, "The release supports offline drafts.", input.Sources[0].Text)
		if input.SeriesCount > 0 {
			return BuildResult{Series: []SeriesConcept{{ID: "post-1", Revision: 1, Title: "The launch", Brief: "Explain the offline release", Evidence: "Offline drafts shipped", SourceRefs: []string{"url:1"}}, {ID: "post-2", Revision: 1, Title: "The decision", Brief: "Explain why local persistence matters", Evidence: "The supplied local persistence decision", SourceRefs: []string{"url:1"}}}}, nil
		}
		require.Equal(t, "Explain the offline release for founders", input.Direction.Angle)
		return BuildResult{CanonicalText: "Offline drafts are here.", Destinations: []DestinationPlan{{AccountID: "account-1", Platform: "x", OutputProfile: "x.short_text", Segments: []SegmentPlan{{Body: "Offline drafts are here."}}, Media: MediaPlan{Treatment: "none"}}}}, nil
	}), ApplicationConfig{AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil }, SourceLoader: sourceLoaderFunc(func(context.Context, string) (sourcecontext.Document, error) {
		reads++
		return sourcecontext.Document{Title: "Release", Text: "The release supports offline drafts."}, nil
	})})
	require.NoError(t, err)
	request := testBuildRequest(time.Now(), "series-source-snapshot")
	request.Input.SeriesCount = 3
	request.ContextURLs = []string{"https://example.test/release"}
	parent, _, err := app.Enqueue(t.Context(), request)
	require.NoError(t, err)
	require.NoError(t, app.HandleJob(t.Context(), jobregistry.TypePublicationBuild, `{"build_id":"`+parent.ID+`"}`))
	parent, err = app.Get(t.Context(), "user-1", parent.ID)
	require.NoError(t, err)
	require.Len(t, parent.Result.Series, 2, "thin sources may produce fewer concepts")
	count, err := db.NewSelect().Model((*BuildRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count, "planning creates no child drafts")
	parent, err = app.UpdateSeriesConcept(t.Context(), "user-1", parent.ID, "post-1", 1, "The launch", "Explain the offline release for founders")
	require.NoError(t, err)
	_, err = app.UpdateSeriesConcept(t.Context(), "user-1", parent.ID, "post-1", 1, "The launch", "Explain the offline release for founders")
	require.NoError(t, err, "lost concept-edit responses replay without another revision")
	child, err := app.StartSeriesConcept(t.Context(), "user-1", parent.ID, "post-1", 2)
	require.NoError(t, err)
	replay, err := app.StartSeriesConcept(t.Context(), "user-1", parent.ID, "post-1", 2)
	require.NoError(t, err)
	require.Equal(t, child.ID, replay.ID)
	_, err = app.StartSeriesConcept(t.Context(), "another-user", parent.ID, "post-2", 1)
	require.ErrorIs(t, err, ErrBuildNotFound)
	require.NoError(t, app.HandleJob(t.Context(), jobregistry.TypePublicationBuild, `{"build_id":"`+child.ID+`"}`))
	require.Equal(t, 1, reads, "children use the reviewed source snapshot rather than refetching a changed URL")
	child, err = app.Get(t.Context(), "user-1", child.ID)
	require.NoError(t, err)
	require.Len(t, child.Result.Options, 1)
	publications := &publicationApplicationStub{}
	_, err = app.CommitOption(t.Context(), "user-1", child.ID, "post", child.Revision, nil, nil, publications)
	require.NoError(t, err)
	require.Equal(t, &SeriesOrigin{BuildID: parent.ID, ItemID: "post-1", ItemRevision: 2}, publications.command.Metadata["series"])
	require.Equal(t, 1, publications.createCalls)
	count, err = db.NewSelect().Model((*BuildRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 2, count, "unselected concepts remain concepts")
}

func TestSeriesRepairsUnsupportedReferencesAndAllowsFewerConcepts(t *testing.T) {
	calls := 0
	service, err := New(generationFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		ref := "invented-source"
		if calls == 2 {
			ref = "idea"
		}
		return ai.GenerateResult{Text: `{"concepts":[{"title":"Offline drafts","brief":"Announce the shipped offline capability","evidence":"The author says offline drafts shipped","source_refs":["` + ref + `"]}]}`}, nil
	}), Config{Model: "test-series"})
	require.NoError(t, err)
	input := testBuildRequest(time.Now(), "series-repair-test").Input
	input.SeriesCount = 3
	result, err := service.Build(t.Context(), input)
	require.NoError(t, err)
	require.Len(t, result.Series, 1)
	require.Equal(t, 2, calls)
}
