package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationdiscovery"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/uptrace/bun"
)

const (
	publicationDiscoveryPath              = "/publication-opportunities/discover"
	publicationDiscoveryTag               = "Publication Discovery"
	publicationDiscoveryRequestsPerMinute = 6
)

type PublicationDiscoveryHandler struct {
	db         *bun.DB
	auth       middleware.Authenticator
	discoverer publicationdiscovery.Discoverer
	voices     *voiceprofiles.Service
	limiter    *ratelimit.Limiter
	requests   *requestConcurrencyLimiter
}

func NewPublicationDiscoveryHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	discoverer publicationdiscovery.Discoverer,
) *PublicationDiscoveryHandler {
	return &PublicationDiscoveryHandler{
		db: db, auth: authenticator, discoverer: discoverer, voices: voiceprofiles.New(db),
		limiter: ratelimit.New(), requests: newRequestConcurrencyLimiter(4, 1),
	}
}

type DiscoverPublicationOpportunitiesInput struct {
	Body struct {
		WorkspaceID        string                                          `json:"workspace_id" required:"true" doc:"Workspace whose editor is requesting opportunities"`
		Focus              string                                          `json:"focus,omitempty" maxLength:"1000" doc:"Optional subject, project, niche, or current objective"`
		Audience           string                                          `json:"audience,omitempty" maxLength:"500" doc:"People the opportunities should matter to"`
		VoiceProfileID     string                                          `json:"voice_profile_id,omitempty" doc:"Optional Workspace Voice Profile; defaults to the Workspace identity"`
		Platforms          []string                                        `json:"platforms" minItems:"1" maxItems:"5" uniqueItems:"true" doc:"Selected native destination platforms"`
		RecentPublications []publicationdiscovery.RecentPublicationSummary `json:"recent_publications,omitempty" maxItems:"30" doc:"Recent Publications used only to avoid repetition"`
		Limit              int                                             `json:"limit,omitempty" minimum:"1" maximum:"8" default:"6" doc:"Maximum opportunity cards to return"`
	}
}

type DiscoverPublicationOpportunitiesOutput struct {
	Body publicationdiscovery.DiscoveryResult
}

func (handler *PublicationDiscoveryHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "discover-publication-opportunities",
		Method:      http.MethodPost,
		Path:        publicationDiscoveryPath,
		Summary:     "Discover current content opportunities",
		Description: "Returns tailored idea cards with selectable angles and platform treatments. It never drafts or publishes a post.",
		Tags:        []string{publicationDiscoveryTag},
		Errors:      []int{400, 401, 403, 429, 502, 503, 504},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, handler.auth)},
	}, handler.discover)
}

func (handler *PublicationDiscoveryHandler) discover(
	ctx context.Context,
	input *DiscoverPublicationOpportunitiesInput,
) (*DiscoverPublicationOpportunitiesOutput, error) {
	if handler == nil || handler.db == nil || handler.discoverer == nil {
		return nil, huma.Error503ServiceUnavailable("Publication discovery is unavailable")
	}
	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	if userID == "" {
		return nil, huma.Error401Unauthorized("authentication required")
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	allowed, err := workspaceEditAllowed(ctx, handler.db, workspaceID, userID)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("Workspace access could not be checked")
	}
	if !allowed {
		return nil, huma.Error403Forbidden("workspace editor role required")
	}
	if handler.limiter == nil || !handler.limiter.Allow("publication-discovery:"+userID, publicationDiscoveryRequestsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("Publication discovery limit reached; try again in one minute")
	}
	release, acquired := handler.requests.acquire(userID)
	if !acquired {
		return nil, huma.Error429TooManyRequests("Another discovery request is still running; try again shortly")
	}
	defer release()

	voice, err := handler.loadDiscoveryVoice(ctx, workspaceID, input.Body.VoiceProfileID)
	if err != nil {
		return nil, err
	}
	recent, err := handler.loadDiscoveryRecentPublications(ctx, workspaceID, input.Body.RecentPublications)
	if err != nil {
		return nil, err
	}
	result, err := handler.discoverer.Discover(ctx, publicationdiscovery.Input{
		Focus: input.Body.Focus, Audience: input.Body.Audience, Voice: voice,
		Platforms: input.Body.Platforms, RecentPublications: recent,
		Limit: input.Body.Limit,
	})
	if err != nil {
		return nil, publicationDiscoveryError(err)
	}
	return &DiscoverPublicationOpportunitiesOutput{Body: result}, nil
}

