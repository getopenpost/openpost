package identity

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	require.Equal(t, "OIDC Person", linked.LinkedName)
	require.Equal(t, fake.email, linked.LinkedEmail)

	_, err = service.Complete(
		context.Background(),
		EnvironmentProviderID,
		state,
		"authorization-code",
		result.BrowserBinding,
	)
	require.ErrorIs(t, err, ErrInvalidAuthRequest)
}

func TestConcurrentIdentityAndPasskeyRemovalPreservesOneCredential(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	ctx := context.Background()
	now := time.Now().UTC()
	user := &models.User{
		ID: "concurrent-credential-user", Email: "concurrent-credential@example.com",
		PasswordHash: "password-hash", PasskeyEnabledAt: now, CreatedAt: now,
	}
	identity := &models.UserIdentity{
		ID: "concurrent-identity", ProviderID: EnvironmentProviderID, Subject: "concurrent-subject",
		UserID: user.ID, LinkedEmail: user.Email, CreatedAt: now,
	}
	passkey := testPasskey("concurrent-passkey", user.ID, now)
	require.NoError(t, insertIdentityRows(ctx, db, user, identity, passkey))
	seedRequiredSSOPasswordPolicy(t, db, user.ID, "concurrent")

	start := make(chan struct{})
	results := make(chan error, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	go func() {
		ready.Done()
		<-start
		results <- service.UnlinkIdentity(ctx, user.ID, identity.ID)
	}()
	go func() {
		ready.Done()
		<-start
		results <- service.RemovePasskey(ctx, user.ID, passkey.ID)
	}()
	ready.Wait()
	close(start)

	errs := []error{<-results, <-results}
	successes := 0
	finalCredentialErrors := 0
	for _, err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrFinalCredential):
			finalCredentialErrors++
		default:
			require.NoError(t, err)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, finalCredentialErrors)

	identityCount, err := db.NewSelect().Model((*models.UserIdentity)(nil)).
		Where("user_id = ?", user.ID).
		Count(ctx)
	require.NoError(t, err)
	passkeyCount, err := db.NewSelect().Model((*models.UserPasskey)(nil)).
		Where("user_id = ?", user.ID).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, identityCount+passkeyCount)
}

func testPasskey(id, userID string, createdAt time.Time) *models.UserPasskey {
	return &models.UserPasskey{
		ID: id, UserID: userID, Name: id,
		CredentialID: []byte("credential-" + id), CredentialJSON: "{}", CreatedAt: createdAt,
	}
}

func insertIdentityRows(ctx context.Context, db *bun.DB, rows ...any) error {
	for _, row := range rows {
		if _, err := db.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func seedRequiredSSOPasswordPolicy(t *testing.T, db *bun.DB, userID, suffix string) {
	t.Helper()
	now := time.Now().UTC()
	organizationID := "required-sso-" + suffix
	rows := []any{
		&models.Organization{
			ID: organizationID, Name: "Required SSO", CreatedByID: userID,
			CreatedAt: now, UpdatedAt: now,
		},
		&models.OrganizationMember{
			OrganizationID: organizationID, UserID: userID,
			Role: models.OrganizationRoleOwner, CreatedAt: now,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: organizationID, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs: `["instance"]`, AssuranceMaxAgeSeconds: 3600,
			PasswordLoginAllowed: false, APITokenMode: models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: 3600, RequireTokenReauth: true,
			CreatedAt: now, UpdatedAt: now,
		},
	}
	require.NoError(t, insertIdentityRows(t.Context(), db, rows...))
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
