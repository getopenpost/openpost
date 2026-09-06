//go:build dev

package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	_ "github.com/uptrace/bun/driver/sqliteshim"
)

type e2eProjectionAuthenticator struct{}

func (e2eProjectionAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if token == "scoped-owner" {
		return &middleware.Principal{UserID: "owner-1", WorkspaceID: "workspace-2"}, nil
	}
	return &middleware.Principal{UserID: token}, nil
}

func TestE2EDeliveryProjectionPersistsAuthorizedStateAndRejectsOutsiders(t *testing.T) {
	sqlDB, err := sql.Open("sqliteshim", "file:e2e-delivery-projection?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationAuthorization)(nil),
		(*models.ProviderWriteAttempt)(nil),
		(*models.ProviderDelivery)(nil),
		(*models.PublicationLifecycleEvent)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "owner-1", Role: models.WorkspaceRoleAdmin,
		Status: models.WorkspaceMemberStatusActive,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "viewer-1", Role: models.WorkspaceRoleViewer,
		Status: models.WorkspaceMemberStatusActive,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "owner-1",
		Status: models.PublicationStatusScheduled,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
		TargetKey: "mastodon", Platform: "mastodon", Status: models.RenditionStatusScheduled,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationAuthorization{
		ID: "authorization-1", BatchID: "batch-1", WorkspaceID: "workspace-1",
		PublicationID: "publication-1", RenditionID: "rendition-1", Action: "publish",
		ActorOrigin: "browser", ActorUserID: "owner-1", PublicationRevision: 1,
		SocialAccountID: "account-1", TargetKey: "mastodon", ScheduledAt: time.Now().UTC(),
		ContentHash: "sha256:content", MediaHash: "sha256:media", SettingsHash: "sha256:settings",
		PolicyMode: "explicit", ExecutionIntent: "production", ConfirmedAt: time.Now().UTC(),
		CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	NewE2EDeliveryProjectionHandler(db, e2eProjectionAuthenticator{}).RegisterRoutes(e)

	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/e2e/publications/publication-1/delivery", strings.NewReader(`{"state":"rejected","attempt_number":6}`))
	request.Header.Set(echo.HeaderAuthorization, "Bearer owner-1")
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	var delivery models.ProviderDelivery
	require.NoError(t, db.NewSelect().Model(&delivery).Where("rendition_id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, "rejected", delivery.State)
	require.Equal(t, "safe", delivery.RetrySafety)
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(t.Context()))
	require.Equal(t, models.PublicationStatusFailed, publication.Status)

	request = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/e2e/publications/publication-1/delivery", strings.NewReader(`{"state":"live","attempt_number":7}`))
	request.Header.Set(echo.HeaderAuthorization, "Bearer outsider-1")
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	response = httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())

	for _, token := range []string{"viewer-1", "scoped-owner"} {
		request = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/e2e/publications/publication-1/delivery", strings.NewReader(`{"state":"live","attempt_number":8}`))
		request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
		request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		response = httptest.NewRecorder()
		e.ServeHTTP(response, request)
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	}
}
