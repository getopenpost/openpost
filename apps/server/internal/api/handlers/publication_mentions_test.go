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
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/publicationsource"
	"github.com/stretchr/testify/require"
)

func TestSavedMentionProjectionRoundTripDoesNotBecomeAnAuthoredOverride(t *testing.T) {
	for _, shape := range []string{"body", "segments"} {
		for _, mapping := range []string{"@guest_x", "@different"} {
			t.Run(shape+mapping, func(t *testing.T) {
				db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Job)(nil), (*models.Publication)(nil), (*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil), (*models.RenditionMedia)(nil))
				_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
				require.NoError(t, err)
				seedHandlerAccount(t, db, "x", "x")
				e := echo.New()
				api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
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

func TestPublicationMentionIdentitySurvivesLegacyEditsAndCountsInRevisions(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Job)(nil), (*models.Publication)(nil), (*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil), (*models.RenditionMedia)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	seedHandlerAccount(t, db, "bsky", "bluesky")
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)
	send := func(method, path string, body any) *httptest.ResponseRecorder {
		data, err := json.Marshal(body)
		require.NoError(t, err)
		request := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(data))
		request.Header.Set("Authorization", "Bearer web-token")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		return response
	}
	mentions := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 8, End: 14, Text: "@alice", Target: posttext.MentionTarget{Provider: "bluesky", Kind: "person", ID: "did:plc:ewvi7nxzyoun6zhxrhs64oiz", Handle: "alice.bsky.social"}}}}
	create := CreatePublicationBody{WorkspaceID: "workspace-1", Title: "Mentions", ContentProfile: "short_text", SourceText: "🚀 Hi @alice", Segments: []PublicationSegmentInput{{Body: "🚀 Hi @alice", Settings: map[string]any{"mentions": mentions}}}, SocialAccountIDs: []string{"bsky"}}
	response := send(http.MethodPost, "/api/v1/publications", create)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var publication PublicationResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &publication))
	read := func() PublicationResponse {
		response := send(http.MethodGet, "/api/v1/publications/"+publication.ID, nil)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var output PublicationResponse
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output))
		return output
	}
	publication = read()
	initialRevision := publication.Revision
	changed := "A 🚀 Hi @alice"
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID, PublicationUpdateBody{ExpectedRevision: publication.Revision, SourceText: &changed})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	publication = read()
	require.Greater(t, publication.Revision, initialRevision)
	stored, err := posttext.Read(publication.Segments[0].Settings)
	require.NoError(t, err)
	require.Equal(t, 10, stored.Spans[0].Start)
	require.Equal(t, 16, stored.Spans[0].End)
	require.Equal(t, mentions.Spans[0].Target.ID, stored.Spans[0].Target.ID)
	require.Equal(t, changed, publication.Renditions[0].Segments[0].Body, "canonical edits refresh inherited destination text")
	response = send(http.MethodPost, "/api/v1/publications/"+publication.ID+"/validate", map[string]any{})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "mention_choice_invalid", response.Body.String())

	unsafe := "A 🚀 Hi @alex"
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID, PublicationUpdateBody{ExpectedRevision: publication.Revision, SourceText: &unsafe})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	after := read()
	require.Equal(t, publication.Revision, after.Revision)
	require.Equal(t, changed, after.Segments[0].Body)
	stored.Spans[0].Target.ID = "did:plc:z72i7hdynmk6r22z27h6tvur"
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID, PublicationUpdateBody{ExpectedRevision: publication.Revision, Segments: []PublicationSegmentInput{{ID: publication.Segments[0].ID, Body: changed, Settings: map[string]any{"mentions": stored}}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	after = read()
	require.Greater(t, after.Revision, publication.Revision, "identity-only changes are authored revisions")
	require.Equal(t, changed, after.Segments[0].Body)

	publication = after
	override := "Prefix " + changed
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID+"/renditions", map[string]any{"expected_revision": publication.Revision, "renditions": []RenditionInput{{SocialAccountID: "bsky", Segments: []RenditionSegmentInput{{PublicationSegmentID: publication.Segments[0].ID, BodyOverride: &override}}}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	publication = read()
	own, err := posttext.Read(publication.Renditions[0].Segments[0].Settings)
	require.NoError(t, err)
	require.NotNil(t, own)
	require.Equal(t, override, publication.Renditions[0].Body, "the summary mirrors the first destination output")
	require.Equal(t, 17, own.Spans[0].Start)
	require.Equal(t, "did:plc:z72i7hdynmk6r22z27h6tvur", own.Spans[0].Target.ID, "legacy detachment snapshots the inherited stable identity")
	unsafeOverride := "Prefix A 🚀 Hi @alex"
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID+"/renditions", map[string]any{"expected_revision": publication.Revision, "renditions": []RenditionInput{{SocialAccountID: "bsky", Segments: []RenditionSegmentInput{{PublicationSegmentID: publication.Segments[0].ID, BodyOverride: &unsafeOverride}}}}})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.Equal(t, publication.Revision, read().Revision)

	seedHandlerAccount(t, db, "bsky-new", "bluesky")
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID+"/renditions", map[string]any{"expected_revision": publication.Revision, "renditions": []RenditionInput{{SocialAccountID: "bsky-new", Segments: []RenditionSegmentInput{{PublicationSegmentID: publication.Segments[0].ID, BodyOverride: &override}}}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	publication = read()
	for _, destination := range publication.Renditions {
		if destination.SocialAccountID == "bsky-new" {
			own, err = posttext.Read(destination.Segments[0].Settings)
		}
	}
	require.NoError(t, err)
	require.NotNil(t, own, "new account detachment retains the inherited selection")
	require.Equal(t, "did:plc:z72i7hdynmk6r22z27h6tvur", own.Spans[0].Target.ID)
	create.Title = "Malformed"
	create.Segments[0].Body = "short"
	response = send(http.MethodPost, "/api/v1/publications", create)
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count, "failed authoring leaves no partial publication")
	seedHandlerAccount(t, db, "linkedin", "linkedin")
	company := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 3, End: 7, Text: "Acme", Target: posttext.MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:123"}}}}
	first := "Hi Acme"
	canonical := []PublicationSegmentInput{{ID: "first", Body: first, Settings: map[string]any{"mentions": company}}, {ID: "tail", Body: "Tail"}}
	response = send(http.MethodPost, "/api/v1/publications", CreatePublicationBody{WorkspaceID: "workspace-1", Title: "Joined mentions", ContentProfile: "thread", SourceText: first, Segments: canonical, Renditions: []RenditionInput{{SocialAccountID: "linkedin", Segments: []RenditionSegmentInput{{PublicationSegmentID: "first", SourceOverrides: []publicationsource.RenditionSourceOverride{{PublicationSegmentID: "first", BodyOverride: &first, Mentions: company, MediaInherited: true}}}}}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &publication))
	publication = read()
	returned := publication.Renditions[0].Segments[0]
	inherited := returned.MediaInherited
	response = send(http.MethodPut, "/api/v1/publications/"+publication.ID+"/renditions", map[string]any{"expected_revision": publication.Revision, "renditions": []RenditionInput{{SocialAccountID: "linkedin", Segments: []RenditionSegmentInput{{PublicationSegmentID: returned.PublicationSegmentID, BodyOverride: returned.BodyOverride, MediaInherited: &inherited, SourceOverrides: returned.SourceOverrides, Settings: returned.Settings}}}}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	afterJoined := read()
	require.Equal(t, "Hi Acme\n\nTail", afterJoined.Renditions[0].Segments[0].Body)
	require.Equal(t, company, afterJoined.Renditions[0].Segments[0].SourceOverrides[0].Mentions)
	require.Nil(t, afterJoined.Renditions[0].Segments[0].Settings[posttext.SettingsKey], "joined selections remain per source")
	for _, legacyBody := range []string{"Custom announcement", "🚀 Hi @alice custom"} {
		create.Segments[0].Body = "🚀 Hi @alice"
		response = send(http.MethodPost, "/api/v1/publications", create)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &publication))
		// Pre-override publications stored independent destination text without an
		// explicit override. Simulate that persisted format, then use the public API.
		_, err = db.NewUpdate().Model((*models.RenditionSegment)(nil)).Set("body = ?", legacyBody).Set("body_override = NULL").Set("settings_json = ?", "{}").Where("rendition_id = ?", publication.Renditions[0].ID).Exec(t.Context())
		require.NoError(t, err)
		changed = "Prefix 🚀 Hi @alice"
		response = send(http.MethodPut, "/api/v1/publications/"+publication.ID, PublicationUpdateBody{ExpectedRevision: publication.Revision, SourceText: &changed})
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		publication = read()
		destination := publication.Renditions[0].Segments[0]
		require.Equal(t, legacyBody, destination.Body)
		require.NotNil(t, destination.BodyOverride, "legacy independence must have an explicit text owner")
		require.Equal(t, legacyBody, *destination.BodyOverride)
		require.Nil(t, destination.Settings[posttext.SettingsKey], "canonical selections must not leak into legacy text")
		response = send(http.MethodPost, "/api/v1/publications/"+publication.ID+"/validate", map[string]any{})
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.NotContains(t, response.Body.String(), "mention_choice_invalid")
	}
}

// TestPublicationMentionValidationSeparatesMetadataFromProviderSettings exercises
// persisted thread overrides through the same HTTP validation used by scheduling.
func TestPublicationMentionValidationSeparatesMetadataFromProviderSettings(t *testing.T) {
	for _, provider := range []string{"bluesky", "mastodon", "linkedin", "x"} {
		t.Run(provider, func(t *testing.T) {
			db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Job)(nil),
				(*models.Publication)(nil), (*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil),
				(*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil), (*models.RenditionMedia)(nil))
			_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
			require.NoError(t, err)
			seedHandlerAccount(t, db, "account", provider)
			_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("instance_url = ?", "https://mastodon.social").Where("id = ?", "account").Exec(t.Context())
			require.NoError(t, err)
			profile := models.ContentProfileThread
			output := provider + ".thread"
			if provider == "linkedin" {
				profile, output = models.ContentProfileShortText, "linkedin.post"
			}
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
			NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)
			send := func(path string, body any) *httptest.ResponseRecorder {
				data, err := json.Marshal(body)
				require.NoError(t, err)
				request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, bytes.NewReader(data))
				request.Header.Set("Authorization", "Bearer web-token")
				request.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				e.ServeHTTP(response, request)
				return response
			}
			for _, mode := range []string{"cleared", "selected", "wrong network", "wrong authority"} {
				if mode == "wrong authority" && provider != "mastodon" {
					continue
				}
				mentions := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{}}
				if mode != "cleared" {
					target := posttext.MentionTarget{Provider: "bluesky", Kind: "person", ID: "did:plc:ewvi7nxzyoun6zhxrhs64oiz"}
					if mode != "wrong network" {
						switch provider {
						case "mastodon":
							target = posttext.MentionTarget{Provider: provider, Kind: "person", ID: "123", Handle: "alice", Authority: "https://mastodon.social"}
							if mode == "wrong authority" {
								target.Authority = "https://other.example"
							}
						case "linkedin":
							target = posttext.MentionTarget{Provider: provider, Kind: "page", ID: "urn:li:organization:123"}
						}
					} else if provider == "bluesky" {
						target = posttext.MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:123"}
					}
					mentions.Spans = []posttext.MentionSpan{{Start: 3, End: 9, Text: "@alice", Target: target}}
				}
				body := "Hi @alice"
				if mode == "cleared" {
					body = "Thanks for the idea!"
				}
				destinationSegments := []RenditionSegmentInput{{
					PublicationSegmentID: "first", BodyOverride: &body, Settings: map[string]any{"mentions": mentions},
				}}
				if profile == models.ContentProfileThread {
					destinationSegments = append(destinationSegments, RenditionSegmentInput{PublicationSegmentID: "tail"})
				}
				response := send("/api/v1/publications", CreatePublicationBody{
					WorkspaceID: "workspace-1", Title: "Mention validation", ContentProfile: models.ContentProfileThread,
					Segments:   []PublicationSegmentInput{{ID: "first", Body: body}, {ID: "tail", Body: "Tail"}},
					Renditions: []RenditionInput{{SocialAccountID: "account", Profile: profile, OutputProfile: output, Segments: destinationSegments}},
				})
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var publication PublicationResponse
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &publication))
				response = send("/api/v1/publications/"+publication.ID+"/validate", map[string]any{})
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var result struct {
					Issues []capabilities.ValidationIssue `json:"issues"`
				}
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
				invalidMention := false
				for _, issue := range result.Issues {
					require.False(t, issue.Code == "unsupported_setting" && issue.Field == "mentions", issue.Message)
					invalidMention = invalidMention || issue.Code == "mention_choice_invalid"
				}
				wantInvalid := mode == "wrong network" || mode == "wrong authority" || mode == "selected" && provider == "x"
				require.Equal(t, wantInvalid, invalidMention, "%s: %s", mode, response.Body.String())
			}
		})
	}
}

