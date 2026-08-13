package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
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
	client *billingPaddleClient
	usage  *usageservice.Service
}

type billingPaddleClient struct {
	portalRequests int
	portalInput    *paddle.CreateCustomerPortalSessionRequest
	portal         *paddle.CustomerPortalSession
}

func (c *billingPaddleClient) GetSubscription(context.Context, *paddle.GetSubscriptionRequest) (*paddle.Subscription, error) {
	return nil, fmt.Errorf("unexpected subscription request")
}

func (c *billingPaddleClient) GetTransaction(context.Context, *paddle.GetTransactionRequest) (*paddle.Transaction, error) {
	return nil, fmt.Errorf("unexpected transaction request")
}

func (c *billingPaddleClient) GetCustomer(context.Context, *paddle.GetCustomerRequest) (*paddle.Customer, error) {
	return nil, fmt.Errorf("unexpected customer request")
}

func (c *billingPaddleClient) CreateCustomerPortalSession(_ context.Context, input *paddle.CreateCustomerPortalSessionRequest) (*paddle.CustomerPortalSession, error) {
	c.portalRequests++
	c.portalInput = input
	return c.portal, nil
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

	client := &billingPaddleClient{}
	return newBillingAPITestServerWithPaddleConfig(t, client, billing.PaddleConfig{
		Environment: "sandbox",
		ClientToken: "test_client_token",
		AppURL:      "https://app.openpost.test",
		ReturnURL:   "https://app.openpost.test/checkout?status=success",
		Plans: map[string]billing.PlanConfig{
			"founder": {
				PaddlePriceIDs:  billing.PaddlePriceIDs{Monthly: "pri_founder_month", Annual: "pri_founder_year"},
				MonthlyPriceUSD: 25,
				AnnualPriceUSD:  250,
				Limits: map[entitlements.LimitKey]int64{
					entitlements.LimitScheduledPostsMonthly: 500,
					entitlements.LimitSocialAccounts:        6,
				},
			},
		},
		PurchaseChoiceSecret: "test-purchase-choice-secret-with-32-bytes",
	})
}

func TestConfirmFirstWorkspacePurchaseCreatesAndResumesOneBoundAttempt(t *testing.T) {
	srv := newBillingAPITestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewDelete().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ?", "ws-1").Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewDelete().Model((*models.Workspace)(nil)).Where("id = ?", "ws-1").Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewDelete().Model((*models.OrganizationMember)(nil)).Where("organization_id = ?", "org_ws-1").Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewDelete().Model((*models.Organization)(nil)).Where("id = ?", "org_ws-1").Exec(ctx)
	require.NoError(t, err)

	choiceResponse := srv.postJSON(t, "/api/v1/billing/purchase-choice", map[string]any{
		"plan_id": "founder", "billing_period": "annual",
	})
	require.Equal(t, http.StatusOK, choiceResponse.Code, choiceResponse.Body.String())
	var choice PurchaseChoiceResponse
	require.NoError(t, json.Unmarshal(choiceResponse.Body.Bytes(), &choice))

	request := map[string]any{
		"workspace_name":        "North Star Studio",
		"plan_id":               "founder",
		"billing_period":        "annual",
		"purchase_choice_token": choice.Token,
		"return_path":           "/settings?tab=accounts&onboarding=1",
	}
	first := srv.postJSON(t, "/api/v1/billing/welcome", request)
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	var firstBody map[string]any
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstBody))
	require.Equal(t, "North Star Studio", firstBody["workspace_name"])
	require.NotEmpty(t, firstBody["workspace_id"])
	checkout := firstBody["checkout"].(map[string]any)
	require.Equal(t, "founder", checkout["plan_id"])
	require.Equal(t, "annual", checkout["billing_period"])
	require.NotEmpty(t, checkout["id"])

	resumed := srv.postJSON(t, "/api/v1/billing/welcome", request)
	require.Equal(t, http.StatusOK, resumed.Code, resumed.Body.String())
	var resumedBody map[string]any
	require.NoError(t, json.Unmarshal(resumed.Body.Bytes(), &resumedBody))
	require.Equal(t, firstBody["workspace_id"], resumedBody["workspace_id"])
	require.Equal(t, checkout["id"], resumedBody["checkout"].(map[string]any)["id"])
	loaded := srv.getJSON(t, "/api/v1/billing/checkout/"+checkout["id"].(string))
	require.Equal(t, http.StatusOK, loaded.Code, loaded.Body.String())
	var loadedBody map[string]any
	require.NoError(t, json.Unmarshal(loaded.Body.Bytes(), &loadedBody))
	require.Equal(t, checkout["id"], loadedBody["id"])
	require.Equal(t, firstBody["workspace_id"], loadedBody["workspace_id"])

	var workspaceCount, attemptCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspaces").Scan(ctx, &workspaceCount))
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_checkout_attempts").Scan(ctx, &attemptCount))
	require.Equal(t, 1, workspaceCount)
	require.Equal(t, 1, attemptCount)

	mismatch := maps.Clone(request)
	mismatch["workspace_name"] = "A different workspace"
	rejected := srv.postJSON(t, "/api/v1/billing/welcome", mismatch)
	require.Equal(t, http.StatusConflict, rejected.Code, rejected.Body.String())
	require.Contains(t, rejected.Body.String(), "confirmed welcome details")
}

