package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/capabilities"
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

type botDeliveryAdapter struct {
	platform.Adapter
	mu       sync.Mutex
	requests []botDeliveryRequest
}

type botDeliveryRequest struct {
	accountID, profile, outputProfile, target, mediaBody string
	calledAt                                             time.Time
}

func (a *botDeliveryAdapter) ValidatePublishingTarget(_ context.Context, _ string, accountID string, settings map[string]interface{}) error {
	key := "channel_id"
	if accountID == "-100123" {
		key = "chat_id"
	}
	if settings[key] != map[string]string{"channel_id": "channel-1", "chat_id": "-100123"}[key] {
		return fmt.Errorf("unexpected %s for account %s", key, accountID)
	}
	return nil
}

func (a *botDeliveryAdapter) Publish(ctx context.Context, token, accountID string, req *platform.PublishRequest) (platform.PublishResult, error) {
	return a.PublishWithMedia(ctx, token, accountID, req, nil)
}

func (a *botDeliveryAdapter) PublishWithMedia(_ context.Context, _ string, accountID string, req *platform.PublishRequest, media []platform.UploadMediaRequest) (platform.PublishResult, error) {
	if err := req.BeginWrite(platform.PublishResult{ProviderState: "local_bot_delivery", RetrySafety: platform.PublishRetryNever}); err != nil {
		return platform.PublishResult{}, err
	}
	var body string
	for _, item := range media {
		data, err := io.ReadAll(item.Reader)
		if err != nil {
			return platform.PublishResult{}, err
		}
		body += string(data)
	}
	target := ""
	if accountID == "-100123" {
		target, _ = req.Settings["chat_id"].(string)
	} else {
		target, _ = req.Settings["channel_id"].(string)
	}
	a.mu.Lock()
	a.requests = append(a.requests, botDeliveryRequest{accountID: accountID, profile: req.Profile, outputProfile: req.OutputProfile, target: target, mediaBody: body, calledAt: time.Now().UTC()})
	a.mu.Unlock()
	result := platform.AcceptedPublishResult("local-provider-message-42")
	return result, req.Checkpoint(result)
}

func (a *botDeliveryAdapter) captured() []botDeliveryRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]botDeliveryRequest(nil), a.requests...)
}

type telegramDeliveryAdapter struct{ *botDeliveryAdapter }

func (*telegramDeliveryAdapter) UsesInstanceCredential() bool { return true }

