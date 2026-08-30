package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const (
	providerMediaStatusReady  = "ready"
	providerMediaStatusFailed = "failed"
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
}

type RepostScheduler interface {
	ScheduleForRendition(ctx context.Context, renditionID string) error
}

func NewService(db *bun.DB, tm *tokenmanager.TokenManager) *Service {
	return &Service{
		db:        db,
		tm:        tm,
		providers: make(map[string]platform.Publisher),
		usage:     usage.NewService(db),
		quota:     entitlements.NewSelfHostedService(),
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

// UpdateJobRetryAt keeps user-visible destination retry metadata aligned with
// the worker's final bounded and jittered run time.
func (s *Service) UpdateJobRetryAt(ctx context.Context, jobType, jobPayload string, retryAt time.Time) error {
	retryAt = retryAt.UTC()
	if jobType != jobregistry.TypePublishPublication {
		return nil
	}
	var payload struct {
		PublicationID string `json:"publication_id"`
		RenditionID   string `json:"rendition_id"`
	}
	if err := json.Unmarshal([]byte(jobPayload), &payload); err != nil {
		return err
	}
	if payload.PublicationID == "" {
		return nil
	}
	renditions := s.db.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("error_retry_at = ?", retryAt).
		Where("publication_id = ? AND status = ? AND error_retryable = ?", payload.PublicationID, models.RenditionStatusFailed, true)
	if payload.RenditionID != "" {
		renditions = renditions.Where("id = ?", payload.RenditionID)
	}
	if _, err := renditions.Exec(ctx); err != nil {
		return err
	}
	if _, err := s.db.NewUpdate().
		Model((*models.RenditionSegment)(nil)).
		Set("error_retry_at = ?", retryAt).
		Where("rendition_id IN (SELECT id FROM renditions WHERE publication_id = ?)", payload.PublicationID).
		Where("status = ? AND error_retryable = ?", "failed", true).
		Exec(ctx); err != nil {
		return err
	}
	return nil
}

//nolint:gocyclo // One handler preserves publication, rendition, media, lifecycle, and retry state across every job action.
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
			if stateErr := s.persistTerminalPreflightFailure(
				ctx,
				payload.PublicationID,
				payload.RenditionID,
				failure,
			); stateErr != nil {
				log.Printf("[Publisher] Failed to persist terminal preflight failure: %v", stateErr)
			}
		}
		return err
	}
	if payload.Action == "reply" {
		return s.publishRenditionReply(ctx, payload.RenditionID, payload.Body, payload.ParentID, payload.Settings, &receipts[0])
	}
	if payload.PublicationID == "" {
		return fmt.Errorf("publication_id is required")
	}

	log.Printf("[Publisher] Processing publication %s", payload.PublicationID)
	publication := new(models.Publication)
	if err := s.db.NewSelect().Model(publication).Where("id = ?", payload.PublicationID).Scan(ctx); err != nil {
		return err
	}
	if _, err := s.db.NewUpdate().Model(publication).
		Set("status = ?", models.PublicationStatusPublishing).
		Set("actual_run_at = ?", time.Now().UTC()).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", publication.ID).
		Exec(ctx); err != nil {
		log.Printf("[Publisher] Failed to mark publication %s as publishing: %v", publication.ID, err)
	}

	var renditions []models.Rendition
	query := s.db.NewSelect().Model(&renditions).
		Where("publication_id = ?", publication.ID).
		Where("status IN (?)", bun.List([]string{
			models.RenditionStatusDraft,
			models.RenditionStatusReady,
			models.RenditionStatusScheduled,
			models.RenditionStatusFailed,
		})).
		Where("(status != ? OR error_retryable = ?)", models.RenditionStatusFailed, true).
		Order("created_at ASC")
	if payload.RenditionID != "" {
		query = query.Where("id = ?", payload.RenditionID)
	}
	allowedRenditionIDs := make([]string, 0, len(receipts))
	for _, receipt := range receipts {
		allowedRenditionIDs = append(allowedRenditionIDs, receipt.RenditionID)
	}
	query = query.Where("id IN (?)", bun.List(allowedRenditionIDs))
	if err := query.Scan(ctx); err != nil {
		return err
	}

	receiptByRendition := make(map[string]*models.PublicationAuthorization, len(receipts))
	for index := range receipts {
		receiptByRendition[receipts[index].RenditionID] = &receipts[index]
	}
	var retryFailure *RetryableError
	var terminalWriteFailure error
	readinessIntent := publisherReadinessIntent(receipts[0].ExecutionIntent)
	for i := range renditions {
		rendition := renditions[i]
		wasRetry := rendition.Status == models.RenditionStatusFailed
		if wasRetry {
			s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventRetried, lifecycle.StatusStarted, "retrying failed rendition", map[string]any{
				"platform": rendition.Platform,
			})
		}
		if _, err := s.db.NewUpdate().Model(&rendition).
			Set("status = ?", models.RenditionStatusPublishing).
			Set("error_message = ''").
			Set("error_kind = ''").
			Set("error_code = ''").
			Set("error_http_status = 0").
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("error_action = ''").
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ?", rendition.ID).
			Exec(ctx); err != nil {
			log.Printf("[Publisher] Failed to mark rendition %s as publishing: %v", rendition.ID, err)
		}
		if err := s.publishRendition(ctx, publication, &rendition, receiptByRendition[rendition.ID], readinessIntent); err != nil {
			if providerwrite.IsAmbiguous(err) {
				terminalWriteFailure = err
			}
			failure := ClassifyFailure(err)
			if failure.Retryable &&
				(retryFailure == nil || failure.RetryAfter > retryFailure.Failure.RetryAfter) {
				retryFailure = &RetryableError{Failure: failure}
			}
			log.Printf(
				"[Publisher] Rendition %s failed (%s, status=%d, code=%s)",
				rendition.ID,
				failure.Kind,
				failure.HTTPStatus,
				failure.Code,
			)
			if dbErr := s.persistRenditionFailure(ctx, rendition.ID, failure); dbErr != nil {
				log.Printf("[Publisher] Failed to mark rendition %s failed: %v", rendition.ID, dbErr)
			}
			s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventFailed, lifecycle.StatusFailed, "rendition publish failed", map[string]any{
				"platform":    rendition.Platform,
				"error_kind":  failure.Kind,
				"error_code":  failure.Code,
				"http_status": failure.HTTPStatus,
				"retryable":   failure.Retryable,
				"retry":       wasRetry,
			})
			s.captureRenditionEvent(ctx, telemetry.EventRenditionFailed, publication, &rendition, map[string]any{
				"error_kind":  failure.Kind,
				"error_code":  failure.Code,
				"http_status": failure.HTTPStatus,
				"retryable":   failure.Retryable,
				"retry":       wasRetry,
			}, "", time.Time{})
			continue
		}
	}

	s.finalizePublication(ctx, publication)
	if retryFailure != nil {
		return retryFailure
	}
	if terminalWriteFailure != nil {
		return terminalWriteFailure
	}
	return nil
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

	failed := make([]models.PublicationAuthorization, 0, len(receipts))
	for _, receipt := range receipts {
		result, err := s.db.NewUpdate().Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusFailed).
			Set("error_message = ?", failure.Message).
			Set("error_kind = ?", failure.Kind).
			Set("error_code = ?", failure.Code).
			Set("error_http_status = ?", failure.HTTPStatus).
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("error_action = ?", failure.Action).
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ? AND publication_id = ? AND status = ?", receipt.RenditionID, publication.ID, models.RenditionStatusScheduled).
			Exec(ctx)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected > 0 {
			failed = append(failed, receipt)
		}
	}
	if len(failed) == 0 {
		return nil
	}

	for _, receipt := range failed {
		s.recordPublicationLifecycleEvent(
			ctx,
			publication.WorkspaceID,
			publication.ID,
			receipt.RenditionID,
			lifecycle.EventFailed,
			lifecycle.StatusFailed,
			"publication authorization preflight failed",
			map[string]any{
				"error_kind": failure.Kind,
				"error_code": failure.Code,
				"retryable":  false,
			},
		)
	}
	s.finalizePublication(ctx, &publication)
	return nil
}

func (s *Service) persistRenditionFailure(
	ctx context.Context,
	renditionID string,
	failure Failure,
) error {
	var retryAt any
	if failure.Retryable {
		delay := failure.RetryAfter
		if delay <= 0 {
			delay = RetryDelay(1, 0, 0)
		}
		retryAt = time.Now().UTC().Add(delay)
	}
	query := s.db.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusFailed).
		Set("error_message = ?", failure.Message).
		Set("error_kind = ?", failure.Kind).
		Set("error_code = ?", failure.Code).
		Set("error_http_status = ?", failure.HTTPStatus).
		Set("error_retryable = ?", failure.Retryable).
		Set("error_action = ?", failure.Action).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", renditionID)
	if retryAt == nil {
		query = query.Set("error_retry_at = NULL")
	} else {
		query = query.Set("error_retry_at = ?", retryAt)
	}
	_, err := query.Exec(ctx)
	return err
}

