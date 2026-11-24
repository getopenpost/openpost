package handlers

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func (h *PublicationHandler) resolveScheduledPublicationRunAtTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	now time.Time,
) (time.Time, int, error) {
	randomDelayMinutes := publication.RandomDelayMinutes
	if !publication.RandomDelayExplicit {
		var workspace struct {
			RandomDelayMinutes int `bun:"random_delay_minutes"`
		}
		err := tx.NewSelect().TableExpr("workspaces").Column("random_delay_minutes").
			Where("id = ?", publication.WorkspaceID).Scan(ctx, &workspace)
		switch {
		case err == nil:
			randomDelayMinutes = workspace.RandomDelayMinutes
		case isMissingWorkspaceTable(err):
			randomDelayMinutes = 0
		default:
			return time.Time{}, 0, fmt.Errorf("load Workspace random delay: %w", err)
		}
	}
	runAt, err := resolveFuturePostRunAt(publication.ScheduledAt, randomDelayMinutes, now)
	return runAt, randomDelayMinutes, err
}

func resolveFuturePostRunAt(scheduledAt time.Time, randomDelayMinutes int, now time.Time) (time.Time, error) {
	now = now.UTC()
	if !scheduledAt.After(now) {
		return time.Time{}, errPublicationScheduleFuture
	}
	if randomDelayMinutes > 0 {
		const maxDurationMinutes = (1<<63 - 1) / int64(time.Minute)
		delayMinutes := int64(randomDelayMinutes)
		if delayMinutes > maxDurationMinutes {
			return time.Time{}, errPublicationScheduleFuture
		}
		earliestRunAt := scheduledAt.Add(-time.Duration(delayMinutes) * time.Minute)
		if !earliestRunAt.After(now) {
			return time.Time{}, errPublicationScheduleFuture
		}
	}
	actualRunAt := applyRandomDelay(scheduledAt, randomDelayMinutes)
	if !actualRunAt.After(now) {
		return time.Time{}, errPublicationScheduleFuture
	}
	return actualRunAt, nil
}

func applyRandomDelay(scheduledAt time.Time, randomDelayMinutes int) time.Time {
	if randomDelayMinutes <= 0 {
		return scheduledAt
	}
	maxOffset := 2*randomDelayMinutes + 1
	randomOffset := secureRandomInt(maxOffset) - randomDelayMinutes
	return scheduledAt.Add(time.Duration(randomOffset) * time.Minute)
}

func secureRandomInt(n int) int {
	if n <= 1 {
		return 0
	}
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return int(binary.BigEndian.Uint64(buf[:]) % uint64(n))
	}
	return int(time.Now().UnixNano() % int64(n))
}

func (h *PublicationHandler) queuePublicationNowExpected(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	intents ...providerreadiness.ExecutionIntent,
) (publicationEnqueueResult, error) {
	return h.queuePublicationWithRunAt(ctx, publicationID, expectedRevision, publicationauth.PolicyImmediate, normalizedReadinessIntent(intents), func(_ *models.Publication, now time.Time) (time.Time, error) {
		return now, nil
	})
}

//nolint:gocyclo // Queue creation, revision checks, schedule state, and rendition state must commit as one transition.
func (h *PublicationHandler) queuePublicationWithRunAt(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	policyMode string,
	intent providerreadiness.ExecutionIntent,
	resolveRunAt func(*models.Publication, time.Time) (time.Time, error),
) (publicationEnqueueResult, error) {
	if h.beforeQueueTransaction != nil {
		if err := h.beforeQueueTransaction(ctx); err != nil {
			return publicationEnqueueResult{}, err
		}
	}
	var result publicationEnqueueResult
	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		result, err = h.queuePublicationWithRunAtTx(
			txCtx, tx, publicationID, expectedRevision, policyMode, intent, resolveRunAt,
		)
		return err
	})
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	return result, nil
}

