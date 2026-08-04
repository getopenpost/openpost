package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/billing"
	"github.com/openpost/backend/internal/services/entitlements"
	usageservice "github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type billingTestServer struct {
	echo   *echo.Echo
	db     *bun.DB
	client *billingHTTPClient
	usage  *usageservice.Service
}

type billingHTTPClient struct {
	t        *testing.T
	requests []billingHTTPRequest
	response string
	status   int
}

type billingHTTPRequest struct {
	Path string
	Body map[string]any
}

func (c *billingHTTPClient) Do(req *http.Request) (*http.Response, error) {
	c.t.Helper()

	var body map[string]any
	if req.Body != nil {
		require.NoError(c.t, json.NewDecoder(req.Body).Decode(&body))
	}
	c.requests = append(c.requests, billingHTTPRequest{Path: req.URL.Path, Body: body})
	status := c.status
	if status == 0 {
		status = http.StatusCreated
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(c.response)),
		Header:     make(http.Header),
	}, nil
}

func newBillingHandlerTestServer(t *testing.T, secret string, now time.Time) *billingTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingWebhookEvent)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Organization{ID: "org_ws-1", Name: "Launch", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org_ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	service := billing.NewService(db, secret)
	service.SetNowForTest(func() time.Time { return now })
	NewBillingHandler(service).RegisterRoutes(e)
	return &billingTestServer{echo: e, db: db}
}

func newBillingAPITestServer(t *testing.T) *billingTestServer {
	t.Helper()

	client := &billingHTTPClient{t: t}
	return newBillingAPITestServerWithWhopConfig(t, client, billing.WhopConfig{
		APIKey:     "whop-token",
		APIBaseURL: "https://api.whop.test/api/v1",
		AccountID:  "biz_1",
		ProductID:  "prod_1",
		AppURL:     "https://app.openpost.test",
		ReturnURL:  "https://app.openpost.test/checkout?status=success",
		Plans: map[string]billing.PlanConfig{
			"creator": {
				ProviderPlanIDs: billing.ProviderPlanIDs{Monthly: "plan_creator_month", Annual: "plan_creator_year"},
				MonthlyPriceUSD: 29,
				AnnualPriceUSD:  290,
				Limits: map[entitlements.LimitKey]int64{
					entitlements.LimitScheduledPostsMonthly: 500,
					entitlements.LimitSocialAccounts:        6,
				},
			},
		},
	})
}

func newBillingAPITestServerWithWhopConfig(t *testing.T, client *billingHTTPClient, cfg billing.WhopConfig) *billingTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingCheckoutAttempt)(nil),
		(*models.UsageCounter)(nil),
		(*models.ProviderUsageEvent)(nil),
		(*models.ProviderUsageReservation)(nil),
		(*models.ProviderUsagePeriodCounter)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org_ws-1", Name: "Launch", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org_ws-1",
		UserID:         "user-1",
		Role:           models.OrganizationRoleOwner,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org_ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	service := billing.NewService(db, "", cfg)
	service.SetHTTPClientForTest(client)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewBillingHandler(service, db, testAuthenticator{})
	usageService := usageservice.NewService(db)
	handler.SetUsage(usageService)
	handler.RegisterAPIRoutes(api)
	return &billingTestServer{echo: e, db: db, client: client, usage: usageService}
}

