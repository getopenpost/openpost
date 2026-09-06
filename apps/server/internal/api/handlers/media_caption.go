package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/imagecaption"
	"github.com/openpost/backend/internal/services/ratelimit"
)

const (
	imageCaptionRequestsPerMinute = 30
	imageCaptionRequestTimeout    = 15 * time.Second
	maxCaptionThumbnailBytes      = 2 * 1024 * 1024
)

var errCaptionThumbnailUnavailable = errors.New("caption thumbnail is unavailable")

type GenerateMediaAltTextInput struct {
	PathID string `path:"id" doc:"Media ID"`
	Body   struct {
		Locale      string `json:"locale,omitempty" maxLength:"35" pattern:"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$" doc:"BCP 47 locale for the generated alt text; defaults to English"`
		PostContext string `json:"post_context,omitempty" maxLength:"1000" doc:"Optional post text used only to disambiguate details visible in the image"`
	}
}

type GenerateMediaAltTextOutput struct {
	Body struct {
		AltText   string `json:"alt_text" doc:"Persisted alternative text"`
		Generated bool   `json:"generated" doc:"Whether this request generated and persisted new alternative text"`
		Model     string `json:"model" doc:"Model that generated the alternative text; empty when existing text was returned"`
	}
}

// RegisterImageCaptionRoutes adds the optional AI-backed media operation. It is
// separate from RegisterRoutes so callers can register the contract even when
// no caption provider is configured.
func (h *MediaHandler) RegisterImageCaptionRoutes(api huma.API, captioner imagecaption.Captioner) {
	limiter := ratelimit.New()

	huma.Register(api, huma.Operation{
		OperationID: "generate-media-alt-text",
		Method:      http.MethodPost,
		Path:        "/media/{id}/alt-text/generate",
		Summary:     "Generate alternative text for an image",
		Description: "Generates alternative text from the stored 400-pixel JPEG thumbnail and optional post text used as untrusted context, then saves it only when the media still has no alternative text.",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403, 404, 429, 502, 503},
	}, func(ctx context.Context, input *GenerateMediaAltTextInput) (*GenerateMediaAltTextOutput, error) {
		return h.generateMediaAltText(ctx, input, captioner, limiter)
	})
}

func (h *MediaHandler) generateMediaAltText(
	ctx context.Context,
	input *GenerateMediaAltTextInput,
	captioner imagecaption.Captioner,
	limiter *ratelimit.Limiter,
) (*GenerateMediaAltTextOutput, error) {
	userID := middleware.GetUserID(ctx)
	media, err := h.loadCaptionMedia(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if err := h.validateCaptionMedia(ctx, userID, media); err != nil {
		return nil, err
	}
	if existing := strings.TrimSpace(media.AltText); existing != "" {
		return mediaAltTextOutput(existing, false, ""), nil
	}
	if captioner == nil {
		return nil, huma.Error503ServiceUnavailable("automatic image captioning is not configured")
	}

	thumbnail, err := h.readCaptionThumbnail(ctx, media)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("the image preview is unavailable for captioning")
	}
	if !limiter.Allow("image-caption:"+userID, imageCaptionRequestsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("automatic image caption limit reached; try again in one minute")
	}

	requestCtx, cancel := context.WithTimeout(ctx, imageCaptionRequestTimeout)
	defer cancel()
	generated, err := captioner.Caption(requestCtx, imagecaption.Input{
		Image:       thumbnail,
		MIMEType:    "image/jpeg",
		Locale:      input.Body.Locale,
		PostContext: input.Body.PostContext,
	})
	if err != nil {
		log.Printf("automatic image caption failed for media %s (%T)", media.ID, err)
		return nil, imageCaptionError(err)
	}
	return h.persistGeneratedAltText(ctx, media, generated)
}

func (h *MediaHandler) loadCaptionMedia(ctx context.Context, mediaID string) (models.MediaAttachment, error) {
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return media, huma.Error404NotFound(errMediaNotFound)
		}
		return media, huma.Error503ServiceUnavailable("media captioning is temporarily unavailable")
	}
	return media, nil
}

