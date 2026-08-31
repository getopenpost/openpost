package publicationbuilder

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
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

type progressPackageBuilderFunc func(context.Context, BuildInput, func(string) error) (BuildResult, error)

func (fn progressPackageBuilderFunc) Build(context.Context, BuildInput) (BuildResult, error) {
	return BuildResult{}, errors.New("progress-aware builder fallback must not run")
}

func (fn progressPackageBuilderFunc) BuildWithProgress(
	ctx context.Context,
	input BuildInput,
	report func(string) error,
) (BuildResult, error) {
	return fn(ctx, input, report)
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

func TestApplicationStopsAtTheNextPhaseAfterCancellation(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 13, 0, 0, 0, time.UTC)
	buildID := ""
	application, err := NewApplication(db, progressPackageBuilderFunc(func(
		ctx context.Context,
		_ BuildInput,
		report func(string) error,
	) (BuildResult, error) {
		require.NoError(t, report(BuildPhaseDrafting))
		_, updateErr := db.NewUpdate().Model((*BuildRecord)(nil)).
			Set("state = ?", BuildStateCancelled).
			Set("phase = ?", BuildPhaseCancelled).
			Where("id = ?", buildID).
			Exec(ctx)
		require.NoError(t, updateErr)
		err := report(BuildPhaseReviewing)
		require.ErrorIs(t, err, errBuildStopped)
		return BuildResult{}, err
	}), ApplicationConfig{
		Model: "test-model", Now: func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)

	build, _, err := application.Enqueue(t.Context(), CreateBuildRequest{
		WorkspaceID: "workspace-1", CreatedByID: "user-1", IdempotencyKey: "cancel-progress",
		Authority: workspaceaccess.StoredAuthority{UserID: "user-1", WorkspaceID: "workspace-1", AssuredAt: now},
		Input: BuildInput{
			Idea: "A real source idea.",
			Destinations: []Destination{{
				AccountID: "x-1", Platform: "x",
				AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
			}},
		},
	})
	require.NoError(t, err)
	buildID = build.ID
	payload, err := EncodeBuildJobPayload(build.ID)
	require.NoError(t, err)
	require.NoError(t, application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload))

	cancelled, err := application.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateCancelled, cancelled.State)
	require.Equal(t, BuildPhaseCancelled, cancelled.Phase)
}

func TestCommitRejectsSelectedSourceMediaThatBecameUnavailable(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*bun.DB) error
	}{
		{
			name: "trashed",
			mutate: func(db *bun.DB) error {
				_, err := db.NewUpdate().Model((*models.MediaAttachment)(nil)).
					Set("trashed_at = ?", time.Now().UTC()).
					Where("id = ?", "proof").
					Exec(t.Context())
				return err
			},
		},
		{
			name: "not ready",
			mutate: func(db *bun.DB) error {
				_, err := db.NewUpdate().Model((*models.MediaAttachment)(nil)).
					Set("processing_status = ?", "failed").
					Where("id = ?", "proof").
					Exec(t.Context())
				return err
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := newBuilderApplicationTestDB(t)
			now := time.Date(2026, 8, 23, 13, 0, 0, 0, time.UTC)
			_, err := db.NewInsert().Model(&models.MediaAttachment{
				ID: "proof", WorkspaceID: "workspace-1", FilePath: "proof.png",
				MimeType: "image/png", ProcessingStatus: "ready", CreatedAt: now,
			}).Exec(t.Context())
			require.NoError(t, err)
			application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
				return BuildResult{}, nil
			}), ApplicationConfig{
				Now:             func() time.Time { return now },
				AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
			})
			require.NoError(t, err)
			request := testBuildRequest(now, "unavailable-"+strings.ReplaceAll(test.name, " ", "-"))
			request.Assets = []BuildAsset{{MediaID: "proof", Role: "evidence", MayPublish: true}}
			build, _, err := application.Enqueue(t.Context(), request)
			require.NoError(t, err)
			resultJSON, err := json.Marshal(BuildResult{
				CanonicalText: "A built post.",
				Destinations: []DestinationPlan{{
					AccountID: "account-1", Platform: "x", OutputProfile: "x.thread",
					Segments: []SegmentPlan{{Body: "A built post."}},
					Media: MediaPlan{
						Treatment: "use_source", Role: "proof", Brief: "Use the proof.", SourceRef: "media:proof",
					},
				}},
			})
			require.NoError(t, err)
			_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
				Set("state = ?", BuildStateReady).
				Set("phase = ?", BuildPhaseReady).
				Set("result_json = ?", string(resultJSON)).
				Where("id = ?", build.ID).
				Exec(t.Context())
			require.NoError(t, err)
			require.NoError(t, test.mutate(db))

			publications := &publicationApplicationStub{}
			_, err = application.Commit(t.Context(), "user-1", build.ID, publications)
			require.ErrorIs(t, err, ErrBuildSourceUnavailable)
			require.Zero(t, publications.createCalls)
			stored, getErr := application.Get(t.Context(), "user-1", build.ID)
			require.NoError(t, getErr)
			require.Equal(t, BuildStateReady, stored.State)
			require.Equal(t, BuildPhaseReady, stored.Phase)
		})
	}
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

