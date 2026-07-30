package handlers

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

type ProviderReadinessHandler struct {
	db        *bun.DB
	auth      middleware.Authenticator
	providers map[string]platform.Adapter
}

func NewProviderReadinessHandler(db *bun.DB, auth middleware.Authenticator, providers ...map[string]platform.Adapter) *ProviderReadinessHandler {
	handler := &ProviderReadinessHandler{db: db, auth: auth}
	if len(providers) > 0 {
		handler.providers = providers[0]
	}
	return handler
}

type ProviderReadinessInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type PublicMediaHealth struct {
	Status         string `json:"status"`
	CheckedCount   int    `json:"checked_count"`
	FailingCount   int    `json:"failing_count"`
	LastCheckedAt  string `json:"last_checked_at,omitempty"`
	LastFailure    string `json:"last_failure,omitempty"`
	LastStatusCode int    `json:"last_status_code,omitempty"`
}

type ProviderReadinessItem struct {
	Provider           string            `json:"provider"`
	ConfiguredAppState string            `json:"configured_app_state"`
	ConnectedAccounts  int               `json:"connected_accounts"`
	RequiredScopes     []string          `json:"required_scopes"`
	GrantedScopes      []string          `json:"granted_scopes,omitempty"`
	AccountTypes       []string          `json:"account_types,omitempty"`
	AppReviewWarnings  []string          `json:"app_review_warnings,omitempty"`
	PublicMediaHealth  PublicMediaHealth `json:"public_media_health"`
	QuotaCaveats       []string          `json:"quota_caveats,omitempty"`
	BlockingIssues     []string          `json:"blocking_issues,omitempty"`
	NextActions        []string          `json:"next_actions,omitempty"`
	SupportedProfiles  []string          `json:"supported_profiles"`
	CapabilityCaveats  []string          `json:"capability_caveats,omitempty"`
}

type ProviderReadinessOutput struct {
	Body struct {
		Providers []ProviderReadinessItem `json:"providers"`
	}
}

func (h *ProviderReadinessHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-provider-readiness",
		Method:      http.MethodGet,
		Path:        "/provider-readiness",
		Summary:     "Inspect provider readiness for a workspace",
		Tags:        []string{tagProviderReadiness},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *ProviderReadinessInput) (*ProviderReadinessOutput, error) {
		userID := middleware.GetUserID(ctx)
		if input.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}
		if err := providerReadinessWorkspaceAccess(ctx, h.db, input.WorkspaceID, userID); err != nil {
			return nil, err
		}

		apps, err := h.loadProviderApps(ctx)
		if err != nil {
			return nil, err
		}
		accounts, err := h.loadReadinessAccounts(ctx, input.WorkspaceID)
		if err != nil {
			return nil, err
		}
		mediaHealth, err := h.publicMediaHealth(ctx, input.WorkspaceID)
		if err != nil {
			return nil, err
		}

		resp := &ProviderReadinessOutput{}
		for _, provider := range readinessProviders() {
			resp.Body.Providers = append(resp.Body.Providers, buildProviderReadiness(provider, apps[provider], accounts[provider], mediaHealth))
		}
		return resp, nil
	})
}

func (h *ProviderReadinessHandler) loadProviderApps(ctx context.Context) (map[string]bool, error) {
	var apps []models.ProviderApp
	if err := h.db.NewSelect().Model(&apps).Where("is_active = ?", true).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load provider app configuration")
	}
	out := h.configuredProviderAdapters()
	for _, app := range apps {
		out[app.Provider] = app.ClientID != "" || app.Provider == capabilities.ProviderMastodon
	}
	return out, nil
}

func (h *ProviderReadinessHandler) configuredProviderAdapters() map[string]bool {
	out := map[string]bool{}
	for key, adapter := range h.providers {
		if adapter == nil {
			continue
		}
		provider := strings.SplitN(key, ":", 2)[0]
		if provider != "" {
			out[provider] = true
		}
	}
	return out
}

