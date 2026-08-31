package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type publicationBuildTestBuilder struct{}

func (publicationBuildTestBuilder) Build(
	context.Context,
	publicationbuilder.BuildInput,
) (publicationbuilder.BuildResult, error) {
	return publicationbuilder.BuildResult{}, nil
}

type publicationBuildPublicationStub struct {
	publication publicationservice.Publication
	createCalls int
}

func (stub *publicationBuildPublicationStub) Get(
	_ context.Context,
	_ string,
	id string,
) (publicationservice.Publication, error) {
	if stub.publication.ID == id {
		return stub.publication, nil
	}
	return publicationservice.Publication{}, publicationservice.NewError(
		publicationservice.ErrorNotFound,
		errors.New("not found"),
	)
}

func (stub *publicationBuildPublicationStub) CreateFromBuild(
	_ context.Context,
	_ string,
	buildID string,
	command publicationservice.CreateCommand,
	_ []string,
) (publicationservice.Publication, error) {
	stub.createCalls++
	stub.publication = publicationservice.Publication{ID: "build:" + buildID, WorkspaceID: command.WorkspaceID}
	return stub.publication, nil
}

type publicationBuildTestAuthenticator struct{}

func (publicationBuildTestAuthenticator) AuthenticateBearer(
	_ context.Context,
	token string,
) (*middleware.Principal, error) {
	switch token {
	case "web-token":
		return &middleware.Principal{UserID: "user-1", Email: "one@example.com", SessionID: "session-1"}, nil
	case "other-user-token":
		return &middleware.Principal{UserID: "user-2", Email: "two@example.com", SessionID: "session-2"}, nil
	case "foreign-workspace-token":
		return &middleware.Principal{
			UserID: "user-1", Email: "one@example.com", SessionID: "session-1", WorkspaceID: "ws-2",
		}, nil
	default:
		return nil, apitokens.ErrInvalidToken
	}
}

func TestPublicationBuildCreateRejectsForeignAccountAndVoiceProfile(t *testing.T) {
	server := newPublicationBuildTestServer(t)

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids": []string{"foreign-account"},
	}), "foreign-account-request", "web-token")
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())

	response = server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids":      []string{"account-x"},
		"voice_profile_id": "default:ws-2",
	}), "foreign-profile-request", "web-token")
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())

	count, err := server.db.NewSelect().Model((*publicationbuilder.BuildRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestPublicationBuildCreateUsesSocialSetSubsetCapabilitiesAndStoredAuthority(t *testing.T) {
	server := newPublicationBuildTestServer(t)

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids":   []string{"account-x"},
		"social_set_id": "founder-set",
		"direction": map[string]any{
			"outcome": "Start a technical discussion",
			"angle":   "Show the deleted code and the simpler result",
		},
	}), "social-set-subset", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	build := decodePublicationBuild(t, response)
	require.Len(t, build.Input.Destinations, 1)
	destination := build.Input.Destinations[0]
	require.Equal(t, "account-x", destination.AccountID)
	require.Equal(t, capabilities.ProviderX, destination.Platform)
	require.Equal(t, "x.thread", destination.AllowedOutputProfiles[0].Key, "Social Set format should lead its frozen allowlist")
	require.Equal(t, "default:ws-1", destination.Voice.ID)

	require.Equal(t, platform.XStandardTextLimit, destination.AllowedOutputProfiles[0].TextLimit)
	require.Equal(t, maxPublicationBuildThreadSegments, destination.AllowedOutputProfiles[0].MaxSegments)
	require.Equal(t, 4, destination.AllowedOutputProfiles[0].MediaMaxCount)
	require.Contains(t, destination.AllowedOutputProfiles[0].AllowedMIMEs, "image/png")
	require.NotContains(t, destination.AllowedOutputProfiles[0].AllowedMIMEs, "application/pdf")

	var record publicationbuilder.BuildRecord
	require.NoError(t, server.db.NewSelect().Model(&record).Where("id = ?", build.ID).Scan(t.Context()))
	var authority workspaceaccess.StoredAuthority
	require.NoError(t, json.Unmarshal([]byte(record.AuthorityJSON), &authority))
	require.Equal(t, "org-1", authority.OrganizationID)
	require.Empty(t, authority.IdentityProviderID)
	require.Equal(t, "user-1", authority.UserID)

	response = server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids":   []string{"account-outside-set"},
		"social_set_id": "founder-set",
	}), "invalid-social-set-subset", "web-token")
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
}

