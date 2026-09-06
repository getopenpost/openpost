package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/uptrace/bun"
)

const (
	instanceAdminTrendDays     = 30
	instanceImpersonationTTL   = 5 * time.Minute
	instanceImpersonationBytes = 32
)

type InstanceAdminHandler struct {
	db            *bun.DB
	authenticator middleware.Authenticator
	authService   *auth.Service
	sessions      *sessions.Service
	frontendURL   string
	now           func() time.Time
}

type InstanceOverviewResponse struct {
	TotalUsers            int                   `json:"total_users" doc:"Total registered users"`
	NewUsersLast30Days    int                   `json:"new_users_last_30_days" doc:"Users registered during the current 30-day window"`
	TotalWorkspaces       int                   `json:"total_workspaces" doc:"Total workspaces"`
	PublishedLast30Days   int                   `json:"published_last_30_days" doc:"Publications with at least one published rendition during the current 30-day window"`
	UserRegistrationTrend []InstanceDailyMetric `json:"user_registration_trend" doc:"Daily UTC user registrations for the last 30 days"`
	PublicationTrend      []InstanceDailyMetric `json:"publication_trend" doc:"Daily UTC publications with at least one published rendition for the last 30 days"`
}

type InstanceDailyMetric struct {
	Date  string `json:"date" doc:"UTC calendar date" format:"date"`
	Value int    `json:"value" doc:"Count for this date"`
}

type GetInstanceOverviewOutput struct {
	Body InstanceOverviewResponse
}

type ListInstanceUsersInput struct {
	Page      int    `query:"page" default:"1" minimum:"1" doc:"One-based page number"`
	PerPage   int    `query:"per_page" default:"25" minimum:"1" maximum:"100" doc:"Users per page"`
	Search    string `query:"search" maxLength:"200" doc:"Case-insensitive email or display-name search"`
	Sort      string `query:"sort" default:"created_at" enum:"created_at,email,display_name,last_active_at,workspace_count,publication_count" doc:"Directory sort field"`
	Direction string `query:"direction" default:"desc" enum:"asc,desc" doc:"Directory sort direction"`
}

type InstanceUserResponse struct {
	ID                 string   `json:"id" doc:"User ID"`
	Email              string   `json:"email" doc:"User email address"`
	DisplayName        string   `json:"display_name" doc:"User display name"`
	AvatarURL          string   `json:"avatar_url" doc:"Profile avatar URL"`
	IsAdmin            bool     `json:"is_admin" doc:"Whether the user is an instance administrator"`
	PlanIDs            []string `json:"plan_ids" doc:"Active or trialing organization plan IDs available to the user"`
	OrganizationCount  int      `json:"organization_count" doc:"Number of organizations the user belongs to"`
	WorkspaceCount     int      `json:"workspace_count" doc:"Number of workspaces the user can access"`
	SocialAccountCount int      `json:"social_account_count" doc:"Number of social accounts available through the user's workspaces"`
	PublicationCount   int      `json:"publication_count" doc:"Number of publications created by the user"`
	LastActiveAt       string   `json:"last_active_at" doc:"Most recent tracked browser session activity time"`
	CreatedAt          string   `json:"created_at" doc:"Account creation time"`
}

type InstanceUserPage struct {
	Users      []InstanceUserResponse `json:"users"`
	Total      int                    `json:"total" doc:"Total registered users"`
	Page       int                    `json:"page" doc:"Current one-based page"`
	PerPage    int                    `json:"per_page" doc:"Users per page"`
	TotalPages int                    `json:"total_pages" doc:"Total number of pages"`
}

type ListInstanceUsersOutput struct {
	Body InstanceUserPage
}

type instanceUserRow struct {
	ID                 string    `bun:"id"`
	Email              string    `bun:"email"`
	DisplayName        string    `bun:"display_name"`
	AvatarURL          string    `bun:"avatar_url"`
	IsAdmin            bool      `bun:"is_admin"`
	OrganizationCount  int       `bun:"organization_count"`
	WorkspaceCount     int       `bun:"workspace_count"`
	SocialAccountCount int       `bun:"social_account_count"`
	PublicationCount   int       `bun:"publication_count"`
	CreatedAt          time.Time `bun:"created_at"`
}