func (h *ProviderReadinessHandler) loadReadinessAccounts(ctx context.Context, workspaceID string) (map[string][]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().Model(&accounts).Where("workspace_id = ? AND is_active = ?", workspaceID, true).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load connected accounts")
	}
	out := map[string][]models.SocialAccount{}
	for _, account := range accounts {
		out[account.Platform] = append(out[account.Platform], account)
	}
	return out, nil
}

func (h *ProviderReadinessHandler) publicMediaHealth(ctx context.Context, workspaceID string) (PublicMediaHealth, error) {
	var media []models.MediaAttachment
	if err := h.db.NewSelect().
		Model(&media).
		Where("workspace_id = ?", workspaceID).
		Where("dominant_type = ? OR mime_type LIKE ?", "video", "video/%").
		Scan(ctx); err != nil {
		return PublicMediaHealth{}, huma.Error500InternalServerError("failed to load media health")
	}
	health := PublicMediaHealth{Status: "unknown"}
	for _, item := range media {
		if !item.PublicURLCheckedAt.IsZero() {
			health.CheckedCount++
			if health.LastCheckedAt == "" || item.PublicURLCheckedAt.Format(timeSortFormat) > health.LastCheckedAt {
				health.LastCheckedAt = item.PublicURLCheckedAt.UTC().Format(timeSortFormat)
			}
		}
		if item.PublicURLError != "" || item.PublicURLStatus >= 400 {
			health.FailingCount++
			health.LastFailure = item.PublicURLError
			health.LastStatusCode = item.PublicURLStatus
		}
	}
	switch {
	case len(media) == 0:
		health.Status = "unknown"
	case health.FailingCount > 0:
		health.Status = "degraded"
	default:
		health.Status = "healthy"
	}
	return health, nil
}

func buildProviderReadiness(provider string, configured bool, accounts []models.SocialAccount, mediaHealth PublicMediaHealth) ProviderReadinessItem {
	item := ProviderReadinessItem{
		Provider:           provider,
		ConfiguredAppState: configuredState(provider, configured),
		ConnectedAccounts:  len(accounts),
		RequiredScopes:     requiredScopes(provider),
		GrantedScopes:      grantedScopes(accounts),
		PublicMediaHealth:  mediaHealth,
		SupportedProfiles:  supportedProfiles(provider),
	}
	if item.ConfiguredAppState == "missing" {
		item.BlockingIssues = append(item.BlockingIssues, "provider_app_missing")
		item.NextActions = append(item.NextActions, "Configure provider OAuth credentials for "+provider)
	}
	if item.ConnectedAccounts == 0 {
		item.NextActions = append(item.NextActions, "Connect at least one "+provider+" account")
	}
	if providerRequiresPublicMedia(provider) && mediaHealth.Status == "degraded" {
		item.BlockingIssues = append(item.BlockingIssues, "public_url_unreachable")
		item.NextActions = append(item.NextActions, "Fix public HTTPS media delivery before publishing")
	}
	if len(item.GrantedScopes) > 0 && len(missingScopes(item.RequiredScopes, item.GrantedScopes)) > 0 {
		item.BlockingIssues = append(item.BlockingIssues, "missing_scope")
		item.NextActions = append(item.NextActions, "Reconnect "+provider+" with the required publishing scopes")
	}
	item.AppReviewWarnings = appReviewWarnings(provider)
	item.CapabilityCaveats = capabilityCaveats(provider)
	item.QuotaCaveats = quotaCaveats(provider)
	item.AccountTypes = accountTypes(provider)
	sort.Strings(item.BlockingIssues)
	return item
}

func grantedScopes(accounts []models.SocialAccount) []string {
	scopes := make([]string, 0, len(accounts))
	for _, account := range accounts {
		scopes = append(scopes, splitScopes(account.GrantedScopes)...)
	}
	return uniqueSortedStrings(scopes)
}

func missingScopes(required, granted []string) []string {
	grantedSet := map[string]struct{}{}
	for _, scope := range granted {
		grantedSet[scope] = struct{}{}
	}
	missing := []string{}
	for _, scope := range required {
		if _, ok := grantedSet[scope]; !ok {
			missing = append(missing, scope)
		}
	}
	return missing
}

