package identity

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
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
	"golang.org/x/oauth2"
)

const (
	EnvironmentProviderID = "instance"
	AuthRequestTTL        = 10 * time.Minute
	ReauthGrantTTL        = 5 * time.Minute
	NativeHandoffTTL      = 2 * time.Minute
	defaultAssuranceAge   = 12 * time.Hour
	runtimeCacheTTL       = 15 * time.Minute
)

var (
	ErrProviderNotFound       = errors.New("identity provider not found")
	ErrProviderDisabled       = errors.New("identity provider is disabled")
	ErrInvalidAuthRequest     = errors.New("invalid or expired oidc authentication request")
	ErrBrowserBinding         = errors.New("oidc browser binding mismatch")
	ErrNonceMismatch          = errors.New("oidc nonce mismatch")
	ErrMissingIDToken         = errors.New("oidc token response did not contain an id token")
	ErrIdentityCollision      = errors.New("external identity is already linked to another user")
	ErrEmailConflict          = errors.New("an OpenPost account already uses this email")
	ErrJITDisabled            = errors.New("just-in-time provisioning is disabled")
	ErrVerifiedEmailRequired  = errors.New("a verified email claim is required")
	ErrUserInfoSubject        = errors.New("userinfo subject does not match id token subject")
	ErrReauthRequired         = errors.New("recent reauthentication is required")
	ErrInvalidReauthGrant     = errors.New("invalid or expired reauthentication grant")
	ErrNativeHandoff          = errors.New("invalid or expired native oidc handoff")
	ErrTokenPolicyDenied      = errors.New("organization policy does not allow this token")
	ErrSSOAssuranceRequired   = errors.New("organization sso authentication is required")
	ErrBackchannelLogout      = errors.New("invalid oidc back-channel logout request")
	ErrDomainVerification     = errors.New("identity provider domain verification failed")
	ErrOrganizationPermission = errors.New("organization administrator access required")
)

type EnvironmentProviderConfig struct {
	Issuer            string
	ClientID          string
	ClientSecret      string
	Name              string
	Scopes            []string
	JITEnabled        bool
	BootstrapSubjects []string
}

type Config struct {
	PublicURL           string
	NativeCallbackURL   string
	Environment         EnvironmentProviderConfig
	DefaultAssuranceAge time.Duration
}

type Service struct {
	db        *bun.DB
	encryptor *servicecrypto.TokenEncryptor
	config    Config
	now       func() time.Time

	mu          sync.Mutex
	runtimes    map[string]cachedRuntime
	httpClients map[string]*http.Client
}

type cachedRuntime struct {
	value    *ProviderRuntime
	loadedAt time.Time
}

type ProviderRuntime struct {
	Provider           *oidc.Provider
	Verifier           *oidc.IDTokenVerifier
	OAuth2             oauth2.Config
	HTTPClient         *http.Client
	EndSessionEndpoint string
}

type BeginInput struct {
	ProviderID     string
	UserID         string
	SessionID      string
	OrganizationID string
	Intent         string
	ReauthAction   string
	ReturnPath     string
	BrowserBinding string
	Native         bool
}

type BeginResult struct {
	AuthorizationURL string
	BrowserBinding   string
	ExpiresAt        time.Time
}

type VerifiedIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
	AuthTime      time.Time
	ACR           string
	AMR           []string
	UpstreamSID   string
}

type Completion struct {
	Request     models.OIDCAuthRequest
	Provider    models.IdentityProvider
	User        *models.User
	Identity    VerifiedIdentity
	ReauthGrant string
}

type providerMetadata struct {
	EndSessionEndpoint string `json:"end_session_endpoint"`
}

var hostedIssuerPolicy = netguard.URLPolicy{
	Label:            "oidc issuer",
	AllowedSchemes:   []string{"https"},
	AllowCustomPorts: true,
}

