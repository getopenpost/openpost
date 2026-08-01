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

type fakePolarHTTPClient struct {
	t        *testing.T
	requests []polarHTTPRequest
	response string
	status   int
}

type polarHTTPRequest struct {
	Method string
	Path   string
	Auth   string
	Body   map[string]any
}

func (f *fakePolarHTTPClient) Do(req *http.Request) (*http.Response, error) {
	f.t.Helper()

	var body map[string]any
	require.NoError(f.t, json.NewDecoder(req.Body).Decode(&body))
	f.requests = append(f.requests, polarHTTPRequest{
		Method: req.Method,
		Path:   req.URL.Path,
		Auth:   req.Header.Get("Authorization"),
		Body:   body,
	})
	status := f.status
	if status == 0 {
		status = http.StatusCreated
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(f.response)),
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
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}

func signedWebhookHeaders(t *testing.T, secret string, now time.Time, eventID string, body []byte) WebhookHeaders {
	t.Helper()

	timestamp := fmt.Sprintf("%d", now.Unix())
	mac := hmac.New(sha256.New, decodeWebhookSecret(secret))
	_, _ = mac.Write([]byte(eventID + "." + timestamp + "." + string(body)))
	return WebhookHeaders{
		ID:        eventID,
		Timestamp: timestamp,
		Signature: "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil)),
	}
}

func TestDefaultPlanCatalogKeepsSeatLimitsMonotonic(t *testing.T) {
	t.Parallel()

	catalog := DefaultPlanCatalog("starter", "creator", "pro", "team", "agency")
	require.Equal(t, int64(1), catalog["starter"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(1), catalog["creator"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(1), catalog["pro"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(3), catalog["team"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(5), catalog["agency"].Limits[entitlements.LimitTeamMembers])
}

func TestProcessPolarWebhookUpsertsSubscription(t *testing.T) {
	t.Parallel()

	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("secret"))
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	db := newBillingTestDB(t)
	service := NewService(db, secret)
	service.now = func() time.Time { return now }
	body := []byte(`{
		"id": "evt-1",
		"type": "subscription.active",
		"data": {
			"id": "sub-1",
			"customer_id": "cus-1",
			"product_id": "prod-creator",
			"price_id": "price-monthly",
			"status": "active",
			"current_period_end": "2026-07-30T12:00:00Z",
			"metadata": {
				"workspace_id": "ws-1",
				"plan_id": "creator",
				"limit_scheduled_posts_monthly": 500
			}
		}
	}`)

	result, err := service.ProcessPolarWebhook(context.Background(), body, signedWebhookHeaders(t, secret, now, "evt-1", body))

	require.NoError(t, err)
	require.False(t, result.Duplicate)
	require.Equal(t, "ws-1", result.WorkspaceID)

	var sub models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&sub).Where("workspace_id = ?", "ws-1").Scan(context.Background()))
	require.Equal(t, "polar", sub.Provider)
	require.Equal(t, "cus-1", sub.ProviderCustomerID)
	require.Equal(t, "sub-1", sub.ProviderSubscriptionID)
	require.Equal(t, "prod-creator", sub.ProviderProductID)
	require.Equal(t, "price-monthly", sub.ProviderPriceID)
	require.Equal(t, "active", sub.Status)
	require.Equal(t, "creator", sub.PlanID)
	require.Contains(t, sub.EntitlementSnapshot, "scheduled_posts_monthly")
	require.Equal(t, time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC), sub.CurrentPeriodEnd)
}

func TestCreateCheckoutPostsPolarCheckoutSession(t *testing.T) {
	t.Parallel()

	client := &fakePolarHTTPClient{
		t:        t,
		response: `{"id":"checkout-1","url":"https://checkout.polar.sh/session"}`,
	}
	service := NewService(nil, "", PolarConfig{
		AccessToken: "polar-token",
		APIBaseURL:  "https://api.polar.test",
		SuccessURL:  "https://app.openpost.test/settings/billing?checkout_id={CHECKOUT_ID}",
		ReturnURL:   "https://app.openpost.test/settings/billing",
		Plans: map[string]PlanConfig{
			"creator": {
				ProductID: "product-creator",
				Limits: map[entitlements.LimitKey]int64{
					entitlements.LimitScheduledPostsMonthly: 500,
					entitlements.LimitSocialAccounts:        6,
				},
			},
		},
	})
	service.SetHTTPClientForTest(client)

	result, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		WorkspaceID:   "ws-1",
		UserID:        "user-1",
		CustomerEmail: "user@example.com",
		PlanID:        "creator",
	})

	require.NoError(t, err)
	require.Equal(t, "checkout-1", result.ID)
	require.Equal(t, "https://checkout.polar.sh/session", result.URL)
	require.Len(t, client.requests, 1)
	req := client.requests[0]
	require.Equal(t, http.MethodPost, req.Method)
	require.Equal(t, "/v1/checkouts/", req.Path)
	require.Equal(t, "Bearer polar-token", req.Auth)
	require.Equal(t, []any{"product-creator"}, req.Body["products"])
	require.Equal(t, "ws-1", req.Body["external_customer_id"])
	require.Equal(t, "user@example.com", req.Body["customer_email"])
	metadata := req.Body["metadata"].(map[string]any)
	require.Equal(t, "ws-1", metadata["workspace_id"])
	require.Equal(t, "creator", metadata["plan_id"])
	require.Equal(t, float64(500), metadata["limit_scheduled_posts_monthly"])
	require.Equal(t, float64(6), metadata["limit_social_accounts"])
}