func (h *MediaHandler) validateCaptionMedia(ctx context.Context, userID string, media models.MediaAttachment) error {
	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return huma.Error400BadRequest("deleted media cannot be captioned")
	}
	if media.ProcessingStatus != mediaReadyStatus {
		return huma.Error400BadRequest("media must finish processing before it can be captioned")
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(media.MimeType)), "image/") {
		return huma.Error400BadRequest("only images can be captioned")
	}
	return nil
}

func imageCaptionError(err error) error {
	if errors.Is(err, imagecaption.ErrInvalidInput) {
		return huma.Error400BadRequest("the requested caption locale is invalid")
	}
	var providerErr *ai.ProviderError
	if errors.As(err, &providerErr) && providerErr.StatusCode == http.StatusTooManyRequests {
		return huma.Error429TooManyRequests("automatic image captioning is rate limited; try again later")
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return huma.Error503ServiceUnavailable("automatic image captioning timed out")
	}
	return huma.Error502BadGateway("automatic image captioning failed")
}

func (h *MediaHandler) persistGeneratedAltText(
	ctx context.Context,
	media models.MediaAttachment,
	generated imagecaption.Result,
) (*GenerateMediaAltTextOutput, error) {
	altText := strings.TrimSpace(generated.AltText)
	if altText == "" {
		return nil, huma.Error502BadGateway("automatic image captioning returned no text")
	}
	result, err := h.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("alt_text = ?", altText).
		Where("id = ?", media.ID).
		Where("workspace_id = ?", media.WorkspaceID).
		Where("trashed_at IS NULL").
		Where("processing_status = ?", mediaReadyStatus).
		Where("TRIM(COALESCE(alt_text, '')) = ''").
		Exec(ctx)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to save the generated image caption")
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to confirm the generated image caption")
	}
	if rowsAffected == 1 {
		return mediaAltTextOutput(altText, true, strings.TrimSpace(generated.Model)), nil
	}

	var current models.MediaAttachment
	if err := h.db.NewSelect().Model(&current).Column("alt_text").Where("id = ?", media.ID).Scan(ctx); err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to load the current image caption")
	}
	currentAltText := strings.TrimSpace(current.AltText)
	if currentAltText == "" {
		return nil, huma.Error503ServiceUnavailable("failed to save the generated image caption")
	}
	return mediaAltTextOutput(currentAltText, false, ""), nil
}

func (h *MediaHandler) readCaptionThumbnail(ctx context.Context, media models.MediaAttachment) ([]byte, error) {
	if h.storage == nil {
		return nil, errCaptionThumbnailUnavailable
	}

	var thumbnails Thumbnails
	if err := json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbnails); err != nil {
		return nil, fmt.Errorf("%w: invalid thumbnail metadata", errCaptionThumbnailUnavailable)
	}
	thumbnailKey := strings.TrimSpace(thumbnails.MD)
	if thumbnailKey == "" {
		return nil, fmt.Errorf("%w: medium thumbnail is missing", errCaptionThumbnailUnavailable)
	}

	reader, err := h.storage.Open(ctx, thumbnailKey)
	if err != nil {
		return nil, fmt.Errorf("%w: open medium thumbnail", errCaptionThumbnailUnavailable)
	}
	defer reader.Close()

	data, err := io.ReadAll(io.LimitReader(reader, maxCaptionThumbnailBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read medium thumbnail", errCaptionThumbnailUnavailable)
	}
	if len(data) == 0 || len(data) > maxCaptionThumbnailBytes {
		return nil, fmt.Errorf("%w: medium thumbnail size is invalid", errCaptionThumbnailUnavailable)
	}
	return data, nil
}

func mediaAltTextOutput(altText string, generated bool, model string) *GenerateMediaAltTextOutput {
	output := &GenerateMediaAltTextOutput{}
	output.Body.AltText = altText
	output.Body.Generated = generated
	output.Body.Model = model
	return output
}
