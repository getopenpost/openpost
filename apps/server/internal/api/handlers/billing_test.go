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
	"strings"
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
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type billingTestServer struct {
	echo     *echo.Echo
	db       *bun.DB
	client   *billingPaddleClient
	usage    *usageservice.Service
	recorder *telemetry.MemoryRecorder
}

type billingPaddleClient struct {
	portalRequests int
	portalInput    *paddle.CreateCustomerPortalSessionRequest
	portal         *paddle.CustomerPortalSession
}

func (c *billingPaddleClient) GetSubscription(context.Context, *paddle.GetSubscriptionRequest) (*paddle.Subscription, error) {
	return nil, fmt.Errorf("unexpected subscription request")
}

func (c *billingPaddleClient) CancelSubscription(context.Context, *paddle.CancelSubscriptionRequest) (*paddle.Subscription, error) {
	return nil, fmt.Errorf("unexpected subscription cancellation request")
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
		(*models.BillingCustomer)(nil),
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
		PurchaseChoiceSecret: "pppppppppppppppppppppppppppppppp",
	})
}

func TestConfirmFirstWorkspacePurchaseCreatesAndResumesOneBoundAttempt(t *testing.T) {
	t.Parallel()
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
	require.Equal(t, []string{
		telemetry.EventPlanConfirmed,
		telemetry.EventWorkspaceCreated,
		telemetry.EventBillingCheckoutCreated,
	}, telemetryEventNames(srv.recorder.Events))

	mismatch := maps.Clone(request)
	mismatch["workspace_name"] = "A different workspace"
	rejected := srv.postJSON(t, "/api/v1/billing/welcome", mismatch)
	require.Equal(t, http.StatusConflict, rejected.Code, rejected.Body.String())
	require.Contains(t, rejected.Body.String(), "confirmed welcome details")
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
		(*models.BillingCustomer)(nil),
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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewBillingHandler(service, db, testAuthenticator{})
	recorder := &telemetry.MemoryRecorder{}
	handler.SetTelemetry(recorder)
	usageService := usageservice.NewService(db)
	handler.SetUsage(usageService)
	handler.RegisterAPIRoutes(api)
	return &billingTestServer{echo: e, db: db, client: client, usage: usageService, recorder: recorder}
}

func telemetryEventNames(events []telemetry.Event) []string {
	names := make([]string, len(events))
	for index, event := range events {
		names[index] = event.Name
	}
	return names
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

func TestPaddleWebhookRouteRejectsInvalidSignature(t *testing.T) {
	t.Parallel()

	secret := "route-secret"
	now := time.Now().UTC()
	// The body is otherwise acceptable so a rejection can only come from the
	// signature guard under test, never from later payload validation.
	body := []byte(`{"event_id":"evt-route","event_type":"subscription.updated","occurred_at":"2026-08-09T12:00:00Z","data":{"id":"sub-route"}}`)

	// Positive control: the identical payload, correctly signed, is accepted and
	// leaves both durable records behind.
	accepted := newBillingHandlerTestServer(t, secret, now)
	acceptedResponse := accepted.postWebhook(t, body, signedPaddleWebhook(t, secret, now, body))
	require.Equal(t, http.StatusOK, acceptedResponse.Code, acceptedResponse.Body.String())
	acceptedEvents, err := accepted.db.NewSelect().Model((*models.BillingWebhookEvent)(nil)).Where("event_id = ?", "evt-route").Count(context.Background())
	require.NoError(t, err)
	require.EqualValues(t, 1, acceptedEvents, "an accepted webhook must record exactly one event")
	acceptedJobs, err := accepted.db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", billing.JobTypeWebhook).Count(context.Background())
	require.NoError(t, err)
	require.EqualValues(t, 1, acceptedJobs, "an accepted webhook must queue exactly one reconciliation job")
	var acceptedJob models.Job
	require.NoError(t, accepted.db.NewSelect().Model(&acceptedJob).Where("type = ?", billing.JobTypeWebhook).Scan(context.Background()))
	require.Contains(t, acceptedJob.Payload, "sub-route", "the queued job must carry the accepted event")

	for _, test := range []struct{ name, signature string }{
		{name: "tampered signature", signature: fmt.Sprintf("ts=%d;h1=%s", now.Unix(), strings.Repeat("a", 64))},
		{name: "stale timestamp", signature: signedPaddleWebhook(t, secret, now.Add(-10*time.Minute), body)},
	} {
		t.Run(test.name, func(t *testing.T) {
			srv := newBillingHandlerTestServer(t, secret, now)

			resp := srv.postWebhook(t, body, test.signature)

			require.Equal(t, http.StatusUnauthorized, resp.Code, resp.Body.String())
			events, err := srv.db.NewSelect().Model((*models.BillingWebhookEvent)(nil)).Count(context.Background())
			require.NoError(t, err)
			require.EqualValues(t, 0, events, "a rejected webhook must not record an event")
			jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", billing.JobTypeWebhook).Count(context.Background())
			require.NoError(t, err)
			require.EqualValues(t, 0, jobs, "a rejected webhook must not queue work")
		})
	}
}

func TestBillingMutationsRequireOrganizationAdmin(t *testing.T) {
	t.Parallel()
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

func TestOrganizationBillingAdminCanUsePurposeLinkWithoutWorkspaceAdminRole(t *testing.T) {
	t.Parallel()

	srv := newBillingAPITestServer(t)
	srv.client.portal = &paddle.CustomerPortalSession{
		ID: "cpls_cancel", CustomerID: "ctm_1",
		URLs: paddle.CustomerPortalSessionURLs{Subscriptions: []paddle.CustomerPortalSessionSubscriptionURLs{{
			ID: "sub_1", CancelSubscription: "https://customer-portal.paddle.com/cancel?token=fresh",
		}}},
	}
	_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org_ws-1", WorkspaceID: "ws-1", Provider: billing.ProviderPaddle,
		ProviderCustomerID: "ctm_1", ProviderSubscriptionID: "sub_1", Status: "active", PlanID: "founder",
	}).Exec(t.Context())
	require.NoError(t, err)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/organizations/org_ws-1/billing/portal?purpose=cancel_subscription", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	resp := httptest.NewRecorder()
	srv.echo.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Equal(t, "cancel_subscription", body["purpose"])
	require.Equal(t, "https://customer-portal.paddle.com/cancel?token=fresh", body["url"])
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
