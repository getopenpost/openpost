package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/uptrace/bun"
)

// publicationApplication is the shared lifecycle boundary for REST, MCP, CLI,
// and retained Post compatibility adapters. It owns publication access checks,
// aggregate mutation, validation, scheduling, publishing, and retries.
type publicationApplication struct {
	handler *PublicationHandler
	now     func() time.Time
	newID   func() string
}

type publicationEnqueueResult = publicationservice.EnqueueResult

func publicationApplicationError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := publicationservice.CategoryOf(err); ok {
		return err
	}
	var notReady *providerreadiness.NotReadyError
	if errors.As(err, &notReady) {
		return publicationservice.NewError(publicationservice.ErrorProviderReadiness, err)
	}
	if isDraftRevisionConflict(err) {
		return publicationservice.NewError(publicationservice.ErrorRevisionConflict, err)
	}
	switch {
	case errors.Is(err, errPublicationNotFound):
		return publicationservice.NewError(publicationservice.ErrorNotFound, err)
	case errors.Is(err, errPublicationNotEditable), errors.Is(err, errPublicationNotScheduled),
		errors.Is(err, errPublicationAlreadyProcessing):
		return publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, err)
	case errors.Is(err, errPublicationScheduleConflict), errors.Is(err, errPublicationScheduleFuture),
		errors.Is(err, errPublicationValidationBlocked), errors.Is(err, errPublicationScheduleRequired):
		return publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
	}
	var statusErr interface {
		error
		GetStatus() int
	}
	if errors.As(err, &statusErr) {
		switch statusErr.GetStatus() {
		case 400:
			return publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
		case 401, 403:
			return publicationservice.NewError(publicationservice.ErrorAccessDenied, err)
		case 404:
			return publicationservice.NewError(publicationservice.ErrorNotFound, err)
		case 409:
			return publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, err)
		}
	}
	log.Printf("publicationApplicationError: unrecognized error (category=ErrorTemporaryUnavailable): %v", err)
	return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, err)
}

func categorizePublicationError(err *error) {
	if err != nil {
		*err = publicationApplicationError(*err)
	}
}

var _ publicationservice.Application = publicationApplication{}

func (h *PublicationHandler) publicationApplication() publicationservice.Application {
	return h.publicationApplicationForTesting()
}

// Application exposes the canonical Publication boundary to trusted feature
// services such as the Publication Builder. HTTP still uses the same methods.
func (h *PublicationHandler) Application() publicationservice.Application {
	return h.publicationApplication()
}

func (h *PublicationHandler) publicationApplicationForTesting() publicationApplication {
	return publicationApplication{
		handler: h,
		now:     func() time.Time { return time.Now().UTC() },
		newID:   uuid.NewString,
	}
}

func (commands publicationApplication) Get(
	ctx context.Context,
	userID string,
	publicationID string,
) (result PublicationResponse, err error) {
	defer categorizePublicationError(&err)
	return commands.handler.loadPublicationResponse(ctx, publicationID, userID)
}

func (commands publicationApplication) List(
	ctx context.Context,
	userID string,
	input ListPublicationsInput,
) (result publicationservice.ListPage, err error) {
	defer categorizePublicationError(&err)
	if err := commands.handler.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
		return publicationservice.ListPage{}, err
	}
	page, err := commands.handler.listPublicationsPage(ctx, &input)
	if err != nil {
		return publicationservice.ListPage{}, err
	}
	return publicationservice.ListPage{
		TotalCount: page.TotalCount, Limit: page.Limit, Offset: page.Offset,
		NextOffset: page.NextOffset, NextCursor: page.NextCursor, HasMore: page.HasMore,
		Publications: page.Body,
	}, nil
}

func (commands publicationApplication) History(
	ctx context.Context,
	userID string,
	publicationID string,
	limit int,
	cursor string,
) (result publicationservice.HistoryPage, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return publicationservice.HistoryPage{}, err
	}
	events, nextCursor, hasMore, err := commands.handler.listPublicationHistory(ctx, publication, limit, cursor)
	return publicationservice.HistoryPage{Events: events, NextCursor: nextCursor, HasMore: hasMore}, err
}

