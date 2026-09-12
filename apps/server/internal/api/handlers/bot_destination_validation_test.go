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

func TestDiscordChannelRequirementAtComposerBoundary(t *testing.T) {
	for _, mode := range []string{"bot", "webhook"} {
		for _, settings := range []string{`{}`, `{"channel_id":null}`, `{"channel_id":"  "}`, `{"channel_id":"channel-1"}`} {
			t.Run(mode+settings, func(t *testing.T) {
				db := createHandlerTestDB(t, (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.MediaAttachment)(nil))
				_, err := db.NewInsert().Model(&models.Workspace{ID: "ws", Name: "Test"}).Exec(t.Context())
				require.NoError(t, err)
				_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
				require.NoError(t, err)
				_, err = db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "ws", Platform: "discord", AccessTokenEnc: []byte("installation-reference"), CapabilityState: `{"connection_type":"` + mode + `"}`, IsActive: true}).Exec(t.Context())
				require.NoError(t, err)
				e := echo.New()
				api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
				NewCapabilityResolverHandler(db, testAuthenticator{}, nil, nil).RegisterRoutes(api)
				body := `{"account_ids":["account"],"segments":[{"id":"segment-1","content":"Hello"}],"account_settings":{"account":` + settings + `}}`
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
				require.Len(t, result.Accounts, 1)
				resolved := result.Accounts[0]
				wantMissing := mode == "bot" && settings != `{"channel_id":"channel-1"}`
				require.Equal(t, wantMissing, hasCapabilityIssue(resolved.Issues, "setting_required", "channel_id"), rec.Body.String())
				if mode == "bot" {
					for _, field := range resolved.Settings {
						if field.Key == "channel_id" {
							require.True(t, field.Required)
						}
					}
				}
			})
		}
	}
}

func TestDiscordPublicationValidationRequiresChannelWithoutProviderLookup(t *testing.T) {
	for _, mode := range []string{"bot", "webhook"} {
		t.Run(mode, func(t *testing.T) {
			db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil))
			_, err := db.NewInsert().Model(&models.Publication{ID: "pub", WorkspaceID: "ws", ContentProfile: models.ContentProfileShortText, SourceText: "Hello", SourceContent: "Hello", Status: models.PublicationStatusDraft}).Exec(t.Context())
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "ws", Platform: "discord", AccessTokenEnc: []byte("installation-reference"), CapabilityState: `{"connection_type":"` + mode + `"}`, IsActive: true}).Exec(t.Context())
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Rendition{ID: "rendition", PublicationID: "pub", SocialAccountID: "account", Platform: "discord", Profile: models.ContentProfileShortText, Body: "Hello", SettingsJSON: `{}`, Status: models.RenditionStatusDraft}).Exec(t.Context())
			require.NoError(t, err)
			issues, err := (&PublicationHandler{db: db}).validatePublicationByID(t.Context(), "pub")
			require.NoError(t, err)
			require.Equal(t, mode == "bot", hasCapabilityIssue(issues, "setting_required", "channel_id"), issues)
		})
	}
}
