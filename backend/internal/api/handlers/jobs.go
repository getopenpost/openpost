package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type JobResponse struct {
	ID          string `json:"id" doc:"Job ID"`
	Type        string `json:"type" doc:"Job type"`
	Status      string `json:"status" doc:"Job status"`
	Payload     string `json:"payload,omitempty" doc:"Job payload"`
	RunAt       string `json:"run_at" doc:"Scheduled run time"`
	Attempts    int    `json:"attempts" doc:"Number of attempts"`
	MaxAttempts int    `json:"max_attempts" doc:"Maximum attempts"`
	LastError   string `json:"last_error,omitempty" doc:"Last error message"`
	LockedAt    string `json:"locked_at,omitempty" doc:"When job was locked"`
	CreatedAt   string `json:"created_at" doc:"Creation time"`
}

type ListJobsInput struct {
	Limit       int    `query:"limit" doc:"Number of jobs to return (default 50, max 200)"`
	Offset      int    `query:"offset" doc:"Offset for pagination"`
	Status      string `query:"status" doc:"Filter by status (pending, processing, completed, failed)"`
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
}

type ListJobsOutput struct {
	TotalCount int  `header:"X-Total-Count" doc:"Total number of matching jobs"`
	Limit      int  `header:"X-Limit" doc:"Applied page limit"`
	Offset     int  `header:"X-Offset" doc:"Applied page offset"`
	NextOffset int  `header:"X-Next-Offset" doc:"Offset for the next page"`
	HasMore    bool `header:"X-Has-More" doc:"Whether another page is available"`
	Body       []JobResponse
}

type JobHandler struct {
	db   *bun.DB
	auth middleware.Authenticator
}

func NewJobHandler(db *bun.DB, authenticator middleware.Authenticator) *JobHandler {
	return &JobHandler{db: db, auth: authenticator}
}

func (h *JobHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-jobs",
		Method:      http.MethodGet,
		Path:        "/jobs",
		Summary:     "List recent background jobs",
		Tags:        []string{"Jobs"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.listJobs)
}

func (h *JobHandler) listJobs(ctx context.Context, input *ListJobsInput) (*ListJobsOutput, error) {
	userID := middleware.GetUserID(ctx)
	isAdmin, err := h.isInstanceAdmin(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load user")
	}

	limit, err := listJobsLimit(input)
	if err != nil {
		return nil, err
	}

	allowedWorkspaces, err := h.allowedWorkspaces(ctx, userID, isAdmin, input.WorkspaceID)
	if err != nil {
		return nil, listJobsScopeError(err)
	}
	if !hasListJobsWorkspaceScope(input, allowedWorkspaces, isAdmin) {
		return listJobsOutput([]JobResponse{}, 0, limit, input.Offset), nil
	}

	total, err := h.listJobsQuery((*models.Job)(nil), input, allowedWorkspaces, isAdmin).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count jobs")
	}

	var jobs []models.Job
	query := h.listJobsQuery(&jobs, input, allowedWorkspaces, isAdmin).
		ColumnExpr("job.*").
		Order("job.run_at DESC").
		Limit(limit).
		Offset(input.Offset)
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch jobs")
	}

	return listJobsOutput(jobResponses(jobs, isAdmin), total, limit, input.Offset), nil
}

func listJobsLimit(input *ListJobsInput) (int, error) {
	if input.Offset < 0 {
		return 0, huma.Error400BadRequest("offset must be greater than or equal to 0")
	}
	if input.Limit <= 0 || input.Limit > 200 {
		return 50, nil
	}
	return input.Limit, nil
}

func listJobsScopeError(err error) error {
	var humaErr huma.StatusError
	if errors.As(err, &humaErr) {
		return humaErr
	}
	return huma.Error500InternalServerError("failed to resolve workspace scope")
}

func hasListJobsWorkspaceScope(input *ListJobsInput, allowedWorkspaces map[string]bool, isAdmin bool) bool {
	return input.WorkspaceID != "" || isAdmin || len(allowedWorkspaces) > 0
}