func (commands publicationApplication) Create(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
) (publicationResult PublicationResponse, err error) {
	defer categorizePublicationError(&err)
	return commands.create(ctx, userID, input, nil)
}

// CreateWithReadyMedia is the Publication Builder handoff. It locks and
// rechecks the exact source assets in the same transaction that creates their
// publication references, closing the gap with concurrent media Trash work.
func (commands publicationApplication) CreateWithReadyMedia(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
	readyMediaIDs []string,
) (publicationResult PublicationResponse, err error) {
	defer categorizePublicationError(&err)
	return commands.create(ctx, userID, input, readyMediaIDs)
}

func (commands publicationApplication) create(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
	readyMediaIDs []string,
) (PublicationResponse, error) {
	prepared, err := commands.prepareCreate(ctx, userID, input)
	if err != nil {
		return PublicationResponse{}, err
	}
	publication := publicationModelFromCreate(prepared.input, userID, prepared.repostOverrideJSON, prepared.now)
	if err := commands.persistCreate(ctx, publication, prepared, readyMediaIDs); err != nil {
		if errors.Is(err, publicationbuilder.ErrBuildSourceUnavailable) {
			return PublicationResponse{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
		}
		return PublicationResponse{}, fmt.Errorf("persist publication creation: %w", err)
	}
	return commands.handler.loadPublicationResponse(ctx, publication.ID, userID)
}

// Update commits the aggregate, canonical segments, destination renditions,
// schedule job, linked text editor, and revision audit as one transaction.
// The application boundary loads and authorizes the aggregate before mutation.
//
//nolint:gocyclo // Aggregate replacement and revision tracking must remain atomic.
func (commands publicationApplication) Update(
	ctx context.Context,
	userID string,
	publicationID string,
	input PublicationUpdateBody,
) (err error) {
	defer categorizePublicationError(&err)
	if input.RandomDelayMinutes != nil && input.InheritRandomDelay {
		return publicationservice.NewError(publicationservice.ErrorInvalidInput, errors.New("random_delay_minutes and inherit_random_delay cannot be used together"))
	}
	if input.RandomDelayMinutes != nil && (*input.RandomDelayMinutes < 0 || *input.RandomDelayMinutes > 60) {
		return publicationservice.NewError(publicationservice.ErrorInvalidInput, errors.New("random_delay_minutes must be between 0 and 60"))
	}
	existing, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return err
	}
	if input.SocialSetID != nil &&
		*input.SocialSetID != "" &&
		*input.SocialSetID != existing.SocialSetID {
		if _, err := loadSocialSetSnapshot(ctx, commands.handler.db, existing.WorkspaceID, *input.SocialSetID); err != nil {
			return err
		}
	}
	if input.Segments != nil {
		if err := commands.handler.validateMediaBelongsToWorkspace(
			ctx,
			existing.WorkspaceID,
			allPublicationMediaIDs(nil, input.Segments, nil),
		); err != nil {
			return err
		}
	}
	accountMap := map[string]models.SocialAccount{}
	if input.Renditions != nil {
		var err error
		accountMap, err = commands.handler.loadAccounts(
			ctx,
			existing.WorkspaceID,
			renditionAccountIDs(input.Renditions),
		)
		if err != nil {
			return err
		}
		if err := commands.handler.validateMediaBelongsToWorkspace(
			ctx,
			existing.WorkspaceID,
			allPublicationMediaIDs(nil, nil, input.Renditions),
		); err != nil {
			return err
		}
	}
	if input.RepostOverride != nil {
		normalized, err := commands.handler.validateRepostOverride(
			ctx,
			existing.WorkspaceID,
			userID,
			*input.RepostOverride,
		)
		if err != nil {
			return publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
		}
		input.RepostOverride = &normalized
	}

	now := commands.now().UTC()
	return commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		publication, err := commands.handler.loadEditablePublicationTx(txCtx, tx, existing.ID)
		if err != nil {
			return err
		}
		if publication.Revision != input.ExpectedRevision {
			return commands.handler.publicationRevisionConflict(txCtx, tx, publication, input.ExpectedRevision)
		}
		clearQueuedSchedule, rescheduleQueuedJob, err := applyPublicationScheduleUpdate(
			publication,
			input.ScheduledAt,
			input.ClearSchedule,
			now,
		)
		if err != nil {
			return err
		}
		changedDomains := publicationChangedDomains(input)
		applyPublicationFieldUpdates(publication, input)
		publication.UpdatedAt = now
		publication.Revision++
		if clearQueuedSchedule {
			if err := commands.handler.clearPublicationScheduleTx(txCtx, tx, publication.ID, now); err != nil {
				return err
			}
		}
		result, err := tx.NewUpdate().
			Model(publication).
			Where("id = ? AND revision = ?", publication.ID, input.ExpectedRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return commands.handler.publicationRevisionConflict(txCtx, tx, publication, input.ExpectedRevision)
		}
		if input.Segments != nil {
			if err := commands.handler.replacePublicationSegments(txCtx, tx, publication, input.Segments); err != nil {
				return err
			}
		} else if input.SourceText != nil {
			if err := syncPublicationFirstSegmentBodyTx(
				txCtx,
				tx,
				publication.ID,
				*input.SourceText,
				now,
			); err != nil {
				return err
			}
		}
		if input.Renditions != nil {
			if err := commands.handler.replaceAllPublicationRenditions(
				txCtx,
				tx,
				publication,
				input.Segments,
				input.Renditions,
				accountMap,
			); err != nil {
				return err
			}
		}
		if rescheduleQueuedJob {
			runAt, effectiveDelay, err := commands.handler.resolveScheduledPublicationRunAtTx(
				txCtx, tx, publication, now,
			)
			if err != nil {
				return err
			}
			publication.ActualRunAt = runAt
			publication.RandomDelayMinutes = effectiveDelay
			if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
				Set("actual_run_at = ?", runAt).
				Set("random_delay_minutes = ?", effectiveDelay).
				Where("id = ?", publication.ID).Exec(txCtx); err != nil {
				return err
			}
			if _, err := commands.handler.replacePublicationJobTx(
				txCtx, tx, publication.ID, runAt,
			); err != nil {
				return err
			}
		}
		if err := commands.handler.syncTextPostRevisionsTx(
			txCtx,
			tx,
			publication.ID,
			input.ExpectedRevision,
			publication.Revision,
			changedDomains,
			userID,
			now,
		); err != nil {
			return err
		}
		return drafts.RecordChange(
			txCtx,
			tx,
			drafts.AggregatePublication,
			publication.ID,
			publication.Revision,
			changedDomains,
			userID,
			now,
		)
	})
}

