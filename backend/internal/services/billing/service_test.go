package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type recordedRequest struct {
	Method         string
	Path           string
	Auth           string
	IdempotencyKey string
	Body           map[string]any
}

type fakeWhopHTTPClient struct {
	t        *testing.T
	requests []recordedRequest
	respond  func(*http.Request) (int, string)
}

func (f *fakeWhopHTTPClient) Do(req *http.Request) (*http.Response, error) {
	f.t.Helper()
	var body map[string]any
	if req.Body != nil {
		require.NoError(f.t, json.NewDecoder(req.Body).Decode(&body))
	}
	f.requests = append(f.requests, recordedRequest{
		Method:         req.Method,
		Path:           req.URL.Path,
		Auth:           req.Header.Get("Authorization"),
		IdempotencyKey: req.Header.Get("Idempotency-Key"),
		Body:           body,
	})
	status, response := http.StatusOK, `{}`
	if f.respond != nil {
		status, response = f.respond(req)
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(response)),
		Header:     make(http.Header),
	}, nil
}

func newBillingTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingWebhookEvent)(nil),
		(*models.BillingCheckoutAttempt)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func signedWebhookHeaders(secret string, now time.Time, eventID string, body []byte) WebhookHeaders {
	timestamp := fmt.Sprintf("%d", now.Unix())
	mac := hmac.New(sha256.New, decodeWebhookSecret(secret))
	_, _ = mac.Write([]byte(eventID + "." + timestamp + "." + string(body)))
	return WebhookHeaders{
		ID:        eventID,
		Timestamp: timestamp,
		Signature: "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil)),
	}
}

func testCatalog() map[string]PlanConfig {
	return DefaultPlanCatalog(
		ProviderPlanIDs{Monthly: "plan_starter_month", Annual: "plan_starter_year"},
		ProviderPlanIDs{Monthly: "plan_creator_month", Annual: "plan_creator_year"},
		ProviderPlanIDs{Monthly: "plan_pro_month", Annual: "plan_pro_year"},
		ProviderPlanIDs{Monthly: "plan_team_month", Annual: "plan_team_year"},
		ProviderPlanIDs{Monthly: "plan_agency_month", Annual: "plan_agency_year"},
	)
}

func TestDefaultPlanCatalogUsesUSDPricesAndMonotonicSeatLimits(t *testing.T) {
	t.Parallel()
	catalog := testCatalog()
	require.Equal(t, 15, catalog["starter"].MonthlyPriceUSD)
	require.Equal(t, 290, catalog["creator"].AnnualPriceUSD)
	require.Equal(t, 199, catalog["agency"].MonthlyPriceUSD)
	require.Equal(t, int64(1), catalog["pro"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(3), catalog["team"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(5), catalog["agency"].Limits[entitlements.LimitTeamMembers])
}

func TestCreateCheckoutCreatesWhopConfigurationAndRecordsAttempt(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	client := &fakeWhopHTTPClient{t: t, respond: func(*http.Request) (int, string) {
		return http.StatusCreated, `{"id":"ch_1","purchase_url":"https://whop.com/checkout/ch_1","plan":{"id":"plan_creator_year"}}`
	}}
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	service := NewService(db, "", WhopConfig{
		APIKey:     "whop-token",
		APIBaseURL: "https://api.whop.test/api/v1",
		AccountID:  "biz_1",
		ProductID:  "prod_1",
		AppURL:     "https://app.openpost.test",
		ReturnURL:  "https://app.openpost.test/checkout?status=success",
		Plans:      testCatalog(),
	})
	service.SetNowForTest(func() time.Time { return now })
	service.SetHTTPClientForTest(client)

	result, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		OrganizationID: "org-1",
		WorkspaceID:    "ws-1",
		UserID:         "user-1",
		CustomerEmail:  "user@example.com",
		PlanID:         "creator",
		BillingPeriod:  "annual",
		AffiliateCode:  "creator-friend",
	})

	require.NoError(t, err)
	require.Equal(t, "ch_1", result.ID)
	require.Equal(t, "plan_creator_year", result.ProviderPlanID)
	require.Equal(t, 290, result.PriceUSD)
	require.Equal(t, now.AddDate(0, 0, TrialDays), result.TrialEndsAt)
	require.Contains(t, result.URL, "https://app.openpost.test/checkout?")
	require.Len(t, client.requests, 1)
	req := client.requests[0]
	require.Equal(t, http.MethodPost, req.Method)
	require.Equal(t, "/api/v1/checkout_configurations", req.Path)
	require.Equal(t, "Bearer whop-token", req.Auth)
	require.Contains(t, req.IdempotencyKey, "checkout:org-1:creator:annual")
	require.Equal(t, "biz_1", req.Body["company_id"])
	require.Equal(t, "plan_creator_year", req.Body["plan_id"])
	require.Equal(t, "payment", req.Body["mode"])
	require.Equal(t, "creator-friend", req.Body["affiliate_code"])
	metadata := req.Body["metadata"].(map[string]any)
	require.Equal(t, "org-1", metadata["organization_id"])
	require.Equal(t, "annual", metadata["billing_period"])

	var attempt models.BillingCheckoutAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).Where("checkout_configuration_id = ?", "ch_1").Scan(context.Background()))
	require.Equal(t, "org-1", attempt.OrganizationID)
	require.Equal(t, "creator", attempt.PlanID)
	require.Equal(t, "annual", attempt.BillingPeriod)
}

