package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestPublicProfileReturnsOptInPublishingActivity(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.BillingSubscription)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC()
	user := &models.User{
		ID: "user-1", Email: "rodrigo@example.com", Username: "rodrgds",
		DisplayName: "Rodrigo Dias", PublicProfile: true,
		PublicProfileVisibilityJSON: "[]", CreatedAt: now.AddDate(-1, 0, 0),
	}
	organization := &models.Organization{ID: "organization-1", Name: "OpenPost", CreatedByID: user.ID, CreatedAt: now}
	organizationMember := &models.OrganizationMember{OrganizationID: organization.ID, UserID: user.ID, Role: models.OrganizationRoleOwner}
	workspace := &models.Workspace{ID: "workspace-1", OrganizationID: organization.ID, Name: "OpenPost", CreatedAt: now}
	member := &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin}
	subscription := &models.BillingSubscription{
		OrganizationID: organization.ID, Provider: models.BillingProviderPaddle,
		ProviderCustomerID: "customer-1", ProviderSubscriptionID: "subscription-1",
		Status: "active", PlanID: "pro",
	}
	require.NoError(t, insertProfileRows(ctx, db, user, organization, organizationMember, workspace, member, subscription))

	publications := []models.Publication{
		{ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "One", SourceContent: "One", Status: models.PublicationStatusPublished, ActualRunAt: now, UpdatedAt: now},
		{ID: "publication-2", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "Two", SourceContent: "Two", Status: models.PublicationStatusPublished, ActualRunAt: now.AddDate(0, 0, -1), UpdatedAt: now.AddDate(0, 0, -1)},
		{ID: "publication-3", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "Three", SourceContent: "Three", Status: models.PublicationStatusPublished, ActualRunAt: now.AddDate(0, 0, -3), UpdatedAt: now.AddDate(0, 0, -3)},
	}
	require.NoError(t, insertProfileRows(ctx, db, &publications))
	renditions := []models.Rendition{
		{ID: "rendition-1", PublicationID: "publication-1", Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished},
		{ID: "rendition-2", PublicationID: "publication-2", Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished},
		{ID: "rendition-3", PublicationID: "publication-3", Platform: "linkedin", Profile: "short_text", Status: models.RenditionStatusPublished},
	}
	require.NoError(t, insertProfileRows(ctx, db, &renditions))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/rodrgds", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var profile PublicProfileOutput
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &profile.Body))
	require.Equal(t, "rodrgds", profile.Body.Username)
	require.Equal(t, "pro", profile.Body.PlanID)
	require.Equal(t, publicprofiles.SupportedFields(), profile.Body.VisibleFields)
	require.Equal(t, 3, *profile.Body.LifetimePosts)
	require.Equal(t, 2, *profile.Body.CurrentStreak)
	require.Equal(t, 2, *profile.Body.LongestStreak)
	require.Len(t, profile.Body.Activity, publicProfileActivityDays)
	require.Equal(t, PublicProfileRanking{Key: "x", Name: "x", Count: 2}, profile.Body.TopPlatforms[0])
	require.Equal(t, PublicProfileRanking{Key: workspace.ID, Name: "OpenPost", Count: 3}, profile.Body.TopWorkspaces[0])
}

func TestPublicProfileReturnsOnlyExplicitlyVisibleFields(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	raw, _, err := publicprofiles.Normalize([]string{publicprofiles.FieldAvatar})
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "private@example.com", Username: "careful-user",
		DisplayName: "Private name", AvatarURL: "https://cdn.example/avatar.png",
		PublicProfile: true, PublicProfileVisibilityJSON: raw,
	}).Exec(context.Background())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/careful-user", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Equal(t, []any{"avatar"}, body["visible_fields"])
	require.Equal(t, "https://cdn.example/avatar.png", body["avatar_url"])
	require.NotContains(t, body, "display_name")
	require.NotContains(t, body, "joined_at")
	require.NotContains(t, body, "activity")
	require.NotContains(t, body, "top_platforms")
	require.NotContains(t, body, "top_workspaces")
	require.NotContains(t, body, "plan_id")
}

func TestPublicProfileCapabilityCanBeDisabled(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "public@example.com", Username: "public-user", PublicProfile: true,
	}).Exec(context.Background())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db, false).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/public-user", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
}

func TestPublicProfileHidesOptedOutUser(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "private@example.com", Username: "private-user"}).Exec(context.Background())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/private-user", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
}

func TestPublicProfileDoesNotRevealWorkspacesAfterMembershipIsDeactivated(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
	)
	visibility, _, err := publicprofiles.Normalize([]string{publicprofiles.FieldWorkspaces})
	require.NoError(t, err)
	now := time.Now().UTC()
	user := &models.User{
		ID: "user-1", Email: "former-member@example.com", Username: "former-member",
		PublicProfile: true, PublicProfileVisibilityJSON: visibility, CreatedAt: now,
	}
	workspace := &models.Workspace{ID: "workspace-private", Name: "Former client", CreatedAt: now}
	member := &models.WorkspaceMember{
		WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleViewer,
		Status: models.WorkspaceMemberStatusInactive, DeactivatedAt: now,
	}
	publication := &models.Publication{
		ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID,
		Title: "Published before removal", SourceContent: "Published before removal",
		Status: models.PublicationStatusPublished, ActualRunAt: now, UpdatedAt: now,
	}
	require.NoError(t, insertProfileRows(t.Context(), db, user, workspace, member, publication))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/former-member", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.NotContains(t, body, "top_workspaces")
}

func insertProfileRows(ctx context.Context, db *bun.DB, rows ...interface{}) error {
	for _, row := range rows {
		if _, err := db.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
