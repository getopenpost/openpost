package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/uptrace/bun"
)

type BatchSchedulePreviewInput struct {
	Body struct {
		WorkspaceID    string   `json:"workspace_id" minLength:"1"`
		PublicationIDs []string `json:"publication_ids" minItems:"1" maxItems:"20" uniqueItems:"true"`
		StartDate      string   `json:"start_date" format:"date"`
		EndDate        string   `json:"end_date" format:"date"`
		Hour           int      `json:"hour" minimum:"0" maximum:"23"`
		Minute         int      `json:"minute" minimum:"0" maximum:"59"`
		IntervalDays   int      `json:"interval_days" minimum:"1" maximum:"30"`
		UseSlots       bool     `json:"use_slots"`
	}
}
type BatchScheduleItem struct {
	PublicationID    string `json:"publication_id"`
	ExpectedRevision int    `json:"expected_revision"`
	Title            string `json:"title,omitempty"`
	ScheduledAt      string `json:"scheduled_at,omitempty"`
	Preserved        bool   `json:"preserved"`
	Error            string `json:"error,omitempty"`
}
type BatchSchedulePreviewOutput struct {
	Body struct {
		Timezone string              `json:"timezone"`
		Items    []BatchScheduleItem `json:"items"`
	}
}
type BatchScheduleConfirmInput struct {
	Body struct {
		WorkspaceID string              `json:"workspace_id" minLength:"1"`
		BatchID     string              `json:"batch_id" minLength:"1" maxLength:"100"`
		Items       []BatchScheduleItem `json:"items" minItems:"1" maxItems:"20"`
	}
}
type BatchScheduleOutcome struct {
	PublicationID string `json:"publication_id"`
	State         string `json:"state" enum:"scheduled,failed"`
	Error         string `json:"error,omitempty"`
}
type BatchScheduleConfirmOutput struct{ Body []BatchScheduleOutcome }

func (h *PublicationHandler) registerBatchScheduling(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "preview-batch-schedule", Method: http.MethodPost, Path: "/publications/batch-schedule/preview", Summary: "Preview exact dates for selected drafts without queuing them", Tags: []string{tagPublications}, MaxBodyBytes: 32768, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.previewBatchSchedule)
	huma.Register(api, huma.Operation{OperationID: "confirm-batch-schedule", Method: http.MethodPost, Path: "/publications/batch-schedule/confirm", Summary: "Schedule selected dates with independently replayable post receipts", Tags: []string{tagPublications}, MaxBodyBytes: 65536, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.confirmBatchSchedule)
}

func (h *PublicationHandler) previewBatchSchedule(ctx context.Context, input *BatchSchedulePreviewInput) (*BatchSchedulePreviewOutput, error) {
	userID := middleware.GetUserID(ctx)
	allowed, err := workspaceEditAllowed(ctx, h.db, input.Body.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, huma.Error403Forbidden("workspace edit access required")
	}
	var workspace models.Workspace
	if err := h.db.NewSelect().Model(&workspace).Where("id = ?", input.Body.WorkspaceID).Scan(ctx); err != nil {
		return nil, err
	}
	loc, err := time.LoadLocation(workspace.Timezone)
	if err != nil {
		return nil, huma.Error400BadRequest("set a valid workspace timezone before planning")
	}
	start, err := time.ParseInLocation(time.DateOnly, input.Body.StartDate, loc)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid start date")
	}
	end, err := time.ParseInLocation(time.DateOnly, input.Body.EndDate, loc)
	if err != nil || end.Before(start) || end.Sub(start) > 366*24*time.Hour {
		return nil, huma.Error400BadRequest("choose a range of up to one year")
	}
	var slots []models.PostingSchedule
	if input.Body.UseSlots {
		if err := h.db.NewSelect().Model(&slots).Where("workspace_id = ? AND is_active = ?", workspace.ID, true).Order("utc_hour", "utc_minute").Scan(ctx); err != nil {
			return nil, err
		}
	}
	dates := batchScheduleDates(start, end, input.Body.Hour, input.Body.Minute, input.Body.IntervalDays, input.Body.UseSlots, slots, time.Now())
	output := &BatchSchedulePreviewOutput{}
	output.Body.Timezone = workspace.Timezone
	output.Body.Items = make([]BatchScheduleItem, 0, len(input.Body.PublicationIDs))
	selection := batchScheduleSelection{dates: dates, reserved: map[int64]bool{}, seriesDates: map[string][]time.Time{}, plannedMonthly: map[string]int64{}, start: input.Body.StartDate, end: input.Body.EndDate, location: loc}
	for _, id := range input.Body.PublicationIDs {
		post, err := h.loadPublicationForEdit(ctx, id, userID)
		if err != nil {
			return nil, err
		}
		if post.WorkspaceID != workspace.ID {
			return nil, huma.Error403Forbidden("all selected posts must belong to this workspace")
		}
		item, err := h.previewBatchScheduleItem(ctx, post, userID, &selection)
		if err != nil {
			return nil, err
		}
		output.Body.Items = append(output.Body.Items, item)
	}
	return output, nil
}