func (commands publicationApplication) ReplaceRenditions(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	renditions []RenditionInput,
) error {
	return commands.Update(ctx, userID, publicationID, PublicationUpdateBody{
		ExpectedRevision: expectedRevision,
		Renditions:       renditions,
	})
}

func (commands publicationApplication) Delete(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
) (err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return err
	}
	return commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		current, err := commands.handler.loadEditablePublicationTx(txCtx, tx, publication.ID)
		if err != nil {
			return err
		}
		if current.Revision != expectedRevision {
			return commands.handler.publicationRevisionConflict(txCtx, tx, current, expectedRevision)
		}
		if err := commands.handler.cancelPendingReplyJobsForDeletedTargetsTx(txCtx, tx, current.ID, nil); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.Job)(nil)).
			Where(primaryPublishPublicationJobWhere(commands.handler.db), jobTypePublishPublication, current.ID).
			Exec(txCtx); err != nil {
			return fmt.Errorf("delete publication jobs: %w", err)
		}
		result, err := tx.NewDelete().Model((*models.Publication)(nil)).
			Where("id = ? AND revision = ?", current.ID, current.Revision).Exec(txCtx)
		if err != nil {
			return fmt.Errorf("delete publication: %w", err)
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			latest, loadErr := commands.handler.loadEditablePublicationTx(txCtx, tx, current.ID)
			if loadErr != nil {
				return loadErr
			}
			return commands.handler.publicationRevisionConflict(txCtx, tx, latest, expectedRevision)
		}
		return nil
	})
}