func jobResponses(jobs []models.Job, includePayload bool) []JobResponse {
	resp := make([]JobResponse, 0, len(jobs))
	for _, j := range jobs {
		item := JobResponse{
			ID:          j.ID,
			Type:        j.Type,
			Status:      j.Status,
			RunAt:       j.RunAt.Format(time.RFC3339),
			Attempts:    j.Attempts,
			MaxAttempts: j.MaxAttempts,
			LastError:   j.LastError,
		}
		if !j.LockedAt.IsZero() {
			item.LockedAt = j.LockedAt.Format(time.RFC3339)
		}
		if includePayload {
			item.Payload = j.Payload
		}
		resp = append(resp, item)
	}
	return resp
}

func (h *JobHandler) listJobsQuery(model interface{}, input *ListJobsInput, allowedWorkspaces map[string]bool, isAdmin bool) *bun.SelectQuery {
	query := h.db.NewSelect().
		Model(model).
		ModelTableExpr("jobs AS job").
		Join("LEFT JOIN posts AS p ON p.id = " + aliasedJobPayloadTextExpr(h.db, "job", postIDKey)).
		Join("LEFT JOIN social_accounts AS sa ON sa.id = " + aliasedJobPayloadTextExpr(h.db, "job", "account_id"))

	if input.Status != "" {
		query = query.Where("job.status = ?", input.Status)
	}
	if input.WorkspaceID != "" {
		return query.Where("COALESCE(p.workspace_id, sa.workspace_id) = ?", input.WorkspaceID)
	}
	if isAdmin {
		return query
	}

	workspaceIDs := make([]string, 0, len(allowedWorkspaces))
	for workspaceID := range allowedWorkspaces {
		workspaceIDs = append(workspaceIDs, workspaceID)
	}
	return query.Where("COALESCE(p.workspace_id, sa.workspace_id) IN (?)", bun.List(workspaceIDs))
}

func listJobsOutput(body []JobResponse, total, limit, offset int) *ListJobsOutput {
	out := &ListJobsOutput{
		TotalCount: total,
		Limit:      limit,
		Offset:     offset,
		NextOffset: offset + len(body),
		HasMore:    offset+len(body) < total,
		Body:       body,
	}
	return out
}

func (h *JobHandler) isInstanceAdmin(ctx context.Context, userID string) (bool, error) {
	var user models.User
	if err := h.db.NewSelect().
		Model(&user).
		Where("id = ?", userID).
		Scan(ctx); err != nil {
		return false, err
	}
	return user.IsAdmin, nil
}

func (h *JobHandler) allowedWorkspaces(ctx context.Context, userID string, isAdmin bool, requestedWorkspaceID string) (map[string]bool, error) {
	scopedWorkspaceID := middleware.GetWorkspaceID(ctx)
	if requestedWorkspaceID != "" {
		if scopedWorkspaceID != "" && scopedWorkspaceID != requestedWorkspaceID {
			return nil, huma.Error403Forbidden("workspace not accessible")
		}
		if isAdmin {
			return map[string]bool{requestedWorkspaceID: true}, nil
		}

		count, err := h.db.NewSelect().
			Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id = ?", requestedWorkspaceID, userID).
			Count(ctx)
		if err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, huma.Error403Forbidden("workspace not accessible")
		}
		return map[string]bool{requestedWorkspaceID: true}, nil
	}

	if scopedWorkspaceID != "" {
		return map[string]bool{scopedWorkspaceID: true}, nil
	}

	if isAdmin {
		return nil, nil
	}

	var members []models.WorkspaceMember
	if err := h.db.NewSelect().
		Model(&members).
		Where("user_id = ?", userID).
		Scan(ctx); err != nil {
		return nil, err
	}

	allowed := make(map[string]bool, len(members))
	for _, member := range members {
		allowed[member.WorkspaceID] = true
	}
	return allowed, nil
}
