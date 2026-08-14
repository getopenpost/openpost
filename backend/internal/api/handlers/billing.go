package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/billing"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

type BillingHandler struct {
	billing   *billing.Service
	db        *bun.DB
	auth      middleware.Authenticator
	usage     *usage.Service
	telemetry telemetry.Recorder
}

const (
	purchaseChoiceMissingProblem  = "urn:openpost:problem:purchase-choice:missing"
	purchaseChoiceInvalidProblem  = "urn:openpost:problem:purchase-choice:invalid"
	purchaseChoiceExpiredProblem  = "urn:openpost:problem:purchase-choice:expired"
	purchaseChoiceMismatchProblem = "urn:openpost:problem:purchase-choice:mismatch"
)

func NewBillingHandler(billingService *billing.Service, deps ...any) *BillingHandler {
	handler := &BillingHandler{billing: billingService}
	if len(deps) > 0 {
		if db, ok := deps[0].(*bun.DB); ok {
			handler.db = db
			handler.usage = usage.NewService(db)
		}
	}
	if len(deps) > 1 {
		if auth, ok := deps[1].(middleware.Authenticator); ok {
			handler.auth = auth
		}
	}
	return handler
}

func (h *BillingHandler) SetUsage(service *usage.Service) {
	if service != nil {
		h.usage = service
	}
}

func (h *BillingHandler) SetTelemetry(recorder telemetry.Recorder) {
	h.telemetry = recorder
}

type PaddleWebhookOutput struct {
	OK        bool   `json:"ok"`
	Duplicate bool   `json:"duplicate"`
	EventID   string `json:"event_id"`
	EventType string `json:"event_type"`
}

func (h *BillingHandler) RegisterRoutes(e *echo.Echo) {
	e.POST("/api/v1/billing/paddle/webhook", h.handlePaddleWebhook)
}

func (h *BillingHandler) RegisterAPIRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-purchase-choice",
		Method:      http.MethodPost,
		Path:        "/billing/purchase-choice",
		Summary:     "Create or validate a hosted plan purchase choice",
		Description: "Returns canonical plan, price, trial, payment, and expiry facts in an integrity-protected continuation token.",
		Tags:        []string{"Billing"},
		Errors:      []int{400, 503},
	}, h.createPurchaseChoice)

	huma.Register(api, huma.Operation{
		OperationID: "confirm-first-workspace-purchase",
		Method:      http.MethodPost,
		Path:        "/billing/welcome",
		Summary:     "Confirm the first workspace and purchase",
		Description: "Creates the signed-in Owner's first Workspace and one checkout attempt bound to the confirmed purchase choice. Exact retries resume the same attempt.",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 409, 503},
	}, h.confirmFirstWorkspacePurchase)

	huma.Register(api, huma.Operation{
		OperationID: "get-billing-status",
		Method:      http.MethodGet,
		Path:        "/billing/status",
		Summary:     "Get billing status",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.getStatus)

	huma.Register(api, huma.Operation{
		OperationID: "create-billing-checkout",
		Method:      http.MethodPost,
		Path:        "/billing/checkout",
		Summary:     "Create billing checkout",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 503},
	}, h.createCheckout)

	huma.Register(api, huma.Operation{
		OperationID: "resume-billing-checkout",
		Method:      http.MethodGet,
		Path:        "/billing/checkout/{attempt_id}",
		Summary:     "Resume a billing checkout",
		Description: "Returns the browser-safe checkout configuration only when the attempt belongs to the signed-in user.",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404, 503},
	}, h.resumeCheckout)

	huma.Register(api, huma.Operation{
		OperationID: "consume-billing-checkout-return",
		Method:      http.MethodGet,
		Path:        "/billing/checkout/{attempt_id}/return",
		Summary:     "Confirm and consume a billing checkout return",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404, 500},
	}, h.consumeCheckoutReturn)

	huma.Register(api, huma.Operation{
		OperationID: "create-billing-portal-session",
		Method:      http.MethodPost,
		Path:        "/billing/portal",
		Summary:     "Create billing portal session",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 503},
	}, h.createPortalSession)

	huma.Register(api, huma.Operation{
		OperationID: "get-organization-billing-status",
		Method:      http.MethodGet,
		Path:        "/organizations/{id}/billing/status",
		Summary:     "Get organization billing status",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.getOrganizationStatus)

	huma.Register(api, huma.Operation{
		OperationID: "create-organization-billing-checkout",
		Method:      http.MethodPost,
		Path:        "/organizations/{id}/billing/checkout",
		Summary:     "Create organization billing checkout",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 503},
	}, h.createOrganizationCheckout)

	huma.Register(api, huma.Operation{
		OperationID: "create-organization-billing-portal-session",
		Method:      http.MethodPost,
		Path:        "/organizations/{id}/billing/portal",
		Summary:     "Create organization billing portal session",
		Tags:        []string{"Billing"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 503},
	}, h.createOrganizationPortalSession)
}

type CreatePurchaseChoiceInput struct {
	Body struct {
		PlanID              string `json:"plan_id" doc:"Canonical hosted plan ID: starter, founder, pro, team, or agency"`
		BillingPeriod       string `json:"billing_period" enum:"monthly,annual" doc:"Canonical billing period"`
		PurchaseChoiceToken string `json:"purchase_choice_token,omitempty" doc:"Existing integrity-protected choice to validate against the supplied plan and period"`
	}
}

