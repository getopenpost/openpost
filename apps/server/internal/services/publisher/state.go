package publisher

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/uptrace/bun"
)

// fencedTx runs a delivery state write under the worker's current lease. A
// worker that lost its lease cannot overwrite state owned by the new holder.
// Callers without a job execution keep their unfenced behavior.
func (s *Service) fencedTx(ctx context.Context, write func(context.Context, bun.Tx) error) error {
	return s.db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		if err := providerwrite.RequireCurrentJobExecution(txCtx, tx, ""); err != nil {
			return err
		}
		return write(txCtx, tx)
	})
}

// Renditions and rendition segments share their delivery status columns.
func clearDeliveryError(query *bun.UpdateQuery) *bun.UpdateQuery {
	return query.
		Set("error_message = ''").
		Set("error_kind = ''").
		Set("error_code = ''").
		Set("error_http_status = 0").
		Set("error_retryable = ?", false).
		Set("error_retry_at = NULL").
		Set("error_action = ''")
}

func setDeliveryFailure(query *bun.UpdateQuery, failure Failure, now time.Time) *bun.UpdateQuery {
	query = query.
		Set("status = ?", renditionOutcomeStatus(failure)).
		Set("error_message = ?", failure.Message).
		Set("error_kind = ?", failure.Kind).
		Set("error_code = ?", failure.Code).
		Set("error_http_status = ?", failure.HTTPStatus).
		Set("error_retryable = ?", failure.Retryable).
		Set("error_action = ?", failure.Action).
		Set("updated_at = ?", now)
	if !failure.Retryable {
		return query.Set("error_retry_at = NULL")
	}
	delay := failure.RetryAfter
	if delay <= 0 {
		delay = RetryDelay(1, 0, 0)
	}
	return query.Set("error_retry_at = ?", now.Add(delay))
}

func renditionOutcomeStatus(failure Failure) string {
	if failure.Code == "provider_submission_pending" || failure.Code == "tiktok_inbox_delivered" {
		return models.RenditionStatusPublishing
	}
	return models.RenditionStatusFailed
}

func (s *Service) markPublicationPublishing(ctx context.Context, publication *models.Publication) error {
	now := time.Now().UTC()
	return s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusPublishing).
			Set("actual_run_at = CASE WHEN status IN (?) AND actual_run_at IS NOT NULL THEN actual_run_at ELSE ? END", bun.List([]string{
				models.PublicationStatusPublishing,
				models.PublicationStatusPublished,
				models.PublicationStatusFailed,
			}), now).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(ctx)
		if err != nil {
			return fmt.Errorf("marking publication %s publishing: %w", publication.ID, err)
		}
		return nil
	})
}

// markDeliveryPublishing marks a rendition or rendition segment as in flight.
func (s *Service) markDeliveryPublishing(ctx context.Context, model any, id string) error {
	return s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		_, err := clearDeliveryError(tx.NewUpdate().Model(model).Set("status = ?", models.RenditionStatusPublishing)).
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ?", id).
			Exec(ctx)
		if err != nil {
			return fmt.Errorf("marking %s publishing: %w", id, err)
		}
		return nil
	})
}

// persistDeliveryFailure records a failure without ever replacing a published
// outcome, which a stale or concurrent worker may otherwise overwrite.
func (s *Service) persistDeliveryFailure(ctx context.Context, model any, id string, failure Failure) error {
	return s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		_, err := setDeliveryFailure(tx.NewUpdate().Model(model), failure, time.Now().UTC()).
			Where("id = ? AND status <> ?", id, models.RenditionStatusPublished).
			Exec(ctx)
		return err
	})
}

func (s *Service) persistRenditionOutcome(ctx context.Context, renditionID string, failure Failure) error {
	return s.persistDeliveryFailure(ctx, (*models.Rendition)(nil), renditionID, failure)
}

// persistRenditionSegmentOutcome records a segment failure and returns the
// original failure so callers can propagate it.
func (s *Service) persistRenditionSegmentOutcome(ctx context.Context, segment *models.RenditionSegment, failure error) error {
	if failure == nil || segment == nil {
		return failure
	}
	if err := s.persistDeliveryFailure(ctx, (*models.RenditionSegment)(nil), segment.ID, ClassifyFailure(failure)); err != nil {
		log.Printf("[Publisher] Failed to mark rendition segment %s failed: %v", segment.ID, err)
	}
	return failure
}