func NewService(db *bun.DB, encryptor *servicecrypto.TokenEncryptor, cfg Config) *Service {
	cfg.PublicURL = strings.TrimRight(strings.TrimSpace(cfg.PublicURL), "/")
	cfg.NativeCallbackURL = strings.TrimSpace(cfg.NativeCallbackURL)
	cfg.Environment.Issuer = strings.TrimSpace(cfg.Environment.Issuer)
	cfg.Environment.ClientID = strings.TrimSpace(cfg.Environment.ClientID)
	cfg.Environment.Name = strings.TrimSpace(cfg.Environment.Name)
	cfg.Environment.Scopes = normalizeScopes(cfg.Environment.Scopes)
	if cfg.Environment.Name == "" {
		cfg.Environment.Name = "Single sign-on"
	}
	if cfg.DefaultAssuranceAge <= 0 {
		cfg.DefaultAssuranceAge = defaultAssuranceAge
	}
	return &Service{
		db:          db,
		encryptor:   encryptor,
		config:      cfg,
		now:         func() time.Time { return time.Now().UTC() },
		runtimes:    map[string]cachedRuntime{},
		httpClients: map[string]*http.Client{},
	}
}

func (s *Service) SetHTTPClient(providerID string, client *http.Client) {
	if client == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.httpClients[strings.TrimSpace(providerID)] = client
	delete(s.runtimes, strings.TrimSpace(providerID))
}

func (s *Service) SyncEnvironmentProvider(ctx context.Context) error {
	issuer := s.config.Environment.Issuer
	clientID := s.config.Environment.ClientID
	if issuer == "" && clientID == "" {
		return nil
	}
	if issuer == "" || clientID == "" {
		return fmt.Errorf("OPENPOST_OIDC_ISSUER and OPENPOST_OIDC_CLIENT_ID must be configured together")
	}
	now := s.now()
	row := &models.IdentityProvider{
		ID:                   EnvironmentProviderID,
		Source:               "environment",
		Issuer:               issuer,
		Name:                 s.config.Environment.Name,
		ClientID:             clientID,
		Scopes:               strings.Join(s.config.Environment.Scopes, " "),
		EmailClaim:           "email",
		NameClaim:            "name",
		PictureClaim:         "picture",
		RequireVerifiedEmail: true,
		JITEnabled:           s.config.Environment.JITEnabled,
		IsActive:             true,
		HealthStatus:         "unchecked",
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	_, err := s.db.NewInsert().
		Model(row).
		On("CONFLICT (id) DO UPDATE").
		Set("source = EXCLUDED.source").
		Set("issuer = EXCLUDED.issuer").
		Set("name = EXCLUDED.name").
		Set("client_id = EXCLUDED.client_id").
		Set("scopes = EXCLUDED.scopes").
		Set("jit_enabled = EXCLUDED.jit_enabled").
		Set("is_active = EXCLUDED.is_active").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err == nil {
		s.invalidateRuntime(row.ID)
	}
	return err
}

func (s *Service) EnvironmentConfigured() bool {
	return s.config.Environment.Issuer != "" && s.config.Environment.ClientID != ""
}

func (s *Service) ListPublicProviders(ctx context.Context) ([]models.IdentityProvider, error) {
	var providers []models.IdentityProvider
	err := s.db.NewSelect().
		Model(&providers).
		Where("organization_id IS NULL").
		Where("is_active = ?", true).
		Order("name ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return []models.IdentityProvider{}, nil
	}
	return providers, err
}

func (s *Service) ListLinkableProviders(ctx context.Context, userID string) ([]models.IdentityProvider, error) {
	var providers []models.IdentityProvider
	err := s.db.NewSelect().
		Model(&providers).
		Distinct().
		Where("identity_provider.is_active = ?", true).
		WhereGroup(" AND ", func(query *bun.SelectQuery) *bun.SelectQuery {
			return query.
				Where("identity_provider.organization_id IS NULL").
				WhereOr("identity_provider.organization_id IN (?)", s.db.NewSelect().
					Model((*models.OrganizationMember)(nil)).
					Column("organization_id").
					Where("user_id = ?", strings.TrimSpace(userID)))
		}).
		Order("identity_provider.name ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return []models.IdentityProvider{}, nil
	}
	return providers, err
}

func (s *Service) GetProvider(ctx context.Context, providerID string) (*models.IdentityProvider, error) {
	var provider models.IdentityProvider
	if err := s.db.NewSelect().
		Model(&provider).
		Where("id = ?", strings.TrimSpace(providerID)).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrProviderNotFound
		}
		return nil, err
	}
	if !provider.IsActive {
		return nil, ErrProviderDisabled
	}
	return &provider, nil
}

