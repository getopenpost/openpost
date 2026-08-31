package telegram

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/botingress"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

type fakeBotAPI struct {
	bot     User
	chats   map[string]Chat
	members map[string]ChatMember
	webhook SetWebhookRequest
	calls   []string
}

func (api *fakeBotAPI) GetMe(context.Context) (User, error) {
	api.calls = append(api.calls, "getMe")
	return api.bot, nil
}
func (api *fakeBotAPI) GetChat(_ context.Context, chatID string) (Chat, error) {
	api.calls = append(api.calls, "getChat")
	return api.chats[chatID], nil
}
func (api *fakeBotAPI) GetChatMember(_ context.Context, chatID string, _ int64) (ChatMember, error) {
	api.calls = append(api.calls, "getChatMember")
	return api.members[chatID], nil
}
func (api *fakeBotAPI) SetWebhook(_ context.Context, request SetWebhookRequest) error {
	api.webhook = request
	return nil
}

func newTelegramTestService(t *testing.T) (*Service, *fakeBotAPI, *bun.DB, time.Time) {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", "file::memory:?cache=shared")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.SocialAccount)(nil), (*models.TelegramChatInstallation)(nil), (*models.TelegramConnection)(nil)} {
		_, err = db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	now := time.Date(2026, time.August, 31, 12, 0, 0, 0, time.UTC)
	api := &fakeBotAPI{
		bot: User{ID: 99, Username: "openpost_bot"},
		chats: map[string]Chat{
			"-1001": {ID: -1001, Type: "channel", Title: "Launches"},
			"-2002": {ID: -2002, Type: "supergroup", Title: "Founders", Permissions: ChatPermissions{CanSendMessages: true}},
			"-3003": {ID: -3003, Type: "channel", Title: "Restricted"},
			"-4004": {ID: -4004, Type: "group", Title: "Read only"},
		},
		members: map[string]ChatMember{
			"-1001": {Status: "administrator", CanPostMessages: true},
			"-2002": {Status: "member"},
			"-3003": {Status: "administrator", CanPostMessages: false},
			"-4004": {Status: "member"},
		},
	}
	service := NewService(db, api, "@openpost_bot", "webhook-secret")
	service.SetNowForTest(func() time.Time { return now })
	return service, api, db, now
}

func connectionEvent(workspaceID, chatID, chatType string, at time.Time) models.BotIngressEvent {
	return models.BotIngressEvent{
		Provider: "telegram", Kind: "telegram.connection_requested", WorkspaceID: workspaceID,
		SubjectReference: chatID, ParentReference: chatType, OccurredAt: at,
	}
}

func TestChannelAndGroupConnectionsPersistInstallationCoverageWithoutCredentials(t *testing.T) {
	service, _, db, now := newTelegramTestService(t)
	installedAt := now.Add(-time.Hour)
	require.NoError(t, service.Process(t.Context(), models.BotIngressEvent{
		Provider: "telegram", Kind: "telegram.membership_changed", SubjectReference: "-1001",
		ParentReference: "channel:administrator", OccurredAt: installedAt,
	}))
	require.NoError(t, service.Process(t.Context(), connectionEvent("workspace-1", "-1001", "channel", now.Add(-time.Minute))))
	require.NoError(t, service.Process(t.Context(), connectionEvent("workspace-1", "-2002", "supergroup", now)))
	lateObservedInstall := now.Add(-2 * time.Hour)
	require.NoError(t, service.Process(t.Context(), models.BotIngressEvent{
		Provider: "telegram", Kind: "telegram.membership_changed", SubjectReference: "-2002",
		ParentReference: "supergroup:member", OccurredAt: lateObservedInstall,
	}))

	var accounts []models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&accounts).Order("account_id").Scan(t.Context()))
	require.Len(t, accounts, 2)
	for _, account := range accounts {
		require.Empty(t, account.AccessTokenEnc)
		require.Empty(t, account.RefreshTokenEnc)
		require.Empty(t, account.OAuthGrantID)
		var capability map[string]string
		require.NoError(t, json.Unmarshal([]byte(account.CapabilityState), &capability))
		require.Equal(t, CoverageSinceInstallation, capability["content_coverage"])
		require.Equal(t, "disabled", capability["group_conversation_analytics"])
	}

	var connections []models.TelegramConnection
	require.NoError(t, db.NewSelect().Model(&connections).Order("chat_id").Scan(t.Context()))
	require.Len(t, connections, 2)
	for _, connection := range connections {
		require.Equal(t, CoverageSinceInstallation, connection.CoverageKind)
		require.Equal(t, connection.InstalledAt, connection.CoverageStartedAt)
		switch connection.ChatID {
		case "-1001":
			require.True(t, installedAt.Equal(connection.CoverageStartedAt))
		case "-2002":
			require.True(t, lateObservedInstall.Equal(connection.CoverageStartedAt))
		}
	}
}

func TestPermissionsAndCrossWorkspaceChatOwnershipFailSafely(t *testing.T) {
	service, _, db, now := newTelegramTestService(t)
	err := service.Process(t.Context(), connectionEvent("workspace-1", "-3003", "channel", now))
	require.ErrorIs(t, err, ErrInsufficientPermissions)
	err = service.Process(t.Context(), connectionEvent("workspace-1", "-4004", "group", now))
	require.ErrorIs(t, err, ErrInsufficientPermissions)
	count, countErr := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, countErr)
	require.Zero(t, count)

	require.NoError(t, service.Process(t.Context(), connectionEvent("workspace-1", "-1001", "channel", now)))
	err = service.Process(t.Context(), connectionEvent("workspace-2", "-1001", "channel", now))
	require.ErrorIs(t, err, ErrChatAlreadyConnected)
	count, countErr = db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 1, count)
}