func (commands publicationApplication) Cancel(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
) (err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return err
	}
	if publication.Status != models.PublicationStatusScheduled {
		return errPublicationNotScheduled
	}
	return commands.Update(ctx, userID, publicationID, PublicationUpdateBody{
		ExpectedRevision: expectedRevision,
		ClearSchedule:    true,
	})
}

func (commands publicationApplication) Validate(
	ctx context.Context,
	userID string,
	publicationID string,
) (issues []capabilities.ValidationIssue, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return nil, err
	}
	return commands.handler.validatePublicationByID(ctx, publication.ID)
}

func (commands publicationApplication) Schedule(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
) (result publicationEnqueueResult, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	if err := commands.validateForEnqueue(ctx, userID, publication.ID); err != nil {
		return publicationEnqueueResult{}, err
	}
	metered, err := commands.handler.checkScheduledPublicationQuota(ctx, publication.WorkspaceID, publication.ScheduledAt)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	result, err = commands.handler.queueScheduledPublicationExpected(ctx, publication.ID, expectedRevision, intent)
	if err == nil && metered {
		if usageErr := commands.handler.recordScheduledPublicationUsage(ctx, publication.WorkspaceID, publication.ScheduledAt); usageErr != nil {
			return publicationEnqueueResult{}, usageErr
		}
	}
	if err == nil {
		commands.handler.captureActivationEvent(ctx, userID, publication.WorkspaceID, result)
	}
	return result, err
}

func (commands publicationApplication) PublishNow(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
) (result publicationEnqueueResult, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	if err := commands.validateForEnqueue(ctx, userID, publication.ID); err != nil {
		return publicationEnqueueResult{}, err
	}
	result, err = commands.handler.queuePublicationNowExpected(ctx, publication.ID, expectedRevision, intent)
	if err == nil {
		commands.handler.captureActivationEvent(ctx, userID, publication.WorkspaceID, result)
	}
	return result, err
}

func (commands publicationApplication) validateForEnqueue(ctx context.Context, userID, publicationID string) error {
	issues, err := commands.Validate(ctx, userID, publicationID)
	if err != nil {
		return err
	}
	if hasBlockingIssues(issues) {
		return errPublicationValidationBlocked
	}
	return nil
}

func (commands publicationApplication) RetryRendition(
	ctx context.Context,
	userID,
	publicationID,
	accountID,
	targetKey string,
) (jobIDResult string, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return "", err
	}
	if err := commands.handler.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return "", err
	}
	var renditions []models.Rendition
	query := commands.handler.db.NewSelect().
		Model(&renditions).
		Where("publication_id = ?", publication.ID).
		Where("social_account_id = ?", accountID).
		Order("id ASC")
	if targetKey != "" {
		query = query.Where("target_key = ?", strings.TrimSpace(targetKey))
	}
	if err := query.Scan(ctx); err != nil {
		return "", publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to load rendition"))
	}
	if len(renditions) == 0 {
		return "", publicationservice.NewError(publicationservice.ErrorNotFound, errors.New("rendition not found"))
	}
	if len(renditions) > 1 {
		return "", publicationservice.NewError(publicationservice.ErrorInvalidInput, errors.New("target_key is required when an account has multiple publication destinations"))
	}
	rendition := renditions[0]
	if rendition.Status != models.RenditionStatusFailed {
		return "", publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, errors.New("only a failed destination can be retried"))
	}
	delivery, err := loadSafeRetryDelivery(ctx, commands.handler.db, rendition)
	if err != nil {
		return "", err
	}

	jobID := commands.newID()
	batchID := commands.newID()
	now := commands.now().UTC()
	payload := mustJSON(map[string]string{
		"publication_id":             publication.ID,
		"rendition_id":               rendition.ID,
		"authorization_batch_id":     batchID,
		"authorization_scheduled_at": now.Format(time.RFC3339Nano),
	})
	err = commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if delivery != nil && !sameSafeRetryDelivery(txCtx, tx, rendition, *delivery) {
			return publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, errors.New("the delivery outcome changed; review it before another send"))
		}
		return commands.retryRenditionTx(txCtx, tx, publication, &rendition, jobID, batchID, payload, now)
	})
	return jobID, err
}

