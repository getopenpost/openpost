package identity

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
)

type AssuranceInput struct {
	SessionID   string
	ProviderID  string
	UserID      string
	AuthTime    time.Time
	ACR         string
	AMR         []string
	UpstreamSID string
}

func (s *Service) RecordAssurance(ctx context.Context, input AssuranceInput) error {
	if strings.TrimSpace(input.SessionID) == "" || strings.TrimSpace(input.ProviderID) == "" ||
		strings.TrimSpace(input.UserID) == "" {
		return ErrInvalidAuthRequest
	}
	authTime := input.AuthTime.UTC()
	if authTime.IsZero() {
		authTime = s.now()
	}
	age, err := s.assuranceAge(ctx, input.ProviderID)
	if err != nil {
		return err
	}
	provider, err := s.GetProvider(ctx, input.ProviderID)
	if err != nil {
		return err
	}
	amr, err := json.Marshal(input.AMR)
	if err != nil {
		return err
	}
	row := &models.SessionIdentityAssurance{
		SessionID:   input.SessionID,
		ProviderID:  input.ProviderID,
		UserID:      input.UserID,
		AuthTime:    authTime,
		ExpiresAt:   authTime.Add(age),
		ACR:         strings.TrimSpace(input.ACR),
		AMR:         string(amr),
		UpstreamSID: strings.TrimSpace(input.UpstreamSID),
		CreatedAt:   s.now(),
	}
	_, err = s.db.NewInsert().
		Model(row).
		On("CONFLICT (session_id, provider_id) DO UPDATE").
		Set("user_id = EXCLUDED.user_id").
		Set("auth_time = EXCLUDED.auth_time").
		Set("expires_at = EXCLUDED.expires_at").
		Set("acr = EXCLUDED.acr").
		Set("amr = EXCLUDED.amr").
		Set("upstream_sid = EXCLUDED.upstream_sid").
		Set("created_at = EXCLUDED.created_at").
		Exec(ctx)
	if err != nil {
		return err
	}
	return s.Audit(ctx, AuditInput{
		OrganizationID: provider.OrganizationID,
		ProviderID:     input.ProviderID,
		ActorUserID:    input.UserID,
		SubjectUserID:  input.UserID,
		Action:         "session.oidc_assured",
	})
}

func (s *Service) assuranceAge(ctx context.Context, providerID string) (time.Duration, error) {
	var policies []models.OrganizationSSOPolicy
	if err := s.db.NewSelect().Model(&policies).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	age := s.config.DefaultAssuranceAge
	for _, policy := range policies {
		providers, err := ParseProviderIDs(policy.ProviderIDs)
		if err != nil {
			return 0, err
		}
		if !slicesContains(providers, providerID) || policy.AssuranceMaxAgeSeconds <= 0 {
			continue
		}
		candidate := time.Duration(policy.AssuranceMaxAgeSeconds) * time.Second
		if candidate < age {
			age = candidate
		}
	}
	return age, nil
}

func (s *Service) CreateReauthGrant(
	ctx context.Context,
	userID,
	sessionID,
	action,
	method,
	providerID string,
) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" ||
		strings.TrimSpace(action) == "" || strings.TrimSpace(method) == "" {
		return "", ErrInvalidReauthGrant
	}
	raw, err := randomToken(32)
	if err != nil {
		return "", err
	}
	now := s.now()
	row := &models.ReauthGrant{
		ID:         uuid.NewString(),
		TokenHash:  hashSecret(raw),
		UserID:     strings.TrimSpace(userID),
		SessionID:  strings.TrimSpace(sessionID),
		Action:     strings.TrimSpace(action),
		Method:     strings.TrimSpace(method),
		ProviderID: strings.TrimSpace(providerID),
		ExpiresAt:  now.Add(ReauthGrantTTL),
		CreatedAt:  now,
	}
	if _, err := s.db.NewInsert().Model(row).Exec(ctx); err != nil {
		return "", err
	}
	_, _ = s.db.NewDelete().
		Model((*models.ReauthGrant)(nil)).
		Where("expires_at < ?", now).
		Exec(ctx)
	organizationID := ""
	if row.ProviderID != "" {
		provider, err := s.GetProvider(ctx, row.ProviderID)
		if err != nil {
			return "", err
		}
		organizationID = provider.OrganizationID
	}
	if err := s.Audit(ctx, AuditInput{
		OrganizationID: organizationID,
		ProviderID:     row.ProviderID,
		ActorUserID:    row.UserID,
		SubjectUserID:  row.UserID,
		Action:         "reauth.completed",
		Detail:         row.Method + ":" + row.Action,
	}); err != nil {
		return "", err
	}
	return raw, nil
}

