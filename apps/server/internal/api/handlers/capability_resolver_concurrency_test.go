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
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type keyedCapabilityAdapter struct {
	platform.Adapter
	calls   int
	keyFunc func(platform.AccountCapabilityInput) string
	result  platform.AccountCapabilityResult
}

func (a *keyedCapabilityAdapter) ResolveAccountPublishingCapabilities(
	context.Context,
	string,
	platform.AccountCapabilityInput,
) (platform.AccountCapabilityResult, error) {
	a.calls++
	return a.result, nil
}

func (a *keyedCapabilityAdapter) AccountCapabilityKeyInput(input platform.AccountCapabilityInput) string {
	if a.keyFunc == nil {
		return ""
	}
	return a.keyFunc(input)
}

func TestAccountCapabilityCacheUsesOnlyDeclaredInputs(t *testing.T) {
	account := models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: capabilities.ProviderX}
	segments := []capabilities.ResolveSegment{{ID: "segment-1", Body: "A normal update"}}
	adapter := &keyedCapabilityAdapter{
		keyFunc: func(input platform.AccountCapabilityInput) string {
			value, _ := input.Settings["community_id"].(string)
			return value
		},
	}
	handler := NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
		capabilities.ProviderX: adapter,
	}, capabilityResolverTokenSource{})

	resolved := capabilities.Resolve(capabilities.ProviderX, capabilities.ResolveInput{Segments: segments})
	handler.mergeAccountCapability(t.Context(), account, "en-US", "US", map[string]any{"community_id": "one", "made_with_ai": true}, segments, &resolved)
	handler.mergeAccountCapability(t.Context(), account, "en-US", "US", map[string]any{"community_id": "one", "made_with_ai": false}, segments, &resolved)
	require.Equal(t, 1, adapter.calls, "settings the adapter does not read must not refetch provider state")

	handler.mergeAccountCapability(t.Context(), account, "en-US", "US", map[string]any{"community_id": "two"}, segments, &resolved)
	require.Equal(t, 2, adapter.calls, "declared inputs must invalidate the entry")
}

func TestAccountCapabilityCacheMissesAfterReconnect(t *testing.T) {
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: capabilities.ProviderX,
		OAuthGrantID: "grant-1", GrantedScopes: "tweet.read tweet.write",
	}
	segments := []capabilities.ResolveSegment{{ID: "segment-1", Body: "A normal update"}}
	adapter := &keyedCapabilityAdapter{}
	handler := NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
		capabilities.ProviderX: adapter,
	}, capabilityResolverTokenSource{})

	resolved := capabilities.Resolve(capabilities.ProviderX, capabilities.ResolveInput{Segments: segments})
	handler.mergeAccountCapability(t.Context(), account, "en-US", "US", nil, segments, &resolved)
	reconnected := account
	reconnected.GrantedScopes = "tweet.read tweet.write users.read"
	handler.mergeAccountCapability(t.Context(), reconnected, "en-US", "US", nil, segments, &resolved)

	require.Equal(t, 2, adapter.calls, "a reconnect with different scopes must resolve again")
}