func TestApplicationDefersDuplicateDeliveryWhileBuildLeaseIsActive(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 15, 30, 0, 0, time.UTC)
	var builderCalls int
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		builderCalls++
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	build, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "lease-active"))
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateBuilding).
		Set("phase = ?", BuildPhaseDirecting).
		Set("lease_token = ?", "active-worker").
		Set("lease_expires_at = ?", now.Add(time.Minute)).
		Where("id = ?", build.ID).
		Exec(t.Context())
	require.NoError(t, err)
	payload, err := EncodeBuildJobPayload(build.ID)
	require.NoError(t, err)

	err = application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload)
	require.ErrorIs(t, err, ErrBuildLeaseActive)
	require.Zero(t, builderCalls)
	stored, err := application.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateBuilding, stored.State)
}

func TestApplicationRetryIsIdempotentAndKeepsRunnableJob(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 16, 0, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	build, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "retry-runnable"))
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).Set("phase = ?", BuildPhaseFailed).
		Where("id = ?", build.ID).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobregistry.StatusFailed).
		Where("type = ? AND scope_id = ?", jobregistry.TypePublicationBuild, build.ID).
		Exec(t.Context())
	require.NoError(t, err)

	first, err := application.Retry(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	second, err := application.Retry(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateQueued, first.State)
	require.Equal(t, first.ID, second.ID)
	active, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND scope_id = ?", jobregistry.TypePublicationBuild, build.ID).
		Where("status IN (?, ?)", jobregistry.StatusPending, jobregistry.StatusProcessing).
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, active)
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

func TestApplicationAutomaticRetryWaitsForActiveBuildSlot(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 16, 45, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	failed, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "auto-retry-limited"))
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("state = ?", BuildStateFailed).Set("phase = ?", BuildPhaseFailed).
		Where("id = ?", failed.ID).Exec(t.Context())
	require.NoError(t, err)
	for _, key := range []string{"auto-active-one", "auto-active-two", "auto-active-three"} {
		_, _, err = application.Enqueue(t.Context(), testBuildRequest(now, key))
		require.NoError(t, err)
	}
	payload, err := EncodeBuildJobPayload(failed.ID)
	require.NoError(t, err)
	err = application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload)
	require.ErrorIs(t, err, ErrTooManyActiveBuilds)
	stored, err := application.Get(t.Context(), "user-1", failed.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateFailed, stored.State)
}

