package apitokens

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	TokenPrefix       = "op_cli"
	ScopeCLI          = "cli:full"
	ScopeMCPRead      = "mcp:read"
	ScopeMCP          = "mcp:full"
	ScopeAPIRead      = "api:read"
	ScopeAPIWrite     = "api:write"
	DefaultScope      = ScopeCLI
	DefaultExpiration = 90 * 24 * time.Hour
	MaximumExpiration = 365 * 24 * time.Hour
	MaximumNameLength = 120
	secretBytes       = 32
	hashHexLength     = 64
	prefixHexLength   = 8
)

var (
	ErrInvalidToken  = errors.New("invalid api token")
	ErrExpiredToken  = errors.New("expired api token")
	ErrInvalidScope  = errors.New("invalid api token scope")
	ErrInvalidName   = errors.New("invalid api token name")
	ErrInvalidExpiry = errors.New("invalid api token expiration")
	ErrRevokedToken  = errors.New("revoked api token")
)

type Service struct {
	db *bun.DB
}

type Principal struct {
	UserID      string
	Email       string
	Scope       string
	WorkspaceID string
	Audience    string
	ClientID    string
	TokenID     string
	TokenName   string
	TokenPrefix string
}

type GeneratedToken struct {
	Token string
	Model *models.APIToken
}

type GenerateOptions struct {
	ExpiresAt          *time.Time
	WorkspaceID        string
	OrganizationID     string
	IdentityProviderID string
	AssuredAt          time.Time
	Audience           string
	ClientID           string
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func (s *Service) GenerateToken(ctx context.Context, userID, name, scope string, expiresAt *time.Time) (*GeneratedToken, error) {
	return s.GenerateTokenWithOptions(ctx, userID, name, scope, GenerateOptions{ExpiresAt: expiresAt})
}

func (s *Service) GenerateTokenWithOptions(ctx context.Context, userID, name, scope string, options GenerateOptions) (*GeneratedToken, error) {
	return s.generateTokenWithOptions(ctx, s.db, userID, name, scope, options)
}

// GenerateTokenWithOptionsInTx inserts a token as part of the caller's
// transaction. This keeps one-time authorization grants and their resulting
// token secret on a single commit boundary.
func (s *Service) GenerateTokenWithOptionsInTx(
	ctx context.Context,
	tx bun.Tx,
	userID, name, scope string,
	options GenerateOptions,
) (*GeneratedToken, error) {
	return s.generateTokenWithOptions(ctx, tx, userID, name, scope, options)
}

func (s *Service) generateTokenWithOptions(
	ctx context.Context,
	db bun.IDB,
	userID, name, scope string,
	options GenerateOptions,
) (*GeneratedToken, error) {
	scope, err := NormalizeScope(scope)
	if err != nil {
		return nil, err
	}
	name, err = NormalizeName(name)
	if err != nil {
		return nil, ErrInvalidName
	}
	now := time.Now().UTC()

	secret, err := generateSecret()
	if err != nil {
		return nil, err
	}
	tokenPrefix, tokenHash := HashToken(secret)
	rawToken := strings.Join([]string{TokenPrefix, tokenPrefix, secret}, "_")

	var expiry time.Time
	if options.ExpiresAt != nil {
		expiry = options.ExpiresAt.UTC()
	} else {
		expiry = now.Add(DefaultExpiration)
	}
	if !expiry.After(now) || expiry.After(now.Add(MaximumExpiration)) {
		return nil, ErrInvalidExpiry
	}

	model := &models.APIToken{
		ID:                 uuid.NewString(),
		UserID:             userID,
		Name:               name,
		ClientID:           strings.TrimSpace(options.ClientID),
		TokenHash:          tokenHash,
		TokenPrefix:        tokenPrefix,
		Scope:              scope,
		WorkspaceID:        strings.TrimSpace(options.WorkspaceID),
		OrganizationID:     strings.TrimSpace(options.OrganizationID),
		IdentityProviderID: strings.TrimSpace(options.IdentityProviderID),
		AssuredAt:          options.AssuredAt.UTC(),
		Audience:           strings.TrimSpace(options.Audience),
		ExpiresAt:          expiry,
		CreatedAt:          now,
	}

	if _, err := db.NewInsert().Model(model).Exec(ctx); err != nil {
		return nil, err
	}

	return &GeneratedToken{Token: rawToken, Model: model}, nil
}

func NormalizeScope(scope string) (string, error) {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return DefaultScope, nil
	}
	switch scope {
	case ScopeCLI, ScopeMCPRead, ScopeMCP, ScopeAPIRead, ScopeAPIWrite:
		return scope, nil
	default:
		return "", ErrInvalidScope
	}
}

func NormalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > MaximumNameLength {
		return "", ErrInvalidName
	}
	return name, nil
}

func HashToken(secret string) (string, string) {
	sum := sha256.Sum256([]byte(secret))
	hash := hex.EncodeToString(sum[:])
	return hash[:prefixHexLength], hash
}

func (s *Service) ValidateToken(ctx context.Context, rawToken string) (*Principal, error) {
	prefix, secret, err := parseToken(rawToken)
	if err != nil {
		return nil, err
	}

	_, tokenHash := HashToken(secret)
	var candidates []models.APIToken
	if err := s.db.NewSelect().
		Model(&candidates).
		Where("token_prefix = ?", prefix).
		Scan(ctx); err != nil {
		return nil, ErrInvalidToken
	}

	for _, token := range candidates {
		if subtle.ConstantTimeCompare([]byte(token.TokenHash), []byte(tokenHash)) != 1 {
			continue
		}
		return s.validateMatchedToken(ctx, &token)
	}

	return nil, ErrInvalidToken
}

func (s *Service) ListTokens(ctx context.Context, userID string) ([]models.APIToken, error) {
	var tokens []models.APIToken
	err := s.db.NewSelect().
		Model(&tokens).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Scan(ctx)
	return tokens, err
}

func (s *Service) RevokeToken(ctx context.Context, userID, tokenID string) error {
	result, err := s.db.NewUpdate().
		Model((*models.APIToken)(nil)).
		Set("revoked_at = ?", time.Now().UTC()).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", tokenID, userID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Service) TouchLastUsedAt(ctx context.Context, tokenID string) error {
	now := time.Now().UTC()
	result, err := s.db.NewUpdate().
		Model((*models.APIToken)(nil)).
		Set("last_used_at = ?", now).
		Where("id = ? AND revoked_at IS NULL", tokenID).
		Where("expires_at IS NULL OR expires_at > ?", now).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrInvalidToken
	}
	return nil
}

func (s *Service) validateMatchedToken(ctx context.Context, token *models.APIToken) (*Principal, error) {
	now := time.Now().UTC()
	if !token.RevokedAt.IsZero() {
		return nil, ErrRevokedToken
	}
	if !token.ExpiresAt.IsZero() && !token.ExpiresAt.After(now) {
		return nil, ErrExpiredToken
	}

	var user models.User
	if err := s.db.NewSelect().
		Model(&user).
		Where("id = ?", token.UserID).
		Scan(ctx); err != nil {
		return nil, ErrInvalidToken
	}

	if err := s.TouchLastUsedAt(ctx, token.ID); err != nil {
		return nil, err
	}

	return &Principal{
		UserID:      user.ID,
		Email:       user.Email,
		Scope:       token.Scope,
		WorkspaceID: token.WorkspaceID,
		Audience:    token.Audience,
		ClientID:    token.ClientID,
		TokenID:     token.ID,
		TokenName:   token.Name,
		TokenPrefix: token.TokenPrefix,
	}, nil
}

func generateSecret() (string, error) {
	buf := make([]byte, secretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func parseToken(rawToken string) (string, string, error) {
	rest, ok := strings.CutPrefix(rawToken, TokenPrefix+"_")
	if !ok {
		return "", "", ErrInvalidToken
	}
	prefix, secret, ok := strings.Cut(rest, "_")
	if !ok {
		return "", "", ErrInvalidToken
	}
	if len(prefix) != prefixHexLength || len(secret) < 43 {
		return "", "", ErrInvalidToken
	}
	if _, err := hex.DecodeString(prefix); err != nil {
		return "", "", ErrInvalidToken
	}
	return prefix, secret, nil
}
