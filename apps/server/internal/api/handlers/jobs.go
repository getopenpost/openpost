package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type JobResponse struct {
	ID            string `json:"id" doc:"Job ID"`
	Type          string `json:"type" doc:"Job type"`
	Status        string `json:"status" doc:"Job status"`
	Payload       string `json:"payload,omitempty" doc:"Job payload"`
	RunAt         string `json:"run_at" doc:"Scheduled run time"`
	Attempts      int    `json:"attempts" doc:"Number of attempts"`
	MaxAttempts   int    `json:"max_attempts" doc:"Maximum attempts"`
	LastError     string `json:"last_error,omitempty" doc:"Last error message"`
	LockedAt      string `json:"locked_at,omitempty" doc:"When job was locked"`
	CreatedAt     string `json:"created_at" doc:"Creation time"`
	PublicationID string `json:"publication_id,omitempty" doc:"Publication associated with this job, when available"`
}

type GetJobInput struct {
	ID string `path:"id" doc:"Job ID"`
}

type GetJobOutput struct {
	Body JobResponse
}

type ListJobsInput struct {
	Limit       int    `query:"limit" doc:"Number of jobs to return (default 50, max 200)"`
	Offset      int    `query:"offset" doc:"Offset for pagination"`
	Cursor      string `query:"cursor" doc:"Opaque cursor for stable newest-first pagination"`
	Status      string `query:"status" doc:"Filter by status (pending, processing, completed, failed)"`
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	RunFrom     string `query:"run_from" doc:"Include jobs scheduled at or after this RFC3339 timestamp"`
	RunBefore   string `query:"run_before" doc:"Include jobs scheduled before this RFC3339 timestamp"`
}

type ListJobsOutput struct {
	TotalCount int    `header:"X-Total-Count" doc:"Total number of matching jobs"`
	Limit      int    `header:"X-Limit" doc:"Applied page limit"`
	Offset     int    `header:"X-Offset" doc:"Applied page offset"`
	NextOffset int    `header:"X-Next-Offset" doc:"Offset for the next page"`
	NextCursor string `header:"X-Next-Cursor" doc:"Opaque cursor for the next page"`
	HasMore    bool   `header:"X-Has-More" doc:"Whether another page is available"`
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
	huma.Register(api, huma.Operation{
		OperationID: "get-job",
		Method:      http.MethodGet,
		Path:        "/jobs/{id}",
		Summary:     "Get a background job",
		Tags:        []string{"Jobs"},
		Errors:      []int{http.StatusNotFound, http.StatusForbidden},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.getJob)
}

func (h *JobHandler) getJob(ctx context.Context, input *GetJobInput) (*GetJobOutput, error) {
	job, workspaceID, err := h.getWorkspaceScopedJob(ctx, strings.TrimSpace(input.ID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("job not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch job")
	}
	if workspaceID == "" {
		return nil, huma.Error404NotFound("job not found")
	}
	userID := middleware.GetUserID(ctx)
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return nil, huma.Error403Forbidden("workspace not accessible")
	}
	isAdmin, err := h.isInstanceAdmin(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load user")
	}
	responses := jobResponses([]models.Job{job}, isBrowserSessionInstanceAdmin(ctx, isAdmin))
	out := &GetJobOutput{}
	out.Body = responses[0]
	return out, nil
}

func (h *JobHandler) listJobs(ctx context.Context, input *ListJobsInput) (*ListJobsOutput, error) {
	userID := middleware.GetUserID(ctx)
	isAdmin, err := h.isInstanceAdmin(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load user")
	}
	browserAdmin := isBrowserSessionInstanceAdmin(ctx, isAdmin)

	limit, err := listJobsLimit(input)
	if err != nil {
		return nil, err
	}

	allowedWorkspaces, err := h.allowedWorkspaces(ctx, userID, isAdmin, input.WorkspaceID)
	if err != nil {
		return nil, listJobsScopeError(err)
	}
	if !hasListJobsWorkspaceScope(input, allowedWorkspaces, browserAdmin) {
		return listJobsOutput([]JobResponse{}, 0, limit, input.Offset), nil
	}
	pageCursor, runFrom, runBefore, err := validateListJobsPage(input)
	if err != nil {
		return nil, err
	}

	total, err := h.listJobsQuery((*models.Job)(nil), input, allowedWorkspaces, browserAdmin, runFrom, runBefore).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count jobs")
	}

	var jobs []models.Job
	query := h.listJobsQuery(&jobs, input, allowedWorkspaces, browserAdmin, runFrom, runBefore).
		ColumnExpr("job.*").
		Order("job.run_at DESC", "job.id DESC")
	if pageCursor != nil {
		query = query.Where(
			"(job.run_at < ? OR (job.run_at = ? AND job.id < ?))",
			pageCursor.Timestamp,
			pageCursor.Timestamp,
			pageCursor.ID,
		)
	} else {
		query = query.Offset(input.Offset)
	}
	scanLimit := limit
	if pageCursor != nil {
		scanLimit++
	}
	query = query.Limit(scanLimit)
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch jobs")
	}
	cursorHasMore := pageCursor != nil && len(jobs) > limit
	if cursorHasMore {
		jobs = jobs[:limit]
	}
	output := listJobsOutput(jobResponses(jobs, browserAdmin), total, limit, input.Offset)
	if pageCursor != nil {
		output.HasMore = cursorHasMore
	}
	if output.HasMore && len(jobs) > 0 {
		last := jobs[len(jobs)-1]
		output.NextCursor = encodeTimestampIDCursor(last.RunAt, last.ID)
	}
	return output, nil
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

