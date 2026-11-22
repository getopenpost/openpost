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
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/testdb"
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

	db := testdb.NewSQLiteBase(t)

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
	enableSelfHostedPublisherReadiness(t, db, service, "x", "account-1")

	return &publisherUsageTestServer{db: db, service: service, usage: usageSvc, adapter: adapter}
}

func TestQueuedMissingAttachmentStopsBeforeProviderWrite(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	_, err := srv.db.NewInsert().Model(&models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Watch the demo", SettingsJSON: `{}`}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.RenditionSegment{ID: "output", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: "Watch the demo", SettingsJSON: `{"attachment_requirement":{"kind":"video","brief":"Show the interaction"}}`, Status: models.RenditionStatusReady}).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusFailed, rendition.Status)
	require.Equal(t, FailureValidation, rendition.ErrorKind)
	require.Equal(t, FailureActionEdit, rendition.ErrorAction)
	require.Zero(t, adapter.publishCalls)
}

func TestQueuedPublicationResolvesLinkFromAuthoredAccountBodyBeforeWrite(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "link-post"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	source := models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Shared https://shared.example", SettingsJSON: `{"link":{"destinations":{"account-1":{"mode":"post"}}}}`}
	_, err := srv.db.NewInsert().Model(&source).Exec(t.Context())
	require.NoError(t, err)
	body := "Account https://account.example"
	segment := models.RenditionSegment{ID: "output", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: body, BodyOverride: &body, SettingsJSON: `{"url":"https://stale.example"}`, Status: models.RenditionStatusReady}
	_, err = srv.db.NewInsert().Model(&segment).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	require.Equal(t, 1, adapter.publishCalls)
	require.Equal(t, body, adapter.lastRequest.Content)
	require.Equal(t, "https://account.example", adapter.lastRequest.Settings["url"])
}

func TestQueuedInvalidLinkChoiceStopsBeforeProviderWrite(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	source := models.PublicationSegment{ID: "source", PublicationID: "publication-1", Body: "Caption", SettingsJSON: `{"link":{"destinations":{"account-1":{"mode":"custom","url":"javascript:invalid"}}}}`}
	_, err := srv.db.NewInsert().Model(&source).Exec(t.Context())
	require.NoError(t, err)
	segment := models.RenditionSegment{ID: "output", RenditionID: "rendition-1", PublicationSegmentID: "source", Body: "Caption", SettingsJSON: `{}`, Status: models.RenditionStatusReady}
	_, err = srv.db.NewInsert().Model(&segment).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusFailed, rendition.Status)
	require.Equal(t, FailureValidation, rendition.ErrorKind)
	require.Equal(t, FailureActionEdit, rendition.ErrorAction)
	require.Zero(t, adapter.publishCalls)
}

func TestLoadRenditionSegmentMediaPrefersContextualAltText(t *testing.T) {
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	ctx := context.Background()
	for _, model := range []interface{}{(*models.MediaAttachment)(nil), (*models.RenditionSegmentMedia)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&[]models.MediaAttachment{
		{ID: "image-1", WorkspaceID: "workspace-1", OriginalFilename: "image-1.png", MimeType: "image/png", Size: 1024, AltText: "Library description"},
		{ID: "image-2", WorkspaceID: "workspace-1", OriginalFilename: "image-2.png", MimeType: "image/png", Size: 1024, AltText: "Second library description"},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.RenditionSegmentMedia{
		{RenditionSegmentID: "segment-1", MediaID: "image-1", Role: "attachment", DisplayOrder: 0, AltText: "Publication description", SettingsJSON: "{}"},
		{RenditionSegmentID: "segment-1", MediaID: "image-2", Role: "attachment", DisplayOrder: 1, SettingsJSON: "{}"},
	}).Exec(ctx)
	require.NoError(t, err)

	_, altTexts, _, err := NewService(db, nil).loadRenditionSegmentMedia(ctx, "segment-1")
	require.NoError(t, err)
	require.Equal(t, []string{"Publication description", "Second library description"}, altTexts)
}
