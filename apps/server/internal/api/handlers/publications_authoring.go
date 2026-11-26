package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/publicationlink"
	"github.com/openpost/backend/internal/services/publicationpoll"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/publicationsource"
	renditionservice "github.com/openpost/backend/internal/services/renditions"
	"github.com/uptrace/bun"
)

func (h *PublicationHandler) deleteRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-publication-rendition",
		Method:      http.MethodDelete,
		Path:        "/publications/{id}/renditions/{account_id}",
		Summary:     "Delete one saved publication destination",
		Description: "This permanently removes the destination and its segment and media overrides. Deselecting an account does not call this operation.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *DeletePublicationRenditionInput) (*ActionOutput, error) {
		if !input.Confirm {
			return nil, huma.Error400BadRequest("confirm=true is required to delete a saved destination")
		}
		if err := drafts.RequireExpectedRevision(input.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		var deleted bool
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			var txErr error
			deleted, txErr = h.deleteRenditionTx(txCtx, tx, publication.ID, input, userID)
			return txErr
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to delete publication destination")
		}
		if !deleted {
			return nil, huma.Error404NotFound("publication destination not found")
		}
		output := actionMessage("publication destination deleted", "")
		output.Body.Revision = publication.Revision + 1
		return output, nil
	})
}

func (h *PublicationHandler) deleteRenditionTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	input *DeletePublicationRenditionInput,
	userID string,
) (bool, error) {
	current, err := h.loadEditablePublicationTx(ctx, tx, publicationID)
	if err != nil {
		return false, err
	}
	if current.Revision != input.ExpectedRevision {
		return false, h.publicationRevisionConflict(ctx, tx, current, input.ExpectedRevision)
	}
	var renditions []models.Rendition
	query := tx.NewSelect().Model(&renditions).
		Where("publication_id = ? AND social_account_id = ?", publicationID, input.AccountID).
		Order("id ASC")
	if input.TargetKey != "" {
		query = query.Where("target_key = ?", strings.TrimSpace(input.TargetKey))
	}
	if err := query.Scan(ctx); err != nil {
		return false, err
	}
	if len(renditions) == 0 {
		return false, nil
	}
	if len(renditions) > 1 {
		return false, huma.Error409Conflict("target_key is required when an account has multiple publication destinations")
	}
	before, err := h.loadPublicationRevisionResponseTx(ctx, tx, current)
	if err != nil {
		return false, err
	}
	renditionIDs := []string{renditions[0].ID}
	if err := h.cancelPendingReplyJobsForDeletedTargetsTx(ctx, tx, publicationID, renditionIDs); err != nil {
		return false, err
	}
	result, err := tx.NewDelete().Model((*models.Rendition)(nil)).Where("id IN (?)", bun.List(renditionIDs)).Exec(ctx)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil || count == 0 {
		return false, err
	}
	return true, h.recordRenditionDeletionTx(ctx, tx, current, before, userID)
}

func (h *PublicationHandler) recordRenditionDeletionTx(
	ctx context.Context,
	tx bun.Tx,
	current *models.Publication,
	before publicationRevisionSnapshot,
	userID string,
) error {
	now := time.Now().UTC()
	nextRevision := current.Revision + 1
	if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
		Set("revision = ?", nextRevision).Set("updated_at = ?", now).
		Where("id = ? AND revision = ?", current.ID, current.Revision).Exec(ctx); err != nil {
		return err
	}
	current.Revision = nextRevision
	current.UpdatedAt = now
	after, err := h.loadPublicationRevisionResponseTx(ctx, tx, current)
	if err != nil {
		return err
	}
	fields := publicationservice.ChangedAuthoredDomains(before.authored, after.authored)
	if _, err := h.invalidatePublicationReviewTx(ctx, tx, current, fields); err != nil {
		return err
	}
	return drafts.RecordChange(ctx, tx, drafts.AggregatePublication, current.ID, nextRevision, fields, userID, now)
}

func (h *PublicationHandler) replaceAllPublicationRenditions(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	segmentInputs []PublicationSegmentInput,
	renditionInputs []RenditionInput,
	accounts map[string]models.SocialAccount,
) error {
	if err := preserveRenditionMentionInputs(ctx, tx, publication.ID, renditionInputs, accounts); err != nil {
		return err
	}
	if err := h.defaultNewTextCardDestinations(ctx, tx, publication.ID, renditionInputs, accounts); err != nil {
		return err
	}
	var renditionIDs []string
	if err := tx.NewSelect().
		Model((*models.Rendition)(nil)).
		Column("id").
		Where("publication_id = ?", publication.ID).
		Scan(ctx, &renditionIDs); err != nil {
		return err
	}
	if err := h.rejectReplyJobsForReplacedTargetsTx(ctx, tx, publication.ID, renditionIDs); err != nil {
		return err
	}
	if len(renditionIDs) > 0 {
		if _, err := tx.NewDelete().
			Model((*models.RenditionMedia)(nil)).
			Where("rendition_id IN (?)", bun.List(renditionIDs)).
			Exec(ctx); err != nil {
			return err
		}
	}
	if _, err := tx.NewDelete().
		Model((*models.Rendition)(nil)).
		Where("publication_id = ?", publication.ID).
		Exec(ctx); err != nil {
		return err
	}
	segments, loadedInputs, err := h.loadCanonicalSegmentInputsWithDB(ctx, tx, publication.ID)
	if err != nil {
		return err
	}
	if segmentInputs == nil {
		segmentInputs = loadedInputs
	}
	return h.insertRenditions(ctx, tx, publication, segments, segmentInputs, renditionInputs, nil, accounts, nil)
}

