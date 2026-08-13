package identity

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/uptrace/bun"
)

type ProviderUpsertInput struct {
	ID                   string
	OrganizationID       string
	Name                 string
	Issuer               string
	ClientID             string
	ClientSecret         *string
	Scopes               []string
	EmailClaim           string
	NameClaim            string
	PictureClaim         string
	UseUserInfo          bool
	RequireVerifiedEmail bool
	JITEnabled           bool
	IsActive             bool
	ActorUserID          string
}

type DomainCreateResult struct {
	Domain            models.IdentityProviderDomain
	VerificationToken string
	DNSName           string
	DNSValue          string
}

type AuditInput struct {
	OrganizationID string
	ProviderID     string
	ActorUserID    string
	SubjectUserID  string
	Action         string
	Detail         string
}

func (s *Service) ListOrganizationProviders(ctx context.Context, organizationID string) ([]models.IdentityProvider, error) {
	var providers []models.IdentityProvider
	err := s.db.NewSelect().
		Model(&providers).
		Where("organization_id = ?", organizationID).
		Order("name ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return []models.IdentityProvider{}, nil
	}
	return providers, err
}

func (s *Service) UpsertProvider(ctx context.Context, input ProviderUpsertInput) (*models.IdentityProvider, error) {
	input.OrganizationID = strings.TrimSpace(input.OrganizationID)
	if input.OrganizationID == "" {
		return nil, errors.New("organization id is required")
	}
	if err := RequireOrganizationAdmin(ctx, s.db, input.OrganizationID, input.ActorUserID); err != nil {
		return nil, err
	}
	issuer, err := validateHostedProviderInput(input)
	if err != nil {
		return nil, err
	}
	existing, err := s.providerForUpsert(ctx, input.ID, input.OrganizationID)
	if err != nil {
		return nil, err
	}
	row, err := s.buildHostedProvider(input, issuer, existing)
	if err != nil {
		return nil, err
	}
	if err := s.validateHostedProviderDiscovery(ctx, row); err != nil {
		return nil, err
	}
	if err := s.saveHostedProvider(ctx, row); err != nil {
		return nil, err
	}
	s.invalidateRuntime(row.ID)
	if err := s.Audit(ctx, AuditInput{
		OrganizationID: row.OrganizationID,
		ProviderID:     row.ID,
		ActorUserID:    input.ActorUserID,
		Action:         "provider.saved",
	}); err != nil {
		return nil, err
	}
	return row, nil
}

func validateHostedProviderInput(input ProviderUpsertInput) (string, error) {
	issuer := strings.TrimSpace(input.Issuer)
	issuerURL, err := url.Parse(issuer)
	if err != nil || issuerURL.Scheme != "https" || issuerURL.Host == "" ||
		issuerURL.RawQuery != "" || issuerURL.Fragment != "" {
		return "", errors.New("issuer must be an absolute HTTPS URL without a query or fragment")
	}
	if strings.EqualFold(issuerURL.Hostname(), "login.microsoftonline.com") {
		parts := strings.Split(strings.Trim(issuerURL.Path, "/"), "/")
		tenant := ""
		if len(parts) > 0 {
			tenant = strings.ToLower(strings.TrimSpace(parts[0]))
		}
		if tenant == "" || slicesContains([]string{"common", "organizations", "consumers"}, tenant) {
			return "", errors.New("microsoft Entra OIDC requires a tenant-specific issuer")
		}
	}
	if strings.TrimSpace(input.ClientID) == "" {
		return "", errors.New("client id is required")
	}
	if strings.TrimSpace(input.Name) == "" {
		return "", errors.New("provider name is required")
	}
	return issuer, nil
}

func (s *Service) providerForUpsert(
	ctx context.Context,
	providerID,
	organizationID string,
) (models.IdentityProvider, error) {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return models.IdentityProvider{}, nil
	}
	var existing models.IdentityProvider
	if err := s.db.NewSelect().Model(&existing).
		Where("id = ? AND organization_id = ?", providerID, organizationID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.IdentityProvider{}, ErrProviderNotFound
		}
		return models.IdentityProvider{}, err
	}
	return existing, nil
}