func (s *Service) Begin(ctx context.Context, input BeginInput) (*BeginResult, error) {
	provider, err := s.GetProvider(ctx, input.ProviderID)
	if err != nil {
		return nil, err
	}
	intent, err := validateBeginInput(input)
	if err != nil {
		return nil, ErrInvalidAuthRequest
	}

	runtime, err := s.runtime(ctx, *provider)
	if err != nil {
		_ = s.recordProviderHealth(ctx, provider.ID, "unavailable", safeOperationalError(err))
		return nil, err
	}
	_ = s.recordProviderHealth(ctx, provider.ID, "healthy", "")

	request, state, nonce, verifier, binding, err := s.newAuthRequest(provider.ID, input, intent)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.NewInsert().Model(request).Exec(ctx); err != nil {
		return nil, err
	}
	_, _ = s.db.NewDelete().
		Model((*models.OIDCAuthRequest)(nil)).
		Where("expires_at < ?", request.CreatedAt).
		Exec(ctx)

	options := []oauth2.AuthCodeOption{
		oidc.Nonce(nonce),
		oauth2.S256ChallengeOption(verifier),
	}
	if intent == models.OIDCIntentReauth {
		options = append(options,
			oauth2.SetAuthURLParam("prompt", "login"),
			oauth2.SetAuthURLParam("max_age", "0"),
		)
	}
	return &BeginResult{
		AuthorizationURL: runtime.OAuth2.AuthCodeURL(state, options...),
		BrowserBinding:   binding,
		ExpiresAt:        request.ExpiresAt,
	}, nil
}

func validateBeginInput(input BeginInput) (string, error) {
	intent := strings.TrimSpace(input.Intent)
	if !slices.Contains([]string{models.OIDCIntentLogin, models.OIDCIntentLink, models.OIDCIntentReauth}, intent) {
		return "", ErrInvalidAuthRequest
	}
	if intent != models.OIDCIntentLogin &&
		(strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.SessionID) == "") {
		return "", ErrInvalidAuthRequest
	}
	if intent == models.OIDCIntentReauth && strings.TrimSpace(input.ReauthAction) == "" {
		return "", ErrInvalidAuthRequest
	}
	return intent, nil
}

func (s *Service) newAuthRequest(
	providerID string,
	input BeginInput,
	intent string,
) (*models.OIDCAuthRequest, string, string, string, string, error) {
	state, err := randomToken(32)
	if err != nil {
		return nil, "", "", "", "", err
	}
	nonce, err := randomToken(32)
	if err != nil {
		return nil, "", "", "", "", err
	}
	verifier, err := randomToken(48)
	if err != nil {
		return nil, "", "", "", "", err
	}
	binding := strings.TrimSpace(input.BrowserBinding)
	if len(binding) < 32 || len(binding) > 256 {
		binding, err = randomToken(32)
		if err != nil {
			return nil, "", "", "", "", err
		}
	}
	encryptedVerifier, err := s.encryptor.Encrypt(verifier)
	if err != nil {
		return nil, "", "", "", "", err
	}
	now := s.now()
	request := &models.OIDCAuthRequest{
		ID:                 uuid.NewString(),
		ProviderID:         providerID,
		UserID:             strings.TrimSpace(input.UserID),
		SessionID:          strings.TrimSpace(input.SessionID),
		OrganizationID:     strings.TrimSpace(input.OrganizationID),
		StateHash:          hashSecret(state),
		NonceHash:          hashSecret(nonce),
		BrowserBindingHash: hashSecret(binding),
		PKCEVerifierEnc:    encryptedVerifier,
		Intent:             intent,
		ReauthAction:       strings.TrimSpace(input.ReauthAction),
		ReturnPath:         SafeReturnPath(input.ReturnPath),
		Native:             input.Native,
		ExpiresAt:          now.Add(AuthRequestTTL),
		CreatedAt:          now,
	}
	return request, state, nonce, verifier, binding, nil
}