func TestCreateCheckoutRejectsUnconfiguredWhopPlan(t *testing.T) {
	t.Parallel()
	service := NewService(nil, "", WhopConfig{APIKey: "key", AccountID: "biz_1", Plans: map[string]PlanConfig{}})
	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{OrganizationID: "org", CustomerEmail: "a@b.com", PlanID: "creator"})
	require.ErrorContains(t, err, "unknown billing plan")
}

func TestCreateCheckoutMissingPlanIDIsConfigurationError(t *testing.T) {
	t.Parallel()
	catalog := testCatalog()
	catalog["creator"] = PlanConfig{MonthlyPriceUSD: 29, AnnualPriceUSD: 290}
	service := NewService(nil, "", WhopConfig{APIKey: "key", AccountID: "biz_1", Plans: catalog})
	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{OrganizationID: "org", CustomerEmail: "a@b.com", PlanID: "creator"})
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID")
}

func TestWhopAPIURLAcceptsRootOrVersionedBaseURL(t *testing.T) {
	t.Parallel()
	require.Equal(t, "https://api.whop.com/api/v1/memberships/mem_1", whopAPIURL("https://api.whop.com", "/memberships/mem_1"))
	require.Equal(t, "https://api.whop.com/api/v1/memberships/mem_1", whopAPIURL("https://api.whop.com/api/v1", "/memberships/mem_1"))
	require.Equal(t, "https://test.whop.dev/v1/memberships/mem_1", whopAPIURL("https://test.whop.dev/v1/", "/v1/memberships/mem_1"))
}

func TestAcceptWhopWebhookQueuesOnce(t *testing.T) {
	t.Parallel()
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("secret"))
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	db := newBillingTestDB(t)
	service := NewService(db, secret)
	service.SetNowForTest(func() time.Time { return now })
	body := []byte(`{"id":"evt_1","type":"membership.activated","data":{"id":"mem_1"}}`)
	headers := signedWebhookHeaders(secret, now, "evt_1", body)

	first, err := service.AcceptWhopWebhook(context.Background(), body, headers)
	require.NoError(t, err)
	require.False(t, first.Duplicate)
	second, err := service.AcceptWhopWebhook(context.Background(), body, headers)
	require.NoError(t, err)
	require.True(t, second.Duplicate)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Where("type = ?", JobTypeWebhook).Scan(context.Background(), &count))
	require.Equal(t, 1, count)
}