//nolint:gocyclo
func (s *Service) publishRendition(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	readinessIntent providerreadiness.ExecutionIntent,
) error {
	var segments []models.RenditionSegment
	if err := s.db.NewSelect().
		Model(&segments).
		Where("rendition_id = ?", rendition.ID).
		Order("position ASC").
		Scan(ctx); err == nil && len(segments) > 0 {
		return s.publishRenditionSegments(ctx, publication, rendition, segments, authorization, readinessIntent)
	} else if err != nil && !isMissingNormalizedSegmentTable(err) {
		return fmt.Errorf("loading rendition segments: %w", err)
	}

	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", rendition.SocialAccountID).Scan(ctx); err != nil {
		return fmt.Errorf("account not found: %v", err)
	}
	if err := s.requireRenditionReadiness(ctx, account, rendition, authorization, readinessIntent); err != nil {
		return err
	}
	provider, providerKey, connectorBacked, err := s.providerForAccount(ctx, publication.WorkspaceID, account)
	if err != nil {
		return err
	}
	if err := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitPublishedPostsMonthly); err != nil {
		return err
	}
	token := ""
	if !connectorBacked {
		token, err = s.tm.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return fmt.Errorf("auth error: %v", err)
		}
	}
	mediaAttachments, mediaAltTexts, mediaSettings, err := s.loadRenditionMedia(ctx, rendition.ID)
	if err != nil {
		return err
	}

	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)
	if err := s.hydratePublicSettingMediaURLs(ctx, publication.WorkspaceID, account.Platform, settings); err != nil {
		return err
	}
	platformMediaIDs := make([]string, 0, len(mediaAttachments))
	mediaItems := make([]platform.MediaItem, 0, len(mediaAttachments))
	_, publishesMediaDirectly := provider.(platform.DirectMediaPublisher)
	for _, media := range mediaAttachments {
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventUploadStarted, lifecycle.StatusStarted, "media upload started", map[string]any{
			"platform": rendition.Platform,
			"media_id": media.ID,
		})
		if !publishesMediaDirectly {
			mediaID, err := s.platformMediaIDForRendition(ctx, publication, rendition, account, provider, token, media)
			if err != nil {
				return fmt.Errorf("media upload failed for %s: %w", media.ID, err)
			}
			platformMediaIDs = append(platformMediaIDs, mediaID)
		}
		mediaItems = append(mediaItems, platform.MediaItem{
			ID:               media.ID,
			MimeType:         media.MimeType,
			Size:             media.Size,
			OriginalFilename: media.OriginalFilename,
		})
	}

	req := &platform.PublishRequest{
		Content:          rendition.Body,
		Profile:          rendition.Profile,
		OutputProfile:    rendition.OutputProfile,
		Title:            firstNonEmptyPublisherString(rendition.Title, publication.Title),
		Description:      rendition.Description,
		SettingsJSON:     rendition.SettingsJSON,
		Settings:         settings,
		PlatformMediaIDs: platformMediaIDs,
		MediaAltTexts:    mediaAltTexts,
		MediaSettings:    mediaSettings,
		Media:            mediaItems,
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, "provider publish started", map[string]any{
		"platform":     rendition.Platform,
		"provider_key": providerKey,
	})
	writeScope := publicationWriteScope(authorization, rendition.ID, "publish", readinessIntent)
	publishResult, err := s.publishProviderWithUsage(
		ctx,
		publication.WorkspaceID,
		account.Platform,
		rendition.ID,
		"publish",
		writeScope,
		provider,
		token,
		account.AccountID,
		req,
		mediaAttachments,
	)
	if err != nil && isExpiredTokenError(err) {
		refreshedToken, refreshErr := s.tm.ForceRefreshAccessToken(ctx, account.ID)
		if refreshErr != nil {
			return fmt.Errorf("%s token refresh failed after expiry: %w", providerKey, refreshErr)
		}
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventUploadResumed, lifecycle.StatusStarted, "provider publish retried after token refresh", map[string]any{
			"platform":     rendition.Platform,
			"provider_key": providerKey,
		})
		publishResult, err = s.publishProviderWithUsage(
			ctx,
			publication.WorkspaceID,
			account.Platform,
			rendition.ID,
			"publish-token-refresh",
			writeScope,
			provider,
			refreshedToken,
			account.AccountID,
			req,
			mediaAttachments,
		)
	}
	if err != nil {
		return err
	}
	externalID := publishResult.ExternalID
	externalURL := publishResult.ExternalURL
	if externalURL == "" {
		externalURL = publisherExternalURL(externalID)
	}
	publishedAt := time.Now().UTC()
	if _, err := s.db.NewUpdate().Model(rendition).
		Set("status = ?", models.RenditionStatusPublished).
		Set("external_id = ?", externalID).
		Set("external_url = ?", externalURL).
		Set("error_message = ''").
		Set("error_kind = ''").
		Set("error_code = ''").
		Set("error_http_status = 0").
		Set("error_retryable = ?", false).
		Set("error_retry_at = NULL").
		Set("error_action = ''").
		Set("updated_at = ?", publishedAt).
		Where("id = ?", rendition.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("updating rendition status: %w", err)
	}
	s.recordPublishedPost(ctx, publication.WorkspaceID)
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventPublished, lifecycle.StatusSucceeded, "rendition published", map[string]any{
		"platform":     rendition.Platform,
		"external_id":  externalID,
		"external_url": externalURL,
	})
	s.captureRenditionEvent(ctx, telemetry.EventRenditionPublished, publication, rendition, nil, rendition.ID, publishedAt)
	s.scheduleReposts(ctx, rendition.ID)
	return nil
}

//nolint:gocyclo
func (s *Service) publishRenditionSegments(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	segments []models.RenditionSegment,
	authorization *models.PublicationAuthorization,
	readinessIntent providerreadiness.ExecutionIntent,
) error {
	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", rendition.SocialAccountID).Scan(ctx); err != nil {
		return fmt.Errorf("account not found: %v", err)
	}
	if err := s.requireRenditionReadiness(ctx, account, rendition, authorization, readinessIntent); err != nil {
		return err
	}
	provider, providerKey, connectorBacked, err := s.providerForAccount(ctx, publication.WorkspaceID, account)
	if err != nil {
		return err
	}
	token := ""
	if !connectorBacked {
		token, err = s.tm.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return fmt.Errorf("auth error: %v", err)
		}
	}
	destinationSettings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)

	parentExternalID := ""
	rootExternalID := ""
	rootExternalURL := ""
	for index := range segments {
		segment := &segments[index]
		if segment.Status == models.RenditionStatusPublished {
			if segment.ExternalID == "" {
				return fmt.Errorf("published rendition segment %s is missing its external id", segment.ID)
			}
			if rootExternalID == "" {
				rootExternalID = segment.ExternalID
				rootExternalURL = segment.ExternalURL
			}
			parentExternalID = segment.ExternalID
			continue
		}
		if err := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitPublishedPostsMonthly); err != nil {
			return s.failRenditionSegment(ctx, segment, err)
		}

		segmentSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &segmentSettings)
		settings := mergePublisherSettings(destinationSettings, segmentSettings)
		if err := s.hydratePublicSettingMediaURLs(ctx, publication.WorkspaceID, account.Platform, settings); err != nil {
			return s.failRenditionSegment(ctx, segment, err)
		}
		mediaAttachments, mediaAltTexts, mediaSettings, err := s.loadRenditionSegmentMedia(ctx, segment.ID)
		if err != nil {
			return s.failRenditionSegment(ctx, segment, err)
		}
		platformMediaIDs := make([]string, 0, len(mediaAttachments))
		mediaItems := make([]platform.MediaItem, 0, len(mediaAttachments))
		_, publishesMediaDirectly := provider.(platform.DirectMediaPublisher)
		uploadRendition := *rendition
		uploadRendition.SettingsJSON = mustPublisherJSON(settings)
		for _, media := range mediaAttachments {
			s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventUploadStarted, lifecycle.StatusStarted, "segment media upload started", map[string]any{
				"platform":   rendition.Platform,
				"segment_id": segment.ID,
				"media_id":   media.ID,
			})
			if !publishesMediaDirectly {
				mediaID, uploadErr := s.platformMediaIDForRendition(ctx, publication, &uploadRendition, account, provider, token, media)
				if uploadErr != nil {
					return s.failRenditionSegment(ctx, segment, fmt.Errorf("media upload failed for %s: %w", media.ID, uploadErr))
				}
				platformMediaIDs = append(platformMediaIDs, mediaID)
			}
			mediaItems = append(mediaItems, platform.MediaItem{
				ID:               media.ID,
				MimeType:         media.MimeType,
				Size:             media.Size,
				OriginalFilename: media.OriginalFilename,
			})
		}

		if _, err := s.db.NewUpdate().Model(segment).
			Set("status = ?", models.RenditionStatusPublishing).
			Set("error_message = ''").
			Set("error_kind = ''").
			Set("error_code = ''").
			Set("error_http_status = 0").
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("error_action = ''").
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ?", segment.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("marking rendition segment publishing: %w", err)
		}

		req := &platform.PublishRequest{
			Content:          segment.Body,
			Profile:          rendition.Profile,
			OutputProfile:    rendition.OutputProfile,
			Title:            firstNonEmptyPublisherString(segment.Title, rendition.Title, publication.Title),
			Description:      firstNonEmptyPublisherString(segment.Description, rendition.Description),
			SettingsJSON:     mustPublisherJSON(settings),
			Settings:         settings,
			PlatformMediaIDs: platformMediaIDs,
			MediaAltTexts:    mediaAltTexts,
			MediaSettings:    mediaSettings,
			Media:            mediaItems,
			ReplyToID:        parentExternalID,
		}
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, "rendition segment publish started", map[string]any{
			"platform":     rendition.Platform,
			"provider_key": providerKey,
			"segment_id":   segment.ID,
			"position":     segment.Position,
		})
		writeScope := publicationWriteScope(authorization, segment.ID, "publish", readinessIntent)
		publishResult, publishErr := s.publishProviderWithUsage(
			ctx,
			publication.WorkspaceID,
			account.Platform,
			segment.ID,
			"publish",
			writeScope,
			provider,
			token,
			account.AccountID,
			req,
			mediaAttachments,
		)
		if publishErr != nil && isExpiredTokenError(publishErr) {
			token, err = s.tm.ForceRefreshAccessToken(ctx, account.ID)
			if err != nil {
				return s.failRenditionSegment(ctx, segment, fmt.Errorf("%s token refresh failed after expiry: %w", providerKey, err))
			}
			publishResult, publishErr = s.publishProviderWithUsage(
				ctx,
				publication.WorkspaceID,
				account.Platform,
				segment.ID,
				"publish-token-refresh",
				writeScope,
				provider,
				token,
				account.AccountID,
				req,
				mediaAttachments,
			)
		}
		if publishErr != nil {
			return s.failRenditionSegment(ctx, segment, publishErr)
		}

		externalID := publishResult.ExternalID
		externalURL := firstNonEmptyPublisherString(publishResult.ExternalURL, publisherExternalURL(externalID))
		if _, err := s.db.NewUpdate().Model(segment).
			Set("status = ?", models.RenditionStatusPublished).
			Set("external_id = ?", externalID).
			Set("external_url = ?", externalURL).
			Set("error_message = ''").
			Set("error_kind = ''").
			Set("error_code = ''").
			Set("error_http_status = 0").
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("error_action = ''").
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ?", segment.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("persisting rendition segment result: %w", err)
		}
		if rootExternalID == "" {
			rootExternalID = externalID
			rootExternalURL = externalURL
		}
		parentExternalID = externalID
		s.recordPublishedPost(ctx, publication.WorkspaceID)
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventPublished, lifecycle.StatusSucceeded, "rendition segment published", map[string]any{
			"platform":     rendition.Platform,
			"segment_id":   segment.ID,
			"position":     segment.Position,
			"external_id":  externalID,
			"external_url": externalURL,
		})
	}

	publishedAt := time.Now().UTC()
	if _, err := s.db.NewUpdate().Model(rendition).
		Set("status = ?", models.RenditionStatusPublished).
		Set("external_id = ?", rootExternalID).
		Set("external_url = ?", rootExternalURL).
		Set("error_message = ''").
		Set("error_kind = ''").
		Set("error_code = ''").
		Set("error_http_status = 0").
		Set("error_retryable = ?", false).
		Set("error_retry_at = NULL").
		Set("error_action = ''").
		Set("updated_at = ?", publishedAt).
		Where("id = ?", rendition.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("updating segmented rendition status: %w", err)
	}
	s.captureRenditionEvent(ctx, telemetry.EventRenditionPublished, publication, rendition, map[string]any{
		"segment_count": len(segments),
	}, rendition.ID, publishedAt)
	s.scheduleReposts(ctx, rendition.ID)
	return nil
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

