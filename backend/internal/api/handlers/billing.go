package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
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
	"github.com/uptrace/bun"
)

type BillingHandler struct {
	billing *billing.Service
	db      *bun.DB
	auth    middleware.Authenticator
	usage   *usage.Service
}

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

type WhopWebhookOutput struct {
	OK        bool   `json:"ok"`
	Duplicate bool   `json:"duplicate"`
	EventID   string `json:"event_id"`
	EventType string `json:"event_type"`
}

func (h *BillingHandler) RegisterRoutes(e *echo.Echo) {
	e.POST("/api/v1/billing/whop/webhook", h.handleWhopWebhook)
}

func (h *BillingHandler) RegisterAPIRoutes(api huma.API) {
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

func (h *BillingHandler) handleWhopWebhook(c echo.Context) error {
	if h.billing == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "billing service is not configured"})
	}
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to read webhook body"})
	}
	result, err := h.billing.AcceptWhopWebhook(c.Request().Context(), body, billing.WebhookHeaders{
		ID:        c.Request().Header.Get("webhook-id"),
		Timestamp: c.Request().Header.Get("webhook-timestamp"),
		Signature: c.Request().Header.Get("webhook-signature"),
	})
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: err.Error()})
	}

	return c.JSON(http.StatusOK, WhopWebhookOutput{
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
	OrganizationID    string                      `json:"organization_id" doc:"Organization ID"`
	WorkspaceID       string                      `json:"workspace_id" doc:"Workspace ID"`
	Provider          string                      `json:"provider,omitempty" doc:"Billing provider"`
	Status            string                      `json:"status" doc:"Subscription status"`
	PlanID            string                      `json:"plan_id,omitempty" doc:"Plan ID"`
	CurrentPeriodEnd  string                      `json:"current_period_end,omitempty" doc:"Current billing period end"`
	CancelAtPeriodEnd bool                        `json:"cancel_at_period_end" doc:"Whether the subscription cancels at period end"`
	ManageURL         string                      `json:"manage_url,omitempty" doc:"Whop billing management URL for the active membership"`
	Limits            map[string]int64            `json:"limits" doc:"Entitlement limits from the local subscription snapshot"`
	Usage             map[string]int64            `json:"usage" doc:"Current-month product usage counters"`
	PeriodStart       string                      `json:"period_start" doc:"UTC month start for the usage counters"`
	ProviderCosts     []usage.ProviderCostSummary `json:"provider_costs" doc:"Confirmed hosted provider-cost estimates and unresolved reservations, separate from the product subscription"`
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
	return h.billingStatusForOrganization(ctx, organizationID, workspaceID)
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
	return h.billingStatusForOrganization(ctx, input.PathID, "")
}

func (h *BillingHandler) billingStatusForOrganization(ctx context.Context, organizationID, workspaceID string) (*BillingStatusOutput, error) {
	now := time.Now().UTC()
	usageSnapshot, providerCosts, err := h.billingUsageForScope(ctx, organizationID, workspaceID, now)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load billing usage")
	}
	response := BillingStatusResponse{
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		Status:         "none",
		Limits:         map[string]int64{},
		Usage:          usageSnapshotToStrings(usageSnapshot),
		PeriodStart:    usage.MonthStart(now).Format(time.RFC3339),
		ProviderCosts:  providerCosts,
	}

	var sub models.BillingSubscription
	err = h.db.NewSelect().
		Model(&sub).
		Where("organization_id = ?", organizationID).
		Scan(ctx)
	if err == sql.ErrNoRows && workspaceID != "" {
		err = h.db.NewSelect().
			Model(&sub).
			Where("workspace_id = ?", workspaceID).
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
	response.PlanID = sub.PlanID
	response.CancelAtPeriodEnd = sub.CancelAtPeriodEnd
	response.ManageURL = sub.ProviderManageURL
	if !sub.CurrentPeriodEnd.IsZero() {
		response.CurrentPeriodEnd = sub.CurrentPeriodEnd.UTC().Format(time.RFC3339)
	}
	limits, err := limitsFromSnapshot(sub.EntitlementSnapshot)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to parse billing entitlements")
	}
	response.Limits = limits
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
		PlanID         string `json:"plan_id" doc:"Plan ID: starter, creator, pro, team, or agency"`
		BillingPeriod  string `json:"billing_period,omitempty" doc:"Billing period: monthly or annual" enum:"monthly,annual" default:"monthly"`
		AffiliateCode  string `json:"affiliate_code,omitempty" doc:"Optional Whop affiliate code carried into checkout"`
	}
}

