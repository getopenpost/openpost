package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

const ProviderPolar = "polar"

var errConfiguration = errors.New("billing provider is not configured")

func IsConfigurationError(err error) bool {
	return errors.Is(err, errConfiguration)
}

func configurationError(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errConfiguration, fmt.Sprintf(format, args...))
}

type Service struct {
	db            *bun.DB
	webhookSecret string
	now           func() time.Time
	httpClient    httpDoer
	polar         PolarConfig
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type PolarConfig struct {
	AccessToken string
	APIBaseURL  string
	SuccessURL  string
	ReturnURL   string
	Plans       map[string]PlanConfig
}

type PlanConfig struct {
	ProductID string
	Limits    map[entitlements.LimitKey]int64
}

func DefaultPlanCatalog(starterProductID, creatorProductID, proProductID string, extraProductIDs ...string) map[string]PlanConfig {
	teamProductID := ""
	agencyProductID := ""
	if len(extraProductIDs) > 0 {
		teamProductID = extraProductIDs[0]
	}
	if len(extraProductIDs) > 1 {
		agencyProductID = extraProductIDs[1]
	}
	return map[string]PlanConfig{
		"starter": {
			ProductID: starterProductID,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                1,
				entitlements.LimitSocialAccounts:            3,
				entitlements.LimitScheduledPostsMonthly:     100,
				entitlements.LimitMediaBytesStored:          1_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 1_000_000_000,
				entitlements.LimitTeamMembers:               1,
			},
		},
		"creator": {
			ProductID: creatorProductID,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                3,
				entitlements.LimitSocialAccounts:            6,
				entitlements.LimitScheduledPostsMonthly:     500,
				entitlements.LimitMediaBytesStored:          5_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 5_000_000_000,
				entitlements.LimitTeamMembers:               1,
			},
		},
		"pro": {
			ProductID: proProductID,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                10,
				entitlements.LimitSocialAccounts:            15,
				entitlements.LimitScheduledPostsMonthly:     2_500,
				entitlements.LimitMediaBytesStored:          25_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 25_000_000_000,
				entitlements.LimitTeamMembers:               1,
			},
		},
		"team": {
			ProductID: teamProductID,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                10,
				entitlements.LimitSocialAccounts:            25,
				entitlements.LimitScheduledPostsMonthly:     5_000,
				entitlements.LimitMediaBytesStored:          50_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 50_000_000_000,
				entitlements.LimitTeamMembers:               3,
			},
		},
		"agency": {
			ProductID: agencyProductID,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                50,
				entitlements.LimitSocialAccounts:            150,
				entitlements.LimitScheduledPostsMonthly:     25_000,
				entitlements.LimitMediaBytesStored:          250_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 250_000_000_000,
				entitlements.LimitTeamMembers:               5,
			},
		},
	}
}

func NewService(db *bun.DB, webhookSecret string, polarConfig ...PolarConfig) *Service {
	cfg := PolarConfig{APIBaseURL: "https://api.polar.sh/v1"}
	if len(polarConfig) > 0 {
		cfg = polarConfig[0]
		if cfg.APIBaseURL == "" {
			cfg.APIBaseURL = "https://api.polar.sh/v1"
		}
	}
	return &Service{
		db:            db,
		webhookSecret: strings.TrimSpace(webhookSecret),
		now:           func() time.Time { return time.Now().UTC() },
		httpClient:    http.DefaultClient,
		polar:         cfg,
	}
}

func (s *Service) SetNowForTest(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

func (s *Service) SetHTTPClientForTest(client httpDoer) {
	if client != nil {
		s.httpClient = client
	}
}

type CreateCheckoutInput struct {
	OrganizationID string
	WorkspaceID    string
	UserID         string
	CustomerEmail  string
	PlanID         string
}

type CheckoutResult struct {
	ID  string
	URL string
}

func (s *Service) CreateCheckout(ctx context.Context, input CreateCheckoutInput) (CheckoutResult, error) {
	plan, err := s.planFor(input.PlanID)
	if err != nil {
		return CheckoutResult{}, err
	}
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" {
		organizationID = strings.TrimSpace(input.WorkspaceID)
	}
	if organizationID == "" {
		return CheckoutResult{}, fmt.Errorf("organization id is required")
	}
	if strings.TrimSpace(input.CustomerEmail) == "" {
		return CheckoutResult{}, fmt.Errorf("customer email is required")
	}

	payload := map[string]any{
		"products":             []string{plan.ProductID},
		"external_customer_id": organizationID,
		"customer_email":       input.CustomerEmail,
		"success_url":          s.polar.SuccessURL,
		"return_url":           s.polar.ReturnURL,
		"metadata":             checkoutMetadata(organizationID, input.WorkspaceID, input.UserID, input.PlanID, plan.Limits),
		"customer_metadata": map[string]any{
			"organization_id": organizationID,
		},
	}
	var out struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := s.postPolar(ctx, "/v1/checkouts/", payload, &out); err != nil {
		return CheckoutResult{}, err
	}
	if out.URL == "" {
		return CheckoutResult{}, fmt.Errorf("polar checkout response missing url")
	}
	return CheckoutResult{ID: out.ID, URL: out.URL}, nil
}

