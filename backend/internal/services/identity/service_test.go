package identity

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	josejwt "github.com/go-jose/go-jose/v4/jwt"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type fakeOIDCIssuer struct {
	t             *testing.T
	server        *httptest.Server
	mu            sync.Mutex
	key           *rsa.PrivateKey
	keyID         string
	nonce         string
	codeChallenge string
	subject       string
	email         string
	userInfoSub   string
	issuerClaim   string
	audience      string
	nonceClaim    string
}

func newFakeOIDCIssuer(t *testing.T) *fakeOIDCIssuer {
	t.Helper()
	fake := &fakeOIDCIssuer{
		t:        t,
		subject:  "subject-1",
		email:    "person@example.com",
		audience: "openpost-client",
	}
	fake.rotate()
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serveHTTP))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeOIDCIssuer) rotate() {
	f.t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(f.t, err)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.key = key
	f.keyID = fmt.Sprintf("key-%d", time.Now().UnixNano())
}

func (f *fakeOIDCIssuer) issuer() string {
	return f.server.URL
}

func (f *fakeOIDCIssuer) configureAuthorization(rawURL string) {
	f.t.Helper()
	parsed, err := url.Parse(rawURL)
	require.NoError(f.t, err)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nonce = parsed.Query().Get("nonce")
	f.codeChallenge = parsed.Query().Get("code_challenge")
	require.NotEmpty(f.t, f.nonce)
	require.Equal(f.t, "S256", parsed.Query().Get("code_challenge_method"))
	require.NotEmpty(f.t, f.codeChallenge)
}

func (f *fakeOIDCIssuer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/.well-known/openid-configuration":
		f.writeJSON(w, map[string]any{
			"issuer":                                f.issuer(),
			"authorization_endpoint":                f.issuer() + "/authorize",
			"token_endpoint":                        f.issuer() + "/token",
			"userinfo_endpoint":                     f.issuer() + "/userinfo",
			"jwks_uri":                              f.issuer() + "/jwks",
			"end_session_endpoint":                  f.issuer() + "/logout",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	case "/jwks":
		f.mu.Lock()
		jwk := jose.JSONWebKey{
			Key:       f.key.Public(),
			KeyID:     f.keyID,
			Algorithm: string(jose.RS256),
			Use:       "sig",
		}
		f.mu.Unlock()
		f.writeJSON(w, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{jwk}})
	case "/token":
		require.NoError(f.t, r.ParseForm())
		require.Equal(f.t, "authorization_code", r.Form.Get("grant_type"))
		require.Equal(f.t, "authorization-code", r.Form.Get("code"))
		verifier := r.Form.Get("code_verifier")
		sum := sha256.Sum256([]byte(verifier))
		challenge := base64.RawURLEncoding.EncodeToString(sum[:])
		f.mu.Lock()
		expectedChallenge := f.codeChallenge
		f.mu.Unlock()
		if challenge != expectedChallenge {
			http.Error(w, "invalid PKCE verifier", http.StatusBadRequest)
			return
		}
		raw, err := f.idToken()
		require.NoError(f.t, err)
		f.writeJSON(w, map[string]any{
			"access_token": "access-token",
			"token_type":   "Bearer",
			"expires_in":   300,
			"id_token":     raw,
		})
	case "/userinfo":
		f.mu.Lock()
		subject := f.subject
		if f.userInfoSub != "" {
			subject = f.userInfoSub
		}
		email := f.email
		f.mu.Unlock()
		f.writeJSON(w, map[string]any{
			"sub": subject, "email": email, "email_verified": true, "name": "OIDC Person",
		})
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeOIDCIssuer) idToken() (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	issuer := f.issuer()
	if f.issuerClaim != "" {
		issuer = f.issuerClaim
	}
	nonce := f.nonce
	if f.nonceClaim != "" {
		nonce = f.nonceClaim
	}
	audience := f.audience
	now := time.Now().UTC()
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: f.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", f.keyID),
	)
	if err != nil {
		return "", err
	}
	return josejwt.Signed(signer).Claims(map[string]any{
		"iss": issuer, "sub": f.subject, "aud": audience,
		"exp": now.Add(5 * time.Minute).Unix(), "iat": now.Unix(),
		"auth_time": now.Unix(), "nonce": nonce,
		"email": f.email, "email_verified": true, "name": "OIDC Person",
		"amr": []string{"pwd", "mfa"}, "acr": "urn:test:mfa", "sid": "upstream-session",
	}).Serialize()
}

