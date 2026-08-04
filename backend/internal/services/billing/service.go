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
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

const (
	ProviderWhop   = "whop"
	JobTypeWebhook = "billing_whop_webhook"
	TrialDays      = 14
)

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
	whop          WhopConfig
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type WhopConfig struct {
	APIKey     string
	APIBaseURL string
	AccountID  string
	ProductID  string
	AppURL     string
	ReturnURL  string
	Plans      map[string]PlanConfig
}

type ProviderPlanIDs struct {
	Monthly string
	Annual  string
}

type PlanConfig struct {
	ProviderPlanIDs ProviderPlanIDs
	MonthlyPriceUSD int
	AnnualPriceUSD  int
	Limits          map[entitlements.LimitKey]int64
}

func DefaultPlanCatalog(starter, creator, pro, team, agency ProviderPlanIDs) map[string]PlanConfig {
	return map[string]PlanConfig{
		"starter": {
			ProviderPlanIDs: starter,
			MonthlyPriceUSD: 15,
			AnnualPriceUSD:  150,
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
			ProviderPlanIDs: creator,
			MonthlyPriceUSD: 29,
			AnnualPriceUSD:  290,
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
			ProviderPlanIDs: pro,
			MonthlyPriceUSD: 49,
			AnnualPriceUSD:  490,
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
			ProviderPlanIDs: team,
			MonthlyPriceUSD: 99,
			AnnualPriceUSD:  990,
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
			ProviderPlanIDs: agency,
			MonthlyPriceUSD: 199,
			AnnualPriceUSD:  1_990,
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

func NewService(db *bun.DB, webhookSecret string, whopConfig ...WhopConfig) *Service {
	cfg := WhopConfig{APIBaseURL: "https://api.whop.com/api/v1"}
	if len(whopConfig) > 0 {
		cfg = whopConfig[0]
		if cfg.APIBaseURL == "" {
			cfg.APIBaseURL = "https://api.whop.com/api/v1"
		}
	}
	return &Service{
		db:            db,
		webhookSecret: strings.TrimSpace(webhookSecret),
		now:           func() time.Time { return time.Now().UTC() },
		httpClient:    http.DefaultClient,
		whop:          cfg,
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
	BillingPeriod  string
	AffiliateCode  string
}

type CheckoutResult struct {
	ID             string
	URL            string
	PurchaseURL    string
	ProviderPlanID string
	PlanID         string
	BillingPeriod  string
	PriceUSD       int
	TrialEndsAt    time.Time
	ReturnURL      string
}

func (s *Service) CreateCheckout(ctx context.Context, input CreateCheckoutInput) (CheckoutResult, error) {
	period := normalizeBillingPeriod(input.BillingPeriod)
	_, providerPlanID, priceUSD, err := s.planFor(input.PlanID, period)
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
	if strings.TrimSpace(s.whop.AccountID) == "" {
		return CheckoutResult{}, configurationError("OPENPOST_WHOP_ACCOUNT_ID is required")
	}

	metadata := checkoutMetadata(organizationID, input.WorkspaceID, input.UserID, input.PlanID, period)
	payload := map[string]any{
		"company_id":   s.whop.AccountID,
		"plan_id":      providerPlanID,
		"mode":         "payment",
		"redirect_url": s.returnURL(),
		"metadata":     metadata,
	}
	if affiliateCode := strings.TrimSpace(input.AffiliateCode); affiliateCode != "" {
		payload["affiliate_code"] = affiliateCode
	}

	var out struct {
		ID          string `json:"id"`
		PurchaseURL string `json:"purchase_url"`
		Plan        struct {
			ID string `json:"id"`
		} `json:"plan"`
	}
	if err := s.doWhopJSON(ctx, http.MethodPost, "/checkout_configurations", payload, &out, "checkout:"+organizationID+":"+strings.ToLower(input.PlanID)+":"+period); err != nil {
		return CheckoutResult{}, err
	}
	if strings.TrimSpace(out.ID) == "" {
		return CheckoutResult{}, fmt.Errorf("whop checkout response missing id")
	}
	if out.Plan.ID != "" {
		providerPlanID = out.Plan.ID
	}

	now := s.now().UTC()
	if s.db != nil {
		attempt := &models.BillingCheckoutAttempt{
			CheckoutConfigurationID: out.ID,
			OrganizationID:          organizationID,
			WorkspaceID:             strings.TrimSpace(input.WorkspaceID),
			UserID:                  strings.TrimSpace(input.UserID),
			Provider:                ProviderWhop,
			ProviderPlanID:          providerPlanID,
			PlanID:                  strings.ToLower(strings.TrimSpace(input.PlanID)),
			BillingPeriod:           period,
			Status:                  "created",
			CreatedAt:               now,
			UpdatedAt:               now,
		}
		if _, err := s.db.NewInsert().Model(attempt).Exec(ctx); err != nil {
			return CheckoutResult{}, fmt.Errorf("recording checkout configuration: %w", err)
		}
	}

	return CheckoutResult{
		ID:             out.ID,
		URL:            s.checkoutURL(out.ID, input.PlanID, period),
		PurchaseURL:    out.PurchaseURL,
		ProviderPlanID: providerPlanID,
		PlanID:         strings.ToLower(strings.TrimSpace(input.PlanID)),
		BillingPeriod:  period,
		PriceUSD:       priceUSD,
		TrialEndsAt:    now.AddDate(0, 0, TrialDays),
		ReturnURL:      s.returnURL(),
	}, nil
}

type CustomerPortalResult struct {
	ID  string
	URL string
}

func (s *Service) CreateCustomerPortalSession(ctx context.Context, organizationID string) (CustomerPortalResult, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return CustomerPortalResult{}, fmt.Errorf("organization id is required")
	}
	if s.db == nil {
		return CustomerPortalResult{}, fmt.Errorf("billing database is not configured")
	}
	var subscription models.BillingSubscription
	if err := s.db.NewSelect().Model(&subscription).Where("organization_id = ?", organizationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CustomerPortalResult{}, fmt.Errorf("no subscription found for this organization")
		}
		return CustomerPortalResult{}, fmt.Errorf("loading billing subscription: %w", err)
	}
	if strings.TrimSpace(subscription.ProviderManageURL) == "" {
		return CustomerPortalResult{}, fmt.Errorf("whop billing portal is not ready for this membership")
	}
	return CustomerPortalResult{ID: subscription.ProviderSubscriptionID, URL: subscription.ProviderManageURL}, nil
}

func (s *Service) planFor(planID, billingPeriod string) (PlanConfig, string, int, error) {
	planID = strings.ToLower(strings.TrimSpace(planID))
	if planID == "" {
		return PlanConfig{}, "", 0, fmt.Errorf("plan id is required")
	}
	plan, ok := s.whop.Plans[planID]
	if !ok {
		return PlanConfig{}, "", 0, fmt.Errorf("unknown billing plan %q", planID)
	}
	period := normalizeBillingPeriod(billingPeriod)
	providerPlanID := plan.ProviderPlanIDs.Monthly
	priceUSD := plan.MonthlyPriceUSD
	if period == "annual" {
		providerPlanID = plan.ProviderPlanIDs.Annual
		priceUSD = plan.AnnualPriceUSD
	}
	if strings.TrimSpace(providerPlanID) == "" {
		return PlanConfig{}, "", 0, configurationError("%s is required for billing plan %q", whopPlanEnvVar(planID, period), planID)
	}
	return plan, providerPlanID, priceUSD, nil
}

func normalizeBillingPeriod(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "annual") || strings.EqualFold(strings.TrimSpace(value), "yearly") {
		return "annual"
	}
	return "monthly"
}

func whopPlanEnvVar(planID, period string) string {
	return "OPENPOST_WHOP_" + strings.ToUpper(strings.ReplaceAll(planID, "-", "_")) + "_" + strings.ToUpper(normalizeBillingPeriod(period)) + "_PLAN_ID"
}

func checkoutMetadata(organizationID, workspaceID, userID, planID, period string) map[string]any {
	metadata := map[string]any{
		"organization_id": organizationID,
		"plan_id":         strings.ToLower(strings.TrimSpace(planID)),
		"billing_period":  normalizeBillingPeriod(period),
		"source":          "openpost",
	}
	if workspaceID != "" {
		metadata["workspace_id"] = workspaceID
	}
	if userID != "" {
		metadata["user_id"] = userID
	}
	return metadata
}

func (s *Service) checkoutURL(sessionID, planID, period string) string {
	base := strings.TrimRight(strings.TrimSpace(s.whop.AppURL), "/")
	if base == "" {
		return ""
	}
	values := url.Values{}
	values.Set("session_id", sessionID)
	values.Set("plan", strings.ToLower(strings.TrimSpace(planID)))
	values.Set("billing_period", normalizeBillingPeriod(period))
	return base + "/checkout?" + values.Encode()
}

func (s *Service) returnURL() string {
	if value := strings.TrimSpace(s.whop.ReturnURL); value != "" {
		return value
	}
	base := strings.TrimRight(strings.TrimSpace(s.whop.AppURL), "/")
	if base == "" {
		return ""
	}
	return base + "/checkout?status=success"
}

func (s *Service) doWhopJSON(ctx context.Context, method, path string, payload, out any, idempotencyKey string) error {
	if strings.TrimSpace(s.whop.APIKey) == "" {
		return configurationError("OPENPOST_WHOP_API_KEY is required")
	}
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, whopAPIURL(s.whop.APIBaseURL, path), body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.whop.APIKey)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("whop request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &providerAPIError{StatusCode: resp.StatusCode, Message: strings.TrimSpace(string(respBody))}
	}
	if out == nil || len(respBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("invalid whop response: %w", err)
	}
	return nil
}