func (s *billingTestServer) postWebhook(t *testing.T, body []byte, headers billing.WebhookHeaders) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/billing/whop/webhook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("webhook-id", headers.ID)
	req.Header.Set("webhook-timestamp", headers.Timestamp)
	req.Header.Set("webhook-signature", headers.Signature)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *billingTestServer) postJSON(t *testing.T, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *billingTestServer) getJSON(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func signedWhopWebhookHeaders(t *testing.T, secret string, now time.Time, eventID string, body []byte) billing.WebhookHeaders {
	t.Helper()

	timestamp := fmt.Sprintf("%d", now.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(eventID + "." + timestamp + "." + string(body)))
	return billing.WebhookHeaders{
		ID:        eventID,
		Timestamp: timestamp,
		Signature: "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil)),
	}
}

func TestWhopWebhookRouteQueuesReconciliation(t *testing.T) {
	t.Parallel()

	secret := "route-secret"
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	srv := newBillingHandlerTestServer(t, secret, now)
	body := []byte(`{"id":"evt-route","type":"membership.activated","data":{"id":"mem-route"}}`)

	resp := srv.postWebhook(t, body, signedWhopWebhookHeaders(t, secret, now, "evt-route", body))

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.True(t, out["ok"].(bool))
	require.Equal(t, "evt-route", out["event_id"])

	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", billing.JobTypeWebhook).Scan(context.Background()))
	require.Contains(t, job.Payload, "mem-route")
}

func TestWhopWebhookRouteRejectsInvalidSignature(t *testing.T) {
	t.Parallel()

	secret := "route-secret"
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	srv := newBillingHandlerTestServer(t, secret, now)
	body := []byte(`{"id":"evt-route","type":"membership.activated","data":{}}`)

	resp := srv.postWebhook(t, body, billing.WebhookHeaders{
		ID:        "evt-route",
		Timestamp: signedWhopWebhookHeaders(t, secret, now, "evt-route", body).Timestamp,
		Signature: "v1,invalid",
	})

	require.Equal(t, http.StatusUnauthorized, resp.Code, resp.Body.String())
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestCreateBillingCheckoutRoute(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	srv.client.response = `{"id":"ch_1","purchase_url":"https://whop.test/checkout/ch_1","plan":{"id":"plan_creator_year"}}`

	resp := srv.postJSON(t, "/api/v1/billing/checkout", map[string]any{
		"workspace_id":   "ws-1",
		"plan_id":        "creator",
		"billing_period": "annual",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "ch_1", out["id"])
	require.Equal(t, "https://app.openpost.test/checkout?billing_period=annual&plan=creator&session_id=ch_1", out["url"])
	require.Equal(t, "plan_creator_year", out["provider_plan_id"])
	require.Equal(t, float64(290), out["price_usd"])
	require.Len(t, srv.client.requests, 1)
	req := srv.client.requests[0]
	require.Equal(t, "/api/v1/checkout_configurations", req.Path)
	require.Equal(t, "biz_1", req.Body["company_id"])
	require.Equal(t, "plan_creator_year", req.Body["plan_id"])
	metadata := req.Body["metadata"].(map[string]any)
	require.Equal(t, "creator", metadata["plan_id"])
	require.Equal(t, "org_ws-1", metadata["organization_id"])
	require.Equal(t, "ws-1", metadata["workspace_id"])
}

func TestBillingMutationsRequireWorkspaceAdmin(t *testing.T) {
	srv := newBillingAPITestServer(t)
	_, err := srv.db.NewUpdate().
		Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").
		Exec(t.Context())
	require.NoError(t, err)

	checkout := srv.postJSON(t, "/api/v1/billing/checkout", map[string]any{
		"workspace_id": "ws-1",
		"plan_id":      "creator",
	})
	portal := srv.postJSON(t, "/api/v1/billing/portal", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusForbidden, checkout.Code, checkout.Body.String())
	require.Equal(t, http.StatusForbidden, portal.Code, portal.Body.String())
	require.Empty(t, srv.client.requests)
}

func TestCreateBillingCheckoutRouteReturns503WhenWhopIsNotConfigured(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServerWithWhopConfig(t, &billingHTTPClient{t: t}, billing.WhopConfig{
		APIBaseURL: "https://api.whop.test/api/v1",
		AccountID:  "biz_1",
		Plans: map[string]billing.PlanConfig{
			"creator": {ProviderPlanIDs: billing.ProviderPlanIDs{Monthly: "plan_creator_month"}},
		},
	})

	resp := srv.postJSON(t, "/api/v1/billing/checkout", map[string]any{
		"workspace_id": "ws-1",
		"plan_id":      "creator",
	})

	require.Equal(t, http.StatusServiceUnavailable, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "OPENPOST_WHOP_API_KEY")
	require.Empty(t, srv.client.requests)
}

func TestGetBillingStatusRouteWithoutSubscription(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)

	resp := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-1")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "ws-1", out["workspace_id"])
	require.Equal(t, "none", out["status"])
	require.Equal(t, map[string]any{}, out["limits"])
	require.Equal(t, map[string]any{}, out["usage"])
	require.NotEmpty(t, out["period_start"])
}

func TestGetBillingStatusRouteWithSubscriptionAndUsage(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               "whop",
		ProviderCustomerID:     "cus-1",
		ProviderSubscriptionID: "sub-1",
		Status:                 "active",
		PlanID:                 "creator",
		EntitlementSnapshot:    `{"limits":{"scheduled_posts_monthly":500,"social_accounts":6}}`,
		CurrentPeriodEnd:       time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.UsageCounter{
		WorkspaceID: "ws-1",
		Metric:      string(entitlements.LimitScheduledPostsMonthly),
		PeriodStart: time.Date(time.Now().UTC().Year(), time.Now().UTC().Month(), 1, 0, 0, 0, 0, time.UTC),
		Value:       42,
	}).Exec(ctx)
	require.NoError(t, err)

	resp := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-1")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "whop", out["provider"])
	require.Equal(t, "active", out["status"])
	require.Equal(t, "creator", out["plan_id"])
	require.Equal(t, "2026-07-30T12:00:00Z", out["current_period_end"])
	limits := out["limits"].(map[string]any)
	require.Equal(t, float64(500), limits["scheduled_posts_monthly"])
	require.Equal(t, float64(6), limits["social_accounts"])
	usage := out["usage"].(map[string]any)
	require.Equal(t, float64(42), usage["scheduled_posts_monthly"])
}

func TestGetBillingStatusUsesOwnersActiveSubscriptionForLegacyWorkspace(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.Organization{
		ID: "org_legacy", Name: "Legacy", CreatedByID: "user-1",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org_legacy", UserID: "user-1", Role: models.OrganizationRoleOwner,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Workspace{
		ID: "ws-legacy", OrganizationID: "org_legacy", Name: "Legacy",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-legacy", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               "whop",
		ProviderCustomerID:     "cus-agency",
		ProviderSubscriptionID: "sub-agency",
		Status:                 "active",
		PlanID:                 "agency",
		EntitlementSnapshot:    `{"limits":{"social_accounts":25}}`,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.UsageCounter{
		WorkspaceID: "ws-legacy",
		Metric:      string(entitlements.LimitScheduledPostsMonthly),
		PeriodStart: time.Date(time.Now().UTC().Year(), time.Now().UTC().Month(), 1, 0, 0, 0, 0, time.UTC),
		Value:       3,
	}).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usageservice.NewXProviderCostPolicy(
		500_000,
		15_000,
		200_000,
	)))
	_, err = srv.usage.RecordProviderCost(ctx, usageservice.ProviderCostEventInput{
		WorkspaceID:  "ws-legacy",
		Provider:     usageservice.ProviderX,
		Operation:    usageservice.XOperationPostCreate,
		OperationKey: "legacy-workspace-x-cost",
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	require.NoError(t, err)

	resp := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-legacy")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "ws-legacy", out["workspace_id"])
	require.Equal(t, "org_ws-1", out["organization_id"])
	require.Equal(t, "agency", out["plan_id"])
	require.Equal(t, "active", out["status"])
	require.Equal(t, float64(3), out["usage"].(map[string]any)[string(entitlements.LimitScheduledPostsMonthly)])
	providerCosts := out["provider_costs"].([]any)
	require.Len(t, providerCosts, 1)
	require.Equal(t, float64(15_000), providerCosts[0].(map[string]any)["cost_microusd"])
}

func TestGetBillingStatusSeparatesHostedProviderCostFromProductUsage(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usageservice.NewXProviderCostPolicy(
		500_000,
		15_000,
		200_000,
	)))
	_, err := srv.db.NewInsert().Model(&models.Workspace{
		ID: "ws-2", OrganizationID: "org_ws-1", Name: "Second",
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.usage.RecordProviderCost(context.Background(), usageservice.ProviderCostEventInput{
		WorkspaceID:  "ws-2",
		Provider:     usageservice.ProviderX,
		Operation:    usageservice.XOperationPostCreate,
		OperationKey: "billing-status-second-workspace",
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	require.NoError(t, err)
	_, err = srv.usage.RecordProviderCost(context.Background(), usageservice.ProviderCostEventInput{
		WorkspaceID:  "ws-1",
		Provider:     usageservice.ProviderX,
		Operation:    usageservice.XOperationPostCreate,
		OperationKey: "billing-status",
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	require.NoError(t, err)
	_, err = srv.usage.ReserveProviderCost(context.Background(), usageservice.ProviderCostEventInput{
		WorkspaceID:  "ws-1",
		Provider:     usageservice.ProviderX,
		Operation:    usageservice.XOperationPostCreateWithURL,
		OperationKey: "billing-status-unknown",
		Units:        1,
		OccurredAt:   time.Now().UTC(),
	})
	require.NoError(t, err)
	require.NoError(t, srv.usage.MarkProviderCostUnknown(context.Background(), "billing-status-unknown"))

	resp := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-1")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, map[string]any{}, out["usage"])
	providerCosts := out["provider_costs"].([]any)
	require.Len(t, providerCosts, 1)
	xCost := providerCosts[0].(map[string]any)
	require.Equal(t, "x", xCost["provider"])
	require.Equal(t, "USD", xCost["currency"])
	require.Equal(t, float64(30_000), xCost["cost_microusd"])
	require.Equal(t, float64(1), xCost["reserved_event_count"])
	require.Equal(t, float64(200_000), xCost["reserved_cost_microusd"])
	require.Equal(t, float64(1_000_000), xCost["budget_microusd"])
	require.Equal(t, usageservice.XPricingSourceURL, xCost["pricing_source_url"])
}

func TestCreateBillingPortalRoute(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	_, err := srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               billing.ProviderWhop,
		ProviderCustomerID:     "user_whop_1",
		ProviderSubscriptionID: "mem_1",
		ProviderManageURL:      "https://whop.test/manage/mem_1",
		Status:                 "active",
		PlanID:                 "creator",
	}).Exec(t.Context())
	require.NoError(t, err)

	resp := srv.postJSON(t, "/api/v1/billing/portal", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "mem_1", out["id"])
	require.Equal(t, "https://whop.test/manage/mem_1", out["url"])
	require.Empty(t, srv.client.requests)
}
