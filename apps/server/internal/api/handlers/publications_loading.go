package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"sort"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/uptrace/bun"
)

func (h *PublicationHandler) loadPublicationResponse(ctx context.Context, publicationID, userID string) (PublicationResponse, error) {
	publication, err := h.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return PublicationResponse{}, err
	}
	responses, err := h.loadPublicationResponses(ctx, []models.Publication{*publication})
	if err != nil {
		return PublicationResponse{}, err
	}
	if len(responses) != 1 {
		return PublicationResponse{}, huma.Error500InternalServerError("failed to load publication")
	}
	return responses[0], nil
}

func (h *PublicationHandler) loadCanonicalSegmentInputsWithDB(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) ([]models.PublicationSegment, []PublicationSegmentInput, error) {
	var segments []models.PublicationSegment
	if err := db.NewSelect().
		Model(&segments).
		Where("publication_id = ?", publicationID).
		Order("position ASC").
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return nil, nil, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load publication segments")
	}
	inputs := make([]PublicationSegmentInput, 0, len(segments))
	for _, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		inputs = append(inputs, PublicationSegmentInput{
			ID:          segment.ID,
			Body:        segment.Body,
			Title:       segment.Title,
			Description: segment.Description,
			URL:         segment.URL,
			Settings:    settings,
		})
	}
	if len(segments) == 0 {
		return segments, inputs, nil
	}
	var mediaRows []models.PublicationSegmentMedia
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		segmentIDs = append(segmentIDs, segment.ID)
	}
	if err := db.NewSelect().
		Model(&mediaRows).
		Where("segment_id IN (?)", bun.List(segmentIDs)).
		Order("segment_id ASC", "display_order ASC").
		Scan(ctx); err != nil {
		return nil, nil, huma.Error500InternalServerError("failed to load publication segment media")
	}
	positionByID := make(map[string]int, len(segments))
	for position, segment := range segments {
		positionByID[segment.ID] = position
	}
	for _, row := range mediaRows {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(row.SettingsJSON), &settings)
		position := positionByID[row.SegmentID]
		inputs[position].Media = append(inputs[position].Media, PublicationMediaInput{
			MediaID:              row.MediaID,
			Role:                 row.Role,
			AltText:              row.AltText,
			ThumbnailTimestampMS: row.ThumbnailTimestampMS,
			Settings:             settings,
		})
	}
	return segments, inputs, nil
}

func (h *PublicationHandler) loadRenditionSegmentResponsesWithDB(
	ctx context.Context,
	db bun.IDB,
	rendition models.Rendition,
) ([]RenditionSegmentResponse, error) {
	var segments []models.RenditionSegment
	if err := db.NewSelect().
		Model(&segments).
		Where("rendition_id = ?", rendition.ID).
		Order("position ASC").
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return []RenditionSegmentResponse{{
				ID:                   "legacy:" + rendition.ID,
				PublicationSegmentID: "legacy:" + rendition.PublicationID,
				Position:             0,
				Body:                 rendition.Body,
				Title:                rendition.Title,
				Description:          rendition.Description,
				MediaInherited:       true,
				Settings:             map[string]interface{}{},
				Status:               rendition.Status,
				ExternalID:           rendition.ExternalID,
				ExternalURL:          rendition.ExternalURL,
				ErrorMessage:         rendition.ErrorMessage,
				ErrorKind:            rendition.ErrorKind,
				ErrorCode:            rendition.ErrorCode,
				ErrorHTTPStatus:      rendition.ErrorHTTPStatus,
				ErrorRetryable:       rendition.ErrorRetryable,
				ErrorRetryAt:         formatOptionalTime(rendition.ErrorRetryAt),
				ErrorAction:          rendition.ErrorAction,
			}}, nil
		}
		return nil, huma.Error500InternalServerError("failed to load rendition segments")
	}
	if len(segments) == 0 {
		return []RenditionSegmentResponse{{
			ID:                   "legacy:" + rendition.ID,
			PublicationSegmentID: "legacy:" + rendition.PublicationID,
			Position:             0,
			Body:                 rendition.Body,
			Title:                rendition.Title,
			Description:          rendition.Description,
			MediaInherited:       true,
			Settings:             map[string]interface{}{},
			Status:               rendition.Status,
			ExternalID:           rendition.ExternalID,
			ExternalURL:          rendition.ExternalURL,
			ErrorMessage:         rendition.ErrorMessage,
			ErrorKind:            rendition.ErrorKind,
			ErrorCode:            rendition.ErrorCode,
			ErrorHTTPStatus:      rendition.ErrorHTTPStatus,
			ErrorRetryable:       rendition.ErrorRetryable,
			ErrorRetryAt:         formatOptionalTime(rendition.ErrorRetryAt),
			ErrorAction:          rendition.ErrorAction,
		}}, nil
	}
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		segmentIDs = append(segmentIDs, segment.ID)
	}
	mediaBySegment, err := h.loadRenditionSegmentMediaWithDB(ctx, db, segmentIDs)
	if err != nil {
		return nil, err
	}
	out := make([]RenditionSegmentResponse, 0, len(segments))
	for _, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		out = append(out, RenditionSegmentResponse{
			ID:                   segment.ID,
			PublicationSegmentID: segment.PublicationSegmentID,
			SourceOverrides:      readRenditionSourceOverrides(segment.SourceOverridesJSON),
			Position:             segment.Position,
			Body:                 segment.Body,
			Title:                segment.Title,
			Description:          segment.Description,
			URL:                  segment.URL,
			BodyOverride:         segment.BodyOverride,
			TitleOverride:        segment.TitleOverride,
			DescriptionOverride:  segment.DescriptionOverride,
			URLOverride:          segment.URLOverride,
			MediaInherited:       segment.MediaInherited,
			Settings:             settings,
			Status:               segment.Status,
			ExternalID:           segment.ExternalID,
			ExternalURL:          segment.ExternalURL,
			ErrorMessage:         segment.ErrorMessage,
			ErrorKind:            segment.ErrorKind,
			ErrorCode:            segment.ErrorCode,
			ErrorHTTPStatus:      segment.ErrorHTTPStatus,
			ErrorRetryable:       segment.ErrorRetryable,
			ErrorRetryAt:         formatOptionalTime(segment.ErrorRetryAt),
			ErrorAction:          segment.ErrorAction,
			Media:                authoredPublicationMedia(mediaBySegment[segment.ID]),
			OutputMedia:          mediaBySegment[segment.ID],
		})
	}
	return out, nil
}

