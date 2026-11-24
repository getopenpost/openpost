package handlers

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

func (h *PublicationHandler) failureDismissal(api huma.API) {
	operation := func(method, operationID, summary string, dismissed bool) {
		huma.Register(api, huma.Operation{
			OperationID: operationID,
			Method:      method,
			Path:        "/publications/{id}/failure-dismissal",
			Summary:     summary,
			Description: "Changes failed-list visibility without deleting the Publication, Renditions, attempts, or delivery history.",
			Tags:        []string{tagPublications},
			Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
			Errors:      []int{403, 404, 409},
		}, func(ctx context.Context, input *FailureDismissalInput) (*FailureDismissalOutput, error) {
			publication, err := h.loadPublication(ctx, input.PathID, middleware.GetUserID(ctx))
			if err != nil {
				return nil, err
			}
			if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
				return nil, err
			}
			if publication.Status != models.PublicationStatusFailed {
				return nil, huma.Error409Conflict("only failed publications can change failure dismissal")
			}

			query := h.db.NewUpdate().Model((*models.Publication)(nil)).Where("id = ?", publication.ID)
			if dismissed {
				if publication.FailureDismissedAt.IsZero() {
					publication.FailureDismissedAt = time.Now().UTC()
					query = query.Set("failure_dismissed_at = ?", publication.FailureDismissedAt)
				} else {
					query = query.Set("failure_dismissed_at = failure_dismissed_at")
				}
			} else {
				publication.FailureDismissedAt = time.Time{}
				query = query.Set("failure_dismissed_at = NULL")
			}
			if _, err := query.Exec(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to change failure dismissal")
			}

			output := &FailureDismissalOutput{}
			output.Body.ID = publication.ID
			output.Body.DismissedAt = formatOptionalTime(publication.FailureDismissedAt)
			return output, nil
		})
	}
	operation(http.MethodPost, "dismiss-publication-failure", "Dismiss a failed publication", true)
	operation(http.MethodDelete, "restore-publication-failure", "Restore a dismissed publication failure", false)
}

func (h *PublicationHandler) validatePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "validate-publication",
		Method:      http.MethodPost,
		Path:        publicationPathValid,
		Summary:     "Validate publication renditions",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationActionInput) (*PublicationValidationOutput, error) {
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		issues, err := h.publicationApplication().Validate(ctx, middleware.GetUserID(ctx), input.PathID)
		if err != nil {
			return nil, err
		}
		resp := &PublicationValidationOutput{}
		resp.Body.Issues = issues
		resp.Body.Valid = !hasBlockingIssues(issues)
		return resp, nil
	})
}

func (h *PublicationHandler) schedulePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "schedule-publication",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/schedule",
		Summary:     "Schedule a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		intent, err := providerReadinessExecutionIntent(ctx, h.db, input.Body.ExecutionIntent)
		if err != nil {
			return nil, err
		}
		var result publicationEnqueueResult
		replayed := false
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			request, requestErr := mutationIdempotencyRequest(ctx, "", "schedule-publication", input.IdempotencyKey)
			if requestErr != nil {
				return nil, requestErr
			}
			result, replayed, err = h.publicationApplication().ScheduleIdempotent(
				ctx, userID, input.PathID, input.Body.ExpectedRevision, intent, request,
			)
		} else {
			result, err = h.publicationApplication().Schedule(
				ctx, userID, input.PathID, input.Body.ExpectedRevision, intent,
			)
		}
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue publication")
		}
		if !replayed {
			h.capturePublicationEvent(ctx, telemetry.EventPublicationScheduled, userID, input.PathID, result.JobID)
		}
		return enqueueActionMessage("publication scheduled", input.PathID, result), nil
	})
}

func (h *PublicationHandler) checkScheduledPublicationQuota(ctx context.Context, workspaceID string, scheduledAt time.Time) error {
	return h.checkScheduledPublicationQuotaAmount(ctx, workspaceID, scheduledAt, 1)
}

func (h *PublicationHandler) checkScheduledPublicationQuotaAmount(ctx context.Context, workspaceID string, scheduledAt time.Time, amount int64) error {
	if h.usage == nil || h.entitlement == nil {
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("scheduled publication usage is unavailable"))
	}
	request := entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       entitlements.LimitScheduledPostsMonthly,
		Amount:      amount,
	}
	decision, err := h.entitlement.Check(ctx, request)
	if err != nil {
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to check scheduled publication limit"))
	}
	if !decision.Allowed {
		return scheduledPublicationQuotaError(decision)
	}
	current, err := h.usage.CurrentMonthly(ctx, workspaceID, entitlements.LimitScheduledPostsMonthly, scheduledAt)
	if err != nil {
		if decision.Unlimited {
			// Unlimited deployments do not depend on quota storage to publish.
			// Record usage when the counter schema is present, but keep sparse
			// self-hosted upgrades and application fixtures operational.
			return nil
		}
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to load scheduled publication usage"))
	}
	if decision.Unlimited {
		return nil
	}
	request.Current = current
	decision, err = h.entitlement.Check(ctx, request)
	if err != nil {
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to check scheduled publication limit"))
	}
	if !decision.Allowed {
		return scheduledPublicationQuotaError(decision)
	}
	return nil
}

