package publisher

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
)

// firstCommentSettingsForSegments resolves the follow-up comment settings for a
// segmented rendition. first_comment is segment-scoped, so the root segment
// owns the child operation; destination settings remain the fallback.
func firstCommentSettingsForSegments(destination map[string]interface{}, segments []models.RenditionSegment) map[string]interface{} {
	if len(segments) == 0 {
		return destination
	}
	root := map[string]interface{}{}
	_ = json.Unmarshal([]byte(segments[0].SettingsJSON), &root)
	return mergePublisherSettings(destination, root)
}

// firstCommentMessageForPublish resolves the configured follow-up comment for
// one published rendition. Empty means no child operation is required.
func firstCommentMessageForPublish(provider string, settings map[string]interface{}) string {
	return platform.FirstCommentMessage(provider, settings)
}

// publishFirstCommentBestEffort posts the configured first comment as a
// post-success child operation. The parent rendition is already persisted as
// published; a comment failure records its own outcome and never fails or
// republishes the parent.
func (s *Service) publishFirstCommentBestEffort(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	provider platform.Publisher,
	token, accountID, externalID string,
	settings map[string]interface{},
) {
	if publication == nil || rendition == nil {
		return
	}
	providerKey := ""
	platformName := ""
	if rendition.Platform != "" {
		platformName = rendition.Platform
		providerKey = rendition.Platform
	}
	message := firstCommentMessageForPublish(platformName, settings)
	if strings.TrimSpace(message) == "" || strings.TrimSpace(externalID) == "" {
		return
	}
	poster, ok := provider.(platform.FirstCommentPoster)
	if !ok {
		return
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, "first comment publish started", map[string]any{
		"platform":           platformName,
		"provider_key":       providerKey,
		"parent_external_id": externalID,
	})
	commentID, err := poster.PostFirstComment(ctx, token, accountID, externalID, message)
	if err != nil {
		log.Printf("[Publisher] first comment for rendition %s failed: %v", rendition.ID, err)
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventModerationActionFailed, lifecycle.StatusFailed, "first comment publish failed", map[string]any{
			"platform":     platformName,
			"provider_key": providerKey,
			"error":        err.Error(),
		})
		return
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventCommentActionSucceeded, lifecycle.StatusSucceeded, "first comment published", map[string]any{
		"platform":            platformName,
		"provider_key":        providerKey,
		"comment_external_id": commentID,
	})
}
