package publicationbuilder

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var (
	ErrBuildNotReady          = errors.New("publication build is not ready to commit")
	ErrBuildSourceUnavailable = errors.New("selected publication build source is unavailable")
)

// PublicationApplication is the narrow canonical seam needed to hand a ready
// package to the normal composer.
type PublicationApplication interface {
	CreateFromBuild(
		context.Context,
		string,
		string,
		publicationservice.CreateCommand,
		[]string,
	) (publicationservice.Publication, error)
}

// Commit creates one idempotent draft Publication, then records the handoff.
// The Publication application owns the idempotency record so a retry after a
// crash cannot create a duplicate.
//
//nolint:gocyclo // Authorization, media revalidation, creation, and durable state transition form one handoff.
func (application *Application) Commit(
	ctx context.Context,
	userID string,
	buildID string,
	publications PublicationApplication,
) (Build, error) {
	if application == nil || application.db == nil || publications == nil {
		return Build{}, errors.New("publication build commit is unavailable")
	}
	userID = strings.TrimSpace(userID)
	buildID = strings.TrimSpace(buildID)
	var record BuildRecord
	err := application.db.NewSelect().Model(&record).
		Where("id = ? AND created_by_id = ?", buildID, userID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Build{}, ErrBuildNotFound
	}
	if err != nil {
		return Build{}, fmt.Errorf("load publication build for commit: %w", err)
	}
	if record.State == BuildStateCommitted {
		return decodeBuild(record)
	}
	if record.State != BuildStateReady || (record.Phase != BuildPhaseReady && record.Phase != BuildPhaseCommitting) {
		return Build{}, ErrBuildNotReady
	}

	var authority workspaceaccess.StoredAuthority
	if err := decodeStoredJSON(record.AuthorityJSON, &authority); err != nil {
		return Build{}, errors.New("saved publication build authority is invalid")
	}
	if err := application.authorizeStored(ctx, authority); err != nil {
		return Build{}, errors.New("workspace access no longer allows this publication handoff")
	}
	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return Build{}, errors.New("saved publication build request is invalid")
	}
	var result BuildResult
	if err := decodeStoredJSON(record.ResultJSON, &result); err != nil {
		return Build{}, errors.New("saved publication build result is invalid")
	}
	selectedMediaIDs := selectedSourceMediaIDs(request.Assets, result)
	if err := application.validateCommitSourceMedia(ctx, record.WorkspaceID, selectedMediaIDs); err != nil {
		return Build{}, err
	}

	now := application.now().UTC()
	if _, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("phase = ?", BuildPhaseCommitting).
		Set("updated_at = ?", now).
		Set("revision = revision + 1").
		Where("id = ? AND state = ?", buildID, BuildStateReady).
		Exec(ctx); err != nil {
		return Build{}, fmt.Errorf("start publication build commit: %w", err)
	}

	command := publicationCreateCommand(record.WorkspaceID, request, result, buildID)
	publication, err := publications.CreateFromBuild(ctx, userID, buildID, command, selectedMediaIDs)
	if err != nil {
		_, _ = application.db.NewUpdate().Model((*BuildRecord)(nil)).
			Set("phase = ?", BuildPhaseReady).
			Set("updated_at = ?", application.now().UTC()).
			Where("id = ? AND state = ?", buildID, BuildStateReady).
			Exec(ctx)
		return Build{}, fmt.Errorf("create publication from build: %w", err)
	}

	completedAt := application.now().UTC()
	update, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("publication_id = ?", publication.ID).
		Set("state = ?", BuildStateCommitted).
		Set("phase = ?", BuildPhaseCommitted).
		Set("completed_at = ?", completedAt).
		Set("updated_at = ?", completedAt).
		Set("revision = revision + 1").
		Where("id = ? AND state = ?", buildID, BuildStateReady).
		Exec(ctx)
	if err != nil {
		return Build{}, fmt.Errorf("finish publication build commit: %w", err)
	}
	rows, err := update.RowsAffected()
	if err != nil {
		return Build{}, fmt.Errorf("inspect publication build commit: %w", err)
	}
	if rows == 0 {
		return application.Get(ctx, userID, buildID)
	}
	return application.Get(ctx, userID, buildID)
}

func (application *Application) validateCommitSourceMedia(ctx context.Context, workspaceID string, mediaIDs []string) error {
	if len(mediaIDs) == 0 {
		return nil
	}
	count, err := application.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("processing_status = ?", "ready").
		Where("trashed_at IS NULL").
		Where("id IN (?)", bun.List(mediaIDs)).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("check publication build source media: %w", err)
	}
	if count != len(mediaIDs) {
		return ErrBuildSourceUnavailable
	}
	return nil
}

