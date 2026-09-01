package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/botingress"
	"github.com/openpost/backend/internal/services/providerreadiness"
	telegramservice "github.com/openpost/backend/internal/services/telegram"
	"github.com/stretchr/testify/require"
)

type issueCodeReadiness struct{}

func (issueCodeReadiness) DecideConnection(context.Context, string, string, providerreadiness.ExecutionIntent) providerreadiness.Decision {
	return providerreadiness.Decision{Executable: true, Connectable: true}
}
func (issueCodeReadiness) DecideAccountOperation(context.Context, models.SocialAccount, providerreadiness.Operation, providerreadiness.ExecutionIntent) providerreadiness.Decision {
	return providerreadiness.Decision{}
}

type issueCodeBotAPI struct{}

func (issueCodeBotAPI) GetMe(context.Context) (telegramservice.User, error) {
	return telegramservice.User{}, nil
}
func (issueCodeBotAPI) GetChat(context.Context, string) (telegramservice.Chat, error) {
	return telegramservice.Chat{}, nil
}
func (issueCodeBotAPI) GetChatMember(context.Context, string, int64) (telegramservice.ChatMember, error) {
	return telegramservice.ChatMember{}, nil
}
func (issueCodeBotAPI) SetWebhook(context.Context, telegramservice.SetWebhookRequest) error {
	return nil
}

func TestTelegramConnectionCodeIsWorkspaceBoundAndReturnedOnlyAtIssuance(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.BotConnectionNonce)(nil), (*models.SocialAccount)(nil),
	)
	now := time.Date(2026, time.August, 31, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Launch", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleEditor,
		Status: models.WorkspaceMemberStatusActive,
	}).Exec(t.Context())
	require.NoError(t, err)

	ingress := botingress.New(db, []byte("test-signing-key-that-is-not-returned"))
	ingress.SetNowForTest(func() time.Time { return now })
	telegram := telegramservice.NewService(db, issueCodeBotAPI{}, "openpost_bot", "private-webhook-secret")
	telegram.SetProviderReadiness(issueCodeReadiness{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewTelegramConnectionHandler(db, testAuthenticator{}, ingress, telegram, nil).RegisterRoutes(api)

	payload := bytes.NewBufferString(`{"workspace_id":"workspace-1","expected_chat_id":"-1001"}`)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/accounts/telegram/connection-code", payload)
	request.Header.Set("Authorization", "Bearer web-token")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output IssueTelegramConnectionCodeResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output))
	require.Contains(t, output.Code, "/connect opbn1.")
	require.Equal(t, now.Add(botingress.ConnectionNonceTTL), output.ExpiresAt)

	var nonce models.BotConnectionNonce
	require.NoError(t, db.NewSelect().Model(&nonce).Scan(t.Context()))
	require.Equal(t, "workspace-1", nonce.WorkspaceID)
	require.Equal(t, "-1001", nonce.ExpectedSubjectReference)
	require.NotEmpty(t, nonce.NonceHash)
	stored, err := json.Marshal(nonce)
	require.NoError(t, err)
	require.NotContains(t, string(stored), output.Code)
	require.NotContains(t, string(stored), "private-webhook-secret")

	missingChatRequest := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/accounts/telegram/connection-code", bytes.NewBufferString(`{"workspace_id":"workspace-1"}`))
	missingChatRequest.Header.Set("Authorization", "Bearer web-token")
	missingChatRequest.Header.Set("Content-Type", "application/json")
	missingChatResponse := httptest.NewRecorder()
	e.ServeHTTP(missingChatResponse, missingChatRequest)
	require.Equal(t, http.StatusUnprocessableEntity, missingChatResponse.Code)
	count, err := db.NewSelect().Model((*models.BotConnectionNonce)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}
