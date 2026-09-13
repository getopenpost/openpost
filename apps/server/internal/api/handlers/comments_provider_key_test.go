package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type commentProviderKeyCase struct {
	name        string
	platform    string
	instanceURL string
	renditionID string
}

var commentProviderKeyCases = []commentProviderKeyCase{
	{name: "mastodon instance", platform: "mastodon", instanceURL: "https://mastodon.example/", renditionID: "rendition-mastodon"},
	{name: "self-hosted bluesky PDS", platform: "bluesky", instanceURL: "https://pds.example", renditionID: "rendition-bluesky"},
}

// newFederatedCommentsTestDB seeds accounts whose adapters are registered
// under instance-specific provider keys, never under the bare platform name.
func newFederatedCommentsTestDB(t *testing.T) (*bun.DB, map[string]platform.Adapter, *servicecrypto.TokenEncryptor) {
	t.Helper()
	db := newHandlerSchemaTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	encryptor := servicecrypto.NewTokenEncryptor("test-comment-key")
	token, err := encryptor.Encrypt("token")
	require.NoError(t, err)

	rows := make([]any, 0, 5+2*len(commentProviderKeyCases))
	rows = append(rows,
		&models.User{ID: "user-1", Email: "user@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: "organization-1", Name: "Comments", CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "organization-1", Name: "Comments", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.Publication{ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch", ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished, MetadataJSON: "{}", ReleasePlanJSON: "{}"},
	)
	providers := map[string]platform.Adapter{}
	for _, tc := range commentProviderKeyCases {
		accountID := "account-" + tc.platform
		rows = append(rows,
			&models.SocialAccount{ID: accountID, WorkspaceID: "ws-1", Slug: accountID, Platform: tc.platform, AccountID: "provider-" + accountID, InstanceURL: tc.instanceURL, AccessTokenEnc: token, IsActive: true, CreatedAt: now},
			&models.Rendition{ID: tc.renditionID, PublicationID: "publication-1", SocialAccountID: accountID, Platform: tc.platform, Profile: models.ContentProfileShortText, Body: "Launch", SettingsJSON: "{}", Status: models.RenditionStatusPublished, ExternalID: "external-" + tc.platform},
		)
		key := platform.AccountProviderKey(tc.platform, tc.instanceURL, "")
		require.NotEqual(t, tc.platform, key, "fixture must use an instance-specific provider key")
		providers[key] = fakeCommentAdapter{comments: []platform.Comment{{ID: "comment-" + tc.platform, Text: "Nice launch"}}}
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(ctx)
		require.NoError(t, err)
	}
	return db, providers, encryptor
}

func TestListRenditionCommentsUsesInstanceSpecificProvider(t *testing.T) {
	db, providers, encryptor := newFederatedCommentsTestDB(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewCommentHandler(db, testAuthenticator{}, providers, encryptor)
	handler.SetFeatureGate(alwaysEnabledCommentsGate{})
	handler.RegisterRoutes(api)

	for _, tc := range commentProviderKeyCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/renditions/"+tc.renditionID+"/comments", nil)
			req.Header.Set("Authorization", "Bearer web-token")
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			var out CommentListResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
			require.Len(t, out.Comments, 1)
			require.Equal(t, "comment-"+tc.platform, out.Comments[0].ProviderCommentID)
		})
	}
}

func TestReplyToCommentUsesInstanceSpecificProvider(t *testing.T) {
	db, providers, encryptor := newFederatedCommentsTestDB(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewCommentHandler(db, testAuthenticator{}, providers, encryptor)
	handler.SetFeatureGate(alwaysEnabledCommentsGate{})
	handler.RegisterRoutes(api)

	for _, tc := range commentProviderKeyCases {
		t.Run(tc.name, func(t *testing.T) {
			commentID, err := encodeCommentReference(commentReference{RenditionID: tc.renditionID, ProviderCommentID: "comment-" + tc.platform})
			require.NoError(t, err)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/comments/"+commentID+"/reply", strings.NewReader(`{"body":"Thanks"}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer web-token")
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			require.Contains(t, rec.Body.String(), "comment reply queued")
		})
	}
}

func TestMCPListRenditionCommentsUsesInstanceSpecificProvider(t *testing.T) {
	db, providers, encryptor := newFederatedCommentsTestDB(t)
	handler := NewMCPHandler(db, testAuthenticator{})
	handler.SetProviderCatalog(providers, false)
	handler.SetTokenEncryptor(encryptor)

	for _, tc := range commentProviderKeyCases {
		t.Run(tc.name, func(t *testing.T) {
			result, rpcErr := handler.listRenditionComments(context.Background(), "user-1", map[string]any{"rendition_id": tc.renditionID})

			require.Nil(t, rpcErr)
			structured := result.(map[string]any)["structuredContent"].(map[string]any)
			comments := structured["comments"].([]CommentResponse)
			require.Len(t, comments, 1)
			require.Equal(t, "comment-"+tc.platform, comments[0].ProviderCommentID)
		})
	}
}