type CustomerPortalResult struct {
	ID  string
	URL string
}

func (s *Service) CreateCustomerPortalSession(ctx context.Context, organizationID string) (CustomerPortalResult, error) {
	if strings.TrimSpace(organizationID) == "" {
		return CustomerPortalResult{}, fmt.Errorf("organization id is required")
	}
	payload := map[string]any{
		"external_customer_id": organizationID,
		"return_url":           s.polar.ReturnURL,
	}
	var out struct {
		ID                string `json:"id"`
		CustomerPortalURL string `json:"customer_portal_url"`
	}
	if err := s.postPolar(ctx, "/v1/customer-sessions/", payload, &out); err != nil {
		return CustomerPortalResult{}, err
	}
	if out.CustomerPortalURL == "" {
		return CustomerPortalResult{}, fmt.Errorf("polar customer session response missing customer_portal_url")
	}
	return CustomerPortalResult{ID: out.ID, URL: out.CustomerPortalURL}, nil
}

func (s *Service) planFor(planID string) (PlanConfig, error) {
	planID = strings.ToLower(strings.TrimSpace(planID))
	if planID == "" {
		return PlanConfig{}, fmt.Errorf("plan id is required")
	}
	plan, ok := s.polar.Plans[planID]
	if !ok {
		return PlanConfig{}, fmt.Errorf("unknown billing plan %q", planID)
	}
	if strings.TrimSpace(plan.ProductID) == "" {
		return PlanConfig{}, configurationError("%s is required for billing plan %q", polarProductEnvVar(planID), planID)
	}
	return plan, nil
}

func polarProductEnvVar(planID string) string {
	switch planID {
	case "starter":
		return "OPENPOST_POLAR_STARTER_PRODUCT_ID"
	case "creator":
		return "OPENPOST_POLAR_CREATOR_PRODUCT_ID"
	case "pro":
		return "OPENPOST_POLAR_PRO_PRODUCT_ID"
	case "team":
		return "OPENPOST_POLAR_TEAM_PRODUCT_ID"
	case "agency":
		return "OPENPOST_POLAR_AGENCY_PRODUCT_ID"
	default:
		return "OPENPOST_POLAR_" + strings.ToUpper(strings.ReplaceAll(planID, "-", "_")) + "_PRODUCT_ID"
	}
}

func checkoutMetadata(organizationID, workspaceID, userID, planID string, limits map[entitlements.LimitKey]int64) map[string]any {
	metadata := map[string]any{
		"organization_id": organizationID,
		"plan_id":         planID,
	}
	if workspaceID != "" {
		metadata["workspace_id"] = workspaceID
	}
	if userID != "" {
		metadata["user_id"] = userID
	}
	for key, value := range limits {
		metadata["limit_"+string(key)] = value
	}
	return metadata
}