type providerAPIError struct {
	StatusCode int
	Message    string
}

func (e *providerAPIError) Error() string {
	return fmt.Sprintf("whop request failed with status %d: %s", e.StatusCode, e.Message)
}

func whopAPIURL(baseURL, path string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = "https://api.whop.com/api/v1"
	}
	apiPath := "/" + strings.TrimLeft(path, "/")
	baseHasVersion := strings.HasSuffix(base, "/api/v1") || strings.HasSuffix(base, "/v1")
	pathHasVersion := strings.HasPrefix(apiPath, "/api/v1/") || strings.HasPrefix(apiPath, "/v1/")
	if baseHasVersion && pathHasVersion {
		apiPath = strings.TrimPrefix(apiPath, "/api/v1")
		apiPath = strings.TrimPrefix(apiPath, "/v1")
	} else if !baseHasVersion && !pathHasVersion {
		apiPath = "/api/v1" + apiPath
	}
	return base + apiPath
}

type WebhookHeaders struct {
	ID        string
	Timestamp string
	Signature string
}

type WebhookResult struct {
	EventID   string
	EventType string
	Duplicate bool
}

type whopEvent struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Timestamp json.RawMessage `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
}

func (s *Service) AcceptWhopWebhook(ctx context.Context, body []byte, headers WebhookHeaders) (WebhookResult, error) {
	if err := s.verifyStandardWebhook(body, headers); err != nil {
		return WebhookResult{}, err
	}
	if s.db == nil {
		return WebhookResult{}, fmt.Errorf("billing database is not configured")
	}
	var event whopEvent
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
		inserted, err := insertWebhookEvent(txCtx, tx, event.ID, event.Type, s.now())
		if err != nil {
			return err
		}
		if !inserted {
			result.Duplicate = true
			return nil
		}
		if !eventMayAffectMembership(event.Type) {
			return nil
		}
		job := &models.Job{
			ID:          uuid.NewString(),
			Type:        JobTypeWebhook,
			Payload:     string(body),
			Status:      "pending",
			RunAt:       s.now().UTC(),
			MaxAttempts: 8,
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return fmt.Errorf("queueing whop webhook: %w", err)
		}
		return nil
	})
	return result, err
}

func eventMayAffectMembership(eventType string) bool {
	for _, prefix := range []string{"membership.", "payment.", "refund.", "dispute."} {
		if strings.HasPrefix(eventType, prefix) {
			return true
		}
	}
	return false
}

func insertWebhookEvent(ctx context.Context, tx bun.Tx, eventID, eventType string, now time.Time) (bool, error) {
	event := &models.BillingWebhookEvent{
		EventID:     eventID,
		Provider:    ProviderWhop,
		EventType:   eventType,
		ProcessedAt: now.UTC(),
	}
	res, err := tx.NewInsert().Model(event).On("CONFLICT (event_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("recording webhook event: %w", err)
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	if jobType != JobTypeWebhook {
		return fmt.Errorf("unsupported billing job type %q", jobType)
	}
	var event whopEvent
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return fmt.Errorf("invalid queued whop webhook: %w", err)
	}
	membershipID := membershipIDFromEvent(event)
	if membershipID == "" {
		return nil
	}

	var membership whopMembership
	err := s.doWhopJSON(ctx, http.MethodGet, "/memberships/"+url.PathEscape(membershipID), nil, &membership, "")
	if err != nil {
		var apiErr *providerAPIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusNotFound {
			return err
		}
		if decodeErr := json.Unmarshal(event.Data, &membership); decodeErr != nil || membership.ID == "" {
			return err
		}
	}
	return s.reconcileMembership(ctx, membership, event.Data)
}

func membershipIDFromEvent(event whopEvent) string {
	var data struct {
		ID           string `json:"id"`
		MembershipID string `json:"membership_id"`
		Membership   struct {
			ID string `json:"id"`
		} `json:"membership"`
	}
	if json.Unmarshal(event.Data, &data) != nil {
		return ""
	}
	if data.Membership.ID != "" {
		return data.Membership.ID
	}
	if data.MembershipID != "" {
		return data.MembershipID
	}
	if strings.HasPrefix(event.Type, "membership.") {
		return data.ID
	}
	return ""
}

type whopMembership struct {
	ID                      string          `json:"id"`
	Status                  string          `json:"status"`
	ManageURL               string          `json:"manage_url"`
	CheckoutConfigurationID string          `json:"checkout_configuration_id"`
	RenewalPeriodEnd        json.RawMessage `json:"renewal_period_end"`
	CancelAtPeriodEnd       bool            `json:"cancel_at_period_end"`
	Metadata                map[string]any  `json:"metadata"`
	User                    struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
	Company struct {
		ID string `json:"id"`
	} `json:"company"`
	Plan struct {
		ID       string         `json:"id"`
		Metadata map[string]any `json:"metadata"`
	} `json:"plan"`
	Product struct {
		ID       string         `json:"id"`
		Metadata map[string]any `json:"metadata"`
	} `json:"product"`
}

func (s *Service) reconcileMembership(ctx context.Context, membership whopMembership, rawPayload json.RawMessage) error {
	if strings.TrimSpace(membership.ID) == "" {
		return fmt.Errorf("whop membership payload missing id")
	}
	attempt, err := s.checkoutAttempt(ctx, membership.CheckoutConfigurationID)
	if err != nil {
		return err
	}

	organizationID := attempt.OrganizationID
	workspaceID := attempt.WorkspaceID
	planID := attempt.PlanID
	if organizationID == "" {
		organizationID = firstMetadataString(membership.Metadata, "organization_id")
	}
	if workspaceID == "" {
		workspaceID = firstMetadataString(membership.Metadata, "workspace_id")
	}
	if planID == "" {
		planID = firstMetadataString(membership.Metadata, "plan_id")
	}
	if planID == "" {
		planID = s.planIDForProviderPlan(membership.Plan.ID)
	}
	if organizationID == "" && workspaceID != "" {
		organizationID = workspaceID
	}
	if organizationID == "" {
		return fmt.Errorf("whop membership missing OpenPost organization metadata")
	}
	plan, ok := s.whop.Plans[planID]
	if !ok {
		return fmt.Errorf("whop membership references unknown OpenPost plan %q", planID)
	}

	now := s.now().UTC()
	snapshot, _ := json.Marshal(map[string]any{
		"provider":   ProviderWhop,
		"plan_id":    planID,
		"status":     membership.Status,
		"product_id": membership.Product.ID,
		"price_id":   membership.Plan.ID,
		"limits":     plan.Limits,
	})
	encodedRaw, _ := json.Marshal(membership)
	if len(rawPayload) > 0 {
		encodedRaw = rawPayload
	}
	subscription := &models.BillingSubscription{
		OrganizationID:         organizationID,
		WorkspaceID:            workspaceID,
		Provider:               ProviderWhop,
		ProviderCustomerID:     membership.User.ID,
		ProviderSubscriptionID: membership.ID,
		ProviderProductID:      membership.Product.ID,
		ProviderPriceID:        membership.Plan.ID,
		ProviderManageURL:      membership.ManageURL,
		Status:                 strings.ToLower(membership.Status),
		PlanID:                 planID,
		EntitlementSnapshot:    string(snapshot),
		CurrentPeriodEnd:       parseWhopTime(membership.RenewalPeriodEnd),
		CancelAtPeriodEnd:      membership.CancelAtPeriodEnd,
		RawPayload:             string(encodedRaw),
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := upsertSubscription(txCtx, tx, subscription); err != nil {
			return err
		}
		if membership.CheckoutConfigurationID != "" {
			if _, err := tx.NewUpdate().Model((*models.BillingCheckoutAttempt)(nil)).
				Set("status = ?", membership.Status).
				Set("provider_membership_id = ?", membership.ID).
				Set("updated_at = ?", now).
				Where("checkout_configuration_id = ?", membership.CheckoutConfigurationID).
				Exec(txCtx); err != nil {
				return fmt.Errorf("updating checkout configuration: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) checkoutAttempt(ctx context.Context, checkoutConfigurationID string) (models.BillingCheckoutAttempt, error) {
	var attempt models.BillingCheckoutAttempt
	if strings.TrimSpace(checkoutConfigurationID) == "" {
		return attempt, nil
	}
	err := s.db.NewSelect().Model(&attempt).
		Where("checkout_configuration_id = ?", checkoutConfigurationID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.BillingCheckoutAttempt{}, nil
	}
	if err != nil {
		return models.BillingCheckoutAttempt{}, fmt.Errorf("loading checkout configuration: %w", err)
	}
	return attempt, nil
}

func (s *Service) planIDForProviderPlan(providerPlanID string) string {
	for planID, plan := range s.whop.Plans {
		if providerPlanID == plan.ProviderPlanIDs.Monthly || providerPlanID == plan.ProviderPlanIDs.Annual {
			return planID
		}
	}
	return ""
}

func upsertSubscription(ctx context.Context, tx bun.Tx, subscription *models.BillingSubscription) error {
	_, err := tx.NewInsert().Model(subscription).
		On("CONFLICT (organization_id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("provider = EXCLUDED.provider").
		Set("provider_customer_id = EXCLUDED.provider_customer_id").
		Set("provider_subscription_id = EXCLUDED.provider_subscription_id").
		Set("provider_product_id = EXCLUDED.provider_product_id").
		Set("provider_price_id = EXCLUDED.provider_price_id").
		Set("provider_manage_url = EXCLUDED.provider_manage_url").
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
		return fmt.Errorf("whop webhook secret is not configured")
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
		if err == nil && hmac.Equal(got, expected) {
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

func firstMetadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	if typed, ok := value.(string); ok {
		return strings.TrimSpace(typed)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func parseWhopTime(raw json.RawMessage) time.Time {
	if len(raw) == 0 || string(raw) == "null" {
		return time.Time{}
	}
	var value string
	if json.Unmarshal(raw, &value) == nil {
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05-07:00"} {
			if parsed, err := time.Parse(layout, value); err == nil {
				return parsed.UTC()
			}
		}
	}
	var unix int64
	if json.Unmarshal(raw, &unix) == nil && unix > 0 {
		return time.Unix(unix, 0).UTC()
	}
	return time.Time{}
}