func scheduledPublicationQuotaError(decision entitlements.Decision) error {
	reason := strings.TrimSpace(decision.Reason)
	if reason == "" {
		reason = "scheduled publication limit exceeded"
	}
	return huma.NewError(http.StatusPaymentRequired, reason)
}

func (h *PublicationHandler) recordScheduledPublicationUsageWithDB(ctx context.Context, db bun.IDB, workspaceID string, scheduledAt time.Time) error {
	if h.usage == nil || h.entitlement == nil {
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("scheduled publication usage is unavailable"))
	}
	decision, err := entitlements.CheckWithDB(ctx, h.entitlement, db, entitlements.Request{WorkspaceID: workspaceID, Limit: entitlements.LimitScheduledPostsMonthly, Amount: 1})
	if err != nil {
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to check scheduled publication limit"))
	}
	if !decision.Allowed {
		return scheduledPublicationQuotaError(decision)
	}
	_, err = usage.IncrementMonthlyLimitedInTransaction(ctx, db, workspaceID, entitlements.LimitScheduledPostsMonthly, 1, scheduledAt, decision)
	if errors.Is(err, usage.ErrQuotaExceeded) {
		return scheduledPublicationQuotaError(decision)
	}
	if err != nil {
		if decision.Unlimited && strings.Contains(err.Error(), "no such table: usage_counters") {
			return nil
		}
		return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to record scheduled publication usage"))
	}
	return nil
}

func (h *PublicationHandler) cancelPublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "cancel-publication",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/cancel",
		Summary:     "Cancel a scheduled publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		var err error
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			request, requestErr := mutationIdempotencyRequest(ctx, "", "cancel-publication", input.IdempotencyKey)
			if requestErr != nil {
				return nil, requestErr
			}
			_, _, err = h.publicationApplication().CancelIdempotent(
				ctx, userID, input.PathID, input.Body.ExpectedRevision, request,
			)
		} else {
			err = h.publicationApplication().Cancel(ctx, userID, input.PathID, input.Body.ExpectedRevision)
		}
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to cancel publication")
		}
		output := actionMessage("publication cancelled", "")
		output.Body.PublicationID = input.PathID
		output.Body.Revision = input.Body.ExpectedRevision + 1
		return output, nil
	})
}

func (h *PublicationHandler) publishNow(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "publish-publication-now",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/publish-now",
		Summary:     "Publish a publication now",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		intent, err := providerReadinessExecutionIntent(ctx, h.db, input.Body.ExecutionIntent)
		if err != nil {
			return nil, err
		}
		var result publicationEnqueueResult
		replayed := false
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			request, requestErr := mutationIdempotencyRequest(ctx, "", "publish-publication-now", input.IdempotencyKey)
			if requestErr != nil {
				return nil, requestErr
			}
			result, replayed, err = h.publicationApplication().PublishNowIdempotent(
				ctx, userID, input.PathID, input.Body.ExpectedRevision, intent, request,
			)
		} else {
			result, err = h.publicationApplication().PublishNow(
				ctx, userID, input.PathID, input.Body.ExpectedRevision, intent,
			)
		}
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue publication")
		}
		if !replayed {
			h.capturePublicationEvent(ctx, telemetry.EventPublicationQueued, userID, input.PathID, result.JobID)
		}
		return enqueueActionMessage("publication queued", input.PathID, result), nil
	})
}

func (h *PublicationHandler) captureActivationEvent(ctx context.Context, userID, workspaceID string, result publicationEnqueueResult) {
	if !result.NewlyActivated || h.telemetry == nil {
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name:        telemetry.EventWorkspaceActivated,
		DistinctID:  userID,
		WorkspaceID: workspaceID,
		UUID:        result.ActivationID,
	}); err != nil {
		log.Printf("Failed to enqueue Workspace Activation telemetry: %v", err)
	}
}