type SetUserPlanInput struct {
	UserID string `path:"user_id" doc:"Target user ID"`
	Body   struct {
		PlanID string `json:"plan_id" doc:"Plan ID to assign: starter, founder, pro, team, agency, or empty string to remove the override"`
	}
}

type SetUserPlanOutput struct {
	Body struct {
		UserID string `json:"user_id" doc:"User ID"`
		PlanID string `json:"plan_id" doc:"Assigned plan ID, empty if override was removed"`
	}
}

type CreateUserImpersonationLinkInput struct {
	UserID string `path:"user_id" doc:"Target user ID"`
}

type CreateUserImpersonationLinkOutput struct {
	Body struct {
		URL       string `json:"url" doc:"One-use private-browser sign-in URL"`
		ExpiresAt string `json:"expires_at" doc:"Link expiration time"`
	}
}

type ConsumeUserImpersonationLinkInput struct {
	Body struct {
		Code string `json:"code" minLength:"1" maxLength:"200" doc:"One-use impersonation code from the URL fragment"`
	}
}

type ConsumeUserImpersonationLinkOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		Message string `json:"message"`
	}
}

func NewInstanceAdminHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	authService *auth.Service,
	sessionService *sessions.Service,
	frontendURL string,
) *InstanceAdminHandler {
	return &InstanceAdminHandler{
		db:            db,
		authenticator: authenticator,
		authService:   authService,
		sessions:      sessionService,
		frontendURL:   strings.TrimRight(strings.TrimSpace(frontendURL), "/"),
		now:           func() time.Time { return time.Now().UTC() },
	}
}

func (h *InstanceAdminHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)
	huma.Register(api, huma.Operation{
		OperationID: "get-instance-overview",
		Method:      http.MethodGet,
		Path:        "/admin/overview",
		Summary:     "Get instance administration overview",
		Description: "Returns instance-wide account, workspace, and publication activity totals for an instance administrator.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
		Errors:      []int{401, 403},
	}, h.getOverview)

	huma.Register(api, huma.Operation{
		OperationID: "list-instance-users",
		Method:      http.MethodGet,
		Path:        "/admin/users",
		Summary:     "List instance users",
		Description: "Returns a newest-first, paginated directory of users visible only to an instance administrator.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
		Errors:      []int{401, 403},
	}, h.listUsers)

	huma.Register(api, huma.Operation{
		OperationID: "set-user-plan",
		Method:      http.MethodPut,
		Path:        "/admin/users/{user_id}/plan",
		Summary:     "Set a user plan override",
		Description: "Assigns or removes an administrator plan override for a user. The override creates an admin-managed subscription on the user's personal organization, bypassing Paddle checkout. Pass an empty plan_id to remove the override.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
		Errors:      []int{400, 401, 403, 404},
	}, h.setUserPlan)

	huma.Register(api, huma.Operation{
		OperationID: "create-user-impersonation-link",
		Method:      http.MethodPost,
		Path:        "/admin/users/{user_id}/impersonation-links",
		Summary:     "Create a user impersonation link",
		Description: "Creates a five-minute, one-use sign-in link for a non-admin user. The caller must use an unscoped instance-admin browser session.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
		Errors:      []int{401, 403, 404, 409},
	}, h.createImpersonationLink)

	huma.Register(api, huma.Operation{
		OperationID: "consume-user-impersonation-link",
		Method:      http.MethodPost,
		Path:        "/auth/impersonation",
		Summary:     "Consume a user impersonation link",
		Description: "Consumes a five-minute, one-use impersonation code and creates a tracked browser session for the target user.",
		Tags:        []string{"Auth"},
		Middlewares: huma.Middlewares{requireAnonymousImpersonationBrowser(api)},
		Errors:      []int{400, 409},
	}, h.consumeImpersonationLink)
}

