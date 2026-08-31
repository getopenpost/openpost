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
	"github.com/openpost/backend/internal/platform"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/openpost/backend/internal/services/botingress"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

type readyTelegramGate struct {
	observationDisabled bool
	analyticsDisabled   bool
}

func (readyTelegramGate) DecideConnection(context.Context, string, string, providerreadiness.ExecutionIntent) providerreadiness.Decision {
	return providerreadiness.Decision{Connectable: true, Executable: true}
}
func (gate readyTelegramGate) DecideAccountOperation(_ context.Context, _ models.SocialAccount, operation providerreadiness.Operation, _ providerreadiness.ExecutionIntent) providerreadiness.Decision {
	return providerreadiness.Decision{
		Executable:     true,
		Observable:     operation == providerreadiness.OperationObservation && !gate.observationDisabled,
		AnalyticsReady: operation == providerreadiness.OperationAnalytics && !gate.analyticsDisabled,
	}
}

type fakeBotAPI struct {
	bot         User
	chats       map[string]Chat
	members     map[string]ChatMember
	webhook     SetWebhookRequest
	memberCount int64
	calls       []string
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
func (api *fakeBotAPI) GetChatMemberCount(context.Context, string) (int64, error) {
	api.calls = append(api.calls, "getChatMemberCount")
	return api.memberCount, nil
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
	for _, model := range []any{(*models.SocialAccount)(nil), (*models.Rendition)(nil), (*models.BotConnectionNonce)(nil), (*models.BotIngressEvent)(nil), (*models.Job)(nil), (*models.TelegramChatInstallation)(nil), (*models.TelegramConnection)(nil), (*models.AccountContentDiscoveryState)(nil), (*models.AccountContent)(nil), (*models.AccountContentObservation)(nil), (*models.AnalyticsAccountContentSnapshot)(nil), (*models.AnalyticsSyncState)(nil)} {
		_, err = db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	for _, statement := range []string{
		"CREATE UNIQUE INDEX telegram_test_ingress_identity ON bot_ingress_events(provider, provider_event_id)",
		"CREATE UNIQUE INDEX telegram_test_content_identity ON account_contents(social_account_id, provider_content_id)",
		"CREATE UNIQUE INDEX telegram_test_observation_identity ON account_content_observations(social_account_id, provider_observation_id)",
		"CREATE UNIQUE INDEX telegram_test_content_capture ON analytics_account_content_snapshots(account_content_id, capture_key)",
	} {
		_, err = db.ExecContext(t.Context(), statement)
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
	service.SetProviderReadiness(readyTelegramGate{})
	analytics := analyticsservice.NewService(db, nil)
	service.SetAccountContentStore(analytics)
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
	var coverage []models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&coverage).Order("social_account_id").Scan(t.Context()))
	require.Len(t, coverage, 2)
	for _, state := range coverage {
		require.Equal(t, string(platform.AccountContentDiscoveryPartial), state.CoverageStatus)
		require.Equal(t, CoverageDescription, state.CoverageDescription)
		require.False(t, state.BackfillWatermark.IsZero())
		created, err := analyticsservice.NewService(db, nil).ReconsiderAccountContentDiscovery(t.Context(), state.SocialAccountID)
		require.NoError(t, err)
		require.False(t, created, "Telegram must not enqueue unsupported history backfill")
	}
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, jobCount)
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
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, jobCount, "an invalid Telegram secret must not enqueue work")

	ordinary := httptest.NewRequestWithContext(t.Context(), http.MethodPost, WebhookPath, strings.NewReader(`{"update_id":11,"message":{"message_id":8,"text":"ordinary group conversation","chat":{"id":-2002,"type":"supergroup"}}}`))
	ordinary.Header.Set("Content-Type", "application/json")
	ordinary.Header.Set(WebhookSecretHeader, "webhook-secret")
	ordinaryResponse := httptest.NewRecorder()
	e.ServeHTTP(ordinaryResponse, ordinary)
	require.Equal(t, http.StatusOK, ordinaryResponse.Code)
	require.JSONEq(t, `{"ok":true}`, ordinaryResponse.Body.String())
}