func publicationCreateCommand(
	workspaceID string,
	request persistedBuildRequest,
	result BuildResult,
	buildID string,
) publicationservice.CreateCommand {
	canonicalID := "builder-source"
	canonical := publicationservice.PublicationSegmentInput{
		ID: canonicalID, Body: result.CanonicalText,
	}
	renditions := make([]publicationservice.RenditionInput, 0, len(result.Destinations))
	for _, destination := range result.Destinations {
		destinationMedia := buildMediaForPlan(request.Assets, destination.Media)
		segments := make([]publicationservice.RenditionSegmentInput, 0, len(destination.Segments))
		for index, segment := range destination.Segments {
			body := segment.Body
			title := segment.Title
			description := segment.Description
			inheritMedia := false
			segmentMedia := []publicationservice.PublicationMediaInput(nil)
			if index == 0 {
				segmentMedia = destinationMedia
			}
			segments = append(segments, publicationservice.RenditionSegmentInput{
				PublicationSegmentID: canonicalID,
				BodyOverride:         &body,
				TitleOverride:        optionalTextOverride(title),
				DescriptionOverride:  optionalTextOverride(description),
				MediaInherited:       &inheritMedia,
				Media:                segmentMedia,
			})
		}
		body, title, description := "", "", ""
		if len(destination.Segments) > 0 {
			body = destination.Segments[0].Body
			title = destination.Segments[0].Title
			description = destination.Segments[0].Description
		}
		renditions = append(renditions, publicationservice.RenditionInput{
			SocialAccountID: destination.AccountID,
			Profile:         contentProfileForOutput(destination.Platform, destination.OutputProfile),
			OutputProfile:   destination.OutputProfile,
			FormatLocked:    true,
			Body:            body,
			Title:           title,
			Description:     description,
			Segments:        segments,
		})
	}

	metadata := map[string]any{
		"builder": map[string]any{
			"build_id":         buildID,
			"voice_profile_id": request.VoiceProfileID,
			"voices":           publicationVoiceSummaries(request.Input.Destinations),
			"route":            result.Direction.Route,
			"thesis":           result.Direction.Thesis,
			"angle":            result.Direction.Angle,
			"claims":           aggregateBuildClaims(result),
			"media":            result.Direction.Media,
			"skipped":          result.Skipped,
			"review_flags":     result.ReviewFlags,
			"destinations":     result.Destinations,
		},
	}
	command := publicationservice.CreateCommand{
		WorkspaceID:    workspaceID,
		Title:          firstNonEmptyBuilderText(result.Direction.Thesis, firstBuilderLine(result.CanonicalText), "Built publication"),
		Intent:         models.PublishingIntentPost,
		CreationPreset: models.PublishingIntentPost,
		SocialSetID:    request.SocialSetID,
		ContentProfile: models.ContentProfileShortText,
		SourceText:     result.CanonicalText,
		Goal:           result.Direction.Outcome,
		Audience:       result.Direction.Audience,
		Metadata:       metadata,
		Segments:       []publicationservice.PublicationSegmentInput{canonical},
		Renditions:     renditions,
	}
	return command
}

func aggregateBuildClaims(result BuildResult) []Claim {
	claims := append([]Claim(nil), result.Direction.Claims...)
	for _, destination := range result.Destinations {
		claims = append(claims, destination.Claims...)
	}
	return claims
}

func publicationVoiceSummaries(destinations []Destination) []map[string]any {
	voices := make([]map[string]any, 0, len(destinations))
	for _, destination := range destinations {
		voices = append(voices, map[string]any{
			"account_id": destination.AccountID,
			"id":         destination.Voice.ID,
			"name":       destination.Voice.Name,
			"revision":   destination.Voice.Revision,
		})
	}
	return voices
}

func buildMediaForPlan(assets []BuildAsset, plan MediaPlan) []publicationservice.PublicationMediaInput {
	sourceRef := strings.TrimSpace(plan.SourceRef)
	if plan.Treatment != "use_source" || !strings.HasPrefix(sourceRef, "media:") {
		return nil
	}
	mediaID := strings.TrimSpace(strings.TrimPrefix(sourceRef, "media:"))
	if mediaID == "" {
		return nil
	}
	for _, asset := range assets {
		if !asset.MayPublish || asset.MediaID != mediaID {
			continue
		}
		return []publicationservice.PublicationMediaInput{{
			MediaID: asset.MediaID,
			Role:    "attachment",
			Settings: map[string]any{
				"builder_source_role": asset.Role,
			},
		}}
	}
	return nil
}

func selectedSourceMediaIDs(assets []BuildAsset, result BuildResult) []string {
	seen := make(map[string]struct{}, len(result.Destinations))
	mediaIDs := make([]string, 0, len(result.Destinations))
	for _, destination := range result.Destinations {
		for _, media := range buildMediaForPlan(assets, destination.Media) {
			if _, duplicate := seen[media.MediaID]; duplicate {
				continue
			}
			seen[media.MediaID] = struct{}{}
			mediaIDs = append(mediaIDs, media.MediaID)
		}
	}
	return mediaIDs
}

func optionalTextOverride(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func contentProfileForOutput(platform, outputProfile string) string {
	for _, capability := range capabilities.All() {
		if capability.Provider == platform && capability.OutputProfile == outputProfile {
			return capability.Profile
		}
	}
	return models.ContentProfileShortText
}

func firstBuilderLine(value string) string {
	if line, _, found := strings.Cut(strings.TrimSpace(value), "\n"); found {
		return strings.TrimSpace(line)
	}
	return strings.TrimSpace(value)
}

func firstNonEmptyBuilderText(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