func (h *PublicationHandler) loadRenditionSegmentMediaWithDB(
	ctx context.Context,
	db bun.IDB,
	segmentIDs []string,
) (map[string][]MediaSummary, error) {
	out := map[string][]MediaSummary{}
	if len(segmentIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		RenditionSegmentID   string `bun:"rendition_segment_id"`
		Role                 string `bun:"role"`
		DisplayOrder         int    `bun:"display_order"`
		AltText              string `bun:"context_alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		SettingsJSON         string `bun:"settings_json"`
		models.MediaAttachment
	}
	if err := db.NewSelect().
		TableExpr("rendition_segment_media AS rsm").
		ColumnExpr("rsm.rendition_segment_id, rsm.role, rsm.display_order, rsm.alt_text AS context_alt_text, rsm.thumbnail_timestamp_ms, rsm.settings_json").
		ColumnExpr("m.*").
		Join("JOIN media_attachments AS m ON m.id = rsm.media_id").
		Where("rsm.rendition_segment_id IN (?)", bun.List(segmentIDs)).
		Order("rsm.rendition_segment_id ASC", "rsm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to load rendition segment media")
	}
	for _, row := range rows {
		item := mediaSummary(
			row.MediaAttachment,
			row.Role,
			row.DisplayOrder,
			row.AltText,
			row.ThumbnailTimestampMS,
		)
		_ = json.Unmarshal([]byte(row.SettingsJSON), &item.Settings)
		if row.Role == "text_card" {
			item.Settings = nil
		}
		out[row.RenditionSegmentID] = append(out[row.RenditionSegmentID], item)
	}
	return out, nil
}

func (h *PublicationHandler) loadPublication(ctx context.Context, publicationID, userID string) (*models.Publication, error) {
	publicationID = publicationPathID(publicationID)
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error404NotFound("publication not found")
	}
	if err := h.checkWorkspaceAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, err
	}
	return &publication, nil
}

func (h *PublicationHandler) loadPublicationForEdit(ctx context.Context, publicationID, userID string) (*models.Publication, error) {
	publication, err := h.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return nil, err
	}
	if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, err
	}
	if !isPublicationEditable(publication.Status) {
		return nil, huma.Error400BadRequest(errPublicationNotEditable.Error())
	}
	return publication, nil
}

func (h *PublicationHandler) loadEditablePublicationTx(ctx context.Context, tx bun.Tx, publicationID string) (*models.Publication, error) {
	return h.loadPublicationForMutationTx(ctx, tx, publicationID)
}

func (h *PublicationHandler) loadPublicationForMutationTx(ctx context.Context, tx bun.Tx, publicationID string) (*models.Publication, error) {
	return h.loadPublicationForMutationWithPolicyTx(ctx, tx, publicationID, false)
}

func (h *PublicationHandler) loadPublicationForDeleteTx(ctx context.Context, tx bun.Tx, publicationID string, additionalStatuses ...string) (*models.Publication, error) {
	return h.loadPublicationForMutationWithPolicyTx(ctx, tx, publicationID, true, additionalStatuses...)
}

func (h *PublicationHandler) loadPublicationForMutationWithPolicyTx(ctx context.Context, tx bun.Tx, publicationID string, allowPublishedAccepted bool, additionalStatuses ...string) (*models.Publication, error) {
	publicationID = publicationPathID(publicationID)
	if err := lockOrganizationForPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	if err := lockPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	var publication models.Publication
	if err := tx.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errPublicationNotFound
		}
		return nil, err
	}
	if !isPublicationEditable(publication.Status) && !slices.Contains(additionalStatuses, publication.Status) {
		return nil, errPublicationNotEditable
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	if allowPublishedAccepted {
		if err := h.rejectUnpublishedProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
			return nil, err
		}
	} else {
		if err := h.rejectProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
			return nil, err
		}
	}
	return &publication, nil
}

func isMissingWorkspaceTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: workspaces") ||
		(strings.Contains(message, `relation "workspaces"`) && strings.Contains(message, "does not exist"))
}

func publicationPathID(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

func lockPublicationMutationTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		if err := lockPrimaryPublicationQueueTx(ctx, tx, publicationID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errPublicationNotFound
			}
			return err
		}
		return nil
	}

	result, err := tx.NewUpdate().
		Model((*models.Publication)(nil)).
		Set("id = id").
		Where("id = ?", publicationID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errPublicationNotFound
	}
	return nil
}

func publicationMutationHTTPError(err error, fallback string) error {
	var conflict *drafts.ConflictError
	if errors.As(err, &conflict) {
		return conflict
	}
	if category, ok := publicationservice.CategoryOf(err); ok {
		switch category {
		case publicationservice.ErrorInvalidInput:
			return huma.Error400BadRequest(err.Error())
		case publicationservice.ErrorAccessDenied:
			return huma.Error403Forbidden("workspace access denied")
		case publicationservice.ErrorNotFound:
			return huma.Error404NotFound(err.Error())
		case publicationservice.ErrorRevisionConflict, publicationservice.ErrorInvalidLifecycleState,
			publicationservice.ErrorProviderReadiness:
			return huma.Error409Conflict(err.Error())
		case publicationservice.ErrorTemporaryUnavailable:
			return huma.Error503ServiceUnavailable(fmt.Sprintf("%s: %v", fallback, err))
		}
	}
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) {
		return statusErr
	}
	switch {
	case errors.As(err, new(*providerreadiness.NotReadyError)):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, publicationauth.ErrReviewRequired):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, errPublicationNotFound):
		return huma.Error404NotFound(errPublicationNotFound.Error())
	case errors.Is(err, errPublicationAlreadyProcessing):
		return huma.Error409Conflict(errPublicationAlreadyProcessing.Error())
	case errors.Is(err, errPublicationNotEditable),
		errors.Is(err, errPublicationNotScheduled),
		errors.Is(err, errPublicationScheduleConflict),
		errors.Is(err, errPublicationScheduleFuture),
		errors.Is(err, errPublicationValidationBlocked),
		errors.Is(err, errPublicationScheduleRequired):
		return huma.Error400BadRequest(err.Error())
	default:
		return huma.Error500InternalServerError(fallback)
	}
}

func isPublicationEditable(status string) bool {
	return status == models.PublicationStatusDraft || status == models.PublicationStatusScheduled
}

func (h *PublicationHandler) loadRenditionWithPublication(ctx context.Context, renditionID, userID string) (*models.Rendition, *models.Publication, error) {
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return nil, nil, huma.Error404NotFound("rendition not found")
	}
	publication, err := h.loadPublication(ctx, rendition.PublicationID, userID)
	if err != nil {
		return nil, nil, err
	}
	return &rendition, publication, nil
}

func (h *PublicationHandler) loadRenditionWithPublicationForEdit(ctx context.Context, renditionID, userID string) (*models.Rendition, *models.Publication, error) {
	rendition, publication, err := h.loadRenditionWithPublication(ctx, renditionID, userID)
	if err != nil {
		return nil, nil, err
	}
	if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, nil, err
	}
	return rendition, publication, nil
}

func (h *PublicationHandler) loadRenditionMediaWithDB(ctx context.Context, db bun.IDB, ids []string) (map[string][]MediaSummary, []MediaSummary, error) {
	out := map[string][]MediaSummary{}
	publicationMedia := []MediaSummary{}
	if len(ids) == 0 {
		return out, publicationMedia, nil
	}
	var rows []struct {
		RenditionID          string `bun:"rendition_id"`
		Role                 string `bun:"role"`
		DisplayOrder         int    `bun:"display_order"`
		AltText              string `bun:"context_alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		models.MediaAttachment
	}
	if err := db.NewSelect().
		TableExpr("rendition_media AS rm").
		ColumnExpr("rm.rendition_id, rm.role, rm.display_order, rm.alt_text AS context_alt_text, rm.thumbnail_timestamp_ms").
		ColumnExpr("m.*").
		Join("JOIN media_attachments AS m ON m.id = rm.media_id").
		Where("rm.rendition_id IN (?)", bun.List(ids)).
		Order("rm.rendition_id ASC", "rm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return out, publicationMedia, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load rendition media")
	}
	seenPublicationMedia := map[string]struct{}{}
	for _, row := range rows {
		item := mediaSummary(row.MediaAttachment, row.Role, row.DisplayOrder, row.AltText, row.ThumbnailTimestampMS)
		if item.Role == "text_card" {
			continue
		}
		out[row.RenditionID] = append(out[row.RenditionID], item)
		if _, ok := seenPublicationMedia[item.ID]; !ok {
			seenPublicationMedia[item.ID] = struct{}{}
			publicationMedia = append(publicationMedia, item)
		}
	}
	sort.Slice(publicationMedia, func(i, j int) bool { return publicationMedia[i].DisplayOrder < publicationMedia[j].DisplayOrder })
	return out, publicationMedia, nil
}