func TestApplicationCapsActiveBuildsAfterIdempotentReplay(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 17, 0, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	var first Build
	for index, key := range []string{"active-one", "active-two", "active-three"} {
		build, created, enqueueErr := application.Enqueue(t.Context(), testBuildRequest(now, key))
		require.NoError(t, enqueueErr)
		require.True(t, created)
		if index == 0 {
			first = build
		}
	}
	replayed, created, err := application.Enqueue(t.Context(), testBuildRequest(now, "active-one"))
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, first.ID, replayed.ID)
	_, _, err = application.Enqueue(t.Context(), testBuildRequest(now, "active-four"))
	require.ErrorIs(t, err, ErrTooManyActiveBuilds)
}

func TestApplicationSerializesConcurrentActiveBuildAdmission(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 17, 30, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)

	const requests = 8
	start := make(chan struct{})
	errorsByRequest := make(chan error, requests)
	var ready sync.WaitGroup
	ready.Add(requests)
	for index := range requests {
		go func() {
			ready.Done()
			<-start
			_, _, enqueueErr := application.Enqueue(
				context.Background(),
				testBuildRequest(now, fmt.Sprintf("concurrent-%02d", index)),
			)
			errorsByRequest <- enqueueErr
		}()
	}
	ready.Wait()
	close(start)
	admitted := 0
	limited := 0
	for range requests {
		enqueueErr := <-errorsByRequest
		switch {
		case enqueueErr == nil:
			admitted++
		case errors.Is(enqueueErr, ErrTooManyActiveBuilds):
			limited++
		default:
			require.NoError(t, enqueueErr)
		}
	}
	require.Equal(t, maxActiveBuildsPerUser, admitted)
	require.Equal(t, requests-maxActiveBuildsPerUser, limited)
}

func TestApplicationReportsSafeSourceIndex(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 18, 0, 0, 0, time.UTC)
	application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, errors.New("builder must not run")
	}), ApplicationConfig{
		Now:             func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
		SourceLoader: sourceLoaderFunc(func(_ context.Context, sourceURL string) (sourcecontext.Document, error) {
			if strings.Contains(sourceURL, "second") {
				return sourcecontext.Document{}, errors.New("secret URL token and response body")
			}
			return sourcecontext.Document{Title: "First", Text: "First source"}, nil
		}),
	})
	require.NoError(t, err)
	request := testBuildRequest(now, "source-index")
	request.ContextURLs = []string{"https://example.com/first", "https://example.com/second?secret=1"}
	build, _, err := application.Enqueue(t.Context(), request)
	require.NoError(t, err)
	payload, err := EncodeBuildJobPayload(build.ID)
	require.NoError(t, err)
	err = application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload)
	require.EqualError(t, err, "OpenPost could not read selected link 2.")
	require.NotContains(t, err.Error(), "secret")
	failed, err := application.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, "OpenPost could not read selected link 2.", failed.ErrorMessage)
}

func TestResolvedSourceIndexIncludesIdeaWithoutItsContent(t *testing.T) {
	t.Parallel()

	index := resolvedSourceIndex(BuildInput{
		Idea: "private original idea text",
		Sources: []SourceMaterial{
			{ID: "idea", Kind: "text", Label: "unsafe duplicate label", Text: "private duplicate"},
			{ID: "url:1", Kind: "url", Label: "Public reference", Text: "private extracted source"},
		},
	})
	require.Equal(t, []ResolvedSource{
		{ID: "idea", Kind: "text", Label: "Original idea"},
		{ID: "url:1", Kind: "url", Label: "Public reference"},
	}, index)
	encoded, err := json.Marshal(index)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private")
}

