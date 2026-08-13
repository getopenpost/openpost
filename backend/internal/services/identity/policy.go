package identity

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const legacyOrganizationSSOTokensAllow = "allow"

type Policy struct {
	OrganizationID          string   `json:"organization_id"`
	Mode                    string   `json:"mode"`
	ProviderIDs             []string `json:"provider_ids"`
	AssuranceMaxAgeSeconds  int      `json:"assurance_max_age_seconds"`
	PasswordLoginAllowed    bool     `json:"password_login_allowed"`
	APITokenMode            string   `json:"api_token_mode" enum:"scoped,deny"`
	MaxTokenLifetimeSeconds int      `json:"max_token_lifetime_seconds"`
	RequireTokenReauth      bool     `json:"require_token_reauth"`
}

type WorkspaceAccessDecision struct {
	Allowed        bool
	SSORequired    bool
	OrganizationID string
	ProviderID     string
	ProviderName   string
	Reason         string
}

type OrganizationAccessDecision struct {
	Allowed     bool
	SSORequired bool
	ProviderID  string
	Reason      string
}

type TokenPolicyDecision struct {
	Allowed        bool
	OrganizationID string
	ProviderID     string
	AssuredAt      time.Time
	ExpiresAt      time.Time
}

func DefaultPolicy(organizationID string) Policy {
	return Policy{
		OrganizationID:          organizationID,
		Mode:                    models.OrganizationSSOModeDisabled,
		ProviderIDs:             []string{},
		AssuranceMaxAgeSeconds:  int(defaultAssuranceAge.Seconds()),
		PasswordLoginAllowed:    true,
		APITokenMode:            models.OrganizationSSOTokensScoped,
		MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		RequireTokenReauth:      true,
	}
}

func ParseProviderIDs(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, err
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !slices.Contains(result, value) {
			result = append(result, value)
		}
	}
	return result, nil
}

func policyFromModel(row models.OrganizationSSOPolicy) (Policy, error) {
	providers, err := ParseProviderIDs(row.ProviderIDs)
	if err != nil {
		return Policy{}, err
	}
	return Policy{
		OrganizationID:          row.OrganizationID,
		Mode:                    row.Mode,
		ProviderIDs:             providers,
		AssuranceMaxAgeSeconds:  row.AssuranceMaxAgeSeconds,
		PasswordLoginAllowed:    row.PasswordLoginAllowed,
		APITokenMode:            normalizeStoredAPITokenMode(row.APITokenMode),
		MaxTokenLifetimeSeconds: row.MaxTokenLifetimeSeconds,
		RequireTokenReauth:      row.RequireTokenReauth,
	}, nil
}

// Treat the retired organization-wide mode as workspace-scoped while a rolling
// upgrade can still read a row written before migration 084 completed.
func normalizeStoredAPITokenMode(mode string) string {
	switch mode {
	case legacyOrganizationSSOTokensAllow, models.OrganizationSSOTokensScoped:
		return models.OrganizationSSOTokensScoped
	case models.OrganizationSSOTokensDeny:
		return models.OrganizationSSOTokensDeny
	default:
		return models.OrganizationSSOTokensDeny
	}
}

func PolicyForOrganization(ctx context.Context, db *bun.DB, organizationID string) (Policy, error) {
	return policyForOrganization(ctx, db, organizationID)
}

func policyForOrganization(ctx context.Context, db bun.IDB, organizationID string) (Policy, error) {
	organizationID = strings.TrimSpace(organizationID)
	fallback := DefaultPolicy(organizationID)
	if organizationID == "" {
		return fallback, nil
	}
	var row models.OrganizationSSOPolicy
	if err := db.NewSelect().
		Model(&row).
		Where("organization_id = ?", organizationID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || missingSSOPolicyTable(err) {
			return fallback, nil
		}
		return Policy{}, err
	}
	return policyFromModel(row)
}