func (s *Service) postPolar(ctx context.Context, path string, payload any, out any) error {
	if strings.TrimSpace(s.polar.AccessToken) == "" {
		return configurationError("OPENPOST_POLAR_ACCESS_TOKEN is required")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	url := polarAPIURL(s.polar.APIBaseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.polar.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("polar request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("polar request failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("invalid polar response: %w", err)
	}
	return nil
}

func polarAPIURL(baseURL, path string) string {
	base := strings.TrimRight(baseURL, "/")
	if base == "" {
		base = "https://api.polar.sh/v1"
	}

	apiPath := "/" + strings.TrimLeft(path, "/")
	baseHasVersion := strings.HasSuffix(base, "/v1")
	pathHasVersion := strings.HasPrefix(apiPath, "/v1/")
	switch {
	case baseHasVersion && pathHasVersion:
		apiPath = strings.TrimPrefix(apiPath, "/v1")
	case !baseHasVersion && !pathHasVersion:
		apiPath = "/v1" + apiPath
	}
	return base + apiPath
}

type WebhookHeaders struct {
	ID        string
	Timestamp string
	Signature string
}

type WebhookResult struct {
	EventID        string
	EventType      string
	OrganizationID string
	WorkspaceID    string
	Duplicate      bool
}

func (s *Service) ProcessPolarWebhook(ctx context.Context, body []byte, headers WebhookHeaders) (WebhookResult, error) {
	if err := s.verifyStandardWebhook(body, headers); err != nil {
		return WebhookResult{}, err
	}

	var event polarEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookResult{}, fmt.Errorf("invalid webhook payload: %w", err)
	}
	if strings.TrimSpace(event.ID) == "" {
		event.ID = headers.ID
	}
	if event.ID == "" || event.Type == "" {
		return WebhookResult{}, fmt.Errorf("webhook event id and type are required")
	}

	result := WebhookResult{EventID: event.ID, EventType: event.Type}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		inserted, err := insertWebhookEvent(txCtx, tx, event.ID, event.Type)
		if err != nil {
			return err
		}
		if !inserted {
			result.Duplicate = true
			return nil
		}

		if !strings.HasPrefix(event.Type, "subscription.") {
			return nil
		}

		subscription, err := subscriptionFromPolarEvent(event)
		if err != nil {
			return err
		}
		result.OrganizationID = subscription.OrganizationID
		result.WorkspaceID = subscription.WorkspaceID
		return upsertSubscription(txCtx, tx, subscription)
	})
	return result, err
}

func insertWebhookEvent(ctx context.Context, tx bun.Tx, eventID, eventType string) (bool, error) {
	event := &models.BillingWebhookEvent{
		EventID:     eventID,
		Provider:    ProviderPolar,
		EventType:   eventType,
		ProcessedAt: time.Now().UTC(),
	}
	res, err := tx.NewInsert().
		Model(event).
		On("CONFLICT (event_id) DO NOTHING").
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("recording webhook event: %w", err)
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

func upsertSubscription(ctx context.Context, tx bun.Tx, subscription *models.BillingSubscription) error {
	_, err := tx.NewInsert().
		Model(subscription).
		On("CONFLICT (organization_id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("provider = EXCLUDED.provider").
		Set("provider_customer_id = EXCLUDED.provider_customer_id").
		Set("provider_subscription_id = EXCLUDED.provider_subscription_id").
		Set("provider_product_id = EXCLUDED.provider_product_id").
		Set("provider_price_id = EXCLUDED.provider_price_id").
		Set("status = EXCLUDED.status").
		Set("plan_id = EXCLUDED.plan_id").
		Set("entitlement_snapshot = EXCLUDED.entitlement_snapshot").
		Set("current_period_end = EXCLUDED.current_period_end").
		Set("cancel_at_period_end = EXCLUDED.cancel_at_period_end").
		Set("raw_payload = EXCLUDED.raw_payload").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("upserting billing subscription: %w", err)
	}
	return nil
}

func (s *Service) verifyStandardWebhook(body []byte, headers WebhookHeaders) error {
	if s.webhookSecret == "" {
		return fmt.Errorf("polar webhook secret is not configured")
	}
	if headers.ID == "" || headers.Timestamp == "" || headers.Signature == "" {
		return fmt.Errorf("missing webhook signature headers")
	}

	timestamp, err := strconv.ParseInt(headers.Timestamp, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid webhook timestamp")
	}
	signedAt := time.Unix(timestamp, 0).UTC()
	if delta := s.now().Sub(signedAt); delta > 5*time.Minute || delta < -5*time.Minute {
		return fmt.Errorf("webhook timestamp outside tolerance")
	}

	secret := decodeWebhookSecret(s.webhookSecret)
	signed := headers.ID + "." + headers.Timestamp + "." + string(body)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(signed))
	expected := mac.Sum(nil)

	for _, candidate := range strings.Fields(headers.Signature) {
		candidate = strings.TrimPrefix(candidate, "v1,")
		got, err := base64.StdEncoding.DecodeString(candidate)
		if err != nil {
			continue
		}
		if hmac.Equal(got, expected) {
			return nil
		}
	}
	return fmt.Errorf("invalid webhook signature")
}

func decodeWebhookSecret(secret string) []byte {
	secret = strings.TrimSpace(strings.TrimPrefix(secret, "whsec_"))
	if decoded, err := base64.StdEncoding.DecodeString(secret); err == nil {
		return decoded
	}
	return []byte(secret)
}

