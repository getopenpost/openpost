package publisher

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/openpost/backend/internal/textutil"
	"github.com/uptrace/bun"
)

// publishRendition plans and delivers one rendition. A panic is recovered into
// a durable outcome that never permits a second unprotected send.
func (s *Service) publishRendition(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = s.recoverRenditionPanic(ctx, rendition.ID, authorization, &diagnostics.PanicError{
				Recovered: recovered, Frames: diagnostics.CaptureFrames(2),
			})
		}
	}()
	plan, err := s.buildDeliveryPlan(ctx, publication, rendition, authorization, intent)
	if err != nil {
		return err
	}
	return s.executePlan(ctx, plan)
}

// executePlan delivers a validated plan in order. Each output replies to the
// previous one; already published outputs are reused as thread parents.
func (s *Service) executePlan(ctx context.Context, plan *deliveryPlan) error {
	publication, rendition := plan.publication, plan.rendition
	parentExternalID, rootExternalID, rootExternalURL := "", "", ""
	var lastScope providerWriteScope
	for i := range plan.segments {
		segment := &plan.segments[i]
		if segment.published() {
			if rootExternalID == "" {
				rootExternalID, rootExternalURL = segment.row.ExternalID, segment.row.ExternalURL
				if err := s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
					return saveRenditionExternalIdentity(ctx, tx, rendition.ID, rootExternalID, rootExternalURL)
				}); err != nil {
					return err
				}
			}
			parentExternalID = segment.row.ExternalID
			continue
		}
		scope := plan.writeScope(segment.id, "publish")
		result, err := s.publishPreparedSegment(ctx, plan, segment, scope, parentExternalID)
		if err != nil {
			return s.persistRenditionSegmentOutcome(ctx, segment.row, err)
		}
		externalID := result.ExternalID
		externalURL := textutil.FirstNonEmptyRaw(result.ExternalURL, publisherExternalURL(externalID))
		if !plan.legacy {
			if err := s.completeSegment(ctx, rendition.ID, segment.id, externalID, externalURL, rootExternalID == ""); err != nil {
				return err
			}
			s.recordPublishedPost(ctx, publication.WorkspaceID, scope.operationID)
			s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventPublished, lifecycle.StatusSucceeded, "rendition segment published", map[string]any{
				"platform":     rendition.Platform,
				"segment_id":   segment.id,
				"position":     segment.row.Position,
				"external_id":  externalID,
				"external_url": externalURL,
			})
		}
		if rootExternalID == "" {
			rootExternalID, rootExternalURL = externalID, externalURL
		}
		parentExternalID = externalID
		lastScope = scope
	}

	publishedAt := time.Now().UTC()
	if err := s.completeRendition(ctx, publication, rendition, rootExternalID, rootExternalURL, publishedAt); err != nil {
		return err
	}
	var properties map[string]any
	if plan.legacy {
		s.recordPublishedPost(ctx, publication.WorkspaceID, lastScope.operationID)
	} else {
		properties = map[string]any{"segment_count": len(plan.segments)}
	}
	s.captureRenditionEvent(ctx, telemetry.EventRenditionPublished, publication, rendition, properties, rendition.ID, publishedAt)
	s.scheduleReposts(ctx, rendition.ID)
	s.publishFirstCommentBestEffort(ctx, plan.deliveryTarget, rootExternalID, firstCommentSettingsForSegments(plan.baseSettings, plan.segments))
	return nil
}

