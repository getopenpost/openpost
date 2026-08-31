package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/aiprompts"
	"github.com/uptrace/bun"
)

type AIPromptHandler struct {
	service *aiprompts.Service
	db      *bun.DB
	auth    middleware.Authenticator
}

type AIPromptResponse struct {
	Key          string `json:"key"`
	Kind         string `json:"kind" enum:"base,platform"`
	Platform     string `json:"platform,omitempty"`
	Version      string `json:"default_version"`
	DefaultValue string `json:"default_value"`
	Value        string `json:"value"`
	Overridden   bool   `json:"overridden"`
	UpdatedBy    string `json:"updated_by,omitempty"`
	UpdatedAt    string `json:"updated_at,omitempty"`
}

type AIPromptsResponse struct {
	Prompts             []AIPromptResponse `json:"prompts"`
	FixedOutputContract string             `json:"fixed_output_contract"`
}

type ListAIPromptsOutput struct {
	Body AIPromptsResponse
}

type SaveAIPromptInput struct {
	Key  string `path:"key" doc:"Prompt catalogue key"`
	Body struct {
		Value string `json:"value" minLength:"1" maxLength:"20000"`
	}
}

type SaveAIPromptOutput struct {
	Body AIPromptResponse
}

func NewAIPromptHandler(service *aiprompts.Service, db *bun.DB, authenticator middleware.Authenticator) *AIPromptHandler {
	return &AIPromptHandler{service: service, db: db, auth: authenticator}
}

func (h *AIPromptHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.auth)
	huma.Register(api, huma.Operation{
		OperationID: "list-instance-ai-prompts", Method: http.MethodGet, Path: "/admin/ai-prompts",
		Summary: "List instance AI prompts", Tags: []string{"Admin"}, Middlewares: huma.Middlewares{authMiddleware},
	}, h.list)
	huma.Register(api, huma.Operation{
		OperationID: "save-instance-ai-prompt", Method: http.MethodPut, Path: "/admin/ai-prompts/{key}",
		Summary: "Save an instance AI prompt", Tags: []string{"Admin"}, Middlewares: huma.Middlewares{authMiddleware},
	}, h.save)
}

func (h *AIPromptHandler) list(ctx context.Context, _ *struct{}) (*ListAIPromptsOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	states, err := h.service.List(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list AI prompts")
	}
	response := AIPromptsResponse{
		Prompts:             make([]AIPromptResponse, 0, len(states)),
		FixedOutputContract: aiprompts.FixedPostGenerationOutputPrompt,
	}
	for _, state := range states {
		response.Prompts = append(response.Prompts, aiPromptResponse(state))
	}
	return &ListAIPromptsOutput{Body: response}, nil
}

func (h *AIPromptHandler) save(ctx context.Context, input *SaveAIPromptInput) (*SaveAIPromptOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	state, err := h.service.Save(ctx, middleware.GetUserID(ctx), input.Key, input.Body.Value)
	if err != nil {
		switch {
		case errors.Is(err, aiprompts.ErrUnknownPrompt):
			return nil, huma.Error404NotFound("AI prompt not found")
		case errors.Is(err, aiprompts.ErrInvalidPrompt):
			return nil, huma.Error400BadRequest("AI prompt must contain between 1 and 20000 characters")
		default:
			return nil, huma.Error500InternalServerError("failed to save AI prompt")
		}
	}
	return &SaveAIPromptOutput{Body: aiPromptResponse(state)}, nil
}

func aiPromptResponse(state aiprompts.State) AIPromptResponse {
	response := AIPromptResponse{
		Key: state.Key, Kind: state.Kind, Platform: state.Platform, Version: state.Version,
		DefaultValue: state.Default, Value: state.Value, Overridden: state.Overridden, UpdatedBy: state.UpdatedBy,
	}
	if !state.UpdatedAt.IsZero() {
		response.UpdatedAt = state.UpdatedAt.Format(time.RFC3339)
	}
	return response
}
