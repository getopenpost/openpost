package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
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
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "OpenPost", CreatedByID: "owner", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func newConfiguredBillingService(db *bun.DB) *Service {
	return NewService(db, "", PaddleConfig{
		Environment: "sandbox",
		ClientToken: "test_client_token",
		AppURL:      "https://app.openpost.test",
		Plans:       testCatalog(),
	})
}

func TestResumeCheckoutRejectsCanceledAttempt(t *testing.T) {
	db := newBillingTestDB(t)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_canceled", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1",
		Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly",
		Status: "canceled", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	service := newConfiguredBillingService(db)

	_, _, err = service.ResumeCheckout(t.Context(), db, "chkat_canceled", "user-1", "owner@example.com")
	require.ErrorContains(t, err, "no longer available")
}

func TestCanceledCheckoutLateSubscriptionIsCanceledAfterOrganizationDeletion(t *testing.T) {
	db := newBillingTestDB(t)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.BillingCheckoutCancellation{
		CheckoutAttemptID: "chkat_canceled", OrganizationID: "org-deleted", Provider: ProviderPaddle, CanceledAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	api := &fakePaddleAPI{customer: &paddle.Customer{ID: "ctm_1", Email: "owner@example.com"}}
	service := newConfiguredBillingService(db)
	service.api = api
	subscription := &paddle.Subscription{
		ID: "sub_late", Status: paddle.SubscriptionStatusActive,
		CustomData: paddle.CustomData{"checkout_id": "chkat_canceled"},
	}

	require.NoError(t, service.reconcileSubscription(t.Context(), subscription, nil))
	require.Equal(t, 1, api.cancelCalls)
	require.Equal(t, "sub_late", api.cancelInput.SubscriptionID)
	require.NotNil(t, api.cancelInput.EffectiveFrom)
	require.Equal(t, paddle.EffectiveFromImmediately, *api.cancelInput.EffectiveFrom)
	var boundary models.BillingCheckoutCancellation
	require.NoError(t, db.NewSelect().Model(&boundary).Where("checkout_attempt_id = ?", "chkat_canceled").Scan(t.Context()))
	require.Equal(t, "sub_late", boundary.ProviderSubscriptionID)
	require.False(t, boundary.ResolvedAt.IsZero())
	count, err := db.NewSelect().Model((*models.BillingSubscription)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
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

func TestDefaultPlanCatalogUsesUSDPricesAndMonotonicSeatLimits(t *testing.T) {
	t.Parallel()
	catalog := testCatalog()
	require.Equal(t, 15, catalog["starter"].MonthlyPriceUSD)
	require.Equal(t, 250, catalog["founder"].AnnualPriceUSD)
	require.Equal(t, 199, catalog["agency"].MonthlyPriceUSD)
	require.Equal(t, int64(1), catalog["pro"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(3), catalog["team"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(5), catalog["agency"].Limits[entitlements.LimitTeamMembers])
}

func TestPurchaseChoiceCoversEveryCanonicalPlanAndBillingPeriod(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	service := NewService(nil, "", PaddleConfig{
		Plans:                testCatalog(),
		PurchaseChoiceSecret: "purchase-choice-secret-with-at-least-32-characters",
	})
	service.SetNowForTest(func() time.Time { return now })

	expectedPrices := map[string]map[string]int{
		"starter": {"monthly": 15, "annual": 150},
		"founder": {"monthly": 25, "annual": 250},
		"pro":     {"monthly": 49, "annual": 490},
		"team":    {"monthly": 99, "annual": 990},
		"agency":  {"monthly": 199, "annual": 1990},
	}
	for planID, periods := range expectedPrices {
		for period, expectedPrice := range periods {
			planID, period, expectedPrice := planID, period, expectedPrice
			t.Run(planID+"/"+period, func(t *testing.T) {
				t.Parallel()
				choice, err := service.CreatePurchaseChoice(planID, period)
				require.NoError(t, err)
				require.NotEmpty(t, choice.Token)
				require.Equal(t, planID, choice.PlanID)
				require.Equal(t, period, choice.BillingPeriod)
				require.Equal(t, expectedPrice, choice.ListPriceUSD)
				require.Equal(t, TrialDays, choice.TrialDays)
				require.True(t, choice.CardRequired)
				require.Equal(t, now.Add(PurchaseChoiceTTL), choice.ExpiresAt)

				resolved, err := service.ResolvePurchaseChoice(choice.Token, planID, period)
				require.NoError(t, err)
				require.Equal(t, choice, resolved)
			})
		}
	}
}

func TestPurchaseChoiceRejectsMissingInvalidExpiredAndMismatchedValues(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	service := NewService(nil, "", PaddleConfig{
		Plans:                testCatalog(),
		PurchaseChoiceSecret: "purchase-choice-secret-with-at-least-32-characters",
	})
	service.SetNowForTest(func() time.Time { return now })

	_, err := service.CreatePurchaseChoice("", "monthly")
	require.ErrorIs(t, err, ErrPurchaseChoiceMissing)
	_, err = service.CreatePurchaseChoice("founder", "")
	require.ErrorIs(t, err, ErrPurchaseChoiceMissing)
	_, err = service.CreatePurchaseChoice("enterprise", "monthly")
	require.ErrorIs(t, err, ErrPurchaseChoiceInvalid)
	_, err = service.CreatePurchaseChoice("founder", "quarterly")
	require.ErrorIs(t, err, ErrPurchaseChoiceInvalid)
	_, err = service.ResolvePurchaseChoice("", "founder", "monthly")
	require.ErrorIs(t, err, ErrPurchaseChoiceMissing)

	choice, err := service.CreatePurchaseChoice("founder", "annual")
	require.NoError(t, err)
	_, err = service.ResolvePurchaseChoice(choice.Token+"tampered", "founder", "annual")
	require.ErrorIs(t, err, ErrPurchaseChoiceInvalid)
	_, err = service.ResolvePurchaseChoice(choice.Token, "starter", "annual")
	require.ErrorIs(t, err, ErrPurchaseChoiceMismatch)
	_, err = service.ResolvePurchaseChoice(choice.Token, "founder", "monthly")
	require.ErrorIs(t, err, ErrPurchaseChoiceMismatch)

	service.SetNowForTest(func() time.Time { return choice.ExpiresAt.Add(time.Second) })
	_, err = service.ResolvePurchaseChoice(choice.Token, "founder", "annual")
	require.ErrorIs(t, err, ErrPurchaseChoiceExpired)
}

func TestCreateCheckoutRecordsOpaquePaddleAttempt(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := NewService(db, "", PaddleConfig{
		Environment: "sandbox",
		ClientToken: "test_client_token",
		AppURL:      "https://app.openpost.test",
		Plans:       testCatalog(),
	})
	service.SetNowForTest(func() time.Time { return now })

	result, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		OrganizationID: "org-1",
		WorkspaceID:    "ws-1",
		UserID:         "user-1",
		CustomerEmail:  "user@example.com",
		PlanID:         "founder",
		BillingPeriod:  "annual",
		ReturnPath:     "/publications/new?source=calendar",
	})

	require.NoError(t, err)
	require.Regexp(t, `^chkat_[a-f0-9]{32}$`, result.ID)
	require.Equal(t, "https://app.openpost.test/checkout?billing_period=annual&plan=founder", result.URL)
	require.Equal(t, "pri_founder_year", result.ProviderPriceID)
	require.Equal(t, "pri_agency_year", result.PriceIDs["agency"])
	require.Equal(t, "sandbox", result.Environment)
	require.Equal(t, "test_client_token", result.ClientToken)
	require.Equal(t, now.AddDate(0, 0, TrialDays), result.TrialEndsAt)
	require.Equal(t, "https://app.openpost.test/checkout?attempt="+result.ID+"&status=success", result.ReturnURL)

	var attempt models.BillingCheckoutAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).Where("checkout_attempt_id = ?", result.ID).Scan(context.Background()))
	require.Equal(t, ProviderPaddle, attempt.Provider)
	require.Equal(t, "org-1", attempt.OrganizationID)
	require.Equal(t, "founder", attempt.PlanID)
	require.Equal(t, "annual", attempt.BillingPeriod)
	require.Equal(t, "/publications/new?source=calendar", attempt.ReturnPath)
}

func TestCreateCheckoutRejectsCrossOriginReturnPath(t *testing.T) {
	service := NewService(nil, "", PaddleConfig{Environment: "sandbox", ClientToken: "test", Plans: testCatalog()})
	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		OrganizationID: "org-1", CustomerEmail: "user@example.com", PlanID: "founder", ReturnPath: "https://evil.example/steal",
	})
	require.ErrorContains(t, err, "same-origin")
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

