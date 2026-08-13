package lifecycle

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	EventUploadStarted          = "upload_started"
	EventUploadResumed          = "upload_resumed"
	EventProviderProcessing     = "provider_processing"
	EventPublished              = "published"
	EventFailed                 = "failed"
	EventRetried                = "retried"
	EventAuthorizationConfirmed = "authorization_confirmed"
	EventCommentActionSucceeded = "comment_action_succeeded"
	EventModerationActionFailed = "moderation_action_failed"

	StatusInfo      = "info"
	StatusStarted   = "started"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
)

type Service struct {
	db *bun.DB
}

type EventInput struct {
	WorkspaceID    string
	PublicationID  string
	RenditionID    string
	Type           string
	Status         string
	Message        string
	Metadata       map[string]any
	IdempotencyKey string
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Record(ctx context.Context, input EventInput) (*models.PublicationLifecycleEvent, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	normalized, ok := normalizeEventInput(input)
	if !ok {
		return nil, nil
	}
	if normalized.IdempotencyKey != "" {
		existing, err := s.eventByIdempotencyKey(ctx, normalized.IdempotencyKey)
		if err == nil {
			return existing, nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	metadataJSON, err := json.Marshal(normalized.Metadata)
	if err != nil {
		return nil, err
	}

	event := &models.PublicationLifecycleEvent{
		ID:             uuid.NewString(),
		WorkspaceID:    normalized.WorkspaceID,
		PublicationID:  normalized.PublicationID,
		RenditionID:    normalized.RenditionID,
		Type:           normalized.Type,
		Status:         normalized.Status,
		Message:        normalized.Message,
		MetadataJSON:   string(metadataJSON),
		IdempotencyKey: normalized.IdempotencyKey,
		CreatedAt:      time.Now().UTC(),
	}
	if _, err := s.db.NewInsert().Model(event).Exec(ctx); err != nil {
		if event.IdempotencyKey != "" && isDuplicateLifecycleEvent(err) {
			existing, loadErr := s.eventByIdempotencyKey(ctx, event.IdempotencyKey)
			if loadErr == nil {
				return existing, nil
			}
		}
		return nil, err
	}
	return event, nil
}

func normalizeEventInput(input EventInput) (EventInput, bool) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.Type = strings.TrimSpace(input.Type)
	input.Status = strings.TrimSpace(input.Status)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.WorkspaceID == "" || input.PublicationID == "" || input.Type == "" {
		return EventInput{}, false
	}
	if input.Status == "" {
		input.Status = StatusInfo
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	return input, true
}

func (s *Service) ListForPublication(ctx context.Context, workspaceID, publicationID string, limit int) ([]models.PublicationLifecycleEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var events []models.PublicationLifecycleEvent
	err := s.db.NewSelect().
		Model(&events).
		Where("workspace_id = ?", workspaceID).
		Where("publication_id = ?", publicationID).
		Order("created_at DESC").
		Limit(limit).
		Scan(ctx)
	return events, err
}

func (s *Service) eventByIdempotencyKey(ctx context.Context, key string) (*models.PublicationLifecycleEvent, error) {
	var event models.PublicationLifecycleEvent
	if err := s.db.NewSelect().Model(&event).Where("idempotency_key = ?", key).Scan(ctx); err != nil {
		return nil, err
	}
	return &event, nil
}

func isDuplicateLifecycleEvent(err error) bool {
	if err == nil || errors.Is(err, sql.ErrNoRows) {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique") || strings.Contains(message, "duplicate")
}
