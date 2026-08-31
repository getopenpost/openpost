package botingress

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const MaxEventBodyBytes = 256 << 10

type SignatureVerifier interface {
	Verify(headers http.Header, body []byte) error
}

type VerifyFunc func(http.Header, []byte) error

func (verify VerifyFunc) Verify(headers http.Header, body []byte) error {
	return verify(headers, body)
}

// SecretHeaderVerifier supports providers whose webhook authentication is an
// exact shared-secret header. Providers with signed bodies can implement
// SignatureVerifier directly.
type SecretHeaderVerifier struct {
	HeaderName string
	Secret     string
}

func (verifier SecretHeaderVerifier) Verify(headers http.Header, _ []byte) error {
	expected := []byte(strings.TrimSpace(verifier.Secret))
	provided := []byte(strings.TrimSpace(headers.Get(strings.TrimSpace(verifier.HeaderName))))
	if len(expected) == 0 || len(provided) != len(expected) || subtle.ConstantTimeCompare(provided, expected) != 1 {
		return ErrInvalidSignature
	}
	return nil
}

type EventNormalizer interface {
	Normalize(body []byte) (NormalizedEvent, error)
}

type NormalizeFunc func([]byte) (NormalizedEvent, error)

func (normalize NormalizeFunc) Normalize(body []byte) (NormalizedEvent, error) {
	return normalize(body)
}

type NormalizedEvent struct {
	ProviderEventID      string
	Kind                 string
	WorkspaceID          string
	SocialAccountID      string
	SubjectReference     string
	ParentReference      string
	ContentProfile       string
	ContentText          string
	MetricsJSON          string
	OccurredAt           time.Time
	ConnectionCredential string
}

type AcceptRequest struct {
	Provider   string
	Headers    http.Header
	Body       []byte
	Verifier   SignatureVerifier
	Normalizer EventNormalizer
}

type AcceptResult struct {
	EventID   string `json:"event_id"`
	Duplicate bool   `json:"duplicate"`
}

func (s *Service) Accept(ctx context.Context, request AcceptRequest) (AcceptResult, error) {
	event, claims, now, err := s.prepareEvent(request)
	if err != nil {
		return AcceptResult{}, err
	}
	result, err := s.persistEvent(ctx, event, claims, now)
	if err == nil {
		return result, nil
	}
	var safe *SafeError
	if errors.As(err, &safe) {
		return AcceptResult{}, safe
	}
	return AcceptResult{}, ErrIngressUnavailable
}

func (s *Service) prepareEvent(request AcceptRequest) (*models.BotIngressEvent, credentialClaims, time.Time, error) {
	provider := normalizeProvider(request.Provider)
	if s.db == nil || !validProvider(provider) || request.Verifier == nil || request.Normalizer == nil {
		return nil, credentialClaims{}, time.Time{}, ErrIngressUnavailable
	}
	if len(request.Body) == 0 {
		return nil, credentialClaims{}, time.Time{}, ErrInvalidEvent
	}
	if len(request.Body) > MaxEventBodyBytes {
		return nil, credentialClaims{}, time.Time{}, ErrEventTooLarge
	}
	if err := request.Verifier.Verify(request.Headers, request.Body); err != nil {
		return nil, credentialClaims{}, time.Time{}, ErrInvalidSignature
	}

	normalized, err := request.Normalizer.Normalize(request.Body)
	if err != nil {
		return nil, credentialClaims{}, time.Time{}, ErrInvalidEvent
	}
	normalized = normalizeEvent(normalized)
	now := s.now().UTC()
	if normalized.OccurredAt.IsZero() {
		normalized.OccurredAt = now
	}
	if !validNormalizedEvent(normalized) {
		return nil, credentialClaims{}, time.Time{}, ErrInvalidEvent
	}

	claims, err := s.connectionClaims(normalized.ConnectionCredential, provider, now)
	if err != nil {
		return nil, credentialClaims{}, time.Time{}, err
	}
	event := &models.BotIngressEvent{
		ID: uuid.NewString(), Provider: provider, ProviderEventID: normalized.ProviderEventID,
		Kind: normalized.Kind, WorkspaceID: normalized.WorkspaceID,
		SocialAccountID: normalized.SocialAccountID, SubjectReference: normalized.SubjectReference,
		ParentReference: normalized.ParentReference, ContentProfile: normalized.ContentProfile,
		ContentText: normalized.ContentText, MetricsJSON: normalized.MetricsJSON, OccurredAt: normalized.OccurredAt,
		CreatedAt: now,
	}
	if !claimsEmpty(claims) {
		event.ConnectionNonceID = claims.ID
	}
	return event, claims, now, nil
}

