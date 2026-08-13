package publicationauth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/uptrace/bun"
)

const (
	ActionPublish = "publish"
	ActionReply   = "reply"

	PolicyImmediate       = "immediate"
	PolicyScheduled       = "scheduled"
	PolicyRetry           = "retry"
	PolicyReplyImmediate  = "reply_immediate"
	PolicyReplyScheduled  = "reply_scheduled"
	PolicyLegacyScheduled = "legacy_scheduled"

	ExecutionIntentProduction        = "production"
	ExecutionIntentCertificationTest = "certification_test"
)

var (
	ErrActorRequired         = errors.New("publication authorization actor is required")
	ErrReceiptRequired       = errors.New("publication authorization receipt is required")
	ErrReceiptMismatch       = errors.New("publication authorization receipt no longer matches the queued write")
	ErrReceiptJobMismatch    = errors.New("publication authorization receipt belongs to another job")
	ErrReceiptTargetMismatch = errors.New("publication authorization receipt target mismatch")
	ErrReceiptTimeMismatch   = errors.New("publication authorization receipt scheduled time mismatch")
)

type JobTarget struct {
	JobID       string
	RenditionID string
	RunAt       time.Time
}

type BatchInput struct {
	BatchID         string
	PublicationID   string
	Actor           Actor
	Action          string
	PolicyMode      string
	ExecutionIntent string
	ConfirmedAt     time.Time
	Targets         []JobTarget
}

type ExplicitInput struct {
	BatchInput
	RenditionID string
	JobID       string
	RunAt       time.Time
	Content     any
	Media       any
	Settings    any
}

type ValidateInput struct {
	BatchID         string
	PublicationID   string
	RenditionID     string
	JobID           string
	Action          string
	Content         any
	Media           any
	Settings        any
	Explicit        bool
	ScheduledAt     time.Time
	ExecutionIntent string
}

