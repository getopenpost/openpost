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
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
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
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingWebhookEvent)(nil),
		(*models.BillingCheckoutAttempt)(nil),
		(*models.BillingCheckoutCancellation)(nil),
		(*models.BillingCustomer)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.ExecContext(context.Background(), `CREATE TABLE voice_profiles (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		normalized_name TEXT NOT NULL,
		is_default BOOLEAN NOT NULL DEFAULT false,
		revision INTEGER NOT NULL DEFAULT 1,
		schema_version INTEGER NOT NULL DEFAULT 1,
		definition_json TEXT NOT NULL DEFAULT '{}',
		created_by_id TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		UNIQUE (id, workspace_id),
		UNIQUE (workspace_id, normalized_name)
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(context.Background(), `CREATE UNIQUE INDEX voice_profiles_default_idx ON voice_profiles (workspace_id) WHERE is_default = true`)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "OpenPost", CreatedByID: "owner", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func TestCheckoutCancellationWinningBeforeReconciliationLockTerminatesSubscription(t *testing.T) {
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

	require.NoError(t, service.reconcileSubscription(t.Context(), recoverySubscription(paddle.SubscriptionStatusActive, now), nil))
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
		PaddlePriceIDs{Monthly: "pri_starter_month", Annual: "pri_starter_year"},
		PaddlePriceIDs{Monthly: "pri_founder_month", Annual: "pri_founder_year"},
		PaddlePriceIDs{Monthly: "pri_pro_month", Annual: "pri_pro_year"},
		PaddlePriceIDs{Monthly: "pri_team_month", Annual: "pri_team_year"},
		PaddlePriceIDs{Monthly: "pri_agency_month", Annual: "pri_agency_year"},
	)
}

func TestConsumeCheckoutReturnRequiresExactUserAndConsumesPathOnce(t *testing.T) {
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

func TestAcceptPaddleWebhookRejectsInvalidSignature(t *testing.T) {
	t.Parallel()
	service := NewService(newBillingTestDB(t), "pdl_webhook_secret")
	body := []byte(`{"event_id":"evt_1","event_type":"subscription.updated","data":{"id":"sub_1"}}`)
	_, err := service.AcceptPaddleWebhook(context.Background(), body, "ts=1;h1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	require.ErrorContains(t, err, "invalid Paddle webhook signature")
}

func recoverySubscription(status paddle.SubscriptionStatus, updatedAt time.Time) *paddle.Subscription {
	return &paddle.Subscription{
		ID:         "sub_1",
		Status:     status,
		CustomerID: "ctm_1",
		UpdatedAt:  updatedAt.Format(time.RFC3339Nano),
		CustomData: paddle.CustomData{"checkout_id": "chkat_recovery"},
		Items: []paddle.SubscriptionItem{{
			Recurring: true,
			Price:     paddle.Price{ID: "pri_founder_month", ProductID: "pro_founder"},
		}},
	}
}