func (h *PublicationHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	if workspaceID == "" {
		return huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *PublicationHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *PublicationHandler) loadAccounts(ctx context.Context, workspaceID string, accountIDs []string) (map[string]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmpty(accountIDs)
	if len(uniqueIDs) == 0 {
		return map[string]models.SocialAccount{}, nil
	}
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().Model(&accounts).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate social accounts")
	}
	if len(accounts) != len(uniqueIDs) {
		return nil, huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
	}
	if installationID := middleware.GetInstallationID(ctx); installationID != "" {
		allowed, err := filterExternalAppAccounts(ctx, h.db, installationID, workspaceID, accounts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to apply external application account grants")
		}
		if len(allowed) != len(accounts) {
			return nil, huma.Error403Forbidden("external application is not granted one or more social accounts")
		}
	}
	out := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		out[account.ID] = account
	}
	return out, nil
}

func requireExternalDelegatedScope(ctx context.Context, required string) error {
	if middleware.GetInstallationID(ctx) == "" {
		return nil
	}
	if slices.Contains(strings.Fields(middleware.GetDelegatedScopes(ctx)), required) {
		return nil
	}
	return huma.Error403Forbidden("external application is missing the required permission")
}

func (h *PublicationHandler) requireExternalPublicationAccounts(ctx context.Context, publicationID string) error {
	installationID := middleware.GetInstallationID(ctx)
	if installationID == "" {
		return nil
	}
	publicationID = publicationPathID(publicationID)
	var accountIDs []string
	if err := h.db.NewSelect().Model((*models.Rendition)(nil)).
		ColumnExpr("DISTINCT social_account_id").
		Where("publication_id = ?", publicationID).
		Scan(ctx, &accountIDs); err != nil {
		return huma.Error500InternalServerError("failed to validate publication account grants")
	}
	if len(accountIDs) == 0 {
		return nil
	}
	count, err := h.db.NewSelect().Model((*models.ExternalAppAccountGrant)(nil)).
		Where("installation_id = ? AND social_account_id IN (?)", installationID, bun.List(accountIDs)).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate publication account grants")
	}
	if count != int64(len(accountIDs)) {
		return huma.Error403Forbidden("external application is not granted every publication account")
	}
	return nil
}

