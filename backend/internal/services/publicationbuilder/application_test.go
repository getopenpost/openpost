package publicationbuilder

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/sourcecontext"
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

type sourceLoaderFunc func(context.Context, string) (sourcecontext.Document, error)

func (fn sourceLoaderFunc) Load(ctx context.Context, sourceURL string) (sourcecontext.Document, error) {
	return fn(ctx, sourceURL)
}

type publicationApplicationStub struct {
	publication publicationservice.Publication
	createCalls int
	command     publicationservice.CreateCommand
}

func (stub *publicationApplicationStub) CreateFromBuild(_ context.Context, _ string, buildID string, command publicationservice.CreateCommand, _ []string) (publicationservice.Publication, error) {
	stub.createCalls++
	stub.command = command
	stub.publication = publicationservice.Publication{ID: "publication-" + buildID, WorkspaceID: command.WorkspaceID}
	return stub.publication, nil
}

func TestApplicationEnqueueIsIdempotentAndBuildsDurably(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	builderCalls := 0
	application, err := NewApplication(db, packageBuilderFunc(func(_ context.Context, input BuildInput) (BuildResult, error) {
		builderCalls++
		require.Len(t, input.Parts, 1)
		require.Equal(t, "media:proof", input.Parts[0].SourceID)
		require.Equal(t, []byte("private image bytes"), input.Parts[0].Image.Data)
		require.Contains(t, input.Sources, SourceMaterial{
			ID: "url:1", Kind: "url", Label: "Release notes", Text: "private extracted page text",
		})
		require.Contains(t, input.Sources, SourceMaterial{
			ID: "media:proof", Kind: "image", Label: "proof.png", Text: "private extracted image text", Publishable: true,
		})
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
		SourceLoader: sourceLoaderFunc(func(_ context.Context, sourceURL string) (sourcecontext.Document, error) {
			require.Equal(t, "https://example.com/release", sourceURL)
			return sourcecontext.Document{Title: "Release notes", Text: "private extracted page text"}, nil
		}),
		AssetLoader: assetLoaderFunc(func(_ context.Context, workspaceID string, assets []BuildAsset) (LoadedAssets, error) {
			require.Equal(t, "workspace-1", workspaceID)
			require.Equal(t, []BuildAsset{{MediaID: "proof", Role: "artifact", MayPublish: true}}, assets)
			image := ai.Image{Data: []byte("private image bytes"), MIMEType: "image/png"}
			return LoadedAssets{Sources: []SourceMaterial{{
				ID: "media:proof", Kind: "image", Label: "proof.png", Text: "private extracted image text", Publishable: true,
			}}, Parts: []ai.MultimodalPart{{SourceID: "media:proof", Image: &image}}}, nil
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
			Sources: []SourceMaterial{{ID: "note:1", Kind: "text", Label: "Idea", Text: "A useful idea"}},
			Destinations: []Destination{{
				AccountID: "account-1", Platform: "x", Label: "Founder X",
				AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
			}},
			DestinationPolicy: DestinationPolicyRecommend,
		},
		ContextURLs:    []string{"https://example.com/release"},
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
	require.Equal(t, []ResolvedSource{
		{ID: "idea", Kind: "text", Label: "Original idea", Publishable: false},
		{ID: "note:1", Kind: "text", Label: "Idea", Publishable: false},
		{ID: "url:1", Kind: "url", Label: "Release notes", Publishable: false},
		{ID: "media:proof", Kind: "image", Label: "proof.png", Publishable: true},
	}, ready.Result.Sources)
	resultJSON, err := json.Marshal(ready.Result)
	require.NoError(t, err)
	require.NotContains(t, string(resultJSON), "private extracted image text")
	require.NotContains(t, string(resultJSON), "private extracted page text")
	require.NotContains(t, string(resultJSON), "A useful idea")
	require.Equal(t, 1, builderCalls)

	require.NoError(t, application.HandleJob(context.Background(), jobregistry.TypePublicationBuild, payload))
	require.Equal(t, 1, builderCalls, "replayed completed work must be a no-op")

	publications := &publicationApplicationStub{}
	committed, err := application.Commit(context.Background(), "user-1", first.ID, publications)
	require.NoError(t, err)
	require.Equal(t, BuildStateCommitted, committed.State)
	require.NotEmpty(t, committed.PublicationID)
	require.Equal(t, "publication-"+first.ID, committed.PublicationID)
	require.Equal(t, 1, publications.createCalls)

	replayed, err := application.Commit(context.Background(), "user-1", first.ID, publications)
	require.NoError(t, err)
	require.Equal(t, committed.PublicationID, replayed.PublicationID)
	require.Equal(t, 1, publications.createCalls, "a committed build must not create another Publication")
}

func TestApplicationFailureNeverReturnsOrStoresPrivateModelText(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, errors.New("private customer transcript and raw model output")
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	build, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "safe-error"))
	require.NoError(t, err)
	payload, err := EncodeBuildJobPayload(build.ID)
	require.NoError(t, err)
	err = application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload)
	require.EqualError(t, err, "OpenPost could not build this post. You can retry it.")
	require.NotContains(t, err.Error(), "private customer")
	require.Nil(t, errors.Unwrap(err), "private generation failures must not remain reachable from the queue error")

	failed, err := application.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateFailed, failed.State)
	require.Equal(t, "OpenPost could not build this post. You can retry it.", failed.ErrorMessage)
}

