package externalwebhooks

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestPublicationEventQueuesAndDeliversSignedWebhook(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := newWebhookTestDB(t)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.test", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "One", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppInstallation{ID: "installation-1", ApplicationID: "app-1", SponsorUserID: "user-1", Scopes: "events:subscribe", TokenFamilyID: "family-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppWorkspaceGrant{InstallationID: "installation-1", WorkspaceID: "ws-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)

	var received struct{ signature, timestamp, delivery, event, body string }
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, readErr := io.ReadAll(r.Body)
		require.NoError(t, readErr)
		received.signature = r.Header.Get("X-OpenPost-Signature")
		received.timestamp = r.Header.Get("X-OpenPost-Timestamp")
		received.delivery = r.Header.Get("X-OpenPost-Delivery")
		received.event = r.Header.Get("X-OpenPost-Event")
		received.body = string(body)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	service := NewService(db, servicecrypto.NewTokenEncryptor("test-webhook-key"))
	service.SetHTTPClient(server.Client())
	service.SetURLValidator(func(context.Context, *url.URL) error { return nil })
	created, err := service.Create(ctx, CreateInput{InstallationID: "installation-1", WorkspaceID: "ws-1", URL: server.URL, EventTypes: []string{"published"}})
	require.NoError(t, err)
	require.NotEmpty(t, created.Secret)

	event := models.PublicationLifecycleEvent{ID: "event-1", WorkspaceID: "ws-1", PublicationID: "publication-1", Type: "published", Status: "succeeded", MetadataJSON: `{}`, CreatedAt: now}
	require.NoError(t, EnqueueEvent(ctx, db, event))
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Scan(ctx))
	require.NoError(t, service.HandleJob(ctx, job.Payload))
	require.Equal(t, "published", received.event)
	require.Contains(t, received.body, `"id":"event-1"`)
	require.Equal(t, "v1="+Signature(created.Secret, received.timestamp, received.body), received.signature)
	require.NotEmpty(t, received.delivery)

	var delivery models.ExternalWebhookDelivery
	require.NoError(t, db.NewSelect().Model(&delivery).Scan(ctx))
	require.Equal(t, StatusDelivered, delivery.Status)
	require.Equal(t, 1, delivery.AttemptCount)
	require.Equal(t, http.StatusNoContent, delivery.ResponseStatus)

	deliveries, err := service.ListDeliveries(ctx, "installation-1", 10)
	require.NoError(t, err)
	require.Len(t, deliveries, 1)
	require.Equal(t, delivery.ID, deliveries[0].ID)
}

func TestWebhookDeliveryStopsWhenSponsorLosesWorkspaceAdmin(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := newWebhookTestDB(t)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.test", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "One", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppInstallation{ID: "installation-1", ApplicationID: "app-1", SponsorUserID: "user-1", Scopes: "events:subscribe", TokenFamilyID: "family-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppWorkspaceGrant{InstallationID: "installation-1", WorkspaceID: "ws-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalWebhookSubscription{ID: "subscription-1", InstallationID: "installation-1", WorkspaceID: "ws-1", URL: "https://example.test/hook", SecretEncrypted: []byte("ciphertext"), EventTypes: "published", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)

	event := models.PublicationLifecycleEvent{ID: "event-1", WorkspaceID: "ws-1", PublicationID: "publication-1", Type: "published", MetadataJSON: `{}`, CreatedAt: now}
	require.NoError(t, EnqueueEvent(ctx, db, event))
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Scan(ctx))
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ?", "ws-1").Exec(ctx)
	require.NoError(t, err)

	called := false
	service := NewService(db, servicecrypto.NewTokenEncryptor("test-webhook-key"))
	service.SetHTTPClient(&http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, errors.New("unexpected delivery")
	})})
	require.NoError(t, service.HandleJob(ctx, job.Payload))
	require.False(t, called)
	var cancelled models.ExternalWebhookDelivery
	require.NoError(t, db.NewSelect().Model(&cancelled).Scan(ctx))
	require.Equal(t, StatusCancelled, cancelled.Status)
	require.Equal(t, "authorization revoked", cancelled.LastError)
	subscriptions, err := service.List(ctx, "installation-1")
	require.NoError(t, err)
	require.Empty(t, subscriptions)
	deliveries, err := service.ListDeliveries(ctx, "installation-1", 10)
	require.NoError(t, err)
	require.Empty(t, deliveries)
	require.NoError(t, EnqueueEvent(ctx, db, models.PublicationLifecycleEvent{ID: "event-2", WorkspaceID: "ws-1", Type: "published", MetadataJSON: `{}`, CreatedAt: now}))
	count, err := db.NewSelect().Model((*models.ExternalWebhookDelivery)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func newWebhookTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.ExternalAppInstallation)(nil), (*models.ExternalAppWorkspaceGrant)(nil), (*models.ExternalWebhookSubscription)(nil), (*models.ExternalWebhookDelivery)(nil), (*models.Job)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}
