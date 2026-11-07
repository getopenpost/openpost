package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
)

type mentionExternalAuthenticator struct{}

func (mentionExternalAuthenticator) AuthenticateBearer(context.Context, string) (*middleware.Principal, error) {
	return &middleware.Principal{UserID: "user-1", WorkspaceID: "workspace-1", TokenID: "external-token", Scope: apitokens.ScopeExternalApp, Audience: "https://app.example/api/v1", InstallationID: "installation-1", DelegatedScopes: "accounts:read"}, nil
}
func TestMentionLookupHonorsCurrentDelegatedAccountGrantsBeforeProviderIO(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.ExternalAppInstallation)(nil), (*models.ExternalAppWorkspaceGrant)(nil), (*models.ExternalAppAccountGrant)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppInstallation{ID: "installation-1", SponsorUserID: "user-1"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppWorkspaceGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1"}).Exec(t.Context())
	require.NoError(t, err)
	seedHandlerAccount(t, db, "bsky", "bluesky")
	adapter := &mentionLookupTestAdapter{target: posttext.MentionTarget{Provider: "bluesky", Kind: "person", ID: "did:plc:ewvi7nxzyoun6zhxrhs64oiz"}}
	tokens := &destinationOptionsTokenSource{}
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h := NewDestinationOptionsHandler(db, mentionExternalAuthenticator{}, map[string]platform.Adapter{"bluesky": adapter}, tokens)
	h.RegisterRoutes(api)
	invoke := func() *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/accounts/bsky/mentions?query=alice", nil)
		req.Header.Set("Authorization", "Bearer external-token")
		out := httptest.NewRecorder()
		e.ServeHTTP(out, req)
		return out
	}
	response := invoke()
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	require.Empty(t, tokens.accountID)
	require.Zero(t, adapter.calls)
	_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "bsky"}).Exec(t.Context())
	require.NoError(t, err)
	response = invoke()
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "bsky", tokens.accountID)
	require.Equal(t, 1, adapter.calls)
	_, err = db.NewDelete().Model((*models.ExternalAppAccountGrant)(nil)).Where("installation_id = ?", "installation-1").Exec(t.Context())
	require.NoError(t, err)
	tokens.accountID = ""
	response = invoke()
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	require.Empty(t, tokens.accountID)
	require.Equal(t, 1, adapter.calls)
}