func TestResumeBillingCheckoutRequiresExactUser(t *testing.T) {
	srv := newBillingAPITestServer(t)
	ctx := t.Context()
	attempt := &models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_other_user", OrganizationID: "org_ws-1", WorkspaceID: "ws-1", UserID: "other-user",
		Provider: billing.ProviderPaddle, ProviderPriceID: "pri_founder_month", PlanID: "founder", BillingPeriod: "monthly",
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	_, err := srv.db.NewInsert().Model(attempt).Exec(ctx)
	require.NoError(t, err)

	response := srv.getJSON(t, "/api/v1/billing/checkout/chkat_other_user")
	require.Equal(t, http.StatusNotFound, response.Code, response.Body.String())
}

func TestPurchaseChoiceEndpointCreatesAndRevalidatesCanonicalChoice(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	service := billing.NewService(nil, "", billing.PaddleConfig{
		Plans: billing.DefaultPlanCatalog(
			billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{},
			billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{},
		),
		PurchaseChoiceSecret: "purchase-choice-secret-with-at-least-32-characters",
	})
	service.SetNowForTest(func() time.Time { return now })
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewBillingHandler(service).RegisterAPIRoutes(api)

	created := jsonRequest(t, e, http.MethodPost, "/api/v1/billing/purchase-choice", map[string]any{
		"plan_id":        "team",
		"billing_period": "annual",
	}, "")
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var choice PurchaseChoiceResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &choice))
	require.NotEmpty(t, choice.Token)
	require.Equal(t, "team", choice.PlanID)
	require.Equal(t, "Team", choice.PlanName)
	require.Equal(t, "annual", choice.BillingPeriod)
	require.Equal(t, 990, choice.ListPriceUSD)
	require.Equal(t, 14, choice.TrialDays)
	require.True(t, choice.CardRequired)
	require.Zero(t, choice.DueTodayUSD)
	require.Equal(t, billing.PlanCatalogVersion, choice.CatalogVersion)

	validated := jsonRequest(t, e, http.MethodPost, "/api/v1/billing/purchase-choice", map[string]any{
		"plan_id":               "team",
		"billing_period":        "annual",
		"purchase_choice_token": choice.Token,
	}, "")
	require.Equal(t, http.StatusOK, validated.Code, validated.Body.String())
	require.JSONEq(t, created.Body.String(), validated.Body.String())

	mismatched := jsonRequest(t, e, http.MethodPost, "/api/v1/billing/purchase-choice", map[string]any{
		"plan_id":               "founder",
		"billing_period":        "annual",
		"purchase_choice_token": choice.Token,
	}, "")
	require.Equal(t, http.StatusBadRequest, mismatched.Code, mismatched.Body.String())
	require.Contains(t, mismatched.Body.String(), "does not match")
	var problem huma.ErrorModel
	require.NoError(t, json.Unmarshal(mismatched.Body.Bytes(), &problem))
	require.Equal(t, purchaseChoiceMismatchProblem, problem.Type)
}