type PurchaseChoiceResponse struct {
	Token          string `json:"token" doc:"Integrity-protected purchase choice continuation token"`
	PlanID         string `json:"plan_id" doc:"Canonical hosted plan ID"`
	PlanName       string `json:"plan_name" doc:"Canonical hosted plan name"`
	BillingPeriod  string `json:"billing_period" enum:"monthly,annual" doc:"Canonical billing period"`
	ListPriceUSD   int    `json:"list_price_usd" doc:"Full-period canonical USD list price"`
	TrialDays      int    `json:"trial_days" doc:"Trial length in calendar days"`
	CardRequired   bool   `json:"card_required" doc:"Whether checkout requires a payment card for the trial"`
	DueTodayUSD    int    `json:"due_today_usd" doc:"Canonical USD amount due when the trial starts"`
	CatalogVersion string `json:"catalog_version" doc:"Canonical plan catalogue revision bound to the choice"`
	ExpiresAt      string `json:"expires_at" format:"date-time" doc:"When this purchase choice must be replaced"`
}

type ConfirmFirstWorkspacePurchaseInput struct {
	Body struct {
		WorkspaceName       string `json:"workspace_name" minLength:"1" maxLength:"100" doc:"Name for the first Workspace"`
		PlanID              string `json:"plan_id" doc:"Canonical hosted plan ID"`
		BillingPeriod       string `json:"billing_period" enum:"monthly,annual" doc:"Canonical billing period"`
		PurchaseChoiceToken string `json:"purchase_choice_token" minLength:"1" doc:"Integrity-protected purchase choice carried through signup"`
		ReturnPath          string `json:"return_path,omitempty" maxLength:"2048" doc:"Validated same-origin route to resume after checkout"`
	}
}

type ConfirmFirstWorkspacePurchaseOutput struct {
	Body struct {
		WorkspaceID    string             `json:"workspace_id"`
		OrganizationID string             `json:"organization_id"`
		WorkspaceName  string             `json:"workspace_name"`
		Checkout       BillingURLResponse `json:"checkout"`
	}
}

func (h *BillingHandler) confirmFirstWorkspacePurchase(ctx context.Context, input *ConfirmFirstWorkspacePurchaseInput) (*ConfirmFirstWorkspacePurchaseOutput, error) {
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	userID := middleware.GetUserID(ctx)
	workspaceName := strings.TrimSpace(input.Body.WorkspaceName)
	if workspaceName == "" {
		return nil, huma.Error400BadRequest("workspace name is required")
	}
	choice, err := h.billing.ResolvePurchaseChoice(input.Body.PurchaseChoiceToken, input.Body.PlanID, input.Body.BillingPeriod)
	if err != nil {
		return nil, purchaseChoiceAPIError(err)
	}
	email, err := h.userEmail(ctx, userID)
	if err != nil {
		return nil, err
	}
	confirmationKey := fmt.Sprintf("%x", sha256.Sum256([]byte(userID+"\x00"+choice.Token)))
	confirmation, err := h.billing.ConfirmFirstWorkspace(ctx, billing.ConfirmFirstWorkspaceInput{
		UserID: userID, CustomerEmail: email, WorkspaceName: workspaceName,
		ReturnPath: input.Body.ReturnPath, ConfirmationKey: confirmationKey, Choice: choice,
	})
	if err != nil {
		switch {
		case errors.Is(err, billing.ErrFirstWorkspaceExists), errors.Is(err, billing.ErrWelcomeConfirmationReplay):
			return nil, huma.Error409Conflict(err.Error())
		case errors.Is(err, billing.ErrOrganizationMemberExists):
			return nil, huma.Error403Forbidden(err.Error())
		}
		return nil, billingAPIError(err)
	}
	if confirmation.Created {
		h.captureFirstWorkspaceConfirmed(ctx, userID, confirmation, choice)
		h.captureCheckoutCreated(ctx, userID, confirmation.OrganizationID, confirmation.Workspace.ID, confirmation.Checkout)
	}
	output := &ConfirmFirstWorkspacePurchaseOutput{}
	output.Body.WorkspaceID = confirmation.Workspace.ID
	output.Body.OrganizationID = confirmation.OrganizationID
	output.Body.WorkspaceName = confirmation.Workspace.Name
	output.Body.Checkout = checkoutResponse(confirmation.Checkout)
	return output, nil
}

func (h *BillingHandler) captureFirstWorkspaceConfirmed(
	ctx context.Context,
	userID string,
	confirmation billing.FirstWorkspaceConfirmation,
	choice billing.PurchaseChoice,
) {
	if h.telemetry == nil {
		return
	}
	for _, event := range []telemetry.Event{
		{Name: telemetry.EventPlanConfirmed, DistinctID: userID, WorkspaceID: confirmation.Workspace.ID, Properties: map[string]any{
			"plan_id": choice.PlanID, "billing_period": choice.BillingPeriod,
		}},
		{Name: telemetry.EventWorkspaceCreated, DistinctID: userID, WorkspaceID: confirmation.Workspace.ID},
	} {
		if err := h.telemetry.Capture(ctx, event); err != nil {
			log.Printf("Failed to enqueue first Workspace telemetry: %v", err)
		}
	}
}

type PurchaseChoiceOutput struct {
	Body PurchaseChoiceResponse
}

