package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type fakePaddleAPI struct {
	subscription *paddle.Subscription
	transaction  *paddle.Transaction
	customer     *paddle.Customer
	portal       *paddle.CustomerPortalSession
	portalInput  *paddle.CreateCustomerPortalSessionRequest
	cancelInput  *paddle.CancelSubscriptionRequest
	portalCalls  int
	cancelCalls  int
	subGets      int
	customerGets int
}

func (f *fakePaddleAPI) GetSubscription(context.Context, *paddle.GetSubscriptionRequest) (*paddle.Subscription, error) {
	f.subGets++
	return f.subscription, nil
}

func (f *fakePaddleAPI) CancelSubscription(_ context.Context, input *paddle.CancelSubscriptionRequest) (*paddle.Subscription, error) {
	f.cancelCalls++
	f.cancelInput = input
	return &paddle.Subscription{ID: input.SubscriptionID, Status: paddle.SubscriptionStatusCanceled}, nil
}

func (f *fakePaddleAPI) GetTransaction(context.Context, *paddle.GetTransactionRequest) (*paddle.Transaction, error) {
	return f.transaction, nil
}

func (f *fakePaddleAPI) GetCustomer(context.Context, *paddle.GetCustomerRequest) (*paddle.Customer, error) {
	f.customerGets++
	return f.customer, nil
}

func (f *fakePaddleAPI) CreateCustomerPortalSession(_ context.Context, input *paddle.CreateCustomerPortalSessionRequest) (*paddle.CustomerPortalSession, error) {
	f.portalCalls++
	f.portalInput = input
	return f.portal, nil
}

func newBillingTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db := testdb.NewSQLiteBase(t)
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "OpenPost", CreatedByID: "owner", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	return db
}

func TestCheckoutCancellationWinningBeforeReconciliationLockTerminatesSubscription(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Now().UTC()
	attempt := &models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_recovery", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1",
		Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly",
		Status: "created", CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(attempt).Exec(t.Context())
	require.NoError(t, err)
	api := &fakePaddleAPI{customer: &paddle.Customer{ID: "ctm_1", Email: "owner@example.com"}}
	service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
	service.api = api
	service.beforeSubscriptionApply = func() {
		service.beforeSubscriptionApply = nil
		_, updateErr := db.NewUpdate().Model((*models.BillingCheckoutAttempt)(nil)).Set("status = ?", "canceled").Where("checkout_attempt_id = ?", attempt.CheckoutAttemptID).Exec(t.Context())
		require.NoError(t, updateErr)
		_, insertErr := db.NewInsert().Model(&models.BillingCheckoutCancellation{CheckoutAttemptID: attempt.CheckoutAttemptID, OrganizationID: attempt.OrganizationID, Provider: ProviderPaddle, CanceledAt: now}).Exec(t.Context())
		require.NoError(t, insertErr)
	}

	require.NoError(t, service.reconcileSubscription(t.Context(), recoverySubscription(now), nil))
	require.Equal(t, 1, api.cancelCalls)
	require.Equal(t, "sub_1", api.cancelInput.SubscriptionID)
	count, err := db.NewSelect().Model((*models.BillingSubscription)(nil)).Where("organization_id = ?", "org-1").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func paddleSignature(secret string, now time.Time, body []byte) string {
	timestamp := fmt.Sprintf("%d", now.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + ":" + string(body)))
	return "ts=" + timestamp + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func testCatalog() map[string]PlanConfig {
	return DefaultPlanCatalog(
		PaddlePriceIDs{Monthly: "pri_founder_month", Annual: "pri_founder_year"},
		PaddlePriceIDs{Monthly: "pri_team_month", Annual: "pri_team_year"},
		PaddlePriceIDs{Monthly: "pri_agency_month", Annual: "pri_agency_year"},
	)
}

func TestConsumeCheckoutReturnRequiresExactUserAndConsumesPathOnce(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_return", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1",
		Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly",
		ReturnPath: "/compose?draft=launch", Status: "trialing", CreatedAt: now, UpdatedAt: now,
	}).Exec(context.Background())
	require.NoError(t, err)
	service := NewService(db, "")
	service.SetNowForTest(func() time.Time { return now.Add(time.Minute) })

	_, err = service.ConsumeCheckoutReturn(context.Background(), "chkat_return", "other-user")
	require.ErrorIs(t, err, sql.ErrNoRows)
	first, err := service.ConsumeCheckoutReturn(context.Background(), "chkat_return", "user-1")
	require.NoError(t, err)
	require.Equal(t, CheckoutReturnResult{
		Status: "success", ReturnPath: "/compose?draft=launch", WorkspaceID: "ws-1",
		PlanID: "founder", BillingPeriod: "monthly", Consumed: true, NewlyConsumed: true,
	}, first)
	second, err := service.ConsumeCheckoutReturn(context.Background(), "chkat_return", "user-1")
	require.NoError(t, err)
	require.Equal(t, CheckoutReturnResult{
		Status: "success", WorkspaceID: "ws-1", PlanID: "founder", BillingPeriod: "monthly", Consumed: true,
	}, second)
}

