package publisher

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
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