//nolint:gocyclo // The transaction preserves revision checks and both replacement and upsert semantics across renditions.
func (h *PublicationHandler) upsertRenditions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "upsert-publication-renditions",
		Method:      http.MethodPut,
		Path:        "/publications/{id}/renditions",
		Summary:     "Replace or upsert publication renditions",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *UpsertRenditionsInput) (*PublicationOutput, error) {
		ctx, cleanupTextCards := h.textCards.Mutation(ctx)
		defer cleanupTextCards()
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		accountMap, err := h.loadAccounts(ctx, publication.WorkspaceID, renditionAccountIDs(input.Body.Renditions))
		if err != nil {
			return nil, err
		}
		if err := h.validateMediaBelongsToWorkspace(ctx, publication.WorkspaceID, allPublicationMediaIDs(nil, nil, input.Body.Renditions)); err != nil {
			return nil, err
		}
		var response PublicationResponse
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			request, requestErr := mutationIdempotencyRequest(ctx, publication.WorkspaceID, "upsert-publication-renditions", input.IdempotencyKey)
			if requestErr != nil {
				return nil, requestErr
			}
			request.ResourceID = publication.ID
			request.RequestHash, requestErr = idempotency.Hash(struct {
				PublicationID    string           `json:"publication_id"`
				ExpectedRevision int              `json:"expected_revision"`
				Renditions       []RenditionInput `json:"renditions"`
			}{publication.ID, input.Body.ExpectedRevision, input.Body.Renditions})
			if requestErr != nil {
				return nil, publicationMutationHTTPError(requestErr, "failed to normalize rendition update")
			}
			result, executeErr := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (PublicationResponse, error) {
				return h.upsertRenditionsTx(txCtx, tx, userID, publication.ID, input.Body.ExpectedRevision, input.Body.Renditions, accountMap)
			})
			response, err = result.Value, executeErr
		} else {
			err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
				var txErr error
				response, txErr = h.upsertRenditionsTx(txCtx, tx, userID, publication.ID, input.Body.ExpectedRevision, input.Body.Renditions, accountMap)
				return txErr
			})
		}
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to update publication renditions")
		}
		return &PublicationOutput{Body: response}, nil
	})
}

//nolint:gocyclo // The transaction preserves revision checks and partial upsert semantics.
func (h *PublicationHandler) upsertRenditionsTx(
	ctx context.Context,
	tx bun.Tx,
	userID string,
	publicationID string,
	expectedRevision int,
	renditions []RenditionInput,
	accountMap map[string]models.SocialAccount,
) (PublicationResponse, error) {
	publication, err := h.loadEditablePublicationTx(ctx, tx, publicationID)
	if err != nil {
		return PublicationResponse{}, err
	}
	if publication.Revision != expectedRevision {
		return PublicationResponse{}, h.publicationRevisionConflict(ctx, tx, publication, expectedRevision)
	}
	response, err := h.loadPublicationRevisionResponseTx(ctx, tx, publication)
	if err != nil {
		return PublicationResponse{}, err
	}
	before := response
	if err := h.defaultNewTextCardDestinations(ctx, tx, publication.ID, renditions, accountMap); err != nil {
		return PublicationResponse{}, err
	}
	if len(renditions) > 0 {
		if err := preserveRenditionMentionInputs(ctx, tx, publication.ID, renditions, accountMap); err != nil {
			return PublicationResponse{}, err
		}
		positions, err := renditionUpsertPositionsTx(ctx, tx, publication.ID, renditions, accountMap)
		if err != nil {
			return PublicationResponse{}, err
		}
		targets := make(map[renditionservice.TargetIdentity]struct{}, len(renditions))
		for _, input := range renditions {
			account := accountMap[input.SocialAccountID]
			targetKey, targetErr := normalizeRenditionTargetKey(account, input.TargetKey, input.Settings)
			if targetErr != nil {
				return PublicationResponse{}, huma.Error400BadRequest(targetErr.Error())
			}
			targets[renditionservice.NewTargetIdentity(input.SocialAccountID, targetKey)] = struct{}{}
		}
		existingIDs, err := renditionservice.MatchingIDsTx(ctx, tx, publication.ID, targets, accountMap)
		if err != nil {
			return PublicationResponse{}, err
		}
		if err := h.rejectReplyJobsForReplacedTargetsTx(ctx, tx, publication.ID, existingIDs); err != nil {
			return PublicationResponse{}, err
		}
		if err := renditionservice.DeleteRowsTx(ctx, tx, existingIDs); err != nil {
			return PublicationResponse{}, err
		}
		segments, segmentInputs, err := h.loadCanonicalSegmentInputsWithDB(ctx, tx, publication.ID)
		if err != nil {
			return PublicationResponse{}, err
		}
		if err := h.insertRenditions(ctx, tx, publication, segments, segmentInputs, renditions, nil, accountMap, positions); err != nil {
			return PublicationResponse{}, err
		}
		if err := h.refreshPublicationTextCards(ctx, tx, publication.ID, false, publicationTextCardIDs(before.response)...); err != nil {
			return PublicationResponse{}, err
		}
		now := time.Now().UTC()
		nextRevision := publication.Revision + 1
		result, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("revision = ?", nextRevision).Set("updated_at = ?", now).
			Where("id = ? AND revision = ?", publication.ID, publication.Revision).Exec(ctx)
		if err != nil {
			return PublicationResponse{}, err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return PublicationResponse{}, h.publicationRevisionConflict(ctx, tx, publication, expectedRevision)
		}
		publication.Revision = nextRevision
		publication.UpdatedAt = now
		response, err = h.loadPublicationRevisionResponseTx(ctx, tx, publication)
		if err != nil {
			return PublicationResponse{}, err
		}
		changedDomains := publicationservice.ChangedAuthoredDomains(before.authored, response.authored)
		if _, err := h.invalidatePublicationReviewTx(ctx, tx, publication, changedDomains); err != nil {
			return PublicationResponse{}, err
		}
		if err := drafts.RecordChange(ctx, tx, drafts.AggregatePublication, publication.ID, nextRevision, changedDomains, userID, now); err != nil {
			return PublicationResponse{}, err
		}
	}
	response, err = h.loadPublicationRevisionResponseTx(ctx, tx, publication)
	if err != nil {
		return PublicationResponse{}, err
	}
	return response.response, nil
}

