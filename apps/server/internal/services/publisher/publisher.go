package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/provideruserresolutions"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

type Service struct {
	db                           *bun.DB
	tm                           *tokenmanager.TokenManager
	providerMu                   sync.RWMutex
	providers                    map[string]platform.Publisher
	connectorRegistry            *connectors.Registry
	connectorStore               *connectors.Store
	disableLinkedInThreadReplies bool
	publicMediaURL               string
	mediaSigner                  *mediasigner.Signer
	storage                      mediastore.BlobStorage
	mediaStateEncryptor          *servicecrypto.TokenEncryptor
	usage                        *usage.Service
	quota                        entitlements.Service
	notifications                *notifications.Service
	reposts                      RepostScheduler
	readiness                    *providerreadiness.Service
	telemetry                    telemetry.Recorder
	userResolutions              *provideruserresolutions.Service
}

type RepostScheduler interface {
	ScheduleForRendition(ctx context.Context, renditionID string) error
}

func NewService(db *bun.DB, tm *tokenmanager.TokenManager) *Service {
	return &Service{
		db:              db,
		tm:              tm,
		providers:       make(map[string]platform.Publisher),
		usage:           usage.NewService(db),
		quota:           entitlements.NewSelfHostedService(),
		userResolutions: provideruserresolutions.NewService(db),
	}
}

func (s *Service) SetDisableLinkedInThreadReplies(disable bool) {
	s.disableLinkedInThreadReplies = disable
}

func (s *Service) SetPublicMediaURL(url string) {
	s.publicMediaURL = url
}

func (s *Service) SetMediaSigner(signer *mediasigner.Signer) {
	s.mediaSigner = signer
}

func (s *Service) SetStorage(storage mediastore.BlobStorage) {
	s.storage = storage
}

func (s *Service) SetMediaStateEncryptor(encryptor *servicecrypto.TokenEncryptor) {
	s.mediaStateEncryptor = encryptor
}

func (s *Service) SetUsage(usageService *usage.Service) {
	if usageService != nil {
		s.usage = usageService
	}
}

func (s *Service) SetEntitlement(entitlement entitlements.Service) {
	if entitlement != nil {
		s.quota = entitlement
	}
}

func (s *Service) SetNotificationService(service *notifications.Service) {
	s.notifications = service
}

func (s *Service) SetRepostScheduler(service RepostScheduler) {
	s.reposts = service
}

func (s *Service) SetProviderReadiness(service *providerreadiness.Service) {
	s.readiness = service
}

func (s *Service) SetTelemetry(recorder telemetry.Recorder) {
	s.telemetry = recorder
}

func (s *Service) SetProvider(platformName string, publisher platform.Publisher) {
	s.providerMu.Lock()
	defer s.providerMu.Unlock()
	s.providers[platformName] = publisher
}

func (s *Service) SetConnectorRegistry(registry *connectors.Registry, store *connectors.Store) {
	s.connectorRegistry = registry
	s.connectorStore = store
}

// publishJobTargets are the destinations a publish job owns.
type publishJobTargets struct {
	PublicationID        string `json:"publication_id"`
	RenditionID          string `json:"rendition_id"`
	Action               string `json:"action"`
	AuthorizationBatchID string `json:"authorization_batch_id"`
}

