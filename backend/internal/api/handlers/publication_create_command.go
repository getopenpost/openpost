package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	postservice "github.com/openpost/backend/internal/services/posts"
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
		return preparedPublicationCreate{}, huma.Error400BadRequest(errWorkspaceIDRequired)
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
			return preparedPublicationCreate{}, huma.Error400BadRequest(err.Error())
		}
	}
	repostOverrideJSON, err := repostservice.EncodeOverride(repostOverride)
	if err != nil {
		return preparedPublicationCreate{}, huma.Error400BadRequest(err.Error())
	}

	now := command.now().UTC()
	if input.ScheduledAt != nil {
		if err := validateFuturePublicationSchedule(*input.ScheduledAt, now); err != nil {
			return preparedPublicationCreate{}, huma.Error400BadRequest(err.Error())
		}
	}
	return preparedPublicationCreate{
		input:              input,
		accounts:           accountMap,
		repostOverrideJSON: repostOverrideJSON,
		now:                now,
	}, nil
}

func (command publicationApplication) persistCreate(
	ctx context.Context,
	publication *models.Publication,
	prepared preparedPublicationCreate,
) error {
	return command.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(publication).Exec(txCtx); err != nil {
			return fmt.Errorf("insert publication: %w", err)
		}
		segments, err := command.handler.insertPublicationSegments(txCtx, tx, publication, prepared.input.Segments)
		if err != nil {
			return err
		}
		if err := command.handler.insertRenditions(
			txCtx,
			tx,
			publication,
			segments,
			prepared.input.Segments,
			prepared.input.Renditions,
			prepared.input.Media,
			prepared.accounts,
		); err != nil {
			return err
		}
		_, err = postservice.EnsurePublicationEditorTx(txCtx, tx, publication)
		return err
	})
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