func (h *PublicationHandler) capturePublicationEvent(
	ctx context.Context,
	eventName string,
	userID string,
	publicationID string,
	jobID string,
) {
	if h.telemetry == nil {
		return
	}
	publication := new(models.Publication)
	if err := h.db.NewSelect().Model(publication).
		Column("workspace_id", "intent", "content_profile").
		Where("id = ?", publicationID).
		Scan(ctx); err != nil {
		log.Printf("Failed to load publication telemetry context: %v", err)
		return
	}
	destinationCount, err := h.db.NewSelect().Model((*models.Rendition)(nil)).
		Where("publication_id = ?", publicationID).
		Count(ctx)
	if err != nil {
		log.Printf("Failed to count publication telemetry destinations: %v", err)
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name:        eventName,
		DistinctID:  userID,
		WorkspaceID: publication.WorkspaceID,
		UUID:        jobID,
		Properties: map[string]any{
			"publication_id":    publicationID,
			"job_id":            jobID,
			"intent":            publication.Intent,
			"content_profile":   publication.ContentProfile,
			"destination_count": destinationCount,
		},
	}); err != nil {
		log.Printf("Failed to enqueue publication telemetry: %v", err)
	}
}

func (h *PublicationHandler) retryRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "retry-publication-rendition",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/renditions/{account_id}/retry",
		Summary:     "Retry one failed publication destination",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *RetryRenditionInput) (*ActionOutput, error) {
		jobID, err := h.publicationApplication().RetryRendition(ctx, middleware.GetUserID(ctx), input.PathID, input.AccountID, input.TargetKey)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to queue destination retry")
		}
		return actionMessage("destination retry queued", jobID), nil
	})
}

func (h *PublicationHandler) retryFailedRenditions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "retry-failed-publication-renditions",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/retry-failed",
		Summary:     "Retry every retryable failed publication destination",
		Description: "Queues one publication job. Destinations that already succeeded and failures that require editing or reconnection are left unchanged.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *RetryFailedRenditionsInput) (*ActionOutput, error) {
		var jobID string
		var err error
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			request, requestErr := mutationIdempotencyRequest(ctx, "", "retry-failed-publication-renditions", input.IdempotencyKey)
			if requestErr != nil {
				return nil, requestErr
			}
			jobID, _, err = h.publicationApplication().RetryFailedRenditionsIdempotent(
				ctx, middleware.GetUserID(ctx), input.PathID, request,
			)
		} else {
			jobID, err = h.publicationApplication().RetryFailedRenditions(ctx, middleware.GetUserID(ctx), input.PathID)
		}
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to queue destination retries")
		}
		return actionMessage("failed destination retries queued", jobID), nil
	})
}

func (h *PublicationHandler) replyToRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "reply-to-rendition",
		Method:      http.MethodPost,
		Path:        "/renditions/{id}/reply",
		Summary:     "Queue an explicit provider reply",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409},
	}, func(ctx context.Context, input *ReplyInput) (*ActionOutput, error) {
		rendition, publication, err := h.loadRenditionWithPublicationForEdit(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		runAt := time.Now().UTC()
		if input.Body.RunAt != nil {
			runAt = input.Body.RunAt.UTC()
		}
		jobID, err := h.queueRenditionReply(
			ctx, rendition, publication, input.Body.Body, input.Body.ParentID,
			input.Body.Settings, input.Body.Media, runAt,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue reply")
		}
		return actionMessage("reply queued", jobID), nil
	})
}

func (h *PublicationHandler) queueRenditionReply(
	ctx context.Context,
	rendition *models.Rendition,
	publication *models.Publication,
	body, parentID string,
	settings map[string]interface{},
	media any,
	runAt time.Time,
) (string, error) {
	return h.queueRenditionReplyCommand(ctx, rendition, publication, body, parentID, settings, media, runAt, nil)
}

