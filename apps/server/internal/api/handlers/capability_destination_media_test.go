package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestComposerResolvesDestinationMedia(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.MediaAttachment)(nil))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws", Name: "Test"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	for _, provider := range []string{"x", "threads", "instagram"} {
		_, err = db.NewInsert().Model(&models.SocialAccount{ID: provider, WorkspaceID: "ws", Platform: provider, AccessTokenEnc: []byte("test"), IsActive: true}).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.MediaAttachment{ID: "image", WorkspaceID: "ws", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080}).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewCapabilityResolverHandler(db, testAuthenticator{}, nil, nil).RegisterRoutes(api)
	body := `{"account_ids":["x","threads","instagram"],"segments":[{"id":"segment","content":"Photo"}],"account_segments":{"x":[{"id":"segment","content":"Photo","media":[{"media_id":"image"}]}],"threads":[{"id":"segment","content":"Photo","media":[{"media_id":"image"}]}],"instagram":[{"id":"segment","content":"Photo","media":[{"media_id":"image"}]}]}}`
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/capabilities/resolve", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var result struct {
		Accounts []ResolvedAccountCapability `json:"accounts"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
	require.Len(t, result.Accounts, 3)
	for _, account := range result.Accounts {
		require.Equal(t, models.ContentProfileImagePost, account.Profile, account.AccountID)
		for _, issue := range account.Issues {
			require.NotEqual(t, "media_required", issue.Code)
			require.False(t, issue.Code == "setting_required" && issue.Field == "url", account.AccountID)
		}
	}
}