func loadSafeRetryDelivery(ctx context.Context, db bun.IDB, rendition models.Rendition) (*models.ProviderDelivery, error) {
	var delivery models.ProviderDelivery
	err := db.NewSelect().Model(&delivery).Where("rendition_id = ?", rendition.ID).
		Where("target_key = ?", rendition.TargetKey).Scan(ctx)
	if err == nil {
		if providerwrite.DeliveryRecoveryAction(delivery) != providerwrite.RecoveryRetry {
			return nil, publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, errors.New("this delivery outcome must be reconciled or resolved manually before another send"))
		}
		return &delivery, nil
	}
	if isMissingProviderDeliveryTable(err) && rendition.ErrorRetryable {
		return nil, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, errors.New("this destination has no confirmed safe delivery outcome to retry"))
	}
	if isMissingProviderDeliveryTable(err) {
		return nil, publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, errors.New("this failure requires the recommended account or content action"))
	}
	return nil, publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, errors.New("failed to load destination delivery outcome"))
}

func sameSafeRetryDelivery(ctx context.Context, db bun.IDB, rendition models.Rendition, expected models.ProviderDelivery) bool {
	var current models.ProviderDelivery
	err := db.NewSelect().Model(&current).Where("rendition_id = ?", rendition.ID).
		Where("target_key = ?", rendition.TargetKey).Scan(ctx)
	return err == nil && current.CurrentAttemptID == expected.CurrentAttemptID &&
		providerwrite.DeliveryRecoveryAction(current) == providerwrite.RecoveryRetry
}

func isMissingProviderDeliveryTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: provider_deliveries") ||
		(strings.Contains(message, `relation "provider_deliveries"`) && strings.Contains(message, "does not exist"))
}

func (commands publicationApplication) retryRenditionTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	rendition *models.Rendition,
	jobID,
	batchID,
	payload string,
	now time.Time,
) error {
	if err := lockOrganizationForPublicationMutationTx(ctx, tx, publication.ID); err != nil {
		return err
	}
	if err := lockPublicationMutationTx(ctx, tx, publication.ID); err != nil {
		return err
	}
	if err := commands.handler.lockActivePrimaryPublicationJobsTx(ctx, tx, publication.ID); err != nil {
		return err
	}
	if err := commands.handler.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publication.ID); err != nil {
		return err
	}
	if err := commands.handler.rejectPendingPrimaryPublicationJobTx(ctx, tx, publication.ID); err != nil {
		return err
	}
	if err := commands.handler.rejectUnresolvedPublicationTargetsTx(ctx, tx, publication.ID, []string{rendition.ID}); err != nil {
		return err
	}
	result, err := tx.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Set("error_retry_at = NULL").Set("updated_at = ?", now).
		Where("id = ?", rendition.ID).Where("status = ?", models.RenditionStatusFailed).
		Exec(ctx)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return errPublicationAlreadyProcessing
	}
	if err := commands.markRetryRenditionScheduledTx(ctx, tx, publication.ID, now); err != nil {
		return err
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, payload, now)
	if err != nil {
		return err
	}
	job.ID = jobID
	job.ScopeID = publication.ID
	if _, err = tx.NewInsert().Model(job).Exec(ctx); err != nil {
		return err
	}
	_, _, err = publicationauth.CreateBatch(ctx, tx, publicationauth.BatchInput{
		BatchID: batchID, PublicationID: publication.ID,
		Actor: publicationAuthorizationActor(ctx, publication.CreatedByID), Action: publicationauth.ActionPublish,
		PolicyMode: publicationauth.PolicyRetry, ConfirmedAt: now,
		Targets: []publicationauth.JobTarget{{JobID: jobID, RenditionID: rendition.ID, RunAt: now}},
	})
	return err
}

func (commands publicationApplication) markRetryRenditionScheduledTx(ctx context.Context, tx bun.Tx, publicationID string, now time.Time) error {
	if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusScheduled).Set("updated_at = ?", now).
		Where("id = ?", publicationID).Where("status = ?", models.PublicationStatusFailed).Exec(ctx); err != nil {
		return err
	}
	return nil
}

