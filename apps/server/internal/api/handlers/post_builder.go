package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/postgeneration"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/uptrace/bun"
)

const postBuilderRequestsPerMinute = 15

type PostBuilderHandler struct {
	db      *bun.DB
	auth    middleware.Authenticator
	builder postgeneration.Builder
	limiter *ratelimit.Limiter
}

type GeneratePostInput struct {
	Body struct {
		WorkspaceID      string   `json:"workspace_id" required:"true" doc:"Workspace ID"`
		Idea             string   `json:"idea" required:"true" minLength:"1" maxLength:"4000" doc:"Rough idea to turn into post copy"`
		SocialAccountIDs []string `json:"social_account_ids" required:"true" minItems:"1" maxItems:"12" uniqueItems:"true" doc:"Destinations to write for"`
	}
}

type GeneratePostOutput struct {
	Body struct {
		SourceText string                     `json:"source_text" doc:"Canonical publication copy"`
		Renditions []postgeneration.Rendition `json:"renditions" doc:"Destination-specific copy"`
		Model      string                     `json:"model" doc:"Model that generated the copy"`
	}
}

type ShortenPostInput struct {
	Body struct {
		WorkspaceID   string `json:"workspace_id" required:"true" doc:"Workspace ID"`
		Text          string `json:"text" required:"true" minLength:"1" maxLength:"12000" doc:"Post text to shorten"`
		Platform      string `json:"platform" required:"true" minLength:"1" maxLength:"64" doc:"Destination platform that counts the text"`
		MaxCharacters int    `json:"max_characters" required:"true" minimum:"1" maximum:"100000" doc:"Character limit the text must fit"`
	}
}

type ShortenPostOutput struct {
	Body postgeneration.ShortenResult
}

func NewPostBuilderHandler(db *bun.DB, auth middleware.Authenticator, builder postgeneration.Builder) *PostBuilderHandler {
	return &PostBuilderHandler{db: db, auth: auth, builder: builder, limiter: ratelimit.New()}
}

func (h *PostBuilderHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "generate-post",
		Method:      http.MethodPost,
		Path:        "/post-builder/generate",
		Summary:     "Build publication copy from an idea",
		Description: "Creates canonical and destination-specific copy for review. It does not save, schedule, or publish anything.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 429, 502, 503},
	}, h.generate)
	huma.Register(api, huma.Operation{
		OperationID: "shorten-post",
		Method:      http.MethodPost,
		Path:        "/post-builder/shorten",
		Summary:     "Shorten post text to fit a character limit",
		Description: "Returns lightly edited copy that fits the limit, or truncated copy when meaning cannot be kept. It does not save anything.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 429, 502, 503},
	}, h.shorten)
}

func (h *PostBuilderHandler) shorten(ctx context.Context, input *ShortenPostInput) (*ShortenPostOutput, error) {
	if h.db == nil {
		return nil, huma.Error503ServiceUnavailable("post builder is unavailable")
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	userID := middleware.GetUserID(ctx)
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to verify workspace access")
	}
	if !allowed {
		return nil, huma.Error403Forbidden("workspace access denied")
	}
	if h.builder == nil {
		return nil, huma.Error503ServiceUnavailable("AI post building is not configured")
	}
	if !h.limiter.Allow("post-builder:"+userID, postBuilderRequestsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("AI post building limit reached; try again in one minute")
	}
	result, err := h.builder.Shorten(ctx, postgeneration.ShortenInput{
		Text:          input.Body.Text,
		Platform:      input.Body.Platform,
		MaxCharacters: input.Body.MaxCharacters,
	})
	if err != nil {
		log.Printf("AI post shortening failed for workspace %s (%T)", workspaceID, err)
		return nil, postBuilderError(err)
	}
	return &ShortenPostOutput{Body: result}, nil
}

func (h *PostBuilderHandler) generate(ctx context.Context, input *GeneratePostInput) (*GeneratePostOutput, error) {
	if h.db == nil {
		return nil, huma.Error503ServiceUnavailable("post builder is unavailable")
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to verify workspace access")
	}
	if !allowed {
		return nil, huma.Error403Forbidden("workspace access denied")
	}
	if h.builder == nil {
		return nil, huma.Error503ServiceUnavailable("AI post building is not configured")
	}

	destinations, err := h.loadDestinations(ctx, workspaceID, input.Body.SocialAccountIDs)
	if err != nil {
		return nil, err
	}
	userID := middleware.GetUserID(ctx)
	if !h.limiter.Allow("post-builder:"+userID, postBuilderRequestsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("AI post building limit reached; try again in one minute")
	}

	result, err := h.builder.Build(ctx, postgeneration.Input{Idea: input.Body.Idea, Destinations: destinations})
	if err != nil {
		log.Printf("AI post building failed for workspace %s (%T)", workspaceID, err)
		return nil, postBuilderError(err)
	}
	output := &GeneratePostOutput{}
	output.Body.SourceText = result.SourceText
	output.Body.Renditions = result.Renditions
	output.Body.Model = result.Model
	return output, nil
}

func (h *PostBuilderHandler) loadDestinations(ctx context.Context, workspaceID string, accountIDs []string) ([]postgeneration.Destination, error) {
	if len(accountIDs) == 0 {
		return nil, huma.Error400BadRequest("choose at least one destination")
	}
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().Model(&accounts).
		Column("id", "platform").
		Where("workspace_id = ?", workspaceID).
		Where("is_active = TRUE").
		Where("id IN (?)", bun.List(accountIDs)).
		Scan(ctx); err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to load post destinations")
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		byID[account.ID] = account
	}
	destinations := make([]postgeneration.Destination, 0, len(accountIDs))
	seen := make(map[string]struct{}, len(accountIDs))
	for _, accountID := range accountIDs {
		accountID = strings.TrimSpace(accountID)
		account, ok := byID[accountID]
		if accountID == "" || !ok {
			return nil, huma.Error400BadRequest("one or more destinations are unavailable in this workspace")
		}
		if _, duplicate := seen[accountID]; duplicate {
			return nil, huma.Error400BadRequest("destinations must be unique")
		}
		seen[accountID] = struct{}{}
		destinations = append(destinations, postgeneration.Destination{
			AccountID: account.ID,
			Platform:  account.Platform,
			Profile:   models.ContentProfileShortText,
		})
	}
	return destinations, nil
}

func postBuilderError(err error) error {
	if errors.Is(err, postgeneration.ErrInvalidInput) {
		return huma.Error400BadRequest("the idea or destinations are invalid")
	}
	var providerErr *ai.ProviderError
	if errors.As(err, &providerErr) && providerErr.StatusCode == http.StatusTooManyRequests {
		return huma.Error429TooManyRequests("AI post building is rate limited; try again later")
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return huma.Error503ServiceUnavailable("AI post building timed out")
	}
	return huma.Error502BadGateway("AI post building failed")
}
