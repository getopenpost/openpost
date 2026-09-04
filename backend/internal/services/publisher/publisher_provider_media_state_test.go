package publisher

import (
	"context"
	"database/sql"
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

//nolint:unparam // platformName is a test seam; most fixtures use youtube but the helper keeps the caller explicit.
func newPublisherMediaStateTestServer(t *testing.T, platformName string, adapter platform.Adapter) *publisherMediaStateTestServer {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
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
