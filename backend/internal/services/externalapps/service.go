// Package externalapps owns delegated authorization for third-party OpenPost
// applications. It is deliberately separate from provider OAuth, which grants
// OpenPost access to social networks rather than granting an app access to
// OpenPost.
package externalapps

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/uptrace/bun"
)

const (
	ClientTypePublic       = "public"
	ClientTypeConfidential = "confidential"

	ScopeWorkspaceRead        = "workspace:read"
	ScopeAccountsRead         = "accounts:read"
	ScopePublicationsRead     = "publications:read"
	ScopeDraftsWrite          = "drafts:write"
	ScopeMediaRead            = "media:read"
	ScopeMediaWrite           = "media:write"
	ScopePublicationsSchedule = "publications:schedule"
	ScopePublicationsPublish  = "publications:publish"
	ScopePublicationsCancel   = "publications:cancel"
	ScopeEventsSubscribe      = "events:subscribe"

	CodeChallengeMethodS256   = "S256"
	accessTokenLifetime       = time.Hour
	refreshTokenLifetime      = 90 * 24 * time.Hour
	authorizationCodeLifetime = 10 * time.Minute
)

var (
	ErrInvalidRequest      = errors.New("invalid external application request")
	ErrInvalidClient       = errors.New("invalid external application client")
	ErrInvalidGrant        = errors.New("invalid external application grant")
	ErrInvalidScope        = errors.New("invalid external application scope")
	ErrWorkspaceNotAllowed = errors.New("workspace is not eligible for authorization")
	ErrAccountNotAllowed   = errors.New("social account is not eligible for authorization")
	ErrRefreshReplay       = errors.New("refresh token replay detected")
)

var supportedScopes = []string{
	ScopeAccountsRead, ScopeDraftsWrite, ScopeEventsSubscribe, ScopeMediaRead,
	ScopeMediaWrite, ScopePublicationsCancel, ScopePublicationsPublish,
	ScopePublicationsRead, ScopePublicationsSchedule, ScopeWorkspaceRead,
}

type Service struct {
	db                         *bun.DB
	tokens                     *apitokens.Service
	publicURL                  string
	dynamicRegistrationEnabled bool
	now                        func() time.Time
}

type RegisterApplicationInput struct {
	Name, ClientType, CreatedByUserID string
	RedirectURIs, AllowedScopes       []string
}

type RegisterApplicationResult struct {
	Application  models.ExternalApplication
	ClientSecret string
}

type WorkspaceGrantInput struct {
	WorkspaceID         string    `json:"workspace_id"`
	AccountIDs          []string  `json:"account_ids,omitempty"`
	AllCurrentAccounts  bool      `json:"all_current_accounts,omitempty"`
	OrganizationID      string    `json:"-"`
	IdentityProviderID  string    `json:"-"`
	AssuredAt           time.Time `json:"-"`
	CredentialExpiresAt time.Time `json:"-"`
}

type AuthorizeInput struct {
	UserID, SessionID, ClientID, RedirectURI, CodeChallenge, State string
	Scopes                                                         []string
	WorkspaceGrants                                                []WorkspaceGrantInput
}

type AuthorizationResult struct {
	RedirectURL, Code, InstallationID string
}

type ExchangeInput struct {
	Code, ClientID, ClientSecret, RedirectURI, CodeVerifier string
}

type RefreshInput struct {
	ClientID, ClientSecret, RefreshToken string
}

type TokenResult struct {
	AccessToken, RefreshToken, Scope, Resource string
	ExpiresIn                                  int
}

