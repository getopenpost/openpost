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
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type publisherMediaStateTestServer struct {
	db      *bun.DB
	service *Service
	storage *fakePublisherStorage
	adapter *fakePublisherAdapter
}

func newPublisherMediaStateTestServer(t *testing.T, platformName string, adapter *fakePublisherAdapter) *publisherMediaStateTestServer {
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
		(*models.ProviderMediaState)(nil),
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
		Platform:       platformName,
		AccountID:      platformName + "-account",
		Slug:           platformName + "-account",
		AccessTokenEnc: encAccess,
		IsActive:       true,
		CreatedAt:      time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	manager := tokenmanager.NewTokenManager(db, encryptor)
	manager.SetProvider(platformName, adapter)
	storage := &fakePublisherStorage{body: "stored-media"}
	service := NewService(db, manager)
	service.SetProvider(platformName, adapter)
	service.SetStorage(storage)
	service.SetPublicMediaURL("https://media.openpost.test/media")

	return &publisherMediaStateTestServer{db: db, service: service, storage: storage, adapter: adapter}
}

func (s *publisherMediaStateTestServer) seedPostWithMedia(t *testing.T, postID string, media models.MediaAttachment) {
	t.Helper()

	if media.ID == "" {
		media.ID = "media-1"
	}
	if media.WorkspaceID == "" {
		media.WorkspaceID = "ws-1"
	}
	if media.FilePath == "" {
		media.FilePath = "media/" + media.ID
	}
	if media.MimeType == "" {
		media.MimeType = "image/png"
	}
	if media.ProcessingStatus == "" {
		media.ProcessingStatus = "ready"
	}
	if media.OriginalFilename == "" {
		media.OriginalFilename = media.ID
	}

	ctx := context.Background()
	_, err := s.db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.Post{
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
	_, err = s.db.NewInsert().Model(&models.PostMedia{
		PostID:       postID,
		MediaID:      media.ID,
		DisplayOrder: 0,
	}).Exec(ctx)
	require.NoError(t, err)
}

func (s *publisherMediaStateTestServer) publishPost(t *testing.T, postID string) error {
	t.Helper()

	payload, err := json.Marshal(map[string]string{"post_id": postID})
	require.NoError(t, err)
	return s.service.HandlePublishJob(context.Background(), string(payload))
}

func TestPublisherReusesProviderMediaStateOnDestinationRetry(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{publishErr: &platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"}}
	srv := newPublisherMediaStateTestServer(t, "x", adapter)
	srv.seedPostWithMedia(t, "post-retry", models.MediaAttachment{
		ID:       "media-retry",
		FilePath: "uploads/retry.png",
		MimeType: "image/png",
	})

	err := srv.publishPost(t, "post-retry")

	require.Error(t, err)
	require.Equal(t, 1, adapter.uploadCalls)
	var state models.ProviderMediaState
	require.NoError(t, srv.db.NewSelect().
		Model(&state).
		Where("post_id = ?", "post-retry").
		Where("social_account_id = ?", "account-1").
		Where("media_id = ?", "media-retry").
		Scan(context.Background()))
	require.Equal(t, providerMediaStatusReady, state.Status)
	require.Equal(t, "platform-media-id", state.PlatformMediaID)

	adapter.publishErr = nil
	err = srv.publishPost(t, "post-retry")

	require.NoError(t, err)
	require.Equal(t, 1, adapter.uploadCalls)
	require.Equal(t, 2, adapter.publishCalls)
	require.NotNil(t, adapter.lastRequest)
	require.Equal(t, []string{"platform-media-id"}, adapter.lastRequest.PlatformMediaIDs)
}

func TestPublisherDoesNotPersistProviderMediaStateForPublicURLProviders(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{}
	srv := newPublisherMediaStateTestServer(t, "tiktok", adapter)
	srv.seedPostWithMedia(t, "post-public-url", models.MediaAttachment{
		ID:       "media-video",
		FilePath: "uploads/video.mp4",
		MimeType: "video/mp4",
	})

	err := srv.publishPost(t, "post-public-url")

	require.NoError(t, err)
	require.Equal(t, 0, adapter.uploadCalls)
	require.Empty(t, srv.storage.opened)
	require.NotNil(t, adapter.lastRequest)
	require.Equal(t, []string{"https://media.openpost.test/media/media-video.mp4"}, adapter.lastRequest.PlatformMediaIDs)
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("provider_media_states").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}
