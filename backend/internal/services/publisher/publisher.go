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
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

var errLinkedInThreadReplySkipped = errors.New("linkedin thread reply skipped")

const (
	providerMediaStatusReady  = "ready"
	providerMediaStatusFailed = "failed"
)

type Service struct {
	db                           *bun.DB
	tm                           *tokenmanager.TokenManager
	providerMu                   sync.RWMutex
	providers                    map[string]platform.Adapter
	disableLinkedInThreadReplies bool
	publicMediaURL               string
	mediaSigner                  *mediasigner.Signer
	storage                      mediastore.BlobStorage
	usage                        *usage.Service
	quota                        entitlements.Service
	notifications                *notifications.Service
}

func NewService(db *bun.DB, tm *tokenmanager.TokenManager) *Service {
	return &Service{
		db:        db,
		tm:        tm,
		providers: make(map[string]platform.Adapter),
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

func (s *Service) SetProvider(platformName string, adapter platform.Adapter) {
	s.providerMu.Lock()
	defer s.providerMu.Unlock()
	s.providers[platformName] = adapter
}

func (s *Service) HandlePublishJob(ctx context.Context, jobPayload string) error {
	var payload struct {
		PostID string `json:"post_id"`
	}
	if err := json.Unmarshal([]byte(jobPayload), &payload); err != nil {
		return err
	}

	log.Printf("[Publisher] Processing post %s", payload.PostID)

	post := new(models.Post)
	if err := s.db.NewSelect().Model(post).Where("id = ?", payload.PostID).Scan(ctx); err != nil {
		return err
	}
	if _, err := s.db.NewUpdate().Model(post).
		Set("status = ?", "publishing").
		Where("id = ?", post.ID).
		Exec(ctx); err != nil {
		log.Printf("[Publisher] Failed to mark post %s as publishing: %v", post.ID, err)
	}

	var threadPosts []*models.Post
	if post.ThreadSequence == 0 {
		// Try to fetch the full thread in a single recursive CTE query to avoid N+1 DB queries.
		var fetched []models.Post
		cte := `WITH RECURSIVE thread AS (
            SELECT * FROM posts WHERE id = ?
            UNION ALL
            SELECT p.* FROM posts p JOIN thread t ON p.parent_post_id = t.id
        ) SELECT * FROM thread ORDER BY thread_sequence ASC`

		if err := s.db.NewRaw(cte, post.ID).Scan(ctx, &fetched); err == nil && len(fetched) > 0 {
			threadPosts = make([]*models.Post, 0, len(fetched))
			for i := range fetched {
				// copy to avoid referencing loop variable
				p := fetched[i]
				threadPosts = append(threadPosts, &p)
			}
			if len(threadPosts) > 1 {
				log.Printf("[Publisher] Thread detected: %d posts starting from %s", len(threadPosts), post.ID)
			}
		} else {
			// Fallback to iterative fetch if CTE fails for any reason
			threadPosts = append(threadPosts, post)
			currentParentID := post.ID

			for {
				var child models.Post
				err := s.db.NewSelect().Model(&child).
					Where("parent_post_id = ?", currentParentID).
					Order("thread_sequence ASC").
					Limit(1).
					Scan(ctx)

				if err != nil {
					break
				}
				threadPosts = append(threadPosts, &child)
				currentParentID = child.ID
			}

			if len(threadPosts) > 1 {
				log.Printf("[Publisher] Thread detected: %d posts starting from %s", len(threadPosts), post.ID)
			}
		}
	}

	if len(threadPosts) > 1 {
		return s.publishThread(ctx, threadPosts)
	}

	return s.publishSinglePost(ctx, post)
}

// UpdateJobRetryAt keeps user-visible destination retry metadata aligned with
// the worker's final bounded and jittered run time.
func (s *Service) UpdateJobRetryAt(ctx context.Context, jobType, jobPayload string, retryAt time.Time) error {
	retryAt = retryAt.UTC()
	switch jobType {
	case "publish_publication":
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
		_, err := s.db.NewUpdate().
			Model((*models.PostDestination)(nil)).
			Set("error_retry_at = ?", retryAt).
			Where("post_id IN (SELECT id FROM posts WHERE publication_id = ?)", payload.PublicationID).
			Where("status = ? AND error_retryable = ?", "failed", true).
			Exec(ctx)
		return err
	case "publish_post":
		var payload struct {
			PostID string `json:"post_id"`
		}
		if err := json.Unmarshal([]byte(jobPayload), &payload); err != nil {
			return err
		}
		if payload.PostID == "" {
			return nil
		}
		_, err := s.db.NewUpdate().
			Model((*models.PostDestination)(nil)).
			Set("error_retry_at = ?", retryAt).
			Where("post_id = ? AND status = ? AND error_retryable = ?", payload.PostID, "failed", true).
			Exec(ctx)
		return err
	}
	return nil
}

//nolint:gocyclo // One handler preserves publication, rendition, media, lifecycle, and retry state across every job action.
func (s *Service) HandlePublishPublicationJob(ctx context.Context, jobPayload string) error {
	var payload struct {
		PublicationID string                   `json:"publication_id"`
		RenditionID   string                   `json:"rendition_id"`
		Action        string                   `json:"action"`
		Body          string                   `json:"body"`
		ParentID      string                   `json:"parent_id"`
		Settings      map[string]interface{}   `json:"settings"`
		Media         []map[string]interface{} `json:"media"`
	}
	if err := json.Unmarshal([]byte(jobPayload), &payload); err != nil {
		return err
	}
	if payload.Action == "reply" {
		return s.publishRenditionReply(ctx, payload.RenditionID, payload.Body, payload.ParentID, payload.Settings)
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
	if _, err := s.db.NewUpdate().
		Model((*models.Post)(nil)).
		Set("status = ?", models.PostStatusPublishing).
		Set("actual_run_at = ?", time.Now().UTC()).
		Where("publication_id = ?", publication.ID).
		Where("status NOT IN (?)", bun.List([]string{
			models.PostStatusPublished,
			models.PostStatusPublishing,
		})).
		Exec(ctx); err != nil {
		log.Printf(
			"[Publisher] Failed to mark compatibility posts for %s as publishing: %v",
			publication.ID,
			err,
		)
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
	if err := query.Scan(ctx); err != nil {
		return err
	}

	var retryFailure *RetryableError
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
		if err := s.publishRendition(ctx, publication, &rendition); err != nil {
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
			continue
		}
	}

	s.finalizePublication(ctx, publication)
	if retryFailure != nil {
		return retryFailure
	}
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
func (s *Service) publishRendition(ctx context.Context, publication *models.Publication, rendition *models.Rendition) error {
	var segments []models.RenditionSegment
	if err := s.db.NewSelect().
		Model(&segments).
		Where("rendition_id = ?", rendition.ID).
		Order("position ASC").
		Scan(ctx); err == nil && len(segments) > 0 {
		return s.publishRenditionSegments(ctx, publication, rendition, segments)
	} else if err != nil && !isMissingNormalizedSegmentTable(err) {
		return fmt.Errorf("loading rendition segments: %w", err)
	}

	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", rendition.SocialAccountID).Scan(ctx); err != nil {
		return fmt.Errorf("account not found: %v", err)
	}
	provider, providerKey, err := s.providerForAccount(account)
	if err != nil {
		return err
	}
	token, err := s.tm.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("auth error: %v", err)
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
			mediaID, err := s.platformMediaIDForRendition(ctx, rendition, account, provider, token, media)
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
	if err := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); err != nil {
		return err
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, "provider publish started", map[string]any{
		"platform":     rendition.Platform,
		"provider_key": providerKey,
	})
	externalID, err := s.publishProviderWithUsage(
		ctx,
		publication.WorkspaceID,
		account.Platform,
		rendition.ID,
		"publish",
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
		if quotaErr := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); quotaErr != nil {
			return quotaErr
		}
		externalID, err = s.publishProviderWithUsage(
			ctx,
			publication.WorkspaceID,
			account.Platform,
			rendition.ID,
			"publish-token-refresh",
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
	externalURL := ""
	if strings.HasPrefix(externalID, "http://") || strings.HasPrefix(externalID, "https://") {
		externalURL = externalID
	}
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
		Set("updated_at = ?", time.Now().UTC()).
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
	return nil
}

//nolint:gocyclo
func (s *Service) publishRenditionSegments(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	segments []models.RenditionSegment,
) error {
	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", rendition.SocialAccountID).Scan(ctx); err != nil {
		return fmt.Errorf("account not found: %v", err)
	}
	provider, providerKey, err := s.providerForAccount(account)
	if err != nil {
		return err
	}
	token, err := s.tm.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("auth error: %v", err)
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
				mediaID, uploadErr := s.platformMediaIDForRendition(ctx, &uploadRendition, account, provider, token, media)
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
		if err := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); err != nil {
			return s.failRenditionSegment(ctx, segment, err)
		}
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, "rendition segment publish started", map[string]any{
			"platform":     rendition.Platform,
			"provider_key": providerKey,
			"segment_id":   segment.ID,
			"position":     segment.Position,
		})
		externalID, publishErr := s.publishProviderWithUsage(
			ctx,
			publication.WorkspaceID,
			account.Platform,
			segment.ID,
			"publish",
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
			if quotaErr := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); quotaErr != nil {
				return s.failRenditionSegment(ctx, segment, quotaErr)
			}
			externalID, publishErr = s.publishProviderWithUsage(
				ctx,
				publication.WorkspaceID,
				account.Platform,
				segment.ID,
				"publish-token-refresh",
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

		externalURL := publisherExternalURL(externalID)
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
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", rendition.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("updating segmented rendition status: %w", err)
	}
	return nil
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

func (s *Service) publishRenditionReply(ctx context.Context, renditionID, body, parentID string, settings map[string]interface{}) error {
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
	provider, _, err := s.providerForAccount(account)
	if err != nil {
		return err
	}
	token, err := s.tm.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("auth error: %w", err)
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
	if err := s.checkMonthlyQuota(ctx, publication.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); err != nil {
		return err
	}
	_, err = s.publishProviderWithUsage(
		ctx,
		publication.WorkspaceID,
		account.Platform,
		rendition.ID,
		"reply",
		provider,
		token,
		account.AccountID,
		req,
		nil,
	)
	return err
}

func (s *Service) publishSinglePost(ctx context.Context, post *models.Post) error {
	var dests []models.PostDestination
	if err := s.db.NewSelect().Model(&dests).
		Where("post_id = ?", post.ID).
		Where("(status = 'pending' OR (status = 'failed' AND error_retryable = ?))", true).
		Scan(ctx); err != nil {
		return err
	}

	log.Printf("[Publisher] Found %d destinations for post %s", len(dests), post.ID)

	if len(dests) == 0 {
		s.finalizePost(ctx, post)
		return nil
	}
	if err := s.checkMonthlyQuota(ctx, post.WorkspaceID, entitlements.LimitPublishedPostsMonthly); err != nil {
		s.markDestinationsFailed(ctx, dests, err)
		s.finalizePost(ctx, post)
		return nil
	}

	var retryFailure *RetryableError
	for _, dest := range dests {
		log.Printf("[Publisher] Publishing to destination %s (account: %s)", dest.ID, dest.SocialAccountID)
		if err := s.publishToDestination(ctx, post, &dest); err != nil {
			failure := ClassifyFailure(err)
			if failure.Retryable &&
				(retryFailure == nil || failure.RetryAfter > retryFailure.Failure.RetryAfter) {
				retryFailure = &RetryableError{Failure: failure}
			}
			log.Printf("[Publisher] Destination %s failed (%s, status=%d, code=%s)", dest.ID, failure.Kind, failure.HTTPStatus, failure.Code)
			s.markDestinationFailed(ctx, dest, err)
		} else {
			log.Printf("[Publisher] Successfully published to destination %s", dest.ID)
			s.markDestinationSuccess(ctx, dest, true)
		}
	}

	s.finalizePost(ctx, post)
	if retryFailure != nil {
		return retryFailure
	}
	return nil
}

func (s *Service) publishThread(ctx context.Context, posts []*models.Post) error {
	log.Printf("[Publisher] Publishing thread with %d posts", len(posts))

	successfulAccounts := make(map[string]bool)
	var retryFailure *RetryableError

	for i, post := range posts {
		log.Printf("[Publisher] Publishing thread post %d/%d: %s", i+1, len(posts), post.ID)

		dests, err := s.loadThreadDestinations(ctx, post.ID)
		if err != nil {
			log.Printf("[Publisher] Failed to fetch destinations for post %s: %v", post.ID, err)
			s.finalizePost(ctx, post)
			continue
		}

		if i > 0 {
			dests = s.filterThreadDestinationsAfterPreviousPost(ctx, dests, successfulAccounts)
		}

		if len(dests) > 0 {
			if err := s.checkMonthlyQuota(ctx, post.WorkspaceID, entitlements.LimitPublishedPostsMonthly); err != nil {
				s.markDestinationsFailed(ctx, dests, err)
				s.finalizePost(ctx, post)
				successfulAccounts = make(map[string]bool)
				continue
			}
		}

		successfulInThisPost, postRetryFailure := s.publishThreadDestinations(ctx, post, dests)
		if postRetryFailure != nil &&
			(retryFailure == nil ||
				postRetryFailure.Failure.RetryAfter > retryFailure.Failure.RetryAfter) {
			retryFailure = postRetryFailure
		}

		successfulAccounts = make(map[string]bool)
		for _, accountID := range successfulInThisPost {
			successfulAccounts[accountID] = true
		}

		s.finalizePost(ctx, post)
	}

	if retryFailure != nil {
		return retryFailure
	}
	return nil
}

func (s *Service) loadThreadDestinations(ctx context.Context, postID string) ([]models.PostDestination, error) {
	var dests []models.PostDestination
	err := s.db.NewSelect().Model(&dests).
		Where("post_id = ?", postID).
		Where("(status = 'pending' OR (status = 'failed' AND error_retryable = ?))", true).
		Scan(ctx)
	return dests, err
}

func (s *Service) filterThreadDestinationsAfterPreviousPost(ctx context.Context, dests []models.PostDestination, successfulAccounts map[string]bool) []models.PostDestination {
	filteredDests := make([]models.PostDestination, 0, len(dests))
	for _, dest := range dests {
		if successfulAccounts[dest.SocialAccountID] {
			filteredDests = append(filteredDests, dest)
			continue
		}
		if _, dbErr := s.db.NewUpdate().Model(&dest).
			Set("status = ?", "failed").
			Set("error_message = ?", "previous post in thread failed for this account").
			Set("error_kind = ?", FailureValidation).
			Set("error_code = ?", "thread_parent_failed").
			Set("error_http_status = 0").
			Set("error_retryable = ?", false).
			Set("error_retry_at = NULL").
			Set("error_action = ?", FailureActionEdit).
			Where("id = ?", dest.ID).
			Exec(ctx); dbErr != nil {
			log.Printf("[Publisher] Failed to update destination %s status: %v", dest.ID, dbErr)
		}
	}
	return filteredDests
}

func (s *Service) publishThreadDestinations(
	ctx context.Context,
	post *models.Post,
	dests []models.PostDestination,
) ([]string, *RetryableError) {
	var successfulInThisPost []string
	var retryFailure *RetryableError
	for _, dest := range dests {
		if err := s.publishToDestination(ctx, post, &dest); err != nil {
			if errors.Is(err, errLinkedInThreadReplySkipped) {
				s.markDestinationSuccess(ctx, dest, true)
				successfulInThisPost = append(successfulInThisPost, dest.SocialAccountID)
				continue
			}
			failure := ClassifyFailure(err)
			if failure.Retryable &&
				(retryFailure == nil || failure.RetryAfter > retryFailure.Failure.RetryAfter) {
				retryFailure = &RetryableError{Failure: failure}
			}
			log.Printf("[Publisher] Thread post %s destination %s failed (%s, status=%d, code=%s)", post.ID, dest.ID, failure.Kind, failure.HTTPStatus, failure.Code)
			s.markDestinationFailed(ctx, dest, err)
			continue
		}
		s.markDestinationSuccess(ctx, dest, false)
		successfulInThisPost = append(successfulInThisPost, dest.SocialAccountID)
	}
	return successfulInThisPost, retryFailure
}

func (s *Service) finalizePost(ctx context.Context, post *models.Post) {
	var totalDests int
	totalDests, _ = s.db.NewSelect().Model((*models.PostDestination)(nil)).
		Where("post_id = ?", post.ID).
		Count(ctx)

	if totalDests == 0 {
		if _, err := s.db.NewUpdate().Model(post).Set("status = ?", models.PostStatusPublished).Where("id = ?", post.ID).Exec(ctx); err != nil {
			log.Printf("[Publisher] Failed to update post %s status: %v", post.ID, err)
		}
		return
	}

	var failedCount int
	failedCount, _ = s.db.NewSelect().Model((*models.PostDestination)(nil)).
		Where("post_id = ? AND status = 'failed'", post.ID).
		Count(ctx)

	if failedCount > 0 {
		if _, err := s.db.NewUpdate().Model(post).Set("status = ?", "failed").Where("id = ?", post.ID).Exec(ctx); err != nil {
			log.Printf("[Publisher] Failed to update post %s status: %v", post.ID, err)
		}
	} else {
		if _, err := s.db.NewUpdate().Model(post).
			Set("status = ?", models.PostStatusPublished).
			Set("published_at = CURRENT_TIMESTAMP").
			Where("id = ?", post.ID).
			Exec(ctx); err != nil {
			log.Printf("[Publisher] Failed to update post %s status: %v", post.ID, err)
			return
		}
		s.recordPublishedPost(ctx, post.WorkspaceID)
	}
}

//nolint:gocyclo
func (s *Service) publishToDestination(ctx context.Context, post *models.Post, dest *models.PostDestination) error {
	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", dest.SocialAccountID).Scan(ctx); err != nil {
		return fmt.Errorf("account not found: %v", err)
	}

	provider, _, err := s.providerForAccount(account)
	if err != nil {
		return err
	}

	token, err := s.tm.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("auth error: %v", err)
	}

	var mediaAttachments []models.MediaAttachment
	variant, variantErr := s.loadVariant(ctx, post.ID, dest.SocialAccountID)
	if variantErr != nil {
		return variantErr
	}

	// Determine which media to use: variant override or parent post media
	hasExplicitVariantMedia := false
	if variant != nil && variant.IsUnsynced && variant.MediaIDs != "" {
		hasExplicitVariantMedia = true
		var variantMediaIDs []string
		if err := json.Unmarshal([]byte(variant.MediaIDs), &variantMediaIDs); err != nil {
			log.Printf("[Publisher] Failed to unmarshal variant media IDs for %s: %v", variant.ID, err)
			// fallback to parent media if unmarshal fails
			hasExplicitVariantMedia = false
		} else if len(variantMediaIDs) > 0 {
			if err := s.db.NewSelect().
				Model(&mediaAttachments).
				Where("id IN (?)", bun.List(variantMediaIDs)).
				OrderExpr("CASE id " + buildOrderClause(variantMediaIDs) + " END").
				Scan(ctx); err != nil {
				return fmt.Errorf("fetching variant media: %v", err)
			}
		}
	}

	// If no variant media or variant not unsynced, use parent post media
	if !hasExplicitVariantMedia && len(mediaAttachments) == 0 {
		if err := s.db.NewSelect().
			TableExpr("post_media AS pm").
			ColumnExpr("ma.*").
			Join("JOIN media_attachments AS ma ON ma.id = pm.media_id").
			Where("pm.post_id = ?", post.ID).
			Order("pm.display_order ASC").
			Scan(ctx, &mediaAttachments); err != nil {
			return fmt.Errorf("fetching media: %v", err)
		}
	}

	publishContent := post.Content
	if variant != nil && variant.IsUnsynced && variant.Content != "" {
		publishContent = variant.Content
	}

	var platformMediaIDs []string
	var mediaAltTexts []string
	mediaItems := make([]platform.MediaItem, 0, len(mediaAttachments))
	_, publishesMediaDirectly := provider.(platform.DirectMediaPublisher)
	for _, media := range mediaAttachments {
		if !publishesMediaDirectly {
			mediaID, err := s.platformMediaIDForDestination(ctx, post, dest, account, provider, token, media, publishContent)
			if err != nil {
				log.Printf("[Publisher] Failed to upload media %s to %s: %v", media.ID, account.Platform, err)
				return fmt.Errorf("media upload failed for %s: %w", media.ID, err)
			}
			platformMediaIDs = append(platformMediaIDs, mediaID)
		}
		mediaAltTexts = append(mediaAltTexts, media.AltText)
		mediaItems = append(mediaItems, platform.MediaItem{
			ID:               media.ID,
			MimeType:         media.MimeType,
			Size:             media.Size,
			OriginalFilename: media.OriginalFilename,
		})
	}

	replyToID := ""
	if post.ThreadSequence > 0 && post.ParentPostID != "" {
		if s.disableLinkedInThreadReplies && account.Platform == "linkedin" {
			return errLinkedInThreadReplySkipped
		}
		replyToID, _ = s.getPreviousPostExternalID(ctx, post.ID, dest.SocialAccountID)
	}

	req := &platform.PublishRequest{
		Content:          publishContent,
		PlatformMediaIDs: platformMediaIDs,
		MediaAltTexts:    mediaAltTexts,
		Media:            mediaItems,
		ReplyToID:        replyToID,
	}

	if err := s.checkMonthlyQuota(ctx, post.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); err != nil {
		return err
	}
	externalID, err := s.publishProviderWithUsage(
		ctx,
		post.WorkspaceID,
		account.Platform,
		dest.ID,
		"publish",
		provider,
		token,
		account.AccountID,
		req,
		mediaAttachments,
	)
	if err != nil {
		if isExpiredTokenError(err) {
			log.Printf("[Publisher] Token expired for %s account %s, forcing refresh and retry", account.Platform, account.ID)
			refreshedToken, refreshErr := s.tm.ForceRefreshAccessToken(ctx, account.ID)
			if refreshErr != nil {
				return fmt.Errorf("%s token refresh failed after expiry: %w", account.Platform, refreshErr)
			}
			if quotaErr := s.checkMonthlyQuota(ctx, post.WorkspaceID, entitlements.LimitProviderWriteCallsMonthly); quotaErr != nil {
				return quotaErr
			}
			externalID, err = s.publishProviderWithUsage(
				ctx,
				post.WorkspaceID,
				account.Platform,
				dest.ID,
				"publish-token-refresh",
				provider,
				refreshedToken,
				account.AccountID,
				req,
				mediaAttachments,
			)
			if err != nil {
				return err
			}
		} else {
			return err
		}
	}

	if externalID != "" {
		if _, dbErr := s.db.NewUpdate().Model(dest).
			Set("external_id = ?", externalID).
			Where("id = ?", dest.ID).
			Exec(ctx); dbErr != nil {
			log.Printf("[Publisher] Failed to update external_id for destination %s: %v", dest.ID, dbErr)
		}
	}

	return nil
}