func NewService(db *bun.DB, tokens *apitokens.Service, publicURL string) *Service {
	return &Service{db: db, tokens: tokens, publicURL: strings.TrimRight(publicURL, "/"), now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) SetDynamicRegistrationEnabled(enabled bool) {
	s.dynamicRegistrationEnabled = enabled
}

func (s *Service) DynamicRegistrationEnabled() bool {
	return s.dynamicRegistrationEnabled
}

func (s *Service) RegisterApplication(ctx context.Context, input RegisterApplicationInput) (*RegisterApplicationResult, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.CreatedByUserID = strings.TrimSpace(input.CreatedByUserID)
	if input.Name == "" || (input.ClientType != ClientTypePublic && input.ClientType != ClientTypeConfidential) {
		return nil, ErrInvalidRequest
	}
	redirects, err := normalizeRedirectURIs(input.RedirectURIs)
	if err != nil {
		return nil, err
	}
	scopes, err := normalizeScopes(input.AllowedScopes)
	if err != nil {
		return nil, err
	}
	redirectJSON, _ := json.Marshal(redirects)
	clientID := "op_app_" + uuid.NewString()
	clientSecret := ""
	secretHash := ""
	if input.ClientType == ClientTypeConfidential {
		secret, secretErr := generateSecret("op_secret_")
		if secretErr != nil {
			return nil, secretErr
		}
		clientSecret = secret
		secretHash = hashSecret(secret)
	}
	now := s.now()
	app := models.ExternalApplication{
		ID: uuid.NewString(), ClientID: clientID, Name: input.Name, ClientType: input.ClientType,
		ClientSecretHash: secretHash, RedirectURIsJSON: string(redirectJSON), AllowedScopes: scopes,
		CreatedByUserID: input.CreatedByUserID, CreatedAt: now, UpdatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(&app).Exec(ctx); err != nil {
		return nil, err
	}
	return &RegisterApplicationResult{Application: app, ClientSecret: clientSecret}, nil
}

func (s *Service) RegisterDynamicApplication(ctx context.Context, input RegisterApplicationInput) (*RegisterApplicationResult, error) {
	if !s.dynamicRegistrationEnabled {
		return nil, ErrInvalidClient
	}
	input.CreatedByUserID = ""
	return s.RegisterApplication(ctx, input)
}

func (s *Service) Authorize(ctx context.Context, input AuthorizeInput) (*AuthorizationResult, error) {
	app, err := s.applicationByClientID(ctx, input.ClientID)
	if err != nil {
		return nil, err
	}
	redirectURI, err := appRedirect(app, input.RedirectURI)
	if err != nil {
		return nil, err
	}
	scopes, err := normalizeScopes(input.Scopes)
	if err != nil || !scopeSubset(scopes, app.AllowedScopes) {
		return nil, ErrInvalidScope
	}
	if err := validatePKCE(input.CodeChallenge); err != nil {
		return nil, err
	}
	grants, err := s.validateWorkspaceGrants(ctx, strings.TrimSpace(input.UserID), strings.TrimSpace(input.SessionID), input.WorkspaceGrants)
	if err != nil {
		return nil, err
	}
	now := s.now()
	codeSecret, err := generateSecret("op_auth_")
	if err != nil {
		return nil, err
	}
	installation := models.ExternalAppInstallation{
		ID: uuid.NewString(), ApplicationID: app.ID, SponsorUserID: strings.TrimSpace(input.UserID),
		Scopes: scopes, TokenFamilyID: uuid.NewString(), CreatedAt: now, UpdatedAt: now,
	}
	err = s.persistAuthorization(ctx, app, installation, grants, redirectURI, input.CodeChallenge, codeSecret, now)
	if err != nil {
		return nil, err
	}
	return &AuthorizationResult{
		RedirectURL: oauthRedirect(redirectURI, codeSecret, input.State, s.publicURL),
		Code:        codeSecret, InstallationID: installation.ID,
	}, nil
}

func (s *Service) persistAuthorization(
	ctx context.Context,
	app *models.ExternalApplication,
	installation models.ExternalAppInstallation,
	grants []WorkspaceGrantInput,
	redirectURI, codeChallenge, codeSecret string,
	now time.Time,
) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		var replacedInstallationIDs []string
		if selectErr := tx.NewSelect().Model((*models.ExternalAppInstallation)(nil)).Column("id").
			Where("application_id = ? AND sponsor_user_id = ? AND revoked_at IS NULL", app.ID, installation.SponsorUserID).
			Scan(ctx, &replacedInstallationIDs); selectErr != nil && !errors.Is(selectErr, sql.ErrNoRows) {
			return selectErr
		}
		if len(replacedInstallationIDs) > 0 {
			if _, updateErr := tx.NewUpdate().Model((*models.ExternalAppInstallation)(nil)).Set("revoked_at = ?", now).
				Where("id IN (?)", bun.List(replacedInstallationIDs)).Exec(ctx); updateErr != nil {
				return updateErr
			}
			if _, updateErr := tx.NewUpdate().Model((*models.APIToken)(nil)).Set("revoked_at = ?", now).
				Where("installation_id IN (?) AND revoked_at IS NULL", bun.List(replacedInstallationIDs)).Exec(ctx); updateErr != nil {
				return updateErr
			}
			if _, updateErr := tx.NewUpdate().Model((*models.ExternalRefreshToken)(nil)).Set("revoked_at = ?", now).
				Where("installation_id IN (?) AND revoked_at IS NULL", bun.List(replacedInstallationIDs)).Exec(ctx); updateErr != nil {
				return updateErr
			}
		}
		if _, insertErr := tx.NewInsert().Model(&installation).Exec(ctx); insertErr != nil {
			return insertErr
		}
		for _, grant := range grants {
			row := models.ExternalAppWorkspaceGrant{
				InstallationID: installation.ID, WorkspaceID: grant.WorkspaceID,
				AllCurrentAccounts: grant.AllCurrentAccounts, CreatedAt: now, UpdatedAt: now,
				OrganizationID: grant.OrganizationID, IdentityProviderID: grant.IdentityProviderID,
				AssuredAt: grant.AssuredAt, CredentialExpiresAt: grant.CredentialExpiresAt,
			}
			if _, insertErr := tx.NewInsert().Model(&row).Exec(ctx); insertErr != nil {
				return insertErr
			}
			for _, accountID := range grant.AccountIDs {
				account := models.ExternalAppAccountGrant{InstallationID: installation.ID, WorkspaceID: grant.WorkspaceID, SocialAccountID: accountID, CreatedAt: now}
				if _, insertErr := tx.NewInsert().Model(&account).Exec(ctx); insertErr != nil {
					return insertErr
				}
			}
		}
		code := models.ExternalOAuthCode{
			ID: uuid.NewString(), CodeHash: hashSecret(codeSecret), InstallationID: installation.ID,
			ClientID: app.ClientID, RedirectURI: redirectURI, Resource: s.publicURL + "/api/v1",
			CodeChallenge: strings.TrimSpace(codeChallenge), ExpiresAt: now.Add(authorizationCodeLifetime), CreatedAt: now,
		}
		_, insertErr := tx.NewInsert().Model(&code).Exec(ctx)
		return insertErr
	})
}

