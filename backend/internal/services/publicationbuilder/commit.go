package publicationbuilder

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

var ErrBuildNotReady = errors.New("publication build is not ready to commit")

// PublicationApplication is the narrow canonical seam needed to hand a ready
// package to the normal composer.
type PublicationApplication interface {
	Create(context.Context, string, publicationservice.CreateCommand) (publicationservice.Publication, error)
	Get(context.Context, string, string) (publicationservice.Publication, error)
}

// Commit creates one deterministic draft Publication, then records the
// handoff. A retry after a crash finds the same Publication instead of making
// a duplicate.
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
		return Build{}, errors.New("Workspace access no longer allows this publication handoff")
	}
	var request persistedBuildRequest
	if err := decodeStoredJSON(record.RequestJSON, &request); err != nil {
		return Build{}, errors.New("saved publication build request is invalid")
	}
	var result BuildResult
	if err := decodeStoredJSON(record.ResultJSON, &result); err != nil {
		return Build{}, errors.New("saved publication build result is invalid")
	}

	publicationID := deterministicPublicationID(buildID)
	now := application.now().UTC()
	if _, err := application.db.NewUpdate().Model((*BuildRecord)(nil)).
		Set("phase = ?", BuildPhaseCommitting).
		Set("updated_at = ?", now).
		Set("revision = revision + 1").
		Where("id = ? AND state = ?", buildID, BuildStateReady).
		Exec(ctx); err != nil {
		return Build{}, fmt.Errorf("start publication build commit: %w", err)
	}

	publication, err := publications.Get(ctx, userID, publicationID)
	if category, ok := publicationservice.CategoryOf(err); ok && category == publicationservice.ErrorNotFound {
		publication, err = publications.Create(ctx, userID, publicationCreateCommand(
			publicationID,
			record.WorkspaceID,
			request,
			result,
			buildID,
		))
		if err != nil {
			// Another identical commit may have won the insert race.
			if existing, getErr := publications.Get(ctx, userID, publicationID); getErr == nil {
				publication = existing
				err = nil
			}
		}
	}
	if err != nil {
		_, _ = application.db.NewUpdate().Model((*BuildRecord)(nil)).
			Set("phase = ?", BuildPhaseReady).
			Set("updated_at = ?", application.now().UTC()).
			Where("id = ? AND state = ?", buildID, BuildStateReady).
			Exec(ctx)
		return Build{}, fmt.Errorf("create publication from build: %w", err)
	}
	if publication.ID != publicationID {
		return Build{}, errors.New("publication build handoff returned an unexpected Publication")
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

func deterministicPublicationID(buildID string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("openpost:publication-build:"+buildID)).String()
}

func publicationCreateCommand(
	publicationID string,
	workspaceID string,
	request persistedBuildRequest,
	result BuildResult,
	buildID string,
) publicationservice.CreateCommand {
	canonicalID := "builder-source"
	media := publishableBuildMedia(request.Assets)
	canonical := publicationservice.PublicationSegmentInput{
		ID: canonicalID, Body: result.CanonicalText, Media: media,
	}
	renditions := make([]publicationservice.RenditionInput, 0, len(result.Destinations))
	for _, destination := range result.Destinations {
		segments := make([]publicationservice.RenditionSegmentInput, 0, len(destination.Segments))
		for index, segment := range destination.Segments {
			body := segment.Body
			title := segment.Title
			description := segment.Description
			inheritMedia := index == 0 && mediaPlanUsesSource(destination.Media)
			segments = append(segments, publicationservice.RenditionSegmentInput{
				PublicationSegmentID: canonicalID,
				BodyOverride:         &body,
				TitleOverride:        optionalTextOverride(title),
				DescriptionOverride:  optionalTextOverride(description),
				MediaInherited:       &inheritMedia,
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
			"claims":           result.Direction.Claims,
			"media":            result.Direction.Media,
			"skipped":          result.Skipped,
			"review_flags":     result.ReviewFlags,
			"destinations":     result.Destinations,
		},
	}
	command := publicationservice.CreateCommand{
		InternalID:     publicationID,
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
		Media:          media,
		Segments:       []publicationservice.PublicationSegmentInput{canonical},
		Renditions:     renditions,
	}
	if len(request.ContextURLs) > 0 {
		command.SourceURL = request.ContextURLs[0]
	}
	return command
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

func publishableBuildMedia(assets []BuildAsset) []publicationservice.PublicationMediaInput {
	media := make([]publicationservice.PublicationMediaInput, 0, len(assets))
	for _, asset := range assets {
		if !asset.MayPublish {
			continue
		}
		media = append(media, publicationservice.PublicationMediaInput{
			MediaID: asset.MediaID,
			Role:    "attachment",
			Settings: map[string]any{
				"builder_source_role": asset.Role,
			},
		})
	}
	return media
}

func mediaPlanUsesSource(plan MediaPlan) bool {
	switch plan.Treatment {
	case "use_source", "annotate_source", "edit_existing_video":
		return true
	default:
		return false
	}
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