func validateListJobsPage(input *ListJobsInput) (*timestampIDCursor, time.Time, time.Time, error) {
	if input.Cursor != "" && input.Offset != 0 {
		return nil, time.Time{}, time.Time{}, huma.Error400BadRequest("cursor and offset cannot be used together")
	}
	runFrom, err := parseOptionalRFC3339(input.RunFrom)
	if err != nil {
		return nil, time.Time{}, time.Time{}, huma.Error400BadRequest("run_from must use RFC3339")
	}
	runBefore, err := parseOptionalRFC3339(input.RunBefore)
	if err != nil {
		return nil, time.Time{}, time.Time{}, huma.Error400BadRequest("run_before must use RFC3339")
	}
	if !runFrom.IsZero() && !runBefore.IsZero() && !runFrom.Before(runBefore) {
		return nil, time.Time{}, time.Time{}, huma.Error400BadRequest("run_from must be before run_before")
	}
	if input.Cursor == "" {
		return nil, runFrom, runBefore, nil
	}
	cursor, err := parseTimestampIDCursor(input.Cursor)
	if err != nil {
		return nil, time.Time{}, time.Time{}, huma.Error400BadRequest("invalid job cursor")
	}
	return &cursor, runFrom, runBefore, nil
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
			ID:            j.ID,
			Type:          j.Type,
			Status:        j.Status,
			RunAt:         j.RunAt.Format(time.RFC3339),
			Attempts:      j.Attempts,
			MaxAttempts:   j.MaxAttempts,
			LastError:     j.LastError,
			PublicationID: jobPublicationID(j),
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

func jobPublicationID(job models.Job) string {
	if (job.Type == jobTypePublishPublication || job.Type == jobTypePublishPost) && strings.TrimSpace(job.ScopeID) != "" {
		return strings.TrimSpace(job.ScopeID)
	}
	var subject struct {
		PublicationID string `json:"publication_id"`
	}
	if err := json.Unmarshal([]byte(job.Payload), &subject); err != nil {
		return ""
	}
	return strings.TrimSpace(subject.PublicationID)
}

func (h *JobHandler) getWorkspaceScopedJob(ctx context.Context, jobID string) (models.Job, string, error) {
	var job models.Job
	if err := h.db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx); err != nil {
		return models.Job{}, "", err
	}

	var workspaceID string
	publicationScopeExpr := "COALESCE(NULLIF(TRIM(job.scope_id), ''), " +
		safeJobPayloadTextExpr(h.db, "publication_id") + ")"
	err := h.db.NewSelect().
		TableExpr("jobs AS job").
		ColumnExpr("COALESCE(publication.workspace_id, sa.workspace_id, '')").
		Join("LEFT JOIN publications AS publication ON job.type IN (?, ?) AND publication.id = "+publicationScopeExpr, jobTypePublishPublication, jobTypePublishPost).
		Join("LEFT JOIN social_accounts AS sa ON sa.id = "+safeJobPayloadTextExpr(h.db, "account_id")).
		Where("job.id = ?", jobID).
		Scan(ctx, &workspaceID)
	if err != nil {
		return models.Job{}, "", err
	}
	return job, strings.TrimSpace(workspaceID), nil
}