func TestResolveCapabilitiesTreatsOmittedSegmentsLikeIdenticalOverrides(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws", Name: "Test"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	providers := []string{"x", "threads", "instagram"}
	for _, provider := range providers {
		_, err = db.NewInsert().Model(&models.SocialAccount{
			ID: provider, WorkspaceID: "ws", Platform: provider, AccessTokenEnc: []byte("test"), IsActive: true,
		}).Exec(t.Context())
		require.NoError(t, err)
	}

	run := func(body string) string {
		e := echo.New()
		api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
		NewCapabilityResolverHandler(db, testAuthenticator{}, nil, nil).RegisterRoutes(api)
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/capabilities/resolve", bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return rec.Body.String()
	}

	segments := `"segments":[{"id":"segment","content":"A normal update"}]`
	omitted := `{"account_ids":["x","threads","instagram"],` + segments + `}`
	explicit := `{"account_ids":["x","threads","instagram"],` + segments + `,"account_segments":{` +
		`"x":[{"id":"segment","content":"A normal update"}],` +
		`"threads":[{"id":"segment","content":"A normal update"}],` +
		`"instagram":[{"id":"segment","content":"A normal update"}]}}`

	// Literal expectations for this fixture: plain text fits both text-first
	// destinations, while Instagram has no text format and needs media.
	expected := []struct {
		account       string
		profile       string
		outputProfile string
		compatible    bool
		mediaRequired bool
	}{
		{account: "x", profile: models.ContentProfileShortText, outputProfile: "x.post", compatible: true},
		{account: "threads", profile: models.ContentProfileShortText, outputProfile: "threads.post", compatible: true},
		{account: "instagram", profile: models.ContentProfileImagePost, outputProfile: "instagram.feed", mediaRequired: true},
	}
	assertProjection := func(t *testing.T, body string) {
		t.Helper()
		var payload struct {
			Accounts []ResolvedAccountCapability `json:"accounts"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &payload))
		require.Len(t, payload.Accounts, len(expected))
		for index, want := range expected {
			account := payload.Accounts[index]
			require.Equal(t, want.account, account.AccountID, "response order must follow the request")
			require.Equal(t, want.profile, account.Profile, account.AccountID)
			require.Equal(t, want.outputProfile, account.OutputProfile, account.AccountID)
			require.Equal(t, want.compatible, account.Compatible, account.AccountID)
			if want.mediaRequired {
				require.True(t, hasCapabilityIssue(account.Issues, "media_required", "media"), account.AccountID)
				continue
			}
			require.False(t, hasCapabilityIssueCode(account.Issues, "media_required"), account.AccountID)
		}
	}

	omittedBody := run(omitted)
	explicitBody := run(explicit)
	assertProjection(t, omittedBody)
	assertProjection(t, explicitBody)
	require.Equal(t, omittedBody, explicitBody, "omitted overrides must match identical explicit ones")
}

func hasCapabilityIssueCode(issues []capabilities.ValidationIssue, code string) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

func TestResolveCapabilitiesMatchesSequentialResponse(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws", Name: "Test"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	providers := []string{"x", "threads", "instagram", "linkedin"}
	for _, provider := range providers {
		_, err = db.NewInsert().Model(&models.SocialAccount{
			ID: provider, WorkspaceID: "ws", Platform: provider, AccessTokenEnc: []byte("test"), IsActive: true,
		}).Exec(t.Context())
		require.NoError(t, err)
	}

	run := func(concurrency int) []byte {
		e := echo.New()
		api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
		handler := NewCapabilityResolverHandler(db, testAuthenticator{}, nil, nil)
		handler.resolveConcurrency = concurrency
		handler.RegisterRoutes(api)
		body := `{"account_ids":["x","threads","instagram","linkedin"],"segments":[{"id":"segment","content":"A normal update"}]}`
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/capabilities/resolve", bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return rec.Body.Bytes()
	}

	// Literal expectations for this fixture, independent of either run: plain
	// text fits the three text-first destinations and Instagram needs media.
	expected := []struct {
		account       string
		profile       string
		outputProfile string
		compatible    bool
		mediaRequired bool
	}{
		{account: "x", profile: models.ContentProfileShortText, outputProfile: "x.post", compatible: true},
		{account: "threads", profile: models.ContentProfileShortText, outputProfile: "threads.post", compatible: true},
		{account: "instagram", profile: models.ContentProfileImagePost, outputProfile: "instagram.feed", mediaRequired: true},
		{account: "linkedin", profile: models.ContentProfileShortText, outputProfile: "linkedin.post", compatible: true},
	}
	assertProjection := func(t *testing.T, body []byte) {
		t.Helper()
		var payload struct {
			Accounts []ResolvedAccountCapability `json:"accounts"`
		}
		require.NoError(t, json.Unmarshal(body, &payload))
		require.Len(t, payload.Accounts, len(expected))
		for index, want := range expected {
			account := payload.Accounts[index]
			require.Equal(t, want.account, account.AccountID, "response order must follow the request")
			require.Equal(t, want.profile, account.Profile, account.AccountID)
			require.Equal(t, want.outputProfile, account.OutputProfile, account.AccountID)
			require.Equal(t, want.compatible, account.Compatible, account.AccountID)
			if want.mediaRequired {
				require.True(t, hasCapabilityIssue(account.Issues, "media_required", "media"), account.AccountID)
				continue
			}
			require.False(t, hasCapabilityIssueCode(account.Issues, "media_required"), account.AccountID)
		}
	}

	sequential := run(1)
	concurrent := run(4)
	require.Equal(t, string(sequential), string(concurrent), "concurrent resolution must preserve order and content")
	assertProjection(t, sequential)
	assertProjection(t, concurrent)
}