func (s *Service) connectionClaims(credential, provider string, now time.Time) (credentialClaims, error) {
	if credential == "" {
		return credentialClaims{}, nil
	}
	claims, err := s.decodeCredential(credential, now)
	if err != nil {
		return credentialClaims{}, err
	}
	if claims.Provider != provider {
		return credentialClaims{}, ErrInvalidNonce
	}
	return claims, nil
}

func (s *Service) persistEvent(ctx context.Context, event *models.BotIngressEvent, claims credentialClaims, now time.Time) (AcceptResult, error) {
	var result AcceptResult
	var err error
	for attempt := 0; attempt < 50; attempt++ {
		result = AcceptResult{}
		err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			accepted, acceptErr := s.acceptOnce(txCtx, tx, event, claims, now)
			result = accepted
			return acceptErr
		})
		if err == nil || !isTransientSQLiteContention(err) || attempt == 49 {
			return result, err
		}
		if !waitForContentionRetry(ctx) {
			return AcceptResult{}, ErrIngressUnavailable
		}
	}
	return result, err
}

func waitForContentionRetry(ctx context.Context) bool {
	timer := time.NewTimer(2 * time.Millisecond)
	select {
	case <-ctx.Done():
		timer.Stop()
		return false
	case <-timer.C:
		return true
	}
}

func (s *Service) acceptOnce(ctx context.Context, tx bun.Tx, event *models.BotIngressEvent, claims credentialClaims, now time.Time) (AcceptResult, error) {
	insert, err := tx.NewInsert().Model(event).
		On("CONFLICT (provider, provider_event_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return AcceptResult{}, err
	}
	rows, err := insert.RowsAffected()
	if err != nil {
		return AcceptResult{}, err
	}
	if rows == 0 {
		var existing models.BotIngressEvent
		if err := tx.NewSelect().Model(&existing).
			Where("provider = ? AND provider_event_id = ?", event.Provider, event.ProviderEventID).
			Scan(ctx); err != nil {
			return AcceptResult{}, err
		}
		return AcceptResult{EventID: existing.ID, Duplicate: true}, nil
	}

	if !claimsEmpty(claims) {
		nonce, err := s.consumeClaims(ctx, tx, claims, now, event.SubjectReference)
		if err != nil {
			return AcceptResult{}, err
		}
		if event.WorkspaceID != "" && event.WorkspaceID != nonce.WorkspaceID {
			return AcceptResult{}, ErrInvalidEvent
		}
		event.WorkspaceID = nonce.WorkspaceID
		if _, err := tx.NewUpdate().Model((*models.BotIngressEvent)(nil)).
			Set("workspace_id = ?", nonce.WorkspaceID).
			Where("id = ?", event.ID).Exec(ctx); err != nil {
			return AcceptResult{}, err
		}
	}

	payload, err := jobregistry.EncodeBotIngressPayload(jobregistry.BotIngressPayload{
		EventID: event.ID, WorkspaceID: event.WorkspaceID,
	})
	if err != nil {
		return AcceptResult{}, ErrInvalidEvent
	}
	job, err := jobregistry.NewJob(jobregistry.TypeBotIngress, payload, now)
	if err != nil {
		return AcceptResult{}, ErrIngressUnavailable
	}
	identity, err := jobregistry.IdentityForPayload(jobregistry.TypeBotIngress, payload)
	if err != nil {
		return AcceptResult{}, ErrInvalidEvent
	}
	job.ScopeID = identity.ScopeID
	job.DedupeKey = identity.DedupeKey
	if _, err := tx.NewInsert().Model(job).Exec(ctx); err != nil {
		return AcceptResult{}, err
	}
	return AcceptResult{EventID: event.ID}, nil
}