func (h *BillingHandler) createPurchaseChoice(_ context.Context, input *CreatePurchaseChoiceInput) (*PurchaseChoiceOutput, error) {
	if h.billing == nil {
		return nil, huma.Error503ServiceUnavailable("purchase choices are not configured for this instance")
	}
	var (
		choice billing.PurchaseChoice
		err    error
	)
	if strings.TrimSpace(input.Body.PurchaseChoiceToken) == "" {
		choice, err = h.billing.CreatePurchaseChoice(input.Body.PlanID, input.Body.BillingPeriod)
	} else {
		choice, err = h.billing.ResolvePurchaseChoice(
			input.Body.PurchaseChoiceToken,
			input.Body.PlanID,
			input.Body.BillingPeriod,
		)
	}
	if err != nil {
		return nil, purchaseChoiceAPIError(err)
	}
	return &PurchaseChoiceOutput{Body: purchaseChoiceResponse(choice)}, nil
}

func purchaseChoiceAPIError(err error) error {
	problemType := purchaseChoiceInvalidProblem
	switch {
	case errors.Is(err, billing.ErrPurchaseChoiceMissing):
		problemType = purchaseChoiceMissingProblem
	case errors.Is(err, billing.ErrPurchaseChoiceExpired):
		problemType = purchaseChoiceExpiredProblem
	case errors.Is(err, billing.ErrPurchaseChoiceMismatch):
		problemType = purchaseChoiceMismatchProblem
	}
	return &huma.ErrorModel{
		Type:   problemType,
		Title:  "Invalid purchase choice",
		Status: http.StatusBadRequest,
		Detail: err.Error(),
	}
}

func purchaseChoiceResponse(choice billing.PurchaseChoice) PurchaseChoiceResponse {
	return PurchaseChoiceResponse{
		Token:          choice.Token,
		PlanID:         choice.PlanID,
		PlanName:       choice.PlanName,
		BillingPeriod:  choice.BillingPeriod,
		ListPriceUSD:   choice.ListPriceUSD,
		TrialDays:      choice.TrialDays,
		CardRequired:   choice.CardRequired,
		DueTodayUSD:    choice.DueTodayUSD,
		CatalogVersion: choice.CatalogVersion,
		ExpiresAt:      choice.ExpiresAt.Format(time.RFC3339),
	}
}

func (h *BillingHandler) handlePaddleWebhook(c echo.Context) error {
	if h.billing == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "billing service is not configured"})
	}
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to read webhook body"})
	}
	result, err := h.billing.AcceptPaddleWebhook(c.Request().Context(), body, c.Request().Header.Get("Paddle-Signature"))
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: err.Error()})
	}

	return c.JSON(http.StatusOK, PaddleWebhookOutput{
		OK:        true,
		Duplicate: result.Duplicate,
		EventID:   result.EventID,
		EventType: result.EventType,
	})
}

type GetBillingStatusInput struct {
	WorkspaceID    string `query:"workspace_id" doc:"Workspace ID"`
	OrganizationID string `query:"organization_id" doc:"Organization ID"`
}

type BillingStatusResponse struct {
	OrganizationID      string                      `json:"organization_id" doc:"Organization ID"`
	WorkspaceID         string                      `json:"workspace_id" doc:"Workspace ID"`
	Provider            string                      `json:"provider,omitempty" doc:"Billing provider"`
	Status              string                      `json:"status,omitempty" doc:"Subscription status from the latest Paddle snapshot"`
	CanManageBilling    bool                        `json:"can_manage_billing" doc:"Whether the current user may manage organization billing"`
	AccessRestricted    bool                        `json:"access_restricted" doc:"Whether failed payment currently restricts paid-plan access"`
	PastDueSince        string                      `json:"past_due_since,omitempty" doc:"Canonical Paddle time when the current past-due state began"`
	PlanID              string                      `json:"plan_id,omitempty" doc:"Plan ID"`
	CurrentPeriodEnd    string                      `json:"current_period_end,omitempty" doc:"Current billing period end"`
	CancelAtPeriodEnd   bool                        `json:"cancel_at_period_end" doc:"Whether the subscription cancels at period end"`
	Limits              map[string]int64            `json:"limits,omitempty" doc:"Entitlement limits from the local subscription snapshot"`
	Usage               map[string]int64            `json:"usage,omitempty" doc:"Current-month product usage counters for a mirrored subscription"`
	PeriodStart         string                      `json:"period_start,omitempty" doc:"UTC month start for the usage counters"`
	ProviderCosts       []usage.ProviderCostSummary `json:"provider_costs" doc:"Confirmed hosted provider-cost estimates and unresolved reservations, separate from the product subscription"`
	BillingContactEmail string                      `json:"billing_contact_email,omitempty" doc:"Billing contact email from the latest Paddle customer snapshot"`
}

type BillingStatusOutput struct {
	Body BillingStatusResponse
}

func (h *BillingHandler) getStatus(ctx context.Context, input *GetBillingStatusInput) (*BillingStatusOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	organizationID, workspaceID, err := h.resolveBillingScope(ctx, input.OrganizationID, input.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.OrganizationID) == "" {
		if err := h.checkOrganizationCredentialAccess(ctx, organizationID, userID); err != nil {
			return nil, err
		}
	}
	return h.billingStatusForOrganization(ctx, organizationID, workspaceID, userID)
}