func TestPublicationBuildOutputProfilesFreezeLiveMastodonInstanceLimits(t *testing.T) {
	account := models.SocialAccount{
		ID: "mastodon-account", Platform: capabilities.ProviderMastodon, InstanceURL: "https://social.example",
	}
	resolver := NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
		capabilities.ProviderMastodon + ":" + account.InstanceURL: xCapabilityResolverAdapter{result: platform.AccountCapabilityResult{
			Revision: "mastodon-instance-1",
			Constraints: map[string]any{
				"text_limit":      1_337,
				"media_max_count": 7,
				"allowed_mimes":   []string{"image/png", "video/webm"},
			},
		}},
	}, capabilityResolverTokenSource{})
	handler := NewPublicationBuildHandler(nil, publicationBuildTestAuthenticator{}, nil)
	handler.SetCapabilityResolver(resolver)

	profiles := handler.publicationBuildOutputProfiles(t.Context(), account, "")
	require.NotEmpty(t, profiles)
	require.Equal(t, 1_337, profiles[0].TextLimit)
	require.Equal(t, 7, profiles[0].MediaMaxCount)
	require.Equal(t, []string{"image/png", "video/webm"}, profiles[0].AllowedMIMEs)
}

func TestPublicationBuildOutputProfilesFollowLiveXSubscriptionLimits(t *testing.T) {
	tests := []struct {
		name             string
		subscriptionType string
		textLimit        int
	}{
		{name: "unknown", subscriptionType: platform.XSubscriptionTypeUnknown, textLimit: platform.XStandardTextLimit},
		{name: "none", subscriptionType: platform.XSubscriptionTypeNone, textLimit: platform.XStandardTextLimit},
		{name: "basic", subscriptionType: platform.XSubscriptionTypeBasic, textLimit: platform.XPremiumTextLimit},
		{name: "premium", subscriptionType: platform.XSubscriptionTypePremium, textLimit: platform.XPremiumTextLimit},
		{name: "premium plus", subscriptionType: platform.XSubscriptionTypePremiumPlus, textLimit: platform.XPremiumTextLimit},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			account := models.SocialAccount{ID: "x-account", Platform: capabilities.ProviderX}
			resolver := NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
				capabilities.ProviderX: xCapabilityResolverAdapter{
					result: platform.XPublishingCapabilities(test.subscriptionType),
				},
			}, capabilityResolverTokenSource{})
			handler := NewPublicationBuildHandler(nil, publicationBuildTestAuthenticator{}, nil)
			handler.SetCapabilityResolver(resolver)

			profiles := handler.publicationBuildOutputProfiles(t.Context(), account, "")
			require.NotEmpty(t, profiles)
			for _, profile := range profiles {
				require.Equal(t, test.textLimit, profile.TextLimit, profile.Key)
			}
		})
	}
}

func TestPublicationBuildCreateKeepsNonNativeCandidatesForBasicAdaptation(t *testing.T) {
	server := newPublicationBuildTestServer(t)

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids": []string{"account-x", "account-instagram"},
	}), "mixed-native-candidates", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	build := decodePublicationBuild(t, response)
	require.Len(t, build.Input.Destinations, 2)
	require.Equal(t, capabilities.ProviderInstagram, build.Input.Destinations[1].Platform)

	unsupportedOnly := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"account_ids": []string{"account-instagram"},
	}), "unsupported-only-candidates", "web-token")
	require.Equal(t, http.StatusOK, unsupportedOnly.Code, unsupportedOnly.Body.String())
	require.Equal(t, capabilities.ProviderInstagram, decodePublicationBuild(t, unsupportedOnly).Input.Destinations[0].Platform)
}