func (h *PublicationHandler) insertPublicationSegments(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	inputs []PublicationSegmentInput,
) ([]models.PublicationSegment, error) {
	var mentionErr error
	inputs, mentionErr = preparePublicationMentions(inputs, nil)
	if mentionErr != nil {
		return nil, mentionErr
	}
	now := time.Now().UTC()
	segments := make([]models.PublicationSegment, 0, len(inputs))
	for position, input := range inputs {
		if err := validateAuthoredMediaRoles(input.Media); err != nil {
			return nil, err
		}
		segment := models.PublicationSegment{
			ID:            uuid.New().String(),
			PublicationID: publication.ID,
			Position:      position,
			Body:          input.Body,
			Title:         input.Title,
			Description:   input.Description,
			URL:           input.URL,
			SettingsJSON:  mustJSON(input.Settings),
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if _, err := tx.NewInsert().Model(&segment).Exec(ctx); err != nil {
			if isMissingPublicationSegmentTable(err) {
				segments = append(segments, segment)
				for remainingPosition := position + 1; remainingPosition < len(inputs); remainingPosition++ {
					remaining := inputs[remainingPosition]
					segments = append(segments, models.PublicationSegment{
						ID:            uuid.New().String(),
						PublicationID: publication.ID,
						Position:      remainingPosition,
						Body:          remaining.Body,
						Title:         remaining.Title,
						Description:   remaining.Description,
						URL:           remaining.URL,
						SettingsJSON:  mustJSON(remaining.Settings),
						CreatedAt:     now,
						UpdatedAt:     now,
					})
				}
				return segments, nil
			}
			return nil, err
		}
		for order, media := range input.Media {
			row := models.PublicationSegmentMedia{
				SegmentID:            segment.ID,
				MediaID:              media.MediaID,
				Role:                 publicationFirstNonEmpty(media.Role, "attachment"),
				DisplayOrder:         order,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
				SettingsJSON:         publicationMediaSettingsJSON(media.Settings),
			}
			if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
				return nil, err
			}
		}
		segments = append(segments, segment)
	}
	if err := medialifecycle.TouchWithDB(ctx, tx, allPublicationMediaIDs(nil, inputs, nil), now); err != nil {
		return nil, err
	}
	return segments, nil
}

