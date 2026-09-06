package identity

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/openpost/backend/internal/models"
)

func (s *Service) ProcessBackchannelLogout(ctx context.Context, providerID, rawLogoutToken string) (int64, error) {
	provider, err := s.GetProvider(ctx, providerID)
	if err != nil {
		return 0, ErrBackchannelLogout
	}
	runtime, err := s.runtime(ctx, *provider)
	if err != nil {
		return 0, ErrBackchannelLogout
	}
	rawLogoutToken = strings.TrimSpace(rawLogoutToken)
	if rawLogoutToken == "" {
		return 0, ErrBackchannelLogout
	}
	verifyCtx := oidc.ClientContext(ctx, runtime.HTTPClient)
	logoutToken, err := runtime.Verifier.VerifyLogout(verifyCtx, rawLogoutToken)
	if err != nil || strings.TrimSpace(logoutToken.TokenID) == "" {
		return 0, ErrBackchannelLogout
	}

	event := &models.OIDCLogoutEvent{
		ProviderID: provider.ID,
		TokenHash:  hashSecret(logoutToken.TokenID),
		ExpiresAt:  logoutToken.Expiry.UTC(),
		CreatedAt:  s.now(),
	}
	if _, err := s.db.NewInsert().Model(event).Exec(ctx); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			// Provider retries are idempotent. The original verified request
			// already revoked the matching OpenPost sessions.
			return 0, nil
		}
		return 0, err
	}

	query := s.db.NewUpdate().
		Model((*models.UserSession)(nil)).
		Set("revoked_at = ?", s.now()).
		Where("revoked_at IS NULL")
	switch {
	case strings.TrimSpace(logoutToken.SessionID) != "":
		query = query.Where("id IN (?)", s.db.NewSelect().
			Model((*models.SessionIdentityAssurance)(nil)).
			Column("session_id").
			Where("provider_id = ? AND upstream_sid = ?", provider.ID, logoutToken.SessionID))
	case strings.TrimSpace(logoutToken.Subject) != "":
		var identity models.UserIdentity
		if err := s.db.NewSelect().Model(&identity).
			Where("provider_id = ? AND subject = ?", provider.ID, logoutToken.Subject).
			Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, nil
			}
			return 0, err
		}
		query = query.Where("id IN (?)", s.db.NewSelect().
			Model((*models.SessionIdentityAssurance)(nil)).
			Column("session_id").
			Where("provider_id = ? AND user_id = ?", provider.ID, identity.UserID))
	default:
		return 0, ErrBackchannelLogout
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return 0, err
	}
	revoked, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	_ = s.Audit(ctx, AuditInput{
		OrganizationID: provider.OrganizationID,
		ProviderID:     provider.ID,
		Action:         "session.backchannel_logout",
	})
	_, _ = s.db.NewDelete().
		Model((*models.OIDCLogoutEvent)(nil)).
		Where("expires_at < ?", s.now()).
		Exec(ctx)
	return revoked, nil
}