func TestDuplicateChannelUpdateQueuesOneJob(t *testing.T) {
	service, _, db, _ := newTelegramTestService(t)
	ingress := botingress.New(db, []byte("private-signing-key"))
	e := echo.New()
	service.RegisterWebhook(e, ingress)
	body := `{"update_id":21,"channel_post":{"message_id":17,"date":1788177600,"text":"External launch","chat":{"id":-1001,"type":"channel"}}}`
	for range 2 {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, WebhookPath, strings.NewReader(body))
		request.Header.Set(WebhookSecretHeader, "webhook-secret")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code)
	}
	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestObservationReadinessBlocksChannelPersistenceIndependently(t *testing.T) {
	service, _, db, now := newTelegramTestService(t)
	require.NoError(t, service.Process(t.Context(), connectionEvent("workspace-1", "-1001", "channel", now.Add(-time.Hour))))
	service.SetProviderReadiness(readyTelegramGate{observationDisabled: true})
	err := service.Process(t.Context(), models.BotIngressEvent{
		Provider: "telegram", Kind: "telegram.channel_post", SubjectReference: "-1001", ParentReference: "70",
		ContentProfile: models.ContentProfileShortText, ContentText: "must not persist", OccurredAt: now,
	})
	require.ErrorIs(t, err, ErrProviderUnavailable)
	count, countErr := db.NewSelect().Model((*models.AccountContent)(nil)).Count(t.Context())
	require.NoError(t, countErr)
	require.Zero(t, count)
}

func TestChannelPostsImportExternalContentAndReactionsWithSemanticCounts(t *testing.T) {
	service, _, db, now := newTelegramTestService(t)
	installedAt := now.Add(-time.Hour)
	require.NoError(t, service.Process(t.Context(), connectionEvent("workspace-1", "-1001", "channel", installedAt)))
	require.NoError(t, service.Process(t.Context(), models.BotIngressEvent{
		Provider: "telegram", ProviderEventID: "31", Kind: "telegram.channel_post",
		SubjectReference: "-1001", ParentReference: "77", ContentProfile: models.ContentProfileShortText,
		ContentText: "Published outside OpenPost", OccurredAt: now,
	}))
	var content models.AccountContent
	require.NoError(t, db.NewSelect().Model(&content).Where("social_account_id = ?", serviceAccountID(t, db, "-1001")).Scan(t.Context()))
	require.Equal(t, "77", content.ProviderContentID)
	require.Equal(t, "Published outside OpenPost", content.Text)
	require.Equal(t, string(platform.AccountContentOriginExternal), content.Origin)
	require.Empty(t, content.RenditionID)

	require.NoError(t, service.Process(t.Context(), models.BotIngressEvent{
		Provider: "telegram", ProviderEventID: "32", Kind: "telegram.reaction_count",
		SubjectReference: "-1001", ParentReference: "77", MetricsJSON: `{"reactions":9}`, OccurredAt: now.Add(time.Minute),
	}))
	var observation models.AccountContentObservation
	require.NoError(t, db.NewSelect().Model(&observation).Scan(t.Context()))
	require.Equal(t, content.ID, observation.AccountContentID)
	require.JSONEq(t, `{"reactions":9}`, observation.MetricsJSON)
	var metadata map[string]platform.AnalyticsMetricMetadata
	require.NoError(t, json.Unmarshal([]byte(observation.MetricMetadataJSON), &metadata))
	require.Equal(t, platform.AnalyticsMetricAggregationLifetimeTotal, metadata[platform.MetricReactions].Aggregation)
	require.NotContains(t, observation.MetricsJSON, platform.MetricViews)
}

