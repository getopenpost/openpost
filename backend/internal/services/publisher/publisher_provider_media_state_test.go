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
	db        *bun.DB
	service   *Service
	storage   *fakePublisherStorage
	adapter   platform.Adapter
	encryptor *crypto.TokenEncryptor
}

func newPublisherMediaStateTestServer(t *testing.T, platformName string, adapter platform.Adapter) *publisherMediaStateTestServer {
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
		(*models.PostMediaDelivery)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionMediaDelivery)(nil),
		(*models.RenditionMediaDeliveryRelation)(nil),
		(*models.ProviderWriteAttempt)(nil),
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
	service.SetMediaStateEncryptor(encryptor)
	service.SetPublicMediaURL("https://media.openpost.test/media")
	enableSelfHostedPublisherReadiness(t, db, service, platformName, "account-1")

	return &publisherMediaStateTestServer{db: db, service: service, storage: storage, adapter: adapter, encryptor: encryptor}
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

func (s *publisherMediaStateTestServer) seedRenditionWithMedia(t *testing.T, publicationID, renditionID string, media models.MediaAttachment) (models.Publication, models.Rendition, models.SocialAccount) {
	t.Helper()
	if media.ID == "" {
		media.ID = "media-rendition"
	}
	if media.WorkspaceID == "" {
		media.WorkspaceID = "ws-1"
	}
	if media.FilePath == "" {
		media.FilePath = "media/" + media.ID
	}
	if media.MimeType == "" {
		media.MimeType = "video/mp4"
	}
	if media.ProcessingStatus == "" {
		media.ProcessingStatus = "ready"
	}
	if media.Size == 0 {
		media.Size = int64(len(s.storage.body))
	}
	now := time.Now().UTC()
	publication := models.Publication{
		ID: publicationID, WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch",
		SourceContent: "Launch", Status: models.PublicationStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}
	rendition := models.Rendition{
		ID: renditionID, PublicationID: publicationID, SocialAccountID: "account-1",
		Platform: "youtube", Profile: "video", Title: "Launch", Body: "Launch",
		SettingsJSON: `{"privacy":"private","category_id":"22"}`, Status: models.RenditionStatusScheduled,
		CreatedAt: now, UpdatedAt: now,
	}
	ctx := context.Background()
	_, err := s.db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&publication).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&rendition).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.RenditionMedia{RenditionID: renditionID, MediaID: media.ID}).Exec(ctx)
	require.NoError(t, err)
	account := models.SocialAccount{ID: "account-1", WorkspaceID: "ws-1", Platform: "youtube", AccountID: "youtube-account"}
	return publication, rendition, account
}

type fakeResumablePublisherAdapter struct {
	fakePublisherAdapter
	uploadCalls      int
	states           []platform.ResumableMediaUploadState
	thumbnailReaders []bool
}

func (f *fakeResumablePublisherAdapter) UploadMediaWithMetadata(context.Context, string, string, platform.UploadMediaRequest) (string, error) {
	return "", fmt.Errorf("blocking metadata upload must not be used")
}

func (f *fakeResumablePublisherAdapter) UploadMediaResumable(_ context.Context, _, _ string, req platform.UploadMediaRequest, state platform.ResumableMediaUploadState, checkpoint platform.MediaUploadCheckpoint) (string, error) {
	f.uploadCalls++
	f.states = append(f.states, state)
	f.thumbnailReaders = append(f.thumbnailReaders, req.ThumbnailReader != nil)
	if state.ProviderMediaID != "" {
		state.Status = platform.MediaUploadUploaded
		state.RetryClassification = platform.MediaRetryReconcile
		if err := checkpoint(state); err != nil {
			return "", err
		}
		return state.ProviderMediaID, nil
	}
	if f.uploadCalls == 1 {
		state.OpaqueState = `{"session_url":"https://upload.example/session-secret"}`
		state.UploadedBytes = 5
		state.TotalBytes = req.Size
		state.Status = platform.MediaUploadUploading
		state.RetryClassification = platform.MediaRetrySafeResume
		if err := checkpoint(state); err != nil {
			return "", err
		}
		return "", fmt.Errorf("simulated worker interruption")
	}
	if state.OpaqueState == "" || state.UploadedBytes != 5 {
		return "", fmt.Errorf("resume state was not restored: %#v", state)
	}
	state.ProviderMediaID = "resumed-provider-media"
	state.UploadedBytes = req.Size
	state.Status = platform.MediaUploadUploaded
	state.RetryClassification = platform.MediaRetryReconcile
	if err := checkpoint(state); err != nil {
		return "", err
	}
	return state.ProviderMediaID, nil
}

