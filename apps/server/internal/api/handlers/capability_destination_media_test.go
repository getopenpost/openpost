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
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
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

func TestComposerKeepsNativePollSettingsForTextSegmentOfMixedThread(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.MediaAttachment)(nil))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws", Name: "Test"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	for _, provider := range []string{"x", "linkedin"} {
		_, err = db.NewInsert().Model(&models.SocialAccount{ID: provider, WorkspaceID: "ws", Platform: provider, AccessTokenEnc: []byte("test"), IsActive: true}).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.MediaAttachment{ID: "image", WorkspaceID: "ws", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080}).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewCapabilityResolverHandler(db, testAuthenticator{}, map[string]platform.Adapter{
		capabilities.ProviderX: xCapabilityResolverAdapter{result: platform.XPublishingCapabilities(platform.XSubscriptionTypePremium)},
	}, capabilityResolverTokenSource{}).RegisterRoutes(api)
	for _, test := range []struct {
		name     string
		segments string
		poll     bool
	}{
		{"text poll then photo", `[{"id":"poll","content":"Question"},{"id":"photo","content":"Photo","media":[{"media_id":"image"}]}]`, true},
		{"photo then text poll", `[{"id":"photo","content":"Photo","media":[{"media_id":"image"}]},{"id":"poll","content":"Question"}]`, true},
		{"only photo segments", `[{"id":"first","content":"Photo","media":[{"media_id":"image"}]},{"id":"second","content":"Photo","media":[{"media_id":"image"}]}]`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"account_ids":["x","linkedin"],"creation_preset":"thread","requested_output_profiles":{"x":"x.thread","linkedin":"linkedin.post"},"segments":` + test.segments + `}`
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
			require.Len(t, result.Accounts, 2)
			for _, account := range result.Accounts {
				var poll *capabilities.SettingDefinition
				for i := range account.Settings {
					if account.Settings[i].Key == "poll_options" {
						poll = &account.Settings[i]
					}
				}
				if account.AccountID == "linkedin" {
					require.Equal(t, "join", account.SegmentStrategy)
					require.Nil(t, poll, "a joined media post cannot offer a native poll")
					continue
				}
				require.Equal(t, "preserve", account.SegmentStrategy)
				require.Equal(t, platform.XPremiumTextLimit, account.TextLimit, "account-resolved limits remain authoritative")
				if !test.poll {
					require.Nil(t, poll)
					continue
				}
				require.NotNil(t, poll, "the text segment must retain its native poll fields")
				require.Equal(t, capabilities.SettingScopeSegment, poll.Scope)
				require.Equal(t, 4, poll.Constraints.MaxItems)
				require.Equal(t, 25, poll.Constraints.MaxLength)
			}
		})
	}
}