func newBillingAPITestServerWithPaddleConfig(t *testing.T, client *billingPaddleClient, cfg billing.PaddleConfig) *billingTestServer {
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
		(*models.Job)(nil),
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
	service.SetPaddleClientForTest(client)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewBillingHandler(service, db, testAuthenticator{})
	usageService := usageservice.NewService(db)
	handler.SetUsage(usageService)
	handler.RegisterAPIRoutes(api)
	return &billingTestServer{echo: e, db: db, client: client, usage: usageService}
}

func (s *billingTestServer) postWebhook(t *testing.T, body []byte, signature string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/billing/paddle/webhook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Paddle-Signature", signature)
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

func signedPaddleWebhook(t *testing.T, secret string, now time.Time, body []byte) string {
	t.Helper()

	timestamp := fmt.Sprintf("%d", now.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + ":" + string(body)))
	return "ts=" + timestamp + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestPaddleWebhookRouteQueuesReconciliation(t *testing.T) {
	t.Parallel()

	secret := "route-secret"
	now := time.Now().UTC()
	srv := newBillingHandlerTestServer(t, secret, now)
	body := []byte(`{"event_id":"evt-route","event_type":"subscription.updated","occurred_at":"2026-08-09T12:00:00Z","data":{"id":"sub-route"}}`)

	resp := srv.postWebhook(t, body, signedPaddleWebhook(t, secret, now, body))

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.True(t, out["ok"].(bool))
	require.Equal(t, "evt-route", out["event_id"])

	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", billing.JobTypeWebhook).Scan(context.Background()))
	require.Contains(t, job.Payload, "sub-route")
}

func TestPaddleWebhookRouteRejectsInvalidSignature(t *testing.T) {
	t.Parallel()

	secret := "route-secret"
	now := time.Now().UTC()
	srv := newBillingHandlerTestServer(t, secret, now)
	body := []byte(`{"event_id":"evt-route","event_type":"subscription.updated","data":{}}`)

	resp := srv.postWebhook(t, body, "ts=1;h1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

	require.Equal(t, http.StatusUnauthorized, resp.Code, resp.Body.String())
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestCreateBillingCheckoutRoute(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)

	resp := srv.postJSON(t, "/api/v1/billing/checkout", map[string]any{
		"workspace_id":   "ws-1",
		"plan_id":        "founder",
		"billing_period": "annual",
		"return_path":    "/publications/new?source=calendar",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Regexp(t, `^chkat_[a-f0-9]{32}$`, out["id"])
	require.Equal(t, "https://app.openpost.test/checkout?billing_period=annual&plan=founder", out["url"])
	require.Equal(t, "pri_founder_year", out["provider_price_id"])
	require.Equal(t, "pri_founder_year", out["price_ids"].(map[string]any)["founder"])
	require.Equal(t, "test_client_token", out["client_token"])
	require.Equal(t, "sandbox", out["environment"])
	require.Equal(t, "user@example.com", out["customer_email"])
	require.Equal(t, "https://app.openpost.test/checkout?attempt="+out["id"].(string)+"&status=success", out["return_url"])

	var attempt models.BillingCheckoutAttempt
	require.NoError(t, srv.db.NewSelect().Model(&attempt).Where("checkout_attempt_id = ?", out["id"]).Scan(t.Context()))
	require.Equal(t, "org_ws-1", attempt.OrganizationID)
	require.Equal(t, "ws-1", attempt.WorkspaceID)
	require.Equal(t, "founder", attempt.PlanID)
	require.Equal(t, "/publications/new?source=calendar", attempt.ReturnPath)
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
		"plan_id":      "founder",
	})
	portal := srv.postJSON(t, "/api/v1/billing/portal", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusForbidden, checkout.Code, checkout.Body.String())
	require.Equal(t, http.StatusForbidden, portal.Code, portal.Body.String())
	require.Zero(t, srv.client.portalRequests)
}

func TestBillingMutationsRequireOrganizationAdmin(t *testing.T) {
	srv := newBillingAPITestServer(t)
	_, err := srv.db.NewUpdate().
		Model((*models.OrganizationMember)(nil)).
		Set("role = ?", models.OrganizationRoleMember).
		Where("organization_id = ? AND user_id = ?", "org_ws-1", "user-1").
		Exec(t.Context())
	require.NoError(t, err)

	checkout := srv.postJSON(t, "/api/v1/billing/checkout", map[string]any{
		"workspace_id": "ws-1",
		"plan_id":      "founder",
	})
	portal := srv.postJSON(t, "/api/v1/billing/portal", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusForbidden, checkout.Code, checkout.Body.String())
	require.Equal(t, http.StatusForbidden, portal.Code, portal.Body.String())
	require.Contains(t, portal.Body.String(), "organization admin role required")
	require.Zero(t, srv.client.portalRequests)
	var checkoutAttempts int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_checkout_attempts").Scan(t.Context(), &checkoutAttempts))
	require.Zero(t, checkoutAttempts)
}

func TestCreateBillingCheckoutRouteReturns503WhenPaddleIsNotConfigured(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServerWithPaddleConfig(t, &billingPaddleClient{}, billing.PaddleConfig{
		Environment: "sandbox",
		Plans: map[string]billing.PlanConfig{
			"founder": {PaddlePriceIDs: billing.PaddlePriceIDs{Monthly: "pri_founder_month"}},
		},
	})

	resp := srv.postJSON(t, "/api/v1/billing/checkout", map[string]any{
		"workspace_id": "ws-1",
		"plan_id":      "founder",
	})

	require.Equal(t, http.StatusServiceUnavailable, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "OPENPOST_PADDLE_CLIENT_TOKEN")
	require.Zero(t, srv.client.portalRequests)
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
	require.Equal(t, true, out["can_manage_billing"])
	require.Equal(t, false, out["access_restricted"])
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
		Provider:               "paddle",
		ProviderCustomerID:     "cus-1",
		ProviderSubscriptionID: "sub-1",
		Status:                 "active",
		PlanID:                 "founder",
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
	require.Equal(t, "paddle", out["provider"])
	require.Equal(t, "active", out["status"])
	require.Equal(t, "founder", out["plan_id"])
	require.Equal(t, true, out["can_manage_billing"])
	require.Equal(t, false, out["access_restricted"])
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
		Provider:               "paddle",
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

func TestGetBillingStatusSurfacesOwnersPastDueSubscriptionForLegacyWorkspace(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.Organization{
		ID: "org_legacy_due", Name: "Legacy", CreatedByID: "user-1",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org_legacy_due", UserID: "user-1", Role: models.OrganizationRoleOwner,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Workspace{
		ID: "ws-legacy-due", OrganizationID: "org_legacy_due", Name: "Legacy",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-legacy-due", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	pastDueSince := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	_, err = srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               billing.ProviderPaddle,
		ProviderCustomerID:     "ctm_due",
		ProviderSubscriptionID: "sub_due",
		Status:                 "past_due",
		PlanID:                 "founder",
		PastDueSince:           pastDueSince,
		UpdatedAt:              pastDueSince,
	}).Exec(ctx)
	require.NoError(t, err)

	resp := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-legacy-due")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "org_ws-1", out["organization_id"])
	require.Equal(t, "ws-legacy-due", out["workspace_id"])
	require.Equal(t, "past_due", out["status"])
	require.Equal(t, true, out["access_restricted"])
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
	srv.client.portal = &paddle.CustomerPortalSession{
		ID:         "cpls_1",
		CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{
			General: paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"},
		},
	}
	_, err := srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               billing.ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "active",
		PlanID:                 "founder",
	}).Exec(t.Context())
	require.NoError(t, err)

	resp := srv.postJSON(t, "/api/v1/billing/portal", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "cpls_1", out["id"])
	require.Equal(t, "https://customer-portal.paddle.com/overview?token=fresh", out["url"])
	require.Equal(t, 1, srv.client.portalRequests)
	require.Equal(t, "ctm_1", srv.client.portalInput.CustomerID)
	require.Equal(t, []string{"sub_1"}, srv.client.portalInput.SubscriptionIDs)
}