func TestApplicationReclaimsExpiredBuildLeaseAndFencesOldWorker(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	base := time.Date(2026, 8, 23, 15, 0, 0, 0, time.UTC)
	var nowUnix atomic.Int64
	nowUnix.Store(base.UnixNano())
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var calls atomic.Int32
	application, err := NewApplication(db, packageBuilderFunc(func(_ context.Context, _ BuildInput) (BuildResult, error) {
		call := calls.Add(1)
		if call == 1 {
			close(firstStarted)
			<-releaseFirst
			return BuildResult{CanonicalText: "stale worker result"}, nil
		}
		return BuildResult{CanonicalText: "reclaimed worker result"}, nil
	}), ApplicationConfig{
		Now: func() time.Time { return time.Unix(0, nowUnix.Load()).UTC() }, LeaseDuration: time.Minute,
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	build, _, err := application.Enqueue(t.Context(), testBuildRequest(base, "lease-reclaim"))
	require.NoError(t, err)
	payload, err := EncodeBuildJobPayload(build.ID)
	require.NoError(t, err)
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- application.HandleJob(context.Background(), jobregistry.TypePublicationBuild, payload)
	}()
	<-firstStarted
	nowUnix.Store(base.Add(2 * time.Minute).UnixNano())
	require.NoError(t, application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload))
	close(releaseFirst)
	require.NoError(t, <-firstDone)

	ready, err := application.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateReady, ready.State)
	require.Equal(t, "reclaimed worker result", ready.Result.CanonicalText)
	require.EqualValues(t, 2, calls.Load())
}

func TestApplicationRetryStealsProcessingFailureJobBeforeOldWorkerCanFenceIt(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 16, 15, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	build, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "retry-processing"))
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).Set("phase = ?", BuildPhaseFailed).
		Where("id = ?", build.ID).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobregistry.StatusProcessing).
		Set("attempts = 1").
		Set("locked_at = ?", now.Add(-time.Minute)).
		Set("locked_by = ?", "old-worker").
		Where("type = ? AND scope_id = ?", jobregistry.TypePublicationBuild, build.ID).
		Exec(t.Context())
	require.NoError(t, err)

	retried, err := application.Retry(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateQueued, retried.State)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).
		Where("type = ? AND scope_id = ?", jobregistry.TypePublicationBuild, build.ID).
		Scan(t.Context()))
	require.Equal(t, jobregistry.StatusPending, job.Status)
	require.Zero(t, job.Attempts)
	require.Empty(t, job.LockedBy)
	require.True(t, job.LockedAt.IsZero())
	require.Equal(t, now.Unix(), job.RunAt.Unix())

	oldWorkerFence, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobregistry.StatusFailed).
		Where("id = ? AND status = ? AND locked_by = ?", job.ID, jobregistry.StatusProcessing, "old-worker").
		Exec(t.Context())
	require.NoError(t, err)
	rows, err := oldWorkerFence.RowsAffected()
	require.NoError(t, err)
	require.Zero(t, rows, "the old worker no longer owns the requeued job")
}

func TestApplicationRetryCannotBypassActiveBuildCap(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 16, 30, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	failed, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "retry-limited"))
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).Set("phase = ?", BuildPhaseFailed).
		Where("id = ?", failed.ID).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobregistry.StatusFailed).
		Where("type = ? AND scope_id = ?", jobregistry.TypePublicationBuild, failed.ID).
		Exec(t.Context())
	require.NoError(t, err)
	for _, key := range []string{"retry-active-one", "retry-active-two", "retry-active-three"} {
		_, _, err = application.Enqueue(t.Context(), testBuildRequest(now, key))
		require.NoError(t, err)
	}

	_, err = application.Retry(t.Context(), "user-1", failed.ID)
	require.ErrorIs(t, err, ErrTooManyActiveBuilds)
	stored, err := application.Get(t.Context(), "user-1", failed.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateFailed, stored.State)
}

func newBuilderApplicationTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.Workspace)(nil),
		(*models.MediaAttachment)(nil),
		(*BuildRecord)(nil),
		(*buildAssetRecord)(nil),
		(*models.Job)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Test"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewCreateIndex().Index("publication_builds_idempotency_test_idx").Table("publication_builds").Column("workspace_id", "created_by_id", "idempotency_key").Unique().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, jobregistry.EnsureActiveDedupeIndex(ctx, db))
	return db
}

func testBuildRequest(now time.Time, idempotencyKey string) CreateBuildRequest {
	return CreateBuildRequest{
		WorkspaceID: "workspace-1", CreatedByID: "user-1", IdempotencyKey: idempotencyKey,
		Authority: workspaceaccess.StoredAuthority{UserID: "user-1", WorkspaceID: "workspace-1", AssuredAt: now},
		Input: BuildInput{
			Idea: "A real source idea.",
			Destinations: []Destination{{
				AccountID: "account-1", Platform: "x",
				AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
			}},
			DestinationPolicy: DestinationPolicyRecommend,
		},
	}
}