func (handler *PublicationDiscoveryHandler) loadDiscoveryVoice(
	ctx context.Context,
	workspaceID string,
	profileID string,
) (publicationdiscovery.VoiceContext, error) {
	if handler.voices == nil {
		return publicationdiscovery.VoiceContext{}, huma.Error503ServiceUnavailable("Voice Profiles are unavailable")
	}
	var (
		profile voiceprofiles.Profile
		err     error
	)
	if profileID = strings.TrimSpace(profileID); profileID == "" {
		profile, err = handler.voices.Default(ctx, workspaceID)
	} else {
		profile, err = handler.voices.Get(ctx, workspaceID, profileID)
	}
	if err != nil {
		return publicationdiscovery.VoiceContext{}, publicationBuildVoiceError(err)
	}
	return publicationdiscovery.VoiceContext{Name: profile.Name, Definition: profile.Definition}, nil
}

func (handler *PublicationDiscoveryHandler) loadDiscoveryRecentPublications(
	ctx context.Context,
	workspaceID string,
	supplied []publicationdiscovery.RecentPublicationSummary,
) ([]publicationdiscovery.RecentPublicationSummary, error) {
	var rows []models.Publication
	if err := handler.db.NewSelect().Model(&rows).
		Where("workspace_id = ?", workspaceID).
		OrderExpr("updated_at DESC").
		Limit(30).
		Scan(ctx); err != nil {
		return nil, huma.Error503ServiceUnavailable("Recent Publications could not be loaded")
	}
	recent := make([]publicationdiscovery.RecentPublicationSummary, 0, 30)
	seen := make(map[string]struct{}, 30)
	appendRecent := func(item publicationdiscovery.RecentPublicationSummary) {
		item.Summary = strings.TrimSpace(item.Summary)
		key := strings.ToLower(item.Summary)
		if item.Summary == "" || item.PublishedAt.IsZero() || len(recent) >= 30 {
			return
		}
		if _, duplicate := seen[key]; duplicate {
			return
		}
		seen[key] = struct{}{}
		recent = append(recent, item)
	}
	for _, row := range rows {
		summary := firstNonEmptyDiscoveryText(row.SourceText, row.Title)
		publishedAt := row.ActualRunAt
		if publishedAt.IsZero() {
			publishedAt = row.UpdatedAt
		}
		if publishedAt.IsZero() {
			publishedAt = row.CreatedAt
		}
		appendRecent(publicationdiscovery.RecentPublicationSummary{
			PublishedAt: publishedAt.UTC(), Summary: boundedDiscoverySummary(summary),
		})
	}
	for _, item := range supplied {
		appendRecent(item)
	}
	return recent, nil
}

func firstNonEmptyDiscoveryText(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func boundedDiscoverySummary(value string) string {
	characters := []rune(strings.TrimSpace(value))
	if len(characters) <= 800 {
		return string(characters)
	}
	return strings.TrimSpace(string(characters[:799])) + "…"
}

func publicationDiscoveryError(err error) error {
	switch {
	case errors.Is(err, publicationdiscovery.ErrInvalidInput):
		return huma.Error400BadRequest("Publication discovery context is invalid")
	case errors.Is(err, publicationdiscovery.ErrUnavailable):
		return huma.Error503ServiceUnavailable("Publication discovery is unavailable")
	case errors.Is(err, context.DeadlineExceeded):
		return huma.Error504GatewayTimeout("Publication discovery timed out")
	case errors.Is(err, context.Canceled):
		return huma.Error503ServiceUnavailable("Publication discovery was canceled")
	case errors.Is(err, publicationdiscovery.ErrInvalidOutput):
		return huma.Error502BadGateway("Publication discovery returned an invalid response")
	default:
		return huma.Error502BadGateway("Publication discovery failed")
	}
}