// A missing policy table means there cannot be a stored required policy yet.
// This also lets narrow service tests and rolling migration windows retain the
// pre-SSO access behavior. Database startup still treats migration failures as
// fatal before requests are served.
func missingSSOPolicyTable(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: organization_sso_policies") ||
		(strings.Contains(message, `relation "organization_sso_policies"`) &&
			strings.Contains(message, "does not exist"))
}

func missingWorkspaceTable(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: workspaces") ||
		(strings.Contains(message, `relation "workspaces"`) &&
			strings.Contains(message, "does not exist"))
}

func EvaluateWorkspaceAccess(
	ctx context.Context,
	db *bun.DB,
	workspaceID,
	userID,
	sessionID,
	tokenID string,
) (WorkspaceAccessDecision, error) {
	var workspace models.Workspace
	if err := db.NewSelect().
		Model(&workspace).
		Column("id", "organization_id").
		Where("id = ?", strings.TrimSpace(workspaceID)).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || missingWorkspaceTable(err) {
			// With no organization record there is no organization SSO policy
			// to enforce. Startup still treats failed schema migrations as
			// fatal before the API is served.
			return WorkspaceAccessDecision{Allowed: true}, nil
		}
		return WorkspaceAccessDecision{}, err
	}
	decision := WorkspaceAccessDecision{
		Allowed:        true,
		OrganizationID: workspace.OrganizationID,
	}
	policy, err := PolicyForOrganization(ctx, db, workspace.OrganizationID)
	if err != nil {
		return WorkspaceAccessDecision{}, err
	}
	if policy.Mode != models.OrganizationSSOModeRequired {
		return decision, nil
	}
	decision.SSORequired = true
	decision.Allowed = false

	breakGlass, err := breakGlassSessionAllowed(ctx, db, userID, sessionID)
	if err != nil {
		return WorkspaceAccessDecision{}, err
	}
	if breakGlass {
		decision.Allowed = true
		return decision, nil
	}

	provider, err := firstAcceptedProvider(ctx, db, policy.ProviderIDs)
	if err != nil {
		return WorkspaceAccessDecision{}, err
	}
	if provider != nil {
		decision.ProviderID = provider.ID
		decision.ProviderName = provider.Name
	}
	return evaluateWorkspaceCredentialAccess(
		ctx, db, workspace, userID, sessionID, tokenID, policy, decision,
	)
}

func evaluateWorkspaceCredentialAccess(
	ctx context.Context,
	db *bun.DB,
	workspace models.Workspace,
	userID,
	sessionID,
	tokenID string,
	policy Policy,
	decision WorkspaceAccessDecision,
) (WorkspaceAccessDecision, error) {
	if sessionID != "" {
		assurance, err := validSessionAssurance(ctx, db, sessionID, userID, policy.ProviderIDs)
		if err != nil {
			return WorkspaceAccessDecision{}, err
		}
		if assurance != nil {
			decision.Allowed = true
			decision.ProviderID = assurance.ProviderID
			return decision, nil
		}
		decision.Reason = "Sign in with your organization's identity provider to access this workspace."
		return decision, nil
	}
	if tokenID != "" {
		allowed, err := validOrganizationToken(ctx, db, tokenID, userID, workspace, policy)
		if err != nil {
			return WorkspaceAccessDecision{}, err
		}
		decision.Allowed = allowed
		if !allowed {
			decision.Reason = "This token does not satisfy the organization's SSO policy."
		}
		return decision, nil
	}
	decision.Reason = "An OIDC-authenticated web session or organization-bound token is required."
	return decision, nil
}

func breakGlassSessionAllowed(
	ctx context.Context,
	db *bun.DB,
	userID,
	sessionID string,
) (bool, error) {
	var user models.User
	if err := db.NewSelect().Model(&user).Column("id", "is_break_glass").
		Where("id = ?", userID).Scan(ctx); err != nil {
		return false, err
	}
	return user.IsBreakGlass && sessionID != "", nil
}