func (s *Service) Deny(ctx context.Context, input AuthorizeInput) (*AuthorizationResult, error) {
	app, err := s.applicationByClientID(ctx, input.ClientID)
	if err != nil {
		return nil, err
	}
	redirectURI, err := appRedirect(app, input.RedirectURI)
	if err != nil {
		return nil, err
	}
	return &AuthorizationResult{RedirectURL: oauthErrorRedirect(redirectURI, "access_denied", input.State, s.publicURL)}, nil
}

func (s *Service) ExchangeCode(ctx context.Context, input ExchangeInput) (*TokenResult, error) {
	var code models.ExternalOAuthCode
	if err := s.db.NewSelect().Model(&code).Where("code_hash = ?", hashSecret(input.Code)).Scan(ctx); err != nil {
		return nil, ErrInvalidGrant
	}
	app, err := s.applicationByClientID(ctx, input.ClientID)
	if err != nil || !validClientSecret(app, input.ClientSecret) || code.ClientID != app.ClientID || code.RedirectURI != strings.TrimSpace(input.RedirectURI) || !code.ExpiresAt.After(s.now()) || !code.ConsumedAt.IsZero() || !validVerifier(code.CodeChallenge, input.CodeVerifier) {
		return nil, ErrInvalidGrant
	}
	return s.exchange(ctx, code, app)
}

func (s *Service) exchange(ctx context.Context, code models.ExternalOAuthCode, app *models.ExternalApplication) (*TokenResult, error) {
	var result *TokenResult
	now := s.now()
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		res, err := tx.NewUpdate().Model((*models.ExternalOAuthCode)(nil)).Set("consumed_at = ?", now).
			Where("id = ? AND consumed_at IS NULL", code.ID).Exec(ctx)
		if err != nil {
			return err
		}
		rows, _ := res.RowsAffected()
		if rows != 1 {
			return ErrInvalidGrant
		}
		var installation models.ExternalAppInstallation
		if err := tx.NewSelect().Model(&installation).Where("id = ? AND revoked_at IS NULL", code.InstallationID).Scan(ctx); err != nil {
			return ErrInvalidGrant
		}
		result, err = s.issueTokens(ctx, tx, installation, app.Name, code.Resource, now)
		return err
	})
	return result, err
}