func TestReactionCountsCoalesceAndMemberCountIsAccountContextOnly(t *testing.T) {
	service, api, db, now := newTelegramTestService(t)
	api.memberCount = 321
	require.NoError(t, service.Process(t.Context(), connectionEvent("workspace-1", "-1001", "channel", now.Add(-time.Hour))))
	event := models.BotIngressEvent{
		Provider: "telegram", Kind: "telegram.reaction_count", SubjectReference: "-1001", ParentReference: "88",
		MetricsJSON: `{"reactions":4}`, OccurredAt: now,
	}
	require.NoError(t, service.Process(t.Context(), event))
	event.ProviderEventID = "different-update"
	require.NoError(t, service.Process(t.Context(), event))
	count, err := db.NewSelect().Model((*models.AccountContentObservation)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)

	measurements, err := service.FetchAccountAnalyticsMeasurements(t.Context(), "", platform.AccountAnalyticsRequest{AccountID: "-1001"})
	require.NoError(t, err)
	require.Equal(t, int64(321), measurements[platform.MetricMembers].Value)
	require.Equal(t, platform.AnalyticsMetricAggregationCurrentSnapshot, measurements[platform.MetricMembers].Aggregation)
	require.NotContains(t, measurements, platform.MetricReactions)
	require.NotContains(t, measurements, platform.MetricViews)

	providerCalls := len(api.calls)
	service.SetProviderReadiness(readyTelegramGate{analyticsDisabled: true})
	_, err = service.FetchAccountAnalyticsMeasurements(t.Context(), "", platform.AccountAnalyticsRequest{AccountID: "-1001"})
	require.Error(t, err)
	require.Len(t, api.calls, providerCalls, "disabled analytics readiness must fail before the Telegram API call")
}

func serviceAccountID(t *testing.T, db *bun.DB, chatID string) string {
	t.Helper()
	var connection models.TelegramConnection
	require.NoError(t, db.NewSelect().Model(&connection).Where("chat_id = ?", chatID).Scan(t.Context()))
	return connection.SocialAccountID
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

	post, err := normalizer.Normalize([]byte(`{"update_id":12,"channel_post":{"message_id":9,"date":1788177600,"caption":"A photo","photo":[{"file_id":"safe"}],"chat":{"id":-1001,"type":"channel"}}}`))
	require.NoError(t, err)
	require.Equal(t, "telegram.channel_post", post.Kind)
	require.Equal(t, "9", post.ParentReference)
	require.Equal(t, models.ContentProfileImagePost, post.ContentProfile)
	require.Equal(t, "A photo", post.ContentText)

	reaction, err := normalizer.Normalize([]byte(`{"update_id":13,"message_reaction_count":{"message_id":9,"date":1788177660,"chat":{"id":-1001,"type":"channel"},"reactions":[{"type":{"type":"emoji","emoji":"👍"},"total_count":3},{"type":{"type":"paid"},"total_count":2}]}}`))
	require.NoError(t, err)
	require.Equal(t, "telegram.reaction_count", reaction.Kind)
	require.JSONEq(t, `{"reactions":5}`, reaction.MetricsJSON)

	membership, err := normalizer.Normalize([]byte(`{"update_id":14,"my_chat_member":{"date":1788177600,"chat":{"id":-1001,"type":"channel"},"new_chat_member":{"status":"administrator"}}}`))
	require.NoError(t, err)
	require.Equal(t, "telegram.membership_changed", membership.Kind)
	require.Equal(t, "channel:administrator", membership.ParentReference)

	_, err = normalizer.Normalize([]byte(`{"update_id":15,"message":{"message_id":9,"text":"ordinary group conversation","chat":{"id":-2002,"type":"supergroup"}}}`))
	require.ErrorIs(t, err, ErrInvalidUpdate)
	_, err = normalizer.Normalize([]byte(`{"update_id":16,"message":{"message_id":10,"text":"/connect opbn1.payload.signature","chat":{"id":42,"type":"private"}}}`))
	require.ErrorIs(t, err, ErrUnsupportedChat)
}

var _ botingress.EventNormalizer = (*UpdateNormalizer)(nil)