// RetryFailedRenditions atomically replaces any pending primary publication
// job with one retry batch for the remaining transient destination failures.
//
//nolint:gocyclo // Retry selection, jobs, receipts, and audit must commit together.
func (commands publicationApplication) RetryFailedRenditions(
	ctx context.Context,
	userID,
	publicationID string,
) (jobIDResult string, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return "", err
	}
	if err := commands.handler.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return "", err
	}
	jobID := commands.newID()
	batchID := commands.newID()
	now := commands.now().UTC()
	payload := mustJSON(map[string]string{
		"publication_id":             publication.ID,
		"authorization_batch_id":     batchID,
		"authorization_scheduled_at": now.Format(time.RFC3339Nano),
	})
	err = commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := lockOrganizationForPublicationMutationTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := lockPublicationMutationTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := commands.handler.lockActivePrimaryPublicationJobsTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := commands.handler.rejectProcessingPrimaryPublicationJobTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		var retryRenditions []models.Rendition
		if err := tx.NewSelect().Model(&retryRenditions).
			Join("JOIN provider_deliveries AS delivery ON delivery.rendition_id = rendition.id AND delivery.target_key = rendition.target_key").
			Where("rendition.publication_id = ?", publication.ID).
			Where("rendition.status = ?", models.RenditionStatusFailed).
			Where("delivery.state = ?", providerwrite.DeliveryRejected).
			Where("delivery.retry_safety IN (?, ?)", platform.PublishRetrySafe, platform.PublishRetryIdempotent).
			Order("rendition.created_at ASC", "rendition.id ASC").
			Scan(txCtx); err != nil {
			return err
		}
		retryRenditionIDs := make([]string, 0, len(retryRenditions))
		for index := range retryRenditions {
			retryRenditionIDs = append(retryRenditionIDs, retryRenditions[index].ID)
		}
		if err := commands.handler.rejectUnresolvedPublicationTargetsTx(txCtx, tx, publication.ID, retryRenditionIDs); err != nil {
			return err
		}
		if err := commands.handler.deletePendingPrimaryPublicationJobsTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		result, err := tx.NewUpdate().
			Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusScheduled).
			Set("error_retry_at = NULL").
			Set("updated_at = ?", now).
			Where("id IN (?)", bun.List(retryRenditionIDs)).
			Where("status = ?", models.RenditionStatusFailed).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, errors.New("no retryable failed destinations remain"))
		}
		if _, err := tx.NewUpdate().
			Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusScheduled).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(txCtx); err != nil {
			return err
		}
		job, err := jobregistry.NewJob(jobTypePublishPublication, payload, now)
		if err != nil {
			return err
		}
		job.ID = jobID
		job.ScopeID = publication.ID
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		targets := make([]publicationauth.JobTarget, 0, len(retryRenditions))
		for _, retryRendition := range retryRenditions {
			targets = append(targets, publicationauth.JobTarget{
				JobID: jobID, RenditionID: retryRendition.ID, RunAt: now,
			})
		}
		if _, _, err := publicationauth.CreateBatch(txCtx, tx, publicationauth.BatchInput{
			BatchID: batchID, PublicationID: publication.ID,
			Actor:  publicationAuthorizationActor(txCtx, publication.CreatedByID),
			Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyRetry, ConfirmedAt: now,
			Targets: targets,
		}); err != nil {
			return err
		}
		event := &models.PublicationLifecycleEvent{
			ID:             commands.newID(),
			WorkspaceID:    publication.WorkspaceID,
			PublicationID:  publication.ID,
			Type:           lifecycle.EventRetried,
			Status:         lifecycle.StatusStarted,
			Message:        "Retry queued for failed destinations",
			MetadataJSON:   mustJSON(map[string]any{"destination_count": affected}),
			IdempotencyKey: "retry-failed:" + jobID,
			CreatedAt:      now,
		}
		_, err = tx.NewInsert().Model(event).Exec(txCtx)
		return err
	})
	return jobID, err
}