// The published state and its durable event are one commit. Source consumers can
// recover missed worker wakeups by reading the event after a process restart.
func (s *Service) completeRendition(ctx context.Context, publication *models.Publication, rendition *models.Rendition, externalID, externalURL string, publishedAt time.Time) error {
	err := s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		if _, err := clearDeliveryError(tx.NewUpdate().Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusPublished).
			Set("external_id = ?", externalID).
			Set("external_url = ?", externalURL)).
			Set("updated_at = ?", publishedAt).
			Where("id = ?", rendition.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("updating rendition status: %w", err)
		}
		_, err := lifecycle.NewService(tx).Record(ctx, lifecycle.EventInput{WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID, RenditionID: rendition.ID, Type: lifecycle.EventPublished, Status: lifecycle.StatusSucceeded, Message: "rendition published", CreatedAt: publishedAt, Metadata: map[string]any{"platform": rendition.Platform, "external_id": externalID, "external_url": externalURL}})
		return err
	})
	if err != nil {
		return &renditionCompletionError{cause: err}
	}
	return nil
}

// completeSegment records an accepted segment and, for the thread root, the
// rendition's remote identity in one commit.
func (s *Service) completeSegment(ctx context.Context, renditionID, segmentID, externalID, externalURL string, root bool) error {
	err := s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		if _, err := clearDeliveryError(tx.NewUpdate().Model((*models.RenditionSegment)(nil)).
			Set("status = ?", models.RenditionStatusPublished).
			Set("external_id = ?", externalID).
			Set("external_url = ?", externalURL)).
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ?", segmentID).
			Exec(ctx); err != nil {
			return fmt.Errorf("persisting rendition segment result: %w", err)
		}
		if root {
			return saveRenditionExternalIdentity(ctx, tx, renditionID, externalID, externalURL)
		}
		return nil
	})
	if err != nil {
		return &renditionCompletionError{cause: err}
	}
	return nil
}

// finalizePublication derives the publication status from its renditions in
// the same transaction that writes it. Touching the publication row first
// serializes concurrent destination jobs: PostgreSQL holds the row lock until
// commit and SQLite holds its write lock, so a slower job cannot write a
// status derived from an older snapshot of the renditions.
func (s *Service) finalizePublication(ctx context.Context, publication *models.Publication) error {
	var status string
	err := s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		now := time.Now().UTC()
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(ctx); err != nil {
			return err
		}
		var renditions []models.Rendition
		if err := tx.NewSelect().Model(&renditions).Where("publication_id = ?", publication.ID).Scan(ctx); err != nil {
			return fmt.Errorf("load renditions for publication %s: %w", publication.ID, err)
		}
		status = publicationStatusFor(renditions)
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", status).
			Where("id = ?", publication.ID).
			Exec(ctx); err != nil {
			return err
		}
		return s.createPublicationResultNotifications(ctx, tx, publication, status, renditions)
	})
	if err != nil {
		return fmt.Errorf("finalize publication %s: %w", publication.ID, err)
	}
	if status == models.PublicationStatusPublished {
		if err := medialifecycle.NewService(s.db, s.storage).TrashTemporaryForPublication(ctx, publication.ID); err != nil {
			log.Printf("[Publisher] Failed to clean temporary media for publication %s: %v", publication.ID, err)
		}
	}
	return nil
}

func publicationStatusFor(renditions []models.Rendition) string {
	hasFailed, hasPublishing, allPublished := false, false, len(renditions) > 0
	for _, rendition := range renditions {
		switch rendition.Status {
		case models.RenditionStatusFailed:
			hasFailed = true
		case models.RenditionStatusPublishing:
			hasPublishing = true
		}
		if rendition.Status != models.RenditionStatusPublished {
			allPublished = false
		}
	}
	switch {
	case allPublished:
		return models.PublicationStatusPublished
	case hasPublishing:
		return models.PublicationStatusPublishing
	case hasFailed:
		return models.PublicationStatusFailed
	default:
		return models.PublicationStatusScheduled
	}
}