func (f *fakeOIDCIssuer) logoutToken(tokenID, sessionID string, includeNonce bool) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now().UTC()
	claims := map[string]any{
		"iss": f.issuer(), "aud": f.audience, "jti": tokenID, "sid": sessionID,
		"iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
		"events": map[string]any{
			"http://schemas.openid.net/event/backchannel-logout": map[string]any{},
		},
	}
	if includeNonce {
		claims["nonce"] = "not-allowed"
	}
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: f.key},
		(&jose.SignerOptions{}).WithType("logout+jwt").WithHeader("kid", f.keyID),
	)
	if err != nil {
		return "", err
	}
	return josejwt.Signed(signer).Claims(claims).Serialize()
}

func (f *fakeOIDCIssuer) writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	require.NoError(f.t, json.NewEncoder(w).Encode(value))
}

func newIdentityTestService(t *testing.T, fake *fakeOIDCIssuer) (*Service, *bun.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:identity-%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, err := database.InitDBWithDriver("sqlite", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	service := NewService(db, servicecrypto.NewTokenEncryptor("identity-test-key"), Config{
		PublicURL: "https://openpost.example",
		Environment: EnvironmentProviderConfig{
			Issuer: fake.issuer(), ClientID: "openpost-client", ClientSecret: "secret",
			Name: "Test SSO", Scopes: []string{"openid", "profile", "email"}, JITEnabled: true,
		},
	})
	service.SetHTTPClient(EnvironmentProviderID, fake.server.Client())
	require.NoError(t, service.SyncEnvironmentProvider(context.Background()))
	return service, db
}

func beginTestLogin(t *testing.T, service *Service, fake *fakeOIDCIssuer) (*BeginResult, string) {
	t.Helper()
	result, err := service.Begin(context.Background(), BeginInput{
		ProviderID: EnvironmentProviderID,
		Intent:     models.OIDCIntentLogin,
		ReturnPath: "/calendar?view=week",
	})
	require.NoError(t, err)
	fake.configureAuthorization(result.AuthorizationURL)
	parsed, err := url.Parse(result.AuthorizationURL)
	require.NoError(t, err)
	return result, parsed.Query().Get("state")
}

func TestOIDCLoginUsesPKCEAndStableIdentity(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	result, state := beginTestLogin(t, service, fake)

	completion, err := service.Complete(
		context.Background(),
		EnvironmentProviderID,
		state,
		"authorization-code",
		result.BrowserBinding,
	)
	require.NoError(t, err)
	require.Equal(t, fake.email, completion.User.Email)
	require.Empty(t, completion.User.PasswordHash)
	require.Equal(t, "/calendar?view=week", completion.Request.ReturnPath)
	require.Equal(t, "subject-1", completion.Identity.Subject)

	var linked models.UserIdentity
	require.NoError(t, db.NewSelect().Model(&linked).
		Where("provider_id = ? AND subject = ?", EnvironmentProviderID, "subject-1").
		Scan(context.Background()))
	require.Equal(t, completion.User.ID, linked.UserID)

	_, err = service.Complete(
		context.Background(),
		EnvironmentProviderID,
		state,
		"authorization-code",
		result.BrowserBinding,
	)
	require.ErrorIs(t, err, ErrInvalidAuthRequest)
}

func TestOIDCRejectsBrowserBindingAndNonceFailures(t *testing.T) {
	t.Run("browser binding", func(t *testing.T) {
		fake := newFakeOIDCIssuer(t)
		service, _ := newIdentityTestService(t, fake)
		result, state := beginTestLogin(t, service, fake)
		_, err := service.Complete(
			context.Background(), EnvironmentProviderID, state, "authorization-code", strings.Repeat("x", 43),
		)
		require.ErrorIs(t, err, ErrBrowserBinding)
		_, err = service.Complete(
			context.Background(), EnvironmentProviderID, state, "authorization-code", result.BrowserBinding,
		)
		require.NoError(t, err)
	})

	t.Run("nonce", func(t *testing.T) {
		fake := newFakeOIDCIssuer(t)
		service, _ := newIdentityTestService(t, fake)
		result, state := beginTestLogin(t, service, fake)
		fake.mu.Lock()
		fake.nonceClaim = "wrong-nonce"
		fake.mu.Unlock()
		_, err := service.Complete(
			context.Background(), EnvironmentProviderID, state, "authorization-code", result.BrowserBinding,
		)
		require.ErrorIs(t, err, ErrNonceMismatch)
	})
}

func TestOIDCRejectsIssuerAudienceAndUserInfoSubject(t *testing.T) {
	tests := []struct {
		name      string
		configure func(*fakeOIDCIssuer, *bun.DB)
		want      error
	}{
		{
			name: "issuer",
			configure: func(fake *fakeOIDCIssuer, _ *bun.DB) {
				fake.issuerClaim = "https://different-issuer.example"
			},
		},
		{
			name: "audience",
			configure: func(fake *fakeOIDCIssuer, _ *bun.DB) {
				fake.audience = "different-client"
			},
		},
		{
			name: "userinfo subject",
			configure: func(fake *fakeOIDCIssuer, db *bun.DB) {
				fake.userInfoSub = "different-subject"
				_, err := db.NewUpdate().Model((*models.IdentityProvider)(nil)).
					Set("use_userinfo = ?", true).
					Where("id = ?", EnvironmentProviderID).
					Exec(context.Background())
				require.NoError(t, err)
			},
			want: ErrUserInfoSubject,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := newFakeOIDCIssuer(t)
			service, db := newIdentityTestService(t, fake)
			result, state := beginTestLogin(t, service, fake)
			test.configure(fake, db)
			service.invalidateRuntime(EnvironmentProviderID)
			_, err := service.Complete(
				context.Background(), EnvironmentProviderID, state, "authorization-code", result.BrowserBinding,
			)
			require.Error(t, err)
			if test.want != nil {
				require.ErrorIs(t, err, test.want)
			}
		})
	}
}