func providerReadinessWorkspaceAccess(ctx context.Context, db *bun.DB, workspaceID, userID string) error {
	if !middleware.WorkspaceScopeAllows(ctx, workspaceID) {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	count, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if count == 0 {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func readinessProviders() []string {
	return []string{
		capabilities.ProviderFacebook,
		capabilities.ProviderInstagram,
		capabilities.ProviderYouTube,
		capabilities.ProviderTikTok,
		capabilities.ProviderX,
		capabilities.ProviderBluesky,
		capabilities.ProviderMastodon,
		capabilities.ProviderThreads,
		capabilities.ProviderLinkedIn,
	}
}

func configuredState(provider string, configured bool) string {
	switch provider {
	case capabilities.ProviderBluesky, capabilities.ProviderMastodon:
		return "built_in"
	default:
		if configured {
			return "configured"
		}
		return "missing"
	}
}

func supportedProfiles(provider string) []string {
	profiles := []string{}
	for _, capability := range capabilities.All() {
		if capability.Provider == provider {
			profiles = append(profiles, capability.Profile)
		}
	}
	return profiles
}

func requiredScopes(provider string) []string {
	switch provider {
	case capabilities.ProviderFacebook:
		return []string{"pages_manage_posts", "pages_read_engagement"}
	case capabilities.ProviderInstagram:
		return []string{"instagram_content_publish", "instagram_basic"}
	case capabilities.ProviderYouTube:
		return []string{"https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.upload"}
	case capabilities.ProviderTikTok:
		return []string{"user.info.basic", "video.publish", "video.upload"}
	case capabilities.ProviderLinkedIn:
		return []string{"w_member_social"}
	case capabilities.ProviderThreads:
		return []string{"threads_basic", "threads_content_publish"}
	default:
		return nil
	}
}

func appReviewWarnings(provider string) []string {
	switch provider {
	case capabilities.ProviderYouTube:
		return []string{"Unaudited Google projects can force uploads private."}
	case capabilities.ProviderTikTok:
		return []string{"Direct Post requires TikTok app audit approval."}
	case capabilities.ProviderFacebook, capabilities.ProviderInstagram, capabilities.ProviderThreads:
		return []string{"Meta app review can block publishing and story/comment permissions."}
	default:
		return nil
	}
}

func capabilityCaveats(provider string) []string {
	caveats := []string{}
	for _, capability := range capabilities.All() {
		if capability.Provider == provider {
			caveats = append(caveats, capability.Caveats...)
		}
	}
	return uniqueStrings(caveats)
}

func quotaCaveats(provider string) []string {
	switch provider {
	case capabilities.ProviderX:
		return []string{"X API tier limits can block media and posting operations."}
	case capabilities.ProviderYouTube:
		return []string{"YouTube quota cost depends on upload, thumbnail, playlist, and status calls."}
	default:
		return nil
	}
}

func accountTypes(provider string) []string {
	switch provider {
	case capabilities.ProviderFacebook:
		return []string{"Page"}
	case capabilities.ProviderInstagram:
		return []string{"Business", "Creator"}
	case capabilities.ProviderLinkedIn:
		return []string{"Person", "Organization"}
	default:
		return nil
	}
}

func providerRequiresPublicMedia(provider string) bool {
	for _, capability := range capabilities.All() {
		if capability.Provider == provider && capability.RequiresPublicMedia {
			return true
		}
	}
	return false
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func uniqueSortedStrings(values []string) []string {
	out := uniqueStrings(values)
	sort.Strings(out)
	return out
}

func splitScopes(raw string) []string {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	})
	scopes := make([]string, 0, len(fields))
	for _, field := range fields {
		if scope := strings.TrimSpace(field); scope != "" {
			scopes = append(scopes, scope)
		}
	}
	return scopes
}

const timeSortFormat = "2006-01-02T15:04:05Z07:00"
