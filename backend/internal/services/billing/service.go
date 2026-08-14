package billing

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	ProviderPaddle = models.BillingProviderPaddle
	JobTypeWebhook = jobregistry.TypeBillingWebhook
	TrialDays      = PlanCatalogTrialDays
)

var (
	ErrFirstWorkspaceExists      = errors.New("the first Workspace has already been created")
	ErrOrganizationMemberExists  = errors.New("only an eligible new Organization Owner can confirm a first Workspace purchase")
	ErrWelcomeConfirmationReplay = errors.New("confirmed welcome details do not match the existing checkout attempt")
)

var errConfiguration = errors.New("billing provider is not configured")

func IsConfigurationError(err error) bool {
	return errors.Is(err, errConfiguration)
}

func configurationError(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errConfiguration, fmt.Sprintf(format, args...))
}

type PaddleAPI interface {
	GetSubscription(context.Context, *paddle.GetSubscriptionRequest) (*paddle.Subscription, error)
	GetTransaction(context.Context, *paddle.GetTransactionRequest) (*paddle.Transaction, error)
	GetCustomer(context.Context, *paddle.GetCustomerRequest) (*paddle.Customer, error)
	CreateCustomerPortalSession(context.Context, *paddle.CreateCustomerPortalSessionRequest) (*paddle.CustomerPortalSession, error)
}

type Service struct {
	db                   *bun.DB
	webhookSecret        string
	purchaseChoiceSecret []byte
	verifier             *paddle.WebhookVerifier
	now                  func() time.Time
	paddle               PaddleConfig
	api                  PaddleAPI
	apiInitErr           error
}

type PaddleConfig struct {
	APIKey               string
	APIBaseURL           string
	Environment          string
	ClientToken          string
	AppURL               string
	ReturnURL            string
	Plans                map[string]PlanConfig
	PurchaseChoiceSecret string
}

type PaddlePriceIDs struct {
	Monthly string
	Annual  string
}

type PlanConfig struct {
	Name            string
	PaddlePriceIDs  PaddlePriceIDs
	MonthlyPriceUSD int
	AnnualPriceUSD  int
	Limits          map[entitlements.LimitKey]int64
}

func DefaultPlanCatalog(starter, founder, pro, team, agency PaddlePriceIDs) map[string]PlanConfig {
	priceIDs := map[string]PaddlePriceIDs{
		"starter": starter,
		"founder": founder,
		"pro":     pro,
		"team":    team,
		"agency":  agency,
	}
	catalog := make(map[string]PlanConfig, len(canonicalPlanCatalog))
	for _, planID := range canonicalPlanOrder {
		plan := canonicalPlanCatalog[planID]
		plan.PaddlePriceIDs = priceIDs[planID]
		plan.Limits = maps.Clone(plan.Limits)
		catalog[planID] = plan
	}
	return catalog
}

func NewService(db *bun.DB, webhookSecret string, paddleConfig ...PaddleConfig) *Service {
	cfg := PaddleConfig{}
	if len(paddleConfig) > 0 {
		cfg = paddleConfig[0]
	}
	service := &Service{
		db:                   db,
		webhookSecret:        strings.TrimSpace(webhookSecret),
		purchaseChoiceSecret: []byte(strings.TrimSpace(cfg.PurchaseChoiceSecret)),
		now:                  func() time.Time { return time.Now().UTC() },
		paddle:               cfg,
	}
	if service.webhookSecret != "" {
		service.verifier = paddle.NewWebhookVerifier(service.webhookSecret, paddle.VerifierWithTimestampTolerance(5*time.Minute))
	}
	if strings.TrimSpace(cfg.APIKey) != "" {
		service.api, service.apiInitErr = newPaddleAPI(cfg)
	}
	return service
}

func newPaddleAPI(cfg PaddleConfig) (*paddle.SDK, error) {
	environment := strings.ToLower(strings.TrimSpace(cfg.Environment))
	opts := []paddle.Option{}
	if baseURL := strings.TrimRight(strings.TrimSpace(cfg.APIBaseURL), "/"); baseURL != "" {
		opts = append(opts, paddle.WithBaseURL(baseURL))
	}
	switch environment {
	case "production":
		return paddle.New(strings.TrimSpace(cfg.APIKey), opts...)
	case "sandbox":
		return paddle.NewSandbox(strings.TrimSpace(cfg.APIKey), opts...)
	default:
		return nil, configurationError("OPENPOST_PADDLE_ENVIRONMENT must be explicitly set to sandbox or production")
	}
}

func (s *Service) SetNowForTest(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

func (s *Service) SetPaddleClientForTest(client PaddleAPI) {
	s.api = client
	s.apiInitErr = nil
}

type CreateCheckoutInput struct {
	OrganizationID  string
	WorkspaceID     string
	UserID          string
	CustomerEmail   string
	PlanID          string
	BillingPeriod   string
	ReturnPath      string
	ConfirmationKey string
}

type CheckoutResult struct {
	URL             string
	ID              string
	ProviderPriceID string
	PriceIDs        map[string]string
	PlanID          string
	BillingPeriod   string
	TrialEndsAt     time.Time
	ReturnURL       string
	ClientToken     string
	Environment     string
	CustomerEmail   string
	WorkspaceID     string
}

type ConfirmFirstWorkspaceInput struct {
	UserID, CustomerEmail, WorkspaceName, ReturnPath, ConfirmationKey string
	Choice                                                            PurchaseChoice
}

type FirstWorkspaceConfirmation struct {
	Checkout       CheckoutResult
	Workspace      models.Workspace
	OrganizationID string
	Created        bool
}

func (s *Service) ConfirmFirstWorkspace(ctx context.Context, input ConfirmFirstWorkspaceInput) (FirstWorkspaceConfirmation, error) {
	var confirmation FirstWorkspaceConfirmation
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var txErr error
		confirmation, txErr = s.confirmFirstWorkspaceTx(txCtx, tx, input)
		return txErr
	})
	return confirmation, err
}

