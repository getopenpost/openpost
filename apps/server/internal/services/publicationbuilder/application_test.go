package publicationbuilder

import (
	"context"
	"database/sql"

	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/uptrace/bun/driver/sqliteshim"

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

func TestApplicationFailureNeverReturnsOrStoresPrivateModelText(t *testing.T) {
	privateFailure := errors.New("private customer transcript and raw model output")
	for expectedCode, failure := range map[string]error{
		"generation_failed":       privateFailure,
		"director_output_invalid": &generationFailure{code: "director_output_invalid", cause: privateFailure},
		"review_rejected":         &generationFailure{code: "review_rejected", cause: privateFailure},
		"generation_timeout":      fmt.Errorf("private context: %w", context.DeadlineExceeded),
	} {
		t.Run(expectedCode, func(t *testing.T) {
			db := newBuilderApplicationTestDB(t)
			now := time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC)
			application, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
				return BuildResult{}, failure
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
			var coded interface{ FailureCode() string }
			require.ErrorAs(t, err, &coded)
			require.Equal(t, expectedCode, coded.FailureCode())
			require.Nil(t, errors.Unwrap(err), "private generation failures must not remain reachable from the queue error")

			failed, err := application.Get(t.Context(), "user-1", build.ID)
			require.NoError(t, err)
			require.Equal(t, BuildStateFailed, failed.State)
			require.Equal(t, expectedCode, failed.ErrorCode)
			require.Equal(t, "OpenPost could not build this post. You can retry it.", failed.ErrorMessage)
		})
	}
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

func newBuilderApplicationTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared")
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
