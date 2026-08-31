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
	"github.com/openpost/backend/internal/idempotency"
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

var durableBuildCommitExpiry = time.Date(9999, time.December, 31, 23, 59, 59, 0, time.UTC)

type publicationEnqueueResult = publicationservice.EnqueueResult

func publicationApplicationError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := publicationservice.CategoryOf(err); ok {
		return err
	}
	if known := knownPublicationApplicationError(err); known != nil {
		return known
	}
	if status := publicationStatusError(err); status != nil {
		return status
	}
	log.Printf("publicationApplicationError: unrecognized error (category=ErrorTemporaryUnavailable): %v", err)
	return publicationservice.NewError(publicationservice.ErrorTemporaryUnavailable, err)
}

func knownPublicationApplicationError(err error) error {
	var notReady *providerreadiness.NotReadyError
	if errors.As(err, &notReady) {
		return publicationservice.NewError(publicationservice.ErrorProviderReadiness, err)
	}
	if isDraftRevisionConflict(err) {
		return publicationservice.NewError(publicationservice.ErrorRevisionConflict, err)
	}
	if errors.Is(err, idempotency.ErrConflict) || errors.Is(err, idempotency.ErrInProgress) {
		return publicationservice.NewError(publicationservice.ErrorInvalidLifecycleState, err)
	}
	if errors.Is(err, idempotency.ErrInvalid) {
		return publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
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
	return nil
}

func publicationStatusError(err error) error {
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
	return nil
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

// BuilderApplication exposes the same canonical mutation boundary to the
// trusted AI build handoff without creating a second Publication write path.
func (h *PublicationHandler) BuilderApplication() publicationbuilder.PublicationApplication {
	return h.publicationApplicationForTesting()
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
	prepared, err := commands.prepareCreate(ctx, userID, input)
	if err != nil {
		return PublicationResponse{}, err
	}
	publication := publicationModelFromCreate(prepared.input, userID, prepared.repostOverrideJSON, prepared.now)
	result, err := commands.persistCreate(ctx, publication, prepared)
	if err != nil {
		return PublicationResponse{}, fmt.Errorf("persist publication creation: %w", err)
	}
	return result, nil
}

func (commands publicationApplication) CreateIdempotent(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
	request idempotency.Request,
) (publicationResult PublicationResponse, replayed bool, err error) {
	defer categorizePublicationError(&err)
	prepared, err := commands.prepareCreate(ctx, userID, input)
	if err != nil {
		return PublicationResponse{}, false, err
	}
	publication := publicationModelFromCreate(prepared.input, userID, prepared.repostOverrideJSON, prepared.now)
	request.RequestHash, err = idempotency.Hash(prepared.input)
	if err != nil {
		return PublicationResponse{}, false, err
	}
	request.ResourceID = publication.ID
	result, err := idempotency.Execute(ctx, commands.handler.db, request, func(txCtx context.Context, tx bun.Tx) (PublicationResponse, error) {
		return commands.persistCreateTx(txCtx, tx, publication, prepared)
	})
	if err != nil {
		return PublicationResponse{}, false, fmt.Errorf("persist idempotent publication creation: %w", err)
	}
	return result.Value, result.Replayed, nil
}

// CreateFromBuild commits one ready AI build through the canonical Publication
// application. The build ID is the durable idempotency key, and source media is
// rechecked in the same transaction that creates its references.
func (commands publicationApplication) CreateFromBuild(
	ctx context.Context,
	userID string,
	buildID string,
	input CreatePublicationBody,
	readyMediaIDs []string,
) (publicationResult PublicationResponse, err error) {
	defer categorizePublicationError(&err)
	prepared, err := commands.prepareCreate(ctx, userID, input)
	if err != nil {
		return PublicationResponse{}, err
	}
	publication := publicationModelFromCreate(prepared.input, userID, prepared.repostOverrideJSON, prepared.now)
	request := idempotency.Request{
		PrincipalID: "user:" + strings.TrimSpace(userID),
		WorkspaceID: prepared.input.WorkspaceID,
		OperationID: "commit-publication-build",
		Key:         strings.TrimSpace(buildID),
		HTTPStatus:  200,
		ResourceID:  publication.ID,
		ExpiresAt:   durableBuildCommitExpiry,
	}
	request.RequestHash, err = idempotency.Hash(prepared.input)
	if err != nil {
		return PublicationResponse{}, err
	}
	result, err := idempotency.Execute(ctx, commands.handler.db, request, func(txCtx context.Context, tx bun.Tx) (PublicationResponse, error) {
		if err := validateReadyPublicationMediaTx(txCtx, tx, prepared.input, readyMediaIDs); err != nil {
			return PublicationResponse{}, err
		}
		return commands.persistCreateTx(txCtx, tx, publication, prepared)
	})
	if err != nil {
		return PublicationResponse{}, fmt.Errorf("persist publication build handoff: %w", err)
	}
	return result.Value, nil
}

// Update commits the aggregate, canonical segments, destination renditions,
// schedule job, linked text editor, and revision audit as one transaction.
// The application boundary loads and authorizes the aggregate before mutation.
type preparedPublicationUpdate struct {
	existing   *models.Publication
	input      PublicationUpdateBody
	accountMap map[string]models.SocialAccount
	now        time.Time
}

func (commands publicationApplication) Update(
	ctx context.Context,
	userID string,
	publicationID string,
	input PublicationUpdateBody,
) (err error) {
	defer categorizePublicationError(&err)
	prepared, err := commands.prepareUpdate(ctx, userID, publicationID, input)
	if err != nil {
		return err
	}
	return commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		_, err := commands.updateTx(txCtx, tx, userID, prepared)
		return err
	})
}

