package handlers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type accountLifecycleStorage struct {
	deleted   []string
	deleteErr error
}

func (s *accountLifecycleStorage) Driver() string { return "test" }
func (s *accountLifecycleStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (s *accountLifecycleStorage) Delete(_ context.Context, id string) error {
	s.deleted = append(s.deleted, id)
	return s.deleteErr
}

func TestAccountDeletionQueuesObjectCleanupWhenImmediateDeletionFails(t *testing.T) {
	t.Parallel()

	db, err := database.InitDB("file:" + t.TempDir() + "/deferred-cleanup.db?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	authService := auth.NewService("test-secret")
	passwordHash, err := authService.HashPassword("current-password-123")
	require.NoError(t, err)
	now := time.Now().UTC()
	user := &models.User{
		ID: "user-1", Email: "person@example.com", PasswordHash: passwordHash,
		AvatarObjectKey: "avatars/user-1.png", CreatedAt: now,
	}
	require.NoError(t, insertAccountLifecycleFixture(t.Context(), db, user, now))
	sessionService := sessions.NewService(db)
	session, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
		UserID: user.ID, ExpiresAt: now.Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession(user.ID, user.Email, session.ID, session.ExpiresAt)
	require.NoError(t, err)
	storage := &accountLifecycleStorage{deleteErr: errors.New("storage unavailable")}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAccountLifecycleHandler(
		db, authService, middleware.NewJWTAuthenticatorWithSessions(authService, sessionService), storage,
	).RegisterRoutes(api)

	deleted := jsonRequest(t, e, http.MethodDelete, "/api/v1/auth/account", map[string]string{
		"current_password": "current-password-123", "confirm_email": "person@example.com",
	}, token)
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	userCount, err := db.NewSelect().Model((*models.User)(nil)).Where("id = ?", user.ID).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, userCount)
	var cleanup models.Job
	require.NoError(t, db.NewSelect().Model(&cleanup).Where("type = ?", "storage_delete").Scan(t.Context()))
	require.Equal(t, "pending", cleanup.Status)
	require.Equal(t, 10, cleanup.MaxAttempts)
	require.Contains(t, cleanup.Payload, "avatars/user-1.png")
	require.Contains(t, cleanup.Payload, "media-file.png")
}
func (s *accountLifecycleStorage) GetURL(string) string { return "" }
func (s *accountLifecycleStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, nil
}

func TestAccountExportOmitsSecretsAndDeletionRemovesPersonalData(t *testing.T) {
	t.Parallel()

	db, err := database.InitDB("file:" + t.TempDir() + "/account.db?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	authService := auth.NewService("test-secret")
	passwordHash, err := authService.HashPassword("current-password-123")
	require.NoError(t, err)
	now := time.Now().UTC()
	user := &models.User{
		ID: "user-1", Email: "person@example.com", DisplayName: "Person", AvatarObjectKey: "avatars/user-1.png",
		PasswordHash: passwordHash, CreatedAt: now,
	}
	require.NoError(t, insertAccountLifecycleFixture(t.Context(), db, user, now))

	sessionService := sessions.NewService(db)
	session, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
		UserID: user.ID, ExpiresAt: now.Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession(user.ID, user.Email, session.ID, session.ExpiresAt)
	require.NoError(t, err)
	storage := &accountLifecycleStorage{}

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAccountLifecycleHandler(
		db,
		authService,
		middleware.NewJWTAuthenticatorWithSessions(authService, sessionService),
		mediastore.BlobStorage(storage),
	).RegisterRoutes(api)

	exported := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/account/export", map[string]string{
		"current_password": "current-password-123",
	}, token)
	require.Equal(t, http.StatusOK, exported.Code, exported.Body.String())
	require.Contains(t, exported.Header().Get("Content-Disposition"), "openpost-account-export")
	require.Contains(t, exported.Body.String(), "person@example.com")
	require.Contains(t, exported.Body.String(), "Draft content")
	require.NotContains(t, exported.Body.String(), "current-password-123")
	require.NotContains(t, exported.Body.String(), "oauth-access-secret")
	require.NotContains(t, exported.Body.String(), "api-token-hash-secret")

	impact := jsonRequest(t, e, http.MethodGet, "/api/v1/auth/account/deletion-impact", nil, token)
	require.Equal(t, http.StatusOK, impact.Code, impact.Body.String())
	require.Contains(t, impact.Body.String(), `"blockers":[]`)

	deleted := jsonRequest(t, e, http.MethodDelete, "/api/v1/auth/account", map[string]string{
		"current_password": "current-password-123",
		"confirm_email":    "person@example.com",
	}, token)
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	require.Contains(t, deleted.Header().Get("Set-Cookie"), "Max-Age=0")
	require.ElementsMatch(t, []string{"avatars/user-1.png", "media-file.png", "thumb-sm.png"}, storage.deleted)

	for table := range map[string]struct{}{
		"users": {}, "organizations": {}, "workspaces": {}, "social_accounts": {}, "media_attachments": {},
		"publications": {}, "publication_segments": {}, "publication_segment_media": {},
		"renditions": {}, "rendition_media": {}, "rendition_segments": {}, "rendition_segment_media": {},
		"api_tokens": {}, "jobs": {},
	} {
		var count int
		require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr(table).Scan(t.Context(), &count), table)
		require.Zero(t, count, table)
	}
}