// updateRetryableFailures applies a change to the retryable failed outputs a
// publish job owns. Reply jobs never own their rendition's delivery state.
func updateRetryableFailures(ctx context.Context, db bun.IDB, jobType, jobPayload string, change func(*bun.UpdateQuery) *bun.UpdateQuery) error {
	if jobType != jobregistry.TypePublishPublication {
		return nil
	}
	var targets publishJobTargets
	if err := json.Unmarshal([]byte(jobPayload), &targets); err != nil {
		return err
	}
	if targets.PublicationID == "" || targets.Action == "reply" {
		return nil
	}
	renditions := db.NewSelect().Model((*models.Rendition)(nil)).Column("id").Where("publication_id = ?", targets.PublicationID)
	switch {
	case targets.RenditionID != "":
		renditions = renditions.Where("id = ?", targets.RenditionID)
	case strings.TrimSpace(targets.AuthorizationBatchID) != "":
		authorized := db.NewSelect().
			Model((*models.PublicationAuthorization)(nil)).
			Column("rendition_id").
			Where("batch_id = ? AND publication_id = ?", strings.TrimSpace(targets.AuthorizationBatchID), targets.PublicationID)
		renditions = renditions.Where("id IN (?)", authorized)
	}
	for _, model := range []any{(*models.Rendition)(nil), (*models.RenditionSegment)(nil)} {
		query := change(db.NewUpdate().Model(model)).
			Where("status = ? AND error_retryable = ?", models.RenditionStatusFailed, true)
		if _, isRendition := model.(*models.Rendition); isRendition {
			query = query.Where("id IN (?)", renditions)
		} else {
			query = query.Where("rendition_id IN (?)", renditions)
		}
		if _, err := query.Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

// UpdateJobRetryAt keeps user-visible destination retry metadata aligned with
// the worker's final bounded and jittered run time.
func (s *Service) UpdateJobRetryAt(ctx context.Context, jobType, jobPayload string, retryAt time.Time) error {
	return updateRetryableFailures(ctx, s.db, jobType, jobPayload, func(query *bun.UpdateQuery) *bun.UpdateQuery {
		return query.Set("error_retry_at = ?", retryAt.UTC())
	})
}

// MarkTerminalPublishFailure stops advertising an automatic retry once the
// worker has exhausted a publish job's attempts.
func (s *Service) MarkTerminalPublishFailure(ctx context.Context, db bun.IDB, jobType, jobPayload string) error {
	return updateRetryableFailures(ctx, db, jobType, jobPayload, func(query *bun.UpdateQuery) *bun.UpdateQuery {
		return query.Set("error_retryable = ?", false).Set("error_retry_at = NULL")
	})
}

func (s *Service) HandlePublishPublicationJob(ctx context.Context, jobPayload string) error {
	var payload struct {
		PublicationID            string                   `json:"publication_id"`
		RenditionID              string                   `json:"rendition_id"`
		Action                   string                   `json:"action"`
		Body                     string                   `json:"body"`
		ParentID                 string                   `json:"parent_id"`
		Settings                 map[string]interface{}   `json:"settings"`
		Media                    []map[string]interface{} `json:"media"`
		AuthorizationBatchID     string                   `json:"authorization_batch_id"`
		AuthorizationScheduledAt string                   `json:"authorization_scheduled_at"`
		ReadinessIntent          string                   `json:"readiness_intent"`
	}
	if err := json.Unmarshal([]byte(jobPayload), &payload); err != nil {
		return err
	}
	receipts, err := s.preflightPublicationAuthorization(ctx, publicationAuthorizationPreflight{
		BatchID: payload.AuthorizationBatchID, PublicationID: payload.PublicationID,
		RenditionID: payload.RenditionID, Action: payload.Action,
		ScheduledAt: payload.AuthorizationScheduledAt,
		Content:     payload.Body, Media: payload.Media,
		Settings: map[string]any{"parent_id": payload.ParentID, "settings": payload.Settings},
		Explicit: payload.Action == "reply", ReadinessIntent: payload.ReadinessIntent,
	})
	if err != nil {
		if failure := ClassifyFailure(err); !failure.Retryable {
			if stateErr := s.persistTerminalPreflightFailure(ctx, payload.PublicationID, payload.RenditionID, failure); stateErr != nil {
				log.Printf("[Publisher] Failed to persist terminal preflight failure: %v", stateErr)
			}
		}
		return err
	}
	readinessIntent := publisherReadinessIntent(receipts[0].ExecutionIntent)
	if payload.Action == "reply" {
		return s.publishRenditionReply(ctx, payload.RenditionID, payload.Body, payload.ParentID, payload.Settings, &receipts[0], readinessIntent)
	}
	if payload.PublicationID == "" {
		return fmt.Errorf("publication_id is required")
	}

	log.Printf("[Publisher] Processing publication %s", payload.PublicationID)
	publication := new(models.Publication)
	if err := s.db.NewSelect().Model(publication).Where("id = ?", payload.PublicationID).Scan(ctx); err != nil {
		return err
	}
	if err := s.markPublicationPublishing(ctx, publication); err != nil {
		return err
	}

	renditions, receiptByRendition, err := s.loadAuthorizedRenditions(ctx, publication.ID, payload.RenditionID, receipts)
	if err != nil {
		return err
	}

	// Every destination runs and the publication is always finalized; failures
	// are collected so one destination cannot strand another.
	var outcome publishOutcome
	for i := range renditions {
		rendition := &renditions[i]
		wasRetry := rendition.Status == models.RenditionStatusFailed
		if wasRetry {
			s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventRetried, lifecycle.StatusStarted, "retrying failed rendition", map[string]any{
				"platform": rendition.Platform,
			})
		}
		err := s.markDeliveryPublishing(ctx, (*models.Rendition)(nil), rendition.ID)
		if err == nil {
			err = s.publishRendition(ctx, publication, rendition, receiptByRendition[rendition.ID], readinessIntent)
		}
		if err != nil {
			s.recordRenditionFailure(ctx, publication, rendition, wasRetry, err, &outcome)
		}
	}
	if err := s.finalizePublication(ctx, publication); err != nil {
		return outcome.finalizationErr(err)
	}
	return outcome.err()
}

// loadAuthorizedRenditions returns the publication's deliverable renditions
// that this job's receipts authorize, in authored order.
func (s *Service) loadAuthorizedRenditions(ctx context.Context, publicationID, renditionID string, receipts []models.PublicationAuthorization) ([]models.Rendition, map[string]*models.PublicationAuthorization, error) {
	receiptByRendition := make(map[string]*models.PublicationAuthorization, len(receipts))
	allowedRenditionIDs := make([]string, 0, len(receipts))
	for index := range receipts {
		receiptByRendition[receipts[index].RenditionID] = &receipts[index]
		allowedRenditionIDs = append(allowedRenditionIDs, receipts[index].RenditionID)
	}
	var renditions []models.Rendition
	query := s.db.NewSelect().Model(&renditions).
		Where("publication_id = ?", publicationID).
		Where("status IN (?)", bun.List([]string{
			models.RenditionStatusDraft,
			models.RenditionStatusReady,
			models.RenditionStatusScheduled,
			models.RenditionStatusPublishing,
			models.RenditionStatusFailed,
		})).
		Where("(status != ? OR error_retryable = ?)", models.RenditionStatusFailed, true).
		Where("id IN (?)", bun.List(allowedRenditionIDs)).
		Order("position ASC", "id ASC")
	if renditionID != "" {
		query = query.Where("id = ?", renditionID)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, nil, err
	}
	return renditions, receiptByRendition, nil
}

// publishOutcome collects the destination results of one publish job.
type publishOutcome struct {
	retry, pending               *RetryableError
	terminalWrite, panics, state error
}

// finalizationErr preserves a pending provider continuation even when
// finalization fails so the worker keeps polling instead of exhausting retries.
func (o *publishOutcome) finalizationErr(finalizeErr error) error {
	if o.pending != nil {
		return errors.Join(finalizeErr, o.pending, o.panics, o.state)
	}
	return errors.Join(finalizeErr, o.panics, o.state)
}

// err reports the job result. A pending provider receipt still needs
// reconciliation, so the job stays a continuation even when another
// destination asks for a longer retry delay.
func (o *publishOutcome) err() error {
	collected := errors.Join(o.panics, o.state)
	switch {
	case o.pending != nil:
		if o.retry != nil && o.retry.Failure.RetryAfter > o.pending.Failure.RetryAfter {
			o.pending.Failure.RetryAfter = o.retry.Failure.RetryAfter
		}
		return errors.Join(o.pending, collected)
	case o.retry != nil:
		return errors.Join(o.retry, collected)
	case o.terminalWrite != nil:
		return errors.Join(o.terminalWrite, collected)
	default:
		return collected
	}
}

func (s *Service) recordRenditionFailure(ctx context.Context, publication *models.Publication, rendition *models.Rendition, wasRetry bool, err error, outcome *publishOutcome) {
	if recovered := (*diagnostics.PanicError)(nil); errors.As(err, &recovered) {
		outcome.panics = errors.Join(outcome.panics, err)
	}
	if providerwrite.IsAmbiguous(err) {
		outcome.terminalWrite = err
	}
	failure := ClassifyFailure(err)
	if failure.Retryable && (outcome.retry == nil || failure.RetryAfter > outcome.retry.Failure.RetryAfter) {
		outcome.retry = &RetryableError{Failure: failure, Provider: rendition.Platform, RenditionID: rendition.ID}
	}
	if stateErr := s.persistRenditionOutcome(ctx, rendition.ID, failure); stateErr != nil {
		log.Printf("[Publisher] Failed to persist rendition %s outcome: %v", rendition.ID, stateErr)
		outcome.state = errors.Join(outcome.state, stateErr)
	}
	if _, pending := providerwrite.IsPending(err); pending {
		outcome.pending = &RetryableError{Failure: failure, Provider: rendition.Platform, RenditionID: rendition.ID}
		return
	}
	log.Printf("[Publisher] Rendition %s failed (%s, status=%d, code=%s)", rendition.ID, failure.Kind, failure.HTTPStatus, failure.Code)
	if diagnostic := platform.ProviderErrorDiagnostic(err); diagnostic != "" {
		log.Printf("[Publisher] Rendition %s provider diagnostics (%s)", rendition.ID, diagnostic)
	}
	properties := map[string]any{
		"error_kind":  failure.Kind,
		"error_code":  failure.Code,
		"http_status": failure.HTTPStatus,
		"retryable":   failure.Retryable,
		"retry":       wasRetry,
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventFailed, lifecycle.StatusFailed, "rendition publish failed", mergePublisherSettings(properties, map[string]any{"platform": rendition.Platform}))
	s.captureRenditionEvent(ctx, telemetry.EventRenditionFailed, publication, rendition, properties, "", time.Time{})
}

// persistTerminalPreflightFailure keeps an authorized queued publication from
// remaining visibly scheduled after a terminal failure before any provider
// call. The immutable receipt-to-job link scopes the affected destinations;
// unauthenticated or tampered payload IDs cannot fail another publication.
func (s *Service) persistTerminalPreflightFailure(
	ctx context.Context,
	publicationID,
	renditionID string,
	failure Failure,
) error {
	execution, ok := jobExecutionFromContext(ctx)
	publicationID = strings.TrimSpace(publicationID)
	renditionID = strings.TrimSpace(renditionID)
	if !ok || execution.ID == "" || publicationID == "" {
		return nil
	}

	var publication models.Publication
	if err := s.db.NewSelect().Model(&publication).
		Where("id = ? AND status = ?", publicationID, models.PublicationStatusScheduled).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}

	var receipts []models.PublicationAuthorization
	query := s.db.NewSelect().Model(&receipts).
		Where("job_id = ? AND publication_id = ?", execution.ID, publication.ID)
	if renditionID != "" {
		query = query.Where("rendition_id = ?", renditionID)
	}
	if err := query.Order("rendition_id ASC").Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}

	failed := make([]string, 0, len(receipts))
	if err := s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		for _, receipt := range receipts {
			result, err := setDeliveryFailure(tx.NewUpdate().Model((*models.Rendition)(nil)), failure, time.Now().UTC()).
				Where("id = ? AND publication_id = ? AND status = ?", receipt.RenditionID, publication.ID, models.RenditionStatusScheduled).
				Exec(ctx)
			if err != nil {
				return err
			}
			if affected, _ := result.RowsAffected(); affected > 0 {
				failed = append(failed, receipt.RenditionID)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	if len(failed) == 0 {
		return nil
	}
	for _, failedRenditionID := range failed {
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, failedRenditionID,
			lifecycle.EventFailed, lifecycle.StatusFailed, "publication authorization preflight failed",
			map[string]any{"error_kind": failure.Kind, "error_code": failure.Code, "retryable": false},
		)
	}
	return s.finalizePublication(ctx, &publication)
}

