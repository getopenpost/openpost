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

func TestUpdatePublicationReordersAndReplacesThreadSegments(t *testing.T) {
	for _, operation := range []string{"reorder", "remove first", "insert first", "replace all"} {
		t.Run(operation, func(t *testing.T) {
			db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Publication)(nil), (*models.RenditionMedia)(nil), (*models.Job)(nil))
			_, err := db.ExecContext(t.Context(), `CREATE UNIQUE INDEX publication_segments_position_idx ON publication_segments (publication_id, position)`)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
			require.NoError(t, err)
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)
			request := func(method, path string, body any) PublicationResponse {
				t.Helper()
				data, err := json.Marshal(body)
				require.NoError(t, err)
				req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(data))
				req.Header.Set("Authorization", "Bearer web-token")
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
				var result PublicationResponse
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
				return result
			}
			original := request(http.MethodPost, "/api/v1/publications", map[string]any{
				"workspace_id": "workspace-1", "title": "Thread", "content_profile": "thread", "intent": "thread", "source_text": "First",
				"segments": []PublicationSegmentInput{{Body: "First"}, {Body: "Second"}},
			})
			first := PublicationSegmentInput{ID: original.Segments[0].ID, Body: "First"}
			second := PublicationSegmentInput{ID: original.Segments[1].ID, Body: "Second"}
			var inputs []PublicationSegmentInput
			switch operation {
			case "reorder":
				inputs = []PublicationSegmentInput{second, first}
			case "remove first":
				inputs = []PublicationSegmentInput{second}
			case "insert first":
				inputs = []PublicationSegmentInput{{Body: "New"}, first, second}
			case "replace all":
				inputs = []PublicationSegmentInput{{Body: "Replacement"}}
			}
			updated := request(http.MethodPut, "/api/v1/publications/"+original.ID, map[string]any{
				"expected_revision": original.Revision, "segments": inputs,
			})
			require.Equal(t, original.Revision+1, updated.Revision)
			stored := request(http.MethodGet, "/api/v1/publications/"+original.ID, nil)
			require.Len(t, stored.Segments, len(inputs))
			for position, input := range inputs {
				require.Equal(t, input.Body, stored.Segments[position].Body)
				require.Equal(t, position, stored.Segments[position].Position)
				if input.ID != "" {
					require.Equal(t, input.ID, stored.Segments[position].ID)
				}
			}
		})
	}
}