func (s *Service) Complete(ctx context.Context, providerID, state, code, browserBinding string) (*Completion, error) {
	request, err := s.consumeAuthRequest(ctx, providerID, state, browserBinding)
	if err != nil {
		return nil, err
	}
	provider, err := s.GetProvider(ctx, providerID)
	if err != nil {
		return nil, err
	}
	runtime, err := s.runtime(ctx, *provider)
	if err != nil {
		_ = s.recordProviderHealth(ctx, provider.ID, "unavailable", safeOperationalError(err))
		return nil, err
	}
	verified, err := s.verifyAuthorizationCode(ctx, *provider, runtime, request, code)
	if err != nil {
		return nil, err
	}

	user, err := s.resolveIdentity(ctx, *provider, *request, verified)
	if err != nil {
		return nil, err
	}
	completion := &Completion{
		Request:  *request,
		Provider: *provider,
		User:     user,
		Identity: verified,
	}
	if request.Intent == models.OIDCIntentReauth {
		completion.ReauthGrant, err = s.CreateReauthGrant(
			ctx,
			request.UserID,
			request.SessionID,
			request.ReauthAction,
			"oidc",
			provider.ID,
		)
		if err != nil {
			return nil, err
		}
	}
	return completion, nil
}

func (s *Service) verifyAuthorizationCode(
	ctx context.Context,
	provider models.IdentityProvider,
	runtime *ProviderRuntime,
	request *models.OIDCAuthRequest,
	code string,
) (VerifiedIdentity, error) {
	verifier, err := s.encryptor.Decrypt(request.PKCEVerifierEnc)
	if err != nil || verifier == "" {
		return VerifiedIdentity{}, ErrInvalidAuthRequest
	}
	exchangeCtx := oidc.ClientContext(ctx, runtime.HTTPClient)
	token, err := runtime.OAuth2.Exchange(exchangeCtx, strings.TrimSpace(code), oauth2.VerifierOption(verifier))
	if err != nil {
		return VerifiedIdentity{}, fmt.Errorf("oidc code exchange failed: %w", err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || strings.TrimSpace(rawIDToken) == "" {
		return VerifiedIdentity{}, ErrMissingIDToken
	}
	idToken, err := runtime.Verifier.Verify(exchangeCtx, rawIDToken)
	if err != nil {
		return VerifiedIdentity{}, fmt.Errorf("oidc id token verification failed: %w", err)
	}
	if subtle.ConstantTimeCompare([]byte(hashSecret(idToken.Nonce)), []byte(request.NonceHash)) != 1 {
		return VerifiedIdentity{}, ErrNonceMismatch
	}
	verified, err := s.normalizedIdentity(exchangeCtx, provider, runtime, token, idToken)
	if err != nil {
		return VerifiedIdentity{}, err
	}
	if request.Intent == models.OIDCIntentReauth && verified.AuthTime.IsZero() {
		return VerifiedIdentity{}, errors.New("oidc reauthentication response is missing auth_time")
	}
	return verified, nil
}

func (s *Service) consumeAuthRequest(ctx context.Context, providerID, state, browserBinding string) (*models.OIDCAuthRequest, error) {
	var request models.OIDCAuthRequest
	if err := s.db.NewSelect().
		Model(&request).
		Where("provider_id = ? AND state_hash = ?", strings.TrimSpace(providerID), hashSecret(state)).
		Scan(ctx); err != nil {
		return nil, ErrInvalidAuthRequest
	}
	now := s.now()
	if !request.ExpiresAt.After(now) || !request.ConsumedAt.IsZero() {
		return nil, ErrInvalidAuthRequest
	}
	if subtle.ConstantTimeCompare(
		[]byte(request.BrowserBindingHash),
		[]byte(hashSecret(strings.TrimSpace(browserBinding))),
	) != 1 {
		return nil, ErrBrowserBinding
	}
	result, err := s.db.NewUpdate().
		Model((*models.OIDCAuthRequest)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND consumed_at IS NULL AND expires_at > ?", request.ID, now).
		Exec(ctx)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return nil, ErrInvalidAuthRequest
	}
	request.ConsumedAt = now
	return &request, nil
}

func (s *Service) normalizedIdentity(
	ctx context.Context,
	provider models.IdentityProvider,
	runtime *ProviderRuntime,
	token *oauth2.Token,
	idToken *oidc.IDToken,
) (VerifiedIdentity, error) {
	var claims map[string]json.RawMessage
	if err := idToken.Claims(&claims); err != nil {
		return VerifiedIdentity{}, err
	}
	identity := VerifiedIdentity{
		Subject:     strings.TrimSpace(idToken.Subject),
		Email:       claimString(claims, provider.EmailClaim),
		Name:        claimString(claims, provider.NameClaim),
		Picture:     claimString(claims, provider.PictureClaim),
		ACR:         claimString(claims, "acr"),
		UpstreamSID: claimString(claims, "sid"),
		AMR:         claimStrings(claims, "amr"),
	}
	identity.EmailVerified = claimBool(claims, "email_verified")
	if authTime := claimInt64(claims, "auth_time"); authTime > 0 {
		identity.AuthTime = time.Unix(authTime, 0).UTC()
	}
	if identity.AuthTime.After(s.now().Add(time.Minute)) {
		return VerifiedIdentity{}, errors.New("oidc auth_time is in the future")
	}
	if provider.UseUserInfo {
		userInfo, err := runtime.Provider.UserInfo(ctx, oauth2.StaticTokenSource(token))
		if err != nil {
			return VerifiedIdentity{}, fmt.Errorf("oidc userinfo request failed: %w", err)
		}
		if userInfo.Subject != identity.Subject {
			return VerifiedIdentity{}, ErrUserInfoSubject
		}
		var userInfoClaims map[string]json.RawMessage
		if err := userInfo.Claims(&userInfoClaims); err != nil {
			return VerifiedIdentity{}, err
		}
		if value := claimString(userInfoClaims, provider.EmailClaim); value != "" {
			identity.Email = value
			identity.EmailVerified = claimBool(userInfoClaims, "email_verified")
		}
		if value := claimString(userInfoClaims, provider.NameClaim); value != "" {
			identity.Name = value
		}
		if value := claimString(userInfoClaims, provider.PictureClaim); value != "" {
			identity.Picture = value
		}
	}
	identity.Email = strings.ToLower(strings.TrimSpace(identity.Email))
	if identity.Subject == "" {
		return VerifiedIdentity{}, errors.New("oidc subject is missing")
	}
	if provider.RequireVerifiedEmail && (identity.Email == "" || !identity.EmailVerified) {
		return VerifiedIdentity{}, ErrVerifiedEmailRequired
	}
	return identity, nil
}

func (s *Service) resolveIdentity(
	ctx context.Context,
	provider models.IdentityProvider,
	request models.OIDCAuthRequest,
	verified VerifiedIdentity,
) (*models.User, error) {
	var linked models.UserIdentity
	err := s.db.NewSelect().
		Model(&linked).
		Where("provider_id = ? AND subject = ?", provider.ID, verified.Subject).
		Scan(ctx)
	if err == nil {
		if request.Intent == models.OIDCIntentLink && linked.UserID != request.UserID {
			return nil, ErrIdentityCollision
		}
		if request.Intent == models.OIDCIntentReauth && linked.UserID != request.UserID {
			return nil, ErrIdentityCollision
		}
		if _, err := s.db.NewUpdate().
			Model((*models.UserIdentity)(nil)).
			Set("last_login_at = ?", s.now()).
			Where("id = ?", linked.ID).
			Exec(ctx); err != nil {
			return nil, err
		}
		return s.userByID(ctx, linked.UserID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	switch request.Intent {
	case models.OIDCIntentLink:
		if request.UserID == "" {
			return nil, ErrInvalidAuthRequest
		}
		if err := s.linkIdentity(ctx, provider, request.UserID, verified); err != nil {
			return nil, err
		}
		return s.userByID(ctx, request.UserID)
	case models.OIDCIntentReauth:
		return nil, ErrIdentityCollision
	case models.OIDCIntentLogin:
		if !provider.JITEnabled {
			return nil, ErrJITDisabled
		}
		return s.createJITUser(ctx, provider, verified)
	default:
		return nil, ErrInvalidAuthRequest
	}
}

func (s *Service) linkIdentity(
	ctx context.Context,
	provider models.IdentityProvider,
	userID string,
	verified VerifiedIdentity,
) error {
	now := s.now()
	identity := &models.UserIdentity{
		ID:          uuid.NewString(),
		ProviderID:  provider.ID,
		Subject:     verified.Subject,
		UserID:      userID,
		LinkedEmail: verified.Email,
		CreatedAt:   now,
		LastLoginAt: now,
	}
	if _, err := s.db.NewInsert().Model(identity).Exec(ctx); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrIdentityCollision
		}
		return err
	}
	return s.Audit(ctx, AuditInput{
		OrganizationID: provider.OrganizationID,
		ProviderID:     provider.ID,
		ActorUserID:    userID,
		SubjectUserID:  userID,
		Action:         "identity.linked",
	})
}

func (s *Service) createJITUser(
	ctx context.Context,
	provider models.IdentityProvider,
	verified VerifiedIdentity,
) (*models.User, error) {
	if verified.Email == "" {
		return nil, ErrVerifiedEmailRequired
	}
	exists, err := s.db.NewSelect().
		Model((*models.User)(nil)).
		Where("LOWER(email) = ?", verified.Email).
		Exists(ctx)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrEmailConflict
	}

	now := s.now()
	user := &models.User{
		ID:          uuid.NewString(),
		Email:       verified.Email,
		DisplayName: verified.Name,
		AvatarURL:   verified.Picture,
		IsAdmin: provider.ID == EnvironmentProviderID && provider.Source == "environment" &&
			s.bootstrapSubjectAllowed(provider.Issuer, verified.Subject, verified.Email),
		CreatedAt: now,
	}
	identity := &models.UserIdentity{
		ID:          uuid.NewString(),
		ProviderID:  provider.ID,
		Subject:     verified.Subject,
		UserID:      user.ID,
		LinkedEmail: verified.Email,
		CreatedAt:   now,
		LastLoginAt: now,
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(user).Exec(txCtx); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return ErrEmailConflict
			}
			return err
		}
		if _, err := tx.NewInsert().Model(identity).Exec(txCtx); err != nil {
			return err
		}
		if provider.OrganizationID != "" {
			member := &models.OrganizationMember{
				OrganizationID: provider.OrganizationID,
				UserID:         user.ID,
				Role:           models.OrganizationRoleMember,
				CreatedAt:      now,
			}
			if _, err := tx.NewInsert().
				Model(member).
				On("CONFLICT (organization_id, user_id) DO NOTHING").
				Exec(txCtx); err != nil {
				return err
			}
		}
		return insertAudit(txCtx, tx, AuditInput{
			OrganizationID: provider.OrganizationID,
			ProviderID:     provider.ID,
			SubjectUserID:  user.ID,
			Action:         "identity.jit_provisioned",
		}, now)
	})
	if err != nil {
		return nil, err
	}
	return user, nil
}

