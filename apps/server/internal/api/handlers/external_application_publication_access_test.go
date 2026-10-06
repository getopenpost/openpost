package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/stretchr/testify/require"
)

type externalPublicationAuthenticator struct{}

func (externalPublicationAuthenticator) AuthenticateBearer(_ context.Context, _ string) (*middleware.Principal, error) {
	return &middleware.Principal{
		UserID: "user-1", WorkspaceID: "workspace-1", TokenID: "external-token",
		Scope: apitokens.ScopeExternalApp, Audience: "https://app.example/api/v1",
		InstallationID: "installation-1", DelegatedScopes: "drafts:write publications:cancel",
	}, nil
}

func TestExternalApplicationPublicationWritersRequireStoredAccountGrants(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		path string
		body string
	}{
		{"rewrite content", "", `{"expected_revision":1,"source_text":"Changed content"}`},
		{"delete destinations", "", `{"expected_revision":1,"renditions":[]}`},
		{"clear schedule", "", `{"expected_revision":1,"clear_schedule":true}`},
		{"upsert granted destination", "/renditions", `{"expected_revision":1,"renditions":[{"social_account_id":"account-2","profile":"short_text","body":"New destination"}]}`},
	} {
		for _, key := range []string{"", "writer-request"} {
			t.Run(tc.name+"/"+key, func(t *testing.T) {
				db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Publication)(nil), (*models.ExternalAppAccountGrant)(nil), (*models.ExternalAppInstallation)(nil), (*models.ExternalAppWorkspaceGrant)(nil), (*models.Job)(nil))
				t.Cleanup(func() { require.NoError(t, db.Close()) })
				createIdempotencyRecordTable(t, db)
				_, err := db.NewInsert().Model(&models.ExternalAppInstallation{ID: "installation-1", SponsorUserID: "user-1"}).Exec(t.Context())
				require.NoError(t, err)
				_, err = db.NewInsert().Model(&models.ExternalAppWorkspaceGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1"}).Exec(t.Context())
				require.NoError(t, err)
				_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
				require.NoError(t, err)
				publication := models.Publication{
					ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
					Title: "Original", SourceText: "Original content", SourceContent: "Original content",
					ContentProfile: models.ContentProfileShortText, Status: models.PublicationStatusDraft,
					ScheduledAt: time.Now().UTC().Add(time.Hour), MetadataJSON: "{}", ReleasePlanJSON: "{}",
				}
				_, err = db.NewInsert().Model(&publication).Exec(t.Context())
				require.NoError(t, err)
				seedHandlerAccount(t, db, "account-1", "x")
				seedHandlerAccount(t, db, "account-2", "x")
				seedHandlerRendition(t, db, "rendition-1", publication.ID, "account-1", "x", "Original content", models.RenditionStatusDraft)
				_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-2"}).Exec(t.Context())
				require.NoError(t, err)
				e := echo.New()
				api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
				NewPublicationHandler(db, externalPublicationAuthenticator{}, nil).RegisterRoutes(api)
				invoke := func() *httptest.ResponseRecorder {
					req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/v1/publications/publication-1"+tc.path, bytes.NewBufferString(tc.body))
					req.Header.Set("Authorization", "Bearer external-token")
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("Idempotency-Key", key)
					response := httptest.NewRecorder()
					e.ServeHTTP(response, req)
					return response
				}
				var original models.Publication
				require.NoError(t, db.NewSelect().Model(&original).Where("id = ?", publication.ID).Scan(t.Context()))
				var originalRenditions []models.Rendition
				require.NoError(t, db.NewSelect().Model(&originalRenditions).Where("publication_id = ?", publication.ID).Order("id").Scan(t.Context()))
				response := invoke()
				require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
				require.Contains(t, response.Body.String(), "not granted every publication account")
				var unchanged models.Publication
				require.NoError(t, db.NewSelect().Model(&unchanged).Where("id = ?", publication.ID).Scan(t.Context()))
				require.Equal(t, original, unchanged)
				var unchangedRenditions []models.Rendition
				require.NoError(t, db.NewSelect().Model(&unchangedRenditions).Where("publication_id = ?", publication.ID).Order("id").Scan(t.Context()))
				require.Equal(t, originalRenditions, unchangedRenditions)
				_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1"}).Exec(t.Context())
				require.NoError(t, err)
				response = invoke()
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var updated PublicationResponse
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &updated))
				require.Equal(t, 2, updated.Revision)
				switch tc.name {
				case "rewrite content":
					require.Equal(t, "Changed content", updated.SourceText)
				case "delete destinations":
					require.Empty(t, updated.Renditions)
				case "clear schedule":
					require.Empty(t, updated.ScheduledAt)
				case "upsert granted destination":
					require.Len(t, updated.Renditions, 2)
					require.Equal(t, "account-2", updated.Renditions[1].SocialAccountID)
					require.Equal(t, "New destination", updated.Renditions[1].Body)
				}
				if key != "" && tc.name != "delete destinations" {
					_, err = db.NewDelete().Model((*models.ExternalAppAccountGrant)(nil)).Where("installation_id = ? AND social_account_id = ?", "installation-1", "account-1").Exec(t.Context())
					require.NoError(t, err)
					response = invoke()
					require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
				}
			})
		}
	}
}