func (s *Service) createPublicationResultNotifications(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	status string,
	renditions []models.Rendition,
) error {
	if s.notifications == nil || publication.CreatedByID == "" {
		return nil
	}
	if status != models.PublicationStatusPublished && status != models.PublicationStatusFailed {
		return nil
	}
	result, err := collectPublicationNotificationResult(ctx, db, renditions)
	if err != nil {
		return err
	}
	outcome, err := notifications.NewPublicationResultOutcome(notifications.PublicationResultFacts{
		RecipientUserID:        publication.CreatedByID,
		WorkspaceID:            publication.WorkspaceID,
		PublicationID:          publication.ID,
		DeliveryID:             publicationNotificationCohort(ctx, publication),
		SuccessfulDestinations: result.successful,
		FailedDestinations:     result.failed,
		Retryable:              result.retryable,
		RequiresReconnect:      result.reconnect,
	})
	if err != nil {
		return err
	}
	if err := s.notifications.RecordWithDB(ctx, db, outcome); err != nil {
		return err
	}
	if status == models.PublicationStatusPublished {
		if err := s.notifications.RecordQueueEmptiedAfterPublication(ctx, db, publication.WorkspaceID, publication.ID); err != nil {
			return err
		}
	}
	if !result.reconnect {
		return nil
	}
	return s.createReconnectNotifications(ctx, db, publication, result, renditions)
}

type publicationNotificationResult struct {
	accounts            map[string]models.SocialAccount
	successful          []string
	failed              []string
	reconnectAccountIDs []string
	retryable           bool
	reconnect           bool
}

func collectPublicationNotificationResult(
	ctx context.Context,
	db bun.IDB,
	renditions []models.Rendition,
) (publicationNotificationResult, error) {
	accountIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		accountIDs = append(accountIDs, rendition.SocialAccountID)
	}
	var accounts []models.SocialAccount
	if len(accountIDs) > 0 {
		if err := db.NewSelect().Model(&accounts).Where("id IN (?)", bun.List(accountIDs)).Scan(ctx); err != nil &&
			!errors.Is(err, sql.ErrNoRows) {
			return publicationNotificationResult{}, err
		}
	}
	result := publicationNotificationResult{
		accounts:            make(map[string]models.SocialAccount, len(accounts)),
		successful:          make([]string, 0, len(renditions)),
		failed:              make([]string, 0, len(renditions)),
		reconnectAccountIDs: make([]string, 0, len(renditions)),
	}
	for _, account := range accounts {
		result.accounts[account.ID] = account
	}
	for _, rendition := range renditions {
		label := publisherDestinationLabel(rendition, result.accounts[rendition.SocialAccountID])
		switch rendition.Status {
		case models.RenditionStatusPublished:
			result.successful = append(result.successful, label)
		case models.RenditionStatusFailed:
			result.failed = append(result.failed, label)
			result.retryable = result.retryable || rendition.ErrorRetryable
			if rendition.ErrorAction == FailureActionReconnect {
				result.reconnect = true
				result.reconnectAccountIDs = append(result.reconnectAccountIDs, rendition.SocialAccountID)
			}
		}
	}
	return result, nil
}

func publicationNotificationCohort(ctx context.Context, publication *models.Publication) string {
	if execution, _ := jobExecutionFromContext(ctx); execution.ID != "" {
		return "job:" + execution.ID
	}
	return fmt.Sprintf("revision:%d", publication.Revision)
}

func (s *Service) createReconnectNotifications(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	result publicationNotificationResult,
	renditions []models.Rendition,
) error {
	for _, accountID := range result.reconnectAccountIDs {
		account := result.accounts[accountID]
		if account.ID == "" {
			continue
		}
		outcome, err := notifications.NewAccountNeedsAttentionOutcome(notifications.AccountAttentionFacts{
			RecipientUserID: publication.CreatedByID, WorkspaceID: publication.WorkspaceID,
			AccountID: account.ID, PublicationID: publication.ID, Provider: account.Platform,
			AccountLabel: publisherAccountLabel(account),
		})
		if err != nil {
			return err
		}
		if err := s.notifications.RecordWithDB(ctx, db, outcome); err != nil {
			return err
		}
		failureKind, failureAt := reconnectFailureDetails(renditions, accountID)
		if !account.PreflightCheckedAt.IsZero() && strings.TrimSpace(account.PreflightFailure) == "" && !failureAt.IsZero() && failureAt.Before(account.PreflightCheckedAt) {
			continue
		}
		if err := s.recordCredentialFailureTransition(ctx, db, accountID, failureKind, failureAt); err != nil {
			return err
		}
	}
	return nil
}

