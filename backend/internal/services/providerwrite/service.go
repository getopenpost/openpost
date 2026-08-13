package providerwrite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

var safeStateValue = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{0,128}$`)

type Service struct {
	db  *bun.DB
	now func() time.Time
}

func New(db *bun.DB) *Service {
	return &Service{db: db, now: func() time.Time { return time.Now().UTC() }}
}

type Control struct {
	service *Service
	attempt *models.ProviderWriteAttempt
	ctx     context.Context
}

// BindPublishRequest attaches the persisted logical identity and durable
// checkpoints to a per-attempt request copy. It never exposes database state
// outside the process or adds any secret material to the request.
func (c *Control) BindPublishRequest(req *platform.PublishRequest) {
	if c == nil || c.attempt == nil || req == nil {
		return
	}
	req.OperationID = c.attempt.OperationID
	req.IdempotencyKey = c.attempt.IdempotencyKey
	req.ResumeProviderState = c.attempt.ProviderState
	req.ResumeProviderReference = c.attempt.ProviderReference
	req.ResumeExternalID = c.attempt.ExternalID
	req.SetWriteFence(c.Begin, c.Checkpoint)
}

func (c *Control) Begin(result platform.PublishResult) error {
	if c == nil || c.service == nil || c.attempt == nil {
		return errors.New("provider write control is unavailable")
	}
	now := c.service.now()
	result = normalizeResult(result)
	retrySafety := result.RetrySafety
	if retrySafety == "" {
		retrySafety = platform.PublishRetryNever
	}
	query := c.service.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
		Set("status = ?", StatusSending).
		Set("submission_state = ?", platform.PublishSubmissionUnknown).
		Set("provider_state = ?", result.ProviderState).
		Set("provider_reference = ?", result.ProviderReference).
		Set("retry_safety = ?", retrySafety).
		Set("sending_started_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ? AND status = ?", c.attempt.ID, StatusPrepared)
	if result.IdempotencyTTL > 0 {
		query = query.Set("idempotency_expires_at = ?", now.Add(result.IdempotencyTTL))
	}
	durableCtx, cancel := durableContext(c.ctx)
	defer cancel()
	err := c.service.db.RunInTx(durableCtx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		updated, updateErr := query.Conn(tx).Exec(txCtx)
		if updateErr != nil {
			return fmt.Errorf("enter provider write fence: %w", updateErr)
		}
		rows, _ := updated.RowsAffected()
		if rows != 1 {
			return ErrWriteInProgress
		}
		return c.service.syncDeliveryTx(txCtx, tx, c.attempt.ID, false)
	})
	if err != nil {
		return err
	}
	c.attempt.Status = StatusSending
	c.attempt.SubmissionState = string(platform.PublishSubmissionUnknown)
	c.attempt.ProviderState = result.ProviderState
	c.attempt.ProviderReference = result.ProviderReference
	c.attempt.RetrySafety = string(retrySafety)
	c.attempt.SendingStartedAt = now
	if result.IdempotencyTTL > 0 {
		c.attempt.IdempotencyExpiresAt = now.Add(result.IdempotencyTTL)
	}
	return nil
}

func (c *Control) Checkpoint(result platform.PublishResult) error {
	if c == nil || c.service == nil || c.attempt == nil {
		return errors.New("provider write control is unavailable")
	}
	result = normalizeResult(result)
	if result.SubmissionState != platform.PublishSubmissionAccepted &&
		result.SubmissionState != platform.PublishSubmissionPending {
		return fmt.Errorf("unsupported provider write checkpoint state %q", result.SubmissionState)
	}
	return c.service.persistResult(c.ctx, c.attempt, result, nil, false)
}

func (s *Service) Execute(
	ctx context.Context,
	input Input,
	send SendFunc,
	reconcile ReconcileFunc,
) (platform.PublishResult, error) {
	input = normalizeInput(input)
	if err := validateInput(input); err != nil {
		return platform.PublishResult{}, err
	}
	if send == nil {
		return platform.PublishResult{}, errors.New("provider write send function is required")
	}
	attempt, err := s.loadOrCreateAttempt(ctx, input)
	if err != nil {
		return platform.PublishResult{}, err
	}
	if err := validateAttempt(input, attempt); err != nil {
		return platform.PublishResult{}, err
	}
	return s.executeAttempt(ctx, input, attempt, send, reconcile)
}

func (s *Service) executeAttempt(
	ctx context.Context,
	input Input,
	attempt *models.ProviderWriteAttempt,
	send SendFunc,
	reconcile ReconcileFunc,
) (platform.PublishResult, error) {
	switch attempt.Status {
	case StatusAccepted:
		return resultFromAttempt(attempt), nil
	case StatusPrepared:
		return s.sendPrepared(ctx, attempt, send)
	case StatusSending:
		if attempt.SubmissionState == string(platform.PublishSubmissionPending) && attempt.ProviderReference != "" && reconcile != nil {
			return s.reconcile(ctx, attempt, reconcile)
		}
		return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: ErrWriteInProgress}
	case StatusAmbiguous:
		return s.resumeAmbiguous(ctx, input, attempt, send, reconcile)
	case StatusDefiniteFailure:
		return s.resumeDefiniteFailure(ctx, input, attempt, send)
	default:
		return platform.PublishResult{}, fmt.Errorf("invalid provider write attempt status %q", attempt.Status)
	}
}

func (s *Service) resumeAmbiguous(
	ctx context.Context,
	input Input,
	attempt *models.ProviderWriteAttempt,
	send SendFunc,
	reconcile ReconcileFunc,
) (platform.PublishResult, error) {
	if attempt.ProviderReference != "" && reconcile != nil {
		return s.reconcile(ctx, attempt, reconcile)
	}
	if !idempotentRetryAvailable(attempt, s.now()) {
		return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: ErrOutcomeAmbiguous}
	}
	next, err := s.createNextAttempt(ctx, input, attempt.AttemptNumber+1)
	if err != nil {
		return platform.PublishResult{}, err
	}
	return s.sendPrepared(ctx, next, send)
}

func (s *Service) resumeDefiniteFailure(
	ctx context.Context,
	input Input,
	attempt *models.ProviderWriteAttempt,
	send SendFunc,
) (platform.PublishResult, error) {
	if attempt.RetrySafety != string(platform.PublishRetrySafe) && !idempotentRetryAvailable(attempt, s.now()) {
		return platform.PublishResult{}, storedAttemptError(attempt)
	}
	next, err := s.createNextAttempt(ctx, input, attempt.AttemptNumber+1)
	if err != nil {
		return platform.PublishResult{}, err
	}
	return s.sendPrepared(ctx, next, send)
}

func (s *Service) sendPrepared(ctx context.Context, attempt *models.ProviderWriteAttempt, send SendFunc) (platform.PublishResult, error) {
	control := &Control{service: s, attempt: attempt, ctx: ctx}
	result, sendErr := send(ctx, control)
	current, loadErr := s.loadAttempt(context.WithoutCancel(ctx), attempt.ID)
	if loadErr != nil {
		return platform.PublishResult{}, loadErr
	}
	if current.Status == StatusAccepted {
		return resultFromAttempt(current), nil
	}
	if current.Status == StatusPrepared {
		if sendErr == nil {
			sendErr = ErrFenceNotEntered
		}
		if err := s.persistDefiniteFailure(ctx, current, platform.PublishSubmissionNotSent, platform.PublishRetrySafe, sendErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, sendErr
	}
	if current.Status != StatusSending {
		return platform.PublishResult{}, fmt.Errorf("provider write attempt changed to %q during send", current.Status)
	}
	result = mergeResult(resultFromAttempt(current), result)
	if sendErr == nil && result.SubmissionState == "" {
		result.SubmissionState = platform.PublishSubmissionAccepted
	}
	if result.SubmissionState == platform.PublishSubmissionAccepted && sendErr == nil {
		if err := s.persistResult(ctx, current, result, sendErr, false); err != nil {
			return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: errors.Join(ErrOutcomeAmbiguous, err)}
		}
		return result, nil
	}
	if result.SubmissionState == platform.PublishSubmissionPending {
		if err := s.persistResult(ctx, current, result, sendErr, false); err != nil {
			return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: errors.Join(ErrOutcomeAmbiguous, err)}
		}
		return platform.PublishResult{}, pendingError(result)
	}
	return s.persistSendFailure(ctx, current, result, sendErr)
}

func (s *Service) reconcile(ctx context.Context, attempt *models.ProviderWriteAttempt, reconcile ReconcileFunc) (platform.PublishResult, error) {
	if !attempt.ReconcileAfter.IsZero() && s.now().Before(attempt.ReconcileAfter) {
		return platform.PublishResult{}, pendingError(resultFromAttempt(attempt))
	}
	result, reconcileErr := reconcile(ctx, attempt.ProviderReference)
	result = mergeResult(resultFromAttempt(attempt), result)
	switch result.SubmissionState {
	case platform.PublishSubmissionAccepted:
		if err := s.persistResult(ctx, attempt, result, reconcileErr, true); err != nil {
			return platform.PublishResult{}, err
		}
		return result, nil
	case platform.PublishSubmissionRejected:
		if reconcileErr == nil {
			reconcileErr = errors.New("provider rejected the submitted write")
		}
		if err := s.persistDefiniteFailure(ctx, attempt, platform.PublishSubmissionRejected, platform.PublishRetryNever, reconcileErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, reconcileErr
	default:
		result.SubmissionState = platform.PublishSubmissionPending
		result.RetrySafety = platform.PublishRetryReconcileOnly
		if err := s.persistResult(ctx, attempt, result, reconcileErr, true); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, pendingError(result)
	}
}

func (s *Service) persistSendFailure(
	ctx context.Context,
	attempt *models.ProviderWriteAttempt,
	result platform.PublishResult,
	sendErr error,
) (platform.PublishResult, error) {
	if sendErr == nil {
		sendErr = errors.New("provider returned an unknown submission state")
	}
	if result.SubmissionState == platform.PublishSubmissionRejected || definitelyRejected(sendErr) {
		if err := s.persistDefiniteFailure(ctx, attempt, platform.PublishSubmissionRejected, platform.PublishRetrySafe, sendErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, sendErr
	}
	if err := s.persistAmbiguous(ctx, attempt, result, sendErr); err != nil {
		return platform.PublishResult{}, errors.Join(sendErr, err)
	}
	retryable := idempotentRetryAvailable(attempt, s.now())
	return platform.PublishResult{}, &OutcomeError{
		Kind: StatusAmbiguous, Retryable: retryable, RetryAfter: 30 * time.Second,
		Err: errors.Join(ErrOutcomeAmbiguous, sendErr),
	}
}

func (s *Service) persistResult(
	ctx context.Context,
	attempt *models.ProviderWriteAttempt,
	result platform.PublishResult,
	resultErr error,
	reconciled bool,
) error {
	result = normalizeResult(result)
	now := s.now()
	status := StatusSending
	completedAt := any(nil)
	if result.SubmissionState == platform.PublishSubmissionAccepted {
		status = StatusAccepted
		completedAt = now
	}
	reconcileAt := any(nil)
	if result.ReconcileAfter > 0 {
		reconcileAt = now.Add(result.ReconcileAfter)
	}
	errorClass, errorCode, httpStatus := safeError(resultErr)
	durableCtx, cancel := durableContext(ctx)
	defer cancel()
	err := s.db.RunInTx(durableCtx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		updated, updateErr := tx.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
			Set("status = ?", status).
			Set("submission_state = ?", result.SubmissionState).
			Set("provider_state = ?", result.ProviderState).
			Set("provider_reference = ?", result.ProviderReference).
			Set("retry_safety = ?", firstRetrySafety(result.RetrySafety, platform.PublishRetryNever)).
			Set("external_id = ?", result.ExternalID).
			Set("external_url = ?", result.ExternalURL).
			Set("safe_error_class = ?", errorClass).
			Set("safe_error_code = ?", errorCode).
			Set("error_http_status = ?", httpStatus).
			Set("reconcile_after = ?", reconcileAt).
			Set("completed_at = ?", completedAt).
			Set("updated_at = ?", now).
			Where("id = ? AND status IN (?, ?)", attempt.ID, StatusSending, StatusAmbiguous).
			Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		rows, _ := updated.RowsAffected()
		if rows != 1 {
			return errors.New("attempt is no longer active")
		}
		return s.syncDeliveryTx(txCtx, tx, attempt.ID, reconciled)
	})
	if err != nil {
		return fmt.Errorf("persist provider write result: %w", err)
	}
	return nil
}

func (s *Service) persistDefiniteFailure(
	ctx context.Context,
	attempt *models.ProviderWriteAttempt,
	submission platform.PublishSubmissionState,
	retrySafety platform.PublishRetrySafety,
	failure error,
) error {
	now := s.now()
	errorClass, errorCode, httpStatus := safeError(failure)
	durableCtx, cancel := durableContext(ctx)
	defer cancel()
	return s.db.RunInTx(durableCtx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
			Set("status = ?", StatusDefiniteFailure).
			Set("submission_state = ?", submission).
			Set("retry_safety = ?", retrySafety).
			Set("safe_error_class = ?", errorClass).
			Set("safe_error_code = ?", errorCode).
			Set("error_http_status = ?", httpStatus).
			Set("completed_at = ?", now).
			Set("updated_at = ?", now).
			Where("id = ? AND status IN (?, ?)", attempt.ID, StatusPrepared, StatusSending).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			return nil
		}
		return s.syncDeliveryTx(txCtx, tx, attempt.ID, false)
	})
}

func (s *Service) persistAmbiguous(ctx context.Context, attempt *models.ProviderWriteAttempt, result platform.PublishResult, failure error) error {
	now := s.now()
	errorClass, errorCode, httpStatus := safeError(failure)
	retrySafety := firstRetrySafety(result.RetrySafety, platform.PublishRetryNever)
	durableCtx, cancel := durableContext(ctx)
	defer cancel()
	return s.db.RunInTx(durableCtx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		updated, err := tx.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
			Set("status = ?", StatusAmbiguous).
			Set("submission_state = ?", platform.PublishSubmissionUnknown).
			Set("provider_state = ?", result.ProviderState).
			Set("provider_reference = ?", result.ProviderReference).
			Set("retry_safety = ?", retrySafety).
			Set("safe_error_class = ?", errorClass).
			Set("safe_error_code = ?", errorCode).
			Set("error_http_status = ?", httpStatus).
			Set("completed_at = ?", now).
			Set("updated_at = ?", now).
			Where("id = ? AND status = ?", attempt.ID, StatusSending).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, _ := updated.RowsAffected()
		if rows == 0 {
			return nil
		}
		return s.syncDeliveryTx(txCtx, tx, attempt.ID, false)
	})
}

func (s *Service) loadOrCreateAttempt(ctx context.Context, input Input) (*models.ProviderWriteAttempt, error) {
	var attempt models.ProviderWriteAttempt
	err := s.db.NewSelect().Model(&attempt).
		Where("operation_id = ?", input.OperationID).
		Order("attempt_number DESC").
		Limit(1).
		Scan(ctx)
	if err == nil {
		return &attempt, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load provider write attempt: %w", err)
	}
	return s.createNextAttempt(ctx, input, 1)
}

func (s *Service) createNextAttempt(ctx context.Context, input Input, number int) (*models.ProviderWriteAttempt, error) {
	now := s.now()
	attempt := &models.ProviderWriteAttempt{
		ID: uuid.NewString(), OperationID: input.OperationID, AttemptNumber: number,
		JobID: input.JobID, AuthorizationID: input.AuthorizationID,
		WorkspaceID: input.WorkspaceID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, SocialAccountID: input.SocialAccountID,
		TargetKey: input.TargetKey, Provider: input.Provider, Operation: input.Operation,
		PayloadFingerprint: input.PayloadFingerprint, Status: StatusPrepared,
		SubmissionState: string(platform.PublishSubmissionNotSent),
		RetrySafety:     string(platform.PublishRetrySafe),
		IdempotencyKey:  operationIdempotencyKey(input.OperationID),
		CreatedAt:       now, UpdatedAt: now,
	}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, insertErr := tx.NewInsert().Model(attempt).Exec(txCtx); insertErr != nil {
			return insertErr
		}
		return s.syncDeliveryTx(txCtx, tx, attempt.ID, false)
	})
	if err != nil {
		var active models.ProviderWriteAttempt
		loadErr := s.db.NewSelect().Model(&active).
			Where("operation_id = ?", input.OperationID).
			Order("attempt_number DESC").Limit(1).Scan(ctx)
		if loadErr == nil {
			return &active, nil
		}
		return nil, fmt.Errorf("create provider write attempt: %w", err)
	}
	return attempt, nil
}

func (s *Service) loadAttempt(ctx context.Context, id string) (*models.ProviderWriteAttempt, error) {
	var attempt models.ProviderWriteAttempt
	if err := s.db.NewSelect().Model(&attempt).Where("id = ?", id).Scan(ctx); err != nil {
		return nil, fmt.Errorf("reload provider write attempt: %w", err)
	}
	return &attempt, nil
}

func (s *Service) syncDeliveryTx(
	ctx context.Context,
	tx bun.Tx,
	attemptID string,
	reconciled bool,
) error {
	var attempt models.ProviderWriteAttempt
	if err := tx.NewSelect().Model(&attempt).Where("id = ?", attemptID).Scan(ctx); err != nil {
		return err
	}
	if attempt.PublicationID == "" || attempt.RenditionID == "" {
		return nil
	}
	now := s.now()
	delivery := &models.ProviderDelivery{
		ID:                      uuid.NewString(),
		WorkspaceID:             attempt.WorkspaceID,
		PublicationID:           attempt.PublicationID,
		RenditionID:             attempt.RenditionID,
		SocialAccountID:         attempt.SocialAccountID,
		TargetKey:               attempt.TargetKey,
		Provider:                attempt.Provider,
		State:                   deliveryState(attempt),
		TerminalReason:          deliveryTerminalReason(attempt),
		CurrentAttemptID:        attempt.ID,
		CurrentAttemptNumber:    attempt.AttemptNumber,
		CurrentAttemptCreatedAt: attempt.CreatedAt,
		ExternalID:              attempt.ExternalID,
		ExternalURL:             attempt.ExternalURL,
		RetrySafety:             attempt.RetrySafety,
		SafeErrorClass:          attempt.SafeErrorClass,
		SafeErrorCode:           attempt.SafeErrorCode,
		ErrorHTTPStatus:         attempt.ErrorHTTPStatus,
		NextReconciliationAt:    attempt.ReconcileAfter,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	if reconciled {
		delivery.LastReconciledAt = now
	}
	// Bun aliases the insert target as provider_delivery. Qualify existing-row
	// references so Postgres does not confuse them with EXCLUDED columns.
	const targetAlias = "provider_delivery"
	query := tx.NewInsert().Model(delivery).
		On("CONFLICT (rendition_id, target_key) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("publication_id = EXCLUDED.publication_id").
		Set("social_account_id = EXCLUDED.social_account_id").
		Set("provider = EXCLUDED.provider").
		Set("state = EXCLUDED.state").
		Set("terminal_reason = EXCLUDED.terminal_reason").
		Set("current_attempt_id = EXCLUDED.current_attempt_id").
		Set("current_attempt_number = EXCLUDED.current_attempt_number").
		Set("current_attempt_created_at = EXCLUDED.current_attempt_created_at").
		Set("external_id = EXCLUDED.external_id").
		Set("external_url = EXCLUDED.external_url").
		Set("retry_safety = EXCLUDED.retry_safety").
		Set("safe_error_class = EXCLUDED.safe_error_class").
		Set("safe_error_code = EXCLUDED.safe_error_code").
		Set("error_http_status = EXCLUDED.error_http_status").
		Set("next_reconciliation_at = EXCLUDED.next_reconciliation_at").
		Set("updated_at = EXCLUDED.updated_at").
		Where(
			"? < EXCLUDED.current_attempt_created_at OR (? = EXCLUDED.current_attempt_created_at AND ? = EXCLUDED.current_attempt_id)",
			bun.Ident(targetAlias+".current_attempt_created_at"),
			bun.Ident(targetAlias+".current_attempt_created_at"),
			bun.Ident(targetAlias+".current_attempt_id"),
		)
	if reconciled {
		query = query.Set("last_reconciled_at = EXCLUDED.last_reconciled_at")
	}
	_, err := query.Exec(ctx)
	if err != nil && missingProviderDeliveryTable(err) {
		// Narrow unit fixtures created before migration 089 may intentionally omit
		// the projection. Production databases fail startup if the migration fails.
		return nil
	}
	return err
}

func deliveryState(attempt models.ProviderWriteAttempt) string {
	providerState := strings.ToLower(strings.TrimSpace(attempt.ProviderState))
	providerScheduled := providerState == "scheduled" || providerState == DeliveryProviderScheduled
	switch attempt.Status {
	case StatusPrepared:
		return DeliveryQueued
	case StatusAccepted:
		if providerScheduled {
			return DeliveryProviderScheduled
		}
		return DeliveryLive
	case StatusDefiniteFailure:
		return DeliveryRejected
	case StatusAmbiguous:
		if attempt.ProviderReference == "" && attempt.RetrySafety == string(platform.PublishRetryNever) {
			return DeliveryManualResolution
		}
		return DeliveryAmbiguous
	case StatusSending:
		if attempt.SubmissionState == string(platform.PublishSubmissionPending) {
			if providerScheduled {
				return DeliveryProviderScheduled
			}
			return DeliveryProcessing
		}
		return DeliverySubmitted
	default:
		return DeliveryAmbiguous
	}
}

func deliveryTerminalReason(attempt models.ProviderWriteAttempt) string {
	if attempt.Status != StatusDefiniteFailure && attempt.Status != StatusAmbiguous {
		return ""
	}
	if attempt.SafeErrorClass == "" {
		return attempt.SafeErrorCode
	}
	if attempt.SafeErrorCode == "" {
		return attempt.SafeErrorClass
	}
	return attempt.SafeErrorClass + ":" + attempt.SafeErrorCode
}

func missingProviderDeliveryTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: provider_deliveries") ||
		(strings.Contains(message, "provider_deliveries") && strings.Contains(message, "does not exist"))
}

// MarkStaleJobAttempts converts every sending attempt owned by a stale worker
// lease into an explicit ambiguous outcome before the jobs are requeued.
func (s *Service) MarkStaleJobAttempts(ctx context.Context, cutoff time.Time) (int64, error) {
	var affected int64
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var attemptIDs []string
		if err := tx.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).Column("id").
			Where("status = ?", StatusSending).
			Where("job_id IN (SELECT id FROM jobs WHERE status = ? AND locked_at IS NOT NULL AND locked_at <= ?)", "processing", cutoff.UTC()).
			Scan(txCtx, &attemptIDs); err != nil {
			return err
		}
		if len(attemptIDs) == 0 {
			return nil
		}
		now := s.now()
		result, err := tx.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
			Set("status = ?", StatusAmbiguous).
			Set("submission_state = CASE WHEN submission_state = ? THEN submission_state ELSE ? END", platform.PublishSubmissionPending, platform.PublishSubmissionUnknown).
			Set("retry_safety = CASE WHEN submission_state = ? THEN ? ELSE retry_safety END", platform.PublishSubmissionPending, platform.PublishRetryReconcileOnly).
			Set("safe_error_class = ?", "worker_interrupted").
			Set("completed_at = ?", now).
			Set("updated_at = ?", now).
			Where("id IN (?)", bun.List(attemptIDs)).
			Where("status = ?", StatusSending).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ = result.RowsAffected()
		for _, attemptID := range attemptIDs {
			if err := s.syncDeliveryTx(txCtx, tx, attemptID, false); err != nil {
				return err
			}
		}
		return nil
	})
	return affected, err
}

func normalizeInput(input Input) Input {
	input.OperationID = strings.TrimSpace(input.OperationID)
	input.JobID = strings.TrimSpace(input.JobID)
	input.AuthorizationID = strings.TrimSpace(input.AuthorizationID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.SocialAccountID = strings.TrimSpace(input.SocialAccountID)
	input.TargetKey = strings.TrimSpace(input.TargetKey)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Operation = strings.ToLower(strings.TrimSpace(input.Operation))
	input.PayloadFingerprint = strings.TrimSpace(input.PayloadFingerprint)
	return input
}

func validateInput(input Input) error {
	if input.OperationID == "" || input.WorkspaceID == "" || input.SocialAccountID == "" ||
		input.TargetKey == "" || input.Provider == "" || input.Operation == "" {
		return errors.New("provider write identity and ownership are required")
	}
	if !strings.HasPrefix(input.PayloadFingerprint, "sha256:") {
		return errors.New("provider write payload fingerprint is required")
	}
	return nil
}

func validateAttempt(input Input, attempt *models.ProviderWriteAttempt) error {
	if attempt == nil || attempt.OperationID != input.OperationID ||
		attempt.WorkspaceID != input.WorkspaceID || attempt.PublicationID != input.PublicationID ||
		attempt.RenditionID != input.RenditionID || attempt.SocialAccountID != input.SocialAccountID ||
		attempt.TargetKey != input.TargetKey || attempt.Provider != input.Provider ||
		attempt.Operation != input.Operation || attempt.PayloadFingerprint != input.PayloadFingerprint ||
		attempt.AuthorizationID != input.AuthorizationID {
		return ErrOperationChanged
	}
	return nil
}

func normalizeResult(result platform.PublishResult) platform.PublishResult {
	result.ProviderState = safeShortValue(result.ProviderState, 128)
	if !validProviderState(result.ProviderState) {
		result.ProviderState = ""
	}
	result.ProviderReference = safeProviderReference(result.ProviderReference)
	result.ExternalID = safeShortValue(result.ExternalID, 4096)
	result.ExternalURL = safeExternalURL(result.ExternalURL)
	if !validSubmissionState(result.SubmissionState) {
		result.SubmissionState = ""
	}
	if !validRetrySafety(result.RetrySafety) {
		result.RetrySafety = ""
	}
	return result
}

func mergeResult(stored, returned platform.PublishResult) platform.PublishResult {
	if returned.ExternalID == "" {
		returned.ExternalID = stored.ExternalID
	}
	if returned.ExternalURL == "" {
		returned.ExternalURL = stored.ExternalURL
	}
	if returned.SubmissionState == "" {
		returned.SubmissionState = stored.SubmissionState
	}
	if returned.ProviderState == "" {
		returned.ProviderState = stored.ProviderState
	}
	if returned.ProviderReference == "" {
		returned.ProviderReference = stored.ProviderReference
	}
	if returned.RetrySafety == "" {
		returned.RetrySafety = stored.RetrySafety
	}
	return normalizeResult(returned)
}

func resultFromAttempt(attempt *models.ProviderWriteAttempt) platform.PublishResult {
	if attempt == nil {
		return platform.PublishResult{}
	}
	result := platform.PublishResult{
		ExternalID: attempt.ExternalID, ExternalURL: attempt.ExternalURL,
		SubmissionState: platform.PublishSubmissionState(attempt.SubmissionState),
		ProviderState:   attempt.ProviderState, ProviderReference: attempt.ProviderReference,
		RetrySafety: platform.PublishRetrySafety(attempt.RetrySafety),
	}
	if !attempt.ReconcileAfter.IsZero() {
		result.ReconcileAfter = max(0, time.Until(attempt.ReconcileAfter))
	}
	return result
}

func pendingError(result platform.PublishResult) error {
	delay := result.ReconcileAfter
	if delay <= 0 {
		delay = time.Minute
	}
	return &OutcomeError{Kind: string(platform.PublishSubmissionPending), RetryAfter: delay, Err: ErrOutcomePending}
}

func definitelyRejected(err error) bool {
	var providerErr *platform.HTTPError
	if !errors.As(err, &providerErr) {
		return false
	}
	return providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 && providerErr.StatusCode != http.StatusRequestTimeout
}

func safeError(err error) (string, string, int) {
	if err == nil {
		return "", "", 0
	}
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) {
		class := "provider_rejected"
		if providerErr.StatusCode >= 500 || providerErr.StatusCode == http.StatusRequestTimeout {
			class = "provider_unknown"
		}
		return class, safeShortValue(providerErr.Code, 96), providerErr.StatusCode
	}
	var outcome *OutcomeError
	if errors.As(err, &outcome) {
		return safeShortValue(outcome.Kind, 96), "", 0
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "transport_interrupted", "", 0
	}
	return "provider_unknown", "", 0
}

func storedAttemptError(attempt *models.ProviderWriteAttempt) error {
	err := errors.New("provider write definitely failed")
	if attempt.ErrorHTTPStatus > 0 {
		err = &platform.HTTPError{StatusCode: attempt.ErrorHTTPStatus, Code: attempt.SafeErrorCode}
	}
	return &OutcomeError{Kind: attempt.Status, Err: err}
}

func idempotentRetryAvailable(attempt *models.ProviderWriteAttempt, now time.Time) bool {
	return attempt.RetrySafety == string(platform.PublishRetryIdempotent) &&
		!attempt.IdempotencyExpiresAt.IsZero() && now.Before(attempt.IdempotencyExpiresAt)
}

func firstRetrySafety(value, fallback platform.PublishRetrySafety) platform.PublishRetrySafety {
	if value != "" {
		return value
	}
	return fallback
}

func safeShortValue(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) > maximum {
		return ""
	}
	return value
}

func safeProviderReference(value string) string {
	value = safeShortValue(value, 512)
	if value == "" || strings.Contains(value, "://") || strings.ContainsAny(value, "?#\r\n\t") {
		return ""
	}
	return value
}

func safeExternalURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || !platform.IsSafeContentURL(value) {
		return ""
	}
	for key := range parsed.Query() {
		normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
		switch normalized {
		case "access_token", "token", "auth", "authorization", "signature", "sig", "key", "code":
			return ""
		}
	}
	return value
}

func validSubmissionState(value platform.PublishSubmissionState) bool {
	switch value {
	case "", platform.PublishSubmissionNotSent, platform.PublishSubmissionAccepted,
		platform.PublishSubmissionPending, platform.PublishSubmissionRejected,
		platform.PublishSubmissionUnknown:
		return true
	default:
		return false
	}
}

func validRetrySafety(value platform.PublishRetrySafety) bool {
	switch value {
	case "", platform.PublishRetrySafe, platform.PublishRetryIdempotent,
		platform.PublishRetryReconcileOnly, platform.PublishRetryNever:
		return true
	default:
		return false
	}
}

func durableContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
}

func validProviderState(value string) bool {
	return safeStateValue.MatchString(value)
}
