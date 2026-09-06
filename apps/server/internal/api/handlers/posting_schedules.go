package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type PostingScheduleHandler struct {
	db   *bun.DB
	auth middleware.Authenticator
}

func NewPostingScheduleHandler(db *bun.DB, authenticator middleware.Authenticator) *PostingScheduleHandler {
	return &PostingScheduleHandler{db: db, auth: authenticator}
}

func (h *PostingScheduleHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *PostingScheduleHandler) checkWorkspaceAdminAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceAdminAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace admin role required")
	}
	return nil
}

type PostingScheduleResponse struct {
	ID             string `json:"id" doc:"Schedule ID"`
	WorkspaceID    string `json:"workspace_id" doc:"Workspace ID"`
	UTCHour        int    `json:"utc_hour" doc:"Legacy field name for the workspace-local hour (0-23)"`
	UTCMinute      int    `json:"utc_minute" doc:"Legacy field name for the workspace-local minute (0-59)"`
	DayOfWeek      int    `json:"day_of_week" doc:"Workspace-local day of week (0=Sunday, 6=Saturday)"`
	LocalHour      int    `json:"local_hour" doc:"Hour in workspace local time (0-23)"`
	LocalMinute    int    `json:"local_minute" doc:"Minute in workspace local time (0-59)"`
	LocalDayOfWeek int    `json:"local_day_of_week" doc:"Day of week in workspace local time (0=Sunday, 6=Saturday)"`
	Label          string `json:"label,omitempty" doc:"Display label (e.g., Morning, Lunch)"`
	IsActive       bool   `json:"is_active" doc:"Whether this slot is active"`
	CreatedAt      string `json:"created_at" doc:"Creation time (ISO 8601)"`
}

type ListPostingSchedulesInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
}

type ListPostingSchedulesOutput struct {
	Body []PostingScheduleResponse
}

func (h *PostingScheduleHandler) ListSchedules(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-posting-schedules",
		Method:      http.MethodGet,
		Path:        "/posting-schedules",
		Summary:     "List posting schedules for a workspace",
		Tags:        []string{tagPostingSchedules},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403},
	}, func(ctx context.Context, input *ListPostingSchedulesInput) (*ListPostingSchedulesOutput, error) {
		userID := middleware.GetUserID(ctx)

		if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}

		var workspace models.Workspace
		if err := h.db.NewSelect().Model(&workspace).Where("id = ?", input.WorkspaceID).Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace")
		}
		loc, err := time.LoadLocation(workspace.Timezone)
		if err != nil {
			loc = time.UTC
		}

		var schedules []models.PostingSchedule
		query := h.db.NewSelect().
			Model(&schedules).
			Where("workspace_id = ?", input.WorkspaceID)

		query = query.Order("day_of_week ASC", "utc_hour ASC", "utc_minute ASC")

		if err := query.Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch schedules")
		}

		resp := make([]PostingScheduleResponse, len(schedules))
		for i, s := range schedules {
			resp[i] = postingScheduleResponseForWorkspace(time.Now(), loc, s)
		}

		return &ListPostingSchedulesOutput{Body: resp}, nil
	})
}

type CreatePostingScheduleInput struct {
	Body struct {
		WorkspaceID    string `json:"workspace_id" doc:"Workspace ID"`
		UTCHour        int    `json:"utc_hour" doc:"Legacy field name for the workspace-local hour (0-23)"`
		UTCMinute      int    `json:"utc_minute" doc:"Legacy field name for the workspace-local minute (0-59)"`
		DayOfWeek      int    `json:"day_of_week" doc:"Workspace-local day of week (0=Sunday, 6=Saturday)"`
		LocalHour      *int   `json:"local_hour,omitempty" doc:"Hour in workspace local time (0-23)"`
		LocalMinute    *int   `json:"local_minute,omitempty" doc:"Minute in workspace local time (0-59)"`
		LocalDayOfWeek *int   `json:"local_day_of_week,omitempty" doc:"Day of week in workspace local time (0=Sunday, 6=Saturday)"`
		Label          string `json:"label,omitempty" doc:"Display label"`
	}
}

type CreatePostingScheduleOutput struct {
	Body PostingScheduleResponse
}

