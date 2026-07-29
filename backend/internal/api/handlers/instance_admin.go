package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const instanceAdminTrendDays = 30

type InstanceAdminHandler struct {
	db   *bun.DB
	auth middleware.Authenticator
	now  func() time.Time
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
	Page    int `query:"page" default:"1" minimum:"1" doc:"One-based page number"`
	PerPage int `query:"per_page" default:"20" minimum:"1" maximum:"100" doc:"Users per page"`
}

type InstanceUserResponse struct {
	ID             string `json:"id" doc:"User ID"`
	Email          string `json:"email" doc:"User email address"`
	DisplayName    string `json:"display_name" doc:"User display name"`
	AvatarURL      string `json:"avatar_url" doc:"Profile avatar URL"`
	IsAdmin        bool   `json:"is_admin" doc:"Whether the user is an instance administrator"`
	WorkspaceCount int    `json:"workspace_count" doc:"Number of workspaces the user can access"`
	CreatedAt      string `json:"created_at" doc:"Account creation time"`
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
	ID             string    `bun:"id"`
	Email          string    `bun:"email"`
	DisplayName    string    `bun:"display_name"`
	AvatarURL      string    `bun:"avatar_url"`
	IsAdmin        bool      `bun:"is_admin"`
	WorkspaceCount int       `bun:"workspace_count"`
	CreatedAt      time.Time `bun:"created_at"`
}

func NewInstanceAdminHandler(db *bun.DB, authenticator middleware.Authenticator) *InstanceAdminHandler {
	return &InstanceAdminHandler{db: db, auth: authenticator, now: func() time.Time { return time.Now().UTC() }}
}

func (h *InstanceAdminHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.auth)
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
}

func (h *InstanceAdminHandler) getOverview(ctx context.Context, _ *struct{}) (*GetInstanceOverviewOutput, error) {
	if err := requireUnscopedInstanceAdmin(ctx, h.db); err != nil {
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
	if err := requireUnscopedInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}

	total, err := h.db.NewSelect().Model((*models.User)(nil)).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count users")
	}

	var rows []instanceUserRow
	if err := h.db.NewSelect().
		TableExpr("users AS instance_user").
		Column(
			"instance_user.id",
			"instance_user.email",
			"instance_user.display_name",
			"instance_user.avatar_url",
			"instance_user.is_admin",
			"instance_user.created_at",
		).
		ColumnExpr("(SELECT COUNT(*) FROM workspace_members AS member WHERE member.user_id = instance_user.id) AS workspace_count").
		Order("instance_user.created_at DESC", "instance_user.id ASC").
		Limit(input.PerPage).
		Offset((input.Page-1)*input.PerPage).
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to list users")
	}

	users := make([]InstanceUserResponse, 0, len(rows))
	for _, row := range rows {
		users = append(users, InstanceUserResponse{
			ID:             row.ID,
			Email:          row.Email,
			DisplayName:    row.DisplayName,
			AvatarURL:      row.AvatarURL,
			IsAdmin:        row.IsAdmin,
			WorkspaceCount: row.WorkspaceCount,
			CreatedAt:      formatInstanceAdminTime(row.CreatedAt),
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