func (s *Service) failRenditionSegment(ctx context.Context, segment *models.RenditionSegment, failure error) error {
	if failure == nil {
		return nil
	}
	classified := ClassifyFailure(failure)
	var retryAt any
	if classified.Retryable {
		delay := classified.RetryAfter
		if delay <= 0 {
			delay = RetryDelay(1, 0, 0)
		}
		retryAt = time.Now().UTC().Add(delay)
	}
	query := s.db.NewUpdate().Model(segment).
		Set("status = ?", models.RenditionStatusFailed).
		Set("error_message = ?", classified.Message).
		Set("error_kind = ?", classified.Kind).
		Set("error_code = ?", classified.Code).
		Set("error_http_status = ?", classified.HTTPStatus).
		Set("error_retryable = ?", classified.Retryable).
		Set("error_action = ?", classified.Action).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", segment.ID)
	if retryAt == nil {
		query = query.Set("error_retry_at = NULL")
	} else {
		query = query.Set("error_retry_at = ?", retryAt)
	}
	if _, err := query.Exec(ctx); err != nil {
		log.Printf("[Publisher] Failed to mark rendition segment %s failed: %v", segment.ID, err)
	}
	return failure
}

func (s *Service) loadRenditionSegmentMedia(ctx context.Context, segmentID string) ([]models.MediaAttachment, []string, []map[string]interface{}, error) {
	var rows []struct {
		AltText              string `bun:"alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		SettingsJSON         string `bun:"settings_json"`
		models.MediaAttachment
	}
	if err := s.db.NewSelect().
		TableExpr("rendition_segment_media AS rsm").
		ColumnExpr("rsm.alt_text, rsm.thumbnail_timestamp_ms, rsm.settings_json").
		ColumnExpr("ma.*").
		Join("JOIN media_attachments AS ma ON ma.id = rsm.media_id").
		Where("rsm.rendition_segment_id = ?", segmentID).
		Order("rsm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		return nil, nil, nil, fmt.Errorf("fetching rendition segment media: %w", err)
	}
	media := make([]models.MediaAttachment, 0, len(rows))
	altTexts := make([]string, 0, len(rows))
	settings := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		media = append(media, row.MediaAttachment)
		altTexts = append(altTexts, firstNonEmptyPublisherString(row.AltText, row.MediaAttachment.AltText))
		itemSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(row.SettingsJSON), &itemSettings)
		if row.ThumbnailTimestampMS > 0 {
			itemSettings["thumbnail_timestamp_ms"] = row.ThumbnailTimestampMS
		}
		settings = append(settings, itemSettings)
	}
	return media, altTexts, settings, nil
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

func (s *Service) hydratePublicSettingMediaURLs(ctx context.Context, workspaceID, provider string, settings map[string]interface{}) error {
	if provider != "instagram" {
		return nil
	}
	for _, key := range []string{"cover_media_id"} {
		mediaID := settingStringPublisher(settings, key)
		if mediaID == "" || strings.HasPrefix(mediaID, "https://") {
			continue
		}
		var media models.MediaAttachment
		if err := s.db.NewSelect().
			Model(&media).
			Where("id = ? AND workspace_id = ?", mediaID, workspaceID).
			Scan(ctx); err != nil {
			return fmt.Errorf("loading %s media %s: %w", key, mediaID, err)
		}
		settings[key] = s.getPublicMediaURL(media)
	}
	return nil
}

func publisherExternalURL(externalID string) string {
	if strings.HasPrefix(externalID, "http://") || strings.HasPrefix(externalID, "https://") {
		return externalID
	}
	return ""
}

func isMissingNormalizedSegmentTable(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}

func (s *Service) publishRenditionReply(
	ctx context.Context,
	renditionID, body, parentID string,
	settings map[string]interface{},
	authorization *models.PublicationAuthorization,
) error {
	rendition := new(models.Rendition)
	if err := s.db.NewSelect().Model(rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return fmt.Errorf("rendition not found: %w", err)
	}
	publication := new(models.Publication)
	if err := s.db.NewSelect().Model(publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return fmt.Errorf("publication not found: %w", err)
	}
	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", rendition.SocialAccountID).Scan(ctx); err != nil {
		return fmt.Errorf("account not found: %w", err)
	}
	provider, _, connectorBacked, err := s.providerForAccount(ctx, publication.WorkspaceID, account)
	if err != nil {
		return err
	}
	token := ""
	if !connectorBacked {
		token, err = s.tm.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return fmt.Errorf("auth error: %w", err)
		}
	}
	req := &platform.PublishRequest{
		Content:      body,
		Profile:      rendition.Profile,
		Title:        rendition.Title,
		Description:  rendition.Description,
		Settings:     settings,
		SettingsJSON: mustPublisherJSON(settings),
		ReplyToID:    firstNonEmptyPublisherString(parentID, rendition.ExternalID),
	}
	if req.ReplyToID == "" {
		return fmt.Errorf("reply requires a parent external id")
	}
	_, err = s.publishProviderWithUsage(
		ctx,
		publication.WorkspaceID,
		account.Platform,
		rendition.ID,
		"reply",
		publicationWriteScope(authorization, rendition.ID, "reply"),
		provider,
		token,
		account.AccountID,
		req,
		nil,
	)
	return err
}

func (s *Service) checkMonthlyQuota(ctx context.Context, workspaceID string, limit entitlements.LimitKey) error {
	if s.quota == nil || s.usage == nil || workspaceID == "" {
		return nil
	}
	current, err := s.usage.CurrentMonthly(ctx, workspaceID, limit, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("loading usage for %s: %w", limit, err)
	}
	decision, err := s.quota.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       limit,
		Current:     current,
		Amount:      1,
	})
	if err != nil {
		return fmt.Errorf("checking quota for %s: %w", limit, err)
	}
	if !decision.Allowed {
		if decision.Reason != "" {
			return fmt.Errorf("quota exceeded: %s", decision.Reason)
		}
		return fmt.Errorf("quota exceeded: %s", limit)
	}
	return nil
}

func (s *Service) recordPublishedPost(ctx context.Context, workspaceID string) {
	s.recordUsage(ctx, workspaceID, entitlements.LimitPublishedPostsMonthly)
}

func (s *Service) recordProviderWriteCall(ctx context.Context, workspaceID string) {
	s.recordUsage(ctx, workspaceID, entitlements.LimitProviderWriteCallsMonthly)
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

func isExpiredTokenError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "expiredtoken") ||
		strings.Contains(msg, "token has expired") ||
		(strings.Contains(msg, "expired") && strings.Contains(msg, "token"))
}

//nolint:dupl

func (s *Service) platformMediaIDForRendition(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, provider platform.Publisher, token string, media models.MediaAttachment) (string, error) {
	if requiresPublicMedia(account.Platform, rendition.Profile) {
		return s.uploadRenditionMediaToPlatform(ctx, account, provider, token, rendition, media)
	}
	if err := s.validateRenditionMediaDeliveryOwner(ctx, publication, rendition, account, media); err != nil {
		return "", err
	}
	relations, err := s.renditionMediaRelations(ctx, publication.WorkspaceID, rendition.SettingsJSON)
	if err != nil {
		return "", err
	}
	if uploader, ok := provider.(platform.ResumableMetadataMediaUploader); ok {
		return s.resumablePlatformMediaIDForRendition(ctx, publication, rendition, account, uploader, token, media, relations)
	}

	return s.cachedPlatformMediaID(ctx, media.ID,
		func() (string, error) {
			return s.loadReadyRenditionMediaDelivery(ctx, publication, rendition, account, media.ID, relations)
		},
		func() (string, error) {
			return s.uploadRenditionMediaToPlatform(ctx, account, provider, token, rendition, media)
		},
		func(platformMediaID, status, errorMessage string) error {
			state := platform.ResumableMediaUploadState{
				ProviderMediaID:     platformMediaID,
				TotalBytes:          media.Size,
				Status:              platform.MediaUploadStatus(status),
				RetryClassification: platform.MediaRetryNone,
			}
			if status == providerMediaStatusFailed {
				state.RetryClassification = platform.MediaRetryTerminal
			}
			return s.saveRenditionMediaDelivery(ctx, publication, rendition, account, media.ID, relations, state, errorMessage)
		})
}

func (s *Service) cachedPlatformMediaID(_ context.Context, mediaID string, load func() (string, error), upload func() (string, error), save func(string, string, string) error) (string, error) {
	platformMediaID, err := load()
	if err != nil {
		return "", err
	}
	if platformMediaID != "" {
		return platformMediaID, nil
	}

	platformMediaID, err = upload()
	if err != nil {
		if saveErr := save("", providerMediaStatusFailed, err.Error()); saveErr != nil {
			log.Printf("[Publisher] Failed to record provider media upload failure for media %s: %v", mediaID, saveErr)
		}
		return "", err
	}

	if saveErr := save(platformMediaID, providerMediaStatusReady, ""); saveErr != nil {
		log.Printf("[Publisher] Failed to record provider media state for media %s: %v", mediaID, saveErr)
	}
	return platformMediaID, nil
}

func (s *Service) validateRenditionMediaDeliveryOwner(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, media models.MediaAttachment) error {
	var count int
	err := s.db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("renditions AS rendition").
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Join("JOIN social_accounts AS account ON account.id = rendition.social_account_id").
		Join("JOIN rendition_media AS rendition_media ON rendition_media.rendition_id = rendition.id").
		Join("JOIN media_attachments AS media ON media.id = rendition_media.media_id").
		Where("rendition.id = ?", rendition.ID).
		Where("rendition.publication_id = ?", publication.ID).
		Where("publication.workspace_id = ?", publication.WorkspaceID).
		Where("rendition.social_account_id = ?", account.ID).
		Where("rendition.platform = ?", account.Platform).
		Where("account.workspace_id = publication.workspace_id").
		Where("media.id = ?", media.ID).
		Where("media.workspace_id = publication.workspace_id").
		Scan(ctx, &count)
	if err != nil {
		return fmt.Errorf("validating rendition media delivery owner: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("media %s does not belong to rendition %s and account %s", media.ID, rendition.ID, account.ID)
	}
	return nil
}

type renditionMediaRelations struct {
	coverID     string
	thumbnailID string
	captionID   string
}

func (r renditionMediaRelations) equal(other renditionMediaRelations) bool {
	return r.coverID == other.coverID && r.thumbnailID == other.thumbnailID && r.captionID == other.captionID
}

func (s *Service) renditionMediaRelations(ctx context.Context, workspaceID, settingsJSON string) (renditionMediaRelations, error) {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(settingsJSON), &settings)
	relations := renditionMediaRelations{
		coverID:     localSettingMediaID(settings, "cover_media_id"),
		thumbnailID: localSettingMediaID(settings, "thumbnail_media_id"),
		captionID:   localSettingMediaID(settings, "caption_media_id"),
	}
	for role, mediaID := range map[string]string{
		"cover": relations.coverID, "thumbnail": relations.thumbnailID, "caption": relations.captionID,
	} {
		if mediaID == "" {
			continue
		}
		var count int
		if err := s.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("media_attachments").
			Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx, &count); err != nil {
			return renditionMediaRelations{}, fmt.Errorf("validating %s media relation: %w", role, err)
		}
		if count != 1 {
			return renditionMediaRelations{}, fmt.Errorf("%s media %s does not belong to workspace %s", role, mediaID, workspaceID)
		}
	}
	return relations, nil
}

func localSettingMediaID(settings map[string]interface{}, key string) string {
	value := settingStringPublisher(settings, key)
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return ""
	}
	return value
}

func (s *Service) resumablePlatformMediaIDForRendition(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	account *models.SocialAccount,
	uploader platform.ResumableMetadataMediaUploader,
	token string,
	media models.MediaAttachment,
	relations renditionMediaRelations,
) (string, error) {
	state, storedRelations, err := s.loadRenditionMediaDeliveryState(ctx, publication, rendition, account, media.ID)
	if err != nil {
		return "", err
	}
	if state.Status == platform.MediaUploadReady && state.ProviderMediaID != "" && storedRelations.equal(relations) {
		return state.ProviderMediaID, nil
	}
	if state.Status == platform.MediaUploadReady && state.ProviderMediaID != "" {
		state.Status = platform.MediaUploadUploaded
		state.RetryClassification = platform.MediaRetryReconcile
	}
	if state.Status == platform.MediaUploadFailed && state.RetryClassification == platform.MediaRetryTerminal {
		return "", fmt.Errorf("provider media delivery is terminal; replace the media before retrying")
	}
	if state.TotalBytes == 0 {
		state.TotalBytes = media.Size
	}
	checkpoint := func(next platform.ResumableMediaUploadState) error {
		state = next
		return s.saveRenditionMediaDelivery(ctx, publication, rendition, account, media.ID, relations, next, "")
	}
	providerMediaID, uploadErr := s.uploadRenditionMediaResumable(ctx, account, uploader, token, rendition, media, state, checkpoint)
	if uploadErr != nil {
		return "", s.recordRenditionMediaUploadFailure(ctx, publication, rendition, account, media.ID, relations, state, uploadErr)
	}
	if providerMediaID == "" {
		return "", fmt.Errorf("provider resumable upload returned an empty media id")
	}
	state.ProviderMediaID = providerMediaID
	state.Status = platform.MediaUploadReady
	state.RetryClassification = platform.MediaRetryNone
	state.UploadedBytes = state.TotalBytes
	state.OpaqueState = ""
	state.SessionExpiresAt = time.Time{}
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(state); err != nil {
		return "", fmt.Errorf("persisting completed rendition media delivery: %w", err)
	}
	return providerMediaID, nil
}

func (s *Service) recordRenditionMediaUploadFailure(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	account *models.SocialAccount,
	mediaID string,
	relations renditionMediaRelations,
	state platform.ResumableMediaUploadState,
	uploadErr error,
) error {
	uploadErr = redactResumableMediaStateFromError(uploadErr, state.OpaqueState)
	state.Status = platform.MediaUploadFailed
	classification, classified := platform.MediaRetryClassificationForError(uploadErr)
	switch {
	case classified:
		state.RetryClassification = classification
	case state.ProviderMediaID != "":
		state.RetryClassification = platform.MediaRetryReconcile
	case state.OpaqueState != "":
		state.RetryClassification = platform.MediaRetrySafeResume
	default:
		state.RetryClassification = platform.MediaRetryTerminal
	}
	if saveErr := s.saveRenditionMediaDelivery(ctx, publication, rendition, account, mediaID, relations, state, uploadErr.Error()); saveErr != nil {
		log.Printf("[Publisher] Failed to checkpoint resumable media error for rendition %s media %s: %v", rendition.ID, mediaID, saveErr)
	}
	return uploadErr
}

func redactResumableMediaStateFromError(err error, opaqueState string) error {
	if err == nil || opaqueState == "" {
		return err
	}
	message := err.Error()
	secrets := []string{opaqueState}
	var decoded any
	if json.Unmarshal([]byte(opaqueState), &decoded) == nil {
		secrets = append(secrets, resumableStateStrings(decoded)...)
	}
	for _, secret := range secrets {
		if secret != "" {
			message = strings.ReplaceAll(message, secret, "[redacted provider state]")
		}
	}
	if message == err.Error() {
		return err
	}
	redacted := errors.New(message)
	if classification, ok := platform.MediaRetryClassificationForError(err); ok {
		return &platform.MediaUploadError{RetryClassification: classification, Err: redacted}
	}
	return redacted
}

func resumableStateStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case []any:
		var values []string
		for _, item := range typed {
			values = append(values, resumableStateStrings(item)...)
		}
		return values
	case map[string]any:
		var values []string
		for _, item := range typed {
			values = append(values, resumableStateStrings(item)...)
		}
		return values
	default:
		return nil
	}
}

func (s *Service) loadReadyRenditionMediaDelivery(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, mediaID string, expectedRelations renditionMediaRelations) (string, error) {
	state, storedRelations, err := s.loadRenditionMediaDeliveryState(ctx, publication, rendition, account, mediaID)
	if err != nil {
		return "", err
	}
	if state.Status != platform.MediaUploadReady || !storedRelations.equal(expectedRelations) {
		if state.Status == platform.MediaUploadFailed && state.RetryClassification == platform.MediaRetryTerminal {
			return "", &platform.MediaUploadError{
				RetryClassification: platform.MediaRetryTerminal,
				Err:                 errors.New("the previous provider media upload ended with an unknown or rejected outcome; OpenPost did not upload it again"),
			}
		}
		return "", nil
	}
	return state.ProviderMediaID, nil
}

func (s *Service) loadRenditionMediaDeliveryState(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, mediaID string) (platform.ResumableMediaUploadState, renditionMediaRelations, error) {
	var delivery models.RenditionMediaDelivery
	err := s.db.NewSelect().Model(&delivery).
		Where("workspace_id = ?", publication.WorkspaceID).
		Where("publication_id = ?", publication.ID).
		Where("rendition_id = ?", rendition.ID).
		Where("social_account_id = ?", account.ID).
		Where("media_id = ?", mediaID).
		Where("platform = ?", account.Platform).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return platform.ResumableMediaUploadState{Status: platform.MediaUploadPending, RetryClassification: platform.MediaRetrySafeResume}, renditionMediaRelations{}, nil
	}
	if err != nil {
		return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("loading rendition media delivery: %w", err)
	}
	storedRelations, err := s.loadRenditionMediaDeliveryRelations(ctx, rendition.ID, mediaID)
	if err != nil {
		return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, err
	}
	opaqueState := ""
	if len(delivery.SessionStateEnc) > 0 {
		if s.mediaStateEncryptor == nil {
			return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("media upload state encryption is not configured")
		}
		opaqueState, err = s.mediaStateEncryptor.Decrypt(delivery.SessionStateEnc)
		if err != nil {
			return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("decrypting rendition media delivery state: %w", err)
		}
	}
	return platform.ResumableMediaUploadState{
		ProviderMediaID:     delivery.ProviderMediaID,
		OpaqueState:         opaqueState,
		UploadedBytes:       delivery.UploadedBytes,
		TotalBytes:          delivery.TotalBytes,
		SessionExpiresAt:    delivery.SessionExpiresAt,
		LastCheckedAt:       delivery.LastCheckedAt,
		Status:              platform.MediaUploadStatus(delivery.Status),
		RetryClassification: platform.MediaRetryClassification(delivery.RetryClassification),
	}, storedRelations, nil
}

func (s *Service) loadRenditionMediaDeliveryRelations(ctx context.Context, renditionID, mediaID string) (renditionMediaRelations, error) {
	var rows []models.RenditionMediaDeliveryRelation
	if err := s.db.NewSelect().Model(&rows).
		Where("rendition_id = ? AND delivery_media_id = ?", renditionID, mediaID).
		Scan(ctx); err != nil {
		return renditionMediaRelations{}, fmt.Errorf("loading rendition media delivery relations: %w", err)
	}
	var relations renditionMediaRelations
	for _, row := range rows {
		switch row.Role {
		case "cover":
			relations.coverID = row.RelatedMediaID
		case "thumbnail":
			relations.thumbnailID = row.RelatedMediaID
		case "caption":
			relations.captionID = row.RelatedMediaID
		}
	}
	return relations, nil
}

func (s *Service) saveRenditionMediaDelivery(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	account *models.SocialAccount,
	mediaID string,
	relations renditionMediaRelations,
	state platform.ResumableMediaUploadState,
	errorMessage string,
) error {
	var encryptedState []byte
	var err error
	if state.OpaqueState != "" {
		if s.mediaStateEncryptor == nil {
			return fmt.Errorf("media upload state encryption is not configured")
		}
		encryptedState, err = s.mediaStateEncryptor.Encrypt(state.OpaqueState)
		if err != nil {
			return fmt.Errorf("encrypting rendition media delivery state: %w", err)
		}
	}
	now := time.Now().UTC()
	delivery := &models.RenditionMediaDelivery{
		WorkspaceID:         publication.WorkspaceID,
		PublicationID:       publication.ID,
		RenditionID:         rendition.ID,
		SocialAccountID:     account.ID,
		MediaID:             mediaID,
		Platform:            account.Platform,
		ProviderMediaID:     state.ProviderMediaID,
		Status:              string(state.Status),
		SessionStateEnc:     encryptedState,
		UploadedBytes:       state.UploadedBytes,
		TotalBytes:          state.TotalBytes,
		SessionExpiresAt:    state.SessionExpiresAt,
		LastCheckedAt:       state.LastCheckedAt,
		RetryClassification: string(state.RetryClassification),
		ErrorMessage:        errorMessage,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(delivery).
			On("CONFLICT (rendition_id, media_id) DO UPDATE").
			Set("workspace_id = EXCLUDED.workspace_id").
			Set("publication_id = EXCLUDED.publication_id").
			Set("social_account_id = EXCLUDED.social_account_id").
			Set("platform = EXCLUDED.platform").
			Set("provider_media_id = EXCLUDED.provider_media_id").
			Set("status = EXCLUDED.status").
			Set("session_state_encrypted = EXCLUDED.session_state_encrypted").
			Set("uploaded_bytes = EXCLUDED.uploaded_bytes").
			Set("total_bytes = EXCLUDED.total_bytes").
			Set("session_expires_at = EXCLUDED.session_expires_at").
			Set("last_checked_at = EXCLUDED.last_checked_at").
			Set("retry_classification = EXCLUDED.retry_classification").
			Set("error_message = EXCLUDED.error_message").
			Set("updated_at = EXCLUDED.updated_at").
			Exec(ctx); err != nil {
			return fmt.Errorf("saving rendition media delivery: %w", err)
		}
		if _, err := tx.NewDelete().Model((*models.RenditionMediaDeliveryRelation)(nil)).
			Where("rendition_id = ? AND delivery_media_id = ?", rendition.ID, mediaID).
			Exec(ctx); err != nil {
			return fmt.Errorf("replacing rendition media delivery relations: %w", err)
		}
		rows := renditionMediaRelationRows(publication.WorkspaceID, rendition.ID, mediaID, relations)
		if len(rows) == 0 {
			return nil
		}
		if _, err := tx.NewInsert().Model(&rows).Exec(ctx); err != nil {
			return fmt.Errorf("saving rendition media delivery relations: %w", err)
		}
		return nil
	})
}

func renditionMediaRelationRows(workspaceID, renditionID, mediaID string, relations renditionMediaRelations) []models.RenditionMediaDeliveryRelation {
	values := []struct {
		role    string
		mediaID string
	}{
		{role: "cover", mediaID: relations.coverID},
		{role: "thumbnail", mediaID: relations.thumbnailID},
		{role: "caption", mediaID: relations.captionID},
	}
	rows := make([]models.RenditionMediaDeliveryRelation, 0, len(values))
	for _, value := range values {
		if value.mediaID == "" {
			continue
		}
		rows = append(rows, models.RenditionMediaDeliveryRelation{
			WorkspaceID:     workspaceID,
			RenditionID:     renditionID,
			DeliveryMediaID: mediaID,
			Role:            value.role,
			RelatedMediaID:  value.mediaID,
		})
	}
	return rows
}

func (s *Service) requireRenditionReadiness(
	ctx context.Context,
	account *models.SocialAccount,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
) error {
	connectorCapability, connectorBacked, connectorErr := s.connectorCapabilityForAccount(
		ctx, account, rendition.OutputProfile, rendition.Profile,
	)
	if connectorErr != nil {
		return connectorErr
	}
	if connectorBacked {
		return validateRenditionPolicyMode(account, rendition, authorization, connectorCapability, "connector")
	}
	if s == nil || s.readiness == nil {
		return &providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationPublishImmediate),
		}
	}
	capability := publisherRenditionCapability(account, rendition)
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
		return fmt.Errorf("decode rendition provider policy settings: %w", err)
	}
	providerPolicyMode := providerreadiness.PublicationPolicyMode(*account, capability, settings)
	if authorization != nil && authorization.ProviderPolicyMode != providerPolicyMode {
		return fmt.Errorf("publication authorization validation failed: provider policy mode changed")
	}
	operation := providerreadiness.OperationPublishImmediate
	if authorization != nil && authorization.PolicyMode == publicationauth.PolicyScheduled {
		operation = providerreadiness.OperationPublishScheduled
	}
	decision := s.readiness.DecideAccountPublication(
		ctx,
		*account,
		capability,
		operation,
		publisherReadinessIntent(string(intent)),
		providerPolicyMode,
	)
	if !decision.Publishable {
		return &providerreadiness.NotReadyError{Decision: decision}
	}
	return nil
}

func validateRenditionPolicyMode(
	account *models.SocialAccount,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	capability capabilities.Capability,
	settingsKind string,
) error {
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
		return fmt.Errorf("decode rendition %s settings: %w", settingsKind, err)
	}
	providerPolicyMode := providerreadiness.PublicationPolicyMode(*account, capability, settings)
	if authorization != nil && authorization.ProviderPolicyMode != providerPolicyMode {
		return fmt.Errorf("publication authorization validation failed: provider policy mode changed")
	}
	return nil
}

func publisherRenditionCapability(account *models.SocialAccount, rendition *models.Rendition) capabilities.Capability {
	if capability, found := capabilities.FindOutput(account.Platform, rendition.OutputProfile); found {
		return capability
	}
	if capability, found := capabilities.Find(account.Platform, rendition.Profile); found {
		return capability
	}
	return capabilities.Capability{
		Provider: account.Platform, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile,
	}
}

func (s *Service) connectorCapabilityForAccount(
	ctx context.Context,
	account *models.SocialAccount,
	outputProfile, profile string,
) (capabilities.Capability, bool, error) {
	if s == nil || s.connectorStore == nil || s.connectorRegistry == nil || account == nil {
		return capabilities.Capability{}, false, nil
	}
	binding, err := s.connectorStore.BindingForAccount(ctx, account.WorkspaceID, account.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return capabilities.Capability{}, false, nil
	}
	if err != nil {
		return capabilities.Capability{}, false, err
	}
	_, entry, err := s.connectorRegistry.ClientForWorkspace(binding.InstallationID, account.WorkspaceID)
	if err != nil {
		return capabilities.Capability{}, true, err
	}
	if binding.CapabilityRevision != entry.Manifest.CapabilityRevision {
		return capabilities.Capability{}, true, fmt.Errorf("connector capabilities changed; reconnect account before publishing")
	}
	for _, capability := range entry.Capabilities() {
		if outputProfile != "" && capability.OutputProfile == outputProfile {
			return capability, true, nil
		}
		if outputProfile == "" && capability.Profile == profile {
			return capability, true, nil
		}
	}
	return capabilities.Capability{}, true, fmt.Errorf(
		"connector installation %q does not support output profile %q",
		binding.InstallationID, outputProfile,
	)
}

func (s *Service) publishProvider(
	ctx context.Context,
	provider platform.Publisher,
	token, accountID string,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (platform.PublishResult, error) {
	direct, ok := provider.(platform.DirectMediaPublisher)
	if !ok || len(media) == 0 {
		return provider.Publish(ctx, token, accountID, req)
	}
	if s.storage == nil {
		return platform.PublishResult{}, fmt.Errorf("media storage is not configured")
	}

	inputs := make([]platform.UploadMediaRequest, 0, len(media))
	readers := make([]io.ReadCloser, 0, len(media))
	closeReaders := func() {
		for _, reader := range readers {
			_ = reader.Close()
		}
	}
	for _, item := range media {
		reader, err := s.storage.Open(ctx, filepath.Base(item.FilePath))
		if err != nil {
			closeReaders()
			return platform.PublishResult{}, fmt.Errorf("opening media file %s: %w", item.FilePath, err)
		}
		readers = append(readers, reader)
		inputs = append(inputs, platform.UploadMediaRequest{
			MimeType: item.MimeType,
			Filename: firstNonEmptyPublisherString(item.OriginalFilename, filepath.Base(item.FilePath)),
			Size:     item.Size,
			Reader:   reader,
		})
	}
	defer closeReaders()
	return direct.PublishWithMedia(ctx, token, accountID, req, inputs)
}

type providerWriteScope struct {
	operationID     string
	authorizationID string
	publicationID   string
	renditionID     string
	socialAccountID string
	targetKey       string
	operation       string
	contentHash     string
	mediaHash       string
	settingsHash    string
	readinessIntent providerreadiness.ExecutionIntent
}

func publicationWriteScope(
	authorization *models.PublicationAuthorization,
	subject, operation string,
	intents ...providerreadiness.ExecutionIntent,
) providerWriteScope {
	intent := providerreadiness.ExecutionIntentProduction
	if len(intents) > 0 {
		intent = publisherReadinessIntent(string(intents[0]))
	}
	if authorization == nil {
		return providerWriteScope{operation: operation, readinessIntent: intent}
	}
	return providerWriteScope{
		operationID:     strings.Join([]string{"authorization", authorization.ID, subject, operation}, ":"),
		authorizationID: authorization.ID,
		publicationID:   authorization.PublicationID,
		renditionID:     authorization.RenditionID,
		socialAccountID: authorization.SocialAccountID,
		targetKey:       authorization.TargetKey,
		operation:       operation,
		contentHash:     authorization.ContentHash,
		mediaHash:       authorization.MediaHash,
		settingsHash:    authorization.SettingsHash,
		readinessIntent: intent,
	}
}

//nolint:unparam // workspaceID is part of the legacy write-scope signature; tests pass a static workspace while canonical callers use publicationWriteScope.
func legacyWriteScope(
	ctx context.Context,
	workspaceID, socialAccountID, targetKey, subject string,
) providerWriteScope {
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	owner := execution.ID
	if owner == "" {
		owner = workspaceID
	}
	return providerWriteScope{
		operationID:     strings.Join([]string{"legacy", owner, subject, "publish"}, ":"),
		socialAccountID: socialAccountID,
		targetKey:       targetKey,
		operation:       "publish",
	}
}

func (s *Service) publishProviderWithUsage(
	ctx context.Context,
	workspaceID, providerName, subject, phase string,
	writeScope providerWriteScope,
	provider platform.Publisher,
	token, accountID string,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (platform.PublishResult, error) {
	if writeScope.operationID == "" || writeScope.socialAccountID == "" || writeScope.targetKey == "" {
		return platform.PublishResult{}, fmt.Errorf("provider write ownership is required")
	}
	fingerprint, err := providerPublishFingerprint(writeScope, req, media)
	if err != nil {
		return platform.PublishResult{}, err
	}
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	input := providerwrite.Input{
		OperationID: writeScope.operationID, JobID: execution.ID,
		AuthorizationID: writeScope.authorizationID, WorkspaceID: workspaceID,
		PublicationID: writeScope.publicationID, RenditionID: writeScope.renditionID,
		SocialAccountID: writeScope.socialAccountID, TargetKey: writeScope.targetKey,
		Provider: providerName, Operation: writeScope.operation,
		PayloadFingerprint: fingerprint,
	}
	send := func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		if readinessErr := s.requireProviderWriteReadiness(sendCtx, workspaceID, providerName, writeScope, req); readinessErr != nil {
			return platform.PublishResult{}, readinessErr
		}
		if quotaErr := s.checkMonthlyQuota(sendCtx, workspaceID, entitlements.LimitProviderWriteCallsMonthly); quotaErr != nil {
			return platform.PublishResult{}, quotaErr
		}
		reservation, reserveErr := s.reserveProviderPublishCost(sendCtx, workspaceID, providerName, subject, phase, req)
		if reserveErr != nil {
			return platform.PublishResult{}, reserveErr
		}
		requestCopy := *req
		control.BindPublishRequest(&requestCopy)
		s.recordProviderWriteCall(sendCtx, workspaceID)
		result, publishErr := s.publishProvider(sendCtx, provider, token, accountID, &requestCopy, media)
		s.settleProviderPublishCost(sendCtx, reservation, publishErr)
		return result, publishErr
	}
	var reconcile providerwrite.ReconcileFunc
	if reconciler, ok := provider.(platform.PublishReconciler); ok {
		reconcile = func(reconcileCtx context.Context, reference string) (platform.PublishResult, error) {
			return reconciler.ReconcilePublish(reconcileCtx, token, accountID, reference)
		}
	}
	return providerwrite.New(s.db).Execute(ctx, input, send, reconcile)
}

func (s *Service) requireProviderWriteReadiness(
	ctx context.Context,
	workspaceID, providerName string,
	writeScope providerWriteScope,
	req *platform.PublishRequest,
) error {
	if s == nil || s.readiness == nil {
		return &providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationPublishImmediate),
		}
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ?", writeScope.socialAccountID).
		Where("workspace_id = ?", workspaceID).
		Where("platform = ?", providerName).
		Scan(ctx); err != nil {
		return fmt.Errorf("loading provider readiness account: %w", err)
	}
	var authorization *models.PublicationAuthorization
	if writeScope.authorizationID != "" {
		var row models.PublicationAuthorization
		if err := s.db.NewSelect().Model(&row).
			Where("id = ?", writeScope.authorizationID).
			Where("workspace_id = ?", workspaceID).
			Where("social_account_id = ?", account.ID).
			Scan(ctx); err != nil {
			return fmt.Errorf("loading provider readiness authorization: %w", err)
		}
		authorization = &row
	}
	settingsJSON, err := json.Marshal(req.Settings)
	if err != nil {
		return fmt.Errorf("encode provider readiness settings: %w", err)
	}
	rendition := &models.Rendition{
		Profile: req.Profile, OutputProfile: req.OutputProfile, SettingsJSON: string(settingsJSON),
	}
	return s.requireRenditionReadiness(ctx, &account, rendition, authorization, writeScope.readinessIntent)
}

func publisherReadinessIntent(raw string) providerreadiness.ExecutionIntent {
	if providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) == providerreadiness.ExecutionIntentCertificationTest {
		return providerreadiness.ExecutionIntentCertificationTest
	}
	return providerreadiness.ExecutionIntentProduction
}

type providerPublishLogicalPayload struct {
	AuthorizationID string                            `json:"authorization_id,omitempty"`
	ContentHash     string                            `json:"content_hash,omitempty"`
	MediaHash       string                            `json:"media_hash,omitempty"`
	SettingsHash    string                            `json:"settings_hash,omitempty"`
	Content         string                            `json:"content"`
	Profile         string                            `json:"profile"`
	OutputProfile   string                            `json:"output_profile"`
	Title           string                            `json:"title"`
	Description     string                            `json:"description"`
	ReplyToID       string                            `json:"reply_to_id"`
	SettingsJSON    string                            `json:"settings_json,omitempty"`
	Settings        map[string]interface{}            `json:"settings,omitempty"`
	MediaAltTexts   []string                          `json:"media_alt_texts,omitempty"`
	MediaSettings   []map[string]interface{}          `json:"media_settings,omitempty"`
	Media           []providerPublishMediaFingerprint `json:"media"`
}

type providerPublishMediaFingerprint struct {
	ID               string `json:"id"`
	FileHash         string `json:"file_hash"`
	MimeType         string `json:"mime_type"`
	Size             int64  `json:"size"`
	DurationMS       int64  `json:"duration_ms"`
	OriginalFilename string `json:"original_filename"`
}

func providerPublishFingerprint(
	scope providerWriteScope,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (string, error) {
	if req == nil {
		return "", fmt.Errorf("provider publish request is required")
	}
	payload := providerPublishLogicalPayload{
		AuthorizationID: scope.authorizationID,
		ContentHash:     scope.contentHash,
		MediaHash:       scope.mediaHash,
		SettingsHash:    scope.settingsHash,
		Content:         req.Content,
		Profile:         req.Profile,
		OutputProfile:   req.OutputProfile,
		Title:           req.Title,
		Description:     req.Description,
		ReplyToID:       req.ReplyToID,
		Media:           make([]providerPublishMediaFingerprint, 0, len(media)),
	}
	// Authorization receipts already hash the exact logical settings, media,
	// and ordered descriptors. Do not fingerprint hydrated provider URLs here:
	// their short-lived signatures change between safe retries even though the
	// authorized payload did not.
	if scope.authorizationID == "" {
		payload.SettingsJSON = req.SettingsJSON
		payload.Settings = req.Settings
		payload.MediaAltTexts = req.MediaAltTexts
		payload.MediaSettings = req.MediaSettings
	}
	for _, item := range media {
		payload.Media = append(payload.Media, providerPublishMediaFingerprint{
			ID: item.ID, FileHash: item.FileHash, MimeType: item.MimeType,
			Size: item.Size, DurationMS: item.DurationMS,
			OriginalFilename: item.OriginalFilename,
		})
	}
	return providerwrite.Fingerprint("provider-publish-v2", payload)
}

//nolint:unparam // token is part of the upload seam signature; tests pass a static token while production media uploads flow through uploadRenditionMediaToPlatform.
func (s *Service) uploadMediaToPlatform(ctx context.Context, account *models.SocialAccount, provider platform.Publisher, token string, media models.MediaAttachment, content string) (string, error) {
	if requiresPublicMedia(account.Platform, "") {
		return s.getPublicMediaURL(media), nil
	}

	if s.storage == nil {
		return "", fmt.Errorf("media storage is not configured")
	}
	data, err := s.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return "", fmt.Errorf("opening media file %s: %w", media.FilePath, err)
	}
	defer data.Close()

	if uploader, ok := provider.(platform.MetadataMediaUploader); ok {
		return uploader.UploadMediaWithMetadata(ctx, token, account.AccountID, platform.UploadMediaRequest{
			MimeType:    media.MimeType,
			Filename:    firstNonEmptyPublisherString(media.OriginalFilename, filepath.Base(media.FilePath)),
			Size:        media.Size,
			Title:       firstContentLine(content),
			Description: strings.TrimSpace(content),
			Reader:      data,
		})
	}

	uploader, ok := provider.(platform.MediaUploader)
	if !ok {
		return "", fmt.Errorf("provider does not support media uploads")
	}
	return uploader.UploadMedia(ctx, token, account.AccountID, media.MimeType, data)
}

func (s *Service) uploadRenditionMediaToPlatform(ctx context.Context, account *models.SocialAccount, provider platform.Publisher, token string, rendition *models.Rendition, media models.MediaAttachment) (string, error) {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)

	if requiresPublicMedia(account.Platform, rendition.Profile) && !usesTikTokFileUpload(account.Platform, settings) {
		return s.getPublicMediaURL(media), nil
	}
	if uploader, ok := provider.(platform.MetadataMediaUploader); ok {
		req, closeReaders, err := s.renditionUploadRequest(ctx, rendition, media, settings, true)
		if err != nil {
			return "", err
		}
		defer closeReaders()
		return uploader.UploadMediaWithMetadata(ctx, token, account.AccountID, req)
	}

	if s.storage == nil {
		return "", fmt.Errorf("media storage is not configured")
	}
	data, err := s.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return "", fmt.Errorf("opening media file %s: %w", media.FilePath, err)
	}
	defer data.Close()
	uploader, ok := provider.(platform.MediaUploader)
	if !ok {
		return "", fmt.Errorf("provider does not support media uploads")
	}
	return uploader.UploadMedia(ctx, token, account.AccountID, media.MimeType, data)
}

func (s *Service) uploadRenditionMediaResumable(
	ctx context.Context,
	account *models.SocialAccount,
	uploader platform.ResumableMetadataMediaUploader,
	token string,
	rendition *models.Rendition,
	media models.MediaAttachment,
	state platform.ResumableMediaUploadState,
	checkpoint platform.MediaUploadCheckpoint,
) (string, error) {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)
	req, closeReaders, err := s.renditionUploadRequest(ctx, rendition, media, settings, false)
	if err != nil {
		return "", err
	}
	defer closeReaders()
	return uploader.UploadMediaResumable(ctx, token, account.AccountID, req, state, checkpoint)
}

func (s *Service) renditionUploadRequest(ctx context.Context, rendition *models.Rendition, media models.MediaAttachment, settings map[string]interface{}, openPrimaryReader bool) (platform.UploadMediaRequest, func(), error) {
	if s.storage == nil {
		return platform.UploadMediaRequest{}, nil, fmt.Errorf("media storage is not configured")
	}
	storageKey := filepath.Base(media.FilePath)
	var data io.ReadCloser
	readers := make([]io.ReadCloser, 0, 3)
	if openPrimaryReader {
		var err error
		data, err = s.storage.Open(ctx, storageKey)
		if err != nil {
			return platform.UploadMediaRequest{}, nil, fmt.Errorf("opening media file %s: %w", media.FilePath, err)
		}
		readers = append(readers, data)
	}
	closeReaders := func() {
		for _, reader := range readers {
			_ = reader.Close()
		}
	}
	fail := func(err error) (platform.UploadMediaRequest, func(), error) {
		closeReaders()
		return platform.UploadMediaRequest{}, nil, err
	}

	thumbnail, thumbnailReader, err := s.openThumbnailFromSettings(ctx, settings)
	if err != nil {
		return fail(err)
	}
	if thumbnailReader != nil {
		readers = append(readers, thumbnailReader)
	}
	caption, captionReader, err := s.openSettingMedia(ctx, settings, "caption_media_id", "")
	if err != nil {
		return fail(err)
	}
	if captionReader != nil {
		readers = append(readers, captionReader)
	}
	req := platform.UploadMediaRequest{
		MimeType:    media.MimeType,
		Filename:    firstNonEmptyPublisherString(media.OriginalFilename, storageKey),
		Size:        media.Size,
		Title:       firstNonEmptyPublisherString(rendition.Title, firstContentLine(rendition.Body)),
		Description: strings.TrimSpace(firstNonEmptyPublisherString(rendition.Description, rendition.Body)),
		Settings:    settings,
		Reader:      data,
		OpenReaderAt: func(offset int64) (io.ReadCloser, error) {
			return s.openMediaReaderAt(ctx, storageKey, offset)
		},
	}
	if thumbnail != nil {
		req.ThumbnailMimeType = thumbnail.MimeType
		req.ThumbnailFilename = firstNonEmptyPublisherString(thumbnail.OriginalFilename, filepath.Base(thumbnail.FilePath))
		req.ThumbnailSize = thumbnail.Size
		req.ThumbnailReader = thumbnailReader
	}
	if caption != nil {
		req.CaptionMimeType = caption.MimeType
		req.CaptionFilename = firstNonEmptyPublisherString(caption.OriginalFilename, filepath.Base(caption.FilePath))
		req.CaptionSize = caption.Size
		req.CaptionReader = captionReader
	}
	return req, closeReaders, nil
}

func (s *Service) openMediaReaderAt(ctx context.Context, storageKey string, offset int64) (io.ReadCloser, error) {
	if offset < 0 {
		return nil, fmt.Errorf("invalid media offset %d", offset)
	}
	if ranged, ok := s.storage.(mediastore.RangeBlobStorage); ok {
		return ranged.OpenRange(ctx, storageKey, offset)
	}
	reader, err := s.storage.Open(ctx, storageKey)
	if err != nil {
		return nil, err
	}
	if offset == 0 {
		return reader, nil
	}
	if _, err := io.CopyN(io.Discard, reader, offset); err != nil {
		_ = reader.Close()
		return nil, fmt.Errorf("positioning media reader at byte %d: %w", offset, err)
	}
	return reader, nil
}

func (s *Service) openThumbnailFromSettings(ctx context.Context, settings map[string]interface{}) (*models.MediaAttachment, io.ReadCloser, error) {
	thumbnailID := settingStringPublisher(settings, "thumbnail_media_id")
	if thumbnailID == "" {
		return nil, nil, nil
	}
	if s.db == nil {
		return nil, nil, fmt.Errorf("thumbnail media lookup requires a database")
	}
	if s.storage == nil {
		return nil, nil, fmt.Errorf("media storage is not configured")
	}
	var thumbnail models.MediaAttachment
	if err := s.db.NewSelect().Model(&thumbnail).Where("id = ?", thumbnailID).Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("loading thumbnail media %s: %w", thumbnailID, err)
	}
	if !strings.HasPrefix(strings.ToLower(thumbnail.MimeType), "image/") {
		return nil, nil, fmt.Errorf("thumbnail media %s must be an image", thumbnailID)
	}
	reader, err := s.storage.Open(ctx, filepath.Base(thumbnail.FilePath))
	if err != nil {
		return nil, nil, fmt.Errorf("opening thumbnail media file %s: %w", thumbnail.FilePath, err)
	}
	return &thumbnail, reader, nil
}

func (s *Service) openSettingMedia(ctx context.Context, settings map[string]interface{}, key, mimePrefix string) (*models.MediaAttachment, io.ReadCloser, error) {
	mediaID := settingStringPublisher(settings, key)
	if mediaID == "" {
		return nil, nil, nil
	}
	if s.db == nil {
		return nil, nil, fmt.Errorf("%s media lookup requires a database", key)
	}
	if s.storage == nil {
		return nil, nil, fmt.Errorf("media storage is not configured")
	}
	var media models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("loading %s media %s: %w", key, mediaID, err)
	}
	if mimePrefix != "" && !strings.HasPrefix(strings.ToLower(media.MimeType), mimePrefix) {
		return nil, nil, fmt.Errorf("%s media %s must use a %s MIME type", key, mediaID, mimePrefix)
	}
	reader, err := s.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return nil, nil, fmt.Errorf("opening %s media file %s: %w", key, media.FilePath, err)
	}
	return &media, reader, nil
}

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

func (s *Service) loadRenditionMedia(ctx context.Context, renditionID string) ([]models.MediaAttachment, []string, []map[string]interface{}, error) {
	var rows []struct {
		AltText              string `bun:"alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		models.MediaAttachment
	}
	if err := s.db.NewSelect().
		TableExpr("rendition_media AS rm").
		ColumnExpr("rm.alt_text, rm.thumbnail_timestamp_ms").
		ColumnExpr("ma.*").
		Join("JOIN media_attachments AS ma ON ma.id = rm.media_id").
		Where("rm.rendition_id = ?", renditionID).
		Order("rm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		return nil, nil, nil, fmt.Errorf("fetching rendition media: %w", err)
	}
	media := make([]models.MediaAttachment, 0, len(rows))
	altTexts := make([]string, 0, len(rows))
	settings := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		item := row.MediaAttachment
		media = append(media, item)
		altTexts = append(altTexts, firstNonEmptyPublisherString(row.AltText, item.AltText))
		itemSettings := map[string]interface{}{}
		if row.ThumbnailTimestampMS > 0 {
			itemSettings["thumbnail_timestamp_ms"] = row.ThumbnailTimestampMS
		}
		settings = append(settings, itemSettings)
	}
	return media, altTexts, settings, nil
}