type polarEvent struct {
	ID   string          `json:"id"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type polarSubscriptionData struct {
	ID                string         `json:"id"`
	Status            string         `json:"status"`
	CustomerID        string         `json:"customer_id"`
	ProductID         string         `json:"product_id"`
	PriceID           string         `json:"price_id"`
	CurrentPeriodEnd  string         `json:"current_period_end"`
	CancelAtPeriodEnd bool           `json:"cancel_at_period_end"`
	Metadata          map[string]any `json:"metadata"`
	Customer          struct {
		ID         string         `json:"id"`
		ExternalID string         `json:"external_id"`
		Metadata   map[string]any `json:"metadata"`
	} `json:"customer"`
	Product struct {
		ID string `json:"id"`
	} `json:"product"`
	Price struct {
		ID string `json:"id"`
	} `json:"price"`
}

func subscriptionFromPolarEvent(event polarEvent) (*models.BillingSubscription, error) {
	var data polarSubscriptionData
	if err := json.Unmarshal(event.Data, &data); err != nil {
		return nil, fmt.Errorf("invalid subscription payload: %w", err)
	}

	organizationID := firstMetadataString(data.Metadata, "organization_id")
	if organizationID == "" {
		organizationID = firstMetadataString(data.Customer.Metadata, "organization_id")
	}
	if organizationID == "" {
		organizationID = data.Customer.ExternalID
	}
	workspaceID := firstMetadataString(data.Metadata, "workspace_id")
	if workspaceID == "" {
		workspaceID = firstMetadataString(data.Customer.Metadata, "workspace_id")
	}
	if organizationID == "" && workspaceID != "" {
		organizationID = "org_" + workspaceID
	}
	if organizationID == "" {
		return nil, fmt.Errorf("subscription webhook missing organization_id metadata")
	}

	customerID := data.CustomerID
	if customerID == "" {
		customerID = data.Customer.ID
	}
	productID := data.ProductID
	if productID == "" {
		productID = data.Product.ID
	}
	priceID := data.PriceID
	if priceID == "" {
		priceID = data.Price.ID
	}
	planID := firstMetadataString(data.Metadata, "plan_id")
	if planID == "" {
		planID = firstMetadataString(data.Metadata, "plan")
	}

	entitlementSnapshot := entitlementSnapshotJSON(data, planID)
	currentPeriodEnd := parseOptionalTime(data.CurrentPeriodEnd)
	rawPayload, _ := json.Marshal(event.Data)
	now := time.Now().UTC()
	return &models.BillingSubscription{
		OrganizationID:         organizationID,
		WorkspaceID:            workspaceID,
		Provider:               ProviderPolar,
		ProviderCustomerID:     customerID,
		ProviderSubscriptionID: data.ID,
		ProviderProductID:      productID,
		ProviderPriceID:        priceID,
		Status:                 data.Status,
		PlanID:                 planID,
		EntitlementSnapshot:    entitlementSnapshot,
		CurrentPeriodEnd:       currentPeriodEnd,
		CancelAtPeriodEnd:      data.CancelAtPeriodEnd,
		RawPayload:             string(rawPayload),
		CreatedAt:              now,
		UpdatedAt:              now,
	}, nil
}

func entitlementSnapshotJSON(data polarSubscriptionData, planID string) string {
	productID := data.ProductID
	if productID == "" {
		productID = data.Product.ID
	}
	priceID := data.PriceID
	if priceID == "" {
		priceID = data.Price.ID
	}
	snapshot := map[string]any{
		"provider":   ProviderPolar,
		"plan_id":    planID,
		"status":     data.Status,
		"product_id": productID,
		"price_id":   priceID,
	}
	limits := make(map[string]int64)
	for key, value := range data.Metadata {
		metric, ok := strings.CutPrefix(key, "limit_")
		if !ok {
			continue
		}
		if parsed, ok := metadataLimitAsInt64(value); ok {
			limits[metric] = parsed
		}
	}
	if len(limits) > 0 {
		snapshot["limits"] = limits
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func metadataLimitAsInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), typed >= 0 && typed == float64(int64(typed))
	case int64:
		return typed, typed >= 0
	case int:
		return int64(typed), typed >= 0
	case string:
		parsed, err := strconv.ParseInt(typed, 10, 64)
		return parsed, err == nil && parsed >= 0
	default:
		return 0, false
	}
}

func firstMetadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func parseOptionalTime(value string) time.Time {
	if strings.TrimSpace(value) == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05-07:00"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}
