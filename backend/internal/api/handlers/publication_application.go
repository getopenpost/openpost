package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/lifecycle"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
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

func (h *PublicationHandler) publicationApplication() publicationApplication {
	return publicationApplication{
		handler: h,
		now:     func() time.Time { return time.Now().UTC() },
		newID:   uuid.NewString,
	}
}

func (commands publicationApplication) Create(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
) (*models.Publication, error) {
	prepared, err := commands.prepareCreate(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	publication := publicationModelFromCreate(prepared.input, userID, prepared.repostOverrideJSON, prepared.now)
	if err := commands.persistCreate(ctx, publication, prepared); err != nil {
		return nil, fmt.Errorf("persist publication creation: %w", err)
	}
	return publication, nil
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
) error {
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
			return huma.Error400BadRequest(err.Error())
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
		editor, err := postservice.EnsurePublicationEditorTx(txCtx, tx, publication)
		if err != nil {
			return err
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
			if _, err := commands.handler.replacePublicationJobTx(
				txCtx,
				tx,
				publication.ID,
				publication.ScheduledAt,
			); err != nil {
				return err
			}
		}
		if err := postservice.SyncPublicationEditorTx(txCtx, tx, publication, editor); err != nil {
			return err
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

func (commands publicationApplication) Validate(
	ctx context.Context,
	userID string,
	publicationID string,
) ([]capabilities.ValidationIssue, error) {
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
) (string, error) {
	publication, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return "", err
	}
	if err := commands.validateForEnqueue(ctx, userID, publication.ID); err != nil {
		return "", err
	}
	return commands.handler.queueScheduledPublicationExpected(ctx, publication.ID, expectedRevision, intent)
}

func (commands publicationApplication) PublishNow(
	ctx context.Context,
	userID string,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	publication, err := commands.handler.loadPublicationForEdit(ctx, publicationID, userID)
	if err != nil {
		return "", err
	}
	if err := commands.validateForEnqueue(ctx, userID, publication.ID); err != nil {
		return "", err
	}
	return commands.handler.queuePublicationNowExpected(ctx, publication.ID, expectedRevision, intent)
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
) (string, error) {
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
		return "", huma.Error500InternalServerError("failed to load rendition")
	}
	if len(renditions) == 0 {
		return "", huma.Error404NotFound("rendition not found")
	}
	if len(renditions) > 1 {
		return "", huma.Error409Conflict("target_key is required when an account has multiple publication destinations")
	}
	rendition := renditions[0]
	if rendition.Status != models.RenditionStatusFailed {
		return "", huma.Error409Conflict("only a failed destination can be retried")
	}
	if !rendition.ErrorRetryable {
		return "", huma.Error409Conflict("this failure requires the recommended account or content action")
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
		return commands.retryRenditionTx(txCtx, tx, publication, &rendition, jobID, batchID, payload, now)
	})
	return jobID, err
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
		Where("error_retryable = ?", true).Exec(ctx)
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
	_, err := tx.NewUpdate().Model((*models.Post)(nil)).
		Set("status = ?", models.PostStatusScheduled).
		Where("publication_id = ?", publicationID).Where("status = ?", models.PostStatusFailed).Exec(ctx)
	if err != nil && isMissingLegacyPostsTable(err) {
		return nil
	}
	return err
}

// RetryFailedRenditions atomically replaces any pending primary publication
// job with one retry batch for the remaining transient destination failures.
//
//nolint:gocyclo // Retry selection, jobs, receipts, and audit must commit together.
func (commands publicationApplication) RetryFailedRenditions(
	ctx context.Context,
	userID,
	publicationID string,
) (string, error) {
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
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.RenditionStatusFailed).
			Where("error_retryable = ?", true).
			Order("created_at ASC", "id ASC").
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
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.RenditionStatusFailed).
			Where("error_retryable = ?", true).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return huma.Error409Conflict("no retryable failed destinations remain")
		}
		if _, err := tx.NewUpdate().
			Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusScheduled).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().
			Model((*models.Post)(nil)).
			Set("status = ?", models.PostStatusScheduled).
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.PostStatusFailed).
			Exec(txCtx); err != nil && !isMissingLegacyPostsTable(err) {
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