func TestConsumeCheckoutReturnWaitsForMatchingWebhookAndNeverConsumesFailure(t *testing.T) {
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	attempt := &models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_delayed", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1",
		Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly",
		ReturnPath: "/calendar?view=week", Status: "pending", CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(attempt).Exec(context.Background())
	require.NoError(t, err)
	service := NewService(db, "")
	service.SetNowForTest(func() time.Time { return now.Add(time.Minute) })

	pending, err := service.ConsumeCheckoutReturn(context.Background(), attempt.CheckoutAttemptID, attempt.UserID)
	require.NoError(t, err)
	require.Equal(t, CheckoutReturnResult{
		Status: "pending", WorkspaceID: "ws-1", PlanID: "founder", BillingPeriod: "monthly",
	}, pending)

	_, err = db.NewUpdate().Model(attempt).Set("status = 'canceled'").WherePK().Exec(context.Background())
	require.NoError(t, err)
	failed, err := service.ConsumeCheckoutReturn(context.Background(), attempt.CheckoutAttemptID, attempt.UserID)
	require.NoError(t, err)
	require.Equal(t, CheckoutReturnResult{
		Status: "failed", WorkspaceID: "ws-1", PlanID: "founder", BillingPeriod: "monthly",
	}, failed)

	_, err = db.NewUpdate().Model(attempt).Set("status = 'active'").WherePK().Exec(context.Background())
	require.NoError(t, err)
	success, err := service.ConsumeCheckoutReturn(context.Background(), attempt.CheckoutAttemptID, attempt.UserID)
	require.NoError(t, err)
	require.Equal(t, CheckoutReturnResult{
		Status: "success", ReturnPath: "/calendar?view=week", WorkspaceID: "ws-1",
		PlanID: "founder", BillingPeriod: "monthly", Consumed: true, NewlyConsumed: true,
	}, success)
}