func (s *Service) confirmFirstWorkspaceTx(ctx context.Context, tx bun.Tx, input ConfirmFirstWorkspaceInput) (FirstWorkspaceConfirmation, error) {
	var existing models.BillingCheckoutAttempt
	err := tx.NewSelect().Model(&existing).Where("user_id = ?", input.UserID).Where("confirmation_key = ?", input.ConfirmationKey).Scan(ctx)
	if err == nil {
		return s.resumeFirstWorkspace(ctx, tx, input, existing)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FirstWorkspaceConfirmation{}, err
	}
	if err := ensureFirstWorkspaceEligibility(ctx, tx, input.UserID); err != nil {
		return FirstWorkspaceConfirmation{}, err
	}
	return s.createFirstWorkspace(ctx, tx, input)
}

func (s *Service) resumeFirstWorkspace(ctx context.Context, tx bun.Tx, input ConfirmFirstWorkspaceInput, existing models.BillingCheckoutAttempt) (FirstWorkspaceConfirmation, error) {
	var workspace models.Workspace
	if err := tx.NewSelect().Model(&workspace).Where("id = ?", existing.WorkspaceID).Scan(ctx); err != nil {
		return FirstWorkspaceConfirmation{}, err
	}
	if workspace.Name != input.WorkspaceName || existing.PlanID != input.Choice.PlanID || existing.BillingPeriod != input.Choice.BillingPeriod || existing.ReturnPath != strings.TrimSpace(input.ReturnPath) {
		return FirstWorkspaceConfirmation{}, ErrWelcomeConfirmationReplay
	}
	checkout, _, err := s.ResumeCheckout(ctx, tx, existing.CheckoutAttemptID, input.UserID, input.CustomerEmail)
	return FirstWorkspaceConfirmation{Checkout: checkout, Workspace: workspace, OrganizationID: existing.OrganizationID}, err
}

func ensureFirstWorkspaceEligibility(ctx context.Context, tx bun.Tx, userID string) error {
	for _, membership := range []struct {
		table string
		err   error
	}{{"workspace_members", ErrFirstWorkspaceExists}, {"organization_members", ErrOrganizationMemberExists}} {
		var count int
		if err := tx.NewSelect().ColumnExpr("COUNT(*)").TableExpr(membership.table).Where("user_id = ?", userID).Scan(ctx, &count); err != nil {
			return err
		}
		if count != 0 {
			return membership.err
		}
	}
	return nil
}

func (s *Service) createFirstWorkspace(ctx context.Context, tx bun.Tx, input ConfirmFirstWorkspaceInput) (FirstWorkspaceConfirmation, error) {
	now := s.now().UTC()
	organizationID := uuid.NewString()
	workspace := models.Workspace{ID: uuid.NewString(), OrganizationID: organizationID, Name: input.WorkspaceName, WeekStart: 1, CreatedAt: now}
	for _, model := range []any{
		&models.Organization{ID: organizationID, Name: input.WorkspaceName, CreatedByID: input.UserID, CreatedAt: now, UpdatedAt: now},
		&models.OrganizationMember{OrganizationID: organizationID, UserID: input.UserID, Role: models.OrganizationRoleOwner, CreatedAt: now},
		&workspace,
		&models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: input.UserID, Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now},
	} {
		if _, err := tx.NewInsert().Model(model).Exec(ctx); err != nil {
			return FirstWorkspaceConfirmation{}, err
		}
	}
	checkout, err := s.CreateCheckoutWithDB(ctx, tx, CreateCheckoutInput{
		OrganizationID: organizationID, WorkspaceID: workspace.ID, UserID: input.UserID,
		CustomerEmail: input.CustomerEmail, PlanID: input.Choice.PlanID, BillingPeriod: input.Choice.BillingPeriod,
		ReturnPath: input.ReturnPath, ConfirmationKey: input.ConfirmationKey,
	})
	return FirstWorkspaceConfirmation{Checkout: checkout, Workspace: workspace, OrganizationID: organizationID, Created: err == nil}, err
}

func (s *Service) CreateCheckout(ctx context.Context, input CreateCheckoutInput) (CheckoutResult, error) {
	return s.CreateCheckoutWithDB(ctx, s.db, input)
}