func (h *InstanceAdminHandler) getOverview(ctx context.Context, _ *struct{}) (*GetInstanceOverviewOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}

	now := h.now().UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, -(instanceAdminTrendDays - 1))
	end := start.AddDate(0, 0, instanceAdminTrendDays)

	totalUsers, err := h.db.NewSelect().Model((*models.User)(nil)).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count users")
	}
	totalWorkspaces, err := h.db.NewSelect().Model((*models.Workspace)(nil)).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count workspaces")
	}

	var registrationTimes []time.Time
	if err := h.db.NewSelect().
		Model((*models.User)(nil)).
		Column("created_at").
		Where("created_at >= ?", start).
		Where("created_at < ?", end).
		Order("created_at ASC").
		Scan(ctx, &registrationTimes); err != nil {
		return nil, huma.Error500InternalServerError("failed to load user registration trend")
	}

	var publicationTimes []time.Time
	if err := h.db.NewSelect().
		TableExpr("publications AS publication").
		Column("publication.actual_run_at").
		Where("publication.actual_run_at >= ?", start).
		Where("publication.actual_run_at < ?", end).
		Where("EXISTS (SELECT 1 FROM renditions AS rendition WHERE rendition.publication_id = publication.id AND rendition.status = ?)", models.RenditionStatusPublished).
		Order("publication.actual_run_at ASC").
		Scan(ctx, &publicationTimes); err != nil {
		return nil, huma.Error500InternalServerError("failed to load publication trend")
	}

	return &GetInstanceOverviewOutput{Body: InstanceOverviewResponse{
		TotalUsers:            totalUsers,
		NewUsersLast30Days:    len(registrationTimes),
		TotalWorkspaces:       totalWorkspaces,
		PublishedLast30Days:   len(publicationTimes),
		UserRegistrationTrend: instanceDailyMetrics(start, registrationTimes),
		PublicationTrend:      instanceDailyMetrics(start, publicationTimes),
	}}, nil
}

func (h *InstanceAdminHandler) listUsers(ctx context.Context, input *ListInstanceUsersInput) (*ListInstanceUsersOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}

	search := strings.TrimSpace(input.Search)
	countQuery := h.db.NewSelect().TableExpr("users AS instance_user")
	countQuery = applyInstanceUserSearch(countQuery, search)
	total, err := countQuery.Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count users")
	}

	var rows []instanceUserRow
	query := h.db.NewSelect().
		TableExpr("users AS instance_user").
		Column(
			"instance_user.id",
			"instance_user.email",
			"instance_user.display_name",
			"instance_user.avatar_url",
			"instance_user.is_admin",
			"instance_user.created_at",
		).
		ColumnExpr("(SELECT COUNT(*) FROM organization_members AS member WHERE member.user_id = instance_user.id) AS organization_count").
		ColumnExpr("(SELECT COUNT(*) FROM workspace_members AS member WHERE member.user_id = instance_user.id AND member.status = 'active') AS workspace_count").
		ColumnExpr("(SELECT COUNT(*) FROM social_accounts AS account WHERE account.workspace_id IN (SELECT member.workspace_id FROM workspace_members AS member WHERE member.user_id = instance_user.id AND member.status = 'active')) AS social_account_count").
		ColumnExpr("(SELECT COUNT(*) FROM publications AS publication WHERE publication.created_by = instance_user.id) AS publication_count")
	query = applyInstanceUserSearch(query, search)
	orderExpr, direction := instanceUserOrder(input.Sort, input.Direction)
	if err := query.
		OrderExpr(orderExpr+" "+direction).
		OrderExpr("instance_user.id ASC").
		Limit(input.PerPage).
		Offset((input.Page-1)*input.PerPage).
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to list users")
	}

	userIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		userIDs = append(userIDs, row.ID)
	}
	planIDsByUser, err := h.loadInstanceUserPlans(ctx, userIDs)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load user plans")
	}
	lastActiveByUser, err := h.loadInstanceUserActivity(ctx, userIDs)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load user activity")
	}

	users := make([]InstanceUserResponse, 0, len(rows))
	for _, row := range rows {
		users = append(users, InstanceUserResponse{
			ID:                 row.ID,
			Email:              row.Email,
			DisplayName:        row.DisplayName,
			AvatarURL:          row.AvatarURL,
			IsAdmin:            row.IsAdmin,
			PlanIDs:            planIDsByUser[row.ID],
			OrganizationCount:  row.OrganizationCount,
			WorkspaceCount:     row.WorkspaceCount,
			SocialAccountCount: row.SocialAccountCount,
			PublicationCount:   row.PublicationCount,
			LastActiveAt:       formatInstanceAdminTime(lastActiveByUser[row.ID]),
			CreatedAt:          formatInstanceAdminTime(row.CreatedAt),
		})
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + input.PerPage - 1) / input.PerPage
	}
	return &ListInstanceUsersOutput{Body: InstanceUserPage{
		Users: users, Total: total, Page: input.Page, PerPage: input.PerPage, TotalPages: totalPages,
	}}, nil
}