func CreateBatch(ctx context.Context, db bun.IDB, input BatchInput) (string, []models.PublicationAuthorization, error) {
	input.Actor = input.Actor.normalized()
	if !input.Actor.valid() {
		return "", nil, ErrActorRequired
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.Action = strings.TrimSpace(input.Action)
	input.PolicyMode = strings.TrimSpace(input.PolicyMode)
	input.ExecutionIntent = normalizedExecutionIntent(input.ExecutionIntent)
	if input.PublicationID == "" || !validAction(input.Action) || !validPolicyMode(input.PolicyMode) ||
		input.ExecutionIntent == "" || len(input.Targets) == 0 {
		return "", nil, fmt.Errorf("invalid publication authorization batch")
	}
	if input.BatchID == "" {
		input.BatchID = uuid.NewString()
	}
	if input.ConfirmedAt.IsZero() {
		input.ConfirmedAt = time.Now().UTC()
	} else {
		input.ConfirmedAt = input.ConfirmedAt.UTC()
	}

	resolved, err := resolveBatchTargets(ctx, db, input.PublicationID, input.Targets)
	if err != nil {
		return "", nil, err
	}
	receipts := make([]models.PublicationAuthorization, 0, len(resolved))
	for _, target := range resolved {
		snapshot, err := SnapshotForRendition(ctx, db, input.PublicationID, target.RenditionID)
		if err != nil {
			return "", nil, err
		}
		receipts = append(receipts, receiptFromSnapshot(input, target, snapshot))
	}
	if len(receipts) == 0 {
		return "", nil, fmt.Errorf("publication has no destinations to authorize")
	}
	if _, err := db.NewInsert().Model(&receipts).Exec(ctx); err != nil {
		return "", nil, fmt.Errorf("store publication authorization receipts: %w", err)
	}
	if err := insertAuthorizationEvent(ctx, db, receipts); err != nil {
		return "", nil, err
	}
	sortReceipts(receipts)
	return input.BatchID, receipts, nil
}

func CreateExplicit(ctx context.Context, db bun.IDB, input ExplicitInput) (string, *models.PublicationAuthorization, error) {
	input, err := normalizeExplicitInput(input)
	if err != nil {
		return "", nil, err
	}
	snapshot, err := explicitSnapshot(ctx, db, input.PublicationID, input.RenditionID, input.Content, input.Media, input.Settings)
	if err != nil {
		return "", nil, err
	}
	receipt := receiptFromSnapshot(input.BatchInput, JobTarget{
		JobID: input.JobID, RenditionID: input.RenditionID, RunAt: input.RunAt,
	}, snapshot)
	if _, err := db.NewInsert().Model(&receipt).Exec(ctx); err != nil {
		return "", nil, fmt.Errorf("store explicit publication authorization receipt: %w", err)
	}
	if err := insertAuthorizationEvent(ctx, db, []models.PublicationAuthorization{receipt}); err != nil {
		return "", nil, err
	}
	return input.BatchID, &receipt, nil
}

func normalizeExplicitInput(input ExplicitInput) (ExplicitInput, error) {
	input.Actor = input.Actor.normalized()
	if !input.Actor.valid() {
		return ExplicitInput{}, ErrActorRequired
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.Action = strings.TrimSpace(input.Action)
	input.PolicyMode = strings.TrimSpace(input.PolicyMode)
	input.ExecutionIntent = normalizedExecutionIntent(input.ExecutionIntent)
	input.JobID = strings.TrimSpace(input.JobID)
	if input.PublicationID == "" || input.RenditionID == "" || input.JobID == "" ||
		!validAction(input.Action) || !validPolicyMode(input.PolicyMode) || input.ExecutionIntent == "" || input.RunAt.IsZero() {
		return ExplicitInput{}, fmt.Errorf("invalid explicit publication authorization")
	}
	if input.BatchID == "" {
		input.BatchID = uuid.NewString()
	}
	input.RunAt = normalizeScheduledTime(input.RunAt)
	if input.ConfirmedAt.IsZero() {
		input.ConfirmedAt = time.Now().UTC()
	} else {
		input.ConfirmedAt = input.ConfirmedAt.UTC()
	}
	return input, nil
}

func explicitSnapshot(ctx context.Context, db bun.IDB, publicationID, renditionID string, content, media, settings any) (Snapshot, error) {
	snapshot, err := SnapshotForRendition(ctx, db, publicationID, renditionID)
	if err != nil {
		return Snapshot{}, err
	}
	if snapshot.ContentHash, err = HashExplicit("publication-explicit-content-v1", content); err != nil {
		return Snapshot{}, err
	}
	if snapshot.MediaHash, err = HashExplicit("publication-explicit-media-v1", media); err != nil {
		return Snapshot{}, err
	}
	if snapshot.SettingsHash, err = HashExplicit("publication-explicit-settings-v1", settings); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func ValidateBatch(ctx context.Context, db bun.IDB, input ValidateInput) ([]models.PublicationAuthorization, error) {
	input.BatchID = strings.TrimSpace(input.BatchID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.JobID = strings.TrimSpace(input.JobID)
	input.Action = strings.TrimSpace(input.Action)
	input.ExecutionIntent = normalizedExecutionIntent(input.ExecutionIntent)
	input.ScheduledAt = normalizeScheduledTime(input.ScheduledAt)
	if input.BatchID == "" || input.PublicationID == "" || !validAction(input.Action) {
		return nil, ErrReceiptRequired
	}
	receipts, err := loadReceipts(ctx, db, input)
	if err != nil {
		return nil, err
	}
	for _, receipt := range receipts {
		if receipt.ExecutionIntent != input.ExecutionIntent {
			return nil, ErrReceiptMismatch
		}
		if err := validateReceipt(ctx, db, input, receipt); err != nil {
			return nil, err
		}
	}
	return receipts, nil
}

func loadReceipts(ctx context.Context, db bun.IDB, input ValidateInput) ([]models.PublicationAuthorization, error) {
	var receipts []models.PublicationAuthorization
	query := db.NewSelect().Model(&receipts).
		Where("batch_id = ? AND publication_id = ? AND action = ?", input.BatchID, input.PublicationID, input.Action)
	if input.RenditionID != "" {
		query = query.Where("rendition_id = ?", input.RenditionID)
	}
	if err := query.Order("rendition_id ASC").Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrReceiptRequired
		}
		return nil, fmt.Errorf("load publication authorization receipts: %w", err)
	}
	if len(receipts) == 0 {
		return nil, ErrReceiptRequired
	}
	return receipts, nil
}

func validateReceipt(ctx context.Context, db bun.IDB, input ValidateInput, receipt models.PublicationAuthorization) error {
	if input.JobID != "" && receipt.JobID != input.JobID {
		return ErrReceiptJobMismatch
	}
	if !input.ScheduledAt.IsZero() && !normalizeScheduledTime(receipt.ScheduledAt).Equal(input.ScheduledAt) {
		return ErrReceiptTimeMismatch
	}
	current, err := SnapshotForRendition(ctx, db, input.PublicationID, receipt.RenditionID)
	if err != nil {
		return errors.Join(ErrReceiptMismatch, err)
	}
	if input.Explicit {
		current, err = explicitSnapshot(ctx, db, input.PublicationID, receipt.RenditionID, input.Content, input.Media, input.Settings)
		if err != nil {
			return errors.Join(ErrReceiptMismatch, err)
		}
	}
	if current.SocialAccountID != receipt.SocialAccountID || current.TargetKey != receipt.TargetKey {
		return ErrReceiptTargetMismatch
	}
	if current.PublicationRevision != receipt.PublicationRevision ||
		current.ContentHash != receipt.ContentHash || current.MediaHash != receipt.MediaHash ||
		current.SettingsHash != receipt.SettingsHash || current.ProviderPolicyMode != receipt.ProviderPolicyMode {
		return ErrReceiptMismatch
	}
	return nil
}

func receiptFromSnapshot(input BatchInput, target JobTarget, snapshot Snapshot) models.PublicationAuthorization {
	confirmedAt := input.ConfirmedAt.UTC()
	if confirmedAt.IsZero() {
		confirmedAt = time.Now().UTC()
	}
	return models.PublicationAuthorization{
		ID: uuid.NewString(), BatchID: input.BatchID, JobID: strings.TrimSpace(target.JobID),
		WorkspaceID: snapshot.WorkspaceID, PublicationID: input.PublicationID,
		RenditionID: target.RenditionID, Action: input.Action,
		ActorOrigin: input.Actor.Origin, ActorUserID: input.Actor.UserID,
		ActorSessionID: input.Actor.SessionID, ActorTokenID: input.Actor.TokenID,
		ActorClientID: input.Actor.ClientID, ActorClientName: input.Actor.ClientName,
		PublicationRevision: snapshot.PublicationRevision, SocialAccountID: snapshot.SocialAccountID,
		TargetKey: snapshot.TargetKey, ScheduledAt: normalizeScheduledTime(target.RunAt),
		ContentHash: snapshot.ContentHash, MediaHash: snapshot.MediaHash, SettingsHash: snapshot.SettingsHash,
		PolicyMode: input.PolicyMode, ProviderPolicyMode: snapshot.ProviderPolicyMode,
		ExecutionIntent: input.ExecutionIntent, ConfirmedAt: confirmedAt, CreatedAt: confirmedAt,
	}
}

func resolveBatchTargets(ctx context.Context, db bun.IDB, publicationID string, targets []JobTarget) ([]JobTarget, error) {
	var publication models.Publication
	if err := db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load authorization publication: %w", err)
	}
	resolved := make([]JobTarget, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		target.JobID = strings.TrimSpace(target.JobID)
		target.RenditionID = strings.TrimSpace(target.RenditionID)
		target.RunAt = normalizeScheduledTime(target.RunAt)
		if target.RunAt.IsZero() {
			return nil, fmt.Errorf("authorization scheduled time is required")
		}
		if target.JobID == "" {
			return nil, fmt.Errorf("authorization job identity is required")
		}
		if target.RenditionID != "" {
			if seen[target.RenditionID] {
				return nil, fmt.Errorf("duplicate authorization rendition %s", target.RenditionID)
			}
			seen[target.RenditionID] = true
			resolved = append(resolved, target)
			continue
		}
		var renditions []models.Rendition
		if err := db.NewSelect().Model(&renditions).
			Where("publication_id = ?", publication.ID).
			Order("created_at ASC", "id ASC").Scan(ctx); err != nil {
			return nil, fmt.Errorf("load authorization destinations: %w", err)
		}
		for _, rendition := range renditions {
			if seen[rendition.ID] {
				continue
			}
			seen[rendition.ID] = true
			resolved = append(resolved, JobTarget{JobID: target.JobID, RenditionID: rendition.ID, RunAt: target.RunAt})
		}
	}
	return resolved, nil
}

func normalizeScheduledTime(value time.Time) time.Time {
	if value.IsZero() {
		return value
	}
	return value.UTC().Truncate(time.Microsecond)
}

func validAction(action string) bool {
	switch strings.TrimSpace(action) {
	case ActionPublish, ActionReply:
		return true
	default:
		return false
	}
}

func validPolicyMode(policyMode string) bool {
	switch strings.TrimSpace(policyMode) {
	case PolicyImmediate, PolicyScheduled, PolicyRetry, PolicyReplyImmediate, PolicyReplyScheduled, PolicyLegacyScheduled:
		return true
	default:
		return false
	}
}

func normalizedExecutionIntent(intent string) string {
	switch strings.TrimSpace(intent) {
	case "", ExecutionIntentProduction:
		return ExecutionIntentProduction
	case ExecutionIntentCertificationTest:
		return ExecutionIntentCertificationTest
	default:
		return ""
	}
}

func insertAuthorizationEvent(ctx context.Context, db bun.IDB, receipts []models.PublicationAuthorization) error {
	if len(receipts) == 0 {
		return nil
	}
	first := receipts[0]
	metadata, err := json.Marshal(map[string]any{
		"authorization_batch_id": first.BatchID,
		"action":                 first.Action,
		"actor_origin":           first.ActorOrigin,
		"publication_revision":   first.PublicationRevision,
		"policy_mode":            first.PolicyMode,
		"destination_count":      len(receipts),
		"confirmed_at":           first.ConfirmedAt.UTC().Format(time.RFC3339Nano),
		"fingerprints_recorded":  true,
	})
	if err != nil {
		return fmt.Errorf("encode publication authorization event: %w", err)
	}
	event := &models.PublicationLifecycleEvent{
		ID: uuid.NewString(), WorkspaceID: first.WorkspaceID, PublicationID: first.PublicationID,
		Type: lifecycle.EventAuthorizationConfirmed, Status: lifecycle.StatusSucceeded,
		Message: "Publication authorization confirmed", MetadataJSON: string(metadata),
		IdempotencyKey: "publication-authorization:" + first.BatchID,
		CreatedAt:      first.ConfirmedAt.UTC(),
	}
	if _, err := db.NewInsert().Model(event).Exec(ctx); err != nil {
		return fmt.Errorf("store publication authorization event: %w", err)
	}
	return nil
}