func TestCreateCheckoutRejectsImplicitEnvironmentAndMissingPrice(t *testing.T) {
	t.Parallel()
	service := NewService(nil, "", PaddleConfig{ClientToken: "test_token", Plans: testCatalog()})
	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{OrganizationID: "org", CustomerEmail: "a@b.com", PlanID: "founder"})
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_PADDLE_ENVIRONMENT")

	catalog := testCatalog()
	catalog["founder"] = PlanConfig{MonthlyPriceUSD: 25, AnnualPriceUSD: 250}
	service = NewService(nil, "", PaddleConfig{Environment: "sandbox", ClientToken: "test_token", Plans: catalog})
	_, err = service.CreateCheckout(context.Background(), CreateCheckoutInput{OrganizationID: "org", CustomerEmail: "a@b.com", PlanID: "founder"})
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID")
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

func TestAcceptPaddleWebhookRequiresCanonicalOccurredAt(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	secret := "pdl_webhook_secret"
	service := NewService(db, secret)
	body := []byte(`{"event_id":"evt_1","event_type":"subscription.updated","data":{"id":"sub_1"}}`)

	_, err := service.AcceptPaddleWebhook(context.Background(), body, paddleSignature(secret, time.Now(), body))

	require.ErrorContains(t, err, "webhook occurred_at must be a valid RFC3339 timestamp")
	var eventCount, jobCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_webhook_events").Scan(context.Background(), &eventCount))
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &jobCount))
	require.Zero(t, eventCount)
	require.Zero(t, jobCount)
}