func (commands publicationApplication) UpdateIdempotent(
	ctx context.Context,
	userID string,
	publicationID string,
	input PublicationUpdateBody,
	request idempotency.Request,
) (publicationResult PublicationResponse, replayed bool, err error) {
	defer categorizePublicationError(&err)
	prepared, err := commands.prepareUpdate(ctx, userID, publicationID, input)
	if err != nil {
		return PublicationResponse{}, false, err
	}
	request.WorkspaceID = prepared.existing.WorkspaceID
	request.ResourceID = prepared.existing.ID
	request.RequestHash, err = idempotency.Hash(struct {
		PublicationID string                `json:"publication_id"`
		Input         PublicationUpdateBody `json:"input"`
	}{PublicationID: prepared.existing.ID, Input: prepared.input})
	if err != nil {
		return PublicationResponse{}, false, err
	}
	result, err := idempotency.Execute(ctx, commands.handler.db, request, func(txCtx context.Context, tx bun.Tx) (PublicationResponse, error) {
		return commands.updateTx(txCtx, tx, userID, prepared)
	})
	if err != nil {
		return PublicationResponse{}, false, err
	}
	return result.Value, result.Replayed, nil
}

//nolint:gocyclo // Validation mirrors the aggregate fields committed by updateTx.
func (commands publicationApplication) prepareUpdate(
	ctx context.Context,
	userID string,
	publicationID string,
	input PublicationUpdateBody,
) (preparedPublicationUpdate, error) {
	if input.RandomDelayMinutes != nil && input.InheritRandomDelay {
		return preparedPublicationUpdate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, errors.New("random_delay_minutes and inherit_random_delay cannot be used together"))
	}
	if input.RandomDelayMinutes != nil && (*input.RandomDelayMinutes < 0 || *input.RandomDelayMinutes > 60) {
		return preparedPublicationUpdate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, errors.New("random_delay_minutes must be between 0 and 60"))
	}
	existing, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return preparedPublicationUpdate{}, err
	}
	if input.SocialSetID != nil &&
		*input.SocialSetID != "" &&
		*input.SocialSetID != existing.SocialSetID {
		if _, err := loadSocialSetSnapshot(ctx, commands.handler.db, existing.WorkspaceID, *input.SocialSetID); err != nil {
			return preparedPublicationUpdate{}, err
		}
	}
	if input.Segments != nil {
		if err := commands.handler.validateMediaBelongsToWorkspace(
			ctx,
			existing.WorkspaceID,
			allPublicationMediaIDs(nil, input.Segments, nil),
		); err != nil {
			return preparedPublicationUpdate{}, err
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
			return preparedPublicationUpdate{}, err
		}
		if err := commands.handler.validateMediaBelongsToWorkspace(
			ctx,
			existing.WorkspaceID,
			allPublicationMediaIDs(nil, nil, input.Renditions),
		); err != nil {
			return preparedPublicationUpdate{}, err
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
			return preparedPublicationUpdate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
		}
		input.RepostOverride = &normalized
	}
	return preparedPublicationUpdate{
		existing: existing, input: input, accountMap: accountMap, now: commands.now().UTC(),
	}, nil
}