func (s *Service) Refresh(ctx context.Context, input RefreshInput) (*TokenResult, error) {
	app, err := s.applicationByClientID(ctx, input.ClientID)
	if err != nil || !validClientSecret(app, input.ClientSecret) {
		return nil, ErrInvalidClient
	}
	var current models.ExternalRefreshToken
	if err := s.db.NewSelect().Model(&current).Where("token_hash = ?", hashSecret(input.RefreshToken)).Scan(ctx); err != nil {
		return nil, ErrInvalidGrant
	}
	if !current.UsedAt.IsZero() {
		_ = s.revokeFamily(ctx, current.FamilyID, current.InstallationID)
		return nil, ErrRefreshReplay
	}
	if !current.RevokedAt.IsZero() || !current.ExpiresAt.After(s.now()) {
		return nil, ErrInvalidGrant
	}
	var result *TokenResult
	now := s.now()
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		updated, updateErr := tx.NewUpdate().Model((*models.ExternalRefreshToken)(nil)).Set("used_at = ?", now).
			Where("id = ? AND used_at IS NULL AND revoked_at IS NULL", current.ID).Exec(ctx)
		if updateErr != nil {
			return updateErr
		}
		rows, _ := updated.RowsAffected()
		if rows != 1 {
			return ErrRefreshReplay
		}
		var installation models.ExternalAppInstallation
		if err := tx.NewSelect().Model(&installation).Where("id = ? AND application_id = ? AND revoked_at IS NULL", current.InstallationID, app.ID).Scan(ctx); err != nil {
			return ErrInvalidGrant
		}
		result, updateErr = s.issueTokens(ctx, tx, installation, app.Name, s.publicURL+"/api/v1", now)
		return updateErr
	})
	if errors.Is(err, ErrRefreshReplay) {
		_ = s.revokeFamily(ctx, current.FamilyID, current.InstallationID)
	}
	return result, err
}

func (s *Service) issueTokens(ctx context.Context, tx bun.Tx, installation models.ExternalAppInstallation, name, resource string, now time.Time) (*TokenResult, error) {
	accessExpiry := now.Add(accessTokenLifetime)
	generated, err := s.tokens.GenerateTokenWithOptionsInTx(ctx, tx, installation.SponsorUserID, name, apitokens.ScopeExternalApp, apitokens.GenerateOptions{
		ExpiresAt: &accessExpiry, Audience: resource, ClientID: installation.ApplicationID, InstallationID: installation.ID,
	})
	if err != nil {
		return nil, err
	}
	refresh, err := generateSecret("op_refresh_")
	if err != nil {
		return nil, err
	}
	refreshRow := models.ExternalRefreshToken{
		ID: uuid.NewString(), TokenHash: hashSecret(refresh), TokenPrefix: secretPrefix(refresh),
		InstallationID: installation.ID, FamilyID: installation.TokenFamilyID,
		ExpiresAt: now.Add(refreshTokenLifetime), CreatedAt: now,
	}
	if _, err := tx.NewInsert().Model(&refreshRow).Exec(ctx); err != nil {
		return nil, err
	}
	return &TokenResult{AccessToken: generated.Token, RefreshToken: refresh, Scope: installation.Scopes, Resource: resource, ExpiresIn: int(accessTokenLifetime.Seconds())}, nil
}

func (s *Service) Revoke(ctx context.Context, rawToken string) error {
	if strings.HasPrefix(strings.TrimSpace(rawToken), "op_refresh_") {
		var refresh models.ExternalRefreshToken
		if err := s.db.NewSelect().Model(&refresh).Where("token_hash = ?", hashSecret(rawToken)).Scan(ctx); err == nil {
			return s.revokeFamily(ctx, refresh.FamilyID, refresh.InstallationID)
		}
		return nil
	}
	return s.tokens.RevokePresentedToken(ctx, rawToken)
}

