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

func TestPublicationSharedPollPersistsExplicitDestinationVersions(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Job)(nil), (*models.Publication)(nil), (*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil), (*models.RenditionMedia)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	seedHandlerAccount(t, db, "x-account", "x")
	seedHandlerAccount(t, db, "bsky-account", "bluesky")
	seedHandlerAccount(t, db, "legacy-account", "x")
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	h := NewPublicationHandler(db, testAuthenticator{}, nil)
	h.RegisterRoutes(api)
	send := func(method, path string, body any) *httptest.ResponseRecorder {
		data, marshalErr := json.Marshal(body)
		require.NoError(t, marshalErr)
		req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}
	poll := map[string]any{"question": "Would you use this?", "options": []map[string]string{{"id": "yes", "text": "Yes, sometimes"}, {"id": "no", "text": "No"}}, "duration_seconds": 86400, "destinations": map[string]any{"x-account": map[string]string{"mode": "native"}}}
	create := CreatePublicationBody{WorkspaceID: "workspace-1", Title: "Poll", ContentProfile: "short_text", SourceText: "Help us plan.", Segments: []PublicationSegmentInput{{ID: "source", Body: "Help us plan.", Settings: map[string]any{"poll": poll}}}, SocialAccountIDs: []string{"x-account", "bsky-account"}}
	rec := send(http.MethodPost, "/api/v1/publications", create)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var publication PublicationResponse
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	rec = send(http.MethodGet, "/api/v1/publications/"+publication.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	require.Equal(t, "Would you use this?", publication.Segments[0].Settings["poll"].(map[string]any)["question"])
	for _, rendition := range publication.Renditions {
		require.Len(t, rendition.Segments, 1)
		segment := rendition.Segments[0]
		require.Nil(t, segment.BodyOverride)
		if rendition.Platform == "x" {
			require.Equal(t, "Help us plan.\n\nWould you use this?", segment.Body)
			require.Equal(t, "Yes, sometimes\nNo", segment.Settings["poll_options"])
		} else {
			require.Equal(t, "Help us plan.", segment.Body)
			require.NotContains(t, segment.Settings, "poll_options")
		}
	}
	issues, err := h.validatePublicationByIDWithDB(t.Context(), db, publication.ID)
	require.NoError(t, err)
	found := false
	for _, issue := range issues {
		if issue.Code == "poll_resolution_required" && issue.Provider == "bluesky" {
			found = true
		}
	}
	require.True(t, found, "unresolved omission must block publishing")
	// Resolve only Bluesky. The X poll and canonical text remain shared.
	poll["destinations"].(map[string]any)["bsky-account"] = map[string]string{"mode": "text"}
	update := PublicationUpdateBody{ExpectedRevision: publication.Revision, Segments: []PublicationSegmentInput{{ID: publication.Segments[0].ID, Body: "Help us plan.", Settings: map[string]any{"poll": poll}}}, Renditions: []RenditionInput{{SocialAccountID: "x-account"}, {SocialAccountID: "bsky-account"}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform == "bluesky" {
			require.Equal(t, "Help us plan.\n\nWould you use this?\n1. Yes, sometimes\n2. No", rendition.Segments[0].Body)
			require.NotContains(t, rendition.Segments[0].Settings, "poll_options")
		}
	}
	issues, err = h.validatePublicationByIDWithDB(t.Context(), db, publication.ID)
	require.NoError(t, err)
	for _, issue := range issues {
		require.NotEqual(t, "poll_resolution_required", issue.Code)
	}
	// A canonical-only API edit must refresh materialized output without replacing renditions.
	poll["question"] = "What should we build?"
	poll["destinations"].(map[string]any)["bsky-account"] = map[string]string{"mode": "omit"}
	update = PublicationUpdateBody{ExpectedRevision: publication.Revision, Segments: []PublicationSegmentInput{{ID: publication.Segments[0].ID, Body: "Updated intro.", Settings: map[string]any{"poll": poll}}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform == "x" {
			require.Equal(t, "Updated intro.\n\nWhat should we build?", rendition.Segments[0].Body)
		} else {
			require.Equal(t, "Updated intro.", rendition.Segments[0].Body)
		}
	}
	// A custom poll remains independent of subsequent shared edits.
	poll["destinations"].(map[string]any)["x-account"] = map[string]any{"mode": "custom", "poll": map[string]any{"question": "Personal question?", "options": []map[string]string{{"id": "first", "text": "One"}, {"id": "second", "text": "Two"}}, "duration_seconds": 300}}
	update.ExpectedRevision = publication.Revision
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.Platform != "x" {
			continue
		}
		require.Equal(t, "Updated intro.\n\nPersonal question?", rendition.Segments[0].Body)
		require.Equal(t, "One\nTwo", rendition.Segments[0].Settings["poll_options"])
		require.EqualValues(t, 5, rendition.Segments[0].Settings["poll_duration_minutes"])
	}

	// Existing independent poll settings remain owned by their destination.
	poll["destinations"].(map[string]any)["legacy-account"] = map[string]string{"mode": "legacy"}
	update.ExpectedRevision = publication.Revision
	update.Renditions = []RenditionInput{{SocialAccountID: "x-account"}, {SocialAccountID: "bsky-account"}, {SocialAccountID: "legacy-account", Segments: []RenditionSegmentInput{{PublicationSegmentID: publication.Segments[0].ID, Body: "Independent question?", Settings: map[string]any{"poll_options": "Old answer\nAnother answer", "poll_duration_minutes": 60}}}}}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	update.Renditions = nil
	// Removing the shared block removes generated text and provider poll settings.
	update.ExpectedRevision = publication.Revision
	update.Segments[0].Settings = map[string]any{}
	rec = send(http.MethodPut, "/api/v1/publications/"+publication.ID, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	publication = PublicationResponse{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &publication))
	for _, rendition := range publication.Renditions {
		if rendition.SocialAccountID == "legacy-account" {
			require.Equal(t, "Independent question?", rendition.Segments[0].Body)
			require.Equal(t, "Old answer\nAnother answer", rendition.Segments[0].Settings["poll_options"])
			continue
		}
		require.Equal(t, "Updated intro.", rendition.Segments[0].Body)
		require.NotContains(t, rendition.Segments[0].Settings, "poll_options")
	}
}