//nolint:gocyclo // Queue creation, revision checks, schedule state, and rendition state must commit as one transition.
func (h *PublicationHandler) queuePublicationWithRunAtTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	expectedRevision int,
	policyMode string,
	intent providerreadiness.ExecutionIntent,
	resolveRunAt func(*models.Publication, time.Time) (time.Time, error),
) (publicationEnqueueResult, error) {
	operation := providerreadiness.OperationPublishImmediate
	if policyMode == publicationauth.PolicyScheduled {
		operation = providerreadiness.OperationPublishScheduled
	}
	publication, err := h.loadEditablePublicationTx(ctx, tx, publicationID)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	if expectedRevision > 0 && publication.Revision != expectedRevision {
		return publicationEnqueueResult{}, h.publicationRevisionConflict(ctx, tx, publication, expectedRevision)
	}
	issues, err := h.validatePublicationByIDWithDB(ctx, tx, publicationID)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	if err := publicationValidationError(issues); err != nil {
		return publicationEnqueueResult{}, err
	}
	if err := h.requirePublicationReadinessWithDB(ctx, tx, publication, operation, intent, true); err != nil {
		return publicationEnqueueResult{}, err
	}
	now := time.Now().UTC()
	runAt, err := resolveRunAt(publication, now)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	if policyMode == publicationauth.PolicyScheduled && !publication.ScheduledAt.IsZero() && runAt.Equal(publication.ScheduledAt) {
		var randomDelayMinutes int
		runAt, randomDelayMinutes, err = h.resolveScheduledPublicationRunAtTx(ctx, tx, publication, now)
		if err != nil {
			return publicationEnqueueResult{}, err
		}
		publication.RandomDelayMinutes = randomDelayMinutes
	} else {
		publication.RandomDelayMinutes = 0
	}
	result := publicationEnqueueResult{}
	if policyMode == publicationauth.PolicyScheduled {
		if err := h.recordScheduledPublicationUsageWithDB(ctx, tx, publication.WorkspaceID, publication.ScheduledAt); err != nil {
			return publicationEnqueueResult{}, err
		}
		result.JobID, err = h.replacePublicationJobWithIntentTx(ctx, tx, publicationID, runAt, intent)
	} else {
		result.JobID, err = h.replaceImmediatePublicationJobWithIntentTx(ctx, tx, publicationID, runAt, intent)
	}
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	if err := h.markPublicationQueuedTx(ctx, tx, publication, runAt, now); err != nil {
		return publicationEnqueueResult{}, err
	}
	result.Renditions, err = h.loadRenditionActionOutcomes(ctx, tx, publicationID)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	activation := &models.WorkspaceActivation{
		ID: "activation:" + publication.WorkspaceID, WorkspaceID: publication.WorkspaceID,
		PublicationID: publication.ID, CreatedAt: now,
	}
	insert, err := tx.NewInsert().Model(activation).On("CONFLICT (workspace_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	affected, err := insert.RowsAffected()
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	result.NewlyActivated = affected == 1
	if !result.NewlyActivated {
		if err := tx.NewSelect().Model(activation).Where("workspace_id = ?", publication.WorkspaceID).Scan(ctx); err != nil {
			return publicationEnqueueResult{}, err
		}
	}
	result.ActivationID = activation.ID
	result.ActivationPublicationID = activation.PublicationID
	if result.NewlyActivated {
		event := &models.ProductAnalyticsEvent{
			ID: activation.ID, WorkspaceID: publication.WorkspaceID,
			Name: telemetry.EventWorkspaceActivated, CreatedAt: now,
		}
		if _, err := tx.NewInsert().Model(event).Exec(ctx); err != nil {
			return publicationEnqueueResult{}, err
		}
	}
	eventType := lifecycle.EventPublishQueued
	eventMessage := "Publication queued for publishing"
	if policyMode == publicationauth.PolicyScheduled {
		eventType = lifecycle.EventScheduled
		eventMessage = "Publication scheduled"
	}
	if _, err := lifecycle.NewService(tx).Record(ctx, lifecycle.EventInput{
		WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
		Type: eventType, Status: lifecycle.StatusStarted, Message: eventMessage,
		Metadata:       map[string]any{"job_id": result.JobID, "run_at": runAt.UTC().Format(time.RFC3339Nano)},
		IdempotencyKey: eventType + ":" + result.JobID, CreatedAt: now,
	}); err != nil {
		return publicationEnqueueResult{}, err
	}
	return result, nil
}

func (h *PublicationHandler) loadRenditionActionOutcomes(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) ([]RenditionActionOutcome, error) {
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).
		Where("publication_id = ?", publicationID).
		Order("position ASC", "id ASC").
		Scan(ctx); err != nil {
		return nil, err
	}
	deliveries, err := providerwrite.LoadCurrentDeliveries(ctx, db, []string{publicationID})
	if err != nil {
		return nil, err
	}
	outcomes := make([]RenditionActionOutcome, 0, len(renditions))
	for _, rendition := range renditions {
		outcome := RenditionActionOutcome{
			ID: rendition.ID, SocialAccountID: rendition.SocialAccountID,
			TargetKey: rendition.TargetKey, Platform: rendition.Platform, Status: rendition.Status,
		}
		if delivery, ok := deliveries[rendition.ID]; ok {
			outcome.Delivery = providerDeliveryResponse(delivery)
			if outcome.Delivery.RecoveryAction == providerwrite.RecoveryRetry &&
				rendition.Status != models.RenditionStatusFailed {
				outcome.Delivery.RecoveryAction = providerwrite.RecoveryNone
			}
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

func (h *PublicationHandler) replacePublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string, runAt time.Time) (string, error) {
	return h.replacePublicationJobWithIntentTx(ctx, tx, publicationID, runAt, providerreadiness.ExecutionIntentProduction)
}

func (h *PublicationHandler) replacePublicationJobWithIntentTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	runAt time.Time,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	return h.replacePublicationJobsTx(ctx, tx, publicationID, runAt, true, publicationauth.PolicyScheduled, intent)
}

func (h *PublicationHandler) replaceImmediatePublicationJobWithIntentTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	runAt time.Time,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	return h.replacePublicationJobsTx(ctx, tx, publicationID, runAt, false, publicationauth.PolicyImmediate, intent)
}

