package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/publicationdiscovery"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type publicationDiscoveryStub struct {
	result publicationdiscovery.Result
	err    error
	calls  int
	input  publicationdiscovery.Input
}

func (stub *publicationDiscoveryStub) Discover(
	_ context.Context,
	input publicationdiscovery.Input,
) (publicationdiscovery.Result, error) {
	stub.calls++
	stub.input = input
	return stub.result, stub.err
}

type publicationDiscoveryAuthenticator struct{}

func (publicationDiscoveryAuthenticator) AuthenticateBearer(
	_ context.Context,
	token string,
) (*middleware.Principal, error) {
	switch token {
	case "web-token":
		return &middleware.Principal{UserID: "user-1", Email: "editor@example.com"}, nil
	case "viewer-token":
		return &middleware.Principal{UserID: "user-2", Email: "viewer@example.com"}, nil
	case "other-workspace-token":
		return &middleware.Principal{
			UserID: "user-1", Email: "editor@example.com", WorkspaceID: "ws-2",
			TokenID: "other-workspace-token", ClientID: "test-client",
		}, nil
	default:
		return nil, apitokens.ErrInvalidToken
	}
}

func TestPublicationDiscoveryHandlerReturnsPlanningCardsForWorkspaceEditors(t *testing.T) {
	stub := &publicationDiscoveryStub{result: publicationDiscoveryHandlerResult()}
	server := newPublicationDiscoveryTestServer(t, stub)

	response := publicationDiscoveryRequest(t, server.echo, "web-token", publicationDiscoveryRequestBody())

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, 1, stub.calls)
	require.Equal(t, "developer tools", stub.input.Focus)
	require.Equal(t, []string{"linkedin", "x"}, stub.input.Platforms)
	require.Equal(t, "Rodrigo", stub.input.Voice.Name)
	require.Len(t, stub.input.RecentPublications, 2)
	require.Equal(t, "A stored post about reliable agents.", stub.input.RecentPublications[0].Summary)
	var result publicationdiscovery.Result
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.Len(t, result.Opportunities, 1)
	require.Equal(t, "opportunity-1", result.Opportunities[0].ID)
}

func TestPublicationDiscoveryHandlerRejectsCredentialCrossingAndViewers(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "workspace-bound credential", token: "other-workspace-token"},
		{name: "viewer role", token: "viewer-token"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stub := &publicationDiscoveryStub{result: publicationDiscoveryHandlerResult()}
			server := newPublicationDiscoveryTestServer(t, stub)

			response := publicationDiscoveryRequest(t, server.echo, test.token, publicationDiscoveryRequestBody())

			require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
			require.Zero(t, stub.calls)
		})
	}
}

func TestPublicationDiscoveryHandlerSanitizesServiceFailures(t *testing.T) {
	const privateProviderOutput = "private provider output"
	stub := &publicationDiscoveryStub{err: errors.New(privateProviderOutput)}
	server := newPublicationDiscoveryTestServer(t, stub)

	response := publicationDiscoveryRequest(t, server.echo, "web-token", publicationDiscoveryRequestBody())

	require.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), privateProviderOutput)
	require.Equal(t, 1, stub.calls)
}

func TestPublicationDiscoveryHandlerBoundsPerUserBursts(t *testing.T) {
	stub := &publicationDiscoveryStub{result: publicationDiscoveryHandlerResult()}
	server := newPublicationDiscoveryTestServer(t, stub)
	for range publicationDiscoveryRequestsPerMinute {
		require.True(t, server.handler.limiter.Allow(
			"publication-discovery:user-1",
			publicationDiscoveryRequestsPerMinute,
			time.Minute,
		))
	}

	response := publicationDiscoveryRequest(t, server.echo, "web-token", publicationDiscoveryRequestBody())

	require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
	require.Zero(t, stub.calls)
}

func TestPublicationDiscoveryHandlerAllowsOneActiveRequestPerUser(t *testing.T) {
	stub := &publicationDiscoveryStub{result: publicationDiscoveryHandlerResult()}
	server := newPublicationDiscoveryTestServer(t, stub)
	release, acquired := server.handler.requests.acquire("user-1")
	require.True(t, acquired)
	defer release()

	response := publicationDiscoveryRequest(t, server.echo, "web-token", publicationDiscoveryRequestBody())

	require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
	require.Zero(t, stub.calls)
}

