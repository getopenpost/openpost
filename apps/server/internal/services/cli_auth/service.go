package cli_auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	DefaultLifetime = 10 * time.Minute
	DefaultInterval = 5
	DefaultScope    = apitokens.DefaultScope
	ClientID        = "openpost-cli"

	statusPending  = "pending"
	statusApproved = "approved"
	statusDenied   = "denied"
	statusExpired  = "expired"

	userCodeAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
)

var (
	ErrNotFound             = errors.New("cli auth session not found")
	ErrExpired              = errors.New("cli auth session expired")
	ErrDenied               = errors.New("cli auth session denied")
	ErrAuthorizationPending = errors.New("cli auth authorization pending")
	ErrSlowDown             = errors.New("cli auth polling too quickly")
	ErrAlreadyUsed          = errors.New("cli auth session already used")
	ErrWorkspaceAccess      = errors.New("cli auth workspace is not accessible")
	ErrScopeMismatch        = errors.New("cli auth approval scope does not match the requested scope")
)

type Service struct {
	db     *bun.DB
	tokens *apitokens.Service
	now    func() time.Time
}

type StartInput struct {
	ClientName      string
	ClientVersion   string
	ClientOS        string
	RequestedScopes string
}

type StartedSession struct {
	Model      *models.CLIAuthSession
	DeviceCode string
	UserCode   string
	ExpiresIn  int
}

type PollResult struct {
	Status      string
	Token       string
	ExpiresIn   int
	Interval    int
	RetryAfter  int
	TokenPrefix string
}

type ApprovalOptions struct {
	WorkspaceID        string
	OrganizationID     string
	IdentityProviderID string
	AssuredAt          time.Time
	TokenExpiresAt     time.Time
}

func NewService(db *bun.DB, tokens *apitokens.Service) *Service {
	return &Service{
		db:     db,
		tokens: tokens,
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (s *Service) StartSession(ctx context.Context, input StartInput) (*StartedSession, error) {
	now := s.now()
	if err := s.cleanupExpired(ctx, now); err != nil {
		return nil, err
	}

	clientName := strings.TrimSpace(input.ClientName)
	if clientName == "" {
		clientName = "OpenPost CLI"
	}
	clientName, err := apitokens.NormalizeName(clientName)
	if err != nil {
		return nil, err
	}
	scopes := strings.TrimSpace(input.RequestedScopes)
	scopes, err = apitokens.NormalizeScope(scopes)
	if err != nil || scopes != DefaultScope {
		return nil, apitokens.ErrInvalidScope
	}

	deviceCode, err := generateDeviceCode()
	if err != nil {
		return nil, err
	}

	expiresAt := now.Add(DefaultLifetime)
	for range 8 {
		userCode, err := generateUserCode()
		if err != nil {
			return nil, err
		}

		session := &models.CLIAuthSession{
			ID:              uuid.NewString(),
			DeviceCodeHash:  hashCode(deviceCode),
			UserCodeHash:    hashCode(userCode),
			ClientName:      clientName,
			ClientVersion:   strings.TrimSpace(input.ClientVersion),
			ClientOS:        strings.TrimSpace(input.ClientOS),
			RequestedScopes: scopes,
			Status:          statusPending,
			IntervalSeconds: DefaultInterval,
			ExpiresAt:       expiresAt,
			CreatedAt:       now,
		}

		if _, err := s.db.NewInsert().Model(session).Exec(ctx); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				continue
			}
			return nil, err
		}

		return &StartedSession{
			Model:      session,
			DeviceCode: deviceCode,
			UserCode:   userCode,
			ExpiresIn:  int(time.Until(expiresAt).Seconds()),
		}, nil
	}

	return nil, errors.New("failed to allocate cli auth user code")
}