func (s *Service) ListApplications(ctx context.Context) ([]models.ExternalApplication, error) {
	var apps []models.ExternalApplication
	err := s.db.NewSelect().Model(&apps).Order("created_at DESC").Scan(ctx)
	return apps, err
}

func (s *Service) ApplicationForAuthorization(ctx context.Context, clientID, redirectURI string) (*models.ExternalApplication, error) {
	app, err := s.applicationByClientID(ctx, clientID)
	if err != nil {
		return nil, err
	}
	if _, err := appRedirect(app, redirectURI); err != nil {
		return nil, err
	}
	return app, nil
}

func (s *Service) RevokeApplication(ctx context.Context, applicationID string) error {
	now := s.now()
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.ExternalApplication)(nil)).Set("revoked_at = ?", now).
			Where("id = ? AND revoked_at IS NULL", strings.TrimSpace(applicationID)).Exec(ctx)
		if err != nil {
			return err
		}
		rows, _ := result.RowsAffected()
		if rows != 1 {
			return sql.ErrNoRows
		}
		var installationIDs []string
		if err := tx.NewSelect().Model((*models.ExternalAppInstallation)(nil)).Column("id").
			Where("application_id = ? AND revoked_at IS NULL", applicationID).Scan(ctx, &installationIDs); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.ExternalAppInstallation)(nil)).Set("revoked_at = ?", now).
			Where("application_id = ? AND revoked_at IS NULL", applicationID).Exec(ctx); err != nil {
			return err
		}
		if len(installationIDs) == 0 {
			return nil
		}
		if _, err = tx.NewUpdate().Model((*models.APIToken)(nil)).Set("revoked_at = ?", now).
			Where("installation_id IN (?) AND revoked_at IS NULL", bun.List(installationIDs)).Exec(ctx); err != nil {
			return err
		}
		_, err = tx.NewUpdate().Model((*models.ExternalRefreshToken)(nil)).Set("revoked_at = ?", now).
			Where("installation_id IN (?) AND revoked_at IS NULL", bun.List(installationIDs)).Exec(ctx)
		return err
	})
}

func (s *Service) RotateClientSecret(ctx context.Context, applicationID string) (string, error) {
	var app models.ExternalApplication
	if err := s.db.NewSelect().Model(&app).Where("id = ? AND revoked_at IS NULL", strings.TrimSpace(applicationID)).Scan(ctx); err != nil {
		return "", err
	}
	if app.ClientType != ClientTypeConfidential {
		return "", ErrInvalidClient
	}
	secret, err := generateSecret("op_secret_")
	if err != nil {
		return "", err
	}
	_, err = s.db.NewUpdate().Model((*models.ExternalApplication)(nil)).Set("client_secret_hash = ?", hashSecret(secret)).
		Set("updated_at = ?", s.now()).Where("id = ? AND revoked_at IS NULL", app.ID).Exec(ctx)
	if err != nil {
		return "", err
	}
	return secret, nil
}

func (s *Service) ListInstallations(ctx context.Context, sponsorUserID string) ([]models.ExternalAppInstallation, error) {
	var installations []models.ExternalAppInstallation
	err := s.db.NewSelect().Model(&installations).Where("sponsor_user_id = ?", strings.TrimSpace(sponsorUserID)).Order("created_at DESC").Scan(ctx)
	return installations, err
}

func (s *Service) RevokeInstallation(ctx context.Context, sponsorUserID, installationID string) error {
	now := s.now()
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.ExternalAppInstallation)(nil)).Set("revoked_at = ?", now).
			Where("id = ? AND sponsor_user_id = ? AND revoked_at IS NULL", strings.TrimSpace(installationID), strings.TrimSpace(sponsorUserID)).Exec(ctx)
		if err != nil {
			return err
		}
		rows, _ := result.RowsAffected()
		if rows != 1 {
			return sql.ErrNoRows
		}
		if _, err := tx.NewUpdate().Model((*models.APIToken)(nil)).Set("revoked_at = ?", now).
			Where("installation_id = ? AND revoked_at IS NULL", installationID).Exec(ctx); err != nil {
			return err
		}
		_, err = tx.NewUpdate().Model((*models.ExternalRefreshToken)(nil)).Set("revoked_at = ?", now).
			Where("installation_id = ? AND revoked_at IS NULL", installationID).Exec(ctx)
		return err
	})
}