func (s *Service) providerForAccount(ctx context.Context, workspaceID string, account *models.SocialAccount) (platform.Publisher, string, bool, error) {
	if s.connectorStore != nil && s.connectorRegistry != nil {
		binding, err := s.connectorStore.BindingForAccount(ctx, workspaceID, account.ID)
		switch {
		case err == nil:
			client, entry, resolveErr := s.connectorRegistry.ClientForWorkspace(binding.InstallationID, workspaceID)
			if resolveErr != nil {
				return nil, binding.InstallationID, true, resolveErr
			}
			if binding.CapabilityRevision != entry.Manifest.CapabilityRevision {
				return nil, binding.InstallationID, true, fmt.Errorf("connector capabilities changed; reconnect account before publishing")
			}
			return connectors.NewPublisher(client, binding.ConnectionRef, binding.CapabilityRevision), binding.InstallationID, true, nil
		case !errors.Is(err, sql.ErrNoRows):
			return nil, "", false, err
		}
	}
	providerKey := account.Platform
	if account.Platform == "mastodon" {
		providerKey = "mastodon:" + account.InstanceURL
	}
	s.providerMu.RLock()
	provider, ok := s.providers[providerKey]
	s.providerMu.RUnlock()
	if !ok {
		return nil, providerKey, false, fmt.Errorf("unsupported platform: %s (instance: %s)", account.Platform, account.InstanceURL)
	}
	return provider, providerKey, false, nil
}