func (s *Service) PollSession(ctx context.Context, deviceCode string) (*PollResult, error) {
	session, err := s.sessionByDeviceCode(ctx, deviceCode)
	if err != nil {
		return nil, err
	}

	now := s.now()
	if err := s.expireIfNeeded(ctx, session, now); err != nil {
		return pollResult(session, now), err
	}
	if !session.LastPolledAt.IsZero() && now.Sub(session.LastPolledAt) < time.Second {
		return pollResult(session, now), ErrSlowDown
	}

	if _, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("last_polled_at = ?", now).
		Where("id = ?", session.ID).
		Exec(ctx); err != nil {
		return nil, err
	}
	session.LastPolledAt = now

	switch session.Status {
	case statusPending:
		return pollResult(session, now), ErrAuthorizationPending
	case statusDenied:
		return pollResult(session, now), ErrDenied
	case statusExpired:
		return pollResult(session, now), ErrExpired
	case statusApproved:
		return s.consumeApprovedSession(ctx, session, now)
	default:
		return nil, ErrNotFound
	}
}

func (s *Service) ApproveSessionWithOptions(
	ctx context.Context,
	actor workspaceaccess.ActorFacts,
	code,
	scopes,
	tokenName string,
	options ApprovalOptions,
) error {
	userID := strings.TrimSpace(actor.UserID)
	session, err := s.sessionByCode(ctx, code)
	if err != nil {
		return err
	}
	now := s.now()
	if err := s.expireIfNeeded(ctx, session, now); err != nil {
		return err
	}
	if session.Status != statusPending {
		return ErrAlreadyUsed
	}
	approvedScope, err := normalizeApprovalScope(session.RequestedScopes, scopes)
	if err != nil {
		return err
	}
	tokenName, err = normalizeApprovalTokenName(session.ClientName, tokenName)
	if err != nil {
		return err
	}
	workspaceID, err := s.approvalWorkspace(ctx, actor, options.WorkspaceID)
	if err != nil {
		return err
	}
	return s.approveSession(ctx, session.ID, userID, approvedScope, tokenName, workspaceID, options, now)
}

func normalizeApprovalScope(requestedScope, approvalScope string) (string, error) {
	requestedScope, err := apitokens.NormalizeScope(requestedScope)
	if err != nil {
		return "", err
	}
	approvalScope = strings.TrimSpace(approvalScope)
	if approvalScope == "" {
		return requestedScope, nil
	}
	approvalScope, err = apitokens.NormalizeScope(approvalScope)
	if err != nil {
		return "", err
	}
	if approvalScope != requestedScope {
		return "", ErrScopeMismatch
	}
	return requestedScope, nil
}

func normalizeApprovalTokenName(clientName, tokenName string) (string, error) {
	if strings.TrimSpace(tokenName) == "" {
		tokenName = clientName
	}
	return apitokens.NormalizeName(tokenName)
}

func (s *Service) approvalWorkspace(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", nil
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead)
	if err != nil {
		return "", err
	}
	if !decision.Allowed {
		return "", ErrWorkspaceAccess
	}
	return workspaceID, nil
}

func (s *Service) approveSession(
	ctx context.Context,
	sessionID,
	userID,
	scopes,
	tokenName,
	workspaceID string,
	options ApprovalOptions,
	now time.Time,
) error {
	result, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("user_id = ?", userID).
		Set("requested_scopes = ?", scopes).
		Set("client_name = ?", tokenName).
		Set("workspace_id = ?", workspaceID).
		Set("organization_id = ?", strings.TrimSpace(options.OrganizationID)).
		Set("identity_provider_id = ?", strings.TrimSpace(options.IdentityProviderID)).
		Set("assured_at = ?", nullTime(options.AssuredAt)).
		Set("token_expires_at = ?", nullTime(options.TokenExpiresAt)).
		Set("status = ?", statusApproved).
		Set("approved_at = ?", now).
		Where("id = ? AND status = ?", sessionID, statusPending).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrAlreadyUsed
	}
	return nil
}

func (s *Service) DenySession(ctx context.Context, code string) error {
	session, err := s.sessionByCode(ctx, code)
	if err != nil {
		return err
	}
	now := s.now()
	if err := s.expireIfNeeded(ctx, session, now); err != nil {
		return err
	}
	if session.Status != statusPending {
		if session.Status == statusDenied {
			return nil
		}
		return ErrAlreadyUsed
	}

	result, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("status = ?", statusDenied).
		Set("denied_at = ?", now).
		Where("id = ? AND status = ?", session.ID, statusPending).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 1 {
		return nil
	}
	status, err := s.sessionStatus(ctx, session.ID)
	if err != nil {
		return err
	}
	if status == statusDenied {
		return nil
	}
	return ErrAlreadyUsed
}