type BillingURLResponse struct {
	URL            string `json:"url" doc:"OpenPost checkout or billing management URL"`
	ID             string `json:"id,omitempty" doc:"Whop checkout configuration or membership ID"`
	PurchaseURL    string `json:"purchase_url,omitempty" doc:"Whop-hosted checkout fallback URL"`
	ProviderPlanID string `json:"provider_plan_id,omitempty" doc:"Whop plan ID used by the embedded checkout"`
	PlanID         string `json:"plan_id,omitempty" doc:"OpenPost plan ID"`
	BillingPeriod  string `json:"billing_period,omitempty" doc:"Selected billing period"`
	PriceUSD       int    `json:"price_usd,omitempty" doc:"Selected plan price in whole US dollars"`
	TrialEndsAt    string `json:"trial_ends_at,omitempty" doc:"Expected end of the 14-day trial"`
	ReturnURL      string `json:"return_url,omitempty" doc:"OpenPost URL used after Whop checkout completes"`
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
	if strings.TrimSpace(input.Body.OrganizationID) != "" {
		if err := h.checkOrganizationAccess(ctx, organizationID, userID, true); err != nil {
			return nil, err
		}
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
		AffiliateCode:  input.Body.AffiliateCode,
	})
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: checkoutResponse(result)}, nil
}

type CreateBillingPortalInput struct {
	Body struct {
		WorkspaceID    string `json:"workspace_id,omitempty" doc:"Workspace ID"`
		OrganizationID string `json:"organization_id,omitempty" doc:"Organization ID"`
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
	if strings.TrimSpace(input.Body.OrganizationID) != "" {
		if err := h.checkOrganizationAccess(ctx, organizationID, userID, true); err != nil {
			return nil, err
		}
	}

	result, err := h.billing.CreateCustomerPortalSession(ctx, organizationID)
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: BillingURLResponse{ID: result.ID, URL: result.URL}}, nil
}

type CreateOrganizationBillingCheckoutInput struct {
	PathID string `path:"id" doc:"Organization ID"`
	Body   struct {
		PlanID        string `json:"plan_id" doc:"Plan ID: starter, creator, pro, team, or agency"`
		BillingPeriod string `json:"billing_period,omitempty" doc:"Billing period: monthly or annual" enum:"monthly,annual" default:"monthly"`
		AffiliateCode string `json:"affiliate_code,omitempty" doc:"Optional Whop affiliate code carried into checkout"`
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
		AffiliateCode:  input.Body.AffiliateCode,
	})
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: checkoutResponse(result)}, nil
}

func checkoutResponse(result billing.CheckoutResult) BillingURLResponse {
	response := BillingURLResponse{
		URL:            result.URL,
		ID:             result.ID,
		PurchaseURL:    result.PurchaseURL,
		ProviderPlanID: result.ProviderPlanID,
		PlanID:         result.PlanID,
		BillingPeriod:  result.BillingPeriod,
		PriceUSD:       result.PriceUSD,
		ReturnURL:      result.ReturnURL,
	}
	if !result.TrialEndsAt.IsZero() {
		response.TrialEndsAt = result.TrialEndsAt.UTC().Format(time.RFC3339)
	}
	return response
}

type CreateOrganizationBillingPortalInput struct {
	PathID string `path:"id" doc:"Organization ID"`
}

func (h *BillingHandler) createOrganizationPortalSession(ctx context.Context, input *CreateOrganizationBillingPortalInput) (*BillingURLOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := h.ensureReady(); err != nil {
		return nil, err
	}
	if err := h.checkOrganizationAccess(ctx, input.PathID, userID, true); err != nil {
		return nil, err
	}
	result, err := h.billing.CreateCustomerPortalSession(ctx, input.PathID)
	if err != nil {
		return nil, billingAPIError(err)
	}
	return &BillingURLOutput{Body: BillingURLResponse{ID: result.ID, URL: result.URL}}, nil
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
	count, err := h.db.NewSelect().
		Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if count == 0 {
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
		return organizationID, workspaceID, nil
	}
	if workspaceID == "" {
		return "", "", huma.Error400BadRequest("organization_id or workspace_id is required")
	}
	if err := h.checkWorkspaceAccess(ctx, workspaceID, userID); err != nil {
		return "", "", err
	}
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
		Join("JOIN organizations AS o ON o.id = bs.organization_id").
		Where("o.created_by = ?", userID).
		Where("LOWER(bs.status) IN (?)", bun.List([]string{"active", "trialing"})).
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