func EvaluateOrganizationAccess(
	ctx context.Context,
	db *bun.DB,
	organizationID,
	userID,
	sessionID,
	tokenID string,
) (OrganizationAccessDecision, error) {
	decision := OrganizationAccessDecision{Allowed: true}
	// Workspace binding is an authorization boundary as well as SSO
	// assurance. Enforce it before the organization policy so a bound token
	// cannot administer its parent organization when SSO is optional.
	if strings.TrimSpace(tokenID) != "" {
		allowed, err := organizationTokenScopeAllows(ctx, db, tokenID, userID)
		if err != nil {
			return OrganizationAccessDecision{}, err
		}
		if !allowed {
			decision.Allowed = false
			decision.Reason = "Workspace-bound tokens cannot access organization-level resources."
			return decision, nil
		}
	}
	policy, err := PolicyForOrganization(ctx, db, organizationID)
	if err != nil {
		return OrganizationAccessDecision{}, err
	}
	if policy.Mode != models.OrganizationSSOModeRequired {
		return decision, nil
	}
	decision.Allowed = false
	decision.SSORequired = true

	var user models.User
	if err := db.NewSelect().Model(&user).Column("id", "is_break_glass").
		Where("id = ?", userID).Scan(ctx); err != nil {
		return OrganizationAccessDecision{}, err
	}
	if user.IsBreakGlass && sessionID != "" {
		decision.Allowed = true
		return decision, nil
	}
	if sessionID != "" {
		assurance, err := validSessionAssurance(ctx, db, sessionID, userID, policy.ProviderIDs)
		if err != nil {
			return OrganizationAccessDecision{}, err
		}
		if assurance != nil {
			decision.Allowed = true
			decision.ProviderID = assurance.ProviderID
			return decision, nil
		}
	}
	if tokenID != "" {
		allowed, providerID, err := validOrganizationBoundToken(
			ctx, db, tokenID, userID, organizationID, policy,
		)
		if err != nil {
			return OrganizationAccessDecision{}, err
		}
		decision.Allowed = allowed
		decision.ProviderID = providerID
		if allowed {
			return decision, nil
		}
	}
	decision.Reason = "This credential does not satisfy the organization's SSO policy."
	return decision, nil
}

func organizationTokenScopeAllows(
	ctx context.Context,
	db *bun.DB,
	tokenID,
	userID string,
) (bool, error) {
	var token models.APIToken
	if err := db.NewSelect().
		Model(&token).
		Column("workspace_id").
		Where("id = ? AND user_id = ?", strings.TrimSpace(tokenID), strings.TrimSpace(userID)).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return strings.TrimSpace(token.WorkspaceID) == "", nil
}

