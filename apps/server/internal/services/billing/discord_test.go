package billing

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestHandleJobSendsBillingEmbedOnceWithUserDetails(t *testing.T) {
	db := newBillingTestDB(t)
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	_, err := db.NewCreateTable().Model((*models.User)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "owner", Email: "owner@example.com", Username: "owner", DisplayName: "Owner Example", AvatarURL: "/avatars/owner.png", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingCheckoutAttempt{CheckoutAttemptID: "chkat_discord", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "owner", Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly", Status: "created", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingWebhookEvent{EventID: "evt_discord", Provider: ProviderPaddle, EventType: "transaction.completed", OccurredAt: now, ProcessedAt: now}).Exec(t.Context())
	require.NoError(t, err)

	var requestCount atomic.Int32
	var received discordWebhookPayload
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount.Add(1)
		require.NoError(t, json.NewDecoder(request.Body).Decode(&received))
		writer.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	customerID := "ctm_1"
	subscriptionID := "sub_1"
	service := NewService(db, "", PaddleConfig{AppURL: "https://app.openpo.st", Plans: testCatalog()})
	service.api = &fakePaddleAPI{customer: &paddle.Customer{ID: customerID, Email: "owner@example.com"}, subscription: &paddle.Subscription{ID: subscriptionID, CustomerID: customerID, Status: paddle.SubscriptionStatusActive, UpdatedAt: now.Format(time.RFC3339), CustomData: paddle.CustomData{"checkout_id": "chkat_discord"}, Items: []paddle.SubscriptionItem{{Recurring: true, Price: paddle.Price{ID: "pri_founder_month"}}}}, transaction: &paddle.Transaction{ID: "txn_1", CustomerID: &customerID, SubscriptionID: &subscriptionID, Status: paddle.TransactionStatusCompleted, CurrencyCode: paddle.CurrencyCode("USD"), CustomData: paddle.CustomData{"checkout_id": "chkat_discord"}, Details: paddle.TransactionDetails{Totals: paddle.TransactionTotals{Total: "2900"}}}}
	service.discordNotifier = &billingDiscordNotifier{webhookURL: server.URL, client: server.Client()}
	service.SetNowForTest(func() time.Time { return now.Add(time.Minute) })

	payload := `{"event_id":"evt_discord","event_type":"transaction.completed","occurred_at":"2026-09-15T12:00:00Z","data":{"id":"txn_1"}}`
	require.NoError(t, service.HandleJob(t.Context(), JobTypeWebhook, payload))
	require.NoError(t, service.HandleJob(t.Context(), JobTypeWebhook, payload))
	require.Equal(t, int32(1), requestCount.Load())
	require.Len(t, received.Embeds, 1)
	require.Empty(t, received.AllowedMentions.Parse)
	require.Equal(t, "OpenPost billing", received.Username)
	require.Equal(t, "Paddle Transaction Completed", received.Embeds[0].Title)
	require.Equal(t, "https://app.openpo.st/avatars/owner.png", received.Embeds[0].Thumbnail.URL)

	fields := make(map[string]string, len(received.Embeds[0].Fields))
	for _, field := range received.Embeds[0].Fields {
		fields[field.Name] = field.Value
	}
	require.Equal(t, "owner@example.com", fields["Email"])
	require.Equal(t, "Owner Example", fields["Name"])
	require.Equal(t, "Solo", fields["Plan"])
	require.Equal(t, "USD 29.00", fields["Amount"])

	var event models.BillingWebhookEvent
	require.NoError(t, db.NewSelect().Model(&event).Where("event_id = ?", "evt_discord").Scan(t.Context()))
	require.Equal(t, now.Add(time.Minute), event.DiscordNotificationSentAt)
}