func (s *Service) buildHostedProvider(
	input ProviderUpsertInput,
	issuer string,
	existing models.IdentityProvider,
) (*models.IdentityProvider, error) {
	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = uuid.NewString()
	}
	secretEncrypted := existing.ClientSecretEnc
	if input.ClientSecret != nil {
		encrypted, err := s.encryptor.Encrypt(strings.TrimSpace(*input.ClientSecret))
		if err != nil {
			return nil, err
		}
		secretEncrypted = encrypted
	}
	now := s.now()
	createdAt := existing.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	return &models.IdentityProvider{
		ID:                   id,
		OrganizationID:       input.OrganizationID,
		Source:               "database",
		Issuer:               issuer,
		Name:                 strings.TrimSpace(input.Name),
		ClientID:             strings.TrimSpace(input.ClientID),
		ClientSecretEnc:      secretEncrypted,
		Scopes:               strings.Join(normalizeScopes(input.Scopes), " "),
		EmailClaim:           defaultClaim(input.EmailClaim, "email"),
		NameClaim:            defaultClaim(input.NameClaim, "name"),
		PictureClaim:         defaultClaim(input.PictureClaim, "picture"),
		UseUserInfo:          input.UseUserInfo,
		RequireVerifiedEmail: input.RequireVerifiedEmail,
		JITEnabled:           input.JITEnabled,
		IsActive:             input.IsActive,
		HealthStatus:         "unchecked",
		CreatedByUserID:      input.ActorUserID,
		CreatedAt:            createdAt,
		UpdatedAt:            now,
	}, nil
}

func (s *Service) validateHostedProviderDiscovery(ctx context.Context, row *models.IdentityProvider) error {
	// Validate discovery before storing tenant-controlled endpoints. The
	// provider remains optional at process startup, but administrators get a
	// precise save-time failure.
	s.SetHTTPClient(row.ID, s.hostedClient())
	defer s.invalidateRuntime(row.ID)
	if _, err := s.runtime(ctx, *row); err != nil {
		return fmt.Errorf("oidc discovery validation failed: %w", err)
	}
	return nil
}

func (s *Service) saveHostedProvider(ctx context.Context, row *models.IdentityProvider) error {
	_, err := s.db.NewInsert().
		Model(row).
		On("CONFLICT (id) DO UPDATE").
		Set("issuer = EXCLUDED.issuer").
		Set("name = EXCLUDED.name").
		Set("client_id = EXCLUDED.client_id").
		Set("client_secret_encrypted = EXCLUDED.client_secret_encrypted").
		Set("scopes = EXCLUDED.scopes").
		Set("email_claim = EXCLUDED.email_claim").
		Set("name_claim = EXCLUDED.name_claim").
		Set("picture_claim = EXCLUDED.picture_claim").
		Set("use_userinfo = EXCLUDED.use_userinfo").
		Set("require_verified_email = EXCLUDED.require_verified_email").
		Set("jit_enabled = EXCLUDED.jit_enabled").
		Set("is_active = EXCLUDED.is_active").
		Set("health_status = EXCLUDED.health_status").
		Set("health_message = EXCLUDED.health_message").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	return err
}

func (s *Service) hostedClient() *http.Client {
	return netguard.NewHTTPClient(10*time.Second, hostedIssuerPolicy)
}

func (s *Service) SetProviderActive(
	ctx context.Context,
	organizationID,
	providerID,
	actorUserID string,
	active bool,
) (int64, error) {
	if err := RequireOrganizationAdmin(ctx, s.db, organizationID, actorUserID); err != nil {
		return 0, err
	}
	if !active {
		policy, err := PolicyForOrganization(ctx, s.db, organizationID)
		if err != nil {
			return 0, err
		}
		if policy.Mode == models.OrganizationSSOModeRequired && slicesContains(policy.ProviderIDs, providerID) {
			activeAlternatives, err := s.db.NewSelect().
				Model((*models.IdentityProvider)(nil)).
				Where("organization_id = ?", organizationID).
				Where("id IN (?)", bun.List(policy.ProviderIDs)).
				Where("id != ?", providerID).
				Where("is_active = ?", true).
				Count(ctx)
			if err != nil {
				return 0, err
			}
			if activeAlternatives == 0 {
				return 0, errors.New("required sso needs at least one active identity provider")
			}
		}
	}
	result, err := s.db.NewUpdate().
		Model((*models.IdentityProvider)(nil)).
		Set("is_active = ?", active).
		Set("updated_at = ?", s.now()).
		Where("id = ? AND organization_id = ?", providerID, organizationID).
		Exec(ctx)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if affected == 0 {
		return 0, ErrProviderNotFound
	}
	s.invalidateRuntime(providerID)
	var revoked int64
	if !active {
		revoked, err = s.RevokeProviderSessions(ctx, providerID)
		if err != nil {
			return 0, err
		}
	}
	action := "provider.enabled"
	if !active {
		action = "provider.disabled"
	}
	err = s.Audit(ctx, AuditInput{
		OrganizationID: organizationID,
		ProviderID:     providerID,
		ActorUserID:    actorUserID,
		Action:         action,
	})
	return revoked, err
}

