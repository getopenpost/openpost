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
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/publicationsource"
	"github.com/stretchr/testify/require"
)

func TestSavedMentionProjectionRoundTripDoesNotBecomeAnAuthoredOverride(t *testing.T) {
	t.Parallel()
	for _, shape := range []string{"body", "segments"} {
		for _, mapping := range []string{"@guest_x", "@different"} {
			t.Run(shape+mapping, func(t *testing.T) {
				db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Job)(nil), (*models.Publication)(nil), (*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil), (*models.RenditionMedia)(nil))
				_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
				require.NoError(t, err)
				seedHandlerAccount(t, db, "x")
				e := echo.New()
				api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
				NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)
				call := func(method, path string, body any) *httptest.ResponseRecorder {
					data, err := json.Marshal(body)
					require.NoError(t, err)
					req := httptest.NewRequestWithContext(t.Context(), method, "/api/v1"+path, bytes.NewReader(data))
					req.Header.Set("Authorization", "Bearer web-token")
					req.Header.Set("Content-Type", "application/json")
					out := httptest.NewRecorder()
					e.ServeHTTP(out, req)
					return out
				}
				mentions := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 3, End: 9, Text: "@guest", Target: posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: "saved", Profiles: []posttext.MentionProfile{{Provider: "x", Text: mapping}}}}}}
				created := call(http.MethodPost, "/publications", CreatePublicationBody{WorkspaceID: "workspace-1", Title: "Saved mention", ContentProfile: "short_text", SourceText: "Hi @guest", Segments: []PublicationSegmentInput{{Body: "Hi @guest", Settings: map[string]any{"mentions": mentions}}}, SocialAccountIDs: []string{"x"}})
				require.Equal(t, http.StatusOK, created.Code, created.Body.String())
				var publication PublicationResponse
				require.NoError(t, json.Unmarshal(created.Body.Bytes(), &publication))
				read := call(http.MethodGet, "/publications/"+publication.ID, nil)
				require.Equal(t, http.StatusOK, read.Code, read.Body.String())
				require.NoError(t, json.Unmarshal(read.Body.Bytes(), &publication))
				require.Equal(t, "Hi "+mapping, publication.Renditions[0].Body)
				rendition := map[string]any{"social_account_id": "x", "body": publication.Renditions[0].Body}
				if shape == "segments" {
					rendition["segments"] = []map[string]any{{"publication_segment_id": publication.Segments[0].ID, "body": publication.Renditions[0].Segments[0].Body}}
				}
				updated := call(http.MethodPut, "/publications/"+publication.ID+"/renditions", map[string]any{"expected_revision": publication.Revision, "renditions": []map[string]any{rendition}})
				require.Equal(t, http.StatusOK, updated.Code, updated.Body.String())
				read = call(http.MethodGet, "/publications/"+publication.ID, nil)
				require.NoError(t, json.Unmarshal(read.Body.Bytes(), &publication))
				require.Nil(t, publication.Renditions[0].Segments[0].BodyOverride)
				require.Equal(t, "Hi "+mapping, publication.Renditions[0].Body)
			})
		}
	}
}

func TestNativeCaptionLegacyClearAndProjectionEcho(t *testing.T) {
	t.Parallel()
	caption := &publicationsource.CaptionMentions{Field: "description", Body: "Hi @alice", Mentions: &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 3, End: 9, Text: "@alice", Target: posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: "caption-person", Profiles: []posttext.MentionProfile{{Provider: "youtube", Text: "@alice_video"}}}}}}}
	data, err := json.Marshal(map[string]any{publicationsource.CaptionMentionsKey: caption})
	require.NoError(t, err)
	old := models.RenditionSegment{SettingsJSON: string(data)}
	account := models.SocialAccount{Platform: "youtube"}
	t.Run("replacement cannot silently discard selected caption identities", func(t *testing.T) {
		require.ErrorIs(t, preserveRenditionSegmentMentions(&RenditionInput{}, []models.RenditionSegment{old}, nil, account), posttext.ErrMetadataRequired)
	})
	for _, actual := range []string{"", "Hi @alice_video"} {
		input := &RenditionInput{Settings: map[string]any{"description": actual}}
		next := &RenditionSegmentInput{Description: actual}
		require.NoError(t, preserveCaptionMentionInput(input, next, old, account))
		kept, err := publicationsource.ReadCaptionMentions(next.Settings)
		require.NoError(t, err)
		if actual == "" {
			require.Empty(t, kept.Body)
			require.Empty(t, kept.Mentions.Spans)
			require.Equal(t, "", input.Settings["description"])
		} else {
			require.Equal(t, "Hi @alice", kept.Body)
			require.Equal(t, "caption-person", kept.Mentions.Spans[0].Target.ID)
			require.Equal(t, 3, kept.Mentions.Spans[0].Start)
			require.Equal(t, "Hi @alice", input.Settings["description"])
		}
	}
}