func TestHandleJobFetchesCanonicalPaddleStateAndKeepsScheduledCancelActive(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_1",
		OrganizationID:    "org-1",
		WorkspaceID:       "ws-1",
		Provider:          ProviderPaddle,
		ProviderPriceID:   "pri_founder_month",
		PlanID:            "founder",
		BillingPeriod:     "monthly",
		Status:            "created",
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Exec(context.Background())
	require.NoError(t, err)
	name := "OpenPost Customer"
	api := &fakePaddleAPI{
		subscription: &paddle.Subscription{
			ID:                   "sub_1",
			Status:               paddle.SubscriptionStatusTrialing,
			CustomerID:           "ctm_1",
			UpdatedAt:            "2026-08-05T11:59:00Z",
			CustomData:           paddle.CustomData{"checkout_id": "chkat_1"},
			Items:                []paddle.SubscriptionItem{{Recurring: true, Price: paddle.Price{ID: "pri_founder_month", ProductID: "pro_founder"}}},
			CurrentBillingPeriod: &paddle.TimePeriod{EndsAt: "2026-08-19T12:00:00Z"},
			ScheduledChange:      &paddle.SubscriptionScheduledChange{Action: paddle.ScheduledChangeActionCancel, EffectiveAt: "2026-08-19T12:00:00Z"},
		},
		customer: &paddle.Customer{ID: "ctm_1", Email: "customer@example.com", Name: &name},
	}
	service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
	service.SetPaddleClientForTest(api)
	service.SetNowForTest(func() time.Time { return now })
	payload := `{"event_id":"evt_old","event_type":"subscription.updated","data":{"id":"sub_1","status":"active"}}`

	require.NoError(t, service.HandleJob(context.Background(), JobTypeWebhook, payload))
	require.Equal(t, 1, api.subGets)
	var sub models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&sub).Where("organization_id = ?", "org-1").Scan(context.Background()))
	require.Equal(t, ProviderPaddle, sub.Provider)
	require.Equal(t, "trialing", sub.Status)
	require.True(t, sub.CancelAtPeriodEnd)
	require.Equal(t, time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC), sub.CurrentPeriodEnd)
	require.Contains(t, sub.EntitlementSnapshot, "scheduled_posts_monthly")

	var customer models.BillingCustomer
	require.NoError(t, db.NewSelect().Model(&customer).Where("provider = ? AND provider_customer_id = ?", ProviderPaddle, "ctm_1").Scan(context.Background()))
	require.Equal(t, "customer@example.com", customer.Email)
}

func TestCreateCustomerPortalSessionReturnsFreshPaddleURL(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-1",
		WorkspaceID:            "ws-1",
		Provider:               ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "active",
		PlanID:                 "founder",
	}).Exec(context.Background())
	require.NoError(t, err)
	api := &fakePaddleAPI{portal: &paddle.CustomerPortalSession{
		ID:         "cpls_1",
		CustomerID: "ctm_1",
		URLs:       paddle.CustomerPortalSessionURLs{General: paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"}},
	}}
	service := NewService(db, "")
	service.SetPaddleClientForTest(api)

	result, err := service.CreateCustomerPortalSession(context.Background(), CreateCustomerPortalInput{OrganizationID: "org-1"})
	require.NoError(t, err)
	require.Equal(t, "cpls_1", result.ID)
	require.Equal(t, "https://customer-portal.paddle.com/overview?token=fresh", result.URL)
	require.Equal(t, "ctm_1", api.portalInput.CustomerID)
	require.Equal(t, []string{"sub_1"}, api.portalInput.SubscriptionIDs)
	api.portal.URLs.General.Overview = "https://customer-portal.paddle.com/overview?token=newer"
	second, err := service.CreateCustomerPortalSession(context.Background(), CreateCustomerPortalInput{OrganizationID: "org-1"})
	require.NoError(t, err)
	require.Equal(t, "https://customer-portal.paddle.com/overview?token=newer", second.URL)
	require.Equal(t, 2, api.portalCalls, "every action must mint a new temporary Paddle portal session")
}

func TestBillingMirrorHasNoDedicatedPaymentMethodOrInvoiceColumns(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	for _, table := range []string{"billing_customers", "billing_subscriptions"} {
		var columns []struct {
			Name string `bun:"name"`
		}
		require.NoError(t, db.NewRaw("SELECT name FROM pragma_table_info(?)", table).Scan(context.Background(), &columns))
		for _, column := range columns {
			name := strings.ToLower(column.Name)
			require.NotContains(t, name, "card")
			require.NotContains(t, name, "payment_method")
			require.NotContains(t, name, "invoice")
			require.NotContains(t, name, "receipt")
		}
	}
}