func TestPolarAPIURLAcceptsRootOrVersionedBaseURL(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		base string
		path string
		want string
	}{
		{
			name: "root base plus versioned path",
			base: "https://api.polar.sh",
			path: "/v1/checkouts/",
			want: "https://api.polar.sh/v1/checkouts/",
		},
		{
			name: "versioned base plus versioned path",
			base: "https://sandbox-api.polar.sh/v1",
			path: "/v1/checkouts/",
			want: "https://sandbox-api.polar.sh/v1/checkouts/",
		},
		{
			name: "versioned base plus unversioned path",
			base: "https://api.polar.sh/v1/",
			path: "/customer-sessions/",
			want: "https://api.polar.sh/v1/customer-sessions/",
		},
		{
			name: "root base plus unversioned path",
			base: "https://api.polar.sh",
			path: "customer-sessions/",
			want: "https://api.polar.sh/v1/customer-sessions/",
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, polarAPIURL(tt.base, tt.path))
		})
	}
}

func TestCreateCheckoutRejectsUnconfiguredPlan(t *testing.T) {
	t.Parallel()

	service := NewService(nil, "", PolarConfig{AccessToken: "polar-token", Plans: map[string]PlanConfig{}})

	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		WorkspaceID:   "ws-1",
		CustomerEmail: "user@example.com",
		PlanID:        "creator",
	})

	require.ErrorContains(t, err, "unknown billing plan")
}

func TestCreateCheckoutMissingPolarAccessTokenIsConfigurationError(t *testing.T) {
	t.Parallel()

	service := NewService(nil, "", PolarConfig{
		Plans: map[string]PlanConfig{
			"creator": {ProductID: "product-creator"},
		},
	})

	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		WorkspaceID:   "ws-1",
		CustomerEmail: "user@example.com",
		PlanID:        "creator",
	})

	require.Error(t, err)
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_POLAR_ACCESS_TOKEN")
}

func TestCreateCheckoutMissingPlanProductIsConfigurationError(t *testing.T) {
	t.Parallel()

	service := NewService(nil, "", PolarConfig{
		AccessToken: "polar-token",
		Plans: map[string]PlanConfig{
			"creator": {},
		},
	})

	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		WorkspaceID:   "ws-1",
		CustomerEmail: "user@example.com",
		PlanID:        "creator",
	})

	require.Error(t, err)
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_POLAR_CREATOR_PRODUCT_ID")
}

func TestCreateCustomerPortalSessionPostsPolarCustomerSession(t *testing.T) {
	t.Parallel()

	client := &fakePolarHTTPClient{
		t:        t,
		response: `{"id":"session-1","customer_portal_url":"https://polar.sh/customer/session"}`,
	}
	service := NewService(nil, "", PolarConfig{
		AccessToken: "polar-token",
		APIBaseURL:  "https://api.polar.test",
		ReturnURL:   "https://app.openpost.test/settings/billing",
	})
	service.SetHTTPClientForTest(client)

	result, err := service.CreateCustomerPortalSession(context.Background(), "ws-1")

	require.NoError(t, err)
	require.Equal(t, "session-1", result.ID)
	require.Equal(t, "https://polar.sh/customer/session", result.URL)
	require.Len(t, client.requests, 1)
	req := client.requests[0]
	require.Equal(t, http.MethodPost, req.Method)
	require.Equal(t, "/v1/customer-sessions/", req.Path)
	require.Equal(t, "ws-1", req.Body["external_customer_id"])
	require.Equal(t, "https://app.openpost.test/settings/billing", req.Body["return_url"])
}

func TestProcessPolarWebhookDeduplicatesEvents(t *testing.T) {
	t.Parallel()

	secret := "plain-secret"
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	db := newBillingTestDB(t)
	service := NewService(db, secret)
	service.now = func() time.Time { return now }
	body := []byte(`{
		"id": "evt-1",
		"type": "subscription.active",
		"data": {
			"id": "sub-1",
			"customer_id": "cus-1",
			"status": "active",
			"metadata": {"workspace_id": "ws-1", "plan_id": "starter"}
		}
	}`)
	headers := signedWebhookHeaders(t, secret, now, "evt-1", body)

	first, err := service.ProcessPolarWebhook(context.Background(), body, headers)
	require.NoError(t, err)
	second, err := service.ProcessPolarWebhook(context.Background(), body, headers)
	require.NoError(t, err)

	require.False(t, first.Duplicate)
	require.True(t, second.Duplicate)
	var eventCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_webhook_events").Scan(context.Background(), &eventCount))
	require.Equal(t, 1, eventCount)
}

func TestProcessPolarWebhookRejectsInvalidSignature(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	service := NewService(newBillingTestDB(t), "secret")
	service.now = func() time.Time { return now }
	body := []byte(`{"id":"evt-1","type":"subscription.active","data":{}}`)

	_, err := service.ProcessPolarWebhook(context.Background(), body, WebhookHeaders{
		ID:        "evt-1",
		Timestamp: fmt.Sprintf("%d", now.Unix()),
		Signature: "v1," + base64.StdEncoding.EncodeToString([]byte("wrong")),
	})

	require.ErrorContains(t, err, "invalid webhook signature")
}

func TestProcessPolarWebhookRejectsStaleTimestamp(t *testing.T) {
	t.Parallel()

	secret := "secret"
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	service := NewService(newBillingTestDB(t), secret)
	service.now = func() time.Time { return now }
	body := []byte(`{"id":"evt-1","type":"subscription.active","data":{}}`)

	_, err := service.ProcessPolarWebhook(context.Background(), body, signedWebhookHeaders(t, secret, now.Add(-10*time.Minute), "evt-1", body))

	require.ErrorContains(t, err, "outside tolerance")
}