//nolint:gocyclo // Queue replacement, overrides, jobs, receipts, and publication state must commit atomically.
func (h *PublicationHandler) replacePublicationJobsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	runAt time.Time,
	useScheduleOverrides bool,
	policyMode string,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	if err := lockOrganizationForPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := lockPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.rejectProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	var publication models.Publication
	if err := tx.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return "", err
	}
	actor := publicationAuthorizationActor(ctx, publication.CreatedByID)
	batchID := uuid.NewString()
	targets := make([]publicationauth.JobTarget, 0, 1)
	if useScheduleOverrides {
		var renditions []models.Rendition
		if err := tx.NewSelect().Model(&renditions).
			Where("publication_id = ?", publicationID).
			Order("position ASC", "id ASC").Scan(ctx); err != nil {
			return "", err
		}
		hasOverride := false
		for _, rendition := range renditions {
			hasOverride = hasOverride || !rendition.ScheduleOverride.IsZero()
		}
		if hasOverride {
			firstJobID := ""
			for _, rendition := range renditions {
				renditionRunAt := runAt
				if !rendition.ScheduleOverride.IsZero() {
					renditionRunAt = rendition.ScheduleOverride
				}
				if !renditionRunAt.After(time.Now().UTC()) {
					return "", errPublicationScheduleFuture
				}
				jobID, err := insertPublicationJobTx(ctx, tx, publicationID, rendition.ID, batchID, renditionRunAt, intent)
				if err != nil {
					return "", err
				}
				targets = append(targets, publicationauth.JobTarget{JobID: jobID, RenditionID: rendition.ID, RunAt: renditionRunAt})
				if firstJobID == "" {
					firstJobID = jobID
				}
			}
			if _, _, err := publicationauth.CreateBatch(ctx, tx, publicationauth.BatchInput{
				BatchID: batchID, PublicationID: publicationID, Actor: actor,
				Action: publicationauth.ActionPublish, PolicyMode: policyMode,
				ExecutionIntent: string(intent), ConfirmedAt: time.Now().UTC(), Targets: targets,
			}); err != nil {
				return "", err
			}
			return firstJobID, nil
		}
	}
	jobID, err := insertPublicationJobTx(ctx, tx, publicationID, "", batchID, runAt, intent)
	if err != nil {
		return "", err
	}
	if _, _, err := publicationauth.CreateBatch(ctx, tx, publicationauth.BatchInput{
		BatchID: batchID, PublicationID: publicationID, Actor: actor,
		Action: publicationauth.ActionPublish, PolicyMode: policyMode,
		ExecutionIntent: string(intent), ConfirmedAt: time.Now().UTC(),
		Targets: []publicationauth.JobTarget{{JobID: jobID, RunAt: runAt}},
	}); err != nil {
		return "", err
	}
	return jobID, nil
}

func lockOrganizationForPublicationMutationTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	var organizationID string
	if err := tx.NewSelect().TableExpr("publications AS publication").ColumnExpr("workspace.organization_id").Join("JOIN workspaces AS workspace ON workspace.id = publication.workspace_id").Where("publication.id = ?", publicationID).Scan(ctx, &organizationID); err != nil {
		if missingOrganizationBoundaryFixture(err) {
			return nil
		}
		return err
	}
	if strings.TrimSpace(organizationID) == "" {
		return nil
	}
	result, err := tx.NewUpdate().Model((*models.Organization)(nil)).Set("name = name").Where("id = ?", organizationID).Exec(ctx)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return fmt.Errorf("organization changed while scheduling the Publication")
	}
	return nil
}

func missingOrganizationBoundaryFixture(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: organizations") || strings.Contains(message, "no such table: workspaces") || strings.Contains(message, "no such table: publications") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist") && (strings.Contains(message, "organizations") || strings.Contains(message, "workspaces") || strings.Contains(message, "publications")))
}

func insertPublicationJobTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID, renditionID, authorizationBatchID string,
	runAt time.Time,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	if err := lockOrganizationForPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	payload := map[string]string{
		"publication_id":             publicationID,
		"authorization_batch_id":     authorizationBatchID,
		"authorization_scheduled_at": runAt.UTC().Format(time.RFC3339Nano),
		"readiness_intent":           string(normalizedReadinessIntent([]providerreadiness.ExecutionIntent{intent})),
	}
	if renditionID != "" {
		payload["rendition_id"] = renditionID
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, mustJSON(payload), runAt)
	if err != nil {
		return "", err
	}
	job.ScopeID = publicationID
	if _, err := tx.NewInsert().Model(job).Exec(ctx); err != nil {
		return "", err
	}
	return job.ID, nil
}

func lockPrimaryPublicationQueueTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if !primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		return nil
	}
	var lockedID string
	return primaryPublicationQueueLockQuery(tx, publicationID).Scan(ctx, &lockedID)
}

func primaryPublicationQueueUsesRowLock(name dialect.Name) bool {
	return name == dialect.PG
}

func primaryPublicationQueueLockQuery(db bun.IDB, publicationID string) *bun.SelectQuery {
	return db.NewSelect().
		TableExpr("publications").
		Column("id").
		Where("id = ?", publicationID).
		For("UPDATE")
}

func (h *PublicationHandler) lockActivePrimaryPublicationJobsTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if !primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		return nil
	}
	var jobIDs []string
	return tx.NewSelect().
		Model((*models.Job)(nil)).
		Column("id").
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status IN (?)", bun.List([]string{jobStatusPending, jobStatusProcessing, "failed"})).
		For("UPDATE").
		Scan(ctx, &jobIDs)
}

func (h *PublicationHandler) deletePendingPrimaryPublicationJobsTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	_, err := tx.NewDelete().
		Model((*models.Job)(nil)).
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", jobStatusPending).
		Exec(ctx)
	return err
}

func (h *PublicationHandler) rejectProcessingPrimaryPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	count, err := tx.NewSelect().
		Model((*models.Job)(nil)).
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", jobStatusProcessing).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}
	return nil
}

func (h *PublicationHandler) rejectPendingPrimaryPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	count, err := tx.NewSelect().
		Model((*models.Job)(nil)).
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", jobStatusPending).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}
	return nil
}