func (s *Service) CreateCheckoutWithDB(ctx context.Context, db bun.IDB, input CreateCheckoutInput) (CheckoutResult, error) {
	period := normalizeBillingPeriod(input.BillingPeriod)
	returnPath, err := normalizeCheckoutReturnPath(input.ReturnPath)
	if err != nil {
		return CheckoutResult{}, err
	}
	providerPriceID, err := s.planFor(input.PlanID, period)
	if err != nil {
		return CheckoutResult{}, err
	}
	environment := strings.ToLower(strings.TrimSpace(s.paddle.Environment))
	if environment != "sandbox" && environment != "production" {
		return CheckoutResult{}, configurationError("OPENPOST_PADDLE_ENVIRONMENT must be explicitly set to sandbox or production")
	}
	clientToken := strings.TrimSpace(s.paddle.ClientToken)
	if clientToken == "" {
		return CheckoutResult{}, configurationError("OPENPOST_PADDLE_CLIENT_TOKEN is required")
	}
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" {
		organizationID = strings.TrimSpace(input.WorkspaceID)
	}
	if organizationID == "" {
		return CheckoutResult{}, fmt.Errorf("organization id is required")
	}
	email := strings.TrimSpace(input.CustomerEmail)
	if email == "" {
		return CheckoutResult{}, fmt.Errorf("customer email is required")
	}

	now := s.now().UTC()
	attemptID := "chkat_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if db != nil {
		attempt := &models.BillingCheckoutAttempt{
			CheckoutAttemptID: attemptID,
			OrganizationID:    organizationID,
			WorkspaceID:       strings.TrimSpace(input.WorkspaceID),
			UserID:            strings.TrimSpace(input.UserID),
			Provider:          ProviderPaddle,
			ProviderPriceID:   providerPriceID,
			PlanID:            strings.ToLower(strings.TrimSpace(input.PlanID)),
			BillingPeriod:     period,
			ConfirmationKey:   strings.TrimSpace(input.ConfirmationKey),
			ReturnPath:        returnPath,
			Status:            "created",
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if _, err := db.NewInsert().Model(attempt).Exec(ctx); err != nil {
			return CheckoutResult{}, fmt.Errorf("recording checkout attempt: %w", err)
		}
	}

	return CheckoutResult{
		URL:             s.checkoutURL(input.PlanID, period),
		ID:              attemptID,
		ProviderPriceID: providerPriceID,
		PriceIDs:        s.priceIDsForPeriod(period),
		PlanID:          strings.ToLower(strings.TrimSpace(input.PlanID)),
		BillingPeriod:   period,
		TrialEndsAt:     now.AddDate(0, 0, TrialDays),
		ReturnURL:       s.returnURL(attemptID),
		ClientToken:     clientToken,
		Environment:     environment,
		CustomerEmail:   email,
		WorkspaceID:     strings.TrimSpace(input.WorkspaceID),
	}, nil
}

func (s *Service) ResumeCheckout(ctx context.Context, db bun.IDB, attemptID, userID, customerEmail string) (CheckoutResult, models.BillingCheckoutAttempt, error) {
	var attempt models.BillingCheckoutAttempt
	if db == nil || strings.TrimSpace(attemptID) == "" || strings.TrimSpace(userID) == "" {
		return CheckoutResult{}, attempt, sql.ErrNoRows
	}
	if err := db.NewSelect().Model(&attempt).
		Where("checkout_attempt_id = ?", strings.TrimSpace(attemptID)).
		Where("user_id = ?", strings.TrimSpace(userID)).
		Where("provider = ?", ProviderPaddle).
		Scan(ctx); err != nil {
		return CheckoutResult{}, attempt, err
	}
	providerPriceID, err := s.planFor(attempt.PlanID, attempt.BillingPeriod)
	if err != nil || providerPriceID != attempt.ProviderPriceID {
		return CheckoutResult{}, attempt, ErrPurchaseChoiceMismatch
	}
	environment := strings.ToLower(strings.TrimSpace(s.paddle.Environment))
	clientToken := strings.TrimSpace(s.paddle.ClientToken)
	if environment != "sandbox" && environment != "production" {
		return CheckoutResult{}, attempt, configurationError("OPENPOST_PADDLE_ENVIRONMENT must be explicitly set to sandbox or production")
	}
	if clientToken == "" {
		return CheckoutResult{}, attempt, configurationError("OPENPOST_PADDLE_CLIENT_TOKEN is required")
	}
	return CheckoutResult{
		URL:             s.checkoutURL(attempt.PlanID, attempt.BillingPeriod),
		ID:              attempt.CheckoutAttemptID,
		ProviderPriceID: attempt.ProviderPriceID,
		PriceIDs:        s.priceIDsForPeriod(attempt.BillingPeriod),
		PlanID:          attempt.PlanID,
		BillingPeriod:   attempt.BillingPeriod,
		TrialEndsAt:     attempt.CreatedAt.UTC().AddDate(0, 0, TrialDays),
		ReturnURL:       s.returnURL(attempt.CheckoutAttemptID),
		ClientToken:     clientToken,
		Environment:     environment,
		CustomerEmail:   strings.TrimSpace(customerEmail),
		WorkspaceID:     attempt.WorkspaceID,
	}, attempt, nil
}

func (s *Service) checkoutURL(planID, period string) string {
	base := strings.TrimRight(strings.TrimSpace(s.paddle.AppURL), "/")
	if base == "" {
		return ""
	}
	values := url.Values{}
	values.Set("plan", strings.ToLower(strings.TrimSpace(planID)))
	values.Set("billing_period", normalizeBillingPeriod(period))
	return base + "/checkout?" + values.Encode()
}

func (s *Service) priceIDsForPeriod(period string) map[string]string {
	prices := make(map[string]string, len(s.paddle.Plans))
	for planID, plan := range s.paddle.Plans {
		priceID := plan.PaddlePriceIDs.Monthly
		if normalizeBillingPeriod(period) == "annual" {
			priceID = plan.PaddlePriceIDs.Annual
		}
		if strings.TrimSpace(priceID) != "" {
			prices[planID] = priceID
		}
	}
	return prices
}