func normalizeEvent(event NormalizedEvent) NormalizedEvent {
	event.ProviderEventID = strings.TrimSpace(event.ProviderEventID)
	event.Kind = strings.ToLower(strings.TrimSpace(event.Kind))
	event.WorkspaceID = strings.TrimSpace(event.WorkspaceID)
	event.SocialAccountID = strings.TrimSpace(event.SocialAccountID)
	event.SubjectReference = strings.TrimSpace(event.SubjectReference)
	event.ParentReference = strings.TrimSpace(event.ParentReference)
	event.ContentProfile = strings.TrimSpace(event.ContentProfile)
	event.ContentText = strings.TrimSpace(event.ContentText)
	event.MetricsJSON = strings.TrimSpace(event.MetricsJSON)
	if event.MetricsJSON == "" {
		event.MetricsJSON = "{}"
	}
	event.ConnectionCredential = strings.TrimSpace(event.ConnectionCredential)
	if !event.OccurredAt.IsZero() {
		event.OccurredAt = event.OccurredAt.UTC()
	}
	return event
}

func validNormalizedEvent(event NormalizedEvent) bool {
	return validReference(event.ProviderEventID, 200, true) && validKind(event.Kind) &&
		validReference(event.WorkspaceID, 200, false) && validReference(event.SocialAccountID, 200, false) &&
		validReference(event.SubjectReference, 500, false) && validReference(event.ParentReference, 500, false) &&
		validReference(event.ContentProfile, 64, false) && validReference(event.ContentText, 10000, false) &&
		validReference(event.MetricsJSON, 2000, true)
}

func claimsEmpty(claims credentialClaims) bool { return claims.ID == "" }

func isTransientSQLiteContention(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") || strings.Contains(message, "database table is locked")
}

type Processor interface {
	Process(context.Context, models.BotIngressEvent) error
}

type ProcessorFunc func(context.Context, models.BotIngressEvent) error

func (processor ProcessorFunc) Process(ctx context.Context, event models.BotIngressEvent) error {
	return processor(ctx, event)
}

type processorRegistry struct {
	mu    sync.RWMutex
	items map[string]Processor
}

func (s *Service) RegisterProcessor(provider string, processor Processor) error {
	provider = normalizeProvider(provider)
	if !validProvider(provider) || processor == nil {
		return ErrInvalidEvent
	}
	s.processors.mu.Lock()
	defer s.processors.mu.Unlock()
	s.processors.items[provider] = processor
	return nil
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	if s.db == nil || jobType != jobregistry.TypeBotIngress {
		return ErrIngressUnavailable
	}
	decoded, err := jobregistry.DecodeBotIngressPayload(payload)
	if err != nil {
		return ErrProcessingFailed
	}
	var event models.BotIngressEvent
	if err := s.db.NewSelect().Model(&event).Where("id = ?", decoded.EventID).Scan(ctx); err != nil {
		return ErrProcessingFailed
	}
	if !event.ProcessedAt.IsZero() {
		return nil
	}

	s.processors.mu.RLock()
	processor := s.processors.items[event.Provider]
	s.processors.mu.RUnlock()
	if processor == nil {
		return s.recordProcessingFailure(ctx, event.ID, ErrProcessorMissing)
	}
	if err := processor.Process(ctx, event); err != nil {
		return s.recordProcessingFailure(ctx, event.ID, safeProcessorError(err))
	}
	now := s.now().UTC()
	if _, err := s.db.NewUpdate().Model((*models.BotIngressEvent)(nil)).
		Set("processed_at = ?", now).Set("safe_error_code = ''").
		Where("id = ? AND processed_at IS NULL", event.ID).Exec(ctx); err != nil {
		return ErrProcessingFailed
	}
	return nil
}

type safeCodedError interface {
	SafeCode() string
}

func safeProcessorError(err error) *SafeError {
	var coded safeCodedError
	if errors.As(err, &coded) {
		code := strings.TrimSpace(coded.SafeCode())
		if validSafeCode(code) && code != "" {
			return &SafeError{code: ErrorCode(code), httpStatus: http.StatusInternalServerError}
		}
	}
	return ErrProcessingFailed
}

func (s *Service) recordProcessingFailure(ctx context.Context, eventID string, safe *SafeError) error {
	if _, err := s.db.NewUpdate().Model((*models.BotIngressEvent)(nil)).
		Set("safe_error_code = ?", safe.Code()).Where("id = ?", eventID).Exec(ctx); err != nil {
		return ErrProcessingFailed
	}
	return safe
}