func TestAcceptPaddleWebhookQueuesSupportedEventOnce(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	secret := "pdl_webhook_secret"
	service := NewService(db, secret)
	body := []byte(`{"event_id":"evt_1","event_type":"subscription.updated","occurred_at":"2026-08-05T12:00:00Z","data":{"id":"sub_1"}}`)
	signature := paddleSignature(secret, time.Now(), body)

	first, err := service.AcceptPaddleWebhook(context.Background(), body, signature)
	require.NoError(t, err)
	require.False(t, first.Duplicate)
	second, err := service.AcceptPaddleWebhook(context.Background(), body, signature)
	require.NoError(t, err)
	require.True(t, second.Duplicate)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Where("type = ?", JobTypeWebhook).Scan(context.Background(), &count))
	require.Equal(t, 1, count)
	var event models.BillingWebhookEvent
	require.NoError(t, db.NewSelect().Model(&event).Where("event_id = ?", "evt_1").Scan(context.Background()))
	require.Equal(t, time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC), event.OccurredAt)
}

func recoverySubscription(updatedAt time.Time) *paddle.Subscription {
	return &paddle.Subscription{
		ID:         "sub_1",
		Status:     paddle.SubscriptionStatusActive,
		CustomerID: "ctm_1",
		UpdatedAt:  updatedAt.Format(time.RFC3339Nano),
		CustomData: paddle.CustomData{"checkout_id": "chkat_recovery"},
		Items: []paddle.SubscriptionItem{{
			Recurring: true,
			Price:     paddle.Price{ID: "pri_founder_month", ProductID: "pro_founder"},
		}},
	}
}

func TestOldSubscriptionEventsCannotReplaceNewCheckout(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Now().UTC()
	service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
	service.api = &fakePaddleAPI{customer: &paddle.Customer{ID: "ctm_1", Email: "owner@example.com"}}
	for i, id := range []string{"chkat_recovery", "chkat_new"} {
		_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{CheckoutAttemptID: id, OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1", Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly", Status: "created", CreatedAt: now.Add(time.Duration(i) * time.Hour), UpdatedAt: now}).Exec(t.Context())
		require.NoError(t, err)
	}
	old := recoverySubscription(now)
	require.NoError(t, service.reconcileSubscription(t.Context(), old, nil))
	newer := recoverySubscription(now.Add(time.Hour))
	newer.ID = "sub_new"
	newer.CustomData = paddle.CustomData{"checkout_id": "chkat_new"}
	require.NoError(t, service.reconcileSubscription(t.Context(), newer, nil))
	for _, status := range []paddle.SubscriptionStatus{paddle.SubscriptionStatusCanceled, paddle.SubscriptionStatusActive} {
		old.Status = status
		old.UpdatedAt = now.Add(2 * time.Hour).Format(time.RFC3339Nano)
		require.NoError(t, service.reconcileSubscription(t.Context(), old, nil))
		var stored models.BillingSubscription
		require.NoError(t, db.NewSelect().Model(&stored).Where("organization_id = ?", "org-1").Scan(t.Context()))
		require.Equal(t, "sub_new", stored.ProviderSubscriptionID)
		require.Equal(t, "active", stored.Status)
	}
}

func TestSubscriptionReconciliationRejectsCheckoutPriceSubstitution(t *testing.T) {
	t.Parallel()
	for _, priceID := range []string{"pri_founder_month", "pri_agency_year", "pri_unknown", ""} {
		t.Run(priceID, func(t *testing.T) {
			db := newBillingTestDB(t)
			now := time.Now().UTC()
			_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{CheckoutAttemptID: "chkat_recovery", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1", Provider: ProviderPaddle, ProviderPriceID: "pri_agency_month", PlanID: "agency", BillingPeriod: "monthly", Status: "created", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
			require.NoError(t, err)
			service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
			api := &fakePaddleAPI{customer: &paddle.Customer{ID: "ctm_1", Email: "owner@example.com"}}
			service.api = api
			subscription := recoverySubscription(now)
			subscription.Items[0].Price.ID = priceID
			require.Error(t, service.reconcileSubscription(t.Context(), subscription, nil))
			count, err := db.NewSelect().Model((*models.BillingSubscription)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count)
			require.Zero(t, api.customerGets)
		})
	}
}