type CustomerPortalResult struct {
	ID                  string
	URL                 string
	Purpose             CustomerPortalPurpose
	UsedGenericFallback bool
}

type CustomerPortalPurpose string

const (
	CustomerPortalPurposeManage              CustomerPortalPurpose = "manage"
	CustomerPortalPurposeUpdatePaymentMethod CustomerPortalPurpose = "update_payment_method"
	CustomerPortalPurposeCancelSubscription  CustomerPortalPurpose = "cancel_subscription"
	CustomerPortalPurposeInvoices            CustomerPortalPurpose = "invoices"
	CustomerPortalPurposeBillingDetails      CustomerPortalPurpose = "billing_details"
)

type CreateCustomerPortalInput struct {
	OrganizationID string
	Purpose        CustomerPortalPurpose
}

func (s *Service) CreateCustomerPortalSession(ctx context.Context, input CreateCustomerPortalInput) (CustomerPortalResult, error) {
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" {
		return CustomerPortalResult{}, fmt.Errorf("organization id is required")
	}
	purpose, err := normalizeCustomerPortalPurpose(input.Purpose)
	if err != nil {
		return CustomerPortalResult{}, err
	}
	if s.db == nil {
		return CustomerPortalResult{}, fmt.Errorf("billing database is not configured")
	}
	if err := s.ensureAPI(); err != nil {
		return CustomerPortalResult{}, err
	}
	var subscription models.BillingSubscription
	if err := s.db.NewSelect().Model(&subscription).Where("organization_id = ?", organizationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CustomerPortalResult{}, fmt.Errorf("no subscription found for this organization")
		}
		return CustomerPortalResult{}, fmt.Errorf("loading billing subscription: %w", err)
	}
	if subscription.Provider != ProviderPaddle || strings.TrimSpace(subscription.ProviderCustomerID) == "" || strings.TrimSpace(subscription.ProviderSubscriptionID) == "" {
		return CustomerPortalResult{}, fmt.Errorf("paddle customer portal is not ready for this subscription")
	}
	session, err := s.api.CreateCustomerPortalSession(ctx, &paddle.CreateCustomerPortalSessionRequest{
		CustomerID:      subscription.ProviderCustomerID,
		SubscriptionIDs: []string{subscription.ProviderSubscriptionID},
	})
	if err != nil {
		return CustomerPortalResult{}, fmt.Errorf("creating Paddle customer portal session: %w", err)
	}
	if session == nil || strings.TrimSpace(session.ID) == "" {
		return CustomerPortalResult{}, fmt.Errorf("paddle customer portal response missing session id")
	}
	if strings.TrimSpace(session.CustomerID) != subscription.ProviderCustomerID {
		return CustomerPortalResult{}, fmt.Errorf("paddle customer portal response customer does not match subscription")
	}
	portalURL, usedGenericFallback, err := customerPortalURL(session, subscription.ProviderSubscriptionID, purpose)
	if err != nil {
		return CustomerPortalResult{}, err
	}
	return CustomerPortalResult{
		ID: session.ID, URL: portalURL, Purpose: purpose, UsedGenericFallback: usedGenericFallback,
	}, nil
}

func normalizeCustomerPortalPurpose(purpose CustomerPortalPurpose) (CustomerPortalPurpose, error) {
	if purpose == "" {
		return CustomerPortalPurposeManage, nil
	}
	switch purpose {
	case CustomerPortalPurposeManage,
		CustomerPortalPurposeUpdatePaymentMethod,
		CustomerPortalPurposeCancelSubscription,
		CustomerPortalPurposeInvoices,
		CustomerPortalPurposeBillingDetails:
		return purpose, nil
	default:
		return "", fmt.Errorf("unsupported customer portal purpose %q", purpose)
	}
}

func customerPortalURL(session *paddle.CustomerPortalSession, subscriptionID string, purpose CustomerPortalPurpose) (string, bool, error) {
	overviewURL := strings.TrimSpace(session.URLs.General.Overview)
	if purpose == CustomerPortalPurposeManage {
		if overviewURL != "" {
			return overviewURL, false, nil
		}
		return "", false, fmt.Errorf("paddle customer portal response missing overview URL")
	}

	var matchingURL string
	if purpose == CustomerPortalPurposeUpdatePaymentMethod || purpose == CustomerPortalPurposeCancelSubscription {
		for _, links := range session.URLs.Subscriptions {
			if strings.TrimSpace(links.ID) != subscriptionID {
				continue
			}
			if matchingURL != "" {
				return "", false, fmt.Errorf("paddle customer portal response contains duplicate subscription links")
			}
			if purpose == CustomerPortalPurposeUpdatePaymentMethod {
				matchingURL = strings.TrimSpace(links.UpdateSubscriptionPaymentMethod)
			} else {
				matchingURL = strings.TrimSpace(links.CancelSubscription)
			}
		}
	}
	if matchingURL != "" {
		return matchingURL, false, nil
	}
	if overviewURL != "" {
		return overviewURL, true, nil
	}
	return "", false, fmt.Errorf("paddle customer portal response missing purpose-specific and overview URLs")
}

