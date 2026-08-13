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
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/uptrace/bun"
)

type ProviderReadinessHandler struct {
	db        *bun.DB
	auth      middleware.Authenticator
	readiness *providerreadiness.Service
	providers map[string]platform.Adapter
}

func NewProviderReadinessHandler(
	db *bun.DB,
	auth middleware.Authenticator,
	readiness *providerreadiness.Service,
	providers ...map[string]platform.Adapter,
) *ProviderReadinessHandler {
	handler := &ProviderReadinessHandler{db: db, auth: auth, readiness: readiness}
	if len(providers) > 0 {
		handler.providers = providers[0]
	}
	return handler
}

type ProviderReadinessInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type ProviderReadinessItem struct {
	Provider           string                     `json:"provider"`
	State              string                     `json:"state"`
	Connectable        bool                       `json:"connectable"`
	Advertisable       bool                       `json:"advertisable"`
	Facts              providerreadiness.Facts    `json:"facts"`
	Profiles           []ProviderReadinessProfile `json:"profiles,omitempty"`
	ConfiguredAppState string                     `json:"configured_app_state"`
	ConnectedAccounts  int                        `json:"connected_accounts"`
	BlockingIssues     []string                   `json:"blocking_issues,omitempty"`
}

type ProviderReadinessProfile struct {
	SocialAccountID string                     `json:"social_account_id"`
	OutputProfile   string                     `json:"output_profile"`
	Immediate       providerreadiness.Decision `json:"immediate"`
	Scheduled       providerreadiness.Decision `json:"scheduled"`
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

		accounts, err := h.loadReadinessAccounts(ctx, input.WorkspaceID)
		if err != nil {
			return nil, err
		}
		resp := &ProviderReadinessOutput{}
		for _, provider := range readinessProviders() {
			resp.Body.Providers = append(resp.Body.Providers, h.buildProviderReadiness(ctx, provider, accounts[provider]))
		}
		return resp, nil
	})
}

func (h *ProviderReadinessHandler) buildProviderReadiness(
	ctx context.Context,
	provider string,
	accounts []models.SocialAccount,
) ProviderReadinessItem {
	if h.readiness == nil {
		decision := providerreadiness.UnavailableDecision(providerreadiness.OperationConnect)
		item := buildProviderReadiness(provider, false, accounts)
		item.State = string(decision.State)
		item.Facts = decision.Facts
		item.BlockingIssues = readinessBlockerCodes(decision.Blockers)
		return item
	}
	connection := h.readiness.DecideConnection(ctx, provider, "", providerreadiness.ExecutionIntentProduction)
	configuration := h.readiness.Configuration(provider, "")
	item := buildProviderReadiness(
		provider,
		configuration.Evidence.State == providerreadiness.ConfigurationStateConfigured,
		accounts,
	)
	item.ConfiguredAppState = string(configuration.Evidence.State)
	if configuration.Evidence.State == providerreadiness.ConfigurationStateConfigured &&
		configuration.Evidence.Source == providerreadiness.ConfigurationSourceBuiltIn {
		item.ConfiguredAppState = "built_in"
	}
	item.State = string(connection.State)
	item.Connectable = connection.Connectable
	decisions := []providerreadiness.Decision{connection}
	item.Facts = connection.Facts
	item.BlockingIssues = append(item.BlockingIssues, readinessBlockerCodes(connection.Blockers)...)
	for _, account := range accounts {
		for _, capability := range capabilities.All() {
			if capability.Provider != provider {
				continue
			}
			profile := ProviderReadinessProfile{
				SocialAccountID: account.ID,
				OutputProfile:   capability.OutputProfile,
				Immediate: h.readiness.DecideAccountPublication(
					ctx, account, capability, providerreadiness.OperationPublishImmediate,
					providerreadiness.ExecutionIntentProduction,
					providerreadiness.PublicationPolicyMode(account, capability, nil),
				),
				Scheduled: h.readiness.DecideAccountPublication(
					ctx, account, capability, providerreadiness.OperationPublishScheduled,
					providerreadiness.ExecutionIntentProduction,
					providerreadiness.PublicationPolicyMode(account, capability, nil),
				),
			}
			item.Profiles = append(item.Profiles, profile)
			decisions = append(decisions, profile.Immediate, profile.Scheduled)
			item.Advertisable = item.Advertisable || profile.Immediate.Advertisable || profile.Scheduled.Advertisable
			item.BlockingIssues = append(item.BlockingIssues, readinessBlockerCodes(profile.Immediate.Blockers)...)
			item.BlockingIssues = append(item.BlockingIssues, readinessBlockerCodes(profile.Scheduled.Blockers)...)
		}
	}
	worst := providerreadiness.MostRestrictive(decisions...)
	item.State = string(worst.State)
	item.Facts = worst.Facts
	item.BlockingIssues = uniqueSortedStrings(item.BlockingIssues)
	return item
}

func readinessBlockerCodes(blockers []providerreadiness.Blocker) []string {
	codes := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		codes = append(codes, string(blocker.Code))
	}
	return codes
}

func (h *ProviderReadinessHandler) loadReadinessAccounts(ctx context.Context, workspaceID string) (map[string][]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().Model(&accounts).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load connected accounts")
	}
	out := map[string][]models.SocialAccount{}
	for _, account := range accounts {
		out[account.Platform] = append(out[account.Platform], account)
	}
	return out, nil
}

func buildProviderReadiness(provider string, configured bool, accounts []models.SocialAccount) ProviderReadinessItem {
	item := ProviderReadinessItem{
		Provider:           provider,
		ConfiguredAppState: configuredState(provider, configured),
		ConnectedAccounts:  activeAccountCount(accounts),
	}
	return item
}

func activeAccountCount(accounts []models.SocialAccount) int {
	count := 0
	for _, account := range accounts {
		if account.IsActive {
			count++
		}
	}
	return count
}

func providerReadinessWorkspaceAccess(ctx context.Context, db *bun.DB, workspaceID, userID string) error {
	if !middleware.WorkspaceScopeAllows(ctx, workspaceID) {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	allowed, err := middleware.CheckWorkspaceAccess(ctx, db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
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
		capabilities.ProviderDiscord,
	}
}

func configuredState(provider string, configured bool) string {
	switch provider {
	case capabilities.ProviderBluesky:
		return "built_in"
	default:
		if configured {
			return "configured"
		}
		return "missing"
	}
}

func missingScopes(required, granted []string) []string {
	grantedSet := make(map[string]struct{}, len(granted))
	for _, scope := range granted {
		grantedSet[scope] = struct{}{}
	}
	missing := make([]string, 0)
	for _, scope := range required {
		if _, ok := grantedSet[scope]; !ok {
			missing = append(missing, scope)
		}
	}
	return missing
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