type batchScheduleSelection struct {
	dates          []time.Time
	reserved       map[int64]bool
	seriesDates    map[string][]time.Time
	plannedMonthly map[string]int64
	start, end     string
	location       *time.Location
}

func (h *PublicationHandler) nextBatchScheduleDate(ctx context.Context, post *models.Publication, selection *batchScheduleSelection) (time.Time, error) {
	series := batchSeriesID(post.MetadataJSON)
	for _, candidate := range selection.dates {
		if selection.reserved[candidate.Unix()] || batchSeriesTooClose(selection.seriesDates[series], candidate, series != "") {
			continue
		}
		conflict, err := h.batchScheduleConflict(ctx, h.db, post.WorkspaceID, post.ID, candidate)
		if err != nil {
			return time.Time{}, err
		}
		if !conflict {
			return candidate, nil
		}
	}
	return time.Time{}, nil
}

func (h *PublicationHandler) previewBatchScheduleItem(ctx context.Context, post *models.Publication, userID string, selection *batchScheduleSelection) (BatchScheduleItem, error) {
	item := BatchScheduleItem{PublicationID: post.ID, ExpectedRevision: post.Revision, Title: post.Title, Preserved: !post.ScheduledAt.IsZero()}
	if item.Title == "" {
		item.Title = truncateBatchTitle(post.SourceText)
	}
	at := post.ScheduledAt
	if at.IsZero() {
		var err error
		at, err = h.nextBatchScheduleDate(ctx, post, selection)
		if err != nil {
			return item, err
		}
	}
	if !at.IsZero() {
		item.ScheduledAt = at.UTC().Format(time.RFC3339)
	}
	if err := h.validateBatchPreviewDate(ctx, post, userID, at, selection); err != nil {
		item.Error = err.Error()
	}
	if item.Error == "" {
		month := at.UTC().Format("2006-01")
		if err := h.checkScheduledPublicationQuotaAmount(ctx, post.WorkspaceID, at, selection.plannedMonthly[month]+1); err != nil {
			item.Error = err.Error()
		} else {
			selection.plannedMonthly[month]++
		}
	}
	if item.Error == "" {
		selection.reserved[at.Unix()] = true
		series := batchSeriesID(post.MetadataJSON)
		selection.seriesDates[series] = append(selection.seriesDates[series], at)
	}
	return item, nil
}

func (h *PublicationHandler) validateBatchPreviewDate(ctx context.Context, post *models.Publication, userID string, at time.Time, selection *batchScheduleSelection) error {
	series := batchSeriesID(post.MetadataJSON)
	switch {
	case post.Status != models.PublicationStatusDraft:
		return fmt.Errorf("only drafts can be scheduled together")
	case at.IsZero():
		return fmt.Errorf("no available date in this range")
	case !at.After(time.Now()):
		return fmt.Errorf("the saved date is in the past; edit this post first")
	case at.In(selection.location).Format(time.DateOnly) < selection.start || at.In(selection.location).Format(time.DateOnly) > selection.end:
		return fmt.Errorf("the saved date is outside this range; edit this post first")
	case selection.reserved[at.Unix()] || batchSeriesTooClose(selection.seriesDates[series], at.In(selection.location), series != ""):
		return fmt.Errorf("this saved date overlaps the selection or another post in this series")
	}
	return h.batchSchedulePreflight(ctx, post, userID, at)
}