func TestPublicationBuildCreateReturnsSameBuildAndRejectsIdempotencyConflict(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	request := publicationBuildRequest(nil)

	firstResponse := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", request, "stable-build-request", "web-token",
	)
	require.Equal(t, http.StatusOK, firstResponse.Code, firstResponse.Body.String())
	first := decodePublicationBuild(t, firstResponse)

	repeatedResponse := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", request, "stable-build-request", "web-token",
	)
	require.Equal(t, http.StatusOK, repeatedResponse.Code, repeatedResponse.Body.String())
	require.Equal(t, first.ID, decodePublicationBuild(t, repeatedResponse).ID)

	changed := publicationBuildRequest(map[string]any{"idea": "A different product change"})
	conflict := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", changed, "stable-build-request", "web-token",
	)
	require.Equal(t, http.StatusConflict, conflict.Code, conflict.Body.String())

	count, err := server.db.NewSelect().Model((*publicationbuilder.BuildRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestPublicationBuildCreateBoundsPerUserBursts(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	for range publicationBuildRequestsPerMinute {
		require.True(t, server.handler.limiter.Allow(
			"publication-build:create:user-1",
			publicationBuildRequestsPerMinute,
			time.Minute,
		))
	}

	response := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "rate-limited-build", "web-token",
	)

	require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
	count, err := server.db.NewSelect().Model((*publicationbuilder.BuildRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestPublicationBuildCreateEnforcesDurableActiveBuildLimit(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	for index := range 3 {
		response := server.request(
			t,
			http.MethodPost,
			"/api/v1/publication-builds",
			publicationBuildRequest(nil),
			fmt.Sprintf("active-build-%d", index),
			"web-token",
		)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	}

	response := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "active-build-limit", "web-token",
	)

	require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
}

func TestPublicationBuildRetryEnforcesDurableActiveBuildLimit(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	failedResponse := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "failed-build", "web-token",
	)
	require.Equal(t, http.StatusOK, failedResponse.Code, failedResponse.Body.String())
	failed := decodePublicationBuild(t, failedResponse)
	_, err := server.db.NewUpdate().Model((*publicationbuilder.BuildRecord)(nil)).
		Set("state = ?", publicationbuilder.BuildStateFailed).
		Set("phase = ?", publicationbuilder.BuildPhaseFailed).
		Where("id = ?", failed.ID).
		Exec(t.Context())
	require.NoError(t, err)
	for index := range 3 {
		response := server.request(
			t,
			http.MethodPost,
			"/api/v1/publication-builds",
			publicationBuildRequest(nil),
			fmt.Sprintf("retry-active-%d", index),
			"web-token",
		)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	}

	retry := server.request(
		t, http.MethodPost, "/api/v1/publication-builds/"+failed.ID+"/retry", nil, "", "web-token",
	)

	require.Equal(t, http.StatusTooManyRequests, retry.Code, retry.Body.String())
}

func TestPublicationBuildCreateStoresReferencesWithoutFetchingThem(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	var fetches atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		fetches.Add(1)
	}))
	t.Cleanup(remote.Close)

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"idea":         "",
		"context_urls": []string{remote.URL + "/source"},
		"assets": []map[string]any{{
			"media_id": "media-1", "role": "evidence", "may_publish": false,
		}},
	}), "source-reference-request", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Zero(t, fetches.Load(), "the HTTP request path must not fetch source URLs")
	build := decodePublicationBuild(t, response)
	require.Equal(t, []string{remote.URL + "/source"}, build.ContextURLs)
	require.Equal(t, []publicationbuilder.BuildAsset{{
		MediaID: "media-1", Role: "evidence", MayPublish: false,
	}}, build.Assets)
	require.Empty(t, build.Input.Sources, "stored references must not create fake source rows")

	foreign := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"assets": []map[string]any{{"media_id": "foreign-media", "role": "context", "may_publish": false}},
	}), "foreign-media-request", "web-token")
	require.Equal(t, http.StatusBadRequest, foreign.Code, foreign.Body.String())
}

func TestPublicationBuildCreateAcceptsMultilineContextNotes(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	contextNotes := "What changed:\n- Removed the setup step\n- Kept the existing workflow"

	response := server.request(t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(map[string]any{
		"context_notes":       contextNotes,
		"context_may_publish": true,
	}), "multiline-context-notes", "web-token")

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	build := decodePublicationBuild(t, response)
	require.Equal(t, []publicationbuilder.SourceMaterial{{
		ID: "context:notes", Kind: "text", Label: "Additional context", Text: contextNotes, Publishable: true,
	}}, build.Input.Sources)
}