func (s *Service) captureRenditionEvent(
	ctx context.Context,
	eventName string,
	publication *models.Publication,
	rendition *models.Rendition,
	properties map[string]any,
	eventUUID string,
	timestamp time.Time,
) {
	if s.telemetry == nil || publication == nil || rendition == nil {
		return
	}
	if properties == nil {
		properties = map[string]any{}
	}
	properties["publication_id"] = publication.ID
	properties["rendition_id"] = rendition.ID
	properties["platform"] = rendition.Platform
	properties["profile"] = rendition.Profile
	properties["output_profile"] = rendition.OutputProfile
	properties["intent"] = publication.Intent
	properties["content_profile"] = publication.ContentProfile
	if err := s.telemetry.Capture(ctx, telemetry.Event{
		Name:        eventName,
		DistinctID:  publication.CreatedByID,
		WorkspaceID: publication.WorkspaceID,
		UUID:        eventUUID,
		Timestamp:   timestamp,
		Properties:  properties,
	}); err != nil {
		log.Printf("[Publisher] failed to enqueue rendition telemetry: %v", err)
	}
}

func (s *Service) scheduleReposts(ctx context.Context, renditionID string) {
	if s.reposts == nil {
		return
	}
	if err := s.reposts.ScheduleForRendition(ctx, renditionID); err != nil {
		log.Printf("[Publisher] failed to schedule repost automation for rendition %s: %v", renditionID, err)
	}
}