func (s *Service) ensureAPI() error {
	if s.apiInitErr != nil {
		return configurationError("initializing Paddle API client: %v", s.apiInitErr)
	}
	if s.api == nil {
		return configurationError("OPENPOST_PADDLE_API_KEY is required")
	}
	return nil
}

func (s *Service) planFor(planID, billingPeriod string) (string, error) {
	planID = strings.ToLower(strings.TrimSpace(planID))
	if planID == "" {
		return "", fmt.Errorf("plan id is required")
	}
	plan, ok := s.paddle.Plans[planID]
	if !ok {
		return "", fmt.Errorf("unknown billing plan %q", planID)
	}
	period := normalizeBillingPeriod(billingPeriod)
	providerPriceID := plan.PaddlePriceIDs.Monthly
	if period == "annual" {
		providerPriceID = plan.PaddlePriceIDs.Annual
	}
	if strings.TrimSpace(providerPriceID) == "" {
		return "", configurationError("%s is required for billing plan %q", paddlePriceEnvVar(planID, period), planID)
	}
	return providerPriceID, nil
}

func normalizeBillingPeriod(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "annual") || strings.EqualFold(strings.TrimSpace(value), "yearly") {
		return "annual"
	}
	return "monthly"
}

func paddlePriceEnvVar(planID, period string) string {
	return "OPENPOST_PADDLE_" + strings.ToUpper(strings.ReplaceAll(planID, "-", "_")) + "_" + strings.ToUpper(normalizeBillingPeriod(period)) + "_PRICE_ID"
}

func (s *Service) returnURL(attemptID string) string {
	value := strings.TrimSpace(s.paddle.ReturnURL)
	if value == "" {
		base := strings.TrimRight(strings.TrimSpace(s.paddle.AppURL), "/")
		if base == "" {
			return ""
		}
		value = base + "/checkout"
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	query := parsed.Query()
	query.Set("status", "success")
	query.Set("attempt", attemptID)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func normalizeCheckoutReturnPath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) > 2048 || strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("checkout return path must be a same-origin OpenPost route")
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(parsed.Path, "//") {
		return "", fmt.Errorf("checkout return path must be a same-origin OpenPost route")
	}
	return parsed.String(), nil
}

type CheckoutReturnResult struct {
	Status, ReturnPath, WorkspaceID, PlanID, BillingPeriod string
	Consumed, NewlyConsumed                                bool
}

func (s *Service) ConsumeCheckoutReturn(ctx context.Context, attemptID, userID string) (CheckoutReturnResult, error) {
	attemptID = strings.TrimSpace(attemptID)
	userID = strings.TrimSpace(userID)
	if attemptID == "" || userID == "" || s.db == nil {
		return CheckoutReturnResult{}, sql.ErrNoRows
	}
	var attempt models.BillingCheckoutAttempt
	if err := s.db.NewSelect().Model(&attempt).
		Where("checkout_attempt_id = ?", attemptID).
		Where("user_id = ?", userID).
		Where("provider = ?", ProviderPaddle).
		Scan(ctx); err != nil {
		return CheckoutReturnResult{}, err
	}
	status := strings.ToLower(strings.TrimSpace(attempt.Status))
	result := CheckoutReturnResult{
		Status: "pending", Consumed: !attempt.ReturnConsumedAt.IsZero(), WorkspaceID: attempt.WorkspaceID,
		PlanID: attempt.PlanID, BillingPeriod: attempt.BillingPeriod,
	}
	if status != "active" && status != "trialing" {
		switch status {
		case "canceled", "paused", "past_due":
			result.Status = "failed"
		}
		return result, nil
	}
	result.Status = "success"
	if result.Consumed {
		return result, nil
	}
	now := s.now().UTC()
	update, err := s.db.NewUpdate().Model((*models.BillingCheckoutAttempt)(nil)).
		Set("return_consumed_at = ?", now).
		Set("updated_at = ?", now).
		Where("checkout_attempt_id = ?", attemptID).
		Where("user_id = ?", userID).
		Where("return_consumed_at IS NULL").
		Where("LOWER(status) IN ('active', 'trialing')").
		Exec(ctx)
	if err != nil {
		return CheckoutReturnResult{}, fmt.Errorf("consuming checkout return: %w", err)
	}
	rows, _ := update.RowsAffected()
	if rows == 1 {
		result.Consumed = true
		result.NewlyConsumed = true
		result.ReturnPath = attempt.ReturnPath
		return result, nil
	}
	result.Consumed = true
	return result, nil
}

type WebhookResult struct {
	EventID   string
	EventType string
	Duplicate bool
}

type paddleEvent struct {
	EventID    string          `json:"event_id"`
	EventType  string          `json:"event_type"`
	OccurredAt string          `json:"occurred_at"`
	Data       json.RawMessage `json:"data"`
}