func (h *InstanceAdminHandler) loadInstanceUserPlans(
	ctx context.Context,
	userIDs []string,
) (map[string][]string, error) {
	plans := make(map[string][]string, len(userIDs))
	for _, userID := range userIDs {
		plans[userID] = []string{}
	}
	if len(userIDs) == 0 {
		return plans, nil
	}

	var rows []struct {
		UserID string `bun:"user_id"`
		PlanID string `bun:"plan_id"`
	}
	if err := h.db.NewSelect().
		TableExpr("organization_members AS member").
		ColumnExpr("DISTINCT member.user_id AS user_id").
		ColumnExpr("subscription.plan_id AS plan_id").
		Join("JOIN billing_subscriptions AS subscription ON subscription.organization_id = member.organization_id").
		Where("member.user_id IN (?)", bun.List(userIDs)).
		Where("subscription.provider IN (?)", bun.List(models.BillingGrantingProviders)).
		Where("LOWER(subscription.status) IN ('active', 'trialing')").
		Where("subscription.plan_id != ''").
		OrderExpr("member.user_id ASC").
		OrderExpr("subscription.plan_id ASC").
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		plans[row.UserID] = append(plans[row.UserID], row.PlanID)
	}
	for userID := range plans {
		sort.Strings(plans[userID])
	}
	return plans, nil
}

func (h *InstanceAdminHandler) loadInstanceUserActivity(
	ctx context.Context,
	userIDs []string,
) (map[string]time.Time, error) {
	lastActive := make(map[string]time.Time, len(userIDs))
	if len(userIDs) == 0 {
		return lastActive, nil
	}

	var rows []models.UserSession
	if err := h.db.NewSelect().
		Model(&rows).
		Column("user_id", "last_used_at").
		Where("user_id IN (?)", bun.List(userIDs)).
		Where("last_used_at IS NOT NULL").
		OrderExpr("user_id ASC").
		OrderExpr("last_used_at DESC").
		Scan(ctx); err != nil {
		return nil, err
	}
	for _, row := range rows {
		if _, exists := lastActive[row.UserID]; !exists {
			lastActive[row.UserID] = row.LastUsedAt
		}
	}
	return lastActive, nil
}

func applyInstanceUserSearch(query *bun.SelectQuery, search string) *bun.SelectQuery {
	if search == "" {
		return query
	}
	escaped := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").
		Replace(strings.ToLower(search))
	pattern := "%" + escaped + "%"
	return query.WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
		return group.
			Where("LOWER(instance_user.email) LIKE ? ESCAPE '!'", pattern).
			WhereOr("LOWER(instance_user.display_name) LIKE ? ESCAPE '!'", pattern)
	})
}

func instanceUserOrder(field, direction string) (string, string) {
	expressions := map[string]string{
		"created_at":        "instance_user.created_at",
		"email":             "LOWER(instance_user.email)",
		"display_name":      "COALESCE(NULLIF(LOWER(instance_user.display_name), ''), LOWER(instance_user.email))",
		"last_active_at":    "COALESCE((SELECT MAX(session.last_used_at) FROM user_sessions AS session WHERE session.user_id = instance_user.id), instance_user.created_at)",
		"workspace_count":   "(SELECT COUNT(*) FROM workspace_members AS member WHERE member.user_id = instance_user.id AND member.status = 'active')",
		"publication_count": "(SELECT COUNT(*) FROM publications AS publication WHERE publication.created_by = instance_user.id)",
	}
	expression, ok := expressions[strings.TrimSpace(field)]
	if !ok {
		expression = expressions["created_at"]
	}
	normalizedDirection := strings.ToUpper(strings.TrimSpace(direction))
	if normalizedDirection != "ASC" {
		normalizedDirection = "DESC"
	}
	return expression, normalizedDirection
}