// reconnectFailureDetails returns the stored error kind and most recent update
// timestamp of a failed destination that requires reconnecting the account, or
// the reconnect-required default when the persisted kind is missing.
func reconnectFailureDetails(renditions []models.Rendition, accountID string) (string, time.Time) {
	kind := ""
	var latest time.Time
	for _, rendition := range renditions {
		if rendition.SocialAccountID == accountID &&
			rendition.Status == models.RenditionStatusFailed &&
			rendition.ErrorAction == FailureActionReconnect {
			if rendition.UpdatedAt.After(latest) {
				latest = rendition.UpdatedAt
				if trimmed := strings.TrimSpace(rendition.ErrorKind); trimmed != "" {
					kind = trimmed
				}
			} else if kind == "" {
				if trimmed := strings.TrimSpace(rendition.ErrorKind); trimmed != "" {
					kind = trimmed
				}
			}
		}
	}
	if kind == "" {
		kind = FailureReconnectRequired
	}
	return kind, latest
}

// recordCredentialFailureTransition claims the account's credential failure
// generation when this destination failure is the first confirmed credential
// break since the account was last healthy. The claim, the stored failure
// state, and the transition notifications commit with the publication
// result, so concurrent publications cannot double-notify one break. The
// existing per-publication creator notification is recorded separately and
// stays unchanged.
func (s *Service) recordCredentialFailureTransition(ctx context.Context, db bun.IDB, accountID, failureKind string, failureAt time.Time) error {
	claim := db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("credential_failure_generation = credential_failure_generation + 1").
		Where("id = ?", accountID).
		Where("COALESCE(preflight_failure, '') IN ('', 'unknown', 'unsupported')")
	if !failureAt.IsZero() {
		claim = claim.Where("(preflight_checked_at IS NULL OR COALESCE(preflight_failure, '') <> '' OR preflight_checked_at <= ?)", failureAt.UTC())
	}
	result, err := claim.Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return nil
	}
	var account models.SocialAccount
	if err := db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		return err
	}
	// The claimed break must also mark the account unhealthy so a later
	// preflight failure cannot claim a second generation for the same break.
	if _, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("preflight_failure = ?", failureKind).
		Where("id = ?", accountID).
		Exec(ctx); err != nil {
		return err
	}
	recipients, err := notifications.AccountCredentialFailureRecipients(ctx, db, &account)
	if err != nil {
		return err
	}
	for _, recipientID := range recipients {
		outcome, outcomeErr := notifications.NewAccountCredentialFailureOutcome(notifications.AccountCredentialFailureFacts{
			RecipientUserID: recipientID,
			WorkspaceID:     account.WorkspaceID,
			AccountID:       account.ID,
			Generation:      account.CredentialFailureGeneration,
			Provider:        account.Platform,
			AccountLabel:    publisherAccountLabel(account),
		})
		if outcomeErr != nil {
			return outcomeErr
		}
		if err := s.notifications.RecordWithDB(ctx, db, outcome); err != nil {
			return err
		}
	}
	return nil
}

func publisherDestinationLabel(rendition models.Rendition, account models.SocialAccount) string {
	label := publisherProviderLabel(rendition.Platform)
	username := strings.TrimSpace(account.AccountUsername)
	if username == "" {
		username = strings.TrimSpace(account.Slug)
	}
	if username == "" {
		return label
	}
	if !strings.HasPrefix(username, "@") {
		username = "@" + username
	}
	return label + " " + username
}

func publisherAccountLabel(account models.SocialAccount) string {
	return publisherDestinationLabel(models.Rendition{Platform: account.Platform}, account)
}

func publisherProviderLabel(provider string) string {
	normalized := strings.ToLower(strings.TrimSpace(provider))
	if name := capabilities.ProviderDisplayName(normalized); name != "" && name != normalized {
		return name
	}
	return "Destination"
}