func (s *Service) finalizePublication(ctx context.Context, publication *models.Publication) {
	var renditions []models.Rendition
	if err := s.db.NewSelect().Model(&renditions).Where("publication_id = ?", publication.ID).Scan(ctx); err != nil {
		log.Printf("[Publisher] Failed to load renditions for publication %s: %v", publication.ID, err)
		return
	}
	hasFailed := false
	allPublished := len(renditions) > 0
	for _, rendition := range renditions {
		if rendition.Status == models.RenditionStatusFailed {
			hasFailed = true
		}
		if rendition.Status != models.RenditionStatusPublished {
			allPublished = false
		}
	}
	status := models.PublicationStatusScheduled
	switch {
	case allPublished:
		status = models.PublicationStatusPublished
	case hasFailed:
		status = models.PublicationStatusFailed
	}
	now := time.Now().UTC()
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", status).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(txCtx); err != nil {
			return err
		}
		return s.createPublicationResultNotifications(txCtx, tx, publication, status, renditions)
	})
	if err != nil {
		log.Printf("[Publisher] Failed to finalize publication %s: %v", publication.ID, err)
		return
	}
	s.cleanupPublishedPublicationMedia(ctx, publication.ID, status)
}

func (s *Service) cleanupPublishedPublicationMedia(ctx context.Context, publicationID, status string) {
	if status != models.PublicationStatusPublished {
		return
	}
	if err := medialifecycle.NewService(s.db, s.storage).TrashTemporaryForPublication(ctx, publicationID); err != nil {
		log.Printf("[Publisher] Failed to clean temporary media for publication %s: %v", publicationID, err)
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
	result, err := collectPublicationNotificationResult(ctx, db, renditions)
	if err != nil {
		return err
	}
	if status != models.PublicationStatusPublished && status != models.PublicationStatusFailed {
		return nil
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
	if !result.reconnect {
		return nil
	}
	return s.createReconnectNotifications(ctx, db, publication, result)
}

type publicationNotificationResult struct {
	accounts         map[string]models.SocialAccount
	successful       []string
	failed           []string
	failedAccountIDs []string
	retryable        bool
	reconnect        bool
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
		accounts:         make(map[string]models.SocialAccount, len(accounts)),
		successful:       make([]string, 0, len(renditions)),
		failed:           make([]string, 0, len(renditions)),
		failedAccountIDs: make([]string, 0, len(renditions)),
	}
	for _, account := range accounts {
		result.accounts[account.ID] = account
	}
	for _, rendition := range renditions {
		result.addRendition(rendition)
	}
	return result, nil
}

func (result *publicationNotificationResult) addRendition(rendition models.Rendition) {
	label := publisherDestinationLabel(rendition, result.accounts[rendition.SocialAccountID])
	switch rendition.Status {
	case models.RenditionStatusPublished:
		result.successful = append(result.successful, label)
	case models.RenditionStatusFailed:
		result.failed = append(result.failed, label)
		result.failedAccountIDs = append(result.failedAccountIDs, rendition.SocialAccountID)
		result.retryable = result.retryable || rendition.ErrorRetryable
		result.reconnect = result.reconnect || rendition.ErrorAction == FailureActionReconnect
	}
}

func publicationNotificationCohort(ctx context.Context, publication *models.Publication) string {
	execution, _ := ctx.Value(jobExecutionContextKey{}).(jobExecution)
	if execution.ID != "" {
		return "job:" + execution.ID
	}
	return fmt.Sprintf("revision:%d", publication.Revision)
}

func (s *Service) createReconnectNotifications(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	result publicationNotificationResult,
) error {
	for _, accountID := range result.failedAccountIDs {
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
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "x":
		return "X"
	case "youtube":
		return "YouTube"
	case "tiktok":
		return "TikTok"
	case "linkedin":
		return "LinkedIn"
	case "bluesky":
		return "Bluesky"
	case "mastodon":
		return "Mastodon"
	case "instagram":
		return "Instagram"
	case "facebook":
		return "Facebook"
	case "threads":
		return "Threads"
	default:
		return "Destination"
	}
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

func requiresPublicMedia(platformName, profile string) bool {
	if profile != "" {
		capability, ok := capabilities.Find(platformName, profile)
		if ok {
			return capability.RequiresPublicMedia || capability.Media.RequiresPublicURL
		}
	}
	for _, capability := range capabilities.All() {
		if capability.Provider == platformName && (capability.RequiresPublicMedia || capability.Media.RequiresPublicURL) {
			return true
		}
	}
	return false
}

func usesTikTokFileUpload(platformName string, settings map[string]interface{}) bool {
	if platformName != "tiktok" {
		return false
	}
	mode := strings.ToUpper(strings.TrimSpace(settingStringPublisher(settings, "content_posting_method")))
	return mode == "UPLOAD" || mode == "MEDIA_UPLOAD"
}

func firstContentLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func firstNonEmptyPublisherString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *Service) getPublicMediaURL(media models.MediaAttachment) string {
	return publicurl.ResolveMediaURL(
		s.publicMediaURL,
		s.storage,
		s.mediaSigner,
		media,
		time.Now().UTC().Add(15*time.Minute),
	)
}