const adminOverrideProvider = "admin"

func (h *InstanceAdminHandler) setUserPlan(ctx context.Context, input *SetUserPlanInput) (*SetUserPlanOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}

	userID := strings.TrimSpace(input.UserID)
	if userID == "" {
		return nil, huma.Error400BadRequest("user_id is required")
	}

	target := new(models.User)
	if err := h.db.NewSelect().Model(target).Where("id = ?", userID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("user not found")
		}
		return nil, huma.Error500InternalServerError("failed to load user")
	}

	planID := strings.ToLower(strings.TrimSpace(input.Body.PlanID))

	if planID == "" {
		return h.removeUserPlanOverride(ctx, userID)
	}

	planConfig, ok := billing.GetPlanConfig(planID)
	if !ok {
		return nil, huma.Error400BadRequest(fmt.Sprintf("unknown plan %q; valid plans: starter, founder, pro, team, agency", planID))
	}

	organizationID, err := h.resolvePersonalOrganizationID(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := h.now().UTC()
	snapshot, _ := json.Marshal(map[string]any{
		"provider": adminOverrideProvider,
		"plan_id":  planID,
		"status":   "active",
		"limits":   planConfig.Limits,
	})

	subscription := &models.BillingSubscription{
		OrganizationID:         organizationID,
		Provider:               adminOverrideProvider,
		ProviderCustomerID:     "admin_override",
		ProviderSubscriptionID: "admin_override_" + organizationID,
		Status:                 "active",
		PlanID:                 planID,
		EntitlementSnapshot:    string(snapshot),
		CurrentPeriodEnd:       now.AddDate(10, 0, 0),
		ProviderUpdatedAt:      now,
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	_, err = h.db.NewInsert().Model(subscription).
		On("CONFLICT (organization_id) DO UPDATE").
		Set("provider = EXCLUDED.provider").
		Set("provider_customer_id = EXCLUDED.provider_customer_id").
		Set("provider_subscription_id = EXCLUDED.provider_subscription_id").
		Set("status = EXCLUDED.status").
		Set("plan_id = EXCLUDED.plan_id").
		Set("entitlement_snapshot = EXCLUDED.entitlement_snapshot").
		Set("current_period_end = EXCLUDED.current_period_end").
		Set("provider_updated_at = EXCLUDED.provider_updated_at").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to set user plan")
	}

	out := &SetUserPlanOutput{}
	out.Body.UserID = userID
	out.Body.PlanID = planID
	return out, nil
}

func (h *InstanceAdminHandler) removeUserPlanOverride(ctx context.Context, userID string) (*SetUserPlanOutput, error) {
	organizationID, err := h.resolvePersonalOrganizationID(ctx, userID)
	if err != nil {
		return nil, err
	}

	result, err := h.db.NewDelete().
		Model((*models.BillingSubscription)(nil)).
		Where("organization_id = ?", organizationID).
		Where("provider_subscription_id = ?", "admin_override_"+organizationID).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to remove user plan override")
	}
	_, _ = result.RowsAffected()

	out := &SetUserPlanOutput{}
	out.Body.UserID = userID
	out.Body.PlanID = ""
	return out, nil
}

func (h *InstanceAdminHandler) resolvePersonalOrganizationID(ctx context.Context, userID string) (string, error) {
	var organizationID string
	err := h.db.NewSelect().
		Model((*models.Organization)(nil)).
		Column("id").
		Where("created_by = ?", userID).
		OrderExpr("created_at ASC").
		Limit(1).
		Scan(ctx, &organizationID)
	if err == sql.ErrNoRows {
		return "", huma.Error404NotFound("user has no personal organization")
	}
	if err != nil {
		return "", huma.Error500InternalServerError("failed to resolve user organization")
	}
	return organizationID, nil
}