// publishPreparedSegment uploads one output's media and sends it.
func (s *Service) publishPreparedSegment(
	ctx context.Context,
	plan *deliveryPlan,
	segment *preparedSegment,
	scope providerWriteScope,
	replyToID string,
) (platform.PublishResult, error) {
	publication, rendition, account := plan.publication, plan.rendition, plan.account
	settings := segment.settings
	if err := s.hydratePublicSettingMediaURLs(ctx, publication.WorkspaceID, account.Platform, settings); err != nil {
		return platform.PublishResult{}, err
	}
	upload := *rendition
	upload.Title, upload.Body, upload.Description, upload.SettingsJSON = segment.title, segment.body, segment.description, mustPublisherJSON(settings)
	target := mediaUploadTarget{publication: publication, rendition: &upload, account: account, provider: plan.provider}
	_, publishesMediaDirectly := plan.provider.(platform.DirectMediaPublisher)
	platformMediaIDs := make([]string, 0, len(segment.media))
	mediaItems := make([]platform.MediaItem, 0, len(segment.media))
	for _, media := range segment.media {
		message, metadata := "media upload started", map[string]any{"platform": rendition.Platform, "media_id": media.ID}
		if !plan.legacy {
			message, metadata["segment_id"] = "segment media upload started", segment.id
		}
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventUploadStarted, lifecycle.StatusStarted, message, metadata)
		if !publishesMediaDirectly {
			var mediaID string
			err := s.withFreshToken(ctx, plan.deliveryTarget, func(token string, _ bool) error {
				target.token = token
				var uploadErr error
				mediaID, uploadErr = s.platformMediaID(ctx, &target, media)
				return uploadErr
			})
			if err != nil {
				return platform.PublishResult{}, fmt.Errorf("media upload failed for %s: %w", media.ID, err)
			}
			platformMediaIDs = append(platformMediaIDs, mediaID)
		}
		mediaItems = append(mediaItems, platform.MediaItem{
			ID:               media.ID,
			MimeType:         media.MimeType,
			Size:             media.Size,
			Width:            media.Width,
			Height:           media.Height,
			DurationMS:       media.DurationMS,
			OriginalFilename: media.OriginalFilename,
		})
	}

	message, metadata := "provider publish started", map[string]any{"platform": rendition.Platform, "provider_key": plan.providerKey}
	if !plan.legacy {
		if err := s.markDeliveryPublishing(ctx, (*models.RenditionSegment)(nil), segment.id); err != nil {
			return platform.PublishResult{}, err
		}
		message, metadata["segment_id"], metadata["position"] = "rendition segment publish started", segment.id, segment.row.Position
	}
	req := &platform.PublishRequest{
		Content:          segment.body,
		RenditionID:      rendition.ID,
		Profile:          rendition.Profile,
		OutputProfile:    rendition.OutputProfile,
		Title:            segment.title,
		Description:      segment.description,
		SettingsJSON:     mustPublisherJSON(settings),
		Settings:         settings,
		PlatformMediaIDs: platformMediaIDs,
		MediaAltTexts:    segment.altTexts,
		MediaSettings:    segment.mediaSettings,
		Media:            mediaItems,
		ReplyToID:        replyToID,
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, message, metadata)
	var result platform.PublishResult
	err := s.withFreshToken(ctx, plan.deliveryTarget, func(token string, refreshed bool) error {
		phase := "publish"
		if refreshed {
			phase = "publish-token-refresh"
			s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventUploadResumed, lifecycle.StatusStarted, "provider publish retried after token refresh", map[string]any{
				"platform":     rendition.Platform,
				"provider_key": plan.providerKey,
			})
		}
		var publishErr error
		result, publishErr = s.publishProviderWithUsage(ctx, publication.WorkspaceID, account.Platform, segment.id, phase, scope, plan.provider, token, account.AccountID, req, segment.media)
		return publishErr
	})
	return result, err
}

func (s *Service) publishRenditionReply(
	ctx context.Context,
	renditionID, body, parentID string,
	settings map[string]interface{},
	authorization *models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
) error {
	rendition := new(models.Rendition)
	if err := s.db.NewSelect().Model(rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return fmt.Errorf("rendition not found: %w", err)
	}
	publication := new(models.Publication)
	if err := s.db.NewSelect().Model(publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return fmt.Errorf("publication not found: %w", err)
	}
	req := &platform.PublishRequest{
		Content:       body,
		Profile:       rendition.Profile,
		OutputProfile: rendition.OutputProfile,
		Title:         rendition.Title,
		Description:   rendition.Description,
		Settings:      settings,
		SettingsJSON:  mustPublisherJSON(settings),
		ReplyToID:     textutil.FirstNonEmptyRaw(parentID, rendition.ExternalID),
	}
	if req.ReplyToID == "" {
		return fmt.Errorf("reply requires a parent external id")
	}
	target, err := s.resolveDeliveryTarget(ctx, publication, rendition, authorization, intent)
	if err != nil {
		return err
	}
	scope := target.writeScope(rendition.ID, "reply")
	return s.withFreshToken(ctx, target, func(token string, refreshed bool) error {
		phase := "reply"
		if refreshed {
			phase = "reply-token-refresh"
		}
		_, publishErr := s.publishProviderWithUsage(ctx, publication.WorkspaceID, target.account.Platform, rendition.ID, phase, scope, target.provider, token, target.account.AccountID, req, nil)
		return publishErr
	})
}

// withFreshToken runs a provider call and, when the provider reports an
// expired OAuth token, refreshes the credential once and repeats the call.
// Later calls on the same target use the refreshed token.
func (s *Service) withFreshToken(ctx context.Context, target *deliveryTarget, call func(token string, refreshed bool) error) error {
	err := call(target.token, false)
	if err == nil || !target.refreshable || !isExpiredTokenError(err) {
		return err
	}
	token, refreshErr := s.tm.ForceRefreshAccessToken(ctx, target.account.ID)
	if refreshErr != nil {
		return &credentialError{operation: target.providerKey + " token refresh failed after expiry", cause: refreshErr}
	}
	target.token = token
	return call(token, true)
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

func validatePublishingTarget(
	ctx context.Context,
	provider platform.Publisher,
	accessToken, accountID string,
	settings map[string]interface{},
) error {
	validator, ok := provider.(platform.PublishingTargetValidator)
	if !ok {
		return nil
	}
	if err := validator.ValidatePublishingTarget(ctx, accessToken, accountID, settings); err != nil {
		return fmt.Errorf("publishing target validation failed: %w", err)
	}
	return nil
}