//nolint:gocyclo // Aggregate replacement and revision tracking must remain atomic.
func (commands publicationApplication) updateTx(
	ctx context.Context,
	tx bun.Tx,
	userID string,
	prepared preparedPublicationUpdate,
) (PublicationResponse, error) {
	publication, err := commands.handler.loadEditablePublicationTx(ctx, tx, prepared.existing.ID)
	if err != nil {
		return PublicationResponse{}, err
	}
	if publication.Revision != prepared.input.ExpectedRevision {
		return PublicationResponse{}, commands.handler.publicationRevisionConflict(ctx, tx, publication, prepared.input.ExpectedRevision)
	}
	clearQueuedSchedule, rescheduleQueuedJob, err := applyPublicationScheduleUpdate(
		publication,
		prepared.input.ScheduledAt,
		prepared.input.ClearSchedule,
		prepared.now,
	)
	if err != nil {
		return PublicationResponse{}, err
	}
	changedDomains := publicationChangedDomains(prepared.input)
	applyPublicationFieldUpdates(publication, prepared.input)
	publication.UpdatedAt = prepared.now
	publication.Revision++
	if clearQueuedSchedule {
		if err := commands.handler.clearPublicationScheduleTx(ctx, tx, publication.ID, prepared.now); err != nil {
			return PublicationResponse{}, err
		}
	}
	result, err := tx.NewUpdate().
		Model(publication).
		Where("id = ? AND revision = ?", publication.ID, prepared.input.ExpectedRevision).
		Exec(ctx)
	if err != nil {
		return PublicationResponse{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return PublicationResponse{}, commands.handler.publicationRevisionConflict(ctx, tx, publication, prepared.input.ExpectedRevision)
	}
	if prepared.input.Segments != nil {
		if err := commands.handler.replacePublicationSegments(ctx, tx, publication, prepared.input.Segments); err != nil {
			return PublicationResponse{}, err
		}
	} else if prepared.input.SourceText != nil {
		if err := syncPublicationFirstSegmentBodyTx(
			ctx,
			tx,
			publication.ID,
			*prepared.input.SourceText,
			prepared.now,
		); err != nil {
			return PublicationResponse{}, err
		}
	}
	if prepared.input.Renditions != nil {
		if err := commands.handler.replaceAllPublicationRenditions(
			ctx,
			tx,
			publication,
			prepared.input.Segments,
			prepared.input.Renditions,
			prepared.accountMap,
		); err != nil {
			return PublicationResponse{}, err
		}
	}
	if rescheduleQueuedJob {
		runAt, effectiveDelay, err := commands.handler.resolveScheduledPublicationRunAtTx(
			ctx, tx, publication, prepared.now,
		)
		if err != nil {
			return PublicationResponse{}, err
		}
		publication.ActualRunAt = runAt
		publication.RandomDelayMinutes = effectiveDelay
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("actual_run_at = ?", runAt).
			Set("random_delay_minutes = ?", effectiveDelay).
			Where("id = ?", publication.ID).Exec(ctx); err != nil {
			return PublicationResponse{}, err
		}
		if _, err := commands.handler.replacePublicationJobTx(
			ctx, tx, publication.ID, runAt,
		); err != nil {
			return PublicationResponse{}, err
		}
	}
	if err := commands.handler.syncTextPostRevisionsTx(
		ctx,
		tx,
		publication.ID,
		prepared.input.ExpectedRevision,
		publication.Revision,
		changedDomains,
		userID,
		prepared.now,
	); err != nil {
		return PublicationResponse{}, err
	}
	if err := drafts.RecordChange(
		ctx,
		tx,
		drafts.AggregatePublication,
		publication.ID,
		publication.Revision,
		changedDomains,
		userID,
		prepared.now,
	); err != nil {
		return PublicationResponse{}, err
	}
	responses, err := commands.handler.loadPublicationResponsesWithDB(ctx, tx, []models.Publication{*publication})
	if err != nil {
		return PublicationResponse{}, err
	}
	if len(responses) != 1 {
		return PublicationResponse{}, errors.New("failed to load updated publication")
	}
	return responses[0], nil
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

func (commands publicationApplication) CancelIdempotent(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	request idempotency.Request,
) (publicationResult PublicationResponse, replayed bool, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return PublicationResponse{}, false, err
	}
	if err := commands.handler.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return PublicationResponse{}, false, err
	}
	input := PublicationUpdateBody{ExpectedRevision: expectedRevision, ClearSchedule: true}
	request.WorkspaceID = publication.WorkspaceID
	request.ResourceID = publication.ID
	request.RequestHash, err = idempotency.Hash(struct {
		PublicationID string                `json:"publication_id"`
		Input         PublicationUpdateBody `json:"input"`
	}{PublicationID: publication.ID, Input: input})
	if err != nil {
		return PublicationResponse{}, false, err
	}
	if replay, found, replayErr := idempotency.Replay[PublicationResponse](ctx, commands.handler.db, request); found || replayErr != nil {
		return replay.Value, found && replayErr == nil, replayErr
	}
	if publication.Status != models.PublicationStatusScheduled {
		return PublicationResponse{}, false, errPublicationNotScheduled
	}
	return commands.UpdateIdempotent(ctx, userID, publication.ID, input, request)
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

func (commands publicationApplication) ScheduleIdempotent(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
	request idempotency.Request,
) (enqueueResult publicationEnqueueResult, replayed bool, err error) {
	defer categorizePublicationError(&err)
	publication, request, err := commands.prepareEnqueueIdempotency(
		ctx, userID, publicationID, expectedRevision, intent, request,
	)
	if err != nil {
		return publicationEnqueueResult{}, false, err
	}
	if replay, found, replayErr := idempotency.Replay[publicationEnqueueResult](ctx, commands.handler.db, request); found || replayErr != nil {
		return replay.Value, found && replayErr == nil, replayErr
	}
	if err := commands.validateForEnqueue(ctx, userID, publication.ID); err != nil {
		return publicationEnqueueResult{}, false, err
	}
	metered, err := commands.handler.checkScheduledPublicationQuota(ctx, publication.WorkspaceID, publication.ScheduledAt)
	if err != nil {
		return publicationEnqueueResult{}, false, err
	}
	if err := commands.beforeQueueTransaction(ctx); err != nil {
		return publicationEnqueueResult{}, false, err
	}
	result, err := idempotency.ExecuteWithIdentity(
		ctx,
		commands.handler.db,
		request,
		func(txCtx context.Context, tx bun.Tx) (publicationEnqueueResult, error) {
			return commands.handler.queuePublicationWithRunAtTx(
				txCtx,
				tx,
				publication.ID,
				expectedRevision,
				publicationauth.PolicyScheduled,
				intent,
				func(current *models.Publication, now time.Time) (time.Time, error) {
					if current.ScheduledAt.IsZero() {
						return time.Time{}, errPublicationScheduleRequired
					}
					if err := validateFuturePublicationSchedule(current.ScheduledAt, now); err != nil {
						return time.Time{}, err
					}
					return current.ScheduledAt, nil
				},
			)
		},
		func(value publicationEnqueueResult) (string, string) { return publication.ID, value.JobID },
	)
	if err != nil {
		return publicationEnqueueResult{}, false, err
	}
	if !result.Replayed && metered {
		if err := commands.handler.recordScheduledPublicationUsage(ctx, publication.WorkspaceID, publication.ScheduledAt); err != nil {
			return publicationEnqueueResult{}, false, err
		}
	}
	if !result.Replayed {
		commands.handler.captureActivationEvent(ctx, userID, publication.WorkspaceID, result.Value)
	}
	return result.Value, result.Replayed, nil
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

func (commands publicationApplication) PublishNowIdempotent(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
	request idempotency.Request,
) (enqueueResult publicationEnqueueResult, replayed bool, err error) {
	defer categorizePublicationError(&err)
	publication, request, err := commands.prepareEnqueueIdempotency(
		ctx, userID, publicationID, expectedRevision, intent, request,
	)
	if err != nil {
		return publicationEnqueueResult{}, false, err
	}
	if replay, found, replayErr := idempotency.Replay[publicationEnqueueResult](ctx, commands.handler.db, request); found || replayErr != nil {
		return replay.Value, found && replayErr == nil, replayErr
	}
	if err := commands.validateForEnqueue(ctx, userID, publication.ID); err != nil {
		return publicationEnqueueResult{}, false, err
	}
	if err := commands.beforeQueueTransaction(ctx); err != nil {
		return publicationEnqueueResult{}, false, err
	}
	result, err := idempotency.ExecuteWithIdentity(
		ctx,
		commands.handler.db,
		request,
		func(txCtx context.Context, tx bun.Tx) (publicationEnqueueResult, error) {
			return commands.handler.queuePublicationWithRunAtTx(
				txCtx,
				tx,
				publication.ID,
				expectedRevision,
				publicationauth.PolicyImmediate,
				intent,
				func(_ *models.Publication, now time.Time) (time.Time, error) { return now, nil },
			)
		},
		func(value publicationEnqueueResult) (string, string) { return publication.ID, value.JobID },
	)
	if err != nil {
		return publicationEnqueueResult{}, false, err
	}
	if !result.Replayed {
		commands.handler.captureActivationEvent(ctx, userID, publication.WorkspaceID, result.Value)
	}
	return result.Value, result.Replayed, nil
}

func (commands publicationApplication) beforeQueueTransaction(ctx context.Context) error {
	if commands.handler.beforeQueueTransaction == nil {
		return nil
	}
	return commands.handler.beforeQueueTransaction(ctx)
}

func (commands publicationApplication) prepareEnqueueIdempotency(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
	request idempotency.Request,
) (*models.Publication, idempotency.Request, error) {
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return nil, request, err
	}
	if err := commands.handler.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, request, err
	}
	request.WorkspaceID = publication.WorkspaceID
	request.ResourceID = publication.ID
	request.RequestHash, err = idempotency.Hash(struct {
		PublicationID    string                            `json:"publication_id"`
		ExpectedRevision int                               `json:"expected_revision"`
		Intent           providerreadiness.ExecutionIntent `json:"execution_intent"`
	}{publication.ID, expectedRevision, intent})
	return publication, request, err
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
		Set("status = ?", models.PublicationStatusScheduled).
		Set("failure_dismissed_at = NULL").
		Set("updated_at = ?", now).
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
	err = commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return commands.retryFailedRenditionsTx(txCtx, tx, publication, jobID, batchID, now)
	})
	return jobID, err
}