func (h *InstanceAdminHandler) createImpersonationLink(
	ctx context.Context,
	input *CreateUserImpersonationLinkInput,
) (*CreateUserImpersonationLinkOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	adminUserID := middleware.GetUserID(ctx)
	if input.UserID == adminUserID {
		return nil, huma.Error409Conflict("instance administrators cannot impersonate themselves")
	}

	target := new(models.User)
	if err := h.db.NewSelect().Model(target).Where("id = ?", input.UserID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("user not found")
		}
		return nil, huma.Error500InternalServerError("failed to load user")
	}
	if target.IsAdmin {
		return nil, huma.Error409Conflict("instance administrators cannot be impersonated")
	}

	rawCode, tokenHash, err := newInstanceImpersonationCode()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create impersonation link")
	}
	now := h.now().UTC()
	expiresAt := now.Add(instanceImpersonationTTL)
	grant := &models.UserImpersonationGrant{
		ID:               uuid.NewString(),
		TokenHash:        tokenHash,
		AdminUserID:      adminUserID,
		TargetUserID:     target.ID,
		ExpiresAt:        expiresAt,
		CreatedIPAddress: middleware.GetClientIP(ctx),
		CreatedUserAgent: middleware.GetUserAgent(ctx),
		CreatedAt:        now,
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(grant).Exec(txCtx); err != nil {
			return err
		}
		var organizationIDs []string
		if err := tx.NewSelect().Model((*models.OrganizationMember)(nil)).
			Column("organization_id").
			Where("user_id = ?", target.ID).
			Scan(txCtx, &organizationIDs); err != nil {
			return err
		}
		if len(organizationIDs) == 0 {
			return nil
		}
		scopes := make([]models.UserImpersonationGrantOrganization, 0, len(organizationIDs))
		for _, organizationID := range organizationIDs {
			scopes = append(scopes, models.UserImpersonationGrantOrganization{GrantID: grant.ID, OrganizationID: organizationID})
		}
		_, err := tx.NewInsert().Model(&scopes).Exec(txCtx)
		return err
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to store impersonation link")
	}

	base := h.frontendURL
	if base == "" {
		base = ""
	}
	out := &CreateUserImpersonationLinkOutput{}
	out.Body.URL = base + "/impersonate#code=" + rawCode
	out.Body.ExpiresAt = formatInstanceAdminTime(expiresAt)
	return out, nil
}