func (s *Service) AcceptPaddleWebhook(ctx context.Context, body []byte, signature string) (WebhookResult, error) {
	if s.verifier == nil {
		return WebhookResult{}, configurationError("OPENPOST_PADDLE_WEBHOOK_SECRET is required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/billing/paddle/webhook", bytes.NewReader(body))
	if err != nil {
		return WebhookResult{}, err
	}
	req.Header.Set("Paddle-Signature", strings.TrimSpace(signature))
	verified, err := s.verifier.Verify(req)
	if err != nil || !verified {
		if err == nil {
			err = errors.New("signature mismatch")
		}
		return WebhookResult{}, fmt.Errorf("invalid Paddle webhook signature: %w", err)
	}
	if s.db == nil {
		return WebhookResult{}, fmt.Errorf("billing database is not configured")
	}
	var event paddleEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookResult{}, fmt.Errorf("invalid webhook payload: %w", err)
	}
	if strings.TrimSpace(event.EventID) == "" || strings.TrimSpace(event.EventType) == "" {
		return WebhookResult{}, fmt.Errorf("webhook event_id and event_type are required")
	}
	occurredAt, err := parseRequiredPaddleTime("webhook occurred_at", event.OccurredAt)
	if err != nil {
		return WebhookResult{}, err
	}

	result := WebhookResult{EventID: event.EventID, EventType: event.EventType}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		inserted, err := insertWebhookEvent(txCtx, tx, event.EventID, event.EventType, occurredAt, s.now())
		if err != nil {
			return err
		}
		if !inserted {
			result.Duplicate = true
			return nil
		}
		if !eventNeedsReconciliation(event.EventType) {
			return nil
		}
		return enqueueWebhookJob(txCtx, tx, body, s.now().UTC())
	})
	return result, err
}

func enqueueWebhookJob(ctx context.Context, db bun.IDB, body []byte, runAt time.Time) error {
	job, err := jobregistry.NewJob(JobTypeWebhook, string(body), runAt)
	if err != nil {
		return err
	}
	if _, err := db.NewInsert().Model(job).Exec(ctx); err != nil {
		return fmt.Errorf("queueing Paddle webhook: %w", err)
	}
	return nil
}

func eventNeedsReconciliation(eventType string) bool {
	switch eventType {
	case "customer.created", "customer.updated",
		"subscription.created", "subscription.updated", "subscription.activated", "subscription.trialing",
		"subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.canceled",
		"transaction.completed":
		return true
	default:
		return false
	}
}

func insertWebhookEvent(
	ctx context.Context,
	tx bun.Tx,
	eventID string,
	eventType string,
	occurredAt time.Time,
	processedAt time.Time,
) (bool, error) {
	event := &models.BillingWebhookEvent{
		EventID:     eventID,
		Provider:    ProviderPaddle,
		EventType:   eventType,
		OccurredAt:  occurredAt.UTC(),
		ProcessedAt: processedAt.UTC(),
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
	if err := s.ensureAPI(); err != nil {
		return err
	}
	var event paddleEvent
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return fmt.Errorf("invalid queued Paddle webhook: %w", err)
	}
	entityID := eventEntityID(event.Data)
	switch {
	case strings.HasPrefix(event.EventType, "subscription."):
		return s.handleSubscriptionEvent(ctx, entityID)
	case event.EventType == "transaction.completed":
		return s.handleCompletedTransaction(ctx, entityID)
	case strings.HasPrefix(event.EventType, "customer."):
		if entityID == "" {
			return fmt.Errorf("paddle customer event missing entity id")
		}
		return s.reconcileCustomerByID(ctx, entityID)
	default:
		return nil
	}
}

func (s *Service) handleSubscriptionEvent(ctx context.Context, entityID string) error {
	if entityID == "" {
		return fmt.Errorf("paddle subscription event missing entity id")
	}
	subscription, err := s.api.GetSubscription(ctx, &paddle.GetSubscriptionRequest{SubscriptionID: entityID})
	if err != nil {
		return fmt.Errorf("fetching current Paddle subscription: %w", err)
	}
	return s.reconcileSubscription(ctx, subscription, nil)
}

func (s *Service) handleCompletedTransaction(ctx context.Context, entityID string) error {
	if entityID == "" {
		return fmt.Errorf("paddle transaction event missing entity id")
	}
	transaction, err := s.api.GetTransaction(ctx, &paddle.GetTransactionRequest{TransactionID: entityID})
	if err != nil {
		return fmt.Errorf("fetching current Paddle transaction: %w", err)
	}
	if transaction.SubscriptionID != nil && strings.TrimSpace(*transaction.SubscriptionID) != "" {
		subscription, err := s.api.GetSubscription(ctx, &paddle.GetSubscriptionRequest{SubscriptionID: *transaction.SubscriptionID})
		if err != nil {
			return fmt.Errorf("fetching Paddle subscription for transaction: %w", err)
		}
		return s.reconcileSubscription(ctx, subscription, transaction.CustomData)
	}
	if transaction.CustomerID != nil {
		return s.reconcileCustomerByID(ctx, *transaction.CustomerID)
	}
	return nil
}

func eventEntityID(data json.RawMessage) string {
	var entity struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(data, &entity) != nil {
		return ""
	}
	return strings.TrimSpace(entity.ID)
}

func (s *Service) reconcileCustomerByID(ctx context.Context, customerID string) error {
	customer, err := s.api.GetCustomer(ctx, &paddle.GetCustomerRequest{CustomerID: customerID})
	if err != nil {
		return fmt.Errorf("fetching current Paddle customer: %w", err)
	}
	return s.upsertCustomer(ctx, customer)
}