// Iterate local calendar days, then validate the clock reading. A nonexistent
// spring-forward time is skipped; a repeated fall-back time is offered once.
func batchScheduleDates(start, end time.Time, hour, minute, interval int, useSlots bool, slots []models.PostingSchedule, now time.Time) []time.Time {
	dates := []time.Time{}
	if interval < 1 {
		return dates
	}
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		clocks := [][2]int{}
		if useSlots {
			for _, slot := range slots {
				if slot.DayOfWeek == int(day.Weekday()) {
					clocks = append(clocks, [2]int{slot.UTCHour, slot.UTCMinute})
				}
			}
		} else {
			// Calendar distance must not use 24-hour durations across DST transitions.
			a := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
			b := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
			if int(b.Sub(a).Hours()/24)%interval == 0 {
				clocks = append(clocks, [2]int{hour, minute})
			}
		}
		for _, clock := range clocks {
			at := time.Date(day.Year(), day.Month(), day.Day(), clock[0], clock[1], 0, 0, day.Location())
			if at.Day() == day.Day() && at.Hour() == clock[0] && at.Minute() == clock[1] && at.After(now) {
				dates = append(dates, at)
			}
		}
	}
	slices.SortFunc(dates, func(a, b time.Time) int { return a.Compare(b) })
	return slices.CompactFunc(dates, func(a, b time.Time) bool { return a.Equal(b) })
}
func truncateBatchTitle(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 100 {
		return string(runes[:100]) + "…"
	}
	return string(runes)
}
func batchSeriesID(metadata string) string {
	var value struct {
		Series struct {
			BuildID string `json:"build_id"`
		} `json:"series"`
	}
	_ = json.Unmarshal([]byte(metadata), &value)
	return value.Series.BuildID
}
func batchSeriesTooClose(dates []time.Time, at time.Time, enforce bool) bool {
	if !enforce {
		return false
	}
	for _, date := range dates {
		if at.Format(time.DateOnly) == date.In(at.Location()).Format(time.DateOnly) {
			return true
		}
	}
	return false
}
func (h *PublicationHandler) batchScheduleConflict(ctx context.Context, db bun.IDB, workspaceID, publicationID string, at time.Time) (bool, error) {
	var source models.Publication
	if err := db.NewSelect().Model(&source).Column("metadata_json").Where("id = ?", publicationID).Scan(ctx); err != nil {
		return false, err
	}
	var workspace models.Workspace
	if err := db.NewSelect().Model(&workspace).Column("timezone").Where("id = ?", workspaceID).Scan(ctx); err != nil {
		return false, err
	}
	loc, err := time.LoadLocation(workspace.Timezone)
	if err != nil {
		return false, err
	}
	local := at.In(loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	dayEnd := dayStart.AddDate(0, 0, 1)
	var posts []models.Publication
	if err := db.NewSelect().Model(&posts).Column("id", "metadata_json", "scheduled_at").Where("workspace_id = ? AND id != ? AND scheduled_at >= ? AND scheduled_at < ?", workspaceID, publicationID, dayStart, dayEnd).Scan(ctx); err != nil {
		return false, err
	}
	series := batchSeriesID(source.MetadataJSON)
	for _, post := range posts {
		if post.ScheduledAt.Equal(at) || (series != "" && batchSeriesID(post.MetadataJSON) == series) {
			return true, nil
		}
	}
	return false, nil
}
func (h *PublicationHandler) batchSchedulePreflight(ctx context.Context, post *models.Publication, userID string, at time.Time) error {
	if err := publicationauth.RequireReview(ctx, h.db, post.ID); err != nil {
		return err
	}
	if post.ReviewID != "" && !post.ScheduledAt.Equal(at) {
		var review models.PublicationReview
		if err := h.db.NewSelect().Model(&review).Where("id = ?", post.ReviewID).Scan(ctx); err != nil {
			return err
		}
		if review.IncludesSchedule {
			return fmt.Errorf("the client approved specific timing; edit and resubmit this post first")
		}
	}
	var overrides int64
	overrides, err := h.db.NewSelect().Model((*models.Rendition)(nil)).Where("publication_id = ? AND schedule_override IS NOT NULL", post.ID).Count(ctx)
	if err != nil {
		return err
	}
	if overrides > 0 {
		return fmt.Errorf("this post has destination-specific dates; schedule it individually")
	}
	conflict, err := h.batchScheduleConflict(ctx, h.db, post.WorkspaceID, post.ID, at)
	if err != nil {
		return err
	}
	if conflict {
		return fmt.Errorf("another post already uses this date")
	}
	if err := h.publicationApplication().validateForEnqueue(ctx, userID, post.ID); err != nil {
		return err
	}
	if err := h.requirePublicationReadinessWithDB(ctx, h.db, post, providerreadiness.OperationPublishScheduled, providerreadiness.ExecutionIntentProduction, false); err != nil {
		return err
	}
	err = h.checkScheduledPublicationQuota(ctx, post.WorkspaceID, at)
	return err
}
func (h *PublicationHandler) confirmBatchSchedule(ctx context.Context, input *BatchScheduleConfirmInput) (*BatchScheduleConfirmOutput, error) {
	output := &BatchScheduleConfirmOutput{Body: make([]BatchScheduleOutcome, 0, len(input.Body.Items))}
	for _, item := range input.Body.Items {
		result := BatchScheduleOutcome{PublicationID: item.PublicationID, State: "scheduled"}
		if err := h.confirmBatchScheduleItem(ctx, input.Body.WorkspaceID, input.Body.BatchID, item); err != nil {
			result.State = "failed"
			result.Error = publicationMutationHTTPError(err, "schedule selected post").Error()
		}
		output.Body = append(output.Body, result)
	}
	return output, nil
}
func (h *PublicationHandler) confirmBatchScheduleItem(ctx context.Context, workspaceID, batchID string, item BatchScheduleItem) error {
	userID := middleware.GetUserID(ctx)
	post, err := h.loadPublication(ctx, item.PublicationID, userID)
	if err != nil {
		return err
	}
	if post.WorkspaceID != workspaceID {
		return huma.Error403Forbidden("workspace mismatch")
	}
	if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
		return err
	}
	request, err := mutationIdempotencyRequest(ctx, workspaceID, "batch-schedule-post", batchID+":"+post.ID)
	if err != nil {
		return err
	}
	request.ResourceID = post.ID
	request.RequestHash, err = idempotency.Hash(struct {
		ID       string
		Revision int
		At       string
	}{post.ID, item.ExpectedRevision, item.ScheduledAt})
	if err != nil {
		return err
	}
	if _, found, err := idempotency.Replay[publicationEnqueueResult](ctx, h.db, request); found || err != nil {
		return err
	}
	at, err := h.validateBatchScheduleConfirmation(ctx, post, userID, item)
	if err != nil {
		return err
	}
	err = h.checkScheduledPublicationQuota(ctx, workspaceID, at)
	if err != nil {
		return err
	}
	commands := h.publicationApplication()
	prepared, err := commands.prepareUpdate(ctx, userID, post.ID, PublicationUpdateBody{ExpectedRevision: item.ExpectedRevision, ScheduledAt: &at})
	if err != nil {
		return err
	}
	_, err = idempotency.ExecuteWithIdentity(ctx, h.db, request, func(ctx context.Context, tx bun.Tx) (publicationEnqueueResult, error) {
		// Serialize batch placement in a workspace so concurrent confirmations cannot
		// both reserve an otherwise free authored date.
		if _, err := tx.NewUpdate().Model((*models.Workspace)(nil)).Set("id = id").Where("id = ?", workspaceID).Exec(ctx); err != nil {
			return publicationEnqueueResult{}, err
		}
		conflict, err := h.batchScheduleConflict(ctx, tx, workspaceID, post.ID, at)
		if err != nil {
			return publicationEnqueueResult{}, err
		}
		if conflict {
			return publicationEnqueueResult{}, huma.Error409Conflict("another post now uses this date; preview again")
		}
		updated, err := commands.updateTx(ctx, tx, userID, prepared)
		if err != nil {
			return publicationEnqueueResult{}, err
		}
		return h.queueScheduledPublicationTx(ctx, tx, post.ID, updated.Revision, providerreadiness.ExecutionIntentProduction)
	}, func(value publicationEnqueueResult) (string, string) { return post.ID, value.JobID })
	return err
}

func (h *PublicationHandler) validateBatchScheduleConfirmation(ctx context.Context, post *models.Publication, userID string, item BatchScheduleItem) (time.Time, error) {
	at, err := time.Parse(time.RFC3339, item.ScheduledAt)
	if err != nil || !at.After(time.Now()) {
		return time.Time{}, huma.Error400BadRequest("choose a future date")
	}
	if item.Error != "" {
		return time.Time{}, huma.Error409Conflict("resolve this preview item before confirming")
	}
	if post.Status != models.PublicationStatusDraft {
		return time.Time{}, huma.Error409Conflict("only drafts can be scheduled together")
	}
	if !post.ScheduledAt.IsZero() && !post.ScheduledAt.Equal(at) {
		return time.Time{}, huma.Error409Conflict("a saved date changed; preview the selection again")
	}
	if err := h.batchSchedulePreflight(ctx, post, userID, at); err != nil {
		return time.Time{}, err
	}
	return at, nil
}
