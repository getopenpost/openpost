package handlers

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	repostservice "github.com/openpost/backend/internal/services/reposts"
)

func publicationResponse(publication *models.Publication, media []MediaSummary) PublicationResponse {
	metadata := map[string]any{}
	_ = json.Unmarshal([]byte(publication.MetadataJSON), &metadata)
	return PublicationResponse{
		ID:             publication.ID,
		WorkspaceID:    publication.WorkspaceID,
		CreatedByID:    publication.CreatedByID,
		Title:          publication.Title,
		Intent:         publicationFirstNonEmpty(publication.Intent, publishingIntentForProfile(publication.ContentProfile)),
		CreationPreset: publicationFirstNonEmpty(publication.CreationPreset, publication.Intent, publishingIntentForProfile(publication.ContentProfile)),
		CreationSource: publicationFirstNonEmpty(publication.CreationSource, publicationCreationSourceUnknown),
		SocialSetID:    publication.SocialSetID,
		ContentProfile: publication.ContentProfile,
		SourceText:     publication.SourceText,
		SourceURL:      publication.SourceURL,
		Goal:           publication.Goal,
		Audience:       publication.Audience,
		Status:         publication.Status,
		Revision:       publication.Revision,
		ReviewID:       publication.ReviewID, ReviewEpoch: publication.ReviewEpoch, ReviewState: publication.ReviewState,
		ScheduledAt:          formatOptionalTime(publication.ScheduledAt),
		ActualRunAt:          formatOptionalTime(publication.ActualRunAt),
		FailureDismissedAt:   formatOptionalTime(publication.FailureDismissedAt),
		RandomDelayMinutes:   publication.RandomDelayMinutes,
		RandomDelayInherited: !publication.RandomDelayExplicit,
		Metadata:             metadata,
		RepostOverride:       repostservice.DecodeOverride(publication.RepostOverride),
		CreatedAt:            publication.CreatedAt.Format(time.RFC3339),
		UpdatedAt:            publication.UpdatedAt.Format(time.RFC3339),
		Media:                media,
	}
}

func renditionResponse(rendition models.Rendition, media []MediaSummary) RenditionResponse {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)
	return RenditionResponse{
		ID:               rendition.ID,
		PublicationID:    rendition.PublicationID,
		SocialAccountID:  rendition.SocialAccountID,
		TargetKey:        rendition.TargetKey,
		Platform:         rendition.Platform,
		Profile:          rendition.Profile,
		OutputProfile:    publicationFirstNonEmpty(rendition.OutputProfile, rendition.Platform+".post"),
		FormatLocked:     rendition.FormatLocked,
		ScheduleOverride: formatOptionalTime(rendition.ScheduleOverride),
		Body:             rendition.Body,
		Title:            rendition.Title,
		Description:      rendition.Description,
		Settings:         settings,
		Status:           rendition.Status,
		ExternalID:       rendition.ExternalID,
		ExternalURL:      rendition.ExternalURL,
		ErrorMessage:     rendition.ErrorMessage,
		ErrorKind:        rendition.ErrorKind,
		ErrorCode:        rendition.ErrorCode,
		ErrorHTTPStatus:  rendition.ErrorHTTPStatus,
		ErrorRetryable:   rendition.ErrorRetryable,
		ErrorRetryAt:     formatOptionalTime(rendition.ErrorRetryAt),
		ErrorAction:      rendition.ErrorAction,
		Media:            media,
	}
}

func providerDeliveryResponse(delivery models.ProviderDelivery) *ProviderDeliveryResponse {
	return &ProviderDeliveryResponse{
		TargetKey:               delivery.TargetKey,
		State:                   delivery.State,
		TerminalReason:          delivery.TerminalReason,
		CurrentAttemptID:        delivery.CurrentAttemptID,
		CurrentAttemptNumber:    delivery.CurrentAttemptNumber,
		CurrentAttemptCreatedAt: delivery.CurrentAttemptCreatedAt.UTC().Format(time.RFC3339Nano),
		ExternalID:              delivery.ExternalID,
		ExternalURL:             delivery.ExternalURL,
		ErrorKind:               delivery.SafeErrorClass,
		ErrorCode:               delivery.SafeErrorCode,
		ErrorHTTPStatus:         delivery.ErrorHTTPStatus,
		RecoveryAction:          providerwrite.DeliveryRecoveryAction(delivery),
		LastReconciledAt:        formatOptionalTime(delivery.LastReconciledAt),
		NextReconciliationAt:    formatOptionalTime(delivery.NextReconciliationAt),
	}
}