type GetOrganizationBillingStatusInput struct {
	PathID string `path:"id" doc:"Organization ID"`
}

func (h *BillingHandler) getOrganizationStatus(ctx context.Context, input *GetOrganizationBillingStatusInput) (*BillingStatusOutput, error) {
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	userID := middleware.GetUserID(ctx)
	if err := h.checkOrganizationAccess(ctx, input.PathID, userID, false); err != nil {
		return nil, err
	}
	return h.billingStatusForOrganization(ctx, input.PathID, "", userID)
}

func (h *BillingHandler) billingStatusForOrganization(
	ctx context.Context,
	organizationID string,
	workspaceID string,
	userID string,
) (*BillingStatusOutput, error) {
	now := time.Now().UTC()
	usageSnapshot, providerCosts, err := h.billingUsageForScope(ctx, organizationID, workspaceID, now)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load billing usage")
	}
	canManageBilling, err := h.canManageOrganizationBilling(ctx, organizationID, userID)
	if err != nil {
		return nil, err
	}
	response := BillingStatusResponse{
		OrganizationID:   organizationID,
		WorkspaceID:      workspaceID,
		CanManageBilling: canManageBilling,
		ProviderCosts:    providerCosts,
	}

	var sub models.BillingSubscription
	err = h.db.NewSelect().
		Model(&sub).
		Where("organization_id = ?", organizationID).
		Where("provider = ?", models.BillingProviderPaddle).
		Scan(ctx)
	if err == sql.ErrNoRows && workspaceID != "" {
		err = h.db.NewSelect().
			Model(&sub).
			Where("workspace_id = ?", workspaceID).
			Where("provider = ?", models.BillingProviderPaddle).
			Scan(ctx)
	}
	if err == sql.ErrNoRows {
		return &BillingStatusOutput{Body: response}, nil
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load billing subscription")
	}

	response.Provider = sub.Provider
	response.Status = sub.Status
	response.Usage = usageSnapshotToStrings(usageSnapshot)
	response.PeriodStart = usage.MonthStart(now).Format(time.RFC3339)
	response.AccessRestricted = strings.EqualFold(sub.Status, "past_due")
	response.PlanID = sub.PlanID
	response.CancelAtPeriodEnd = sub.CancelAtPeriodEnd
	if !sub.PastDueSince.IsZero() {
		response.PastDueSince = sub.PastDueSince.UTC().Format(time.RFC3339)
	}
	if !sub.CurrentPeriodEnd.IsZero() {
		response.CurrentPeriodEnd = sub.CurrentPeriodEnd.UTC().Format(time.RFC3339)
	}
	limits, err := limitsFromSnapshot(sub.EntitlementSnapshot)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to parse billing entitlements")
	}
	response.Limits = limits
	var billingContactEmail string
	err = h.db.NewSelect().
		Model((*models.BillingCustomer)(nil)).
		Column("email").
		Where("provider = ?", sub.Provider).
		Where("provider_customer_id = ?", sub.ProviderCustomerID).
		Scan(ctx, &billingContactEmail)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error500InternalServerError("failed to load Paddle billing contact")
	}
	if err == nil {
		response.BillingContactEmail = strings.TrimSpace(billingContactEmail)
	}
	return &BillingStatusOutput{Body: response}, nil
}

func (h *BillingHandler) billingUsageForScope(ctx context.Context, organizationID, workspaceID string, now time.Time) (map[entitlements.LimitKey]int64, []usage.ProviderCostSummary, error) {
	usageSnapshot, err := h.usage.SnapshotOrganizationMonthly(ctx, organizationID, now)
	if err != nil {
		return nil, nil, err
	}
	providerCosts, err := h.usage.SnapshotOrganizationProviderCosts(ctx, organizationID, now)
	if err != nil || workspaceID == "" {
		return usageSnapshot, providerCosts, err
	}
	var workspaceOrganizationID string
	err = h.db.NewSelect().
		Table("workspaces").
		Column("organization_id").
		Where("id = ?", workspaceID).
		Scan(ctx, &workspaceOrganizationID)
	if err == sql.ErrNoRows || strings.TrimSpace(workspaceOrganizationID) == organizationID {
		return usageSnapshot, providerCosts, nil
	}
	if err != nil {
		return nil, nil, err
	}
	workspaceUsage, err := h.usage.SnapshotMonthly(ctx, workspaceID, now)
	if err != nil {
		return nil, nil, err
	}
	for metric, value := range workspaceUsage {
		usageSnapshot[metric] += value
	}
	workspaceCosts, err := h.usage.SnapshotProviderCosts(ctx, workspaceID, now)
	if err != nil {
		return nil, nil, err
	}
	return usageSnapshot, mergeProviderCostSummaries(providerCosts, workspaceCosts), nil
}