func (s *Service) RevokeWorkspaceGrant(ctx context.Context, sponsorUserID, installationID, workspaceID string) error {
	var installation models.ExternalAppInstallation
	if err := s.db.NewSelect().Model(&installation).
		Where("id = ? AND sponsor_user_id = ? AND revoked_at IS NULL", strings.TrimSpace(installationID), strings.TrimSpace(sponsorUserID)).
		Scan(ctx); err != nil {
		return err
	}
	result, err := s.db.NewUpdate().Model((*models.ExternalAppWorkspaceGrant)(nil)).Set("revoked_at = ?", s.now()).
		Where("installation_id = ? AND workspace_id = ? AND revoked_at IS NULL", strings.TrimSpace(installationID), strings.TrimSpace(workspaceID)).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func SupportedScopes() []string {
	return append([]string(nil), supportedScopes...)
}

func (s *Service) revokeFamily(ctx context.Context, familyID, installationID string) error {
	now := s.now()
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.ExternalRefreshToken)(nil)).Set("revoked_at = ?", now).Where("family_id = ? AND revoked_at IS NULL", familyID).Exec(ctx); err != nil {
			return err
		}
		_, err := tx.NewUpdate().Model((*models.APIToken)(nil)).Set("revoked_at = ?", now).Where("installation_id = ? AND revoked_at IS NULL", installationID).Exec(ctx)
		return err
	})
}

func (s *Service) WorkspaceAllowed(ctx context.Context, installationID, sponsorUserID, workspaceID string) (bool, error) {
	count, err := s.db.NewSelect().TableExpr("external_app_workspace_grants AS g").
		Join("JOIN external_app_installations AS i ON i.id = g.installation_id").
		Join("JOIN workspace_members AS m ON m.workspace_id = g.workspace_id AND m.user_id = i.sponsor_user_id").
		Where("g.installation_id = ? AND g.workspace_id = ?", strings.TrimSpace(installationID), strings.TrimSpace(workspaceID)).
		Where("i.sponsor_user_id = ? AND i.revoked_at IS NULL AND g.revoked_at IS NULL", strings.TrimSpace(sponsorUserID)).
		Where("m.status = ? AND m.role = ?", models.WorkspaceMemberStatusActive, models.WorkspaceRoleAdmin).Count(ctx)
	return count == 1, err
}

func (s *Service) AccountAllowed(ctx context.Context, installationID, workspaceID, accountID string) (bool, error) {
	var grant models.ExternalAppWorkspaceGrant
	if err := s.db.NewSelect().Model(&grant).Where("installation_id = ? AND workspace_id = ? AND revoked_at IS NULL", installationID, workspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if grant.AllCurrentAccounts {
		count, err := s.db.NewSelect().Model((*models.SocialAccount)(nil)).Where("id = ? AND workspace_id = ? AND is_active = ? AND created_at <= ?", accountID, workspaceID, true, grant.CreatedAt).Count(ctx)
		return count == 1, err
	}
	count, err := s.db.NewSelect().Model((*models.ExternalAppAccountGrant)(nil)).Where("installation_id = ? AND workspace_id = ? AND social_account_id = ?", installationID, workspaceID, accountID).Count(ctx)
	return count == 1, err
}

func (s *Service) applicationByClientID(ctx context.Context, clientID string) (*models.ExternalApplication, error) {
	var app models.ExternalApplication
	if err := s.db.NewSelect().Model(&app).Where("client_id = ? AND revoked_at IS NULL", strings.TrimSpace(clientID)).Scan(ctx); err != nil {
		return nil, ErrInvalidClient
	}
	return &app, nil
}

func (s *Service) validateWorkspaceGrants(ctx context.Context, userID, sessionID string, inputs []WorkspaceGrantInput) ([]WorkspaceGrantInput, error) {
	if userID == "" || len(inputs) == 0 {
		return nil, ErrWorkspaceNotAllowed
	}
	seen := make(map[string]struct{}, len(inputs))
	out := make([]WorkspaceGrantInput, 0, len(inputs))
	for _, input := range inputs {
		input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
		if input.WorkspaceID == "" {
			return nil, ErrWorkspaceNotAllowed
		}
		if _, exists := seen[input.WorkspaceID]; exists {
			return nil, ErrInvalidRequest
		}
		seen[input.WorkspaceID] = struct{}{}
		count, err := s.db.NewSelect().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ? AND user_id = ? AND role = ? AND status = ?", input.WorkspaceID, userID, models.WorkspaceRoleAdmin, models.WorkspaceMemberStatusActive).Count(ctx)
		if err != nil || count != 1 {
			return nil, ErrWorkspaceNotAllowed
		}
		input.AccountIDs = uniqueSorted(input.AccountIDs)
		if input.AllCurrentAccounts && len(input.AccountIDs) > 0 {
			return nil, ErrInvalidRequest
		}
		if len(input.AccountIDs) > 0 {
			count, err = s.db.NewSelect().Model((*models.SocialAccount)(nil)).Where("workspace_id = ? AND is_active = ? AND id IN (?)", input.WorkspaceID, true, bun.List(input.AccountIDs)).Count(ctx)
			if err != nil || count != len(input.AccountIDs) {
				return nil, ErrAccountNotAllowed
			}
		}
		policy, err := identity.AuthorizeTokenCreation(ctx, s.db, userID, sessionID, input.WorkspaceID, s.now().Add(refreshTokenLifetime))
		if err != nil || !policy.Allowed {
			return nil, ErrWorkspaceNotAllowed
		}
		input.OrganizationID = policy.OrganizationID
		input.IdentityProviderID = policy.ProviderID
		input.AssuredAt = policy.AssuredAt
		input.CredentialExpiresAt = policy.ExpiresAt
		out = append(out, input)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WorkspaceID < out[j].WorkspaceID })
	return out, nil
}