//nolint:gocyclo
func (h *PostingScheduleHandler) CreateSchedule(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-posting-schedule",
		Method:      http.MethodPost,
		Path:        "/posting-schedules",
		Summary:     "Create a new posting schedule slot",
		Tags:        []string{tagPostingSchedules},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreatePostingScheduleInput) (*CreatePostingScheduleOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Validate inputs
		if input.Body.UTCHour < 0 || input.Body.UTCHour > 23 {
			return nil, huma.Error400BadRequest("utc_hour must be between 0 and 23")
		}
		if input.Body.UTCMinute < 0 || input.Body.UTCMinute > 59 {
			return nil, huma.Error400BadRequest("utc_minute must be between 0 and 59")
		}
		if input.Body.DayOfWeek < 0 || input.Body.DayOfWeek > 6 {
			return nil, huma.Error400BadRequest("day_of_week must be between 0 (Sunday) and 6 (Saturday)")
		}

		if err := h.checkWorkspaceAdminAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		var workspace models.Workspace
		if err := h.db.NewSelect().Model(&workspace).Where("id = ?", input.Body.WorkspaceID).Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace")
		}
		loc, err := time.LoadLocation(workspace.Timezone)
		if err != nil {
			loc = time.UTC
		}

		utcDayOfWeek := input.Body.DayOfWeek
		utcHour := input.Body.UTCHour
		utcMinute := input.Body.UTCMinute
		if input.Body.LocalDayOfWeek != nil || input.Body.LocalHour != nil || input.Body.LocalMinute != nil {
			if input.Body.LocalDayOfWeek == nil || input.Body.LocalHour == nil || input.Body.LocalMinute == nil {
				return nil, huma.Error400BadRequest("local_day_of_week, local_hour, and local_minute must be provided together")
			}
			if *input.Body.LocalDayOfWeek < 0 || *input.Body.LocalDayOfWeek > 6 {
				return nil, huma.Error400BadRequest("local_day_of_week must be between 0 (Sunday) and 6 (Saturday)")
			}
			if *input.Body.LocalHour < 0 || *input.Body.LocalHour > 23 {
				return nil, huma.Error400BadRequest("local_hour must be between 0 and 23")
			}
			if *input.Body.LocalMinute < 0 || *input.Body.LocalMinute > 59 {
				return nil, huma.Error400BadRequest("local_minute must be between 0 and 59")
			}
			utcDayOfWeek, utcHour, utcMinute = encodeLocalScheduleForStorage(loc, *input.Body.LocalDayOfWeek, *input.Body.LocalHour, *input.Body.LocalMinute)
		}

		schedule := &models.PostingSchedule{
			ID:          uuid.New().String(),
			WorkspaceID: input.Body.WorkspaceID,
			UTCHour:     utcHour,
			UTCMinute:   utcMinute,
			DayOfWeek:   utcDayOfWeek,
			Label:       input.Body.Label,
			IsActive:    true,
			CreatedAt:   time.Now().UTC(),
		}

		if _, err := h.db.NewInsert().Model(schedule).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to create schedule")
		}

		return &CreatePostingScheduleOutput{Body: postingScheduleResponseForWorkspace(time.Now(), loc, *schedule)}, nil
	})
}

type UpdatePostingScheduleInput struct {
	PathID string `path:"id" doc:"Schedule ID"`
	Body   struct {
		UTCHour   *int    `json:"utc_hour,omitempty" doc:"Legacy field name for the workspace-local hour (0-23)"`
		UTCMinute *int    `json:"utc_minute,omitempty" doc:"Legacy field name for the workspace-local minute (0-59)"`
		DayOfWeek *int    `json:"day_of_week,omitempty" doc:"Workspace-local day of week (0=Sunday, 6=Saturday)"`
		Label     *string `json:"label,omitempty" doc:"Display label"`
		IsActive  *bool   `json:"is_active,omitempty" doc:"Whether this slot is active"`
	}
}

type UpdatePostingScheduleOutput struct {
	Body PostingScheduleResponse
}

