package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestListMediaRecentlyUsedReturnsReadyWorkspaceImages(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.PublicationAsset)(nil),
		(*models.RenditionMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignRevisionMediaReference)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.BrandFont)(nil),
		(*models.MediaTagAssignment)(nil),
	)
	now := time.Date(2026, time.August, 29, 0, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.User{ID: "user-1", Email: "user@example.com", CreatedAt: now},
		&models.Workspace{ID: "ws-1", Name: "Launch", CreatedAt: now},
		&models.WorkspaceMember{
			WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
		},
		&models.MediaAttachment{
			ID: "image-1", WorkspaceID: "ws-1", FilePath: "image-1.png",
			StorageType: "local", MimeType: "image/png", DominantType: "image",
			ProcessingStatus: "ready", AnalysisStatus: "ready", Size: 4,
			OriginalFilename: "image-1.png", AssetKind: "library",
			RetentionClass: "library", CreatedAt: now,
		},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewMediaHandler(db, nil, nil, testAuthenticator{}, nil).RegisterRoutes(api)
	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/media?workspace_id=ws-1&type=image&asset_kind=library&sort=recently_used&limit=100",
		nil,
	)
	request.Header.Set("Authorization", "Bearer web-token")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Media []MediaListItem `json:"media"`
		Total int             `json:"total"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Equal(t, 1, body.Total)
	require.Len(t, body.Media, 1)
	require.Equal(t, "image-1", body.Media[0].ID)
}