func TestApplicationPersistsBoundedGenerationUsage(t *testing.T) {
	db := newBuilderApplicationTestDB(t)
	now := time.Date(2026, 8, 23, 19, 0, 0, 0, time.UTC)
	cost := 0.012
	application, err := NewApplication(db, packageBuilderFunc(func(ctx context.Context, _ BuildInput) (BuildResult, error) {
		recordGeneration(ctx, "director", "", ai.GenerateResult{
			Model: "actual-model", RequestID: "request-director",
			Usage: ai.Usage{InputTokens: 10, OutputTokens: 5, TotalTokens: 15, CostUSD: &cost},
		})
		recordGeneration(ctx, "adapter", "account-1", ai.GenerateResult{
			Model: "actual-model", RequestID: "request-adapter",
			Usage: ai.Usage{InputTokens: 20, OutputTokens: 8, TotalTokens: 28},
		})
		return BuildResult{CanonicalText: "Built"}, nil
	}), ApplicationConfig{
		Model: "configured-model", Now: func() time.Time { return now },
		AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil },
	})
	require.NoError(t, err)
	build, _, err := application.Enqueue(t.Context(), testBuildRequest(now, "usage-trace"))
	require.NoError(t, err)
	payload, err := EncodeBuildJobPayload(build.ID)
	require.NoError(t, err)
	require.NoError(t, application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, payload))
	var record BuildRecord
	require.NoError(t, db.NewSelect().Model(&record).Where("id = ?", build.ID).Scan(t.Context()))
	require.Equal(t, "actual-model", record.Model)
	require.Equal(t, "request-director", record.ProviderRequestID)
	var usage generationUsage
	require.NoError(t, json.Unmarshal([]byte(record.UsageJSON), &usage))
	require.Len(t, usage.Calls, 2)
	require.EqualValues(t, 30, usage.InputTokens)
	require.EqualValues(t, 13, usage.OutputTokens)
	require.EqualValues(t, 43, usage.TotalTokens)
	require.InDelta(t, cost, usage.CostUSD, 0.000001)
}