//nolint:gocyclo
func (h *PostingScheduleHandler) UpdateSchedule(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-posting-schedule",
		Method:      http.MethodPatch,
		Path:        "/posting-schedules/{id}",
		Summary:     "Update a posting schedule slot",
		Tags:        []string{tagPostingSchedules},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *UpdatePostingScheduleInput) (*UpdatePostingScheduleOutput, error) {
		userID := middleware.GetUserID(ctx)

		var schedule models.PostingSchedule
		err := h.db.NewSelect().
			Model(&schedule).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("schedule not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch schedule")
		}

		if err := h.checkWorkspaceAdminAccess(ctx, schedule.WorkspaceID, userID); err != nil {
			return nil, err
		}

		// Validate and update fields
		if input.Body.UTCHour != nil {
			if *input.Body.UTCHour < 0 || *input.Body.UTCHour > 23 {
				return nil, huma.Error400BadRequest("utc_hour must be between 0 and 23")
			}
			schedule.UTCHour = *input.Body.UTCHour
		}
		if input.Body.UTCMinute != nil {
			if *input.Body.UTCMinute < 0 || *input.Body.UTCMinute > 59 {
				return nil, huma.Error400BadRequest("utc_minute must be between 0 and 59")
			}
			schedule.UTCMinute = *input.Body.UTCMinute
		}
		if input.Body.DayOfWeek != nil {
			if *input.Body.DayOfWeek < 0 || *input.Body.DayOfWeek > 6 {
				return nil, huma.Error400BadRequest("day_of_week must be between 0 (Sunday) and 6 (Saturday)")
			}
			schedule.DayOfWeek = *input.Body.DayOfWeek
		}
		if input.Body.Label != nil {
			schedule.Label = *input.Body.Label
		}
		if input.Body.IsActive != nil {
			schedule.IsActive = *input.Body.IsActive
		}

		if _, err := h.db.NewUpdate().Model(&schedule).
			Column("utc_hour", "utc_minute", "day_of_week", "label", "is_active").
			Where("id = ?", input.PathID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to update schedule")
		}

		return &UpdatePostingScheduleOutput{Body: postingScheduleResponseFromModel(schedule)}, nil
	})
}

type DeletePostingScheduleInput struct {
	PathID string `path:"id" doc:"Schedule ID"`
}

type DeletePostingScheduleOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

func (h *PostingScheduleHandler) DeleteSchedule(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-posting-schedule",
		Method:      http.MethodDelete,
		Path:        "/posting-schedules/{id}",
		Summary:     "Delete a posting schedule slot",
		Tags:        []string{tagPostingSchedules},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *DeletePostingScheduleInput) (*DeletePostingScheduleOutput, error) {
		userID := middleware.GetUserID(ctx)

		var schedule models.PostingSchedule
		err := h.db.NewSelect().
			Model(&schedule).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("schedule not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch schedule")
		}

		if err := h.checkWorkspaceAdminAccess(ctx, schedule.WorkspaceID, userID); err != nil {
			return nil, err
		}

		if _, err := h.db.NewDelete().Model(&schedule).Where("id = ?", input.PathID).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to delete schedule")
		}

		return &DeletePostingScheduleOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "schedule deleted successfully"}}, nil
	})
}

type SuggestScheduleInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		PostsPerDay int    `json:"posts_per_day" doc:"Number of posts per day (1-10)"`
	}
}

type SuggestScheduleOutput struct {
	Body struct {
		Schedules []PostingScheduleResponse `json:"schedules" doc:"Created schedule slots"`
		Message   string                    `json:"message" doc:"Message about the result"`
	}
}

type NextAvailableSlotInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Workspace ID"`
}

type NextAvailableSlotOutput struct {
	Body struct {
		Slot     *PostingScheduleResponse `json:"slot,omitempty" doc:"Next available schedule slot"`
		SlotTime string                   `json:"slot_time" doc:"The suggested time in ISO 8601 format"`
		Message  string                   `json:"message" doc:"Message about the result"`
	}
}

type localizedScheduleSlot struct {
	Schedule     models.PostingSchedule
	LocalWeekday int
	LocalHour    int
	LocalMinute  int
}

func localizeScheduleSlot(_ time.Time, _ *time.Location, schedule models.PostingSchedule) localizedScheduleSlot {
	return localizedScheduleSlot{
		Schedule:     schedule,
		LocalWeekday: schedule.DayOfWeek,
		LocalHour:    schedule.UTCHour,
		LocalMinute:  schedule.UTCMinute,
	}
}

