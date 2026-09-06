package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/accountfeatures"
)

type AccountFeaturesHandler struct {
	service *accountfeatures.Service
	auth    middleware.Authenticator
}

func NewAccountFeaturesHandler(service *accountfeatures.Service, auth middleware.Authenticator) *AccountFeaturesHandler {
	return &AccountFeaturesHandler{service: service, auth: auth}
}

type ReadAccountFeaturesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	AccountIDs  string `query:"account_ids" required:"true" doc:"Comma-separated account IDs"`
}

type FeatureStateResponse struct {
	WorkspaceID       string   `json:"workspace_id" doc:"Workspace ID"`
	SocialAccountID   string   `json:"social_account_id" doc:"Social account ID"`
	Platform          string   `json:"platform" doc:"Provider key"`
	Feature           string   `json:"feature" enum:"messaging,engagement,analytics,grow" doc:"Feature key"`
	Supported         bool     `json:"supported" doc:"Whether provider supports this feature"`
	Availability      string   `json:"availability" enum:"available,unsupported,missing_scope,plan_restricted" doc:"Availability state"`
	ReasonCode        string   `json:"reason_code" enum:"available,unsupported,missing_scope,plan_restricted" doc:"Stable reason code"`
	RequiredScopes    []string `json:"required_scopes,omitempty" doc:"Required provider scopes for this feature"`
	MissingScopes     []string `json:"missing_scopes,omitempty" doc:"Provider scopes missing for this feature"`
	UnavailableReason string   `json:"unavailable_reason,omitempty" doc:"Why feature is unavailable"`
	StoredExists      bool     `json:"stored_exists" doc:"Whether a choice has been stored"`
	StoredEnabled     bool     `json:"stored_enabled" doc:"Stored enabled value"`
	DecidedByUserID   string   `json:"decided_by_user_id,omitempty" doc:"User who decided"`
	Source            string   `json:"source,omitempty" doc:"Source of decision"`
	DecidedAt         *string  `json:"decided_at,omitempty" doc:"When decision was made"`
	EffectiveEnabled  bool     `json:"effective_enabled" doc:"Effective enabled state (fail-closed)"`
}

type ReadAccountFeaturesOutput struct {
	Body []FeatureStateResponse `json:"features"`
}

type SaveAccountFeaturesInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		Choices     []struct {
			AccountID string `json:"account_id" doc:"Account ID"`
			Feature   string `json:"feature" enum:"messaging,engagement,analytics,grow" doc:"Feature key"`
			Enabled   bool   `json:"enabled" doc:"Enabled value"`
			Source    string `json:"source,omitempty" doc:"Decision source"`
		} `json:"choices" doc:"Choices to save (complete batch)"`
	}
}

type SaveAccountFeaturesOutput struct {
	Body []FeatureStateResponse `json:"features"`
}

func (h *AccountFeaturesHandler) ReadFeatures(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "read-account-features",
		Method:      http.MethodGet,
		Path:        "/account-features",
		Summary:     "Read feature settings for selected accounts",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *ReadAccountFeaturesInput) (*ReadAccountFeaturesOutput, error) {
		workspaceID := strings.TrimSpace(input.WorkspaceID)
		rawIDs := strings.TrimSpace(input.AccountIDs)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest("workspace_id is required")
		}
		if rawIDs == "" {
			return nil, huma.Error400BadRequest("account_ids is required")
		}
		parts := strings.Split(rawIDs, ",")
		ids := make([]string, 0, len(parts))
		for _, p := range parts {
			if v := strings.TrimSpace(p); v != "" {
				ids = append(ids, v)
			}
		}
		if len(ids) == 0 {
			return nil, huma.Error400BadRequest("account_ids is required")
		}
		actor := workspaceActor(ctx, middleware.GetUserID(ctx))
		// Authorize read via service
		resolved, err := h.service.Read(ctx, workspaceID, actor, ids)
		if err != nil {
			if errors.Is(err, accountfeatures.ErrWorkspaceReadDenied) {
				return nil, huma.Error403Forbidden("workspace read denied")
			}
			if errors.Is(err, accountfeatures.ErrAccountNotFound) || errors.Is(err, accountfeatures.ErrAccountWrongWorkspace) {
				return nil, huma.Error404NotFound(err.Error())
			}
			if errors.Is(err, accountfeatures.ErrUnknownFeature) {
				return nil, huma.Error400BadRequest(err.Error())
			}
			return nil, huma.Error400BadRequest(err.Error())
		}
		out := &ReadAccountFeaturesOutput{Body: toFeatureResponses(resolved)}
		return out, nil
	})
}

func (h *AccountFeaturesHandler) SaveFeatures(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "save-account-features",
		Method:      http.MethodPost,
		Path:        "/account-features",
		Summary:     "Save a complete batch of feature choices",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *SaveAccountFeaturesInput) (*SaveAccountFeaturesOutput, error) {
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest("workspace_id is required")
		}
		if len(input.Body.Choices) == 0 {
			return nil, huma.Error400BadRequest("choices are required")
		}
		choices := make([]accountfeatures.ChoiceInput, 0, len(input.Body.Choices))
		for _, c := range input.Body.Choices {
			choices = append(choices, accountfeatures.ChoiceInput{
				AccountID: strings.TrimSpace(c.AccountID),
				Feature:   strings.TrimSpace(c.Feature),
				Enabled:   c.Enabled,
				Source:    strings.TrimSpace(c.Source),
			})
		}
		actor := workspaceActor(ctx, middleware.GetUserID(ctx))
		resolved, err := h.service.BatchSave(ctx, workspaceID, actor, choices)
		if err != nil {
			if errors.Is(err, accountfeatures.ErrWorkspaceEditDenied) {
				return nil, huma.Error403Forbidden("workspace edit denied")
			}
			if errors.Is(err, accountfeatures.ErrAccountNotFound) || errors.Is(err, accountfeatures.ErrAccountWrongWorkspace) {
				return nil, huma.Error404NotFound(err.Error())
			}
			if errors.Is(err, accountfeatures.ErrUnknownFeature) {
				return nil, huma.Error400BadRequest(err.Error())
			}
			return nil, huma.Error400BadRequest(err.Error())
		}
		return &SaveAccountFeaturesOutput{Body: toFeatureResponses(resolved)}, nil
	})
}

func toFeatureResponses(in []accountfeatures.ResolvedFeature) []FeatureStateResponse {
	out := make([]FeatureStateResponse, 0, len(in))
	for _, r := range in {
		var decidedAt *string
		if r.DecidedAt != nil {
			s := r.DecidedAt.UTC().Format("2006-01-02T15:04:05Z")
			decidedAt = &s
		}
		out = append(out, FeatureStateResponse{
			WorkspaceID:       r.WorkspaceID,
			SocialAccountID:   r.SocialAccountID,
			Platform:          r.Platform,
			Feature:           r.Feature,
			Supported:         r.Supported,
			Availability:      r.Availability,
			ReasonCode:        r.ReasonCode,
			RequiredScopes:    r.RequiredScopes,
			MissingScopes:     r.MissingScopes,
			UnavailableReason: r.UnavailableReason,
			StoredExists:      r.StoredExists,
			StoredEnabled:     r.StoredEnabled,
			DecidedByUserID:   r.DecidedByUserID,
			Source:            r.Source,
			DecidedAt:         decidedAt,
			EffectiveEnabled:  r.EffectiveEnabled,
		})
	}
	return out
}