func (s *Service) GetPolicy(ctx context.Context, organizationID string) (Policy, error) {
	return PolicyForOrganization(ctx, s.db, organizationID)
}

func (s *Service) SavePolicy(ctx context.Context, input Policy, actorUserID string) (Policy, error) {
	if err := RequireOrganizationAdmin(ctx, s.db, input.OrganizationID, actorUserID); err != nil {
		return Policy{}, err
	}
	input, err := NormalizePolicyInput(input)
	if err != nil {
		return Policy{}, err
	}
	if len(input.ProviderIDs) > 0 {
		count, err := s.db.NewSelect().
			Model((*models.IdentityProvider)(nil)).
			Where("organization_id = ?", input.OrganizationID).
			Where("id IN (?)", bun.List(input.ProviderIDs)).
			Count(ctx)
		if err != nil {
			return Policy{}, err
		}
		if count != len(input.ProviderIDs) {
			return Policy{}, errors.New("policy contains an identity provider outside this organization")
		}
		if input.Mode == models.OrganizationSSOModeRequired {
			activeCount, err := s.db.NewSelect().
				Model((*models.IdentityProvider)(nil)).
				Where("organization_id = ?", input.OrganizationID).
				Where("id IN (?)", bun.List(input.ProviderIDs)).
				Where("is_active = ?", true).
				Count(ctx)
			if err != nil {
				return Policy{}, err
			}
			if activeCount == 0 {
				return Policy{}, errors.New("required sso needs at least one active identity provider")
			}
		}
	}
	providerJSON, err := json.Marshal(input.ProviderIDs)
	if err != nil {
		return Policy{}, err
	}
	now := s.now()
	row := &models.OrganizationSSOPolicy{
		OrganizationID:          input.OrganizationID,
		Mode:                    input.Mode,
		ProviderIDs:             string(providerJSON),
		AssuranceMaxAgeSeconds:  input.AssuranceMaxAgeSeconds,
		PasswordLoginAllowed:    input.PasswordLoginAllowed,
		APITokenMode:            input.APITokenMode,
		MaxTokenLifetimeSeconds: input.MaxTokenLifetimeSeconds,
		RequireTokenReauth:      input.RequireTokenReauth,
		UpdatedByUserID:         actorUserID,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	_, err = s.db.NewInsert().
		Model(row).
		Column(
			"organization_id",
			"mode",
			"provider_ids",
			"assurance_max_age_seconds",
			"password_login_allowed",
			"api_token_mode",
			"max_token_lifetime_seconds",
			"require_token_reauth",
			"updated_by_user_id",
			"created_at",
			"updated_at",
		).
		On("CONFLICT (organization_id) DO UPDATE").
		Set("mode = EXCLUDED.mode").
		Set("provider_ids = EXCLUDED.provider_ids").
		Set("assurance_max_age_seconds = EXCLUDED.assurance_max_age_seconds").
		Set("password_login_allowed = EXCLUDED.password_login_allowed").
		Set("api_token_mode = EXCLUDED.api_token_mode").
		Set("max_token_lifetime_seconds = EXCLUDED.max_token_lifetime_seconds").
		Set("require_token_reauth = EXCLUDED.require_token_reauth").
		Set("updated_by_user_id = EXCLUDED.updated_by_user_id").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return Policy{}, err
	}
	if err := s.Audit(ctx, AuditInput{
		OrganizationID: input.OrganizationID,
		ActorUserID:    actorUserID,
		Action:         "policy.updated",
		Detail:         input.Mode,
	}); err != nil {
		return Policy{}, err
	}
	return input, nil
}