func (s *Service) bootstrapSubjectAllowed(issuer, subject, email string) bool {
	values := []string{
		strings.TrimSpace(issuer) + "|" + strings.TrimSpace(subject),
		strings.ToLower(strings.TrimSpace(email)),
	}
	for _, allowed := range s.config.Environment.BootstrapSubjects {
		if slices.Contains(values, strings.TrimSpace(allowed)) {
			return true
		}
	}
	return false
}

func (s *Service) userByID(ctx context.Context, userID string) (*models.User, error) {
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("id = ?", userID).Scan(ctx); err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Service) runtime(ctx context.Context, provider models.IdentityProvider) (*ProviderRuntime, error) {
	s.mu.Lock()
	if cached, ok := s.runtimes[provider.ID]; ok && s.now().Sub(cached.loadedAt) < runtimeCacheTTL {
		s.mu.Unlock()
		return cached.value, nil
	}
	client := s.httpClients[provider.ID]
	s.mu.Unlock()

	if client == nil {
		if provider.Source == "environment" {
			client = &http.Client{Timeout: 10 * time.Second}
		} else {
			issuerURL, err := url.Parse(provider.Issuer)
			if err != nil {
				return nil, err
			}
			if err := netguard.ValidateURL(ctx, issuerURL, hostedIssuerPolicy); err != nil {
				return nil, err
			}
			client = netguard.NewHTTPClient(10*time.Second, hostedIssuerPolicy)
		}
	}
	discoveryCtx := oidc.ClientContext(ctx, client)
	discovered, err := oidc.NewProvider(discoveryCtx, provider.Issuer)
	if err != nil {
		return nil, err
	}
	var metadata providerMetadata
	if err := discovered.Claims(&metadata); err != nil {
		return nil, err
	}
	secret, err := s.providerSecret(provider)
	if err != nil {
		return nil, err
	}
	runtime := &ProviderRuntime{
		Provider:   discovered,
		Verifier:   discovered.Verifier(&oidc.Config{ClientID: provider.ClientID}),
		HTTPClient: client,
		OAuth2: oauth2.Config{
			ClientID:     provider.ClientID,
			ClientSecret: secret,
			RedirectURL:  s.callbackURL(provider.ID),
			Endpoint:     discovered.Endpoint(),
			Scopes:       normalizeScopes(strings.Fields(provider.Scopes)),
		},
		EndSessionEndpoint: strings.TrimSpace(metadata.EndSessionEndpoint),
	}
	s.mu.Lock()
	s.runtimes[provider.ID] = cachedRuntime{value: runtime, loadedAt: s.now()}
	s.mu.Unlock()
	return runtime, nil
}