func mergeProviderCostSummaries(base, extra []usage.ProviderCostSummary) []usage.ProviderCostSummary {
	merged := append([]usage.ProviderCostSummary(nil), base...)
	providerIndex := make(map[string]int, len(merged))
	for index := range merged {
		providerIndex[merged[index].Provider] = index
	}
	for _, addition := range extra {
		index, found := providerIndex[addition.Provider]
		if !found {
			providerIndex[addition.Provider] = len(merged)
			merged = append(merged, addition)
			continue
		}
		target := &merged[index]
		target.EventCount += addition.EventCount
		target.Units += addition.Units
		target.CostMicrousd += addition.CostMicrousd
		target.ReservedEventCount += addition.ReservedEventCount
		target.ReservedUnits += addition.ReservedUnits
		target.ReservedMicrousd += addition.ReservedMicrousd
		target.BudgetMicrousd += addition.BudgetMicrousd
		operationIndex := make(map[string]int, len(target.Operations))
		for operationIndexValue := range target.Operations {
			operationIndex[target.Operations[operationIndexValue].Operation] = operationIndexValue
		}
		for _, operationAddition := range addition.Operations {
			operationIndexValue, operationFound := operationIndex[operationAddition.Operation]
			if !operationFound {
				target.Operations = append(target.Operations, operationAddition)
				continue
			}
			operationTarget := &target.Operations[operationIndexValue]
			operationTarget.EventCount += operationAddition.EventCount
			operationTarget.Units += operationAddition.Units
			operationTarget.CostMicrousd += operationAddition.CostMicrousd
			operationTarget.ReservedEventCount += operationAddition.ReservedEventCount
			operationTarget.ReservedUnits += operationAddition.ReservedUnits
			operationTarget.ReservedMicrousd += operationAddition.ReservedMicrousd
		}
	}
	return merged
}

type CreateBillingCheckoutInput struct {
	Body struct {
		WorkspaceID    string `json:"workspace_id,omitempty" doc:"Workspace ID"`
		OrganizationID string `json:"organization_id,omitempty" doc:"Organization ID"`
		PlanID         string `json:"plan_id" doc:"Plan ID: starter, founder, pro, team, or agency"`
		BillingPeriod  string `json:"billing_period,omitempty" doc:"Billing period: monthly or annual" enum:"monthly,annual" default:"monthly"`
		ReturnPath     string `json:"return_path,omitempty" maxLength:"2048" doc:"Validated same-origin route to resume once this exact checkout succeeds"`
	}
}

type BillingURLResponse struct {
	URL                 string            `json:"url,omitempty" doc:"OpenPost checkout URL or short-lived Paddle customer portal URL"`
	ID                  string            `json:"id,omitempty" doc:"OpenPost checkout attempt or Paddle portal session ID"`
	ProviderPriceID     string            `json:"provider_price_id,omitempty" doc:"Paddle price ID for the selected plan and period"`
	PriceIDs            map[string]string `json:"price_ids,omitempty" doc:"Paddle price IDs for localized previews in the selected billing period"`
	PlanID              string            `json:"plan_id,omitempty" doc:"OpenPost plan ID"`
	BillingPeriod       string            `json:"billing_period,omitempty" doc:"Selected billing period"`
	TrialEndsAt         string            `json:"trial_ends_at,omitempty" doc:"Expected end of the 14-day trial"`
	ReturnURL           string            `json:"return_url,omitempty" doc:"OpenPost URL used after Paddle checkout completes"`
	ClientToken         string            `json:"client_token,omitempty" doc:"Browser-safe Paddle.js client token"`
	Environment         string            `json:"environment,omitempty" doc:"Explicit Paddle.js environment: sandbox or production"`
	CustomerEmail       string            `json:"customer_email,omitempty" doc:"Authenticated customer's checkout email"`
	WorkspaceID         string            `json:"workspace_id,omitempty" doc:"Workspace bound to this checkout attempt"`
	Purpose             string            `json:"purpose,omitempty" doc:"Requested Paddle portal destination"`
	UsedGenericFallback *bool             `json:"used_generic_fallback,omitempty" doc:"Whether Paddle omitted the purpose-specific link and OpenPost returned the generic portal"`
}

type ResumeBillingCheckoutInput struct {
	AttemptID string `path:"attempt_id" doc:"Opaque OpenPost checkout attempt ID"`
}

func (h *BillingHandler) resumeCheckout(ctx context.Context, input *ResumeBillingCheckoutInput) (*BillingURLOutput, error) {
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	userID := middleware.GetUserID(ctx)
	email, err := h.userEmail(ctx, userID)
	if err != nil {
		return nil, err
	}
	result, _, err := h.billing.ResumeCheckout(ctx, h.db, input.AttemptID, userID, email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("checkout attempt not found")
	}
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: checkoutResponse(result)}, nil
}

type BillingURLOutput struct {
	Body BillingURLResponse
}