func TestBotPublicationRESTQueueWorkerPublishesSupportedFormats(t *testing.T) {
	for _, tc := range []struct {
		provider, profile, outputProfile, mime, mediaBody string
	}{
		{"telegram", models.ContentProfileShortText, "telegram.post", "", ""},
		{"telegram", models.ContentProfileImagePost, "telegram.post", "image/png", "image-bytes"},
		{"telegram", models.ContentProfileShortVideo, "telegram.video", "video/mp4", "video-bytes"},
		{"discord", models.ContentProfileShortText, "discord.post", "", ""},
		{"discord", models.ContentProfileImagePost, "discord.post", "image/png", "image-bytes"},
		{"discord", models.ContentProfileShortVideo, "discord.video", "video/mp4", "video-bytes"},
		{"discord", models.ContentProfileLongVideo, "discord.video", "video/mp4", "video-bytes"},
	} {
		for _, scheduled := range []bool{false, true} {
			name := fmt.Sprintf("%s/%s/scheduled=%t", tc.provider, tc.profile, scheduled)
			t.Run(name, func(t *testing.T) {
				db := createHandlerTestDB(t,
					(*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.Publication)(nil),
					(*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil),
					(*models.PublicationAsset)(nil), (*models.Job)(nil), (*models.UsageCounter)(nil), (*models.ProviderUsageEvent)(nil),
					(*models.ProviderUsageReservation)(nil), (*models.ProviderUsagePeriodCounter)(nil),
					(*models.ProviderDelivery)(nil), (*models.ProviderInstallation)(nil), (*models.ProviderAccountBinding)(nil),
					(*models.ProviderApprovalReview)(nil), (*models.ProviderCertificationRun)(nil), (*models.ProviderCertificationCheck)(nil), (*models.ProviderRuntimeControlEvent)(nil),
					(*models.TelegramConnection)(nil), (*models.User)(nil), (*models.Organization)(nil),
					(*models.UserNotification)(nil), (*models.UserNotificationPreference)(nil), (*models.UserWorkspaceQueueReminder)(nil),
					(*models.UserNotificationDigestItem)(nil), (*models.UserNotificationMute)(nil), (*models.APIToken)(nil),
				)
				db.SetMaxOpenConns(1)
				_, err := db.ExecContext(t.Context(), "CREATE UNIQUE INDEX provider_deliveries_target ON provider_deliveries (rendition_id, target_key)")
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, db.Close()) })
				now := time.Now().UTC()
				for _, model := range []any{
					&models.Organization{ID: "organization-1", Name: "Local test"},
					&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Local test"},
					&models.User{ID: "user-1", Email: "local@example.test", IsAdmin: true},
					&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
				} {
					_, err := db.NewInsert().Model(model).Exec(t.Context())
					require.NoError(t, err)
				}
				accountID, capabilityState := "-100123", "{}"
				if tc.provider == "discord" {
					accountID, capabilityState = "100", `{"connection_type":"bot"}`
				}
				account := &models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: tc.provider, Slug: "local-bot", AccountID: accountID, CapabilityState: capabilityState, AccessTokenEnc: []byte("instance-owned"), IsActive: true}
				encryptor := crypto.NewTokenEncryptor("local-bot-test-key")
				if tc.provider == "discord" {
					token, err := encryptor.Encrypt("discord-guild:100")
					require.NoError(t, err)
					account.OAuthGrantID = "grant-1"
					_, err = db.NewInsert().Model(&models.OAuthGrant{ID: "grant-1", WorkspaceID: "workspace-1", Provider: "discord", ProviderSubject: "100", AccessTokenEnc: token, ExecutionMode: "bot_oauth2", AuthorizationEvidence: "{}", ValidationStatus: "valid", ValidatedAt: now, CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
					require.NoError(t, err)
				} else {
					_, err = db.NewInsert().Model(&models.TelegramConnection{SocialAccountID: account.ID, WorkspaceID: account.WorkspaceID, ChatID: accountID, ChatType: "channel", InstalledAt: now, CoverageStartedAt: now, CoverageKind: "since_installation", PermissionsVerifiedAt: now, CreatedAt: now}).Exec(t.Context())
					require.NoError(t, err)
				}
				_, err = db.NewInsert().Model(account).Exec(t.Context())
				require.NoError(t, err)

				storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
				mediaID := ""
				if tc.mediaBody != "" {
					mediaID = "media-1"
					filename := "launch.png"
					if tc.mime == "video/mp4" {
						filename = "launch.mp4"
					}
					path, err := storage.Save(t.Context(), filename, bytes.NewBufferString(tc.mediaBody))
					require.NoError(t, err)
					_, err = db.NewInsert().Model(&models.MediaAttachment{ID: mediaID, WorkspaceID: "workspace-1", FilePath: path, MimeType: tc.mime, Size: int64(len(tc.mediaBody)), OriginalFilename: filename, ProcessingStatus: "ready", Width: 720, Height: 1280, DurationMS: 1000}).Exec(t.Context())
					require.NoError(t, err)
				}

				app := platform.AppConfig{Provider: tc.provider, ClientID: "local-app", BotToken: "local-token", BotUsername: "local_bot", WebhookSecret: "local-secret"}
				if tc.provider == "discord" {
					app.ConnectionMode = platform.ConnectionModeBot
				}
				catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps([]platform.AppConfig{app}, providerreadiness.ConfigurationSourceEnvironment, providerreadiness.ProviderEnvironmentProduction))
				require.NoError(t, err)
				configurationRef := ""
				if tc.provider == "discord" {
					configurationRef = platform.ConnectionModeBot
				}
				configuration := catalog.Resolve(tc.provider, configurationRef, providerreadiness.ProviderEnvironmentProduction)
				_, err = db.NewInsert().Model(&models.ProviderApprovalReview{
					ID: "local-review", Provider: tc.provider, AppFingerprint: configuration.AppFingerprint,
					ProviderEnvironment: string(providerreadiness.ProviderEnvironmentProduction),
					InstanceFingerprint: configuration.InstanceFingerprint, ApprovalState: "approved", ApprovalTier: "standard",
					SourceURL: "https://provider.example/approval", ReviewedAt: now.Add(-time.Minute), ExpiresAt: now.Add(time.Hour), OperatorRef: "local-operator",
				}).Exec(t.Context())
				require.NoError(t, err)
				readiness := providerreadiness.NewService(providerreadiness.NewRepository(db), providerreadiness.ServiceOptions{
					Configurations: catalog, DefaultControl: providerreadiness.RuntimeControlStateEnabled,
					ManagedProduction: true, EnforceCertification: true, CurrentRevision: strings.Repeat("a", 40),
				})
				handler := NewPublicationHandler(db, publicationAuthorizationAuthenticator{"web-token": {UserID: "user-1", SessionID: "session-1"}}, nil)
				handler.SetProviderReadiness(readiness)
				e := echo.New()
				api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Local bot delivery", "1.0.0"))
				handler.RegisterRoutes(api)
				request := func(method, path string, payload any) *httptest.ResponseRecorder {
					body, err := json.Marshal(payload)
					require.NoError(t, err)
					req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(body))
					req.Header.Set("Authorization", "Bearer web-token")
					req.Header.Set("Content-Type", "application/json")
					rec := httptest.NewRecorder()
					e.ServeHTTP(rec, req)
					require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
					return rec
				}
				settings := map[string]any{"chat_id": "-100123"}
				if tc.provider == "discord" {
					settings = map[string]any{"channel_id": "channel-1"}
				}
				capability, found := capabilities.Find(tc.provider, tc.profile)
				require.True(t, found)
				require.Equal(t, tc.outputProfile, capability.OutputProfile)
				operation := providerreadiness.OperationPublishImmediate
				if scheduled {
					operation = providerreadiness.OperationPublishScheduled
				}
				resolved, err := readiness.ResolveCertificationContext(t.Context(), *account, tc.outputProfile, operation, settings, "")
				require.NoError(t, err)
				expectedContract, err := providerreadiness.PublicationContract(capability, operation, true, providerreadiness.AccountKind(*account), providerreadiness.PublicationPolicyMode(*account, capability, settings))
				require.NoError(t, err)
				expectedDigest, err := expectedContract.Digest()
				require.NoError(t, err)
				actualDigest, err := resolved.Contract.Digest()
				require.NoError(t, err)
				require.Equal(t, expectedDigest, actualDigest)
				require.Len(t, resolved.Contract.Requirements.RequiredLocalChecks, 6)
				require.Len(t, resolved.Contract.Requirements.RequiredLiveChecks, 6)
				rendition := map[string]any{"social_account_id": account.ID, "profile": tc.profile, "body": "Launch update", "settings": settings}
				if mediaID != "" {
					rendition["media"] = []map[string]any{{"media_id": mediaID, "alt_text": "Launch media"}}
				}
				create := map[string]any{"workspace_id": "workspace-1", "title": "Launch", "source_text": "Launch update", "content_profile": tc.profile, "renditions": []any{rendition}}
				var runAt time.Time
				if scheduled {
					runAt = time.Now().UTC().Add(2 * time.Second)
					create["scheduled_at"] = runAt.Format(time.RFC3339Nano)
				}
				var created PublicationResponse
				require.NoError(t, json.Unmarshal(request(http.MethodPost, "/api/v1/publications", create).Body.Bytes(), &created))
				path := "/api/v1/publications/" + created.ID + "/publish-now"
				if scheduled {
					path = "/api/v1/publications/" + created.ID + "/schedule"
				}
				request(http.MethodPost, path, map[string]any{"expected_revision": created.Revision, "execution_intent": "certification_test"})

				adapter := &botDeliveryAdapter{}
				var provider platform.Adapter = adapter
				if tc.provider == "telegram" {
					provider = &telegramDeliveryAdapter{adapter}
				}
				key := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
				tokens := tokenmanager.NewTokenManager(db, encryptor)
				tokens.SetProvider(key, provider)
				service := publisher.NewService(db, tokens)
				service.SetProvider(key, provider)
				service.SetProviderReadiness(readiness)
				service.SetStorage(storage)
				worker := queue.NewWorker(db, "local-bot", 10*time.Millisecond, service, tokens, storage)
				go worker.Start(t.Context())
				t.Cleanup(func() {
					worker.Quiesce()
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					require.NoError(t, worker.Wait(ctx))
				})
				var publishJob models.Job
				require.Eventually(t, func() bool {
					err := db.NewSelect().Model(&publishJob).Where("type = ?", "publish_publication").Where("payload LIKE ?", "%"+created.ID+"%").Scan(t.Context())
					return err == nil && (publishJob.Status == "completed" || publishJob.Status == "failed")
				}, 8*time.Second, 10*time.Millisecond)
				require.Equal(t, "completed", publishJob.Status, publishJob.LastError)
				var finished PublicationResponse
				require.NoError(t, json.Unmarshal(request(http.MethodGet, "/api/v1/publications/"+created.ID, nil).Body.Bytes(), &finished))
				require.Equal(t, models.PublicationStatusPublished, finished.Status)
				require.Len(t, finished.Renditions, 1)
				require.Equal(t, models.RenditionStatusPublished, finished.Renditions[0].Status)
				require.Equal(t, "local-provider-message-42", finished.Renditions[0].ExternalID)
				calls := adapter.captured()
				require.Len(t, calls, 1)
				require.Equal(t, accountID, calls[0].accountID)
				require.Equal(t, tc.profile, calls[0].profile)
				require.Equal(t, tc.outputProfile, calls[0].outputProfile)
				if tc.provider == "telegram" {
					require.Equal(t, accountID, calls[0].target, "Telegram target should match the installed chat")
				} else {
					require.Equal(t, "channel-1", calls[0].target)
				}
				require.Equal(t, tc.mediaBody, calls[0].mediaBody)
				if scheduled {
					require.False(t, calls[0].calledAt.Before(runAt), "provider call preceded the due time")
				}
			})
		}
	}
}