func NormalizePolicyInput(input Policy) (Policy, error) {
	input.ProviderIDs = uniqueStrings(input.ProviderIDs)
	if err := ValidatePolicy(input); err != nil {
		return Policy{}, err
	}
	return input, nil
}

func (s *Service) ListDomains(ctx context.Context, organizationID string) ([]models.IdentityProviderDomain, error) {
	var domains []models.IdentityProviderDomain
	err := s.db.NewSelect().
		Model(&domains).
		Where("organization_id = ?", organizationID).
		Order("domain ASC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return []models.IdentityProviderDomain{}, nil
	}
	return domains, err
}

func (s *Service) CreateDomain(
	ctx context.Context,
	organizationID,
	providerID,
	domain,
	actorUserID string,
) (*DomainCreateResult, error) {
	if err := RequireOrganizationAdmin(ctx, s.db, organizationID, actorUserID); err != nil {
		return nil, err
	}
	domain = normalizeDomain(domain)
	if domain == "" {
		return nil, errors.New("a registrable domain is required")
	}
	count, err := s.db.NewSelect().Model((*models.IdentityProvider)(nil)).
		Where("id = ? AND organization_id = ?", providerID, organizationID).
		Count(ctx)
	if err != nil || count != 1 {
		return nil, ErrProviderNotFound
	}
	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	row := &models.IdentityProviderDomain{
		ID:               uuid.NewString(),
		ProviderID:       providerID,
		OrganizationID:   organizationID,
		Domain:           domain,
		VerificationHash: hashSecret(token),
		CreatedByUserID:  actorUserID,
		CreatedAt:        s.now(),
	}
	if _, err := s.db.NewInsert().Model(row).Exec(ctx); err != nil {
		return nil, err
	}
	return &DomainCreateResult{
		Domain:            *row,
		VerificationToken: token,
		DNSName:           "_openpost-sso." + domain,
		DNSValue:          "openpost-verification=" + token,
	}, nil
}

func (s *Service) VerifyDomain(ctx context.Context, organizationID, domainID, actorUserID string) error {
	if err := RequireOrganizationAdmin(ctx, s.db, organizationID, actorUserID); err != nil {
		return err
	}
	var domain models.IdentityProviderDomain
	if err := s.db.NewSelect().Model(&domain).
		Where("id = ? AND organization_id = ?", domainID, organizationID).
		Scan(ctx); err != nil {
		return ErrDomainVerification
	}
	records, err := net.DefaultResolver.LookupTXT(ctx, "_openpost-sso."+domain.Domain)
	if err != nil {
		return ErrDomainVerification
	}
	matched := false
	for _, record := range records {
		const prefix = "openpost-verification="
		if strings.HasPrefix(strings.TrimSpace(record), prefix) &&
			hashSecret(strings.TrimPrefix(strings.TrimSpace(record), prefix)) == domain.VerificationHash {
			matched = true
			break
		}
	}
	if !matched {
		return ErrDomainVerification
	}
	_, err = s.db.NewUpdate().Model((*models.IdentityProviderDomain)(nil)).
		Set("verified_at = ?", s.now()).
		Where("id = ?", domain.ID).
		Exec(ctx)
	if err != nil {
		return err
	}
	return s.Audit(ctx, AuditInput{
		OrganizationID: organizationID,
		ProviderID:     domain.ProviderID,
		ActorUserID:    actorUserID,
		Action:         "domain.verified",
		Detail:         domain.Domain,
	})
}

func (s *Service) DiscoverProvider(ctx context.Context, email string) (*models.IdentityProvider, error) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(email)), "@")
	if len(parts) != 2 {
		return nil, ErrProviderNotFound
	}
	domain := normalizeDomain(parts[1])
	var provider models.IdentityProvider
	err := s.db.NewSelect().
		Model(&provider).
		Join("JOIN identity_provider_domains AS d ON d.provider_id = identity_provider.id").
		Where("d.domain = ? AND d.verified_at IS NOT NULL", domain).
		Where("identity_provider.is_active = ?", true).
		Order("identity_provider.name ASC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrProviderNotFound
	}
	if err != nil {
		return nil, err
	}
	return &provider, nil
}