func TestPublicationDiscoveryHandlerRegistersWithoutRuntimeDependencies(t *testing.T) {
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	require.NotPanics(t, func() {
		NewPublicationDiscoveryHandler(nil, nil, nil).RegisterRoutes(api)
	})
	require.NotNil(t, api.OpenAPI().Paths[publicationDiscoveryPath])
}

type publicationDiscoveryTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	handler *PublicationDiscoveryHandler
}

func newPublicationDiscoveryTestServer(
	t *testing.T,
	discoverer publicationdiscovery.Discoverer,
) *publicationDiscoveryTestServer {
	t.Helper()
	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
	)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createPublicationBuildVoiceTables(t, db)
	members := []models.WorkspaceMember{
		{
			WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
			Status: models.WorkspaceMemberStatusActive,
		},
		{
			WorkspaceID: "ws-1", UserID: "user-2", Role: models.WorkspaceRoleViewer,
			Status: models.WorkspaceMemberStatusActive,
		},
	}
	_, err := db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	_, err = voiceprofiles.SeedDefault(t.Context(), db, voiceprofiles.DefaultSeed{
		WorkspaceID: "ws-1", CreatedByID: "user-1", Name: "Rodrigo", Now: now,
	})
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1",
		Title: "Reliable agents", SourceText: "A stored post about reliable agents.",
		SourceContent: "A stored post about reliable agents.", Status: "published",
		CreatedAt: now, UpdatedAt: now, ActualRunAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPublicationDiscoveryHandler(db, publicationDiscoveryAuthenticator{}, discoverer)
	handler.RegisterRoutes(api)
	return &publicationDiscoveryTestServer{echo: e, db: db, handler: handler}
}

func publicationDiscoveryRequest(
	t *testing.T,
	e *echo.Echo,
	token string,
	body map[string]any,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1"+publicationDiscoveryPath, &payload)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	return response
}

func publicationDiscoveryRequestBody() map[string]any {
	return map[string]any{
		"workspace_id": "ws-1",
		"focus":        "developer tools",
		"audience":     "technical founders",
		"platforms":    []string{"linkedin", "x"},
		"recent_publications": []map[string]any{{
			"published_at": "2026-08-20T10:00:00Z",
			"summary":      "A prior post about agent pricing.",
			"platforms":    []string{"x"},
			"topics":       []string{"AI agents"},
		}},
		"limit": 4,
	}
}

func publicationDiscoveryHandlerResult() publicationdiscovery.Result {
	return publicationdiscovery.Result{
		GeneratedAt: time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC),
		Model:       "test-model",
		Opportunities: []publicationdiscovery.Opportunity{{
			ID: "opportunity-1", Title: "A current technical change", WhyItFits: "It matches the voice.",
			WhyNow: "An official source was published today.", SignalDate: "2026-08-23",
			Hook: "One technical change worth a closer look.",
			Angles: []publicationdiscovery.Angle{
				{ID: "angle-1", Label: "Practical", Thesis: "Explain the tradeoff.", Approach: "Use evidence."},
				{ID: "angle-2", Label: "Contrarian", Thesis: "Question the default.", Approach: "Compare constraints."},
				{ID: "angle-3", Label: "Technical", Thesis: "Show the mechanism.", Approach: "Use the source."},
			},
			Sources: []publicationdiscovery.SourceCitation{{
				Title: "Official update", URL: "https://example.com/update", Publisher: "Example",
				PublishedAt: "2026-08-23", Supports: "The current change.", Primary: true,
			}},
			PlatformTreatments: []publicationdiscovery.PlatformTreatment{
				{Platform: "linkedin", Objective: "authority", Format: "analysis", Rationale: "Add context.", Media: "Source excerpt."},
				{Platform: "x", Objective: "conversation", Format: "short take", Rationale: "Use one tradeoff.", Media: "None."},
			},
		}},
	}
}