func TestPublicationBuildGetRequiresCreatorOwnership(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	created := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "owned-build-request", "web-token",
	)
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	build := decodePublicationBuild(t, created)

	owned := server.request(t, http.MethodGet, "/api/v1/publication-builds/"+build.ID, nil, "", "web-token")
	require.Equal(t, http.StatusOK, owned.Code, owned.Body.String())

	foreign := server.request(t, http.MethodGet, "/api/v1/publication-builds/"+build.ID, nil, "", "other-user-token")
	require.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())

	wrongCredentialScope := server.request(t, http.MethodGet, "/api/v1/publication-builds/"+build.ID, nil, "", "foreign-workspace-token")
	require.Equal(t, http.StatusForbidden, wrongCredentialScope.Code, wrongCredentialScope.Body.String())
}

func TestPublicationBuildCancelAndRetryUseDurableApplicationState(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	created := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "state-actions-request", "web-token",
	)
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	build := decodePublicationBuild(t, created)

	cancelledResponse := server.request(
		t, http.MethodPost, "/api/v1/publication-builds/"+build.ID+"/cancel", nil, "", "web-token",
	)
	require.Equal(t, http.StatusOK, cancelledResponse.Code, cancelledResponse.Body.String())
	require.Equal(t, publicationbuilder.BuildStateCancelled, decodePublicationBuild(t, cancelledResponse).State)

	_, err := server.db.NewUpdate().Model((*publicationbuilder.BuildRecord)(nil)).
		Set("state = ?", publicationbuilder.BuildStateFailed).
		Set("phase = ?", publicationbuilder.BuildPhaseFailed).
		Where("id = ?", build.ID).
		Exec(t.Context())
	require.NoError(t, err)
	retriedResponse := server.request(
		t, http.MethodPost, "/api/v1/publication-builds/"+build.ID+"/retry", nil, "", "web-token",
	)
	require.Equal(t, http.StatusOK, retriedResponse.Code, retriedResponse.Body.String())
	require.Equal(t, publicationbuilder.BuildStateQueued, decodePublicationBuild(t, retriedResponse).State)
}

func TestPublicationBuildCommitHandsReadyPackageToComposerOnce(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	publications := &publicationBuildPublicationStub{}
	server.handler.SetPublicationApplication(publications)
	created := server.request(
		t, http.MethodPost, "/api/v1/publication-builds", publicationBuildRequest(nil), "commit-build-request", "web-token",
	)
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	build := decodePublicationBuild(t, created)

	resultJSON, err := json.Marshal(publicationbuilder.BuildResult{
		CanonicalText: "The product got simpler.",
		Direction: publicationbuilder.DirectorPlan{
			Thesis: "Less code made the product better.", Outcome: "authority", Audience: "technical founders",
			Angle: "show the deletion", Route: "artifact_led",
		},
		Destinations: []publicationbuilder.DestinationPlan{{
			AccountID: "account-x", Platform: capabilities.ProviderX, OutputProfile: "x.short_text",
			Segments: []publicationbuilder.SegmentPlan{{Body: "The product got simpler."}},
			Media:    publicationbuilder.MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
		}},
	})
	require.NoError(t, err)
	_, err = server.db.NewUpdate().Model((*publicationbuilder.BuildRecord)(nil)).
		Set("state = ?", publicationbuilder.BuildStateReady).
		Set("phase = ?", publicationbuilder.BuildPhaseReady).
		Set("result_json = ?", string(resultJSON)).
		Where("id = ?", build.ID).
		Exec(t.Context())
	require.NoError(t, err)

	commit := server.request(
		t, http.MethodPost, "/api/v1/publication-builds/"+build.ID+"/commit", nil, "", "web-token",
	)
	require.Equal(t, http.StatusOK, commit.Code, commit.Body.String())
	var output CommitPublicationBuildOutput
	require.NoError(t, json.Unmarshal(commit.Body.Bytes(), &output.Body))
	require.NotEmpty(t, output.Body.PublicationID)
	require.Equal(t, "/publications/"+output.Body.PublicationID, output.Body.Href)
	require.Equal(t, 1, publications.createCalls)

	replayed := server.request(
		t, http.MethodPost, "/api/v1/publication-builds/"+build.ID+"/commit", nil, "", "web-token",
	)
	require.Equal(t, http.StatusOK, replayed.Code, replayed.Body.String())
	require.Equal(t, 1, publications.createCalls)
}