type secretLeakingResumablePublisherAdapter struct {
	fakePublisherAdapter
	sessionURL string
}

func (f *secretLeakingResumablePublisherAdapter) UploadMediaWithMetadata(context.Context, string, string, platform.UploadMediaRequest) (string, error) {
	return "", fmt.Errorf("blocking metadata upload must not be used")
}

func (f *secretLeakingResumablePublisherAdapter) UploadMediaResumable(_ context.Context, _, _ string, req platform.UploadMediaRequest, state platform.ResumableMediaUploadState, checkpoint platform.MediaUploadCheckpoint) (string, error) {
	state.OpaqueState = `{"session_url":"` + f.sessionURL + `"}`
	state.TotalBytes = req.Size
	state.Status = platform.MediaUploadUploading
	state.RetryClassification = platform.MediaRetrySafeResume
	if err := checkpoint(state); err != nil {
		return "", err
	}
	return "", fmt.Errorf("provider request to %s failed: connection reset", f.sessionURL)
}

func TestPublisherReusesProviderMediaStateOnDestinationRetry(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{preFenceErrors: []error{&platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"}}}
	srv := newPublisherMediaStateTestServer(t, "x", adapter)
	srv.seedPostWithMedia(t, "post-retry", models.MediaAttachment{
		ID:       "media-retry",
		FilePath: "uploads/retry.png",
		MimeType: "image/png",
	})

	err := srv.publishPost(t, "post-retry")

	require.Error(t, err)
	require.Equal(t, 1, adapter.uploadCalls)
	var state models.PostMediaDelivery
	require.NoError(t, srv.db.NewSelect().
		Model(&state).
		Where("post_id = ?", "post-retry").
		Where("social_account_id = ?", "account-1").
		Where("media_id = ?", "media-retry").
		Scan(context.Background()))
	require.Equal(t, providerMediaStatusReady, state.Status)
	require.Equal(t, "platform-media-id", state.ProviderMediaID)

	adapter.publishErr = nil
	err = srv.publishPost(t, "post-retry")

	require.NoError(t, err)
	require.Equal(t, 1, adapter.uploadCalls)
	require.Equal(t, 2, adapter.publishCalls)
	require.NotNil(t, adapter.lastRequest)
	require.Equal(t, []string{"platform-media-id"}, adapter.lastRequest.PlatformMediaIDs)
}

func TestPublisherDoesNotReplayAmbiguousNonResumableMediaUpload(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{uploadErr: context.DeadlineExceeded}
	srv := newPublisherMediaStateTestServer(t, "x", adapter)
	srv.seedPostWithMedia(t, "post-ambiguous-upload", models.MediaAttachment{
		ID: "media-ambiguous-upload", FilePath: "uploads/ambiguous.png", MimeType: "image/png",
	})

	require.Error(t, srv.publishPost(t, "post-ambiguous-upload"))
	require.Equal(t, 1, adapter.uploadCalls)
	_ = srv.publishPost(t, "post-ambiguous-upload")
	require.Equal(t, 1, adapter.uploadCalls, "an upload with an unknown external outcome must not be replayed")

	var delivery models.PostMediaDelivery
	require.NoError(t, srv.db.NewSelect().Model(&delivery).
		Where("post_id = ? AND social_account_id = ? AND media_id = ?", "post-ambiguous-upload", "account-1", "media-ambiguous-upload").
		Scan(t.Context()))
	require.Equal(t, providerMediaStatusFailed, delivery.Status)
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
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_media_deliveries").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestPublisherPersistsEncryptedRenditionUploadStateAndResumesAfterInterruption(t *testing.T) {
	t.Parallel()

	adapter := &fakeResumablePublisherAdapter{}
	srv := newPublisherMediaStateTestServer(t, "youtube", adapter)
	media := models.MediaAttachment{ID: "video-resume", WorkspaceID: "ws-1", FilePath: "uploads/video-resume.mp4", MimeType: "video/mp4", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready"}
	publication, rendition, account := srv.seedRenditionWithMedia(t, "publication-resume", "rendition-resume", media)

	_, err := srv.service.platformMediaIDForRendition(context.Background(), &publication, &rendition, &account, adapter, "access-token", media)
	require.ErrorContains(t, err, "simulated worker interruption")
	require.Equal(t, 1, adapter.uploadCalls)

	var interrupted models.RenditionMediaDelivery
	require.NoError(t, srv.db.NewSelect().Model(&interrupted).
		Where("rendition_id = ? AND media_id = ?", rendition.ID, media.ID).
		Scan(context.Background()))
	require.Equal(t, int64(5), interrupted.UploadedBytes)
	require.Equal(t, platform.MediaRetrySafeResume, platform.MediaRetryClassification(interrupted.RetryClassification))
	require.NotEmpty(t, interrupted.SessionStateEnc)
	require.NotContains(t, string(interrupted.SessionStateEnc), "session-secret")
	decrypted, err := srv.encryptor.Decrypt(interrupted.SessionStateEnc)
	require.NoError(t, err)
	require.Contains(t, decrypted, "session-secret")

	providerMediaID, err := srv.service.platformMediaIDForRendition(context.Background(), &publication, &rendition, &account, adapter, "access-token", media)
	require.NoError(t, err)
	require.Equal(t, "resumed-provider-media", providerMediaID)
	require.Equal(t, 2, adapter.uploadCalls)
	require.Len(t, adapter.states, 2)
	require.Equal(t, int64(5), adapter.states[1].UploadedBytes)
	require.NotEmpty(t, adapter.states[1].OpaqueState)

	var completed models.RenditionMediaDelivery
	require.NoError(t, srv.db.NewSelect().Model(&completed).
		Where("rendition_id = ? AND media_id = ?", rendition.ID, media.ID).
		Scan(context.Background()))
	require.Equal(t, "resumed-provider-media", completed.ProviderMediaID)
	require.Equal(t, string(platform.MediaUploadReady), completed.Status)
	require.Equal(t, string(platform.MediaRetryNone), completed.RetryClassification)
	require.Empty(t, completed.SessionStateEnc, "completed sessions must not retain bearer-style URLs")

	thumbnail := models.MediaAttachment{ID: "thumbnail-new", WorkspaceID: "ws-1", FilePath: "uploads/thumbnail-new.jpg", MimeType: "image/jpeg", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready"}
	_, err = srv.db.NewInsert().Model(&thumbnail).Exec(context.Background())
	require.NoError(t, err)
	rendition.SettingsJSON = `{"privacy":"private","category_id":"22","thumbnail_media_id":"thumbnail-new"}`
	_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("settings_json = ?", rendition.SettingsJSON).
		Where("id = ?", rendition.ID).
		Exec(context.Background())
	require.NoError(t, err)

	providerMediaID, err = srv.service.platformMediaIDForRendition(context.Background(), &publication, &rendition, &account, adapter, "access-token", media)
	require.NoError(t, err)
	require.Equal(t, "resumed-provider-media", providerMediaID)
	require.Equal(t, 3, adapter.uploadCalls, "changed related media must invalidate the ready cache")
	require.True(t, adapter.thumbnailReaders[2])
	var relation models.RenditionMediaDeliveryRelation
	require.NoError(t, srv.db.NewSelect().Model(&relation).
		Where("rendition_id = ? AND delivery_media_id = ? AND role = ?", rendition.ID, media.ID, "thumbnail").
		Scan(context.Background()))
	require.Equal(t, thumbnail.ID, relation.RelatedMediaID)
}

func TestPublisherRedactsResumableSessionURLFromPersistedAndReturnedErrors(t *testing.T) {
	t.Parallel()

	sessionURL := "https://upload.youtube.test/session?upload_id=top-secret"
	adapter := &secretLeakingResumablePublisherAdapter{sessionURL: sessionURL}
	srv := newPublisherMediaStateTestServer(t, "youtube", adapter)
	media := models.MediaAttachment{ID: "video-secret", WorkspaceID: "ws-1", FilePath: "uploads/video-secret.mp4", MimeType: "video/mp4", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready"}
	publication, rendition, account := srv.seedRenditionWithMedia(t, "publication-secret", "rendition-secret", media)

	_, err := srv.service.platformMediaIDForRendition(context.Background(), &publication, &rendition, &account, adapter, "access-token", media)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "top-secret")
	require.NotContains(t, err.Error(), sessionURL)

	var delivery models.RenditionMediaDelivery
	require.NoError(t, srv.db.NewSelect().Model(&delivery).
		Where("rendition_id = ? AND media_id = ?", rendition.ID, media.ID).
		Scan(context.Background()))
	require.NotContains(t, delivery.ErrorMessage, "top-secret")
	require.NotContains(t, delivery.ErrorMessage, sessionURL)
	require.Contains(t, delivery.ErrorMessage, "[redacted provider state]")
}

func TestPublisherDoesNotAutomaticallyRetryTerminalMediaDelivery(t *testing.T) {
	t.Parallel()

	adapter := &fakeResumablePublisherAdapter{}
	srv := newPublisherMediaStateTestServer(t, "youtube", adapter)
	media := models.MediaAttachment{ID: "video-terminal", WorkspaceID: "ws-1", FilePath: "uploads/video-terminal.mp4", MimeType: "video/mp4", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready"}
	publication, rendition, account := srv.seedRenditionWithMedia(t, "publication-terminal", "rendition-terminal", media)
	require.NoError(t, srv.service.saveRenditionMediaDelivery(context.Background(), &publication, &rendition, &account, media.ID, renditionMediaRelations{}, platform.ResumableMediaUploadState{
		Status:              platform.MediaUploadFailed,
		RetryClassification: platform.MediaRetryTerminal,
		TotalBytes:          media.Size,
	}, "provider rejected the media"))

	_, err := srv.service.platformMediaIDForRendition(context.Background(), &publication, &rendition, &account, adapter, "access-token", media)
	require.ErrorContains(t, err, "terminal")
	require.Zero(t, adapter.uploadCalls, "terminal delivery must not cause another provider write")
}

func TestPublisherRejectsRenditionMediaDeliveryForWrongAggregateBeforeUpload(t *testing.T) {
	t.Parallel()

	adapter := &fakeResumablePublisherAdapter{}
	srv := newPublisherMediaStateTestServer(t, "youtube", adapter)
	media := models.MediaAttachment{ID: "video-owned", WorkspaceID: "ws-1", FilePath: "uploads/video-owned.mp4", MimeType: "video/mp4", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready"}
	publication, rendition, account := srv.seedRenditionWithMedia(t, "publication-owned", "rendition-owned", media)

	foreignMedia := models.MediaAttachment{ID: "video-foreign", WorkspaceID: "workspace-foreign", FilePath: "uploads/video-foreign.mp4", MimeType: "video/mp4", Size: media.Size, ProcessingStatus: "ready"}
	_, err := srv.db.NewInsert().Model(&models.Workspace{ID: "workspace-foreign", Name: "Foreign"}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&foreignMedia).Exec(context.Background())
	require.NoError(t, err)

	_, err = srv.service.platformMediaIDForRendition(context.Background(), &publication, &rendition, &account, adapter, "access-token", foreignMedia)
	require.ErrorContains(t, err, "does not belong to rendition")
	require.Zero(t, adapter.uploadCalls, "ownership must fail before any provider mutation")

	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("rendition_media_deliveries").Scan(context.Background(), &count))
	require.Zero(t, count)
}