func (h *PublicationHandler) queueRenditionReplyCommand(
	ctx context.Context,
	rendition *models.Rendition,
	publication *models.Publication,
	body, parentID string,
	settings map[string]interface{},
	media any,
	runAt time.Time,
	request *idempotency.Request,
) (string, error) {
	confirmedAt := time.Now().UTC()
	runAt = runAt.UTC()
	if runAt.IsZero() {
		runAt = confirmedAt
	}
	jobID := uuid.NewString()
	batchID := uuid.NewString()
	payloadJSON := mustJSON(map[string]interface{}{
		"rendition_id": rendition.ID, "publication_id": publication.ID,
		"body": body, "parent_id": parentID, "settings": settings, "media": media,
		"action": "reply", "authorization_batch_id": batchID,
		"authorization_scheduled_at": runAt.Format(time.RFC3339Nano),
	})
	policyMode := publicationauth.PolicyReplyImmediate
	if runAt.After(confirmedAt) {
		policyMode = publicationauth.PolicyReplyScheduled
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, payloadJSON, runAt)
	if err != nil {
		return "", err
	}
	job.ID = jobID
	job.ScopeID = publication.ID
	if h.beforeQueueTransaction != nil {
		if err := h.beforeQueueTransaction(ctx); err != nil {
			return "", err
		}
	}
	persist := func(txCtx context.Context, tx bun.Tx) error {
		if err := lockOrganizationForPublicationMutationTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := lockPublicationMutationTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		var currentRendition models.Rendition
		query := tx.NewSelect().Model(&currentRendition).
			Where("id = ? AND publication_id = ?", rendition.ID, publication.ID)
		if primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return huma.Error404NotFound("rendition not found")
			}
			return err
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		_, _, err := publicationauth.CreateExplicit(txCtx, tx, publicationauth.ExplicitInput{
			BatchInput: publicationauth.BatchInput{
				BatchID: batchID, PublicationID: publication.ID,
				Actor:  publicationAuthorizationActor(txCtx, publication.CreatedByID),
				Action: publicationauth.ActionReply, PolicyMode: policyMode, ConfirmedAt: confirmedAt,
			},
			RenditionID: rendition.ID, JobID: jobID, RunAt: runAt,
			Content: body, Media: media,
			Settings: map[string]any{"parent_id": parentID, "settings": settings},
		})
		return err
	}
	if request == nil {
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, persist)
		return jobID, err
	}
	request.RequestHash, err = idempotency.Hash(struct {
		RenditionID string
		Body        string
		ParentID    string
		Settings    map[string]interface{}
		Media       any
		RunAt       time.Time
	}{rendition.ID, body, parentID, settings, media, runAt})
	if err != nil {
		return "", err
	}
	result, err := idempotency.Execute(ctx, h.db, *request, func(txCtx context.Context, tx bun.Tx) (string, error) {
		if err := persist(txCtx, tx); err != nil {
			return "", err
		}
		return jobID, nil
	})
	return result.Value, err
}

func (h *PublicationHandler) activePublicationReplyJobsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) ([]models.Job, error) {
	if renditionIDs != nil && len(renditionIDs) == 0 {
		return nil, nil
	}
	var jobs []models.Job
	query := tx.NewSelect().Model(&jobs).
		Where(replyPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status IN (?)", bun.List([]string{jobStatusPending, jobStatusProcessing, "failed"})).
		Order("id ASC")
	if renditionIDs != nil {
		query = query.Where(jobPayloadTextExpr(h.db, "rendition_id")+" IN (?)", bun.List(renditionIDs))
	}
	if primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

func protectedPublicationReplyJobIDs(jobs []models.Job) []string {
	jobIDs := make([]string, 0, len(jobs))
	for _, job := range jobs {
		if job.Status == jobStatusPending || job.Status == "failed" {
			jobIDs = append(jobIDs, job.ID)
		}
	}
	return jobIDs
}

func (h *PublicationHandler) rejectUnsafePublicationReplyJobsTx(
	ctx context.Context,
	tx bun.Tx,
	jobs []models.Job,
	rejectPending bool,
) error {
	for _, job := range jobs {
		if job.Status == jobStatusProcessing || (rejectPending && job.Status == jobStatusPending) {
			return errPublicationAlreadyProcessing
		}
	}
	jobIDs := protectedPublicationReplyJobIDs(jobs)
	if len(jobIDs) == 0 {
		return nil
	}
	count, err := tx.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).
		Where("job_id IN (?)", bun.List(jobIDs)).
		Where("status IN (?)", bun.List([]string{
			providerwrite.StatusSending,
			providerwrite.StatusAmbiguous,
			providerwrite.StatusAccepted,
		})).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}
	return nil
}

// cancelPendingReplyJobsForDeletedTargetsTx makes explicit target deletion
// also cancel replies that have not started. Processing work and uncertain or
// accepted provider attempts retain their operation identity and block delete.
func (h *PublicationHandler) cancelPendingReplyJobsForDeletedTargetsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) error {
	jobs, err := h.activePublicationReplyJobsTx(ctx, tx, publicationID, renditionIDs)
	if err != nil {
		return err
	}
	if err := h.rejectUnsafePublicationReplyJobsTx(ctx, tx, jobs, false); err != nil {
		return err
	}
	pendingIDs := make([]string, 0, len(jobs))
	for _, job := range jobs {
		if job.Status == jobStatusPending {
			pendingIDs = append(pendingIDs, job.ID)
		}
	}
	if len(pendingIDs) == 0 {
		return nil
	}
	_, err = tx.NewDelete().Model((*models.Job)(nil)).
		Where("id IN (?)", bun.List(pendingIDs)).
		Where("status = ?", jobStatusPending).
		Exec(ctx)
	return err
}

// rejectReplyJobsForReplacedTargetsTx keeps a pending reply bound to the
// rendition identity the user authorized instead of silently orphaning it
// when a destination is deleted and recreated.
func (h *PublicationHandler) rejectReplyJobsForReplacedTargetsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) error {
	jobs, err := h.activePublicationReplyJobsTx(ctx, tx, publicationID, renditionIDs)
	if err != nil {
		return err
	}
	return h.rejectUnsafePublicationReplyJobsTx(ctx, tx, jobs, true)
}