//nolint:gocyclo
func (h *PublicationHandler) replacePublicationSegments(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	inputs []PublicationSegmentInput,
) error {
	previousMediaIDs := make([]string, 0, len(inputs))
	if err := tx.NewSelect().
		TableExpr("publication_segment_media AS media").
		ColumnExpr("media.media_id").
		Join("JOIN publication_segments AS segment ON segment.id = media.segment_id").
		Where("segment.publication_id = ?", publication.ID).
		Scan(ctx, &previousMediaIDs); err != nil && !isMissingPublicationSegmentTable(err) {
		return err
	}
	if len(inputs) == 0 {
		inputs = []PublicationSegmentInput{{Body: publication.SourceText, Title: publication.Title, URL: publication.SourceURL}}
	}
	var existing []models.PublicationSegment
	if err := tx.NewSelect().
		Model(&existing).
		Where("publication_id = ?", publication.ID).
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return nil
		}
		return err
	}
	var mentionErr error
	inputs, mentionErr = preparePublicationMentions(inputs, existing)
	if mentionErr != nil {
		return mentionErr
	}
	existingByID := make(map[string]models.PublicationSegment, len(existing))
	for _, segment := range existing {
		existingByID[segment.ID] = segment
	}
	// Vacate the nonnegative positions before reordering or replacing segments.
	// Keep IDs intact so destination overrides survive; the transaction hides
	// these temporary positions and rolls them back if any write fails.
	if len(existing) > 0 {
		if _, err := tx.NewUpdate().Model((*models.PublicationSegment)(nil)).
			Set("position = -position - 1").
			Where("publication_id = ?", publication.ID).
			Exec(ctx); err != nil {
			return err
		}
	}
	keptIDs := make([]string, 0, len(inputs))
	now := time.Now().UTC()
	for position, input := range inputs {
		segmentID := strings.TrimSpace(input.ID)
		existingSegment, exists := existingByID[segmentID]
		if segmentID == "" || !exists {
			segmentID = uuid.New().String()
			row := &models.PublicationSegment{
				ID:            segmentID,
				PublicationID: publication.ID,
				Position:      position,
				Body:          input.Body,
				Title:         input.Title,
				Description:   input.Description,
				URL:           input.URL,
				SettingsJSON:  mustJSON(input.Settings),
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
		} else {
			existingSegment.Position = position
			existingSegment.Body = input.Body
			existingSegment.Title = input.Title
			existingSegment.Description = input.Description
			existingSegment.URL = input.URL
			existingSegment.SettingsJSON = mustJSON(input.Settings)
			existingSegment.UpdatedAt = now
			if _, err := tx.NewUpdate().
				Model(&existingSegment).
				Column("position", "body", "title", "description", "url", "settings_json", "updated_at").
				Where("id = ? AND publication_id = ?", existingSegment.ID, publication.ID).
				Exec(ctx); err != nil {
				return err
			}
			if _, err := tx.NewDelete().
				Model((*models.PublicationSegmentMedia)(nil)).
				Where("segment_id = ?", segmentID).
				Exec(ctx); err != nil {
				return err
			}
		}
		for order, media := range input.Media {
			row := &models.PublicationSegmentMedia{
				SegmentID:            segmentID,
				MediaID:              media.MediaID,
				Role:                 publicationFirstNonEmpty(media.Role, "attachment"),
				DisplayOrder:         order,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
				SettingsJSON:         publicationMediaSettingsJSON(media.Settings),
			}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
		}
		keptIDs = append(keptIDs, segmentID)
	}
	removedIDs := make([]string, 0, len(existing))
	for _, segment := range existing {
		if !slices.Contains(keptIDs, segment.ID) {
			removedIDs = append(removedIDs, segment.ID)
		}
	}
	if len(removedIDs) > 0 {
		if _, err := tx.NewDelete().
			Model((*models.PublicationSegment)(nil)).
			Where("publication_id = ?", publication.ID).
			Where("id IN (?)", bun.List(removedIDs)).
			Exec(ctx); err != nil {
			return err
		}
	}
	if err := refreshPublicationText(ctx, tx, publication.ID, existing); err != nil {
		return err
	}
	previousMediaIDs = append(previousMediaIDs, allPublicationMediaIDs(nil, inputs, nil)...)
	return medialifecycle.TouchWithDB(ctx, tx, previousMediaIDs, now)
}

func syncPublicationFirstSegmentBodyTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	body string,
	updatedAt time.Time,
) error {
	var segment models.PublicationSegment
	if err := tx.NewSelect().
		Model(&segment).
		Where("publication_id = ?", publicationID).
		Order("position ASC", "id ASC").
		Limit(1).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || isMissingPublicationSegmentTable(err) {
			return nil
		}
		return err
	}
	previous := segment
	var oldSettings map[string]any
	_ = json.Unmarshal([]byte(segment.SettingsJSON), &oldSettings)
	nextSettings := maps.Clone(oldSettings)
	delete(nextSettings, posttext.SettingsKey)
	nextSettings, mentionErr := posttext.PreserveSettings(segment.Body, body, oldSettings, nextSettings)
	if mentionErr != nil {
		return huma.Error400BadRequest(mentionErr.Error())
	}
	segment.SettingsJSON = mustJSON(nextSettings)
	segment.Body = body
	segment.UpdatedAt = updatedAt
	_, err := tx.NewUpdate().
		Model(&segment).
		Column("body", "settings_json", "updated_at").
		Where("id = ?", segment.ID).
		Exec(ctx)
	if err != nil {
		return err
	}
	return refreshPublicationText(ctx, tx, publicationID, []models.PublicationSegment{previous})
}

