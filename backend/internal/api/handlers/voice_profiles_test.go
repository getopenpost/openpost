package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestVoiceProfileRoutesPreserveInheritanceAndRevisionSafety(t *testing.T) {
	server := newVoiceProfilesTestServer(t)

	response := server.request(t, http.MethodPost, "/api/v1/voice-profiles", map[string]any{
		"workspace_id": "ws-1",
		"name":         "Rodrigo",
		"definition": map[string]any{
			"identity_summary":  "Direct technical founder",
			"forbidden_phrases": []string{"game changer"},
		},
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	personal := decodeVoiceProfile(t, response)
	require.True(t, personal.IsDefault)
	require.Equal(t, 1, personal.Revision)

	response = server.request(t, http.MethodPost, "/api/v1/voice-profiles", map[string]any{
		"workspace_id": "ws-1",
		"name":         "OpenPost",
		"definition": map[string]any{
			"identity_summary": "Clear product voice",
		},
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	company := decodeVoiceProfile(t, response)
	require.False(t, company.IsDefault)

	response = server.request(t, http.MethodPut, "/api/v1/voice-profile-assignments/account-2", map[string]any{
		"workspace_id":     "ws-1",
		"voice_profile_id": company.ID,
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var assignment voiceprofiles.EffectiveProfile
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &assignment))
	require.Equal(t, voiceprofiles.ResolutionAccountOverride, assignment.Source)
	require.Equal(t, company.ID, assignment.Profile.ID)

	response = server.request(t, http.MethodPost, "/api/v1/voice-profiles/effective", map[string]any{
		"workspace_id": "ws-1",
		"account_ids":  []string{"account-2", "account-1"},
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var resolved []voiceprofiles.EffectiveProfile
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &resolved))
	require.Equal(t, []string{"account-2", "account-1"}, []string{resolved[0].AccountID, resolved[1].AccountID})
	require.Equal(t, voiceprofiles.ResolutionAccountOverride, resolved[0].Source)
	require.Equal(t, voiceprofiles.ResolutionWorkspaceDefault, resolved[1].Source)

	response = server.request(t, http.MethodPut, "/api/v1/voice-profiles/"+company.ID, map[string]any{
		"workspace_id":      "ws-1",
		"expected_revision": company.Revision,
		"name":              "OpenPost company",
		"definition": map[string]any{
			"identity_summary": "Precise product updates",
		},
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	company = decodeVoiceProfile(t, response)
	require.Equal(t, 2, company.Revision)

	response = server.request(t, http.MethodPut, "/api/v1/voice-profiles/"+company.ID, map[string]any{
		"workspace_id":      "ws-1",
		"expected_revision": 1,
		"name":              "Stale",
		"definition":        map[string]any{},
	}, "web-token")
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())

	response = server.request(t, http.MethodPost, "/api/v1/voice-profiles/"+company.ID+"/default", map[string]any{
		"workspace_id":      "ws-1",
		"expected_revision": company.Revision,
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	company = decodeVoiceProfile(t, response)
	require.True(t, company.IsDefault)
	require.Equal(t, 3, company.Revision)

	response = server.request(t, http.MethodGet, "/api/v1/voice-profiles/"+personal.ID+"?workspace_id=ws-1", nil, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	personal = decodeVoiceProfile(t, response)
	require.False(t, personal.IsDefault)
	require.Equal(t, 2, personal.Revision)

	response = server.request(t, http.MethodDelete,
		"/api/v1/voice-profiles/"+personal.ID+"?workspace_id=ws-1&expected_revision=2&confirm=true", nil, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	response = server.request(t, http.MethodDelete,
		"/api/v1/voice-profiles/"+company.ID+"?workspace_id=ws-1&expected_revision=3&confirm=true", nil, "web-token")
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
}

func TestVoiceProfileRoutesRejectCredentialAndEntityWorkspaceCrossing(t *testing.T) {
	server := newVoiceProfilesTestServer(t)
	response := server.request(t, http.MethodPost, "/api/v1/voice-profiles", map[string]any{
		"workspace_id": "ws-1", "name": "Private", "definition": map[string]any{},
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	profile := decodeVoiceProfile(t, response)

	response = server.request(t, http.MethodGet,
		"/api/v1/voice-profiles/"+profile.ID+"?workspace_id=ws-1", nil, "other-workspace-token")
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())

	response = server.request(t, http.MethodPut, "/api/v1/voice-profile-assignments/outside-account", map[string]any{
		"workspace_id": "ws-1", "voice_profile_id": profile.ID,
	}, "web-token")
	require.Equal(t, http.StatusNotFound, response.Code, response.Body.String())

	response = server.request(t, http.MethodGet,
		"/api/v1/voice-profiles/"+profile.ID+"?workspace_id=ws-2", nil, "web-token")
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
}

func TestVoiceProfileHandlerRegistersWithoutRuntimeDependencies(t *testing.T) {
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	require.NotPanics(t, func() { NewVoiceProfileHandler(nil, nil).RegisterRoutes(api) })
	require.NotNil(t, api.OpenAPI().Paths["/voice-profiles"])
}

type voiceProfilesTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newVoiceProfilesTestServer(t *testing.T) *voiceProfilesTestServer {
	t.Helper()
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createVoiceProfileHandlerTables(t, db)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
		Status: models.WorkspaceMemberStatusActive,
	}).Exec(t.Context())
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "account-1", WorkspaceID: "ws-1", Slug: "x", Platform: "x", AccountID: "x-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-2", WorkspaceID: "ws-1", Slug: "linkedin", Platform: "linkedin", AccountID: "linkedin-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "outside-account", WorkspaceID: "ws-2", Slug: "outside", Platform: "x", AccountID: "x-2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewVoiceProfileHandler(db, testAuthenticator{}).RegisterRoutes(api)
	return &voiceProfilesTestServer{echo: e, db: db}
}

func createVoiceProfileHandlerTables(t *testing.T, db *bun.DB) {
	t.Helper()
	statements := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_voice_owner_idx ON social_accounts (id, workspace_id)`,
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
		`CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_handler_default_idx ON voice_profiles (workspace_id) WHERE is_default = true`,
		`CREATE TABLE IF NOT EXISTS voice_profile_account_assignments (
			social_account_id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			voice_profile_id TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		)`,
	}
	for _, statement := range statements {
		_, err := db.ExecContext(context.Background(), statement)
		require.NoError(t, err)
	}
}

func (s *voiceProfilesTestServer) request(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	s.echo.ServeHTTP(recorder, request)
	return recorder
}

func decodeVoiceProfile(t *testing.T, response *httptest.ResponseRecorder) voiceprofiles.Profile {
	t.Helper()
	var profile voiceprofiles.Profile
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &profile))
	return profile
}
