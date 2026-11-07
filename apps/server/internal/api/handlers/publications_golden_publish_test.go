package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/queue"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publisher"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/stretchr/testify/require"
)

// This fixture owns the provider boundary. HTTP protocol behavior is covered
// by platform tests; this suite exercises API, durable worker and stored media.
type goldenWorkerProvider struct {
	platform.Adapter
	network string
	calls   atomic.Int32
	uploads atomic.Int32
}

func (p *goldenWorkerProvider) UploadMediaWithMetadata(_ context.Context, token, accountID string, req platform.UploadMediaRequest) (string, error) {
	if token != "provider-token" || accountID != "founder" || req.MimeType != "image/jpeg" {
		return "", fmt.Errorf("incorrect media upload credentials or MIME")
	}
	photo, err := jpeg.Decode(req.Reader)
	if err != nil {
		return "", err
	}
	if photo.Bounds().Dx() != 1080 || photo.Bounds().Dy() != 1350 {
		return "", fmt.Errorf("missing text card JPEG")
	}
	p.uploads.Add(1)
	return "card-upload", nil
}
func (p *goldenWorkerProvider) Publish(_ context.Context, token, accountID string, req *platform.PublishRequest) (platform.PublishResult, error) {
	if token != "provider-token" || accountID != "founder" || req.Content != "Shipping from the API" || req.IdempotencyKey == "" || req.OperationID == "" {
		return platform.PublishResult{}, fmt.Errorf("incorrect publishing content, credential or fence identity")
	}
	if p.network == "pixelfed" && (len(req.PlatformMediaIDs) != 1 || req.PlatformMediaIDs[0] != "card-upload" || len(req.MediaAltTexts) != 1 || req.MediaAltTexts[0] != "Shipping from the API") {
		return platform.PublishResult{}, fmt.Errorf("missing generated card or authored alt text")
	}
	if err := req.BeginWrite(platform.PublishResult{RetrySafety: platform.PublishRetryIdempotent}); err != nil {
		return platform.PublishResult{}, err
	}
	p.calls.Add(1)
	result := platform.AcceptedPublishResult("remote-42")
	result.ExternalURL = "https://social.example/@founder/remote-42"
	return result, req.Checkpoint(result)
}

func TestPublicationAPIThroughWorkerRetainsProviderResult(t *testing.T) {
	testPublicationAPIThroughWorker(t, "mastodon")
}

func TestTextCardAPIThroughWorkerUploadsGeneratedImage(t *testing.T) {
	testPublicationAPIThroughWorker(t, "pixelfed")
}

func testPublicationAPIThroughWorker(t *testing.T, network string) {
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.Publication)(nil),
		(*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil),
		(*models.PublicationAsset)(nil), (*models.Job)(nil), (*models.UsageCounter)(nil), (*models.ProviderUsageEvent)(nil),
		(*models.ProviderUsageReservation)(nil), (*models.ProviderUsagePeriodCounter)(nil),
		(*models.ProviderDelivery)(nil), (*models.ProviderInstallation)(nil), (*models.ProviderAccountBinding)(nil),
		(*models.RenditionMediaDelivery)(nil), (*models.RenditionMediaDeliveryRelation)(nil),
		(*models.User)(nil), (*models.Organization)(nil), (*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil), (*models.UserWorkspaceQueueReminder)(nil),
		(*models.UserNotificationDigestItem)(nil), (*models.UserNotificationMute)(nil), (*models.APIToken)(nil),
	)
	db.SetMaxOpenConns(1)
	_, err := db.ExecContext(t.Context(), "CREATE UNIQUE INDEX provider_deliveries_target ON provider_deliveries (rendition_id, target_key)")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	const providerURL = "https://social.example"

	encryptor := crypto.NewTokenEncryptor("golden-test-key")
	token, err := encryptor.Encrypt("provider-token")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Golden"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Golden"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	account := &models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: network, Slug: "founder", AccountID: "founder", InstanceURL: providerURL, AccessTokenEnc: token, IsActive: true}
	_, err = db.NewInsert().Model(account).Exec(t.Context())
	require.NoError(t, err)
	handler := newReadyPublicationHandler(t, db, testAuthenticator{})
	storage := mediastore.NewLocalStorage(t.TempDir(), "https://media.example")
	handler.SetTextCardStorage(storage)
	readiness := oauthConnectionReadiness(t, &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}, platform.AppConfig{Provider: network, ClientID: "client", InstanceURL: providerURL})
	handler.SetProviderReadiness(readiness)
	// The readiness fixture establishes scopes; the worker needs actual ciphertext.
	_, err = db.NewUpdate().Model((*models.OAuthGrant)(nil)).Set("access_token_encrypted = ?", token).Where("provider = ?", network).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Golden", "1.0.0"))
	handler.RegisterRoutes(api)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return rec
	}
	created := request(http.MethodPost, "/api/v1/publications", `{"workspace_id":"workspace-1","title":"Launch","source_text":"Shipping from the API","content_profile":"short_text","renditions":[{"social_account_id":"account-1","profile":"short_text","body":"Shipping from the API"}]}`)
	var publication PublicationResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &publication))
	request(http.MethodPost, "/api/v1/publications/"+publication.ID+"/publish-now", fmt.Sprintf(`{"expected_revision":%d}`, publication.Revision))
	var base platform.Adapter = platform.NewMastodonAdapter("client", "secret", "https://app.example/callback", providerURL)
	if network == "pixelfed" {
		base = platform.NewPixelfedAdapter("client", "secret", "https://app.example/callback", providerURL)
	}
	adapter := &goldenWorkerProvider{Adapter: base, network: network}

	key := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
	tokens := tokenmanager.NewTokenManager(db, encryptor)
	tokens.SetProvider(key, adapter)
	service := publisher.NewService(db, tokens)
	service.SetStorage(storage)
	service.SetMediaStateEncryptor(encryptor)
	service.SetProvider(key, adapter)
	service.SetProviderReadiness(readiness)
	worker := queue.NewWorker(db, "golden-publish", 10*time.Millisecond, service, tokens, nil)
	go worker.Start(t.Context())
	t.Cleanup(func() {
		worker.Quiesce()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		require.NoError(t, worker.Wait(ctx))
	})
	require.Eventually(t, func() bool {
		var job models.Job
		err := db.NewSelect().Model(&job).Where("type = ?", "publish_publication").Where("payload LIKE ?", "%"+publication.ID+"%").Scan(t.Context())
		return err == nil && job.Status == "completed"
	}, 5*time.Second, 10*time.Millisecond)
	finished := request(http.MethodGet, "/api/v1/publications/"+publication.ID, "")
	var result PublicationResponse
	require.NoError(t, json.Unmarshal(finished.Body.Bytes(), &result))
	require.Equal(t, models.PublicationStatusPublished, result.Status, finished.Body.String())
	require.Len(t, result.Renditions, 1)
	require.Equal(t, models.RenditionStatusPublished, result.Renditions[0].Status)
	require.Equal(t, "remote-42", result.Renditions[0].ExternalID)
	require.Equal(t, "https://social.example/@founder/remote-42", result.Renditions[0].ExternalURL)
	require.Equal(t, int32(1), adapter.calls.Load())
	if network == "pixelfed" {
		require.Equal(t, int32(1), adapter.uploads.Load())
		require.Empty(t, result.Media)
		require.Empty(t, result.Renditions[0].Segments[0].Media)
		require.Equal(t, "text_card", result.Renditions[0].Segments[0].OutputMedia[0].Role)
	}
}