func mediaSummary(media models.MediaAttachment, role string, order int, altText string, thumbnailTimestampMS int) MediaSummary {
	if altText == "" {
		altText = media.AltText
	}
	return MediaSummary{
		ID:                   media.ID,
		MimeType:             media.MimeType,
		Size:                 media.Size,
		OriginalFilename:     media.OriginalFilename,
		Width:                media.Width,
		Height:               media.Height,
		DurationMS:           media.DurationMS,
		FrameRate:            media.FrameRate,
		AspectRatio:          media.AspectRatio,
		DominantType:         media.DominantType,
		PosterThumbnailURL:   mediaPublicationPosterURL(media),
		AnalysisStatus:       media.AnalysisStatus,
		AnalysisError:        media.AnalysisError,
		PublicURLReady:       media.PublicURLReady,
		PublicURLCheckedAt:   formatOptionalTime(media.PublicURLCheckedAt),
		PublicURLStatus:      media.PublicURLStatus,
		PublicURLError:       media.PublicURLError,
		URL:                  "/media/" + media.ID,
		Role:                 role,
		DisplayOrder:         order,
		AltText:              altText,
		ThumbnailTimestampMS: thumbnailTimestampMS,
	}
}

func mediaPublicationPosterURL(media models.MediaAttachment) string {
	if media.ThumbnailObjectKey == "" {
		return ""
	}
	return "/media/" + media.ID + "/poster"
}

func renditionAccountIDs(renditions []RenditionInput) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.SocialAccountID)
	}
	return out
}

func normalizeRenditionTargetKey(account models.SocialAccount, requested string, settings map[string]interface{}) (string, error) {
	return platform.ResolveTargetKey(account.Platform, publicationauth.TargetKey(account), requested, settings)
}

func allPublicationMediaIDs(
	defaultMedia []PublicationMediaInput,
	segments []PublicationSegmentInput,
	renditions []RenditionInput,
) []string {
	out := make([]string, 0, len(defaultMedia))
	for _, item := range defaultMedia {
		out = append(out, item.MediaID)
	}
	for _, segment := range segments {
		for _, item := range segment.Media {
			out = append(out, item.MediaID)
		}
	}
	for _, rendition := range renditions {
		for _, item := range rendition.Media {
			out = append(out, item.MediaID)
		}
		for _, segment := range rendition.Segments {
			for _, source := range segment.SourceOverrides {
				for _, item := range source.Media {
					out = append(out, item.MediaID)
				}
			}
			for _, item := range segment.Media {
				out = append(out, item.MediaID)
			}
		}
	}
	return out
}

func publishingIntentForProfile(profile string) string {
	switch strings.TrimSpace(profile) {
	case models.ContentProfileThread:
		return models.PublishingIntentThread
	case models.ContentProfileStory:
		return models.PublishingIntentStory
	case models.ContentProfileShortVideo:
		return models.PublishingIntentShortVideo
	case models.ContentProfileLongVideo:
		return models.PublishingIntentVideo
	default:
		return models.PublishingIntentPost
	}
}

func compatibilityProfileForIntent(intent string) string {
	switch strings.TrimSpace(intent) {
	case models.PublishingIntentThread:
		return models.ContentProfileThread
	case models.PublishingIntentStory:
		return models.ContentProfileStory
	case models.PublishingIntentShortVideo:
		return models.ContentProfileShortVideo
	case models.PublishingIntentVideo:
		return models.ContentProfileLongVideo
	default:
		return models.ContentProfileShortText
	}
}

func renditionIDs(renditions []models.Rendition) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.ID)
	}
	return out
}

func renditionAccountIDsFromModels(renditions []models.Rendition) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.SocialAccountID)
	}
	return out
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func isMissingPublicationSegmentTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}

func publicationMediaSettingsJSON(settings map[string]interface{}) string {
	if settings == nil {
		return "{}"
	}
	return mustJSON(settings)
}

func mustJSON(value interface{}) string {
	if value == nil {
		return "{}"
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func publicationFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstContentLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		if strings.TrimSpace(line) != "" {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func actionMessage(message, jobID string) *ActionOutput {
	resp := &ActionOutput{}
	resp.Body.Message = message
	resp.Body.JobID = jobID
	return resp
}

func enqueueActionMessage(
	message,
	publicationID string,
	result publicationEnqueueResult,
) *ActionOutput {
	resp := actionMessage(message, result.JobID)
	resp.Body.PublicationID = publicationID
	resp.Body.Renditions = result.Renditions
	resp.Body.WorkspaceActivated = result.NewlyActivated
	if result.NewlyActivated {
		resp.Body.ActivationPublicationID = result.ActivationPublicationID
	}
	return resp
}
