package publisher

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
)

// firstCommentSettingsForSegments resolves the follow-up comment settings.
// first_comment is segment-scoped, so the root output owns the child
// operation; destination settings remain the fallback.
func firstCommentSettingsForSegments(destination map[string]interface{}, segments []preparedSegment) map[string]interface{} {
	if len(segments) == 0 {
		return destination
	}
	root := segments[0]
	if root.settings != nil {
		return root.settings
	}
	settings := map[string]interface{}{}
	if root.row != nil {
		_ = json.Unmarshal([]byte(root.row.SettingsJSON), &settings)
	}
	return mergePublisherSettings(destination, settings)
}

// publishFirstCommentBestEffort posts the configured first comment as a
// post-success child operation. The parent rendition is already persisted as
// published; a comment failure records its own outcome and never fails or
// republishes the parent.
func (s *Service) publishFirstCommentBestEffort(
	ctx context.Context,
	target *deliveryTarget,
	externalID string,
	settings map[string]interface{},
) {
	publication, rendition := target.publication, target.rendition
	platformName := rendition.Platform
	message := platform.FirstCommentMessage(platformName, settings)
	if strings.TrimSpace(message) == "" || strings.TrimSpace(externalID) == "" {
		return
	}
	poster, ok := target.provider.(platform.FirstCommentPoster)
	if !ok {
		return
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventProviderProcessing, lifecycle.StatusStarted, "first comment publish started", map[string]any{
		"platform":           platformName,
		"provider_key":       platformName,
		"parent_external_id": externalID,
	})
	var commentID string
	err := s.withFreshToken(ctx, target, func(token string, _ bool) error {
		if reviewErr := publicationauth.RequireReview(ctx, s.db, publication.ID); reviewErr != nil {
			return reviewErr
		}
		if leaseErr := providerwrite.RequireCurrentJobExecution(ctx, s.db, ""); leaseErr != nil {
			return leaseErr
		}
		var postErr error
		commentID, postErr = poster.PostFirstComment(ctx, token, target.account.AccountID, externalID, message)
		return postErr
	})
	if err != nil {
		log.Printf("[Publisher] first comment for rendition %s failed: %v", rendition.ID, err)
		s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventModerationActionFailed, lifecycle.StatusFailed, "first comment publish failed", map[string]any{
			"platform":     platformName,
			"provider_key": platformName,
			"error":        err.Error(),
		})
		return
	}
	s.recordPublicationLifecycleEvent(ctx, publication.WorkspaceID, publication.ID, rendition.ID, lifecycle.EventCommentActionSucceeded, lifecycle.StatusSucceeded, "first comment published", map[string]any{
		"platform":            platformName,
		"provider_key":        platformName,
		"comment_external_id": commentID,
	})
}
