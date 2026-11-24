package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type publicationBuildTestBuilder struct{}

func (publicationBuildTestBuilder) Build(
	context.Context,
	publicationbuilder.BuildInput,
) (publicationbuilder.BuildResult, error) {
	return publicationbuilder.BuildResult{}, nil
}

type publicationBuildTestAuthenticator struct{}

func (publicationBuildTestAuthenticator) AuthenticateBearer(
	_ context.Context,
	token string,
) (*middleware.Principal, error) {
	switch token {
	case "web-token":
		return &middleware.Principal{UserID: "user-1", Email: "one@example.com", SessionID: "session-1"}, nil
	case "other-user-token":
		return &middleware.Principal{UserID: "user-2", Email: "two@example.com", SessionID: "session-2"}, nil
	case "foreign-workspace-token":
		return &middleware.Principal{
			UserID: "user-1", Email: "one@example.com", SessionID: "session-1", WorkspaceID: "ws-2",
		}, nil
	default:
		return nil, apitokens.ErrInvalidToken
	}
}

func TestPublicationBuildCreateRejectsForeignAccountAndVoiceProfile(t *testing.T) {
	t.Parallel()
	server := newPublicationBuildTestServer(t)

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids": []string{"foreign-account"},
	}), "foreign-account-request", "web-token")
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())

	response = server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids":      []string{"account-x"},
		"voice_profile_id": "default:ws-2",
	}), "foreign-profile-request", "web-token")
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())

	count, err := server.db.NewSelect().Model((*publicationbuilder.BuildRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestPublicationBuildOutputProfilesFreezeLiveMastodonInstanceLimits(t *testing.T) {
	t.Parallel()
	account := models.SocialAccount{
		ID: "mastodon-account", Platform: capabilities.ProviderMastodon, InstanceURL: "https://social.example",
	}
	resolver := NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
		capabilities.ProviderMastodon + ":" + account.InstanceURL: xCapabilityResolverAdapter{result: platform.AccountCapabilityResult{
			Revision: "mastodon-instance-1",
			Constraints: map[string]any{
				"text_limit":      1_337,
				"media_max_count": 7,
				"allowed_mimes":   []string{"image/png", "video/webm"},
			},
		}},
	}, capabilityResolverTokenSource{})
	handler := NewPublicationBuildHandler(nil, publicationBuildTestAuthenticator{}, nil)
	handler.SetCapabilityResolver(resolver)

	profiles := handler.publicationBuildOutputProfiles(t.Context(), account, "")
	require.NotEmpty(t, profiles)
	require.Equal(t, 1_337, profiles[0].TextLimit)
	require.Equal(t, 7, profiles[0].MediaMaxCount)
	require.Equal(t, []string{"image/png", "video/webm"}, profiles[0].AllowedMIMEs)
}

func TestPublicationBuildCreateStoresReferencesWithoutFetchingThem(t *testing.T) {
	t.Parallel()
	server := newPublicationBuildTestServer(t)
	var fetches atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		fetches.Add(1)
	}))
	t.Cleanup(remote.Close)

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"idea":         "",
		"context_urls": []string{remote.URL + "/source"},
		"assets": []map[string]any{{
			"media_id": "media-1", "role": "evidence", "may_publish": false,
		}},
	}), "source-reference-request", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Zero(t, fetches.Load(), "the HTTP request path must not fetch source URLs")
	build := decodePublicationBuild(t, response)
	require.Equal(t, []string{remote.URL + "/source"}, build.ContextURLs)
	require.Equal(t, []publicationbuilder.BuildAsset{{
		MediaID: "media-1", Role: "evidence", MayPublish: false,
	}}, build.Assets)
	require.Empty(t, build.Input.Sources, "stored references must not create fake source rows")

	foreign := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"assets": []map[string]any{{"media_id": "foreign-media", "role": "context", "may_publish": false}},
	}), "foreign-media-request", "web-token")
	require.Equal(t, http.StatusBadRequest, foreign.Code, foreign.Body.String())
}