func normalizeScopes(values []string) (string, error) {
	values = uniqueSorted(values)
	if len(values) == 0 {
		return "", ErrInvalidScope
	}
	for _, value := range values {
		if !slices.Contains(supportedScopes, value) {
			return "", ErrInvalidScope
		}
	}
	return strings.Join(values, " "), nil
}

func scopeSubset(requested, allowed string) bool {
	allowedSet := make(map[string]struct{})
	for _, value := range strings.Fields(allowed) {
		allowedSet[value] = struct{}{}
	}
	for _, value := range strings.Fields(requested) {
		if _, ok := allowedSet[value]; !ok {
			return false
		}
	}
	return true
}

func normalizeRedirectURIs(values []string) ([]string, error) {
	values = uniqueSorted(values)
	if len(values) == 0 {
		return nil, ErrInvalidRequest
	}
	for _, value := range values {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Fragment != "" || parsed.User != nil {
			return nil, ErrInvalidRequest
		}
	}
	return values, nil
}

func appRedirect(app *models.ExternalApplication, requested string) (string, error) {
	var redirects []string
	if json.Unmarshal([]byte(app.RedirectURIsJSON), &redirects) != nil || !slices.Contains(redirects, strings.TrimSpace(requested)) {
		return "", ErrInvalidClient
	}
	return strings.TrimSpace(requested), nil
}

func validClientSecret(app *models.ExternalApplication, supplied string) bool {
	if app.ClientType == ClientTypePublic {
		return strings.TrimSpace(supplied) == ""
	}
	return subtle.ConstantTimeCompare([]byte(app.ClientSecretHash), []byte(hashSecret(supplied))) == 1
}

func validatePKCE(challenge string) error {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(challenge))
	if err != nil || len(decoded) != sha256.Size {
		return ErrInvalidRequest
	}
	return nil
}

func validVerifier(challenge, verifier string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	actual := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(challenge), []byte(actual)) == 1
}

func generateSecret(prefix string) (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(value), nil
}

func hashSecret(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}

func secretPrefix(value string) string {
	hash := hashSecret(value)
	return hash[:8]
}

func uniqueSorted(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			set[value] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func oauthRedirect(redirectURI, code, state, issuer string) string {
	parsed, _ := url.Parse(redirectURI)
	query := parsed.Query()
	query.Set("code", code)
	query.Set("state", state)
	query.Set("iss", issuer)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func oauthErrorRedirect(redirectURI, code, state, issuer string) string {
	parsed, _ := url.Parse(redirectURI)
	query := parsed.Query()
	query.Set("error", code)
	query.Set("state", state)
	query.Set("iss", issuer)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
