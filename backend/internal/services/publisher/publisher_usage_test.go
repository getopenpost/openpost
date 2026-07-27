package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type publisherUsageTestServer struct {
	db      *bun.DB
	service *Service
	usage   *usage.Service
	adapter *fakePublisherAdapter
}

func newPublisherUsageTestServer(t *testing.T, adapter *fakePublisherAdapter) *publisherUsageTestServer {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.MediaAttachment)(nil),
		(*models.UsageCounter)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})

	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	encAccess, err := encryptor.Encrypt("access-token")
	require.NoError(t, err)

	ctx := context.Background()
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-1",
		WorkspaceID:    "ws-1",
		Platform:       "x",
		AccountID:      "x-account",
		Slug:           "x-account",
		AccessTokenEnc: encAccess,
		IsActive:       true,
		CreatedAt:      time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	manager := tokenmanager.NewTokenManager(db, encryptor)
	manager.SetProvider("x", adapter)
	usageSvc := usage.NewService(db)
	service := NewService(db, manager)
	service.SetProvider("x", adapter)
	service.SetUsage(usageSvc)

	return &publisherUsageTestServer{db: db, service: service, usage: usageSvc, adapter: adapter}
}

func (s *publisherUsageTestServer) seedPost(t *testing.T, postID string) {
	t.Helper()

	ctx := context.Background()
	_, err := s.db.NewInsert().Model(&models.Post{
		ID:          postID,
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Launch update",
		Status:      models.PostStatusScheduled,
		ScheduledAt: time.Now().UTC(),
		CreatedAt:   time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.PostDestination{
		ID:              "dest-" + postID,
		PostID:          postID,
		SocialAccountID: "account-1",
		Status:          "pending",
	}).Exec(ctx)
	require.NoError(t, err)
}

func (s *publisherUsageTestServer) publishPost(t *testing.T, postID string) error {
	t.Helper()

	payload, err := json.Marshal(map[string]string{"post_id": postID})
	require.NoError(t, err)
	return s.service.HandlePublishJob(context.Background(), string(payload))
}

func (s *publisherUsageTestServer) setQuota(snapshot entitlements.PlanSnapshot) {
	s.service.SetEntitlement(entitlements.NewStaticService(snapshot))
}

func TestPublisherRecordsPublishedPostAndProviderWriteUsage(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-1"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.seedPost(t, "post-1")

	err := srv.publishPost(t, "post-1")

	require.NoError(t, err)
	require.Equal(t, 1, adapter.publishCalls)
	published, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(1), published)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(1), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(context.Background()))
	require.Equal(t, models.PostStatusPublished, post.Status)
}

func TestPublisherRejectsWhenPublishedPostQuotaExceeded(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-1"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.setQuota(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitPublishedPostsMonthly: 0,
		},
	})
	srv.seedPost(t, "post-quota")

	err := srv.publishPost(t, "post-quota")

	require.NoError(t, err)
	require.Equal(t, 0, adapter.publishCalls)
	published, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), published)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-quota").Scan(context.Background()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", "post-quota").Scan(context.Background()))
	require.Equal(t, FailureBillingRequired, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}

func TestPublisherRejectsWhenProviderWriteQuotaExceeded(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-1"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.setQuota(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitProviderWriteCallsMonthly: 0,
		},
	})
	srv.seedPost(t, "post-write-quota")

	err := srv.publishPost(t, "post-write-quota")

	require.NoError(t, err)
	require.Equal(t, 0, adapter.publishCalls)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-write-quota").Scan(context.Background()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", "post-write-quota").Scan(context.Background()))
	require.Equal(t, FailureBillingRequired, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}

func TestPublisherRecordsProviderWriteUsageOnPublishFailure(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{publishErr: errFakePublishFailed}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.seedPost(t, "post-2")

	err := srv.publishPost(t, "post-2")

	require.NoError(t, err)
	require.Equal(t, 1, adapter.publishCalls)
	published, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), published)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(1), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-2").Scan(context.Background()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", "post-2").Scan(context.Background()))
	require.Equal(t, FailureUnknown, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}