func TestPublicationBuildGetRequiresCreatorOwnership(t *testing.T) {
	t.Parallel()
	server := newPublicationBuildTestServer(t)
	created := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "owned-build-request", "web-token",
	)
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	build := decodePublicationBuild(t, created)

	owned := server.request(t, http.MethodGet, "/api/v1/publication-builds/"+build.ID, nil, "", "web-token")
	require.Equal(t, http.StatusOK, owned.Code, owned.Body.String())

	foreign := server.request(t, http.MethodGet, "/api/v1/publication-builds/"+build.ID, nil, "", "other-user-token")
	require.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())

	wrongCredentialScope := server.request(t, http.MethodGet, "/api/v1/publication-builds/"+build.ID, nil, "", "foreign-workspace-token")
	require.Equal(t, http.StatusForbidden, wrongCredentialScope.Code, wrongCredentialScope.Body.String())
}

type publicationBuildTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	handler *PublicationBuildHandler
}

func newPublicationBuildTestServer(t *testing.T) *publicationBuildTestServer {
	t.Helper()
	now := time.Date(2026, time.August, 23, 14, 0, 0, 0, time.UTC)
	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.SocialSet)(nil),
		(*models.SocialSetAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Job)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*publicationbuilder.BuildRecord)(nil),
	)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	db.SetMaxOpenConns(1)
	createPublicationBuildVoiceTables(t, db)
	_, err := db.NewCreateIndex().
		Index("publication_builds_handler_idempotency_idx").
		Table("publication_builds").
		Column("workspace_id", "created_by_id", "idempotency_key").
		Unique().
		Exec(t.Context())
	require.NoError(t, err)

	users := []models.User{
		{ID: "user-1", Email: "one@example.com"},
		{ID: "user-2", Email: "two@example.com"},
	}
	_, err = db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	workspaces := []models.Workspace{
		{ID: "ws-1", OrganizationID: "org-1", Name: "OpenPost"},
		{ID: "ws-2", OrganizationID: "org-2", Name: "Other"},
	}
	_, err = db.NewInsert().Model(&workspaces).Exec(t.Context())
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "ws-1", UserID: "user-2", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
	}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)

	provider := &models.IdentityProvider{
		ID: "provider-1", OrganizationID: "org-1", Source: "database",
		Issuer: "https://id.example", Name: "Example ID", ClientID: "client-1",
		UseUserInfo: true, RequireVerifiedEmail: true, JITEnabled: true, IsActive: true,
	}
	_, err = db.NewInsert().Model(provider).Exec(t.Context())
	require.NoError(t, err)
	policy := &models.OrganizationSSOPolicy{
		OrganizationID: "org-1", Mode: models.OrganizationSSOModeDisabled,
		ProviderIDs: `["provider-1"]`, AssuranceMaxAgeSeconds: 3600,
		APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: 3600,
	}
	_, err = db.NewInsert().Model(policy).Exec(t.Context())
	require.NoError(t, err)
	assurances := []models.SessionIdentityAssurance{
		{SessionID: "session-1", ProviderID: "provider-1", UserID: "user-1", AuthTime: now, ExpiresAt: now.Add(24 * time.Hour)},
		{SessionID: "session-2", ProviderID: "provider-1", UserID: "user-2", AuthTime: now, ExpiresAt: now.Add(24 * time.Hour)},
	}
	_, err = db.NewInsert().Model(&assurances).Exec(t.Context())
	require.NoError(t, err)

	accounts := []models.SocialAccount{
		{ID: "account-x", WorkspaceID: "ws-1", Slug: "founder-x", Platform: capabilities.ProviderX, AccountID: "x-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-linkedin", WorkspaceID: "ws-1", Slug: "founder-linkedin", Platform: capabilities.ProviderLinkedIn, AccountID: "linkedin-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-outside-set", WorkspaceID: "ws-1", Slug: "founder-bluesky", Platform: capabilities.ProviderBluesky, AccountID: "bluesky-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-instagram", WorkspaceID: "ws-1", Slug: "founder-instagram", Platform: capabilities.ProviderInstagram, AccountID: "instagram-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "foreign-account", WorkspaceID: "ws-2", Slug: "foreign", Platform: capabilities.ProviderX, AccountID: "x-2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(t.Context())
	require.NoError(t, err)
	media := []models.MediaAttachment{
		{ID: "media-1", WorkspaceID: "ws-1", FilePath: "source.png", MimeType: "image/png", ProcessingStatus: "ready", CreatedAt: now},
		{ID: "foreign-media", WorkspaceID: "ws-2", FilePath: "foreign.png", MimeType: "image/png", ProcessingStatus: "ready", CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&media).Exec(t.Context())
	require.NoError(t, err)
	set := &models.SocialSet{ID: "founder-set", WorkspaceID: "ws-1", Name: "Founder accounts", CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(set).Exec(t.Context())
	require.NoError(t, err)
	setAccounts := []models.SocialSetAccount{
		{SocialSetID: set.ID, SocialAccountID: "account-x", DisplayOrder: 0, DefaultOutputProfile: "x.thread", CreatedAt: now},
		{SocialSetID: set.ID, SocialAccountID: "account-linkedin", DisplayOrder: 1, DefaultOutputProfile: "linkedin.post", CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&setAccounts).Exec(t.Context())
	require.NoError(t, err)
	_, err = voiceprofiles.SeedDefault(t.Context(), db, voiceprofiles.DefaultSeed{
		WorkspaceID: "ws-1", CreatedByID: "user-1", Name: "Rodrigo", Now: now,
	})
	require.NoError(t, err)
	_, err = voiceprofiles.SeedDefault(t.Context(), db, voiceprofiles.DefaultSeed{
		WorkspaceID: "ws-2", CreatedByID: "user-1", Name: "Other voice", Now: now,
	})
	require.NoError(t, err)

	application, err := publicationbuilder.NewApplication(db, publicationBuildTestBuilder{}, publicationbuilder.ApplicationConfig{
		Model: "test-model", Now: func() time.Time { return now },
	})
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPublicationBuildHandler(db, publicationBuildTestAuthenticator{}, application)
	handler.now = func() time.Time { return now }
	handler.RegisterRoutes(api)
	return &publicationBuildTestServer{echo: e, db: db, handler: handler}
}

func createPublicationBuildVoiceTables(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, statement := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_publication_build_owner_idx ON social_accounts (id, workspace_id)`,
		`CREATE TABLE IF NOT EXISTS voice_profiles (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT false,
			revision INTEGER NOT NULL DEFAULT 1,
			schema_version INTEGER NOT NULL DEFAULT 1,
			definition_json TEXT NOT NULL DEFAULT '{}',
			created_by_id TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			UNIQUE (id, workspace_id),
			UNIQUE (workspace_id, normalized_name)
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS publication_build_voice_default_idx ON voice_profiles (workspace_id) WHERE is_default = true`,
		`CREATE TABLE IF NOT EXISTS voice_profile_account_assignments (
			social_account_id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			voice_profile_id TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		)`,
		`CREATE TABLE publication_build_assets (
			build_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			display_order INTEGER NOT NULL DEFAULT 0,
			role TEXT NOT NULL DEFAULT 'context',
			may_publish BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (build_id, media_id)
		)`,
	} {
		_, err := db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
}

func publicationBuildRequest(overrides map[string]any) map[string]any {
	request := map[string]any{
		"workspace_id": "ws-1",
		"idea":         "I deleted fifteen thousand lines and the product got simpler.",
		"account_ids":  []string{"account-x"},
	}
	for key, value := range overrides {
		request[key] = value
	}
	return request
}

func (server *publicationBuildTestServer) request(
	t *testing.T,
	method string,
	path string,
	body any,
	idempotencyKey string,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	return response
}

func decodePublicationBuild(t *testing.T, response *httptest.ResponseRecorder) publicationbuilder.Build {
	t.Helper()
	var build publicationbuilder.Build
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &build))
	return build
}