func (s *Service) ManagedUserState(ctx context.Context, userID string) (bool, string, error) {
	var rows []struct {
		Name string `bun:"name"`
	}
	err := s.db.NewSelect().
		TableExpr("organizations AS o").
		ColumnExpr("o.name").
		Join("JOIN organization_members AS om ON om.organization_id = o.id").
		Join("JOIN identity_providers AS ip ON ip.organization_id = o.id").
		Join("JOIN user_identities AS ui ON ui.provider_id = ip.id AND ui.user_id = om.user_id").
		Where("om.user_id = ?", userID).
		Order("o.name ASC").
		Scan(ctx, &rows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, "", err
	}
	if len(rows) == 0 {
		return false, "", nil
	}
	return true, rows[0].Name, nil
}

func (s *Service) Audit(ctx context.Context, input AuditInput) error {
	return insertAudit(ctx, s.db, input, s.now())
}

type auditInserter interface {
	NewInsert() *bun.InsertQuery
}

func insertAudit(ctx context.Context, db auditInserter, input AuditInput, now time.Time) error {
	row := &models.IdentityAuditEvent{
		ID:             uuid.NewString(),
		OrganizationID: strings.TrimSpace(input.OrganizationID),
		ProviderID:     strings.TrimSpace(input.ProviderID),
		ActorUserID:    strings.TrimSpace(input.ActorUserID),
		SubjectUserID:  strings.TrimSpace(input.SubjectUserID),
		Action:         strings.TrimSpace(input.Action),
		Detail:         safeAuditDetail(input.Detail),
		CreatedAt:      now,
	}
	_, err := db.NewInsert().Model(row).Exec(ctx)
	return err
}

func (s *Service) ListAudit(ctx context.Context, organizationID string, limit int) ([]models.IdentityAuditEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var events []models.IdentityAuditEvent
	err := s.db.NewSelect().Model(&events).
		Where("organization_id = ?", organizationID).
		Order("created_at DESC").
		Limit(limit).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return []models.IdentityAuditEvent{}, nil
	}
	return events, err
}

func RequireOrganizationAdmin(ctx context.Context, db *bun.DB, organizationID, userID string) error {
	var member models.OrganizationMember
	if err := db.NewSelect().Model(&member).
		Where("organization_id = ? AND user_id = ?", organizationID, userID).
		Scan(ctx); err != nil {
		return ErrOrganizationPermission
	}
	if member.Role != models.OrganizationRoleOwner && member.Role != models.OrganizationRoleAdmin {
		return ErrOrganizationPermission
	}
	return nil
}

func (s *Service) ApplyBreakGlassEmails(ctx context.Context, emails []string) (int64, error) {
	normalized := make([]string, 0, len(emails))
	for _, email := range emails {
		email = strings.ToLower(strings.TrimSpace(email))
		if email != "" && !slicesContains(normalized, email) {
			normalized = append(normalized, email)
		}
	}
	var configured int64
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().
			Model((*models.User)(nil)).
			Set("is_break_glass = ?", false).
			Where("is_break_glass = ?", true).
			Exec(txCtx); err != nil {
			return err
		}
		if len(normalized) == 0 {
			return nil
		}
		result, err := tx.NewUpdate().
			Model((*models.User)(nil)).
			Set("is_break_glass = ?", true).
			Where("LOWER(email) IN (?)", bun.List(normalized)).
			Where("is_admin = ?", true).
			Where("password_hash IS NOT NULL AND password_hash != ''").
			Where("(totp_enabled_at IS NOT NULL OR passkey_enabled_at IS NOT NULL)").
			Exec(txCtx)
		if err != nil {
			return err
		}
		configured, err = result.RowsAffected()
		return err
	})
	return configured, err
}

func defaultClaim(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func normalizeDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(value, ".")))
	if value == "" || strings.ContainsAny(value, "/:@") || !strings.Contains(value, ".") {
		return ""
	}
	return value
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !slicesContains(result, value) {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}

func safeAuditDetail(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 240 {
		return value[:240]
	}
	return value
}