func (s *Service) recordPublishedPost(ctx context.Context, workspaceID, operationID string) {
	if s.quota != nil {
		if _, stored := s.quota.(*entitlements.SubscriptionService); stored {
			// A plan can change while the provider is processing the original write.
			exists, err := s.db.NewSelect().Model((*models.MonthlyUsageReservation)(nil)).Where("operation_key = ? AND workspace_id = ? AND state <> ?", operationID, workspaceID, "released").Exists(ctx)
			if err != nil {
				log.Printf("[Publisher] Failed to resolve published usage receipt: %v", err)
				return
			}
			if exists {
				return
			}
		} else {
			policy, err := s.providerUsagePolicy(ctx, s.db, workspaceID, entitlements.LimitPublishedPostsMonthly)
			if err != nil {
				log.Printf("[Publisher] Failed to resolve published usage policy: %v", err)
				return
			}
			if !policy.Unlimited {
				return
			}
		}
	}
	s.recordUsage(ctx, workspaceID, entitlements.LimitPublishedPostsMonthly)
}

func (s *Service) recordUsage(ctx context.Context, workspaceID string, metric entitlements.LimitKey) {
	if s.usage == nil || workspaceID == "" {
		return
	}
	if _, err := s.usage.IncrementMonthly(ctx, workspaceID, metric, 1, time.Now().UTC()); err != nil {
		log.Printf("[Publisher] Failed to record usage metric %s for workspace %s: %v", metric, workspaceID, err)
	}
}

