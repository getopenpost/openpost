package telegram

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestTelegramVerifiedChatPublishesTextImageAndVideoWithAcceptedReceipts(t *testing.T) {
	for _, tc := range []struct {
		name, method, kind, mime, filename, mediaBody string
	}{
		{name: "text", method: "sendMessage", kind: "message"},
		{name: "image", method: "sendPhoto", kind: "photo", mime: "image/png", filename: "launch.png", mediaBody: "image-bytes"},
		{name: "video", method: "sendVideo", kind: "video", mime: "video/mp4", filename: "launch.mp4", mediaBody: "video-bytes"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			db := bun.NewDB(sqlDB, sqlitedialect.New())
			t.Cleanup(func() { require.NoError(t, db.Close()) })
			for _, model := range []any{(*models.TelegramConnection)(nil), (*models.TelegramPublishReceipt)(nil)} {
				_, err := db.NewCreateTable().Model(model).Exec(t.Context())
				require.NoError(t, err)
			}
			now := time.Now().UTC()
			_, err = db.NewInsert().Model(&models.TelegramConnection{
				SocialAccountID: "account-1", WorkspaceID: "workspace-1", ChatID: "-100123", ChatType: "channel",
				InstalledAt: now, CoverageStartedAt: now, CoverageKind: CoverageSinceInstallation,
				PermissionsVerifiedAt: now, CreatedAt: now,
			}).Exec(t.Context())
			require.NoError(t, err)

			var sends int
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				method := strings.TrimPrefix(r.URL.Path, "/botlocal-test-token/")
				w.Header().Set("Content-Type", "application/json")
				switch method {
				case "getMe":
					_, _ = io.WriteString(w, `{"ok":true,"result":{"id":7,"username":"testbot"}}`)
				case "getChat":
					_, _ = io.WriteString(w, `{"ok":true,"result":{"id":-100123,"type":"channel"}}`)
				case "getChatMember":
					_, _ = io.WriteString(w, `{"ok":true,"result":{"status":"administrator","can_post_messages":true}}`)
				case tc.method:
					sends++
					if tc.mediaBody == "" {
						var payload struct {
							ChatID string `json:"chat_id"`
							Text   string `json:"text"`
						}
						require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
						require.Equal(t, "-100123", payload.ChatID)
						require.Equal(t, "Launch update", payload.Text)
					} else {
						require.NoError(t, r.ParseMultipartForm(1<<20))
						require.Equal(t, "-100123", r.FormValue("chat_id"))
						require.Equal(t, "Launch update", r.FormValue("caption"))
						file, header, err := r.FormFile("media_0")
						require.NoError(t, err)
						defer file.Close()
						body, err := io.ReadAll(file)
						require.NoError(t, err)
						require.Equal(t, tc.filename, header.Filename)
						require.Equal(t, tc.mediaBody, string(body))
					}
					_, _ = io.WriteString(w, `{"ok":true,"result":{"message_id":42}}`)
				default:
					t.Errorf("unexpected Bot API method %q", method)
					http.Error(w, "unexpected method", http.StatusBadRequest)
				}
			}))
			defer provider.Close()
			api := NewHTTPBotAPI("local-test-token", provider.Client())
			api.baseURL = provider.URL
			service := NewService(db, api, "testbot", "local-secret")
			req := &platform.PublishRequest{
				Content: "Launch update", OperationID: "operation-1", RenditionID: "rendition-1",
				Settings: map[string]interface{}{"chat_id": "-100123"},
			}
			var prepared, checkpointed bool
			req.SetWriteFence(func(result platform.PublishResult) error {
				prepared = result.ProviderState == "telegram_messages"
				return nil
			}, func(result platform.PublishResult) error {
				checkpointed = result.ExternalID == "42"
				return nil
			})
			var result platform.PublishResult
			if tc.mediaBody == "" {
				result, err = service.Publish(t.Context(), "", "-100123", req)
			} else {
				result, err = service.PublishWithMedia(t.Context(), "", "-100123", req, []platform.UploadMediaRequest{{MimeType: tc.mime, Filename: tc.filename, Size: int64(len(tc.mediaBody)), Reader: strings.NewReader(tc.mediaBody)}})
			}
			require.NoError(t, err)
			require.True(t, prepared)
			require.True(t, checkpointed)
			require.Equal(t, platform.PublishSubmissionAccepted, result.SubmissionState)
			require.Equal(t, "42", result.ExternalID)
			require.Equal(t, 1, sends)
			var receipts []models.TelegramPublishReceipt
			require.NoError(t, db.NewSelect().Model(&receipts).Where("operation_id = ?", req.OperationID).Scan(t.Context()))
			require.Len(t, receipts, 1)
			require.Equal(t, tc.kind, receipts[0].RequestKind)
			require.Equal(t, "accepted", receipts[0].Status)
			require.Equal(t, "42", receipts[0].MessageID)

			req.OperationID = fmt.Sprintf("wrong-chat-%s", tc.name)
			req.Settings = map[string]interface{}{"chat_id": "-100999"}
			_, err = service.Publish(t.Context(), "", "-100123", req)
			require.ErrorIs(t, err, ErrChatIdentityMismatch)
			require.Equal(t, 1, sends)
		})
	}
}