func TestAccountDeletionPreviewsOwnershipTransferAndBlocksActiveBilling(t *testing.T) {
	t.Parallel()

	db, err := database.InitDB("file:" + t.TempDir() + "/blocked.db?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	authService := auth.NewService("test-secret")
	hash, err := authService.HashPassword("current-password-123")
	require.NoError(t, err)
	now := time.Now().UTC()
	users := []models.User{
		{ID: "user-1", Email: "owner@example.com", PasswordHash: hash, CreatedAt: now},
		{ID: "user-2", Email: "member@example.com", PasswordHash: hash, CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Shared", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	members := []models.OrganizationMember{
		{OrganizationID: "org-1", UserID: "user-1", Role: models.OrganizationRoleOwner, CreatedAt: now},
		{OrganizationID: "org-1", UserID: "user-2", Role: models.OrganizationRoleMember, CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "Shared", Timezone: "UTC", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org-1", WorkspaceID: "workspace-1", Provider: "paddle", ProviderCustomerID: "customer-1",
		ProviderSubscriptionID: "subscription-1", Status: "active", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	principalCtx := context.WithValue(t.Context(), middleware.UserIDKey, "user-1")
	handler := NewAccountLifecycleHandler(db, authService, nil, nil)
	impact, err := handler.loadDeletionImpact(principalCtx, "user-1")
	require.NoError(t, err)
	codes := make([]string, 0, len(impact.Blockers))
	for _, blocker := range impact.Blockers {
		codes = append(codes, blocker.Code)
	}
	require.Contains(t, codes, "active_billing")
	require.Len(t, impact.OwnershipTransfers, 1)
	require.Equal(t, "member@example.com", impact.OwnershipTransfers[0].SuccessorEmail)
}

func TestAccountDeletionTransfersSharedOrganizationAndPreservesTeamContent(t *testing.T) {
	t.Parallel()

	db, err := database.InitDB("file:" + t.TempDir() + "/transfer.db?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	authService := auth.NewService("test-secret")
	hash, err := authService.HashPassword("current-password-123")
	require.NoError(t, err)
	now := time.Now().UTC()
	users := []models.User{
		{ID: "user-1", Email: "owner@example.com", PasswordHash: hash, AvatarObjectKey: "avatars/user-1.png", IsAdmin: true, CreatedAt: now},
		{ID: "user-2", Email: "member@example.com", PasswordHash: hash, CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	organization := &models.Organization{ID: "org-1", Name: "Shared", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(organization).Exec(t.Context())
	require.NoError(t, err)
	members := []models.OrganizationMember{
		{OrganizationID: "org-1", UserID: "user-1", Role: models.OrganizationRoleOwner, CreatedAt: now},
		{OrganizationID: "org-1", UserID: "user-2", Role: models.OrganizationRoleAdmin, CreatedAt: now.Add(time.Second)},
	}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "Shared", Timezone: "UTC", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	workspaceMembers := []models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "workspace-1", UserID: "user-2", Role: models.WorkspaceRoleAdmin},
	}
	_, err = db.NewInsert().Model(&workspaceMembers).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Shared draft",
		ContentProfile: models.ContentProfileShortText, SourceText: "Keep this", SourceContent: "Keep this",
		Status: models.PublicationStatusDraft, CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Slug: "shared-account", Platform: "x",
		AccountID: "shared-provider-account-id", AccountUsername: "shared-provider-user",
		AccessTokenEnc: []byte("shared-provider-secret"), IsActive: true, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-1", WorkspaceID: "workspace-1", FilePath: "/tmp/shared-private-media.png",
		MimeType: "image/png", OriginalFilename: "shared-private-media.png", CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Job{
		ID: "job-1", Type: "publish_post", Payload: `{"user_id":"user-1","post_id":"post-1"}`,
		Status: "pending", RunAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	sessionService := sessions.NewService(db)
	session, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
		UserID: "user-1", ExpiresAt: now.Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession("user-1", "owner@example.com", session.ID, session.ExpiresAt)
	require.NoError(t, err)
	storage := &accountLifecycleStorage{}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAccountLifecycleHandler(
		db, authService, middleware.NewJWTAuthenticatorWithSessions(authService, sessionService), storage,
	).RegisterRoutes(api)
	exported := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/account/export", map[string]string{
		"current_password": "current-password-123",
	}, token)
	require.Equal(t, http.StatusOK, exported.Code, exported.Body.String())
	require.Contains(t, exported.Body.String(), `"shared_workspace_content_excluded":true`)
	require.NotContains(t, exported.Body.String(), "shared-provider-account-id")
	require.NotContains(t, exported.Body.String(), "shared-private-media.png")

	impact := jsonRequest(t, e, http.MethodGet, "/api/v1/auth/account/deletion-impact", nil, token)
	require.Equal(t, http.StatusOK, impact.Code, impact.Body.String())
	require.Contains(t, impact.Body.String(), `"ownership_transfers":[`)
	require.Contains(t, impact.Body.String(), `"successor_email":"member@example.com"`)
	require.Contains(t, impact.Body.String(), `"instance_admin_transfer":{"successor_email":"member@example.com"}`)

	deleted := jsonRequest(t, e, http.MethodDelete, "/api/v1/auth/account", map[string]string{
		"current_password": "current-password-123",
		"confirm_email":    "owner@example.com",
	}, token)
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	require.Equal(t, []string{"avatars/user-1.png"}, storage.deleted)

	require.NoError(t, db.NewSelect().Model(organization).Where("id = ?", "org-1").Scan(t.Context()))
	require.Equal(t, "user-2", organization.CreatedByID)
	var successor models.OrganizationMember
	require.NoError(t, db.NewSelect().Model(&successor).
		Where("organization_id = ? AND user_id = ?", "org-1", "user-2").Scan(t.Context()))
	require.Equal(t, models.OrganizationRoleOwner, successor.Role)
	var successorUser models.User
	require.NoError(t, db.NewSelect().Model(&successorUser).Where("id = ?", "user-2").Scan(t.Context()))
	require.True(t, successorUser.IsAdmin)
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(t.Context()))
	require.Equal(t, "user-2", publication.CreatedByID)
	accountCount, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Where("id = ?", "account-1").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, accountCount)
	for table, where := range map[string]string{
		"users":                "id = 'user-1'",
		"organization_members": "user_id = 'user-1'",
		"workspace_members":    "user_id = 'user-1'",
		"jobs":                 "id = 'job-1'",
	} {
		count, countErr := db.NewSelect().TableExpr(table).Where(where).Count(t.Context())
		require.NoError(t, countErr)
		require.Zero(t, count, table)
	}
}

func insertAccountLifecycleFixture(ctx context.Context, db *bun.DB, user *models.User, now time.Time) error {
	modelsToInsert := []any{
		user,
		&models.Organization{ID: "org-1", Name: "Personal", CreatedByID: user.ID, CreatedAt: now, UpdatedAt: now},
		&models.OrganizationMember{OrganizationID: "org-1", UserID: user.ID, Role: models.OrganizationRoleOwner, CreatedAt: now},
		&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "Personal", Timezone: "UTC", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: user.ID, Role: models.WorkspaceRoleAdmin},
		&models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Slug: "x-person", Platform: "x", AccountID: "x-1", AccessTokenEnc: []byte("oauth-access-secret"), IsActive: true, CreatedAt: now},
		&models.MediaAttachment{ID: "media-1", WorkspaceID: "workspace-1", FilePath: "/tmp/media-file.png", MimeType: "image/png", ThumbnailObjectKey: "", ThumbnailsJSON: `{"sm":"thumb-sm.png"}`, CreatedAt: now},
		&models.Publication{ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: user.ID, Title: "Draft", ContentProfile: models.ContentProfileShortText, SourceText: "Draft content", SourceContent: "Draft content", Status: models.PublicationStatusDraft, CreatedAt: now, UpdatedAt: now},
		&models.PublicationSegment{ID: "segment-1", PublicationID: "publication-1", Body: "Draft content", CreatedAt: now, UpdatedAt: now},
		&models.PublicationSegmentMedia{SegmentID: "segment-1", MediaID: "media-1"},
		&models.Rendition{ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1", TargetKey: "account-1", Platform: "x", Profile: models.ContentProfileShortText, Body: "Draft content", Status: models.RenditionStatusDraft, CreatedAt: now, UpdatedAt: now},
		&models.RenditionMedia{RenditionID: "rendition-1", MediaID: "media-1"},
		&models.RenditionSegment{ID: "rendition-segment-1", RenditionID: "rendition-1", PublicationSegmentID: "segment-1", Body: "Draft content", Status: models.RenditionStatusDraft, CreatedAt: now, UpdatedAt: now},
		&models.RenditionSegmentMedia{RenditionSegmentID: "rendition-segment-1", MediaID: "media-1"},
		&models.APIToken{ID: "token-1", UserID: user.ID, Name: "Automation", TokenHash: "api-token-hash-secret", TokenPrefix: "op_1234", Scope: "cli:full", CreatedAt: now},
		&models.Job{ID: "job-1", Type: "publish_post", Payload: `{"workspace_id":"workspace-1","post_id":"post-1"}`, Status: "pending", RunAt: now},
	}
	for _, model := range modelsToInsert {
		if _, err := db.NewInsert().Model(model).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