func TestExternalApplicationPublicationActionsRequireEveryDestinationGrant(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.Rendition)(nil), (*models.ExternalAppAccountGrant)(nil))
	ctx := context.WithValue(t.Context(), middleware.InstallationIDKey, "installation-1")
	handler := NewPublicationHandler(db, nil, nil)
	_, err := db.NewInsert().Model(&[]models.Rendition{
		{ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1", TargetKey: "x:account-1"},
		{ID: "rendition-2", PublicationID: "publication-1", SocialAccountID: "account-2", TargetKey: "x:account-2"},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1"}).Exec(ctx)
	require.NoError(t, err)

	err = handler.requireExternalPublicationAccounts(ctx, "publication-1")
	require.Error(t, err)

	_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-2"}).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, handler.requireExternalPublicationAccounts(ctx, "publication-1"))
}

func TestExternalApplicationPublicationReadsHideUngrantedDestinations(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.ExternalAppAccountGrant)(nil))
	ctx := context.WithValue(t.Context(), middleware.InstallationIDKey, "installation-1")
	handler := NewPublicationHandler(db, nil, nil)
	_, err := db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1"}).Exec(ctx)
	require.NoError(t, err)
	publication := publicationservice.PublicationResponse{
		WorkspaceID: "workspace-1",
		Renditions: []publicationservice.RenditionResponse{
			{ID: "rendition-1", SocialAccountID: "account-1"},
			{ID: "rendition-2", SocialAccountID: "account-2"},
		},
	}

	require.NoError(t, handler.filterExternalPublicationRenditions(ctx, &publication))
	require.Len(t, publication.Renditions, 1)
	require.Equal(t, "account-1", publication.Renditions[0].SocialAccountID)
}

func TestExternalApplicationScheduleFieldsRequireScheduleOrCancelScope(t *testing.T) {
	t.Parallel()
	ctx := context.WithValue(t.Context(), middleware.InstallationIDKey, "installation-1")
	ctx = context.WithValue(ctx, middleware.DelegatedScopesKey, "drafts:write")
	require.Error(t, requireExternalDelegatedScope(ctx, "publications:schedule"))
	require.Error(t, requireExternalDelegatedScope(ctx, "publications:cancel"))

	ctx = context.WithValue(ctx, middleware.DelegatedScopesKey, "drafts:write publications:schedule publications:cancel")
	require.NoError(t, requireExternalDelegatedScope(ctx, "publications:schedule"))
	require.NoError(t, requireExternalDelegatedScope(ctx, "publications:cancel"))
}