func TestPublicationCreateCommandKeepsOneCanonicalSourceAndNativeThreads(t *testing.T) {
	t.Parallel()

	command := publicationCreateCommand(
		"workspace-1",
		persistedBuildRequest{
			SocialSetID: "founder-accounts", VoiceProfileID: "rodrigo",
			Input: BuildInput{Destinations: []Destination{
				{AccountID: "x-1", Voice: VoiceSnapshot{ID: "rodrigo", Name: "Rodrigo", Revision: 3}},
				{AccountID: "linkedin-1", Voice: VoiceSnapshot{ID: "rodrigo", Name: "Rodrigo", Revision: 3}},
			}},
			Assets: []BuildAsset{
				{MediaID: "proof", Role: "evidence", MayPublish: true},
				{MediaID: "unused-image", Role: "context", MayPublish: true},
				{MediaID: "private-note", Role: "context", MayPublish: false},
			},
		},
		BuildResult{
			CanonicalText: "The product improved when we removed code.",
			Direction: DirectorPlan{
				Thesis: "Less code made the product better.", Outcome: "authority",
				Audience: "technical founders", Angle: "show the deletion", Route: "artifact_led",
				Media:  MediaPlan{Treatment: "use_source", Role: "proof", Brief: "Show the diff.", SourceRef: "media:proof"},
				Claims: []Claim{{Text: "The code was removed.", Status: "supported", SourceRefs: []string{"artifact:1"}}},
			},
			Destinations: []DestinationPlan{
				{
					AccountID: "x-1", Platform: "x", OutputProfile: "x.thread",
					Segments: []SegmentPlan{{Body: "deleted 15,000 lines."}, {Body: "the product got better."}, {Body: "complexity has to earn its keep."}},
					Media:    MediaPlan{Treatment: "use_source", Role: "proof", Brief: "Show the diff.", SourceRef: "media:proof"},
					Claims:   []Claim{{Text: "15,000 lines were deleted.", Status: "user_asserted", SourceRefs: []string{"idea"}}},
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

	require.Equal(t, "founder-accounts", command.SocialSetID)
	require.Len(t, command.Segments, 1, "the shared source stays one canonical idea")
	require.Empty(t, command.Media, "All channels must remain media-free")
	require.Empty(t, command.Segments[0].Media, "the canonical segment must remain media-free")
	require.Len(t, command.Renditions, 2)
	require.Len(t, command.Renditions[0].Segments, 3)
	for _, segment := range command.Renditions[0].Segments {
		require.Equal(t, "builder-source", segment.PublicationSegmentID)
	}
	require.False(t, *command.Renditions[0].Segments[0].MediaInherited)
	require.Equal(t, []string{"proof"}, []string{command.Renditions[0].Segments[0].Media[0].MediaID})
	require.False(t, *command.Renditions[0].Segments[1].MediaInherited)
	require.Empty(t, command.Renditions[0].Segments[1].Media)
	require.False(t, *command.Renditions[1].Segments[0].MediaInherited)
	require.Empty(t, command.Renditions[1].Segments[0].Media)
	builderMetadata := command.Metadata["builder"].(map[string]any)
	require.Equal(t, []map[string]any{
		{"account_id": "x-1", "id": "rodrigo", "name": "Rodrigo", "revision": 3},
		{"account_id": "linkedin-1", "id": "rodrigo", "name": "Rodrigo", "revision": 3},
	}, builderMetadata["voices"])
	require.Equal(t, []Claim{
		{Text: "The code was removed.", Status: "supported", SourceRefs: []string{"artifact:1"}},
		{Text: "15,000 lines were deleted.", Status: "user_asserted", SourceRefs: []string{"idea"}},
	}, builderMetadata["claims"])
}

func TestPublicationCreateCommandDoesNotPublishDirectorOnlySource(t *testing.T) {
	t.Parallel()

	command := publicationCreateCommand(
		"workspace-1",
		persistedBuildRequest{Assets: []BuildAsset{{MediaID: "proof", Role: "evidence", MayPublish: true}}},
		BuildResult{
			CanonicalText: "Canonical draft",
			Direction: DirectorPlan{Media: MediaPlan{
				Treatment: "use_source", SourceRef: "media:proof",
			}},
			Destinations: []DestinationPlan{{
				AccountID: "x-1", Platform: "x", OutputProfile: "x.short_text",
				Segments: []SegmentPlan{{Body: "Destination draft"}},
				Media:    MediaPlan{Treatment: "none"},
			}},
		},
		"build-1",
	)

	require.Empty(t, command.Media)
	require.Empty(t, command.Segments[0].Media)
	require.Empty(t, command.Renditions[0].Segments[0].Media)
}

func TestPublicationCreateCommandKeepsContextURLsAsEvidenceOnly(t *testing.T) {
	t.Parallel()

	command := publicationCreateCommand(
		"workspace-1",
		persistedBuildRequest{ContextURLs: []string{"https://competitor.example/release"}},
		BuildResult{
			CanonicalText: "A post informed by outside evidence.",
			Destinations: []DestinationPlan{{
				AccountID: "x-1", Platform: "x", OutputProfile: "x.short_text",
				Segments: []SegmentPlan{{Body: "Destination draft"}},
				Media:    MediaPlan{Treatment: "none"},
			}},
		},
		"build-1",
	)

	require.Empty(t, command.SourceURL, "context-only evidence must not become a link share")
}

func TestBuildMediaForPlanDoesNotPublishEditorInputs(t *testing.T) {
	t.Parallel()

	assets := []BuildAsset{{MediaID: "proof", Role: "evidence", MayPublish: true}}
	reference := "media:proof"

	require.Empty(t, buildMediaForPlan(assets, MediaPlan{
		Treatment: "annotate_source", SourceRef: reference,
	}))
	require.Empty(t, buildMediaForPlan(assets, MediaPlan{
		Treatment: "edit_existing_video", SourceRef: reference,
	}))
	require.Equal(t, "proof", buildMediaForPlan(assets, MediaPlan{
		Treatment: "use_source", SourceRef: reference,
	})[0].MediaID)
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