func TestCrossProviderCaptionStillRejectedWithoutUnsupportedSetting(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil),
		(*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil), (*models.MediaAttachment)(nil), (*models.SocialAccount)(nil))
	for _, row := range []any{
		&models.Publication{ID: "pub", WorkspaceID: "ws-1", CreatedByID: "user-1", ContentProfile: models.ContentProfileLongVideo, Status: models.PublicationStatusDraft},
		&models.SocialAccount{ID: "account", WorkspaceID: "ws-1", Platform: "youtube", AccountID: "yt-user", AccessTokenEnc: []byte("token"), IsActive: true},
		&models.PublicationSegment{ID: "source", PublicationID: "pub", Body: "Hello"},
		&models.Rendition{ID: "rendition", PublicationID: "pub", SocialAccountID: "account", Platform: "youtube", Profile: models.ContentProfileLongVideo, OutputProfile: "youtube.video", Status: models.RenditionStatusDraft},
		&models.RenditionSegment{ID: "segment", RenditionID: "rendition", PublicationSegmentID: "source", Body: "Hello", SettingsJSON: `{"caption_mentions":{"field":"video_description","body":"Hello","mentions":{"version":1,"spans":[]}}}`},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	handler := &PublicationHandler{db: db}
	issues, err := handler.validatePublicationByIDWithDB(t.Context(), db, "pub")
	require.NoError(t, err)
	requirePublicationIssueCode(t, issues, "mention_choice_invalid")
	for _, issue := range issues {
		require.False(t, issue.Code == "unsupported_setting" && issue.Field == "caption_mentions", "cross-provider caption must not be reported as an unknown provider setting: %#v", issue)
	}
}

func TestNativeCaptionLegacyClearAndProjectionEcho(t *testing.T) {
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