func (s *Service) upsertCustomer(ctx context.Context, customer *paddle.Customer) error {
	if customer == nil || strings.TrimSpace(customer.ID) == "" {
		return fmt.Errorf("paddle customer payload missing id")
	}
	name := ""
	if customer.Name != nil {
		name = strings.TrimSpace(*customer.Name)
	}
	raw, _ := json.Marshal(customer)
	now := s.now().UTC()
	model := &models.BillingCustomer{
		Provider:           ProviderPaddle,
		ProviderCustomerID: customer.ID,
		Email:              strings.TrimSpace(customer.Email),
		Name:               name,
		RawPayload:         string(raw),
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	_, err := s.db.NewInsert().Model(model).
		On("CONFLICT (provider, provider_customer_id) DO UPDATE").
		Set("email = EXCLUDED.email").
		Set("name = EXCLUDED.name").
		Set("raw_payload = EXCLUDED.raw_payload").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("upserting Paddle customer: %w", err)
	}
	return nil
}

type resolvedPaddleSubscription struct {
	Attempt   models.BillingCheckoutAttempt
	Plan      PlanConfig
	PlanID    string
	PriceID   string
	ProductID string
}

func (s *Service) resolvePaddleSubscription(ctx context.Context, subscription *paddle.Subscription, fallbackCustom paddle.CustomData) (resolvedPaddleSubscription, error) {
	customData := subscription.CustomData
	if len(customData) == 0 {
		customData = fallbackCustom
	}
	attempt, err := s.checkoutAttempt(ctx, customDataString(customData, "checkout_id"))
	if err != nil {
		return resolvedPaddleSubscription{}, err
	}
	if attempt.OrganizationID == "" {
		attempt, err = s.checkoutAttemptForSubscription(ctx, subscription.ID)
		if err != nil {
			return resolvedPaddleSubscription{}, err
		}
	}
	priceID, productID := subscriptionCatalogIDs(subscription)
	planID := attempt.PlanID
	if planID == "" {
		planID = s.planIDForProviderPrice(priceID)
	}
	if attempt.OrganizationID == "" {
		return resolvedPaddleSubscription{}, fmt.Errorf("paddle subscription missing a valid OpenPost checkout_id")
	}
	plan, ok := s.paddle.Plans[planID]
	if !ok {
		return resolvedPaddleSubscription{}, fmt.Errorf("paddle subscription references unknown OpenPost plan %q", planID)
	}
	return resolvedPaddleSubscription{
		Attempt:   attempt,
		Plan:      plan,
		PlanID:    planID,
		PriceID:   priceID,
		ProductID: productID,
	}, nil
}

func (s *Service) reconcileSubscription(ctx context.Context, subscription *paddle.Subscription, fallbackCustom paddle.CustomData) error {
	if subscription == nil || strings.TrimSpace(subscription.ID) == "" {
		return fmt.Errorf("paddle subscription payload missing id")
	}
	providerUpdatedAt, err := parseRequiredPaddleTime("paddle subscription updated_at", subscription.UpdatedAt)
	if err != nil {
		return err
	}
	resolved, err := s.resolvePaddleSubscription(ctx, subscription, fallbackCustom)
	if err != nil {
		return err
	}

	if strings.TrimSpace(subscription.CustomerID) != "" {
		if err := s.reconcileCustomerByID(ctx, subscription.CustomerID); err != nil {
			return err
		}
	}
	status := strings.ToLower(string(subscription.Status))
	periodEnd := time.Time{}
	if subscription.CurrentBillingPeriod != nil {
		periodEnd = parsePaddleTime(subscription.CurrentBillingPeriod.EndsAt)
	}
	cancelAtPeriodEnd := status != string(paddle.SubscriptionStatusCanceled) &&
		subscription.ScheduledChange != nil && subscription.ScheduledChange.Action == paddle.ScheduledChangeActionCancel
	now := s.now().UTC()
	raw, _ := json.Marshal(subscription)
	snapshot, _ := json.Marshal(map[string]any{
		"provider":   ProviderPaddle,
		"plan_id":    resolved.PlanID,
		"status":     status,
		"product_id": resolved.ProductID,
		"price_id":   resolved.PriceID,
		"limits":     resolved.Plan.Limits,
	})
	model := &models.BillingSubscription{
		OrganizationID:         resolved.Attempt.OrganizationID,
		WorkspaceID:            resolved.Attempt.WorkspaceID,
		Provider:               ProviderPaddle,
		ProviderCustomerID:     subscription.CustomerID,
		ProviderSubscriptionID: subscription.ID,
		ProviderProductID:      resolved.ProductID,
		ProviderPriceID:        resolved.PriceID,
		Status:                 status,
		PlanID:                 resolved.PlanID,
		EntitlementSnapshot:    string(snapshot),
		CurrentPeriodEnd:       periodEnd,
		CancelAtPeriodEnd:      cancelAtPeriodEnd,
		ProviderUpdatedAt:      providerUpdatedAt,
		RawPayload:             string(raw),
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	if status == string(paddle.SubscriptionStatusPastDue) {
		model.PastDueSince = providerUpdatedAt
	}

	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		applied, err := upsertSubscription(txCtx, tx, model)
		if err != nil {
			return err
		}
		if applied && resolved.Attempt.CheckoutAttemptID != "" {
			if _, err := tx.NewUpdate().Model((*models.BillingCheckoutAttempt)(nil)).
				Set("status = ?", status).
				Set("provider_subscription_id = ?", subscription.ID).
				Set("updated_at = ?", now).
				Where("checkout_attempt_id = ?", resolved.Attempt.CheckoutAttemptID).
				Exec(txCtx); err != nil {
				return fmt.Errorf("updating Paddle checkout attempt: %w", err)
			}
		}
		return nil
	})
}