func (s *Service) markDestinationsFailed(ctx context.Context, dests []models.PostDestination, cause error) {
	for _, dest := range dests {
		s.markDestinationFailed(ctx, dest, cause)
	}
}

func (s *Service) markDestinationSuccess(ctx context.Context, dest models.PostDestination, clearError bool) {
	query := s.db.NewUpdate().Model(&dest).
		Set("status = ?", "success").
		Set("error_kind = ''").
		Set("error_code = ''").
		Set("error_http_status = 0").
		Set("error_retryable = ?", false).
		Set("error_retry_at = NULL").
		Set("error_action = ''").
		Where("id = ?", dest.ID)
	if clearError {
		query = query.Set("error_message = ?", "")
	}
	if _, dbErr := query.Exec(ctx); dbErr != nil {
		log.Printf("[Publisher] Failed to update destination %s status: %v", dest.ID, dbErr)
	}
}

func (s *Service) markDestinationFailed(ctx context.Context, dest models.PostDestination, cause error) {
	failure := ClassifyFailure(cause)
	var retryAt any
	if failure.Retryable {
		delay := failure.RetryAfter
		if delay <= 0 {
			delay = RetryDelay(1, 0, 0)
		}
		retryAt = time.Now().UTC().Add(delay)
	}
	query := s.db.NewUpdate().Model(&dest).
		Set("status = ?", "failed").
		Set("error_message = ?", failure.Message).
		Set("error_kind = ?", failure.Kind).
		Set("error_code = ?", failure.Code).
		Set("error_http_status = ?", failure.HTTPStatus).
		Set("error_retryable = ?", failure.Retryable).
		Set("error_action = ?", failure.Action).
		Where("id = ?", dest.ID)
	if retryAt == nil {
		query = query.Set("error_retry_at = NULL")
	} else {
		query = query.Set("error_retry_at = ?", retryAt)
	}
	if _, dbErr := query.Exec(ctx); dbErr != nil {
		log.Printf("[Publisher] Failed to update destination %s status: %v", dest.ID, dbErr)
	}
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
func (s *Service) platformMediaIDForDestination(ctx context.Context, post *models.Post, dest *models.PostDestination, account *models.SocialAccount, provider platform.Adapter, token string, media models.MediaAttachment, content string) (string, error) {
	if requiresPublicMedia(account.Platform, "") {
		return s.uploadMediaToPlatform(ctx, account, provider, token, media, content)
	}

	return s.cachedPlatformMediaID(ctx, media.ID,
		func() (string, error) {
			return s.loadReadyProviderMediaState(ctx, post.ID, dest.SocialAccountID, media.ID)
		},
		func() (string, error) {
			return s.uploadMediaToPlatform(ctx, account, provider, token, media, content)
		},
		func(platformMediaID, status, errorMessage string) error {
			return s.saveProviderMediaState(ctx, post.ID, dest.SocialAccountID, media.ID, account.Platform, platformMediaID, status, errorMessage)
		})
}

//nolint:dupl
func (s *Service) platformMediaIDForRendition(ctx context.Context, rendition *models.Rendition, account *models.SocialAccount, provider platform.Adapter, token string, media models.MediaAttachment) (string, error) {
	if requiresPublicMedia(account.Platform, rendition.Profile) {
		return s.uploadRenditionMediaToPlatform(ctx, account, provider, token, rendition, media)
	}

	return s.cachedPlatformMediaID(ctx, media.ID,
		func() (string, error) {
			return s.loadReadyProviderMediaStateForRendition(ctx, rendition.ID, rendition.SocialAccountID, media.ID)
		},
		func() (string, error) {
			return s.uploadRenditionMediaToPlatform(ctx, account, provider, token, rendition, media)
		},
		func(platformMediaID, status, errorMessage string) error {
			return s.saveProviderMediaStateForRendition(ctx, rendition.ID, rendition.SocialAccountID, media.ID, account.Platform, platformMediaID, status, errorMessage)
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

func (s *Service) loadReadyProviderMediaStateForRendition(ctx context.Context, renditionID, socialAccountID, mediaID string) (string, error) {
	return s.loadReadyProviderMediaStateByKey(ctx, "rendition_id", renditionID, socialAccountID, mediaID)
}

func (s *Service) saveProviderMediaStateForRendition(ctx context.Context, renditionID, socialAccountID, mediaID, platformName, platformMediaID, status, errorMessage string) error {
	now := time.Now().UTC()
	state := &models.ProviderMediaState{
		PostID:          renditionID,
		RenditionID:     renditionID,
		SocialAccountID: socialAccountID,
		MediaID:         mediaID,
		Platform:        platformName,
		PlatformMediaID: platformMediaID,
		Status:          status,
		ErrorMessage:    errorMessage,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err := s.db.NewInsert().
		Model(state).
		On("CONFLICT (post_id, social_account_id, media_id) DO UPDATE").
		Set("rendition_id = EXCLUDED.rendition_id").
		Set("platform = EXCLUDED.platform").
		Set("platform_media_id = EXCLUDED.platform_media_id").
		Set("status = EXCLUDED.status").
		Set("error_message = EXCLUDED.error_message").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Service) loadReadyProviderMediaState(ctx context.Context, postID, socialAccountID, mediaID string) (string, error) {
	return s.loadReadyProviderMediaStateByKey(ctx, "post_id", postID, socialAccountID, mediaID)
}

func (s *Service) loadReadyProviderMediaStateByKey(ctx context.Context, keyColumn, keyValue, socialAccountID, mediaID string) (string, error) {
	var state models.ProviderMediaState
	if err := s.db.NewSelect().
		Model(&state).
		Column("platform_media_id").
		Where(keyColumn+" = ?", keyValue).
		Where("social_account_id = ?", socialAccountID).
		Where("media_id = ?", mediaID).
		Where("status = ?", providerMediaStatusReady).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("loading provider media state: %w", err)
	}
	return state.PlatformMediaID, nil
}

func (s *Service) saveProviderMediaState(ctx context.Context, postID, socialAccountID, mediaID, platformName, platformMediaID, status, errorMessage string) error {
	now := time.Now().UTC()
	state := &models.ProviderMediaState{
		PostID:          postID,
		SocialAccountID: socialAccountID,
		MediaID:         mediaID,
		Platform:        platformName,
		PlatformMediaID: platformMediaID,
		Status:          status,
		ErrorMessage:    errorMessage,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err := s.db.NewInsert().
		Model(state).
		On("CONFLICT (post_id, social_account_id, media_id) DO UPDATE").
		Set("platform = EXCLUDED.platform").
		Set("platform_media_id = EXCLUDED.platform_media_id").
		Set("status = EXCLUDED.status").
		Set("error_message = EXCLUDED.error_message").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Service) publishProvider(
	ctx context.Context,
	provider platform.Adapter,
	token, accountID string,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (string, error) {
	direct, ok := provider.(platform.DirectMediaPublisher)
	if !ok || len(media) == 0 {
		return provider.Publish(ctx, token, accountID, req)
	}
	if s.storage == nil {
		return "", fmt.Errorf("media storage is not configured")
	}

	inputs := make([]platform.UploadMediaRequest, 0, len(media))
	readers := make([]io.ReadCloser, 0, len(media))
	closeReaders := func() {
		for _, reader := range readers {
			_ = reader.Close()
		}
	}
	for _, item := range media {
		reader, err := s.storage.Open(filepath.Base(item.FilePath))
		if err != nil {
			closeReaders()
			return "", fmt.Errorf("opening media file %s: %w", item.FilePath, err)
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

func (s *Service) publishProviderWithUsage(
	ctx context.Context,
	workspaceID, providerName, subject, phase string,
	provider platform.Adapter,
	token, accountID string,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (string, error) {
	reservation, err := s.reserveProviderPublishCost(ctx, workspaceID, providerName, subject, phase, req)
	if err != nil {
		return "", err
	}
	s.recordProviderWriteCall(ctx, workspaceID)
	externalID, publishErr := s.publishProvider(ctx, provider, token, accountID, req, media)
	s.settleProviderPublishCost(ctx, reservation, publishErr)
	return externalID, publishErr
}

func (s *Service) uploadMediaToPlatform(ctx context.Context, account *models.SocialAccount, provider platform.Adapter, token string, media models.MediaAttachment, content string) (string, error) {
	if requiresPublicMedia(account.Platform, "") {
		return s.getPublicMediaURL(media), nil
	}

	if s.storage == nil {
		return "", fmt.Errorf("media storage is not configured")
	}
	data, err := s.storage.Open(filepath.Base(media.FilePath))
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

	return provider.UploadMedia(ctx, token, account.AccountID, media.MimeType, data)
}

func (s *Service) uploadRenditionMediaToPlatform(ctx context.Context, account *models.SocialAccount, provider platform.Adapter, token string, rendition *models.Rendition, media models.MediaAttachment) (string, error) {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)

	if requiresPublicMedia(account.Platform, rendition.Profile) && !usesTikTokFileUpload(account.Platform, settings) {
		return s.getPublicMediaURL(media), nil
	}
	if s.storage == nil {
		return "", fmt.Errorf("media storage is not configured")
	}
	data, err := s.storage.Open(filepath.Base(media.FilePath))
	if err != nil {
		return "", fmt.Errorf("opening media file %s: %w", media.FilePath, err)
	}
	defer data.Close()

	if uploader, ok := provider.(platform.MetadataMediaUploader); ok {
		thumbnail, thumbnailReader, err := s.openThumbnailFromSettings(ctx, settings)
		if err != nil {
			return "", err
		}
		if thumbnailReader != nil {
			defer thumbnailReader.Close()
		}
		caption, captionReader, err := s.openSettingMedia(ctx, settings, "caption_media_id", "")
		if err != nil {
			return "", err
		}
		if captionReader != nil {
			defer captionReader.Close()
		}
		req := platform.UploadMediaRequest{
			MimeType:    media.MimeType,
			Filename:    firstNonEmptyPublisherString(media.OriginalFilename, filepath.Base(media.FilePath)),
			Size:        media.Size,
			Title:       firstNonEmptyPublisherString(rendition.Title, firstContentLine(rendition.Body)),
			Description: strings.TrimSpace(firstNonEmptyPublisherString(rendition.Description, rendition.Body)),
			Settings:    settings,
			Reader:      data,
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
		return uploader.UploadMediaWithMetadata(ctx, token, account.AccountID, req)
	}

	return provider.UploadMedia(ctx, token, account.AccountID, media.MimeType, data)
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
	reader, err := s.storage.Open(filepath.Base(thumbnail.FilePath))
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
	reader, err := s.storage.Open(filepath.Base(media.FilePath))
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

func (s *Service) providerForAccount(account *models.SocialAccount) (platform.Adapter, string, error) {
	providerKey := account.Platform
	if account.Platform == "mastodon" {
		providerKey = "mastodon:" + account.InstanceURL
	}
	s.providerMu.RLock()
	provider, ok := s.providers[providerKey]
	s.providerMu.RUnlock()
	if !ok {
		return nil, providerKey, fmt.Errorf("unsupported platform: %s (instance: %s)", account.Platform, account.InstanceURL)
	}
	return provider, providerKey, nil
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
	postStatus := models.PostStatusScheduled
	switch status {
	case models.PublicationStatusPublished:
		postStatus = models.PostStatusPublished
	case models.PublicationStatusFailed:
		postStatus = models.PostStatusFailed
	}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", status).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(txCtx); err != nil {
			return err
		}
		query := tx.NewUpdate().
			Model((*models.Post)(nil)).
			Set("status = ?", postStatus).
			Where("publication_id = ?", publication.ID)
		if postStatus == models.PostStatusPublished {
			query = query.Set("published_at = ?", now)
		}
		if _, err := query.Exec(txCtx); err != nil {
			return err
		}
		if err := s.syncPublicationPostDestinations(txCtx, tx, publication.ID, renditions); err != nil {
			return err
		}
		return s.createPublicationResultNotifications(txCtx, tx, publication, status, renditions)
	})
	if err != nil {
		log.Printf("[Publisher] Failed to finalize publication %s: %v", publication.ID, err)
	}
}

func (s *Service) syncPublicationPostDestinations(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
	renditions []models.Rendition,
) error {
	postIDs := db.NewSelect().
		Model((*models.Post)(nil)).
		Column("id").
		Where("publication_id = ?", publicationID)
	for _, rendition := range renditions {
		status := "pending"
		switch rendition.Status {
		case models.RenditionStatusPublished:
			status = "success"
		case models.RenditionStatusFailed:
			status = "failed"
		}
		query := db.NewUpdate().
			Model((*models.PostDestination)(nil)).
			Set("status = ?", status).
			Set("external_id = ?", rendition.ExternalID).
			Set("error_message = ?", rendition.ErrorMessage).
			Set("error_kind = ?", rendition.ErrorKind).
			Set("error_code = ?", rendition.ErrorCode).
			Set("error_http_status = ?", rendition.ErrorHTTPStatus).
			Set("error_retryable = ?", rendition.ErrorRetryable).
			Set("error_action = ?", rendition.ErrorAction).
			Where("post_id IN (?)", postIDs).
			Where("social_account_id = ?", rendition.SocialAccountID)
		if rendition.ErrorRetryAt.IsZero() {
			query = query.Set("error_retry_at = NULL")
		} else {
			query = query.Set("error_retry_at = ?", rendition.ErrorRetryAt)
		}
		if _, err := query.Exec(ctx); err != nil {
			return err
		}
	}
	return nil
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
	input, ok := publicationResultNotificationInput(
		publication,
		status,
		result,
		publicationNotificationCohort(ctx, publication),
	)
	if !ok {
		return nil
	}
	if err := s.notifications.CreateWithDB(ctx, db, input); err != nil {
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
	failureActions   []string
	retryable        bool
	reconnect        bool
	retryAt          time.Time
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
		failureActions:   make([]string, 0, len(renditions)),
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
		result.failureActions = append(result.failureActions, rendition.ErrorAction)
		result.retryable = result.retryable || rendition.ErrorRetryable
		result.reconnect = result.reconnect || rendition.ErrorAction == FailureActionReconnect
		if !rendition.ErrorRetryAt.IsZero() &&
			(result.retryAt.IsZero() || rendition.ErrorRetryAt.Before(result.retryAt)) {
			result.retryAt = rendition.ErrorRetryAt
		}
	}
}

func publicationResultNotificationInput(
	publication *models.Publication,
	status string,
	result publicationNotificationResult,
	dedupCohort string,
) (notifications.CreateInput, bool) {
	input := notifications.CreateInput{
		UserID:      publication.CreatedByID,
		WorkspaceID: publication.WorkspaceID,
		Href:        "/activity?publication=" + publication.ID,
		Payload: map[string]any{
			"publication_id":          publication.ID,
			"successful_destinations": result.successful,
			"failed_destinations":     result.failed,
			"failure_actions":         result.failureActions,
		},
		Actions: []models.NotificationAction{{
			Label: "View results", Href: "/activity?publication=" + publication.ID, Kind: "secondary",
		}},
	}
	if !result.retryAt.IsZero() {
		input.Payload["retry_at"] = result.retryAt.UTC().Format(time.RFC3339)
	}
	if status == models.PublicationStatusPublished {
		input.Type = notifications.TypePostPublished
		input.Title = "Publication completed"
		input.Body = publishedDestinationSummary(result.successful)
		input.DedupKey = fmt.Sprintf("publication:%s:%s:published", publication.ID, dedupCohort)
		return input, true
	}
	if status != models.PublicationStatusFailed {
		return notifications.CreateInput{}, false
	}
	input.Type = notifications.TypePublishFailed
	input.Title = publicationFailureTitle(result.successful, result.failed)
	input.Body = publicationFailureSummary(result.successful, result.failed, result.retryAt)
	input.DedupKey = fmt.Sprintf("publication:%s:%s:failed", publication.ID, dedupCohort)
	input.Actions = append(
		[]models.NotificationAction{publicationFailurePrimaryAction(publication.ID, result)},
		input.Actions...,
	)
	return input, true
}

func publicationNotificationCohort(ctx context.Context, publication *models.Publication) string {
	execution, _ := ctx.Value(jobExecutionContextKey{}).(jobExecution)
	if execution.ID != "" {
		return "job:" + execution.ID
	}
	return fmt.Sprintf("revision:%d", publication.Revision)
}

func publicationFailurePrimaryAction(
	publicationID string,
	result publicationNotificationResult,
) models.NotificationAction {
	if result.reconnect {
		return models.NotificationAction{Label: "Reconnect account", Href: "/accounts", Kind: "primary"}
	}
	if result.retryable {
		return models.NotificationAction{
			Label: "Retry failed destinations", Kind: "primary",
			Operation: "retry_failed_publication", TargetID: publicationID,
		}
	}
	return models.NotificationAction{
		Label: "Edit publication", Href: "/publications/" + publicationID, Kind: "primary",
	}
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
		if err := s.notifications.CreateWithDB(ctx, db, notifications.CreateInput{
			UserID:      publication.CreatedByID,
			WorkspaceID: publication.WorkspaceID,
			Type:        notifications.TypeAccountNeedsAttention,
			Title:       publisherProviderLabel(account.Platform) + " needs to be reconnected",
			Body:        "Publishing is paused for " + publisherAccountLabel(account) + " until it is reconnected.",
			Href:        "/accounts",
			DedupKey: fmt.Sprintf(
				"account:%s:publication:%s:revision:%d:reconnect",
				account.ID,
				publication.ID,
				publication.Revision,
			),
			Payload: map[string]any{"social_account_id": account.ID, "publication_id": publication.ID},
			Actions: []models.NotificationAction{{
				Label: "Reconnect account", Href: "/accounts", Kind: "primary",
			}},
		}); err != nil {
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

func summarizedDestinations(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	case 2:
		return items[0] + " and " + items[1]
	default:
		return strings.Join(items[:2], ", ") + fmt.Sprintf(" and %d more", len(items)-2)
	}
}

func publishedDestinationSummary(successful []string) string {
	if len(successful) == 0 {
		return "The publication completed."
	}
	return summarizedDestinations(successful) + " published successfully."
}

func publicationFailureTitle(successful, failed []string) string {
	if len(successful) > 0 && len(failed) > 0 {
		return "Publication partially completed"
	}
	return "Publication needs attention"
}

func publicationFailureSummary(successful, failed []string, retryAt time.Time) string {
	parts := make([]string, 0, 3)
	if len(failed) > 0 {
		parts = append(parts, summarizedDestinations(failed)+" failed.")
	}
	if len(successful) > 0 {
		parts = append(parts, summarizedDestinations(successful)+" published successfully.")
	}
	if !retryAt.IsZero() {
		parts = append(parts, "OpenPost will not retry before "+retryAt.UTC().Format("15:04 UTC")+".")
	}
	if len(parts) == 0 {
		return "One or more destinations need attention."
	}
	return strings.Join(parts, " ")
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

func (s *Service) loadVariant(ctx context.Context, postID, socialAccountID string) (*models.PostVariant, error) {
	var variant models.PostVariant
	if err := s.db.NewSelect().Model(&variant).
		Where("post_id = ? AND social_account_id = ?", postID, socialAccountID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("fetching post variant: %w", err)
	}

	return &variant, nil
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

func (s *Service) getPreviousPostExternalID(ctx context.Context, currentPostID, socialAccountID string) (string, error) {
	var parentPost models.Post
	if err := s.db.NewSelect().Model(&parentPost).
		Where("id = (SELECT parent_post_id FROM posts WHERE id = ?)", currentPostID).
		Scan(ctx); err != nil {
		return "", fmt.Errorf("finding parent post: %w", err)
	}

	var parentDest models.PostDestination
	if err := s.db.NewSelect().Model(&parentDest).
		Where("post_id = ? AND social_account_id = ?", parentPost.ID, socialAccountID).
		Scan(ctx); err != nil {
		return "", fmt.Errorf("finding parent destination: %w", err)
	}

	return parentDest.ExternalID, nil
}

func buildOrderClause(ids []string) string {
	if len(ids) == 0 {
		return ""
	}
	var sb strings.Builder
	for i, id := range ids {
		// Escape single quotes just in case, though these should be UUIDs
		safeID := strings.ReplaceAll(id, "'", "''")
		fmt.Fprintf(&sb, "WHEN '%s' THEN %d ", safeID, i)
	}
	return sb.String()
}