func (s *Service) recordPublicationLifecycleEvent(ctx context.Context, workspaceID, publicationID, renditionID, eventType, status, message string, metadata map[string]any) {
	if s == nil || s.db == nil {
		return
	}
	_, err := lifecycle.NewService(s.db).Record(ctx, lifecycle.EventInput{
		WorkspaceID:   workspaceID,
		PublicationID: publicationID,
		RenditionID:   renditionID,
		Type:          eventType,
		Status:        status,
		Message:       message,
		Metadata:      metadata,
	})
	if err != nil {
		log.Printf("[Publisher] Failed to record lifecycle event %s for publication %s rendition %s: %v", eventType, publicationID, renditionID, err)
	}
}

func mergePublisherSettings(base, overrides map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(base)+len(overrides))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range overrides {
		out[key] = value
	}
	return out
}

func publisherExternalURL(externalID string) string {
	if strings.HasPrefix(externalID, "http://") || strings.HasPrefix(externalID, "https://") {
		return externalID
	}
	return ""
}

func mustPublisherJSON(value interface{}) string {
	if value == nil {
		return "{}"
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// settingStringPublisher stays strict on purpose (issue #414): it reads
// media IDs and the content-posting-method mode, where coercing a stored
// number via fmt.Sprint would manufacture a database lookup or mode match
// instead of skipping the setting. Only string and fmt.Stringer values are
// accepted; use settingx.String for general adapter settings that follow
// the tolerant coercion rule.
func settingStringPublisher(settings map[string]interface{}, key string) string {
	if settings == nil {
		return ""
	}
	switch value := settings[key].(type) {
	case string:
		return strings.TrimSpace(value)
	case fmt.Stringer:
		return strings.TrimSpace(value.String())
	default:
		return ""
	}
}

func firstContentLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