func TestPublicationBuildHandlerReturnsUnavailableWithoutApplication(t *testing.T) {
	server := newPublicationBuildTestServer(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationBuildHandler(server.db, publicationBuildTestAuthenticator{}, nil).RegisterRoutes(api)

	request := httptest.NewRequestWithContext(
		t.Context(), http.MethodPost, "/api/v1/publication-builds", bytes.NewBufferString(`{
			"workspace_id":"ws-1","idea":"A product update","account_ids":["account-x"]
		}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer web-token")
	request.Header.Set("Idempotency-Key", "unavailable-builder")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
}

type publicationBuildTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	handler *PublicationBuildHandler
}

func newPublicationBuildTestServer(t *testing.T) *publicationBuildTestServer {
	t.Helper()
	now := time.Date(2026, time.August, 23, 14, 0, 0, 0, time.UTC)
	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.SocialSet)(nil),
		(*models.SocialSetAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Job)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*publicationbuilder.BuildRecord)(nil),
	)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	db.SetMaxOpenConns(1)
	createPublicationBuildVoiceTables(t, db)
	_, err := db.NewCreateIndex().
		Index("publication_builds_handler_idempotency_idx").
		Table("publication_builds").
		Column("workspace_id", "created_by_id", "idempotency_key").
		Unique().
		Exec(t.Context())
	require.NoError(t, err)

	users := []models.User{
		{ID: "user-1", Email: "one@example.com"},
		{ID: "user-2", Email: "two@example.com"},
	}
	_, err = db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	workspaces := []models.Workspace{
		{ID: "ws-1", OrganizationID: "org-1", Name: "OpenPost"},
		{ID: "ws-2", OrganizationID: "org-2", Name: "Other"},
	}
	_, err = db.NewInsert().Model(&workspaces).Exec(t.Context())
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "ws-1", UserID: "user-2", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
	}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)

	provider := &models.IdentityProvider{
		ID: "provider-1", OrganizationID: "org-1", Source: "database",
		Issuer: "https://id.example", Name: "Example ID", ClientID: "client-1",
		UseUserInfo: true, RequireVerifiedEmail: true, JITEnabled: true, IsActive: true,
	}
	_, err = db.NewInsert().Model(provider).Exec(t.Context())
	require.NoError(t, err)
	policy := &models.OrganizationSSOPolicy{
		OrganizationID: "org-1", Mode: models.OrganizationSSOModeDisabled,
		ProviderIDs: `["provider-1"]`, AssuranceMaxAgeSeconds: 3600,
		APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: 3600,
	}
	_, err = db.NewInsert().Model(policy).Exec(t.Context())
	require.NoError(t, err)
	assurances := []models.SessionIdentityAssurance{
		{SessionID: "session-1", ProviderID: "provider-1", UserID: "user-1", AuthTime: now, ExpiresAt: now.Add(24 * time.Hour)},
		{SessionID: "session-2", ProviderID: "provider-1", UserID: "user-2", AuthTime: now, ExpiresAt: now.Add(24 * time.Hour)},
	}
	_, err = db.NewInsert().Model(&assurances).Exec(t.Context())
	require.NoError(t, err)

	accounts := []models.SocialAccount{
		{ID: "account-x", WorkspaceID: "ws-1", Slug: "founder-x", Platform: capabilities.ProviderX, AccountID: "x-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-linkedin", WorkspaceID: "ws-1", Slug: "founder-linkedin", Platform: capabilities.ProviderLinkedIn, AccountID: "linkedin-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-outside-set", WorkspaceID: "ws-1", Slug: "founder-bluesky", Platform: capabilities.ProviderBluesky, AccountID: "bluesky-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-instagram", WorkspaceID: "ws-1", Slug: "founder-instagram", Platform: capabilities.ProviderInstagram, AccountID: "instagram-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "foreign-account", WorkspaceID: "ws-2", Slug: "foreign", Platform: capabilities.ProviderX, AccountID: "x-2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(t.Context())
	require.NoError(t, err)
	media := []models.MediaAttachment{
		{ID: "media-1", WorkspaceID: "ws-1", FilePath: "source.png", MimeType: "image/png", ProcessingStatus: "ready", CreatedAt: now},
		{ID: "foreign-media", WorkspaceID: "ws-2", FilePath: "foreign.png", MimeType: "image/png", ProcessingStatus: "ready", CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&media).Exec(t.Context())
	require.NoError(t, err)
	set := &models.SocialSet{ID: "founder-set", WorkspaceID: "ws-1", Name: "Founder accounts", CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(set).Exec(t.Context())
	require.NoError(t, err)
	setAccounts := []models.SocialSetAccount{
		{SocialSetID: set.ID, SocialAccountID: "account-x", DisplayOrder: 0, DefaultOutputProfile: "x.thread", CreatedAt: now},
		{SocialSetID: set.ID, SocialAccountID: "account-linkedin", DisplayOrder: 1, DefaultOutputProfile: "linkedin.post", CreatedAt: now},
	}
	_, err = db.NewInsert().Model(&setAccounts).Exec(t.Context())
	require.NoError(t, err)
	_, err = voiceprofiles.SeedDefault(t.Context(), db, voiceprofiles.DefaultSeed{
		WorkspaceID: "ws-1", CreatedByID: "user-1", Name: "Rodrigo", Now: now,
	})
	require.NoError(t, err)
	_, err = voiceprofiles.SeedDefault(t.Context(), db, voiceprofiles.DefaultSeed{
		WorkspaceID: "ws-2", CreatedByID: "user-1", Name: "Other voice", Now: now,
	})
	require.NoError(t, err)

	application, err := publicationbuilder.NewApplication(db, publicationBuildTestBuilder{}, publicationbuilder.ApplicationConfig{
		Model: "test-model", Now: func() time.Time { return now },
	})
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPublicationBuildHandler(db, publicationBuildTestAuthenticator{}, application)
	handler.now = func() time.Time { return now }
	handler.RegisterRoutes(api)
	return &publicationBuildTestServer{echo: e, db: db, handler: handler}
}

func createPublicationBuildVoiceTables(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, statement := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_publication_build_owner_idx ON social_accounts (id, workspace_id)`,
		`CREATE TABLE IF NOT EXISTS voice_profiles (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT false,
			revision INTEGER NOT NULL DEFAULT 1,
			schema_version INTEGER NOT NULL DEFAULT 1,
			definition_json TEXT NOT NULL DEFAULT '{}',
			created_by_id TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			UNIQUE (id, workspace_id),
			UNIQUE (workspace_id, normalized_name)
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS publication_build_voice_default_idx ON voice_profiles (workspace_id) WHERE is_default = true`,
		`CREATE TABLE IF NOT EXISTS voice_profile_account_assignments (
			social_account_id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			voice_profile_id TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		)`,
		`CREATE TABLE publication_build_assets (
			build_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			display_order INTEGER NOT NULL DEFAULT 0,
			role TEXT NOT NULL DEFAULT 'context',
			may_publish BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (build_id, media_id)
		)`,
	} {
		_, err := db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
}

func publicationBuildRequest(overrides map[string]any) map[string]any {
	request := map[string]any{
		"workspace_id": "ws-1",
		"idea":         "I deleted fifteen thousand lines and the product got simpler.",
		"account_ids":  []string{"account-x"},
	}
	for key, value := range overrides {
		request[key] = value
	}
	return request
}

func (server *publicationBuildTestServer) request(
	t *testing.T,
	method string,
	path string,
	body any,
	idempotencyKey string,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	return response
}

func decodePublicationBuild(t *testing.T, response *httptest.ResponseRecorder) publicationbuilder.Build {
	t.Helper()
	var build publicationbuilder.Build
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &build))
	return build
}