func (h *BillingHandler) createCheckout(ctx context.Context, input *CreateBillingCheckoutInput) (*BillingURLOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	organizationID, workspaceID, err := h.resolveBillingScope(ctx, input.Body.OrganizationID, input.Body.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	if workspaceID != "" {
		allowed, accessErr := middleware.CheckWorkspaceAdminAccess(ctx, h.db, workspaceID, userID)
		if accessErr != nil {
			return nil, huma.Error500InternalServerError("failed to check workspace admin access")
		}
		if !allowed {
			return nil, huma.Error403Forbidden("workspace admin role required")
		}
	}
	if err := h.checkOrganizationAccess(ctx, organizationID, userID, true); err != nil {
		return nil, err
	}
	email, err := h.userEmail(ctx, userID)
	if err != nil {
		return nil, err
	}

	result, err := h.billing.CreateCheckout(ctx, billing.CreateCheckoutInput{
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		UserID:         userID,
		CustomerEmail:  email,
		PlanID:         input.Body.PlanID,
		BillingPeriod:  input.Body.BillingPeriod,
		ReturnPath:     input.Body.ReturnPath,
	})
	if err != nil {
		return nil, billingAPIError(err)
	}
	h.captureCheckoutCreated(ctx, userID, organizationID, workspaceID, result)
	return &BillingURLOutput{Body: checkoutResponse(result)}, nil
}

type ConsumeBillingCheckoutReturnInput struct {
	AttemptID string `path:"attempt_id" doc:"Opaque OpenPost checkout attempt ID"`
}

type ConsumeBillingCheckoutReturnOutput struct {
	Body struct {
		Status     string `json:"status" enum:"pending,success,failed"`
		ReturnPath string `json:"return_path,omitempty"`
		Consumed   bool   `json:"consumed"`
	}
}

func (h *BillingHandler) consumeCheckoutReturn(ctx context.Context, input *ConsumeBillingCheckoutReturnInput) (*ConsumeBillingCheckoutReturnOutput, error) {
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	result, err := h.billing.ConsumeCheckoutReturn(ctx, input.AttemptID, middleware.GetUserID(ctx))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("checkout attempt not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to confirm checkout")
	}
	if result.NewlyConsumed && h.telemetry != nil {
		if err := h.telemetry.Capture(ctx, telemetry.Event{
			Name: telemetry.EventCheckoutCompleted, DistinctID: middleware.GetUserID(ctx), WorkspaceID: result.WorkspaceID,
			Properties: map[string]any{"plan_id": result.PlanID, "billing_period": result.BillingPeriod},
		}); err != nil {
			log.Printf("Failed to enqueue checkout completion telemetry: %v", err)
		}
	}
	output := &ConsumeBillingCheckoutReturnOutput{}
	output.Body.Status = result.Status
	output.Body.ReturnPath = result.ReturnPath
	output.Body.Consumed = result.Consumed
	return output, nil
}

type CreateBillingPortalInput struct {
	Body struct {
		WorkspaceID    string `json:"workspace_id,omitempty" doc:"Workspace ID"`
		OrganizationID string `json:"organization_id,omitempty" doc:"Organization ID"`
		Purpose        string `json:"purpose,omitempty" doc:"Portal destination" enum:"manage,update_payment_method,cancel_subscription,invoices,billing_details" default:"manage"`
	}
}

func (h *BillingHandler) createPortalSession(ctx context.Context, input *CreateBillingPortalInput) (*BillingURLOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	organizationID, workspaceID, err := h.resolveBillingScope(ctx, input.Body.OrganizationID, input.Body.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	if workspaceID != "" {
		allowed, accessErr := middleware.CheckWorkspaceAdminAccess(ctx, h.db, workspaceID, userID)
		if accessErr != nil {
			return nil, huma.Error500InternalServerError("failed to check workspace admin access")
		}
		if !allowed {
			return nil, huma.Error403Forbidden("workspace admin role required")
		}
	}
	if err := h.checkOrganizationAccess(ctx, organizationID, userID, true); err != nil {
		return nil, err
	}

	result, err := h.billing.CreateCustomerPortalSession(ctx, billing.CreateCustomerPortalInput{
		OrganizationID: organizationID,
		Purpose:        billing.CustomerPortalPurpose(input.Body.Purpose),
	})
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: portalResponse(result)}, nil
}

type CreateOrganizationBillingCheckoutInput struct {
	PathID string `path:"id" doc:"Organization ID"`
	Body   struct {
		PlanID        string `json:"plan_id" doc:"Plan ID: starter, founder, pro, team, or agency"`
		BillingPeriod string `json:"billing_period,omitempty" doc:"Billing period: monthly or annual" enum:"monthly,annual" default:"monthly"`
		ReturnPath    string `json:"return_path,omitempty" maxLength:"2048" doc:"Validated same-origin route to resume once this exact checkout succeeds"`
	}
}

func (h *BillingHandler) createOrganizationCheckout(ctx context.Context, input *CreateOrganizationBillingCheckoutInput) (*BillingURLOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	if err := h.checkOrganizationAccess(ctx, input.PathID, userID, true); err != nil {
		return nil, err
	}
	email, err := h.userEmail(ctx, userID)
	if err != nil {
		return nil, err
	}
	result, err := h.billing.CreateCheckout(ctx, billing.CreateCheckoutInput{
		OrganizationID: input.PathID,
		UserID:         userID,
		CustomerEmail:  email,
		PlanID:         input.Body.PlanID,
		BillingPeriod:  input.Body.BillingPeriod,
		ReturnPath:     input.Body.ReturnPath,
	})
	if err != nil {
		return nil, billingAPIError(err)
	}
	h.captureCheckoutCreated(ctx, userID, input.PathID, "", result)
	return &BillingURLOutput{Body: checkoutResponse(result)}, nil
}

func (h *BillingHandler) captureCheckoutCreated(
	ctx context.Context,
	userID string,
	organizationID string,
	workspaceID string,
	result billing.CheckoutResult,
) {
	if h.telemetry == nil {
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name:        telemetry.EventBillingCheckoutCreated,
		DistinctID:  userID,
		WorkspaceID: workspaceID,
		Properties: map[string]any{
			"checkout_id":     result.ID,
			"organization_id": organizationID,
			"plan_id":         result.PlanID,
			"billing_period":  result.BillingPeriod,
			"provider":        "paddle",
		},
	}); err != nil {
		log.Printf("Failed to enqueue billing checkout telemetry: %v", err)
	}
}