func (commands publicationApplication) RetryFailedRenditionsIdempotent(
	ctx context.Context,
	userID,
	publicationID string,
	request idempotency.Request,
) (jobIDResult string, replayed bool, err error) {
	defer categorizePublicationError(&err)
	publication, err := commands.handler.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return "", false, err
	}
	if err := commands.handler.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return "", false, err
	}
	request.WorkspaceID = publication.WorkspaceID
	request.ResourceID = publication.ID
	request.RequestHash, err = idempotency.Hash(struct {
		PublicationID string `json:"publication_id"`
	}{publication.ID})
	if err != nil {
		return "", false, err
	}
	jobID := commands.newID()
	batchID := commands.newID()
	now := commands.now().UTC()
	result, err := idempotency.ExecuteWithIdentity(
		ctx,
		commands.handler.db,
		request,
		func(txCtx context.Context, tx bun.Tx) (string, error) {
			err := commands.retryFailedRenditionsTx(txCtx, tx, publication, jobID, batchID, now)
			return jobID, err
		},
		func(value string) (string, string) { return publication.ID, value },
	)
	if err != nil {
		return "", false, err
	}
	return result.Value, result.Replayed, nil
}

//nolint:gocyclo // Retry selection, jobs, receipts, and audit must commit together.
func (commands publicationApplication) retryFailedRenditionsTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	jobID,
	batchID string,
	now time.Time,
) error {
	payload := mustJSON(map[string]string{
		"publication_id":             publication.ID,
		"authorization_batch_id":     batchID,
		"authorization_scheduled_at": now.Format(time.RFC3339Nano),
	})
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
	var retryRenditions []models.Rendition
	if err := tx.NewSelect().Model(&retryRenditions).
		Join("JOIN provider_deliveries AS delivery ON delivery.rendition_id = rendition.id AND delivery.target_key = rendition.target_key").
		Where("rendition.publication_id = ?", publication.ID).
		Where("rendition.status = ?", models.RenditionStatusFailed).
		Where("delivery.state = ?", providerwrite.DeliveryRejected).
		Where("delivery.retry_safety IN (?, ?)", platform.PublishRetrySafe, platform.PublishRetryIdempotent).
		Order("rendition.created_at ASC", "rendition.id ASC").
		Scan(ctx); err != nil {
		return err
	}
	retryRenditionIDs := make([]string, 0, len(retryRenditions))
	for index := range retryRenditions {
		retryRenditionIDs = append(retryRenditionIDs, retryRenditions[index].ID)
	}
	if err := commands.handler.rejectUnresolvedPublicationTargetsTx(ctx, tx, publication.ID, retryRenditionIDs); err != nil {
		return err
	}
	if err := commands.handler.deletePendingPrimaryPublicationJobsTx(ctx, tx, publication.ID); err != nil {
		return err
	}
	result, err := tx.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Set("error_retry_at = NULL").
		Set("updated_at = ?", now).
		Where("id IN (?)", bun.List(retryRenditionIDs)).
		Where("status = ?", models.RenditionStatusFailed).
		Exec(ctx)
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
		Set("failure_dismissed_at = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", publication.ID).
		Exec(ctx); err != nil {
		return err
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, payload, now)
	if err != nil {
		return err
	}
	job.ID = jobID
	job.ScopeID = publication.ID
	if _, err := tx.NewInsert().Model(job).Exec(ctx); err != nil {
		return err
	}
	targets := make([]publicationauth.JobTarget, 0, len(retryRenditions))
	for _, retryRendition := range retryRenditions {
		targets = append(targets, publicationauth.JobTarget{
			JobID: jobID, RenditionID: retryRendition.ID, RunAt: now,
		})
	}
	if _, _, err := publicationauth.CreateBatch(ctx, tx, publicationauth.BatchInput{
		BatchID: batchID, PublicationID: publication.ID,
		Actor:  publicationAuthorizationActor(ctx, publication.CreatedByID),
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
	_, err = tx.NewInsert().Model(event).Exec(ctx)
	return err
}