func validSessionAssurance(
	ctx context.Context,
	db *bun.DB,
	sessionID,
	userID string,
	providerIDs []string,
) (*models.SessionIdentityAssurance, error) {
	if len(providerIDs) == 0 {
		return nil, nil
	}
	var assurance models.SessionIdentityAssurance
	err := db.NewSelect().
		Model(&assurance).
		Join("JOIN identity_providers AS ip ON ip.id = session_identity_assurance.provider_id").
		Where("session_identity_assurance.session_id = ?", sessionID).
		Where("session_identity_assurance.user_id = ?", userID).
		Where("session_identity_assurance.provider_id IN (?)", bun.List(providerIDs)).
		Where("session_identity_assurance.expires_at > ?", time.Now().UTC()).
		Where("ip.is_active = ?", true).
		Order("session_identity_assurance.auth_time DESC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &assurance, nil
}

func validOrganizationToken(
	ctx context.Context,
	db *bun.DB,
	tokenID,
	userID string,
	workspace models.Workspace,
	policy Policy,
) (bool, error) {
	var token models.APIToken
	if err := db.NewSelect().
		Model(&token).
		Where("id = ? AND user_id = ?", tokenID, userID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if token.OrganizationID != workspace.OrganizationID ||
		token.WorkspaceID == "" || token.WorkspaceID != workspace.ID ||
		policy.APITokenMode == models.OrganizationSSOTokensDeny {
		return false, nil
	}
	return validOrganizationTokenRecord(ctx, db, token, policy)
}

func validOrganizationBoundToken(
	ctx context.Context,
	db *bun.DB,
	tokenID,
	userID,
	organizationID string,
	policy Policy,
) (bool, string, error) {
	if policy.APITokenMode == models.OrganizationSSOTokensDeny {
		return false, "", nil
	}
	var token models.APIToken
	if err := db.NewSelect().Model(&token).
		Where("id = ? AND user_id = ?", tokenID, userID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, "", nil
		}
		return false, "", err
	}
	if token.OrganizationID != organizationID {
		return false, "", nil
	}
	if policy.APITokenMode == models.OrganizationSSOTokensScoped && token.WorkspaceID == "" {
		return false, "", nil
	}
	if token.WorkspaceID != "" {
		exists, err := db.NewSelect().Model((*models.Workspace)(nil)).
			Where("id = ? AND organization_id = ?", token.WorkspaceID, organizationID).
			Exists(ctx)
		if err != nil {
			return false, "", err
		}
		if !exists {
			return false, "", nil
		}
	}
	allowed, err := validOrganizationTokenRecord(ctx, db, token, policy)
	if !allowed || err != nil {
		return allowed, "", err
	}
	return true, token.IdentityProviderID, nil
}

func validOrganizationTokenRecord(
	ctx context.Context,
	db *bun.DB,
	token models.APIToken,
	policy Policy,
) (bool, error) {
	if !slices.Contains(policy.ProviderIDs, token.IdentityProviderID) || token.AssuredAt.IsZero() {
		return false, nil
	}
	maxAssuranceAge := time.Duration(policy.AssuranceMaxAgeSeconds) * time.Second
	if maxAssuranceAge <= 0 || token.AssuredAt.Add(maxAssuranceAge).Before(time.Now().UTC()) {
		return false, nil
	}
	var provider models.IdentityProvider
	if err := db.NewSelect().Model(&provider).
		Where("id = ? AND is_active = ?", token.IdentityProviderID, true).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func firstAcceptedProvider(
	ctx context.Context,
	db *bun.DB,
	providerIDs []string,
) (*models.IdentityProvider, error) {
	if len(providerIDs) == 0 {
		return nil, nil
	}
	var provider models.IdentityProvider
	err := db.NewSelect().
		Model(&provider).
		Where("id IN (?)", bun.List(providerIDs)).
		Where("is_active = ?", true).
		Order("name ASC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &provider, nil
}

func AuthorizeTokenCreation(
	ctx context.Context,
	db *bun.DB,
	userID,
	sessionID,
	workspaceID string,
	requestedExpiry time.Time,
) (TokenPolicyDecision, error) {
	decision := TokenPolicyDecision{Allowed: true, ExpiresAt: requestedExpiry}
	if strings.TrimSpace(workspaceID) == "" {
		return decision, nil
	}
	var workspace models.Workspace
	if err := db.NewSelect().Model(&workspace).
		Column("id", "organization_id").
		Where("id = ?", workspaceID).
		Scan(ctx); err != nil {
		return TokenPolicyDecision{}, err
	}
	decision.OrganizationID = workspace.OrganizationID
	policy, err := PolicyForOrganization(ctx, db, workspace.OrganizationID)
	if err != nil {
		return TokenPolicyDecision{}, err
	}
	if policy.Mode != models.OrganizationSSOModeRequired {
		return decision, nil
	}
	if policy.APITokenMode == models.OrganizationSSOTokensDeny || workspaceID == "" {
		return TokenPolicyDecision{}, ErrTokenPolicyDenied
	}
	assurance, err := validSessionAssurance(ctx, db, sessionID, userID, policy.ProviderIDs)
	if err != nil {
		return TokenPolicyDecision{}, err
	}
	// A token that can enter an SSO-protected organization must always inherit
	// an accepted provider assurance. RequireTokenReauth controls the admin
	// policy surface, but it must never create an unbound bypass token.
	if assurance == nil {
		return TokenPolicyDecision{}, ErrReauthRequired
	}
	decision.ProviderID = assurance.ProviderID
	decision.AssuredAt = assurance.AuthTime
	if policy.MaxTokenLifetimeSeconds > 0 {
		maxExpiry := time.Now().UTC().Add(time.Duration(policy.MaxTokenLifetimeSeconds) * time.Second)
		if decision.ExpiresAt.IsZero() || decision.ExpiresAt.After(maxExpiry) {
			decision.ExpiresAt = maxExpiry
		}
	}
	return decision, nil
}

func (s *Service) AuthorizeTokenCreation(
	ctx context.Context,
	userID,
	sessionID,
	workspaceID string,
	requestedExpiry time.Time,
) (TokenPolicyDecision, error) {
	return AuthorizeTokenCreation(ctx, s.db, userID, sessionID, workspaceID, requestedExpiry)
}

func PasswordCredentialAllowed(ctx context.Context, db *bun.DB, userID string) (bool, error) {
	return passwordCredentialAllowed(ctx, db, userID)
}

func passwordCredentialAllowed(ctx context.Context, db bun.IDB, userID string) (bool, error) {
	var user models.User
	if err := db.NewSelect().Model(&user).Column("id", "is_break_glass").
		Where("id = ?", userID).Scan(ctx); err != nil {
		return false, err
	}
	if user.IsBreakGlass {
		return true, nil
	}
	var organizationIDs []string
	if err := db.NewSelect().
		Model((*models.OrganizationMember)(nil)).
		Column("organization_id").
		Where("user_id = ?", userID).
		Scan(ctx, &organizationIDs); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	if len(organizationIDs) == 0 {
		return true, nil
	}
	for _, organizationID := range organizationIDs {
		policy, err := policyForOrganization(ctx, db, organizationID)
		if err != nil {
			return false, err
		}
		if policy.Mode != models.OrganizationSSOModeRequired || policy.PasswordLoginAllowed {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) PasswordCredentialAllowed(ctx context.Context, userID string) (bool, error) {
	return PasswordCredentialAllowed(ctx, s.db, userID)
}

func ValidatePolicy(input Policy) error {
	if !slices.Contains([]string{
		models.OrganizationSSOModeDisabled,
		models.OrganizationSSOModeOptional,
		models.OrganizationSSOModeRequired,
	}, input.Mode) {
		return fmt.Errorf("invalid sso mode")
	}
	if !slices.Contains([]string{
		models.OrganizationSSOTokensScoped,
		models.OrganizationSSOTokensDeny,
	}, input.APITokenMode) {
		return fmt.Errorf("invalid api token mode")
	}
	if input.AssuranceMaxAgeSeconds < 300 || input.AssuranceMaxAgeSeconds > int((30*24*time.Hour).Seconds()) {
		return fmt.Errorf("assurance max age must be between 5 minutes and 30 days")
	}
	if input.MaxTokenLifetimeSeconds < 300 ||
		input.MaxTokenLifetimeSeconds > int((365*24*time.Hour).Seconds()) {
		return fmt.Errorf("token lifetime must be between 5 minutes and 365 days")
	}
	if input.Mode == models.OrganizationSSOModeRequired && len(input.ProviderIDs) == 0 {
		return fmt.Errorf("required sso needs at least one identity provider")
	}
	return nil
}

func slicesContains(values []string, value string) bool {
	return slices.Contains(values, value)
}