func (h *PublicationHandler) filterExternalPublicationRenditions(ctx context.Context, publication *PublicationResponse) error {
	installationID := middleware.GetInstallationID(ctx)
	if installationID == "" || publication == nil || len(publication.Renditions) == 0 {
		return nil
	}
	var grants []models.ExternalAppAccountGrant
	if err := h.db.NewSelect().Model(&grants).
		Where("installation_id = ? AND workspace_id = ?", installationID, publication.WorkspaceID).
		Scan(ctx); err != nil {
		return huma.Error500InternalServerError("failed to apply external application account grants")
	}
	allowed := make(map[string]struct{}, len(grants))
	for _, grant := range grants {
		allowed[grant.SocialAccountID] = struct{}{}
	}
	filtered := publication.Renditions[:0]
	for _, rendition := range publication.Renditions {
		if _, ok := allowed[rendition.SocialAccountID]; ok {
			filtered = append(filtered, rendition)
		}
	}
	publication.Renditions = filtered
	return nil
}

func (h *PublicationHandler) validateMediaBelongsToWorkspace(ctx context.Context, workspaceID string, mediaIDs []string) error {
	uniqueIDs := uniqueNonEmpty(mediaIDs)
	if len(uniqueIDs) == 0 {
		return nil
	}
	count, err := h.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate media attachments")
	}
	if count != int64(len(uniqueIDs)) {
		return huma.Error400BadRequest("one or more media attachments are invalid or outside this workspace")
	}
	return nil
}