func (s *Service) providerSecret(provider models.IdentityProvider) (string, error) {
	if provider.Source == "environment" && provider.ID == EnvironmentProviderID {
		return s.config.Environment.ClientSecret, nil
	}
	return s.encryptor.Decrypt(provider.ClientSecretEnc)
}

func (s *Service) callbackURL(providerID string) string {
	return s.config.PublicURL + "/api/v1/auth/oidc/" + url.PathEscape(providerID) + "/callback"
}

func (s *Service) CallbackURL(providerID string) string {
	return s.callbackURL(providerID)
}

func (s *Service) NativeCallbackURL() string {
	return s.config.NativeCallbackURL
}

func (s *Service) PublicURL() string {
	return s.config.PublicURL
}

func (s *Service) invalidateRuntime(providerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runtimes, providerID)
}

func (s *Service) recordProviderHealth(ctx context.Context, providerID, status, message string) error {
	_, err := s.db.NewUpdate().
		Model((*models.IdentityProvider)(nil)).
		Set("health_status = ?", status).
		Set("health_message = ?", message).
		Set("last_checked_at = ?", s.now()).
		Where("id = ?", providerID).
		Exec(ctx)
	return err
}

func normalizeScopes(scopes []string) []string {
	result := make([]string, 0, len(scopes)+1)
	seen := map[string]bool{}
	for _, scope := range append([]string{oidc.ScopeOpenID}, scopes...) {
		for _, field := range strings.Fields(scope) {
			if field == "" || seen[field] || field == oidc.ScopeOfflineAccess {
				continue
			}
			seen[field] = true
			result = append(result, field)
		}
	}
	if len(result) == 1 {
		result = append(result, oidc.ScopeProfile, oidc.ScopeEmail)
	}
	return result
}

func SafeReturnPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") ||
		strings.HasPrefix(parsed.Path, "//") || strings.HasPrefix(raw, "\\") {
		return "/"
	}
	return parsed.String()
}

func randomToken(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashSecret(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}

func claimString(claims map[string]json.RawMessage, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	var value string
	_ = json.Unmarshal(claims[name], &value)
	return strings.TrimSpace(value)
}

func claimStrings(claims map[string]json.RawMessage, name string) []string {
	var values []string
	if err := json.Unmarshal(claims[name], &values); err == nil {
		return values
	}
	if value := claimString(claims, name); value != "" {
		return strings.Fields(value)
	}
	return []string{}
}

func claimBool(claims map[string]json.RawMessage, name string) bool {
	var value bool
	_ = json.Unmarshal(claims[name], &value)
	return value
}

func claimInt64(claims map[string]json.RawMessage, name string) int64 {
	var value int64
	_ = json.Unmarshal(claims[name], &value)
	return value
}

func safeOperationalError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 240 {
		message = message[:240]
	}
	return message
}
