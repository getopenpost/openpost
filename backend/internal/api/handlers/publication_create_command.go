package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/uptrace/bun"
)

type preparedPublicationCreate struct {
	input              CreatePublicationBody
	accounts           map[string]models.SocialAccount
	repostOverrideJSON string
	now                time.Time
}

func (command publicationApplication) prepareCreate(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
) (preparedPublicationCreate, error) {
	if input.WorkspaceID == "" {
		return preparedPublicationCreate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, errors.New(errWorkspaceIDRequired))
	}
	now := command.now().UTC()
	if err := validatePublicationCreateTiming(input, now); err != nil {
		return preparedPublicationCreate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
	}
	if err := command.handler.checkWorkspaceEditAccess(ctx, input.WorkspaceID, userID); err != nil {
		return preparedPublicationCreate{}, err
	}

	if input.SocialSetID != "" {
		socialSetAccounts, err := loadSocialSetSnapshot(ctx, command.handler.db, input.WorkspaceID, input.SocialSetID)
		if err != nil {
			return preparedPublicationCreate{}, err
		}
		if len(input.Renditions) == 0 && len(input.SocialAccountIDs) == 0 {
			input.Renditions = socialSetRenditionInputs(socialSetAccounts)
		}
	}
	normalizePublicationCreateBody(&input)

	accountMap, err := command.handler.loadAccounts(ctx, input.WorkspaceID, renditionAccountIDs(input.Renditions))
	if err != nil {
		return preparedPublicationCreate{}, err
	}
	if err := command.handler.validateMediaBelongsToWorkspace(
		ctx,
		input.WorkspaceID,
		allPublicationMediaIDs(input.Media, input.Segments, input.Renditions),
	); err != nil {
		return preparedPublicationCreate{}, err
	}
	repostOverride := repostservice.Override{Mode: repostservice.ModeInherit}
	if input.RepostOverride != nil {
		repostOverride, err = command.handler.validateRepostOverride(ctx, input.WorkspaceID, userID, *input.RepostOverride)
		if err != nil {
			return preparedPublicationCreate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
		}
	}
	repostOverrideJSON, err := repostservice.EncodeOverride(repostOverride)
	if err != nil {
		return preparedPublicationCreate{}, publicationservice.NewError(publicationservice.ErrorInvalidInput, err)
	}

	return preparedPublicationCreate{
		input:              input,
		accounts:           accountMap,
		repostOverrideJSON: repostOverrideJSON,
		now:                now,
	}, nil
}

func validatePublicationCreateTiming(input CreatePublicationBody, now time.Time) error {
	if input.RandomDelayMinutes != nil && (*input.RandomDelayMinutes < 0 || *input.RandomDelayMinutes > 60) {
		return fmt.Errorf("random_delay_minutes must be between 0 and 60")
	}
	if input.ScheduledAt != nil {
		return validateFuturePublicationSchedule(*input.ScheduledAt, now)
	}
	return nil
}

func (command publicationApplication) persistCreate(
	ctx context.Context,
	publication *models.Publication,
	prepared preparedPublicationCreate,
) (PublicationResponse, error) {
	var response PublicationResponse
	err := command.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		response, err = command.persistCreateTx(txCtx, tx, publication, prepared)
		return err
	})
	return response, err
}

func (command publicationApplication) persistCreateTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	prepared preparedPublicationCreate,
) (PublicationResponse, error) {
	if _, err := tx.NewInsert().Model(publication).Exec(ctx); err != nil {
		return PublicationResponse{}, fmt.Errorf("insert publication: %w", err)
	}
	segments, err := command.handler.insertPublicationSegments(ctx, tx, publication, prepared.input.Segments)
	if err != nil {
		return PublicationResponse{}, err
	}
	if err := command.handler.insertRenditions(
		ctx,
		tx,
		publication,
		segments,
		prepared.input.Segments,
		prepared.input.Renditions,
		prepared.input.Media,
		prepared.accounts,
	); err != nil {
		return PublicationResponse{}, err
	}
	responses, err := command.handler.loadPublicationResponsesWithDB(ctx, tx, []models.Publication{*publication})
	if err != nil {
		return PublicationResponse{}, err
	}
	if len(responses) != 1 {
		return PublicationResponse{}, errors.New("failed to load created publication")
	}
	return responses[0], nil
}

func normalizePublicationCreateBody(input *CreatePublicationBody) {
	if input.CreationPreset == "" {
		input.CreationPreset = input.Intent
	}
	if input.CreationPreset == "" {
		input.CreationPreset = publishingIntentForProfile(input.ContentProfile)
	}
	if input.ContentProfile == "" {
		input.ContentProfile = compatibilityProfileForIntent(input.CreationPreset)
	}
	if input.Intent == "" {
		input.Intent = input.CreationPreset
	}
	if len(input.Segments) == 0 {
		input.Segments = []PublicationSegmentInput{{
			Body:  input.SourceText,
			Title: input.Title,
			URL:   input.SourceURL,
			Media: input.Media,
		}}
	} else {
		firstSegment := input.Segments[0]
		input.SourceText = publicationFirstNonEmpty(input.SourceText, firstSegment.Body)
		input.SourceURL = publicationFirstNonEmpty(input.SourceURL, firstSegment.URL)
		input.Title = publicationFirstNonEmpty(input.Title, firstSegment.Title)
	}
	if len(input.Renditions) == 0 {
		input.Renditions = defaultPublicationRenditionInputs(
			input.SocialAccountIDs,
			input.ContentProfile,
			input.SourceText,
			input.Title,
			input.Media,
		)
	}
}

func publicationModelFromCreate(input CreatePublicationBody, userID, repostOverrideJSON string, now time.Time) *models.Publication {
	publication := &models.Publication{
		ID:              uuid.NewString(),
		WorkspaceID:     input.WorkspaceID,
		CreatedByID:     userID,
		Title:           publicationFirstNonEmpty(input.Title, firstContentLine(input.SourceText), "Untitled publication"),
		Intent:          input.Intent,
		CreationPreset:  input.CreationPreset,
		SocialSetID:     input.SocialSetID,
		ContentProfile:  input.ContentProfile,
		SourceText:      input.SourceText,
		SourceContent:   input.SourceText,
		SourceURL:       input.SourceURL,
		Goal:            input.Goal,
		Audience:        input.Audience,
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    mustJSON(input.Metadata),
		ReleasePlanJSON: mustJSON(input.Metadata),
		RepostOverride:  repostOverrideJSON,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if input.ScheduledAt != nil {
		publication.ScheduledAt = input.ScheduledAt.UTC()
	}
	if input.RandomDelayMinutes != nil {
		publication.RandomDelayMinutes = *input.RandomDelayMinutes
		publication.RandomDelayExplicit = true
	}
	return publication
}

func defaultPublicationRenditionInputs(
	accountIDs []string,
	profile string,
	body string,
	title string,
	media []PublicationMediaInput,
) []RenditionInput {
	out := make([]RenditionInput, 0, len(accountIDs))
	for _, accountID := range uniqueNonEmpty(accountIDs) {
		out = append(out, RenditionInput{
			SocialAccountID: accountID,
			Profile:         profile,
			Body:            body,
			Title:           title,
			Media:           media,
		})
	}
	return out
}