func sameMinute(a, b time.Time) bool {
	return a.UTC().Truncate(time.Minute).Equal(b.UTC().Truncate(time.Minute))
}

func postingScheduleResponseFromModel(schedule models.PostingSchedule) PostingScheduleResponse {
	return PostingScheduleResponse{
		ID:          schedule.ID,
		WorkspaceID: schedule.WorkspaceID,
		UTCHour:     schedule.UTCHour,
		UTCMinute:   schedule.UTCMinute,
		DayOfWeek:   schedule.DayOfWeek,
		Label:       schedule.Label,
		IsActive:    schedule.IsActive,
		CreatedAt:   schedule.CreatedAt.Format(time.RFC3339),
	}
}

func postingScheduleResponseForWorkspace(reference time.Time, loc *time.Location, schedule models.PostingSchedule) PostingScheduleResponse {
	resp := postingScheduleResponseFromModel(schedule)
	localized := localizeScheduleSlot(reference, loc, schedule)
	resp.LocalHour = localized.LocalHour
	resp.LocalMinute = localized.LocalMinute
	resp.LocalDayOfWeek = localized.LocalWeekday
	return resp
}

// The column names predate wall-clock schedule semantics. Keep the local values
// unchanged so a 09:00 slot remains at 09:00 when the workspace enters or leaves DST.
func encodeLocalScheduleForStorage(_ *time.Location, localDayOfWeek, localHour, localMinute int) (int, int, int) {
	return localDayOfWeek, localHour, localMinute
}

type scheduleCandidate struct {
	schedule models.PostingSchedule
	when     time.Time
}

func isSlotOccupied(scheduledPublications []models.Publication, slotTime time.Time, workspaceDelayMinutes int) bool {
	for _, publication := range scheduledPublications {
		if sameMinute(publication.ScheduledAt, slotTime) {
			return true
		}
		existingDelay := workspaceDelayMinutes
		if publication.RandomDelayExplicit {
			existingDelay = publication.RandomDelayMinutes
		}
		window := time.Duration(existingDelay+workspaceDelayMinutes) * time.Minute
		if window > 0 && absDuration(publication.ScheduledAt.Sub(slotTime)) < window {
			return true
		}
	}
	return false
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func findNextConfiguredScheduleSlotTime(
	now time.Time,
	loc *time.Location,
	schedules []models.PostingSchedule,
	scheduledPublications []models.Publication,
	workspaceDelayMinutes int,
) (*models.PostingSchedule, time.Time) {
	if len(schedules) == 0 {
		return nil, time.Time{}
	}

	localizedSlots := make([]localizedScheduleSlot, 0, len(schedules))
	for _, schedule := range schedules {
		localizedSlots = append(localizedSlots, localizeScheduleSlot(now, loc, schedule))
	}

	for dayOffset := 0; dayOffset < 30; dayOffset++ {
		dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, dayOffset)

		candidates := make([]scheduleCandidate, 0)

		for _, slot := range localizedSlots {
			if slot.LocalWeekday != int(dayStart.Weekday()) {
				continue
			}
			slotTime := time.Date(dayStart.Year(), dayStart.Month(), dayStart.Day(), slot.LocalHour, slot.LocalMinute, 0, 0, loc)
			if !slotTime.After(now) {
				continue
			}
			if isSlotOccupied(scheduledPublications, slotTime, workspaceDelayMinutes) {
				continue
			}
			candidates = append(candidates, scheduleCandidate{schedule: slot.Schedule, when: slotTime})
		}

		sort.Slice(candidates, func(i, j int) bool { return candidates[i].when.Before(candidates[j].when) })
		if len(candidates) > 0 {
			return &candidates[0].schedule, candidates[0].when
		}
	}

	return nil, time.Time{}
}