func TestOIDCJWKSRotationAndEmailCollision(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	result, state := beginTestLogin(t, service, fake)
	fake.rotate()
	_, err := service.Complete(
		context.Background(), EnvironmentProviderID, state, "authorization-code", result.BrowserBinding,
	)
	require.NoError(t, err)

	fake.mu.Lock()
	fake.subject = "new-subject"
	fake.mu.Unlock()
	result, state = beginTestLogin(t, service, fake)
	_, err = service.Complete(
		context.Background(), EnvironmentProviderID, state, "authorization-code", result.BrowserBinding,
	)
	require.ErrorIs(t, err, ErrEmailConflict)

	count, err := db.NewSelect().Model((*models.User)(nil)).
		Where("email = ?", fake.email).
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestJITBootstrapAllowlistOnlyAppliesToEnvironmentProvider(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	ctx := context.Background()
	now := time.Now().UTC()
	hostedProvider := models.IdentityProvider{
		ID: "hosted-bootstrap-test", Source: "database", Issuer: "https://hosted.example.com",
		Name: "Hosted SSO", ClientID: "hosted-client", Scopes: "openid",
		EmailClaim: "email", NameClaim: "name", PictureClaim: "picture",
		JITEnabled: true, IsActive: true, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&hostedProvider).Exec(ctx)
	require.NoError(t, err)
	service.config.Environment.BootstrapSubjects = []string{
		"hosted-admin@example.com",
		fake.issuer() + "|environment-admin",
	}

	hostedUser, err := service.createJITUser(ctx, hostedProvider, VerifiedIdentity{
		Subject: "hosted-admin", Email: "hosted-admin@example.com", EmailVerified: true,
	})
	require.NoError(t, err)
	require.False(t, hostedUser.IsAdmin)

	environmentProvider, err := service.GetProvider(ctx, EnvironmentProviderID)
	require.NoError(t, err)
	environmentUser, err := service.createJITUser(ctx, *environmentProvider, VerifiedIdentity{
		Subject: "environment-admin", Email: "environment-admin@example.com", EmailVerified: true,
	})
	require.NoError(t, err)
	require.True(t, environmentUser.IsAdmin)
}

func TestOIDCExplicitLinkUsesAuthenticatedOpenPostUser(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	now := time.Now().UTC()
	user := &models.User{
		ID: "existing-user", Email: fake.email, PasswordHash: "existing-password-hash", CreatedAt: now,
	}
	session := &models.UserSession{
		ID: "existing-session", UserID: user.ID, ExpiresAt: now.Add(time.Hour),
		LastUsedAt: now, CreatedAt: now,
	}
	_, err := db.NewInsert().Model(user).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(session).Exec(context.Background())
	require.NoError(t, err)

	result, err := service.Begin(context.Background(), BeginInput{
		ProviderID: EnvironmentProviderID,
		Intent:     models.OIDCIntentLink,
		UserID:     user.ID,
		SessionID:  session.ID,
		ReturnPath: "/settings?tab=security",
	})
	require.NoError(t, err)
	fake.configureAuthorization(result.AuthorizationURL)
	parsed, err := url.Parse(result.AuthorizationURL)
	require.NoError(t, err)

	completion, err := service.Complete(
		context.Background(),
		EnvironmentProviderID,
		parsed.Query().Get("state"),
		"authorization-code",
		result.BrowserBinding,
	)
	require.NoError(t, err)
	require.Equal(t, user.ID, completion.User.ID)
	require.Equal(t, "/settings?tab=security", completion.Request.ReturnPath)

	var identity models.UserIdentity
	require.NoError(t, db.NewSelect().Model(&identity).
		Where("provider_id = ? AND subject = ?", EnvironmentProviderID, fake.subject).
		Scan(context.Background()))
	require.Equal(t, user.ID, identity.UserID)

	var stored models.User
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", user.ID).Scan(context.Background()))
	require.Equal(t, "existing-password-hash", stored.PasswordHash)
}

func TestOIDCBackchannelLogoutRevokesMatchingSessionAndRejectsIDTokenShape(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	now := time.Now().UTC()
	user := &models.User{ID: "logout-user", Email: "logout@example.com", CreatedAt: now}
	session := &models.UserSession{
		ID: "openpost-session", UserID: user.ID, ExpiresAt: now.Add(time.Hour),
		LastUsedAt: now, CreatedAt: now,
	}
	assurance := &models.SessionIdentityAssurance{
		SessionID: session.ID, ProviderID: EnvironmentProviderID, UserID: user.ID,
		AuthTime: now, ExpiresAt: now.Add(time.Hour), AMR: "[]",
		UpstreamSID: "provider-session", CreatedAt: now,
	}
	for _, row := range []any{user, session, assurance} {
		_, err := db.NewInsert().Model(row).Exec(context.Background())
		require.NoError(t, err)
	}

	raw, err := fake.logoutToken("logout-event-1", assurance.UpstreamSID, false)
	require.NoError(t, err)
	revoked, err := service.ProcessBackchannelLogout(context.Background(), EnvironmentProviderID, raw)
	require.NoError(t, err)
	require.Equal(t, int64(1), revoked)

	var stored models.UserSession
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", session.ID).Scan(context.Background()))
	require.False(t, stored.RevokedAt.IsZero())

	revoked, err = service.ProcessBackchannelLogout(context.Background(), EnvironmentProviderID, raw)
	require.NoError(t, err)
	require.Zero(t, revoked)

	withNonce, err := fake.logoutToken("logout-event-2", assurance.UpstreamSID, true)
	require.NoError(t, err)
	_, err = service.ProcessBackchannelLogout(context.Background(), EnvironmentProviderID, withNonce)
	require.ErrorIs(t, err, ErrBackchannelLogout)
}