func subscriptionCatalogIDs(subscription *paddle.Subscription) (string, string) {
	for _, item := range subscription.Items {
		if item.Recurring {
			return item.Price.ID, item.Price.ProductID
		}
	}
	if len(subscription.Items) > 0 {
		return subscription.Items[0].Price.ID, subscription.Items[0].Price.ProductID
	}
	return "", ""
}

func customDataString(data paddle.CustomData, key string) string {
	value, ok := data[key]
	if !ok {
		return ""
	}
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func (s *Service) checkoutAttempt(ctx context.Context, attemptID string) (models.BillingCheckoutAttempt, error) {
	var attempt models.BillingCheckoutAttempt
	if strings.TrimSpace(attemptID) == "" {
		return attempt, nil
	}
	err := s.db.NewSelect().Model(&attempt).
		Where("checkout_attempt_id = ?", attemptID).
		Where("provider = ?", ProviderPaddle).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.BillingCheckoutAttempt{}, nil
	}
	if err != nil {
		return models.BillingCheckoutAttempt{}, fmt.Errorf("loading Paddle checkout attempt: %w", err)
	}
	return attempt, nil
}

func (s *Service) checkoutAttemptForSubscription(ctx context.Context, subscriptionID string) (models.BillingCheckoutAttempt, error) {
	var attempt models.BillingCheckoutAttempt
	err := s.db.NewSelect().Model(&attempt).
		Where("provider = ?", ProviderPaddle).
		Where("provider_subscription_id = ?", subscriptionID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.BillingCheckoutAttempt{}, nil
	}
	if err != nil {
		return models.BillingCheckoutAttempt{}, fmt.Errorf("loading Paddle checkout attempt by subscription: %w", err)
	}
	return attempt, nil
}

func (s *Service) planIDForProviderPrice(providerPriceID string) string {
	for planID, plan := range s.paddle.Plans {
		if providerPriceID == plan.PaddlePriceIDs.Monthly || providerPriceID == plan.PaddlePriceIDs.Annual {
			return planID
		}
	}
	return ""
}

func upsertSubscription(ctx context.Context, tx bun.Tx, subscription *models.BillingSubscription) (bool, error) {
	targetPrefix := ""
	switch tx.Dialect().Name() {
	case dialect.SQLite:
	case dialect.PG:
		targetPrefix = "billing_subscription."
	default:
		return false, fmt.Errorf("unsupported billing database dialect %s", tx.Dialect().Name())
	}
	pastDueExpression := fmt.Sprintf(`past_due_since = CASE
		WHEN EXCLUDED.status = 'past_due' THEN
			CASE
				WHEN LOWER(%[1]sstatus) = 'past_due'
					AND %[1]spast_due_since IS NOT NULL
				THEN %[1]spast_due_since
				ELSE EXCLUDED.provider_updated_at
			END
		ELSE NULL
	END`, targetPrefix)
	versionPredicate := fmt.Sprintf("%[1]sprovider_updated_at IS NULL OR %[1]sprovider_updated_at < EXCLUDED.provider_updated_at", targetPrefix)

	result, err := tx.NewInsert().Model(subscription).
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
		Set("provider_updated_at = EXCLUDED.provider_updated_at").
		Set(pastDueExpression).
		Set("raw_payload = EXCLUDED.raw_payload").
		Set("updated_at = EXCLUDED.updated_at").
		Where(versionPredicate).
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("upserting billing subscription: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("checking billing subscription reconciliation result: %w", err)
	}
	if rows > 0 {
		return true, nil
	}
	if err := validateSkippedSubscriptionSnapshot(ctx, tx, subscription); err != nil {
		return false, err
	}
	return false, nil
}

func validateSkippedSubscriptionSnapshot(ctx context.Context, tx bun.Tx, incoming *models.BillingSubscription) error {
	var current models.BillingSubscription
	if err := tx.NewSelect().
		Model(&current).
		Where("organization_id = ?", incoming.OrganizationID).
		Scan(ctx); err != nil {
		return fmt.Errorf("loading current billing subscription after skipped reconciliation: %w", err)
	}
	if current.ProviderUpdatedAt.Equal(incoming.ProviderUpdatedAt) && !sameSubscriptionSnapshot(current, *incoming) {
		return fmt.Errorf("conflicting Paddle subscription snapshots share updated_at %s", incoming.ProviderUpdatedAt.Format(time.RFC3339Nano))
	}
	return nil
}

func sameSubscriptionSnapshot(current, incoming models.BillingSubscription) bool {
	return current.OrganizationID == incoming.OrganizationID &&
		current.WorkspaceID == incoming.WorkspaceID &&
		current.Provider == incoming.Provider &&
		current.ProviderCustomerID == incoming.ProviderCustomerID &&
		current.ProviderSubscriptionID == incoming.ProviderSubscriptionID &&
		current.ProviderProductID == incoming.ProviderProductID &&
		current.ProviderPriceID == incoming.ProviderPriceID &&
		current.Status == incoming.Status &&
		current.PlanID == incoming.PlanID &&
		current.EntitlementSnapshot == incoming.EntitlementSnapshot &&
		current.CurrentPeriodEnd.Equal(incoming.CurrentPeriodEnd) &&
		current.CancelAtPeriodEnd == incoming.CancelAtPeriodEnd
}

func parsePaddleTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func parseRequiredPaddleTime(field, value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be a valid RFC3339 timestamp", field)
	}
	return parsed.UTC(), nil
}