func checkoutResponse(result billing.CheckoutResult) BillingURLResponse {
	response := BillingURLResponse{
		URL:             result.URL,
		ID:              result.ID,
		ProviderPriceID: result.ProviderPriceID,
		PriceIDs:        result.PriceIDs,
		PlanID:          result.PlanID,
		BillingPeriod:   result.BillingPeriod,
		ReturnURL:       result.ReturnURL,
		ClientToken:     result.ClientToken,
		Environment:     result.Environment,
		CustomerEmail:   result.CustomerEmail,
		WorkspaceID:     result.WorkspaceID,
	}
	if !result.TrialEndsAt.IsZero() {
		response.TrialEndsAt = result.TrialEndsAt.UTC().Format(time.RFC3339)
	}
	return response
}

type CreateOrganizationBillingPortalInput struct {
	PathID  string `path:"id" doc:"Organization ID"`
	Purpose string `query:"purpose" enum:"manage,update_payment_method,cancel_subscription,invoices,billing_details" default:"manage" doc:"Portal destination"`
}

func (h *BillingHandler) createOrganizationPortalSession(ctx context.Context, input *CreateOrganizationBillingPortalInput) (*BillingURLOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	if err := h.checkOrganizationAccess(ctx, input.PathID, userID, true); err != nil {
		return nil, err
	}
	result, err := h.billing.CreateCustomerPortalSession(ctx, billing.CreateCustomerPortalInput{
		OrganizationID: input.PathID,
		Purpose:        billing.CustomerPortalPurpose(input.Purpose),
	})
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: portalResponse(result)}, nil
}

func portalResponse(result billing.CustomerPortalResult) BillingURLResponse {
	usedGenericFallback := result.UsedGenericFallback
	return BillingURLResponse{
		ID: result.ID, URL: result.URL, Purpose: string(result.Purpose),
		UsedGenericFallback: &usedGenericFallback,
	}
}

func billingAPIError(err error) error {
	if billing.IsConfigurationError(err) {
		return huma.NewError(http.StatusServiceUnavailable, err.Error())
	}
	return huma.Error400BadRequest(err.Error())
}

func (h *BillingHandler) ensureReady() error {
	if h.billing == nil || h.db == nil || h.auth == nil || h.usage == nil {
		return huma.Error500InternalServerError("billing API is not configured")
	}
	return nil
}