//nolint:gocyclo
func (h *PublicationHandler) insertRenditions(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	canonicalSegments []models.PublicationSegment,
	canonicalInputs []PublicationSegmentInput,
	inputs []RenditionInput,
	defaultMedia []PublicationMediaInput,
	accounts map[string]models.SocialAccount,
	positions map[renditionservice.TargetIdentity]int,
) error {
	now := time.Now().UTC()
	if len(canonicalSegments) == 0 {
		canonicalSegments = []models.PublicationSegment{{
			ID:            "legacy:" + publication.ID,
			PublicationID: publication.ID,
			Position:      0,
			Body:          publication.SourceText,
			Title:         publication.Title,
			URL:           publication.SourceURL,
		}}
	}
	if len(canonicalInputs) == 0 {
		canonicalInputs = []PublicationSegmentInput{{
			ID:    canonicalSegments[0].ID,
			Body:  canonicalSegments[0].Body,
			Title: canonicalSegments[0].Title,
			URL:   canonicalSegments[0].URL,
			Media: defaultMedia,
		}}
	}
	seenTargets := make(map[renditionservice.TargetIdentity]struct{}, len(inputs))
	for position, input := range inputs {
		if err := validateAuthoredMediaRoles(input.Media); err != nil {
			return err
		}
		for _, segment := range input.Segments {
			if err := validateAuthoredMediaRoles(segment.Media); err != nil {
				return err
			}
			for _, source := range segment.SourceOverrides {
				if err := validateAuthoredMediaRoles(source.Media); err != nil {
					return err
				}
			}
		}
		account, ok := accounts[input.SocialAccountID]
		if !ok {
			return huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
		}
		targetKey, err := normalizeRenditionTargetKey(account, input.TargetKey, input.Settings)
		if err != nil {
			return huma.Error400BadRequest(err.Error())
		}
		identity := renditionservice.NewTargetIdentity(input.SocialAccountID, targetKey)
		if _, duplicate := seenTargets[identity]; duplicate {
			return huma.Error400BadRequest("each social account target may appear only once")
		}
		seenTargets[identity] = struct{}{}
		if assigned, exists := positions[identity]; exists {
			position = assigned
		}
		resolved := h.resolveRenditionCapability(ctx, tx, publication, account, input, canonicalInputs)
		// Unlocked formats follow the current source shape. Requested output profiles
		// are preserved by the resolver, including when their source becomes invalid.
		profile := publicationFirstNonEmpty(resolved.Profile, input.Profile, publication.ContentProfile)
		outputProfile := publicationFirstNonEmpty(input.OutputProfile, resolved.OutputProfile, account.Platform+".post")
		status := models.RenditionStatusDraft
		if publication.Status == models.PublicationStatusScheduled {
			status = models.RenditionStatusScheduled
		}
		firstCanonical := models.PublicationSegment{}
		if len(canonicalSegments) > 0 {
			firstCanonical = canonicalSegments[0]
		}
		_, effectiveBody := renditionTextOverride(nil, input.Body, firstCanonical.Body)
		_, effectiveTitle := renditionTextOverride(nil, input.Title, firstCanonical.Title)
		_, effectiveDescription := renditionTextOverride(nil, input.Description, firstCanonical.Description)
		if input.ScheduleOverride != nil && input.ScheduleOverride.Before(time.Now().UTC()) {
			return huma.Error400BadRequest("schedule_override must be in the future")
		}
		rendition := &models.Rendition{
			ID:              uuid.New().String(),
			PublicationID:   publication.ID,
			Position:        position,
			SocialAccountID: input.SocialAccountID,
			TargetKey:       targetKey,
			Platform:        account.Platform,
			Profile:         profile,
			OutputProfile:   outputProfile,
			FormatLocked:    input.FormatLocked,
			Body:            publicationFirstNonEmpty(effectiveBody, publication.SourceText),
			Title:           publicationFirstNonEmpty(effectiveTitle, publication.Title),
			Description:     effectiveDescription,
			SettingsJSON:    mustJSON(input.Settings),
			Status:          status,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if input.ScheduleOverride != nil {
			rendition.ScheduleOverride = input.ScheduleOverride.UTC()
		}
		if _, err := tx.NewInsert().Model(rendition).Exec(ctx); err != nil {
			return err
		}

		segmentInputs := input.Segments
		if resolved.SegmentStrategy == "join" && textCardSettingsEnabled(rendition.SettingsJSON) && len(segmentInputs) > 1 && len(canonicalSegments) > 1 {
			joined, err := joinTextCardSources(input, canonicalSegments, canonicalInputs)
			if err != nil {
				return err
			}
			segmentInputs = []RenditionSegmentInput{joined}
		}
		if len(segmentInputs) == 0 {
			if resolved.SegmentStrategy == "join" && len(canonicalSegments) > 1 {
				segmentInputs = []RenditionSegmentInput{joinedRenditionSegmentInput(canonicalSegments, canonicalInputs, input)}
			} else {
				segmentInputs = make([]RenditionSegmentInput, 0, len(canonicalSegments))
				for position, canonical := range canonicalSegments {
					segmentInput := RenditionSegmentInput{
						PublicationSegmentID: canonical.ID,
						Body:                 canonical.Body,
						Title:                canonical.Title,
						Description:          canonical.Description,
						URL:                  canonical.URL,
					}
					if position == 0 {
						segmentInput.Body = publicationFirstNonEmpty(input.Body, segmentInput.Body)
						segmentInput.Title = publicationFirstNonEmpty(input.Title, segmentInput.Title)
						segmentInput.Description = publicationFirstNonEmpty(input.Description, segmentInput.Description)
						if len(input.Media) > 0 {
							segmentInput.Media = input.Media
						} else if len(defaultMedia) > 0 {
							segmentInput.Media = defaultMedia
						}
					}
					if len(segmentInput.Media) == 0 && position < len(canonicalInputs) {
						segmentInput.Media = canonicalInputs[position].Media
					}
					segmentInputs = append(segmentInputs, segmentInput)
				}
			}
		}
		for position, segment := range segmentInputs {
			if len(segment.SourceOverrides) > 0 && (position != 0 || resolved.SegmentStrategy != "join") {
				return huma.Error400BadRequest("source overrides belong to the first joined destination output")
			}
		}
		if err := h.insertRenditionSegments(ctx, tx, rendition, canonicalSegments, canonicalInputs, segmentInputs); err != nil {
			return err
		}
	}
	return medialifecycle.TouchWithDB(
		ctx,
		tx,
		allPublicationMediaIDs(defaultMedia, canonicalInputs, inputs),
		now,
	)
}

//nolint:gocyclo // This keeps canonical inheritance and legacy-media fallback in one transactional write.
func (h *PublicationHandler) insertRenditionSegments(
	ctx context.Context,
	tx bun.Tx,
	rendition *models.Rendition,
	canonicalSegments []models.PublicationSegment,
	canonicalInputs []PublicationSegmentInput,
	inputs []RenditionSegmentInput,
) error {
	now := time.Now().UTC()
	legacyMediaSeen := map[string]struct{}{}
	for position, input := range inputs {
		canonical := canonicalPublicationSegment(
			position,
			input.PublicationSegmentID,
			canonicalSegments,
			canonicalInputs,
		)
		if len(input.SourceOverrides) > 0 {
			var err error
			input, err = normalizeJoinedSourceOverrides(input, canonicalSegments, canonicalInputs)
			if err != nil {
				return err
			}
		}
		bodyOverride, effectiveBody := renditionTextOverride(input.BodyOverride, input.Body, canonical.Body)
		titleOverride, effectiveTitle := renditionTextOverride(input.TitleOverride, input.Title, canonical.Title)
		descriptionOverride, effectiveDescription := renditionTextOverride(input.DescriptionOverride, input.Description, canonical.Description)
		urlOverride, effectiveURL := renditionTextOverride(input.URLOverride, input.URL, canonical.URL)
		sourceSettings := map[string]any{}
		_ = json.Unmarshal([]byte(canonical.SettingsJSON), &sourceSettings)
		// Drafts keep incomplete poll choices. Validation and delivery reject them.
		effectiveBody, effectiveSettings, _ := publicationpoll.Resolve(sourceSettings, rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, effectiveBody, input.Settings)
		if (len(inputs) == 1 || len(input.SourceOverrides) > 0) && len(canonicalSegments) > 1 {
			baseBody := joinedPublicationBody(canonicalSegments)
			bodyOverride, baseBody = renditionTextOverride(input.BodyOverride, input.Body, baseBody)
			effectiveBody, effectiveSettings, _ = publicationpoll.ResolveJoined(publicationPollSources(canonicalSegments), rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, baseBody, input.Settings)
		}

		authoredMentionsBody := publicationsource.AuthoredBody(canonical, canonicalSegments, mustJSON(input.SourceOverrides), bodyOverride, len(canonicalSegments) > 1 && len(inputs) == 1)
		var mentionErr error
		input, mentionErr = snapshotCanonicalMentionOverride(input, canonicalSegments, canonical.ID, bodyOverride, len(canonicalSegments) > 1 && len(inputs) == 1)
		if mentionErr != nil {
			return huma.Error400BadRequest(mentionErr.Error())
		}
		input, bodyOverride, mentionErr = prepareDestinationMentions(input, authoredMentionsBody, bodyOverride)
		if mentionErr != nil {
			return mentionErr
		}
		// Poll resolution may clone settings. Retain only the authored mention value.
		if mentions, ok := input.Settings[posttext.SettingsKey]; ok {
			if effectiveSettings == nil {
				effectiveSettings = map[string]any{}
			}
			effectiveSettings[posttext.SettingsKey] = mentions
		}

		linkBody := publicationsource.AuthoredBody(canonical, canonicalSegments, mustJSON(input.SourceOverrides), bodyOverride, len(canonicalSegments) > 1 && len(inputs) == 1)
		linkMediaCount := len(input.Media)
		if input.MediaInherited != nil && *input.MediaInherited && position < len(canonicalInputs) {
			linkMediaCount = len(canonicalInputs[position].Media)
		}
		var linkDestinationSettings map[string]any
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &linkDestinationSettings)
		if caption, err := publicationsource.ReadCaptionMentions(input.Settings); err != nil {
			return huma.Error400BadRequest(err.Error())
		} else if caption != nil {
			if _, _, err := publicationsource.DeliveryCaption(input.Settings, rendition.Platform, ""); err != nil {
				return huma.Error400BadRequest(err.Error())
			}
			if actual, ok := linkDestinationSettings[caption.Field].(string); !ok || actual != caption.Body {
				return huma.Error400BadRequest("caption annotations must match the authored native caption setting")
			}
		}
		effectiveSettings, _ = publicationlink.ResolveEffective(sourceSettings, rendition.SocialAccountID, rendition.Platform, linkBody, linkDestinationSettings, effectiveSettings, linkMediaCount)

		if position == 0 {
			rendition.Body = effectiveBody
			if _, err := tx.NewUpdate().Model(rendition).Column("body").Where("id = ?", rendition.ID).Exec(ctx); err != nil {
				return err
			}
		}
		segment := &models.RenditionSegment{
			ID:                   uuid.New().String(),
			RenditionID:          rendition.ID,
			PublicationSegmentID: canonical.ID,
			SourceOverridesJSON:  mustJSON(input.SourceOverrides),
			Position:             position,
			Body:                 effectiveBody,
			Title:                effectiveTitle,
			Description:          effectiveDescription,
			URL:                  effectiveURL,
			BodyOverride:         bodyOverride,
			TitleOverride:        titleOverride,
			DescriptionOverride:  descriptionOverride,
			URLOverride:          urlOverride,
			SettingsJSON:         mustJSON(effectiveSettings),
			Status:               rendition.Status,
			CreatedAt:            now,
			UpdatedAt:            now,
		}
		if segment.PublicationSegmentID == "" {
			return huma.Error400BadRequest("rendition segment does not match a canonical publication segment")
		}
		if _, err := tx.NewInsert().Model(segment).Exec(ctx); err != nil {
			if isMissingPublicationSegmentTable(err) {
				return h.insertLegacyRenditionMedia(ctx, tx, rendition.ID, inputs, canonicalInputs)
			}
			return err
		}
		mediaInputs := input.Media
		canonicalMedia := []PublicationMediaInput{}
		if position < len(canonicalInputs) {
			canonicalMedia = canonicalInputs[position].Media
		}
		if len(input.SourceOverrides) > 0 {
			canonicalMedia = input.Media
		}
		mediaInherited := input.MediaInherited == nil && (len(mediaInputs) == 0 || publicationMediaInputsEqual(mediaInputs, canonicalMedia))
		if input.MediaInherited != nil {
			mediaInherited = *input.MediaInherited
		}
		segment.MediaInherited = mediaInherited
		if _, err := tx.NewUpdate().Model(segment).Column("media_inherited").Where("id = ?", segment.ID).Exec(ctx); err != nil {
			return err
		}
		if mediaInherited {
			mediaInputs = canonicalMedia
		} else if len(mediaInputs) == 0 && input.MediaInherited == nil && position < len(canonicalInputs) {
			mediaInputs = canonicalInputs[position].Media
		}
		for order, media := range mediaInputs {
			role := publicationFirstNonEmpty(media.Role, "attachment")
			row := models.RenditionSegmentMedia{
				RenditionSegmentID:   segment.ID,
				MediaID:              media.MediaID,
				Role:                 role,
				DisplayOrder:         order,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
				SettingsJSON:         publicationMediaSettingsJSON(media.Settings),
			}
			if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
				return err
			}
			if _, seen := legacyMediaSeen[media.MediaID]; seen {
				continue
			}
			legacyMediaSeen[media.MediaID] = struct{}{}
			legacy := models.RenditionMedia{
				RenditionID:          rendition.ID,
				MediaID:              media.MediaID,
				Role:                 role,
				DisplayOrder:         len(legacyMediaSeen) - 1,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
			}
			if _, err := tx.NewInsert().Model(&legacy).Exec(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

func canonicalPublicationSegment(
	position int,
	requestedID string,
	segments []models.PublicationSegment,
	inputs []PublicationSegmentInput,
) models.PublicationSegment {
	canonical := models.PublicationSegment{}
	if position >= 0 && position < len(segments) {
		canonical = segments[position]
	}
	if requestedID == "" {
		return canonical
	}
	for candidatePosition, candidate := range segments {
		inputID := ""
		if candidatePosition < len(inputs) {
			inputID = inputs[candidatePosition].ID
		}
		if candidate.ID == requestedID || inputID == requestedID {
			return candidate
		}
	}
	return canonical
}

func (h *PublicationHandler) insertLegacyRenditionMedia(
	ctx context.Context,
	tx bun.Tx,
	renditionID string,
	segments []RenditionSegmentInput,
	canonicalInputs []PublicationSegmentInput,
) error {
	seen := map[string]struct{}{}
	displayOrder := 0
	for position, segment := range segments {
		mediaInputs := segment.Media
		if len(mediaInputs) == 0 && position < len(canonicalInputs) {
			mediaInputs = canonicalInputs[position].Media
		}
		for _, media := range mediaInputs {
			if _, ok := seen[media.MediaID]; ok {
				continue
			}
			seen[media.MediaID] = struct{}{}
			row := models.RenditionMedia{
				RenditionID:          renditionID,
				MediaID:              media.MediaID,
				Role:                 publicationFirstNonEmpty(media.Role, "attachment"),
				DisplayOrder:         displayOrder,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
			}
			if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
				return err
			}
			displayOrder++
		}
	}
	return nil
}

func (h *PublicationHandler) resolveRenditionCapability(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	account models.SocialAccount,
	input RenditionInput,
	segments []PublicationSegmentInput,
) capabilities.ResolvedCapability {
	canonical := make([]models.PublicationSegment, len(segments))
	for i, source := range segments {
		canonical[i] = models.PublicationSegment{ID: source.ID, Body: source.Body, Title: source.Title, URL: source.URL}
	}
	inputs := input.Segments
	if len(inputs) == 0 {
		inputs = make([]RenditionSegmentInput, len(segments))
		if len(inputs) > 0 {
			inputs[0] = RenditionSegmentInput{Body: input.Body, Title: input.Title, Media: input.Media}
		}
	}
	resolveSegments := make([]capabilities.ResolveSegment, 0, len(inputs))
	for position, variant := range inputs {
		source := canonicalPublicationSegment(position, variant.PublicationSegmentID, canonical, segments)
		if len(variant.SourceOverrides) > 0 {
			variant = projectJoinedSourceOverrides(variant, canonical, segments)
		}
		body := source.Body
		joined := len(inputs) == 1 && len(segments) > 1
		if joined {
			body = joinedPublicationBody(canonical)
		}
		mediaInputs := effectiveRenditionMedia(variant, source.ID, segments, joined)
		_, body = renditionTextOverride(variant.BodyOverride, variant.Body, body)
		_, title := renditionTextOverride(variant.TitleOverride, variant.Title, source.Title)
		_, uri := renditionTextOverride(variant.URLOverride, variant.URL, source.URL)
		resolveSegments = append(resolveSegments, capabilities.ResolveSegment{ID: publicationFirstNonEmpty(source.ID, fmt.Sprintf("segment-%d", position+1)), Body: body, Title: title, URL: uri, Media: h.capabilityMediaItems(ctx, db, mediaInputs)})
	}
	resolveInput := capabilities.ResolveInput{
		Intent:                 publication.Intent,
		CreationPreset:         publicationFirstNonEmpty(publication.CreationPreset, publication.Intent),
		RequestedOutputProfile: input.OutputProfile,
		SourceURL:              publication.SourceURL,
		Segments:               resolveSegments,
		Settings:               input.Settings,
	}
	// Source overrides still describe a joined authored inventory, even though
	// their effective text and media have already been projected above.
	if len(input.Segments) == 1 && len(input.Segments[0].SourceOverrides) > 0 {
		for i := 1; i < len(segments); i++ {
			resolveInput.Segments = append(resolveInput.Segments, capabilities.ResolveSegment{ID: segments[i].ID})
		}
	}
	if connectorCapabilities, connectorBacked, err := h.connectorCapabilitiesWithDB(ctx, db, account); err == nil && connectorBacked {
		return capabilities.ResolveCatalog(account.Platform, connectorCapabilities, resolveInput)
	}
	return capabilities.Resolve(account.Platform, resolveInput)
}

func effectiveRenditionMedia(variant RenditionSegmentInput, sourceID string, sources []PublicationSegmentInput, joined bool) []PublicationMediaInput {
	inherited := len(variant.Media) == 0
	if variant.MediaInherited != nil {
		inherited = *variant.MediaInherited
	}
	if !inherited || len(variant.SourceOverrides) > 0 {
		return variant.Media
	}
	var media []PublicationMediaInput
	for _, source := range sources {
		if joined || source.ID == sourceID {
			media = append(media, source.Media...)
		}
	}
	return uniqueJoinedMedia(media)
}

func (h *PublicationHandler) connectorCapabilitiesWithDB(
	ctx context.Context,
	db bun.IDB,
	account models.SocialAccount,
) ([]capabilities.Capability, bool, error) {
	if h == nil || h.connectors == nil || db == nil {
		return nil, false, nil
	}
	var binding models.ProviderAccountBinding
	err := db.NewSelect().Model(&binding).
		Where("workspace_id = ? AND social_account_id = ?", account.WorkspaceID, account.ID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	_, entry, err := h.connectors.ClientForWorkspace(binding.InstallationID, account.WorkspaceID)
	if err != nil {
		return nil, true, err
	}
	if entry.Manifest.CapabilityRevision != binding.CapabilityRevision {
		return nil, true, fmt.Errorf("connector capabilities changed; reconnect account before publishing")
	}
	return entry.Capabilities(), true, nil
}

func renditionTextOverride(explicit *string, legacyValue, canonicalValue string) (*string, string) {
	if explicit != nil {
		value := *explicit
		return &value, value
	}
	if legacyValue != "" && legacyValue != canonicalValue {
		value := legacyValue
		return &value, value
	}
	return nil, canonicalValue
}

func joinedRenditionSegmentInput(
	canonicalSegments []models.PublicationSegment,
	canonicalInputs []PublicationSegmentInput,
	input RenditionInput,
) RenditionSegmentInput {
	bodies := make([]string, 0, len(canonicalSegments))
	media := make([]PublicationMediaInput, 0)
	for position, segment := range canonicalSegments {
		if body := strings.TrimSpace(segment.Body); body != "" {
			bodies = append(bodies, body)
		}
		if position < len(canonicalInputs) {
			media = append(media, canonicalInputs[position].Media...)
		}
	}
	joinedBody := strings.Join(bodies, "\n\n")
	segment := RenditionSegmentInput{
		PublicationSegmentID: canonicalSegments[0].ID,
		Body:                 joinedBody,
		Title:                canonicalSegments[0].Title,
		Description:          canonicalSegments[0].Description,
		URL:                  canonicalSegments[0].URL,
		Media:                uniqueJoinedMedia(media),
	}
	if input.Body != "" {
		segment.Body = input.Body
	}
	if input.Title != "" {
		segment.Title = input.Title
	}
	if input.Description != "" {
		segment.Description = input.Description
	}
	if len(input.Media) > 0 {
		segment.Media = input.Media
	}
	return segment
}

func publicationMediaInputsEqual(left, right []PublicationMediaInput) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].MediaID != right[index].MediaID ||
			publicationFirstNonEmpty(left[index].Role, "attachment") != publicationFirstNonEmpty(right[index].Role, "attachment") ||
			left[index].AltText != right[index].AltText ||
			left[index].ThumbnailTimestampMS != right[index].ThumbnailTimestampMS ||
			mustJSON(left[index].Settings) != mustJSON(right[index].Settings) {
			return false
		}
	}
	return true
}

func (h *PublicationHandler) capabilityMediaItems(ctx context.Context, db bun.IDB, inputs []PublicationMediaInput) []capabilities.MediaItem {
	ids := make([]string, 0, len(inputs))
	for _, input := range inputs {
		ids = append(ids, input.MediaID)
	}
	ids = uniqueNonEmpty(ids)
	if len(ids) == 0 {
		return nil
	}
	var rows []models.MediaAttachment
	if err := db.NewSelect().Model(&rows).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil
	}
	byID := make(map[string]models.MediaAttachment, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	out := make([]capabilities.MediaItem, 0, len(ids))
	for _, id := range ids {
		row := byID[id]
		out = append(out, capabilities.MediaItem{
			ID:              row.ID,
			MimeType:        row.MimeType,
			Size:            row.Size,
			Width:           row.Width,
			Height:          row.Height,
			DurationMS:      row.DurationMS,
			AnalysisStatus:  row.AnalysisStatus,
			AnalysisError:   row.AnalysisError,
			PublicURLReady:  row.PublicURLReady,
			PublicURLStatus: row.PublicURLStatus,
			PublicURLError:  row.PublicURLError,
		})
	}
	return out
}
