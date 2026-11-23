package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCloudVideoProjectReadsPreserveStoredDocumentValues(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	const document = `{"timeline":{"items":[]},"metadata":{"source_id":9007199254740993,"caption":"<launch> & \u2028"}}`
	project := &models.VideoProject{ID: "stored", WorkspaceID: "ws-1", Name: "Stored", DocumentJSON: document}
	_, err := server.db.NewInsert().Model(project).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.VideoProjectRevision{
		ID: "revision", ProjectID: project.ID, Revision: 1, Kind: "create", DocumentJSON: document,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.VideoProjectConflict{
		ID: "conflict", ProjectID: project.ID, Name: "Conflicting edit", DocumentJSON: document, OverlapTargetsJSON: "[]",
	}).Exec(t.Context())
	require.NoError(t, err)

	for _, path := range []string{
		"/api/v1/video-projects/stored", "/api/v1/video-projects",
		"/api/v1/video-projects/stored/conflicts", "/api/v1/video-projects/stored/revisions",
	} {
		t.Run(path, func(t *testing.T) {
			response := server.request(t, "viewer-token", http.MethodGet, path+"?workspace_id=ws-1", nil)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			type projectDocument struct {
				Document struct {
					Metadata struct {
						SourceID json.Number `json:"source_id"`
						Caption  string      `json:"caption"`
					} `json:"metadata"`
				} `json:"document"`
			}
			var payload projectDocument
			if path == "/api/v1/video-projects/stored" {
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload))
			} else {
				var rows []projectDocument
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &rows))
				require.Len(t, rows, 1)
				payload = rows[0]
			}
			require.Equal(t, "9007199254740993", payload.Document.Metadata.SourceID.String())
			require.Equal(t, "<launch> & \u2028", payload.Document.Metadata.Caption)
		})
	}
}

func TestCloudVideoProjectReadsRejectCorruptStoredDocuments(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	for _, document := range []string{"", "{", "[]", "true", "12", `"wrong"`, `{"tail":}`, "\u00a0{}", "{}\v"} {
		t.Run(document, func(t *testing.T) {
			_, err := server.db.NewInsert().Model(&models.VideoProject{
				ID: "invalid", WorkspaceID: "ws-1", Name: "Stored", DocumentJSON: document,
			}).On("CONFLICT (id) DO UPDATE").Set("document_json = EXCLUDED.document_json").Exec(t.Context())
			require.NoError(t, err)
			response := server.request(t, "viewer-token", http.MethodGet, "/api/v1/video-projects/invalid?workspace_id=ws-1", nil)
			require.Equal(t, http.StatusInternalServerError, response.Code, response.Body.String())
		})
	}
}

func TestCloudVideoProjectDocumentSchemaRemainsAnOpenObject(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	response := server.request(t, "viewer-token", http.MethodGet, "/api/v1/openapi.json", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var spec struct {
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &spec))
	for _, name := range []string{"VideoProjectResponse", "VideoProjectConflictResponse", "VideoProjectRevisionResponse"} {
		require.JSONEq(t, `{"type":"object","additionalProperties":{}}`, string(spec.Components.Schemas[name].Properties["document"]), name)
	}
}
