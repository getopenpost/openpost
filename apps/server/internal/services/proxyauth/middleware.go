package proxyauth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/credentialguard"
	"github.com/openpost/backend/internal/services/workspaceprovisioning"
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
)

const (
	UserHeader   = "X-OpenPost-Proxy-User"
	SecretHeader = "X-OpenPost-Proxy-Secret"

	defaultWorkspaceName = "My Workspace"
	proxyEmailDomain     = "proxy.invalid"
	maxIdentityLength    = 320
)

var proxyIdentityNamespace = uuid.NewSHA1(uuid.NameSpaceURL, []byte("https://openpo.st/proxy-auth"))

type Config struct {
	SharedSecret  string
	WorkspaceName string
}

type middleware struct {
	db          *bun.DB
	auth        *auth.Service
	config      Config
	provisionMu sync.Mutex
}

func NewMiddleware(db *bun.DB, authService *auth.Service, config Config) echo.MiddlewareFunc {
	instance := &middleware{
		db:     db,
		auth:   authService,
		config: config,
	}
	return instance.handle
}

func (m *middleware) handle(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		request := c.Request()
		proxyUser := strings.TrimSpace(request.Header.Get(UserHeader))
		proxySecret := request.Header.Get(SecretHeader)
		request.Header.Del(UserHeader)
		request.Header.Del(SecretHeader)

		if proxyUser == "" && proxySecret == "" {
			return next(c)
		}
		if m.config.SharedSecret == "" || proxyUser == "" || !sharedSecretMatches(proxySecret, m.config.SharedSecret) {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid proxy authentication"})
		}

		user, err := m.provision(c.Request().Context(), proxyUser)
		if err != nil {
			c.Logger().Errorf("proxy authentication failed: %v", err)
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "proxy authentication is temporarily unavailable"})
		}
		token, err := m.auth.GenerateToken(user.ID, user.Email)
		if err != nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "proxy authentication is temporarily unavailable"})
		}
		request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
		return next(c)
	}
}

func sharedSecretMatches(candidate, expected string) bool {
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(expected)) == 1
}

func (m *middleware) provision(ctx context.Context, rawIdentity string) (*models.User, error) {
	identity, err := normalizeIdentity(rawIdentity)
	if err != nil {
		return nil, err
	}
	if user, ready, err := m.findReadyUser(ctx, identity); err != nil || ready {
		return user, err
	}

	m.provisionMu.Lock()
	defer m.provisionMu.Unlock()

	var user *models.User
	err = m.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		user, err = m.ensureUser(txCtx, tx, identity)
		if err != nil {
			return err
		}
		return m.ensurePersonalWorkspace(txCtx, tx, user)
	})
	return user, err
}

func (m *middleware) findReadyUser(ctx context.Context, identity identity) (*models.User, bool, error) {
	userID := uuid.NewSHA1(proxyIdentityNamespace, []byte(identity.subject)).String()
	user := new(models.User)
	if err := m.db.NewSelect().Model(user).Where("id = ?", userID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	exists, err := m.db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("user_id = ? AND status = ?", user.ID, models.WorkspaceMemberStatusActive).
		Exists(ctx)
	return user, exists, err
}

type identity struct {
	subject     string
	email       string
	displayName string
}

func normalizeIdentity(raw string) (identity, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxIdentityLength {
		return identity{}, errors.New("proxy identity is invalid")
	}
	subject := strings.ToLower(raw)
	parsed, err := mail.ParseAddress(raw)
	if err == nil && strings.EqualFold(parsed.Address, raw) {
		displayName := strings.TrimSpace(parsed.Name)
		if displayName == "" {
			displayName = strings.SplitN(parsed.Address, "@", 2)[0]
		}
		return identity{subject: subject, email: strings.ToLower(parsed.Address), displayName: displayName}, nil
	}
	userID := uuid.NewSHA1(proxyIdentityNamespace, []byte(subject)).String()
	username := usernames.Suggest(raw, "")
	return identity{
		subject:     subject,
		email:       username + "-" + strings.ReplaceAll(userID[:8], "-", "") + "@" + proxyEmailDomain,
		displayName: raw,
	}, nil
}

func (m *middleware) ensureUser(ctx context.Context, tx bun.Tx, identity identity) (*models.User, error) {
	if err := credentialguard.LockFirstUserBootstrap(ctx, tx); err != nil {
		return nil, err
	}
	userID := uuid.NewSHA1(proxyIdentityNamespace, []byte(identity.subject)).String()
	user := new(models.User)
	err := tx.NewSelect().Model(user).Where("id = ?", userID).Scan(ctx)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	emailExists, err := tx.NewSelect().Model((*models.User)(nil)).Where("LOWER(email) = ?", identity.email).Exists(ctx)
	if err != nil {
		return nil, err
	}
	if emailExists {
		return nil, errors.New("proxy identity conflicts with an existing email")
	}
	username, err := availableUsername(ctx, tx, usernames.Suggest(identity.displayName, identity.email), userID)
	if err != nil {
		return nil, err
	}
	userCount, err := tx.NewSelect().Model((*models.User)(nil)).Count(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	user = &models.User{
		ID:              userID,
		Email:           identity.email,
		Username:        username,
		DisplayName:     identity.displayName,
		IsAdmin:         userCount == 0,
		EmailVerifiedAt: now,
		CreatedAt:       now,
	}
	if _, err := tx.NewInsert().Model(user).Exec(ctx); err != nil {
		return nil, err
	}
	return user, nil
}

func availableUsername(ctx context.Context, db bun.IDB, base, userID string) (string, error) {
	for attempt := 0; attempt < 100; attempt++ {
		candidate := usernames.Candidate(base, userID, attempt)
		exists, err := db.NewSelect().Model((*models.User)(nil)).Where("LOWER(username) = ?", candidate).Exists(ctx)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", errors.New("no proxy username is available")
}

func (m *middleware) ensurePersonalWorkspace(ctx context.Context, tx bun.Tx, user *models.User) error {
	exists, err := tx.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("user_id = ? AND status = ?", user.ID, models.WorkspaceMemberStatusActive).
		Exists(ctx)
	if err != nil || exists {
		return err
	}

	now := time.Now().UTC()
	organizationID := uuid.NewSHA1(proxyIdentityNamespace, []byte(user.ID+":organization")).String()
	workspaceID := uuid.NewSHA1(proxyIdentityNamespace, []byte(user.ID+":workspace")).String()
	name := strings.TrimSpace(m.config.WorkspaceName)
	if name == "" {
		name = defaultWorkspaceName
	}
	organization := &models.Organization{
		ID: organizationID, Name: name, CreatedByID: user.ID, CreatedAt: now, UpdatedAt: now,
	}
	organizationMember := &models.OrganizationMember{
		OrganizationID: organizationID, UserID: user.ID, Role: models.OrganizationRoleOwner, CreatedAt: now,
	}
	workspace := &models.Workspace{
		ID: workspaceID, OrganizationID: organizationID, Name: name, WeekStart: 1, CreatedAt: now,
	}
	workspaceMember := &models.WorkspaceMember{
		WorkspaceID: workspaceID, UserID: user.ID, Role: models.WorkspaceRoleAdmin,
		Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	return workspaceprovisioning.Create(ctx, tx, workspaceprovisioning.Boundary{
		Organization:       organization,
		OrganizationMember: organizationMember,
		Workspace:          workspace,
		WorkspaceMember:    workspaceMember,
	})
}