func TestHandleJobFetchesCurrentWhopMembershipAndUpsertsSubscription(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
			CheckoutConfigurationID: "ch_1",
			OrganizationID:          "org-1",
			WorkspaceID:             "ws-1",
			Provider:                ProviderWhop,
			ProviderPlanID:          "plan_creator_month",
			PlanID:                  "creator",
			BillingPeriod:           "monthly",
			Status:                  "created",
			CreatedAt:               now,
			UpdatedAt:               now,
		}).Exec(context.Background())
		return err
	}())
	client := &fakeWhopHTTPClient{t: t, respond: func(req *http.Request) (int, string) {
		require.Equal(t, http.MethodGet, req.Method)
		return http.StatusOK, `{
			"id":"mem_1","status":"trialing","manage_url":"https://whop.com/manage/mem_1",
			"checkout_configuration_id":"ch_1","renewal_period_end":"2026-08-18T12:00:00Z",
			"cancel_at_period_end":false,"user":{"id":"user_whop_1","email":"user@example.com"},
			"company":{"id":"biz_1"},"plan":{"id":"plan_creator_month"},"product":{"id":"prod_1"}
		}`
	}}
	service := NewService(db, "", WhopConfig{APIKey: "key", APIBaseURL: "https://api.whop.test/api/v1", Plans: testCatalog()})
	service.SetNowForTest(func() time.Time { return now })
	service.SetHTTPClientForTest(client)
	payload := `{"id":"evt_1","type":"membership.activated","data":{"id":"mem_1"}}`

	require.NoError(t, service.HandleJob(context.Background(), JobTypeWebhook, payload))
	var sub models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&sub).Where("organization_id = ?", "org-1").Scan(context.Background()))
	require.Equal(t, ProviderWhop, sub.Provider)
	require.Equal(t, "mem_1", sub.ProviderSubscriptionID)
	require.Equal(t, "trialing", sub.Status)
	require.Equal(t, "creator", sub.PlanID)
	require.Equal(t, "https://whop.com/manage/mem_1", sub.ProviderManageURL)
	require.Equal(t, time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC), sub.CurrentPeriodEnd)
	require.Contains(t, sub.EntitlementSnapshot, "scheduled_posts_monthly")

	var attempt models.BillingCheckoutAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).Where("checkout_configuration_id = ?", "ch_1").Scan(context.Background()))
	require.Equal(t, "mem_1", attempt.ProviderMembershipID)
	require.Equal(t, "trialing", attempt.Status)
}

func TestCreateCustomerPortalSessionUsesWhopManageURL(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-1",
		WorkspaceID:            "ws-1",
		Provider:               ProviderWhop,
		ProviderCustomerID:     "user_1",
		ProviderSubscriptionID: "mem_1",
		ProviderManageURL:      "https://whop.com/manage/mem_1",
		Status:                 "active",
		PlanID:                 "creator",
	}).Exec(context.Background())
	require.NoError(t, err)
	service := NewService(db, "")
	result, err := service.CreateCustomerPortalSession(context.Background(), "org-1")
	require.NoError(t, err)
	require.Equal(t, "mem_1", result.ID)
	require.Equal(t, "https://whop.com/manage/mem_1", result.URL)
}

func TestAcceptWhopWebhookRejectsInvalidOrStaleSignatures(t *testing.T) {
	t.Parallel()
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("secret"))
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	service := NewService(newBillingTestDB(t), secret)
	service.SetNowForTest(func() time.Time { return now })
	body := []byte(`{"id":"evt_1","type":"membership.activated","data":{"id":"mem_1"}}`)
	bad := signedWebhookHeaders(secret, now, "evt_1", body)
	bad.Signature = "v1,not-valid"
	_, err := service.AcceptWhopWebhook(context.Background(), body, bad)
	require.ErrorContains(t, err, "invalid webhook signature")
	stale := signedWebhookHeaders(secret, now.Add(-6*time.Minute), "evt_1", body)
	_, err = service.AcceptWhopWebhook(context.Background(), body, stale)
	require.ErrorContains(t, err, "outside tolerance")
}