func TestHTTPBotAPIOmitsProviderTokenFromTransportErrors(t *testing.T) {
	const token = "123456:private-bot-token"
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		require.Contains(t, request.URL.Path, token, "Telegram requires the token in its transient provider path")
		return nil, errors.New("transport failure that must not escape")
	})}
	api := NewHTTPBotAPIForTest(token, "https://api.telegram.test", client)
	_, err := api.GetMe(t.Context())
	require.ErrorIs(t, err, ErrProviderUnavailable)
	require.NotContains(t, err.Error(), token)
	require.NotContains(t, err.Error(), "api.telegram.test")
}

func TestWebhookSubscriptionUsesOnlyRequiredUpdatesAndSafeURL(t *testing.T) {
	service, api, _, _ := newTelegramTestService(t)
	require.NoError(t, service.ConfigureWebhook(t.Context(), "https://app.openpost.test"))
	require.Equal(t, "https://app.openpost.test"+WebhookPath, api.webhook.URL)
	require.Equal(t, RequiredUpdateTypes, api.webhook.AllowedUpdates)
	require.Equal(t, "webhook-secret", api.webhook.SecretToken)
	require.NotContains(t, api.webhook.URL, "webhook-secret")
}

func TestWebhookAuthenticatesBeforeParsingAndNeverEchoesConnectionCodes(t *testing.T) {
	service, _, db, _ := newTelegramTestService(t)
	ingress := botingress.New(db, []byte("private-signing-key"))
	e := echo.New()
	service.RegisterWebhook(e, ingress)
	body := `{"update_id":10,"channel_post":{"message_id":7,"text":"/connect opbn1.sensitive.signature","chat":{"id":-1001,"type":"channel"}}}`

	unauthenticated := httptest.NewRequestWithContext(t.Context(), http.MethodPost, WebhookPath, strings.NewReader(body))
	unauthenticated.Header.Set("Content-Type", "application/json")
	unauthenticated.Header.Set(WebhookSecretHeader, "wrong-secret")
	unauthenticatedResponse := httptest.NewRecorder()
	e.ServeHTTP(unauthenticatedResponse, unauthenticated)
	require.Equal(t, http.StatusUnauthorized, unauthenticatedResponse.Code)
	require.NotContains(t, unauthenticatedResponse.Body.String(), "sensitive")

	ordinary := httptest.NewRequestWithContext(t.Context(), http.MethodPost, WebhookPath, strings.NewReader(`{"update_id":11,"message":{"message_id":8,"text":"ordinary group conversation","chat":{"id":-2002,"type":"supergroup"}}}`))
	ordinary.Header.Set("Content-Type", "application/json")
	ordinary.Header.Set(WebhookSecretHeader, "webhook-secret")
	ordinaryResponse := httptest.NewRecorder()
	e.ServeHTTP(ordinaryResponse, ordinary)
	require.Equal(t, http.StatusOK, ordinaryResponse.Code)
	require.JSONEq(t, `{"ok":true}`, ordinaryResponse.Body.String())
}

func TestNormalizerAcceptsConnectionCommandsOnlyFromChannelOrGroupUpdates(t *testing.T) {
	normalizer := NewUpdateNormalizer("openpost_bot")
	channel, err := normalizer.Normalize([]byte(`{"update_id":10,"channel_post":{"message_id":7,"date":1788177600,"text":"/connect opbn1.payload.signature","chat":{"id":-1001,"type":"channel"}}}`))
	require.NoError(t, err)
	require.Equal(t, "-1001", channel.SubjectReference)
	require.Equal(t, "channel", channel.ParentReference)

	group, err := normalizer.Normalize([]byte(`{"update_id":11,"message":{"message_id":8,"date":1788177600,"text":"/connect@openpost_bot opbn1.payload.signature","chat":{"id":-2002,"type":"supergroup"}}}`))
	require.NoError(t, err)
	require.Equal(t, "supergroup", group.ParentReference)

	membership, err := normalizer.Normalize([]byte(`{"update_id":12,"my_chat_member":{"date":1788177600,"chat":{"id":-1001,"type":"channel"},"new_chat_member":{"status":"administrator"}}}`))
	require.NoError(t, err)
	require.Equal(t, "telegram.membership_changed", membership.Kind)
	require.Equal(t, "channel:administrator", membership.ParentReference)

	_, err = normalizer.Normalize([]byte(`{"update_id":13,"message":{"message_id":9,"text":"ordinary group conversation","chat":{"id":-2002,"type":"supergroup"}}}`))
	require.ErrorIs(t, err, ErrInvalidUpdate)
	_, err = normalizer.Normalize([]byte(`{"update_id":14,"message":{"message_id":10,"text":"/connect opbn1.payload.signature","chat":{"id":42,"type":"private"}}}`))
	require.ErrorIs(t, err, ErrUnsupportedChat)
}

var _ botingress.EventNormalizer = (*UpdateNormalizer)(nil)