func (s *Service) cleanupExpired(ctx context.Context, now time.Time) error {
	_, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("status = ?", statusExpired).
		Where("status = ? AND expires_at <= ?", statusPending, now).
		Exec(ctx)
	return err
}

func (s *Service) GetPendingByUserCode(ctx context.Context, userCode string) (*models.CLIAuthSession, error) {
	session, err := s.sessionByUserCode(ctx, userCode)
	if err != nil {
		return nil, err
	}
	if err := s.expireIfNeeded(ctx, session, s.now()); err != nil {
		return nil, err
	}
	return session, nil
}

type approvedSessionConsumption struct {
	session     models.CLIAuthSession
	generated   *apitokens.GeneratedToken
	terminalErr error
}

func (s *Service) consumeApprovedSession(ctx context.Context, session *models.CLIAuthSession, now time.Time) (*PollResult, error) {
	consumption := &approvedSessionConsumption{}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return s.consumeApprovedSessionInTx(txCtx, tx, session.ID, now, consumption)
	})
	if err != nil {
		return nil, err
	}
	if consumption.terminalErr != nil {
		return nil, consumption.terminalErr
	}
	if consumption.generated == nil {
		return nil, ErrAlreadyUsed
	}

	result := pollResult(&consumption.session, now)
	result.Status = statusApproved
	result.Token = consumption.generated.Token
	result.TokenPrefix = consumption.generated.Model.TokenPrefix
	return result, nil
}

func (s *Service) consumeApprovedSessionInTx(
	ctx context.Context,
	tx bun.Tx,
	sessionID string,
	now time.Time,
	consumption *approvedSessionConsumption,
) error {
	if err := lockApprovedSession(ctx, tx, sessionID); err != nil {
		return err
	}
	if err := tx.NewSelect().Model(&consumption.session).Where("id = ?", sessionID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	terminalErr, err := approvedSessionTerminalError(ctx, tx, &consumption.session, now)
	if err != nil {
		return err
	}
	if terminalErr != nil {
		consumption.terminalErr = terminalErr
		return expireApprovedSession(ctx, tx, consumption.session.ID)
	}
	consumption.generated, err = s.generateApprovedSessionToken(ctx, tx, &consumption.session, now)
	if err != nil {
		return err
	}
	return expireApprovedSession(ctx, tx, consumption.session.ID)
}

func lockApprovedSession(ctx context.Context, tx bun.Tx, sessionID string) error {
	// The conditional no-op update acquires a row lock and rejects every poll
	// after the first consumer has committed the terminal transition.
	result, err := tx.NewUpdate().Model((*models.CLIAuthSession)(nil)).
		Set("status = status").
		Where("id = ? AND status = ?", sessionID, statusApproved).
		Exec(ctx)
	if err != nil {
		return err
	}
	locked, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if locked != 1 {
		return ErrAlreadyUsed
	}
	return nil
}

func approvedSessionTerminalError(
	ctx context.Context,
	tx bun.Tx,
	session *models.CLIAuthSession,
	now time.Time,
) (error, error) {
	if strings.TrimSpace(session.UserID) == "" {
		return ErrNotFound, nil
	}
	if !session.ExpiresAt.After(now) ||
		(!session.TokenExpiresAt.IsZero() && !session.TokenExpiresAt.After(now)) {
		return ErrExpired, nil
	}
	if session.WorkspaceID == "" {
		return nil, nil
	}
	decision, err := workspaceaccess.NewAuthorizer(tx).AuthorizeStored(ctx, workspaceaccess.StoredAuthority{
		UserID:             session.UserID,
		WorkspaceID:        session.WorkspaceID,
		OrganizationID:     session.OrganizationID,
		IdentityProviderID: session.IdentityProviderID,
		AssuredAt:          session.AssuredAt,
	}, workspaceaccess.LevelRead)
	if err != nil {
		return nil, err
	}
	if !decision.Allowed {
		return ErrWorkspaceAccess, nil
	}
	return nil, nil
}

func (s *Service) generateApprovedSessionToken(
	ctx context.Context,
	tx bun.Tx,
	session *models.CLIAuthSession,
	now time.Time,
) (*apitokens.GeneratedToken, error) {
	expiresAt := session.TokenExpiresAt
	if expiresAt.IsZero() {
		expiresAt = now.Add(apitokens.DefaultExpiration)
	}
	return s.tokens.GenerateTokenWithOptionsInTx(
		ctx,
		tx,
		session.UserID,
		session.ClientName,
		session.RequestedScopes,
		apitokens.GenerateOptions{
			ExpiresAt:          &expiresAt,
			WorkspaceID:        session.WorkspaceID,
			OrganizationID:     session.OrganizationID,
			IdentityProviderID: session.IdentityProviderID,
			AssuredAt:          session.AssuredAt,
			ClientID:           ClientID,
		},
	)
}

func expireApprovedSession(ctx context.Context, tx bun.Tx, sessionID string) error {
	result, err := tx.NewUpdate().Model((*models.CLIAuthSession)(nil)).
		Set("status = ?", statusExpired).
		Where("id = ? AND status = ?", sessionID, statusApproved).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrAlreadyUsed
	}
	return nil
}

func nullTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.UTC()
}

func (s *Service) expireIfNeeded(ctx context.Context, session *models.CLIAuthSession, now time.Time) error {
	if session.Status == statusPending && !session.ExpiresAt.After(now) {
		result, err := s.db.NewUpdate().
			Model((*models.CLIAuthSession)(nil)).
			Set("status = ?", statusExpired).
			Where("id = ? AND status = ?", session.ID, statusPending).
			Exec(ctx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 1 {
			session.Status = statusExpired
			return ErrExpired
		}
		status, err := s.sessionStatus(ctx, session.ID)
		if err != nil {
			return err
		}
		session.Status = status
		if status == statusExpired {
			return ErrExpired
		}
		return ErrAlreadyUsed
	}
	return nil
}

func (s *Service) sessionStatus(ctx context.Context, sessionID string) (string, error) {
	var status string
	if err := s.db.NewSelect().Model((*models.CLIAuthSession)(nil)).
		Column("status").
		Where("id = ?", strings.TrimSpace(sessionID)).
		Scan(ctx, &status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return status, nil
}

func (s *Service) sessionByDeviceCode(ctx context.Context, deviceCode string) (*models.CLIAuthSession, error) {
	var session models.CLIAuthSession
	if err := s.db.NewSelect().
		Model(&session).
		Where("device_code_hash = ?", hashCode(deviceCode)).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (s *Service) sessionByUserCode(ctx context.Context, userCode string) (*models.CLIAuthSession, error) {
	var session models.CLIAuthSession
	if err := s.db.NewSelect().
		Model(&session).
		Where("user_code_hash = ?", hashCode(normalizeUserCode(userCode))).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (s *Service) sessionByCode(ctx context.Context, code string) (*models.CLIAuthSession, error) {
	if strings.Contains(code, "-") {
		return s.sessionByUserCode(ctx, code)
	}
	return s.sessionByDeviceCode(ctx, code)
}

func pollResult(session *models.CLIAuthSession, now time.Time) *PollResult {
	expiresIn := int(session.ExpiresAt.Sub(now).Seconds())
	if expiresIn < 0 {
		expiresIn = 0
	}
	retryAfter := session.IntervalSeconds
	if !session.LastPolledAt.IsZero() {
		remaining := time.Second - now.Sub(session.LastPolledAt)
		if remaining > 0 {
			retryAfter = int(remaining.Round(time.Second).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
		}
	}
	return &PollResult{
		Status:     session.Status,
		ExpiresIn:  expiresIn,
		Interval:   session.IntervalSeconds,
		RetryAfter: retryAfter,
	}
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

func normalizeUserCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) == 8 && !strings.Contains(code, "-") {
		return code[:4] + "-" + code[4:]
	}
	return code
}

func generateDeviceCode() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func generateUserCode() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	var b strings.Builder
	for i, raw := range buf {
		if i == 4 {
			b.WriteByte('-')
		}
		b.WriteByte(userCodeAlphabet[int(raw)%len(userCodeAlphabet)])
	}
	return b.String(), nil
}