func TestCreateCustomerPortalSessionReturnsExactPaymentRecoveryURL(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-1",
		WorkspaceID:            "ws-1",
		Provider:               ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "past_due",
		PlanID:                 "founder",
	}).Exec(context.Background())
	require.NoError(t, err)
	api := &fakePaddleAPI{portal: &paddle.CustomerPortalSession{
		ID:         "cpls_1",
		CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{
			General: paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"},
			Subscriptions: []paddle.CustomerPortalSessionSubscriptionURLs{
				{ID: "sub_other", UpdateSubscriptionPaymentMethod: "https://customer-portal.paddle.com/wrong"},
				{ID: "sub_1", UpdateSubscriptionPaymentMethod: "https://customer-portal.paddle.com/payment-method?token=fresh"},
			},
		},
	}}
	service := NewService(db, "")
	service.SetPaddleClientForTest(api)

	result, err := service.CreateCustomerPortalSession(context.Background(), CreateCustomerPortalInput{
		OrganizationID: "org-1",
		Purpose:        CustomerPortalPurposeUpdatePaymentMethod,
	})

	require.NoError(t, err)
	require.Equal(t, "https://customer-portal.paddle.com/payment-method?token=fresh", result.URL)
	require.Equal(t, []string{"sub_1"}, api.portalInput.SubscriptionIDs)
}

func TestCreateCustomerPortalSessionMapsPurposeLinksAndFallsBackToOverview(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org-1", Provider: ProviderPaddle, ProviderCustomerID: "ctm_1",
		ProviderSubscriptionID: "sub_1", Status: "active", PlanID: "founder",
	}).Exec(context.Background())
	require.NoError(t, err)
	api := &fakePaddleAPI{portal: &paddle.CustomerPortalSession{
		ID: "cpls_1", CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{
			General: paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"},
			Subscriptions: []paddle.CustomerPortalSessionSubscriptionURLs{{
				ID: "sub_1", CancelSubscription: "https://customer-portal.paddle.com/cancel?token=fresh",
			}},
		},
	}}
	service := NewService(db, "")
	service.SetPaddleClientForTest(api)

	cancel, err := service.CreateCustomerPortalSession(context.Background(), CreateCustomerPortalInput{
		OrganizationID: "org-1", Purpose: CustomerPortalPurposeCancelSubscription,
	})
	require.NoError(t, err)
	require.Equal(t, "https://customer-portal.paddle.com/cancel?token=fresh", cancel.URL)
	require.False(t, cancel.UsedGenericFallback)

	for _, purpose := range []CustomerPortalPurpose{CustomerPortalPurposeInvoices, CustomerPortalPurposeBillingDetails, CustomerPortalPurposeUpdatePaymentMethod} {
		result, portalErr := service.CreateCustomerPortalSession(context.Background(), CreateCustomerPortalInput{
			OrganizationID: "org-1", Purpose: purpose,
		})
		require.NoError(t, portalErr)
		require.Equal(t, "https://customer-portal.paddle.com/overview?token=fresh", result.URL)
		require.True(t, result.UsedGenericFallback)
		require.Equal(t, purpose, result.Purpose)
	}
}

func TestCreateCustomerPortalSessionFallsBackWhenRecoveryLinkDoesNotMatch(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-1",
		WorkspaceID:            "ws-1",
		Provider:               ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "past_due",
		PlanID:                 "founder",
	}).Exec(context.Background())
	require.NoError(t, err)
	api := &fakePaddleAPI{portal: &paddle.CustomerPortalSession{
		ID:         "cpls_1",
		CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{
			General:       paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"},
			Subscriptions: []paddle.CustomerPortalSessionSubscriptionURLs{{ID: "sub_other", UpdateSubscriptionPaymentMethod: "https://customer-portal.paddle.com/wrong"}},
		},
	}}
	service := NewService(db, "")
	service.SetPaddleClientForTest(api)

	result, err := service.CreateCustomerPortalSession(context.Background(), CreateCustomerPortalInput{
		OrganizationID: "org-1",
		Purpose:        CustomerPortalPurposeUpdatePaymentMethod,
	})

	require.NoError(t, err)
	require.Equal(t, "https://customer-portal.paddle.com/overview?token=fresh", result.URL)
	require.True(t, result.UsedGenericFallback)
}