func (h *PostingScheduleHandler) SuggestSchedule(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "suggest-posting-schedule",
		Method:      http.MethodPost,
		Path:        "/posting-schedules/suggest",
		Summary:     "Generate a suggested posting schedule",
		Tags:        []string{tagPostingSchedules},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *SuggestScheduleInput) (*SuggestScheduleOutput, error) {
		userID := middleware.GetUserID(ctx)

		if input.Body.PostsPerDay < 1 || input.Body.PostsPerDay > 10 {
			return nil, huma.Error400BadRequest("posts_per_day must be between 1 and 10")
		}

		if err := h.checkWorkspaceAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		// Get workspace timezone
		var workspace models.Workspace
		err := h.db.NewSelect().Model(&workspace).Where("id = ?", input.Body.WorkspaceID).Scan(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace")
		}

		// Define optimal posting times in local timezone
		suggestionTemplates := map[int][]struct {
			Hour   int
			Minute int
			Label  string
		}{
			1:  {{10, 0, postingLabelLateMorning}},
			2:  {{8, 0, postingLabelMorning}, {18, 0, postingLabelEvening}},
			3:  {{8, 0, postingLabelMorning}, {12, 0, postingLabelLunch}, {18, 0, postingLabelEvening}},
			4:  {{8, 0, postingLabelMorning}, {11, 0, postingLabelLateMorning}, {14, 0, postingLabelAfternoon}, {18, 0, postingLabelEvening}},
			5:  {{8, 0, postingLabelMorning}, {11, 0, postingLabelLateMorning}, {14, 0, postingLabelAfternoon}, {17, 0, postingLabelLateAfternoon}, {20, 0, postingLabelNight}},
			6:  {{8, 0, postingLabelMorning}, {10, 0, postingLabelLateMorning}, {12, 0, postingLabelLunch}, {15, 0, postingLabelAfternoon}, {18, 0, postingLabelEvening}, {21, 0, postingLabelNight}},
			7:  {{7, 0, postingLabelEarlyMorning}, {9, 0, postingLabelMorning}, {11, 0, postingLabelLateMorning}, {13, 0, postingLabelLunch}, {15, 0, postingLabelAfternoon}, {18, 0, postingLabelEvening}, {21, 0, postingLabelNight}},
			8:  {{7, 0, postingLabelEarlyMorning}, {9, 0, postingLabelMorning}, {11, 0, postingLabelLateMorning}, {13, 0, postingLabelLunch}, {15, 0, postingLabelAfternoon}, {17, 0, postingLabelLateAfternoon}, {19, 0, postingLabelEvening}, {21, 0, postingLabelNight}},
			9:  {{7, 0, postingLabelEarlyMorning}, {9, 0, postingLabelMorning}, {11, 0, postingLabelLateMorning}, {13, 0, postingLabelLunch}, {14, 0, postingLabelAfternoon}, {16, 0, postingLabelLateAfternoon}, {18, 0, postingLabelEvening}, {20, 0, postingLabelNight}, {22, 0, postingLabelLateNight}},
			10: {{7, 0, postingLabelEarlyMorning}, {9, 0, postingLabelMorning}, {10, 0, postingLabelLateMorning}, {12, 0, postingLabelLunch}, {13, 0, postingLabelAfternoon}, {15, 0, postingLabelLateAfternoon}, {17, 0, postingLabelLateAfternoon}, {18, 0, postingLabelEvening}, {20, 0, postingLabelNight}, {22, 0, postingLabelLateNight}},
		}

		templates := suggestionTemplates[input.Body.PostsPerDay]
		if templates == nil {
			// Fallback for any value within 1-10 (should not happen due to validation)
			templates = suggestionTemplates[3]
		}

		// Store workspace-local wall-clock times for all seven days.
		schedules := make([]models.PostingSchedule, 0, len(templates)*7)
		for dayOfWeek := 0; dayOfWeek <= 6; dayOfWeek++ {
			for _, t := range templates {
				schedules = append(schedules, models.PostingSchedule{
					ID:          uuid.New().String(),
					WorkspaceID: input.Body.WorkspaceID,
					UTCHour:     t.Hour,
					UTCMinute:   t.Minute,
					DayOfWeek:   dayOfWeek,
					Label:       t.Label,
					IsActive:    true,
					CreatedAt:   time.Now().UTC(),
				})
			}
		}

		// Insert in a transaction
		tx, err := h.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to begin transaction")
		}
		defer func() { _ = tx.Rollback() }()

		for i := range schedules {
			if _, err := tx.NewInsert().Model(&schedules[i]).Exec(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to create schedule")
			}
		}

		if err := tx.Commit(); err != nil {
			return nil, huma.Error500InternalServerError("failed to commit transaction")
		}

		resp := make([]PostingScheduleResponse, len(schedules))
		for i, s := range schedules {
			resp[i] = postingScheduleResponseFromModel(s)
		}

		return &SuggestScheduleOutput{Body: struct {
			Schedules []PostingScheduleResponse `json:"schedules" doc:"Created schedule slots"`
			Message   string                    `json:"message" doc:"Message about the result"`
		}{
			Schedules: resp,
			Message:   fmt.Sprintf("Created %d schedule slots (%d per day, 7 days a week)", len(schedules), input.Body.PostsPerDay),
		}}, nil
	})
}

