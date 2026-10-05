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

func TestPublicationLinkInheritanceFollowsAccountTextAndCanonicalUpdates(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Job)(nil), (*models.Publication)(nil), (*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil), (*models.RenditionMedia)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	seedHandlerAccount(t, db, "x-account", "x")
	seedHandlerAccount(t, db, "bsky-account", "bluesky")
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	h := NewPublicationHandler(db, testAuthenticator{}, nil)
	h.RegisterRoutes(api)
	send := func(method, path string, body any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}
	link := map[string]any{"destinations": map[string]any{"bsky-account": map[string]any{"mode": "post"}, "x-account": map[string]any{"mode": "custom", "url": "https://custom.example/card"}}}
	create := CreatePublicationBody{WorkspaceID: "workspace-1", ContentProfile: "short_text", SourceText: "Shared https://shared.example/a", Segments: []PublicationSegmentInput{{ID: "source", Body: "Shared https://shared.example/a", Settings: map[string]any{"link": link}}}, SocialAccountIDs: []string{"bsky-account", "x-account"}}
	rec := send(http.MethodPost, "/api/v1/publications", create)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var publication PublicationResponse
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	rec = send(http.MethodGet, "/api/v1/publications/"+publication.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform == "bluesky" {
			require.Equal(t, "https://shared.example/a", rendition.Segments[0].Settings["link_url"])
		}
		if rendition.Platform == "x" {
			require.Equal(t, "https://custom.example/card", rendition.Segments[0].Settings["url"])
		}
	}
	body := "Account https://account.example/b"
	update := PublicationUpdateBody{ExpectedRevision: publication.Revision, Renditions: []RenditionInput{{SocialAccountID: "bsky-account", Segments: []RenditionSegmentInput{{PublicationSegmentID: publication.Segments[0].ID, Body: body, BodyOverride: &body}}}, {SocialAccountID: "x-account"}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform == "bluesky" {
			require.Equal(t, "https://account.example/b", rendition.Segments[0].Settings["link_url"])
		}
	}
	update = PublicationUpdateBody{ExpectedRevision: publication.Revision, Segments: []PublicationSegmentInput{{ID: publication.Segments[0].ID, Body: "Shared https://shared.example/c", Settings: map[string]any{"link": link}}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = send(http.MethodGet, "/api/v1/publications/"+publication.ID, nil)
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform == "bluesky" {
			require.Equal(t, "https://account.example/b", rendition.Segments[0].Settings["link_url"])
		}
		if rendition.Platform == "x" {
			require.Equal(t, "https://custom.example/card", rendition.Segments[0].Settings["url"])
		}
	}
	// A destination quote suppresses inherited cards at persistence and validation.
	update = PublicationUpdateBody{ExpectedRevision: publication.Revision, Renditions: []RenditionInput{{SocialAccountID: "bsky-account", Settings: map[string]any{"quote_url": "https://bsky.app/profile/person.test/post/abc"}}, {SocialAccountID: "x-account"}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform == "bluesky" {
			require.Empty(t, rendition.Segments[0].Settings["link_url"])
		}
	}
	// Removing canonical ownership removes its generated native URI values.
	update = PublicationUpdateBody{ExpectedRevision: publication.Revision, Segments: []PublicationSegmentInput{{ID: publication.Segments[0].ID, Body: "Shared https://shared.example/c"}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		require.Empty(t, rendition.Segments[0].Settings["url"])
		require.Empty(t, rendition.Segments[0].Settings["link_url"])
	}
}