func (h *PublicationHandler) rejectUnresolvedPublicationTargetsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) error {
	if len(renditionIDs) == 0 {
		return nil
	}
	count, err := tx.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).
		Where("publication_id = ?", publicationID).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Where("status IN (?)", bun.List([]string{
			providerwrite.StatusSending,
			providerwrite.StatusAmbiguous,
		})).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}

	// Provider acceptance is durable before the local published status. A
	// failed local status can therefore describe an external write that already
	// succeeded. Block a new operation only when that exact accepted subject is
	// still unpublished; accepted earlier segments in a partially published
	// thread are expected and must not prevent retrying a later failed segment.
	var acceptedAttempts []models.ProviderWriteAttempt
	if err := tx.NewSelect().Model(&acceptedAttempts).
		Where("publication_id = ?", publicationID).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Where("status = ?", providerwrite.StatusAccepted).
		Where("operation = ?", "publish").
		Scan(ctx); err != nil {
		return err
	}
	if len(acceptedAttempts) == 0 {
		return nil
	}

	var renditions []models.Rendition
	if err := tx.NewSelect().Model(&renditions).Column("id", "status").
		Where("id IN (?)", bun.List(renditionIDs)).
		Scan(ctx); err != nil {
		return err
	}
	renditionStatus := make(map[string]string, len(renditions))
	for _, rendition := range renditions {
		renditionStatus[rendition.ID] = rendition.Status
	}
	var segments []models.RenditionSegment
	if err := tx.NewSelect().Model(&segments).Column("id", "rendition_id", "status").
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Scan(ctx); err != nil {
		return err
	}
	segmentsByRendition := make(map[string][]models.RenditionSegment, len(renditionIDs))
	for _, segment := range segments {
		segmentsByRendition[segment.RenditionID] = append(segmentsByRendition[segment.RenditionID], segment)
	}
	for _, attempt := range acceptedAttempts {
		if acceptedPublicationAttemptSubjectPublished(attempt, renditionStatus, segmentsByRendition) {
			continue
		}
		return errPublicationAlreadyProcessing
	}
	return nil
}

func acceptedPublicationAttemptSubjectPublished(
	attempt models.ProviderWriteAttempt,
	renditionStatus map[string]string,
	segmentsByRendition map[string][]models.RenditionSegment,
) bool {
	status, renditionExists := renditionStatus[attempt.RenditionID]
	authorizationID := strings.TrimSpace(attempt.AuthorizationID)
	if authorizationID == "" {
		// Pre-receipt attempts do not encode a target we can safely distinguish.
		// Only a fully persisted rendition proves that replay is unnecessary.
		return renditionExists && status == models.RenditionStatusPublished
	}
	if attempt.OperationID == strings.Join([]string{
		"authorization", authorizationID, attempt.RenditionID, "publish",
	}, ":") {
		return renditionExists && status == models.RenditionStatusPublished
	}
	for _, segment := range segmentsByRendition[attempt.RenditionID] {
		if attempt.OperationID != strings.Join([]string{
			"authorization", authorizationID, segment.ID, "publish",
		}, ":") {
			continue
		}
		return segment.Status == models.RenditionStatusPublished
	}
	// A canonical accepted publish with an unknown subject cannot safely mint a
	// new authorization identity.
	return false
}

func (h *PublicationHandler) rejectProtectedPrimaryPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	count, err := tx.NewSelect().TableExpr("jobs AS protected_job").
		Join("JOIN provider_write_attempts AS protected_attempt ON protected_attempt.job_id = protected_job.id").
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("protected_job.status IN (?)", bun.List([]string{jobStatusPending, "failed"})).
		Where("protected_attempt.status IN (?)", bun.List([]string{
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

func (h *PublicationHandler) clearPublicationScheduleTx(ctx context.Context, tx bun.Tx, publicationID string, updatedAt time.Time) error {
	if err := lockPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.rejectProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusDraft).
		Set("schedule_override = NULL").
		Set("updated_at = ?", updatedAt).
		Where("publication_id = ?", publicationID).
		Where("status = ?", models.RenditionStatusScheduled).
		Exec(ctx); err != nil {
		return err
	}
	return nil
}

func (h *PublicationHandler) markPublicationQueuedTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	runAt time.Time,
	updatedAt time.Time,
) error {
	publicationID := publication.ID
	publication.ActualRunAt = runAt
	if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusScheduled).
		Set("actual_run_at = ?", runAt).
		Set("random_delay_minutes = ?", publication.RandomDelayMinutes).
		Set("updated_at = ?", updatedAt).
		Where("id = ?", publicationID).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Set("updated_at = ?", updatedAt).
		Where("publication_id = ?", publicationID).
		Where("status NOT IN (?)", bun.List([]string{models.RenditionStatusPublished, models.RenditionStatusPublishing})).
		Exec(ctx); err != nil {
		return err
	}
	return nil
}