func (h *InstanceAdminHandler) consumeImpersonationLink(
	ctx context.Context,
	input *ConsumeUserImpersonationLinkInput,
) (*ConsumeUserImpersonationLinkOutput, error) {
	if h.authService == nil || h.sessions == nil {
		return nil, huma.Error500InternalServerError("impersonation is not configured")
	}
	code := strings.TrimSpace(input.Body.Code)
	if code == "" {
		return nil, huma.Error400BadRequest("impersonation link is invalid or expired")
	}

	now := h.now().UTC()
	grant := new(models.UserImpersonationGrant)
	if err := h.db.NewSelect().
		Model(grant).
		Where("token_hash = ?", hashInstanceImpersonationCode(code)).
		Where("used_at IS NULL").
		Where("expires_at > ?", now).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error400BadRequest("impersonation link is invalid or expired")
		}
		return nil, huma.Error500InternalServerError("failed to validate impersonation link")
	}

	var adminIsAdmin bool
	if err := h.db.NewSelect().
		Model((*models.User)(nil)).
		Column("is_admin").
		Where("id = ?", grant.AdminUserID).
		Scan(ctx, &adminIsAdmin); err != nil || !adminIsAdmin {
		return nil, huma.Error400BadRequest("impersonation link is invalid or expired")
	}
	target := new(models.User)
	if err := h.db.NewSelect().Model(target).Where("id = ?", grant.TargetUserID).Scan(ctx); err != nil || target.IsAdmin {
		return nil, huma.Error400BadRequest("impersonation link is invalid or expired")
	}

	result, err := h.db.NewUpdate().
		Model((*models.UserImpersonationGrant)(nil)).
		Set("used_at = ?", now).
		Set("consumed_ip_address = ?", middleware.GetClientIP(ctx)).
		Set("consumed_user_agent = ?", middleware.GetUserAgent(ctx)).
		Where("id = ? AND used_at IS NULL AND expires_at > ?", grant.ID, now).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to consume impersonation link")
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to consume impersonation link")
	}
	if affected != 1 {
		return nil, huma.Error400BadRequest("impersonation link is invalid or expired")
	}

	sessionExpiresAt := now.Add(auth.TokenTTL)
	session, err := h.sessions.CreateSession(ctx, sessions.CreateInput{
		UserID:    target.ID,
		UserAgent: middleware.GetUserAgent(ctx),
		IPAddress: middleware.GetClientIP(ctx),
		ExpiresAt: sessionExpiresAt,
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create impersonated session")
	}
	token, err := h.authService.GenerateTokenWithSession(
		target.ID,
		target.Email,
		session.ID,
		sessionExpiresAt,
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create impersonated session")
	}

	out := &ConsumeUserImpersonationLinkOutput{}
	out.SetCookie = sessionCookie(token, sessionExpiresAt, middleware.IsSecureRequest(ctx)).String()
	out.Body.Message = "Impersonated session created"
	return out, nil
}

func newInstanceImpersonationCode() (string, string, error) {
	bytes := make([]byte, instanceImpersonationBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	raw := base64.RawURLEncoding.EncodeToString(bytes)
	return raw, hashInstanceImpersonationCode(raw), nil
}

func hashInstanceImpersonationCode(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func requireAnonymousImpersonationBrowser(api huma.API) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		if strings.TrimSpace(ctx.Header("Authorization")) != "" {
			_ = huma.WriteErr(api, ctx, http.StatusConflict, "open this link in a private browser window")
			return
		}

		request := &http.Request{Header: http.Header{"Cookie": []string{ctx.Header("Cookie")}}}
		if cookie, err := request.Cookie("openpost_session"); err == nil && strings.TrimSpace(cookie.Value) != "" {
			_ = huma.WriteErr(api, ctx, http.StatusConflict, "open this link in a private browser window")
			return
		}
		next(ctx)
	}
}

func requireUnscopedInstanceAdmin(ctx context.Context, db *bun.DB) error {
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		return huma.Error401Unauthorized("unauthorized")
	}
	if middleware.GetWorkspaceID(ctx) != "" {
		return huma.Error403Forbidden("instance admin API requires unscoped credentials")
	}

	var isAdmin bool
	if err := db.NewSelect().
		Model((*models.User)(nil)).
		Column("is_admin").
		Where("id = ?", userID).
		Scan(ctx, &isAdmin); err != nil {
		return huma.Error500InternalServerError("failed to load user")
	}
	if !isAdmin {
		return huma.Error403Forbidden("instance admin role required")
	}
	return nil
}

func requireBrowserSessionInstanceAdmin(ctx context.Context, db *bun.DB) error {
	if strings.TrimSpace(middleware.GetSessionID(ctx)) == "" {
		return huma.Error403Forbidden("instance admin API requires a browser session")
	}
	return requireUnscopedInstanceAdmin(ctx, db)
}

func instanceDailyMetrics(start time.Time, values []time.Time) []InstanceDailyMetric {
	counts := make(map[string]int, instanceAdminTrendDays)
	for _, value := range values {
		if value.IsZero() {
			continue
		}
		counts[value.UTC().Format(time.DateOnly)]++
	}
	metrics := make([]InstanceDailyMetric, 0, instanceAdminTrendDays)
	for day := 0; day < instanceAdminTrendDays; day++ {
		date := start.AddDate(0, 0, day).Format(time.DateOnly)
		metrics = append(metrics, InstanceDailyMetric{Date: date, Value: counts[date]})
	}
	return metrics
}

func formatInstanceAdminTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