func (h *JobHandler) listJobsQuery(
	model interface{},
	input *ListJobsInput,
	allowedWorkspaces map[string]bool,
	isAdmin bool,
	runFrom time.Time,
	runBefore time.Time,
) *bun.SelectQuery {
	publicationScopeExpr := "COALESCE(NULLIF(TRIM(job.scope_id), ''), " +
		safeJobPayloadTextExpr(h.db, "publication_id") + ")"
	query := h.db.NewSelect().
		Model(model).
		ModelTableExpr("jobs AS job").
		Join("LEFT JOIN publications AS publication ON job.type IN (?, ?) AND publication.id = "+publicationScopeExpr, jobTypePublishPublication, jobTypePublishPost).
		Join("LEFT JOIN social_accounts AS sa ON sa.id = " + safeJobPayloadTextExpr(h.db, "account_id"))

	if input.Status != "" {
		query = query.Where("job.status = ?", input.Status)
	}
	if !runFrom.IsZero() {
		query = query.Where("job.run_at >= ?", runFrom)
	}
	if !runBefore.IsZero() {
		query = query.Where("job.run_at < ?", runBefore)
	}
	if input.WorkspaceID != "" {
		return query.Where("COALESCE(publication.workspace_id, sa.workspace_id) = ?", input.WorkspaceID)
	}
	if isAdmin {
		return query
	}

	workspaceIDs := make([]string, 0, len(allowedWorkspaces))
	for workspaceID := range allowedWorkspaces {
		workspaceIDs = append(workspaceIDs, workspaceID)
	}
	return query.Where("COALESCE(publication.workspace_id, sa.workspace_id) IN (?)", bun.List(workspaceIDs))
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

func isBrowserSessionInstanceAdmin(ctx context.Context, isAdmin bool) bool {
	return isAdmin && strings.TrimSpace(middleware.GetSessionID(ctx)) != ""
}

func (h *JobHandler) allowedWorkspaces(ctx context.Context, userID string, isAdmin bool, requestedWorkspaceID string) (map[string]bool, error) {
	browserAdmin := isBrowserSessionInstanceAdmin(ctx, isAdmin)
	scopedWorkspaceID := middleware.GetWorkspaceID(ctx)
	if requestedWorkspaceID != "" {
		if scopedWorkspaceID != "" && scopedWorkspaceID != requestedWorkspaceID {
			return nil, huma.Error403Forbidden("workspace not accessible")
		}
		if browserAdmin {
			return map[string]bool{requestedWorkspaceID: true}, nil
		}

		allowed, err := workspaceReadAllowed(ctx, h.db, requestedWorkspaceID, userID)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, huma.Error403Forbidden("workspace not accessible")
		}
		return map[string]bool{requestedWorkspaceID: true}, nil
	}

	if scopedWorkspaceID != "" {
		if !browserAdmin {
			allowed, err := workspaceReadAllowed(ctx, h.db, scopedWorkspaceID, userID)
			if err != nil {
				return nil, err
			}
			if !allowed {
				return nil, huma.Error403Forbidden("workspace not accessible")
			}
		}
		return map[string]bool{scopedWorkspaceID: true}, nil
	}

	if browserAdmin {
		// An unscoped instance-administrator browser session intentionally
		// retains the global operational queue view.
		return nil, nil
	}

	var members []models.WorkspaceMember
	if err := h.db.NewSelect().
		Model(&members).
		Where("user_id = ? AND status = ?", userID, models.WorkspaceMemberStatusActive).
		Scan(ctx); err != nil {
		return nil, err
	}

	return h.filterAccessibleMemberWorkspaces(ctx, userID, members)
}

func (h *JobHandler) filterAccessibleMemberWorkspaces(
	ctx context.Context,
	userID string,
	members []models.WorkspaceMember,
) (map[string]bool, error) {
	allowed := make(map[string]bool, len(members))
	for _, member := range members {
		workspaceAllowed, err := workspaceReadAllowed(ctx, h.db, member.WorkspaceID, userID)
		if err != nil {
			return nil, err
		}
		if workspaceAllowed {
			allowed[member.WorkspaceID] = true
		}
	}
	return allowed, nil
}