func TestReconcileSubscriptionPreservesCanonicalRecoveryOrder(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 9, 10, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_recovery",
		OrganizationID:    "org-1",
		WorkspaceID:       "ws-1",
		Provider:          ProviderPaddle,
		ProviderPriceID:   "pri_founder_month",
		PlanID:            "founder",
		BillingPeriod:     "monthly",
		Status:            "created",
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Exec(context.Background())
	require.NoError(t, err)
	name := "Billing Owner"
	api := &fakePaddleAPI{customer: &paddle.Customer{ID: "ctm_1", Email: "owner@example.com", Name: &name}}
	service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
	service.SetPaddleClientForTest(api)
	service.SetNowForTest(func() time.Time { return now })

	pastDueAt := time.Date(2026, 8, 9, 11, 0, 0, 0, time.UTC)
	stillPastDueAt := pastDueAt.Add(time.Hour)
	recoveredAt := stillPastDueAt.Add(time.Hour)
	require.NoError(t, service.reconcileSubscription(context.Background(), recoverySubscription(paddle.SubscriptionStatusPastDue, pastDueAt), nil))

	now = now.Add(time.Hour)
	require.NoError(t, service.reconcileSubscription(context.Background(), recoverySubscription(paddle.SubscriptionStatusPastDue, stillPastDueAt), nil))
	assertStoredSubscriptionRecovery(t, db, "past_due", stillPastDueAt, pastDueAt)

	now = now.Add(time.Hour)
	recovered := recoverySubscription(paddle.SubscriptionStatusActive, recoveredAt)
	require.NoError(t, service.reconcileSubscription(context.Background(), recovered, nil))
	assertStoredSubscriptionRecovery(t, db, "active", recoveredAt, time.Time{})

	var afterRecovery models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&afterRecovery).Where("organization_id = ?", "org-1").Scan(context.Background()))
	now = now.Add(time.Hour)
	require.NoError(t, service.reconcileSubscription(context.Background(), recoverySubscription(paddle.SubscriptionStatusPastDue, stillPastDueAt), nil))
	require.NoError(t, service.reconcileSubscription(context.Background(), recovered, nil))
	assertStoredSubscriptionRecovery(t, db, "active", recoveredAt, time.Time{})

	var afterReplay models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&afterReplay).Where("organization_id = ?", "org-1").Scan(context.Background()))
	require.Equal(t, afterRecovery.UpdatedAt, afterReplay.UpdatedAt, "stale and equal-version snapshots must be deterministic no-ops")
	api.subscription = recovered
	require.NoError(t, service.HandleJob(
		context.Background(),
		JobTypeWebhook,
		`{"event_id":"evt_stale","event_type":"subscription.past_due","data":{"id":"sub_1"}}`,
	))
	require.Equal(t, 1, api.subGets)
	assertStoredSubscriptionRecovery(t, db, "active", recoveredAt, time.Time{})

	conflicting := recoverySubscription(paddle.SubscriptionStatusPastDue, recoveredAt)
	err = service.reconcileSubscription(context.Background(), conflicting, nil)
	require.ErrorContains(t, err, "conflicting Paddle subscription snapshots share updated_at")
	assertStoredSubscriptionRecovery(t, db, "active", recoveredAt, time.Time{})
}

func TestReconcileSubscriptionRefusesADeletedOrganization(t *testing.T) {
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 9, 10, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{CheckoutAttemptID: "chkat_recovery", OrganizationID: "org-1", WorkspaceID: "ws-1", Provider: ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly", Status: "created", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewDelete().Model((*models.Organization)(nil)).Where("id = ?", "org-1").Exec(t.Context())
	require.NoError(t, err)
	name := "Billing Owner"
	service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
	service.SetPaddleClientForTest(&fakePaddleAPI{customer: &paddle.Customer{ID: "ctm_1", Email: "owner@example.com", Name: &name}})

	err = service.reconcileSubscription(t.Context(), recoverySubscription(paddle.SubscriptionStatusActive, now.Add(time.Hour)), nil)
	require.ErrorContains(t, err, "deleted Organization")
	require.Zero(t, countBillingSubscriptions(t, db, "org-1"))
}

func countBillingSubscriptions(t *testing.T, db *bun.DB, organizationID string) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.BillingSubscription)(nil)).Where("organization_id = ?", organizationID).Count(t.Context())
	require.NoError(t, err)
	return count
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

func assertStoredSubscriptionRecovery(t *testing.T, db *bun.DB, status string, providerUpdatedAt, pastDueSince time.Time) {
	t.Helper()
	var subscription models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&subscription).Where("organization_id = ?", "org-1").Scan(context.Background()))
	require.Equal(t, status, subscription.Status)
	require.True(t, providerUpdatedAt.Equal(subscription.ProviderUpdatedAt))
	if pastDueSince.IsZero() {
		require.True(t, subscription.PastDueSince.IsZero())
	} else {
		require.True(t, pastDueSince.Equal(subscription.PastDueSince))
	}
}