func (s *Service) ConsumeReauthGrant(ctx context.Context, raw, userID, sessionID, action string) error {
	if strings.TrimSpace(raw) == "" || strings.TrimSpace(userID) == "" ||
		strings.TrimSpace(sessionID) == "" || strings.TrimSpace(action) == "" {
		return ErrInvalidReauthGrant
	}
	var grant models.ReauthGrant
	if err := s.db.NewSelect().
		Model(&grant).
		Where("token_hash = ?", hashSecret(raw)).
		Scan(ctx); err != nil {
		return ErrInvalidReauthGrant
	}
	now := s.now()
	if grant.UserID != userID || grant.SessionID != sessionID || grant.Action != action ||
		!grant.ExpiresAt.After(now) || !grant.ConsumedAt.IsZero() {
		return ErrInvalidReauthGrant
	}
	if subtle.ConstantTimeCompare([]byte(grant.TokenHash), []byte(hashSecret(raw))) != 1 {
		return ErrInvalidReauthGrant
	}
	result, err := s.db.NewUpdate().
		Model((*models.ReauthGrant)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND consumed_at IS NULL AND expires_at > ?", grant.ID, now).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return ErrInvalidReauthGrant
	}
	return nil
}

func (s *Service) createNativeHandoff(
	ctx context.Context,
	userID,
	sessionID,
	purpose,
	action,
	payload string,
) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" ||
		strings.TrimSpace(purpose) == "" || strings.TrimSpace(payload) == "" {
		return "", ErrNativeHandoff
	}
	raw, err := randomToken(32)
	if err != nil {
		return "", err
	}
	encrypted, err := s.encryptor.Encrypt(payload)
	if err != nil {
		return "", err
	}
	now := s.now()
	row := &models.OIDCNativeHandoff{
		ID:             uuid.NewString(),
		CodeHash:       hashSecret(raw),
		UserID:         userID,
		SessionID:      sessionID,
		Purpose:        purpose,
		Action:         strings.TrimSpace(action),
		TokenEncrypted: encrypted,
		ExpiresAt:      now.Add(NativeHandoffTTL),
		CreatedAt:      now,
	}
	if _, err := s.db.NewInsert().Model(row).Exec(ctx); err != nil {
		return "", err
	}
	_, _ = s.db.NewDelete().
		Model((*models.OIDCNativeHandoff)(nil)).
		Where("expires_at < ?", now).
		Exec(ctx)
	return raw, nil
}

func (s *Service) CreateNativeLoginHandoff(ctx context.Context, userID, sessionID, token string) (string, error) {
	return s.createNativeHandoff(ctx, userID, sessionID, "login", "", token)
}

func (s *Service) CreateNativeReauthHandoff(
	ctx context.Context,
	userID,
	sessionID,
	action,
	grant string,
) (string, error) {
	return s.createNativeHandoff(ctx, userID, sessionID, "reauth", action, grant)
}

func (s *Service) CreateNativeLinkHandoff(ctx context.Context, userID, sessionID string) (string, error) {
	return s.createNativeHandoff(ctx, userID, sessionID, "link", "", "linked")
}

type NativeHandoffResult struct {
	UserID    string
	SessionID string
	Purpose   string
	Action    string
	Payload   string
}

func (s *Service) ConsumeNativeHandoff(ctx context.Context, raw string) (*NativeHandoffResult, error) {
	var handoff models.OIDCNativeHandoff
	if err := s.db.NewSelect().
		Model(&handoff).
		Where("code_hash = ?", hashSecret(raw)).
		Scan(ctx); err != nil {
		return nil, ErrNativeHandoff
	}
	now := s.now()
	if !handoff.ExpiresAt.After(now) || !handoff.ConsumedAt.IsZero() {
		return nil, ErrNativeHandoff
	}
	result, err := s.db.NewUpdate().
		Model((*models.OIDCNativeHandoff)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND consumed_at IS NULL AND expires_at > ?", handoff.ID, now).
		Exec(ctx)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return nil, ErrNativeHandoff
	}
	payload, err := s.encryptor.Decrypt(handoff.TokenEncrypted)
	if err != nil {
		return nil, fmt.Errorf("%w: decrypt token", ErrNativeHandoff)
	}
	return &NativeHandoffResult{
		UserID:    handoff.UserID,
		SessionID: handoff.SessionID,
		Purpose:   handoff.Purpose,
		Action:    handoff.Action,
		Payload:   payload,
	}, nil
}

func (s *Service) RevokeProviderSessions(ctx context.Context, providerID string) (int64, error) {
	result, err := s.db.NewUpdate().
		Model((*models.UserSession)(nil)).
		Set("revoked_at = ?", s.now()).
		Where("revoked_at IS NULL").
		Where("id IN (?)", s.db.NewSelect().
			Model((*models.SessionIdentityAssurance)(nil)).
			Column("session_id").
			Where("provider_id = ?", providerID)).
		Exec(ctx)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Service) RPLogoutURL(ctx context.Context, providerID, returnPath string) (string, error) {
	provider, err := s.GetProvider(ctx, providerID)
	if err != nil {
		return "", err
	}
	runtime, err := s.runtime(ctx, *provider)
	if err != nil {
		return "", err
	}
	if runtime.EndSessionEndpoint == "" {
		return "", nil
	}
	parsed, err := url.Parse(runtime.EndSessionEndpoint)
	allowedScheme := parsed != nil && parsed.Scheme == "https"
	if provider.Source == "environment" {
		allowedScheme = parsed != nil && (parsed.Scheme == "https" || parsed.Scheme == "http")
	}
	if err != nil || !allowedScheme || parsed.Host == "" {
		return "", nil
	}
	query := parsed.Query()
	query.Set("client_id", provider.ClientID)
	query.Set("post_logout_redirect_uri", s.config.PublicURL+SafeReturnPath(returnPath))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