//nolint:gocyclo
func (h *PostingScheduleHandler) GetNextAvailableSlot(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-next-available-slot",
		Method:      http.MethodGet,
		Path:        "/posting-schedules/next-slot",
		Summary:     "Get the next available posting time slot",
		Tags:        []string{tagPostingSchedules},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403},
	}, func(ctx context.Context, input *NextAvailableSlotInput) (*NextAvailableSlotOutput, error) {
		userID := middleware.GetUserID(ctx)

		if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}

		// Get workspace timezone
		var workspace models.Workspace
		err := h.db.NewSelect().Model(&workspace).Where("id = ?", input.WorkspaceID).Scan(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace")
		}

		// Load timezone
		loc, err := time.LoadLocation(workspace.Timezone)
		if err != nil {
			loc = time.UTC
		}

		now := time.Now().In(loc)

		// Query active schedules
		var schedules []models.PostingSchedule
		query := h.db.NewSelect().
			Model(&schedules).
			Where("workspace_id = ?", input.WorkspaceID).
			Where("is_active = ?", true)

		if err := query.Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch schedules")
		}

		if len(schedules) == 0 {
			return &NextAvailableSlotOutput{Body: struct {
				Slot     *PostingScheduleResponse `json:"slot,omitempty" doc:"Next available schedule slot"`
				SlotTime string                   `json:"slot_time" doc:"The suggested time in ISO 8601 format"`
				Message  string                   `json:"message" doc:"Message about the result"`
			}{
				Slot:     nil,
				SlotTime: "",
				Message:  "No posting schedules configured for this workspace",
			}}, nil
		}

		var scheduledPublications []models.Publication
		publicationQuery := h.db.NewSelect().
			Model(&scheduledPublications).
			Where("workspace_id = ?", input.WorkspaceID).
			Where("status = ?", "scheduled").
			Where("scheduled_at >= ?", now.UTC().Add(-24*time.Hour)).
			Order("scheduled_at ASC")
		if err := publicationQuery.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error500InternalServerError("failed to fetch scheduled publications")
		}

		nextSlot, nextSlotTime := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPublications, workspace.RandomDelayMinutes)

		if nextSlotTime.IsZero() {
			return &NextAvailableSlotOutput{Body: struct {
				Slot     *PostingScheduleResponse `json:"slot,omitempty" doc:"Next available schedule slot"`
				SlotTime string                   `json:"slot_time" doc:"The suggested time in ISO 8601 format"`
				Message  string                   `json:"message" doc:"Message about the result"`
			}{
				Slot:     nil,
				SlotTime: "",
				Message:  "No available slots found in the next month",
			}}, nil
		}

		return &NextAvailableSlotOutput{Body: struct {
			Slot     *PostingScheduleResponse `json:"slot,omitempty" doc:"Next available schedule slot"`
			SlotTime string                   `json:"slot_time" doc:"The suggested time in ISO 8601 format"`
			Message  string                   `json:"message" doc:"Message about the result"`
		}{
			Slot: func() *PostingScheduleResponse {
				if nextSlot == nil {
					return nil
				}
				slot := postingScheduleResponseFromModel(*nextSlot)
				return &slot
			}(),
			SlotTime: nextSlotTime.Format(time.RFC3339),
			Message:  "Next available slot found",
		}}, nil
	})
}
