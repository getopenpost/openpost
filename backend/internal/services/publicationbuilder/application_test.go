package publicationbuilder

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type packageBuilderFunc func(context.Context, BuildInput) (BuildResult, error)

func (fn packageBuilderFunc) Build(ctx context.Context, input BuildInput) (BuildResult, error) {
	return fn(ctx, input)
}

type assetLoaderFunc func(context.Context, string, []BuildAsset) (LoadedAssets, error)

func (fn assetLoaderFunc) Load(ctx context.Context, workspaceID string, assets []BuildAsset) (LoadedAssets, error) {
	return fn(ctx, workspaceID, assets)
}

type publicationApplicationStub struct {
	publication publicationservice.Publication
	createCalls int
	command     publicationservice.CreateCommand
}

func (stub *publicationApplicationStub) Get(_ context.Context, _ string, id string) (publicationservice.Publication, error) {
	if stub.publication.ID == id {
		return stub.publication, nil
	}
	return publicationservice.Publication{}, publicationservice.NewError(publicationservice.ErrorNotFound, errors.New("not found"))
}

func (stub *publicationApplicationStub) Create(_ context.Context, _ string, command publicationservice.CreateCommand) (publicationservice.Publication, error) {
	stub.createCalls++
	stub.command = command
	stub.publication = publicationservice.Publication{ID: command.InternalID, WorkspaceID: command.WorkspaceID}
	return stub.publication, nil
}

func TestApplicationEnqueueIsIdempotentAndBuildsDurably(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	builderCalls := 0
	application, err := NewApplication(db, packageBuilderFunc(func(_ context.Context, input BuildInput) (BuildResult, error) {
		builderCalls++
		require.Contains(t, input.Sources, SourceMaterial{ID: "media:proof", Kind: "image", Label: "proof.png"})
		return BuildResult{
			CanonicalText: "Canonical draft",
			Direction: DirectorPlan{
				CanonicalText: "Canonical draft", FactualKernel: []string{"One fact"}, Thesis: "One thesis",
				Outcome: "authority", Audience: "founders", Angle: "proof", Route: "artifact_led",
				Media: MediaPlan{Treatment: "none", Role: "none", Brief: "No media needed."},
			},
			Destinations: []DestinationPlan{{
				AccountID: "account-1", Platform: "x", Objective: "shares", Archetype: "technical_opinion",
				OutputProfile: "x.short_text", Preview: "Canonical draft",
				Segments: []SegmentPlan{{Body: "Canonical draft"}},
				Media:    MediaPlan{Treatment: "none", Role: "none", Brief: "No media needed."},
			}},
		}, nil
	}), ApplicationConfig{
		Model: "test-model",
		Now:   func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error {
			return nil
		},
		AssetLoader: assetLoaderFunc(func(_ context.Context, workspaceID string, assets []BuildAsset) (LoadedAssets, error) {
			require.Equal(t, "workspace-1", workspaceID)
			require.Equal(t, []BuildAsset{{MediaID: "proof", Role: "artifact", MayPublish: true}}, assets)
			return LoadedAssets{Sources: []SourceMaterial{{ID: "media:proof", Kind: "image", Label: "proof.png"}}}, nil
		}),
	})
	require.NoError(t, err)

	request := CreateBuildRequest{
		WorkspaceID:    "workspace-1",
		CreatedByID:    "user-1",
		IdempotencyKey: "request-1234",
		Authority: workspaceaccess.StoredAuthority{
			UserID: "user-1", WorkspaceID: "workspace-1", OrganizationID: "organization-1", AssuredAt: now,
		},
		Input: BuildInput{
			Idea:    "A useful idea",
			Sources: []SourceMaterial{{ID: "idea", Kind: "text", Label: "Idea", Text: "A useful idea"}},
			Destinations: []Destination{{
				AccountID: "account-1", Platform: "x", Label: "Founder X",
				AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
			}},
			DestinationPolicy: DestinationPolicyRecommend,
		},
		Assets:         []BuildAsset{{MediaID: "proof", Role: "artifact", MayPublish: true}},
		SocialSetID:    "founder-accounts",
		VoiceProfileID: "rodrigo",
	}

	first, created, err := application.Enqueue(context.Background(), request)
	require.NoError(t, err)
	require.True(t, created)
	require.Equal(t, BuildStateQueued, first.State)

	second, created, err := application.Enqueue(context.Background(), request)
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, first.ID, second.ID)

	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", jobregistry.TypePublicationBuild).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, jobCount)
	assetCount, err := db.NewSelect().Model((*buildAssetRecord)(nil)).Where("build_id = ? AND media_id = ?", first.ID, "proof").Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, assetCount)
	require.Equal(t, "founder-accounts", first.SocialSetID)
	require.Equal(t, "rodrigo", first.VoiceProfileID)

	changed := request
	changed.Input.Idea = "A different idea"
	_, _, err = application.Enqueue(context.Background(), changed)
	require.ErrorIs(t, err, ErrIdempotencyConflict)

	payload, err := EncodeBuildJobPayload(first.ID)
	require.NoError(t, err)
	require.NoError(t, application.HandleJob(context.Background(), jobregistry.TypePublicationBuild, payload))

	ready, err := application.Get(context.Background(), "user-1", first.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateReady, ready.State)
	require.Equal(t, BuildPhaseReady, ready.Phase)
	require.NotNil(t, ready.Result)
	require.Equal(t, "Canonical draft", ready.Result.CanonicalText)
	require.Equal(t, 1, builderCalls)

	require.NoError(t, application.HandleJob(context.Background(), jobregistry.TypePublicationBuild, payload))
	require.Equal(t, 1, builderCalls, "replayed completed work must be a no-op")

	publications := &publicationApplicationStub{}
	committed, err := application.Commit(context.Background(), "user-1", first.ID, publications)
	require.NoError(t, err)
	require.Equal(t, BuildStateCommitted, committed.State)
	require.NotEmpty(t, committed.PublicationID)
	require.Equal(t, committed.PublicationID, publications.command.InternalID)
	require.Equal(t, 1, publications.createCalls)

	replayed, err := application.Commit(context.Background(), "user-1", first.ID, publications)
	require.NoError(t, err)
	require.Equal(t, committed.PublicationID, replayed.PublicationID)
	require.Equal(t, 1, publications.createCalls, "a committed build must not create another Publication")
}