func (h *BillingHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	if !middleware.WorkspaceScopeAllows(ctx, workspaceID) {
		return huma.Error403Forbidden("workspace not accessible")
	}
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func (h *BillingHandler) resolveBillingScope(ctx context.Context, organizationID, workspaceID, userID string) (string, string, error) {
	organizationID = strings.TrimSpace(organizationID)
	workspaceID = strings.TrimSpace(workspaceID)
	if organizationID != "" {
		if err := h.checkOrganizationAccess(ctx, organizationID, userID, false); err != nil {
			return "", "", err
		}
		if workspaceID != "" {
			if err := h.checkBillingWorkspaceOrganization(ctx, workspaceID, organizationID); err != nil {
				return "", "", err
			}
		}
		return organizationID, workspaceID, nil
	}
	if workspaceID == "" {
		return "", "", huma.Error400BadRequest("organization_id or workspace_id is required")
	}
	if err := h.checkWorkspaceAccess(ctx, workspaceID, userID); err != nil {
		return "", "", err
	}
	return h.resolveWorkspaceBillingScope(ctx, workspaceID, userID)
}

func (h *BillingHandler) resolveWorkspaceBillingScope(
	ctx context.Context,
	workspaceID,
	userID string,
) (string, string, error) {
	var workspace models.Workspace
	err := h.db.NewSelect().
		Model(&workspace).
		Column("id", "organization_id").
		Where("id = ?", workspaceID).
		Scan(ctx)
	if err == sql.ErrNoRows {
		return "", "", huma.Error404NotFound("workspace not found")
	}
	if err != nil {
		return "", "", huma.Error500InternalServerError("failed to load workspace")
	}
	if strings.TrimSpace(workspace.OrganizationID) == "" {
		return "org_" + workspaceID, workspaceID, nil
	}
	resolvedOrganizationID := strings.TrimSpace(workspace.OrganizationID)
	hasSubscription, err := h.db.NewSelect().
		Model((*models.BillingSubscription)(nil)).
		Where("organization_id = ?", resolvedOrganizationID).
		Where("provider = ?", models.BillingProviderPaddle).
		Exists(ctx)
	if err != nil {
		return "", "", huma.Error500InternalServerError("failed to resolve billing organization")
	}
	if hasSubscription {
		return resolvedOrganizationID, workspaceID, nil
	}
	ownsWorkspaceOrganization, err := h.db.NewSelect().
		Model((*models.Organization)(nil)).
		Where("id = ?", resolvedOrganizationID).
		Where("created_by = ?", userID).
		Exists(ctx)
	if err != nil {
		return "", "", huma.Error500InternalServerError("failed to resolve billing organization")
	}
	if !ownsWorkspaceOrganization {
		return resolvedOrganizationID, workspaceID, nil
	}
	var subscribedOrganizationID string
	err = h.db.NewSelect().
		TableExpr("billing_subscriptions AS bs").
		ColumnExpr("bs.organization_id").
		Join("JOIN organization_members AS om ON om.organization_id = bs.organization_id").
		Where("om.user_id = ?", userID).
		Where("bs.provider = ?", models.BillingProviderPaddle).
		Join("JOIN organizations AS o ON o.id = bs.organization_id").
		Where("o.created_by = ?", userID).
		Where("LOWER(bs.status) IN (?)", bun.List([]string{"active", "trialing", "past_due"})).
		OrderExpr("bs.updated_at DESC").
		Limit(1).
		Scan(ctx, &subscribedOrganizationID)
	if err == nil {
		return subscribedOrganizationID, workspaceID, nil
	}
	if err != sql.ErrNoRows {
		return "", "", huma.Error500InternalServerError("failed to resolve billing organization")
	}
	return resolvedOrganizationID, workspaceID, nil
}

func (h *BillingHandler) checkBillingWorkspaceOrganization(ctx context.Context, workspaceID, organizationID string) error {
	var workspaceOrganizationID string
	err := h.db.NewSelect().
		Table("workspaces").
		Column("organization_id").
		Where("id = ?", workspaceID).
		Scan(ctx, &workspaceOrganizationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return huma.Error403Forbidden("workspace not accessible")
		}
		return huma.Error500InternalServerError("failed to resolve billing workspace")
	}
	if strings.TrimSpace(workspaceOrganizationID) != organizationID {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func (h *BillingHandler) checkOrganizationAccess(ctx context.Context, organizationID, userID string, requireAdmin bool) error {
	decision, err := identity.EvaluateOrganizationAccess(
		ctx,
		h.db,
		organizationID,
		userID,
		middleware.GetSessionID(ctx),
		middleware.GetTokenID(ctx),
	)
	if err != nil {
		return huma.Error500InternalServerError("failed to check organization SSO access")
	}
	if !decision.Allowed {
		return huma.Error403Forbidden("organization SSO authentication is required")
	}
	countQuery := h.db.NewSelect().
		Model((*models.OrganizationMember)(nil)).
		Where("organization_id = ? AND user_id = ?", organizationID, userID)
	if requireAdmin {
		countQuery = countQuery.Where("role IN (?)", bun.List([]string{models.OrganizationRoleOwner, models.OrganizationRoleAdmin}))
	}
	count, err := countQuery.Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to check organization access")
	}
	if count == 0 {
		if requireAdmin {
			return huma.Error403Forbidden("organization admin role required")
		}
		return huma.Error403Forbidden("organization not accessible")
	}
	return nil
}

func (h *BillingHandler) checkOrganizationCredentialAccess(ctx context.Context, organizationID, userID string) error {
	decision, err := identity.EvaluateOrganizationAccess(
		ctx,
		h.db,
		organizationID,
		userID,
		middleware.GetSessionID(ctx),
		middleware.GetTokenID(ctx),
	)
	if err != nil {
		return huma.Error500InternalServerError("failed to check organization SSO access")
	}
	if !decision.Allowed {
		return huma.Error403Forbidden("organization SSO authentication is required")
	}
	return nil
}

func (h *BillingHandler) canManageOrganizationBilling(ctx context.Context, organizationID, userID string) (bool, error) {
	decision, err := identity.EvaluateOrganizationAccess(
		ctx,
		h.db,
		organizationID,
		userID,
		middleware.GetSessionID(ctx),
		middleware.GetTokenID(ctx),
	)
	if err != nil {
		return false, huma.Error500InternalServerError("failed to check organization SSO access")
	}
	if !decision.Allowed {
		return false, nil
	}
	count, err := h.db.NewSelect().
		Model((*models.OrganizationMember)(nil)).
		Where("organization_id = ? AND user_id = ?", organizationID, userID).
		Where("role IN (?)", bun.List([]string{models.OrganizationRoleOwner, models.OrganizationRoleAdmin})).
		Count(ctx)
	if err != nil {
		return false, huma.Error500InternalServerError("failed to check organization billing access")
	}
	return count > 0, nil
}

func (h *BillingHandler) userEmail(ctx context.Context, userID string) (string, error) {
	var user models.User
	err := h.db.NewSelect().
		Model(&user).
		Where("id = ?", userID).
		Scan(ctx)
	if err == sql.ErrNoRows {
		return "", huma.Error403Forbidden("user not found")
	}
	if err != nil {
		return "", huma.Error500InternalServerError("failed to load user")
	}
	return user.Email, nil
}

func usageSnapshotToStrings(snapshot map[entitlements.LimitKey]int64) map[string]int64 {
	out := make(map[string]int64, len(snapshot))
	for key, value := range snapshot {
		out[string(key)] = value
	}
	return out
}

func limitsFromSnapshot(raw string) (map[string]int64, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]int64{}, nil
	}
	var decoded struct {
		Limits map[string]any `json:"limits"`
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, err
	}
	limits := make(map[string]int64, len(decoded.Limits))
	for key, value := range decoded.Limits {
		amount, ok := snapshotValueAsInt64(value)
		if !ok {
			return nil, fmt.Errorf("invalid limit value for %s", key)
		}
		limits[key] = amount
	}
	return limits, nil
}

func snapshotValueAsInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), typed >= 0 && typed == float64(int64(typed))
	case int64:
		return typed, typed >= 0
	case int:
		return int64(typed), typed >= 0
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil && parsed >= 0
	default:
		return 0, false
	}
}