func TestCreateOrganizationBillingPortalRouteKeepsEmptyBodyCompatible(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	srv.client.portal = &paddle.CustomerPortalSession{
		ID:         "cpls_1",
		CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{
			General: paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"},
		},
	}
	_, err := srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               billing.ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "active",
		PlanID:                 "founder",
	}).Exec(t.Context())
	require.NoError(t, err)
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"/api/v1/organizations/org_ws-1/billing/portal",
		nil,
	)
	req.Header.Set("Authorization", "Bearer web-token")
	resp := httptest.NewRecorder()

	srv.echo.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, 1, srv.client.portalRequests)
}

func TestPastDueBillingStatusAndPaymentRecoveryRoute(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	pastDueSince := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	srv.client.portal = &paddle.CustomerPortalSession{
		ID:         "cpls_recovery",
		CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{Subscriptions: []paddle.CustomerPortalSessionSubscriptionURLs{
			{
				ID:                              "sub_1",
				UpdateSubscriptionPaymentMethod: "https://customer-portal.paddle.com/payment-method?token=fresh",
			},
		}},
	}
	_, err := srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               billing.ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "past_due",
		PlanID:                 "founder",
		EntitlementSnapshot:    `{"limits":{"scheduled_posts_monthly":500}}`,
		ProviderUpdatedAt:      pastDueSince,
		PastDueSince:           pastDueSince,
	}).Exec(t.Context())
	require.NoError(t, err)

	status := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-1")
	require.Equal(t, http.StatusOK, status.Code, status.Body.String())
	var statusBody map[string]any
	require.NoError(t, json.Unmarshal(status.Body.Bytes(), &statusBody))
	require.Equal(t, "past_due", statusBody["status"])
	require.Equal(t, true, statusBody["access_restricted"])
	require.Equal(t, true, statusBody["can_manage_billing"])
	require.Equal(t, "2026-08-09T12:00:00Z", statusBody["past_due_since"])

	portal := srv.postJSON(t, "/api/v1/billing/portal", map[string]any{
		"workspace_id": "ws-1",
		"purpose":      "update_payment_method",
	})
	require.Equal(t, http.StatusOK, portal.Code, portal.Body.String())
	var portalBody map[string]any
	require.NoError(t, json.Unmarshal(portal.Body.Bytes(), &portalBody))
	require.Equal(t, "https://customer-portal.paddle.com/payment-method?token=fresh", portalBody["url"])
	require.Equal(t, 1, srv.client.portalRequests)
}

func TestPastDueBillingStatusIsVisibleWithoutBillingPermission(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	pastDueSince := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	_, err := srv.db.NewUpdate().
		Model((*models.OrganizationMember)(nil)).
		Set("role = ?", models.OrganizationRoleMember).
		Where("organization_id = ? AND user_id = ?", "org_ws-1", "user-1").
		Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org_ws-1",
		WorkspaceID:            "ws-1",
		Provider:               billing.ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "past_due",
		PlanID:                 "founder",
		PastDueSince:           pastDueSince,
	}).Exec(t.Context())
	require.NoError(t, err)

	status := srv.getJSON(t, "/api/v1/billing/status?workspace_id=ws-1")
	require.Equal(t, http.StatusOK, status.Code, status.Body.String())
	var body map[string]any
	require.NoError(t, json.Unmarshal(status.Body.Bytes(), &body))
	require.Equal(t, "past_due", body["status"])
	require.Equal(t, false, body["can_manage_billing"])
	require.Equal(t, true, body["access_restricted"])
}