func TestPublicationCreateCommandKeepsOneCanonicalSourceAndNativeThreads(t *testing.T) {
	t.Parallel()

	command := publicationCreateCommand(
		"publication-1",
		"workspace-1",
		persistedBuildRequest{
			SocialSetID: "founder-accounts", VoiceProfileID: "rodrigo",
			Assets: []BuildAsset{
				{MediaID: "proof", Role: "evidence", MayPublish: true},
				{MediaID: "private-note", Role: "context", MayPublish: false},
			},
		},
		BuildResult{
			CanonicalText: "The product improved when we removed code.",
			Direction: DirectorPlan{
				Thesis: "Less code made the product better.", Outcome: "authority",
				Audience: "technical founders", Angle: "show the deletion", Route: "artifact_led",
				Media: MediaPlan{Treatment: "use_source", Role: "proof", Brief: "Show the diff."},
			},
			Destinations: []DestinationPlan{
				{
					AccountID: "x-1", Platform: "x", OutputProfile: "x.thread",
					Segments: []SegmentPlan{{Body: "deleted 15,000 lines."}, {Body: "the product got better."}, {Body: "complexity has to earn its keep."}},
					Media:    MediaPlan{Treatment: "use_source", Role: "proof", Brief: "Show the diff."},
				},
				{
					AccountID: "linkedin-1", Platform: "linkedin", OutputProfile: "linkedin.post",
					Segments: []SegmentPlan{{Body: "I deleted 15,000 lines. The product got better."}},
					Media:    MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
				},
			},
		},
		"build-1",
	)

	require.Equal(t, "publication-1", command.InternalID)
	require.Equal(t, "founder-accounts", command.SocialSetID)
	require.Len(t, command.Segments, 1, "the shared source stays one canonical idea")
	require.Equal(t, []string{"proof"}, []string{command.Media[0].MediaID})
	require.Len(t, command.Renditions, 2)
	require.Len(t, command.Renditions[0].Segments, 3)
	for _, segment := range command.Renditions[0].Segments {
		require.Equal(t, "builder-source", segment.PublicationSegmentID)
	}
	require.True(t, *command.Renditions[0].Segments[0].MediaInherited)
	require.False(t, *command.Renditions[0].Segments[1].MediaInherited)
	require.False(t, *command.Renditions[1].Segments[0].MediaInherited)
}

func newBuilderApplicationTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{(*BuildRecord)(nil), (*buildAssetRecord)(nil), (*models.Job)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewCreateIndex().Index("publication_builds_idempotency_test_idx").Table("publication_builds").Column("workspace_id", "created_by_id", "idempotency_key").Unique().Exec(ctx)
	require.NoError(t, err)
	return db
}
