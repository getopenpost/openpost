package platform

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func pinterestFixture(t *testing.T, name string) string {
	t.Helper()
	body, err := os.ReadFile("testdata/pinterest/" + name)
	require.NoError(t, err)
	return string(body)
}

func TestPinterestOAuthRefreshRotationAndRevocationFixtures(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var grants []url.Values
	var revokedToken string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodPost, req.Method)
		require.Equal(t, "Basic cGluLWNsaWVudDpwdG4tc2VjcmV0", req.Header.Get(headerAuthorization))
		body, err := io.ReadAll(req.Body)
		require.NoError(t, err)
		values, err := url.ParseQuery(string(body))
		require.NoError(t, err)
		if req.URL.String() == pinterestTokenURL+"/revoke" {
			revokedToken = values.Get("token")
			require.Equal(t, "access_token", values.Get("token_type_hint"))
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
		}
		require.Equal(t, pinterestTokenURL, req.URL.String())
		grants = append(grants, values)
		if values.Get(grantType) == oauthGrantRefresh {
			return jsonResponse(req, pinterestFixture(t, "oauth_refresh_rotated.json")), nil
		}
		if values.Get(oauthParamCode) == "reconnect-code" {
			return jsonResponse(req, pinterestFixture(t, "oauth_reconnect.json")), nil
		}
		return jsonResponse(req, pinterestFixture(t, "oauth_exchange.json")), nil
	})}

	adapter := NewPinterestAdapter("pin-client", "ptn-secret", "https://app.test/api/v1/accounts/pinterest/callback")
	authURL, _ := adapter.GenerateAuthURL("oauth-state")
	parsed, err := url.Parse(authURL)
	require.NoError(t, err)
	require.Equal(t, "oauth-state", parsed.Query().Get("state"))
	require.Equal(t, strings.Join(pinterestOAuthScopes, ","), parsed.Query().Get("scope"))

	exchanged, err := adapter.ExchangeCode(context.Background(), "auth-code", nil)
	require.NoError(t, err)
	require.Equal(t, "pin-access-1", exchanged.AccessToken)
	require.Equal(t, "pin-refresh-1", exchanged.RefreshToken)
	require.Equal(t, 31536000, exchanged.RefreshExpiresIn)

	refreshed, err := adapter.RefreshToken(context.Background(), RefreshTokenInput{RefreshToken: exchanged.RefreshToken})
	require.NoError(t, err)
	require.Equal(t, "pin-access-2", refreshed.AccessToken)
	require.Equal(t, "pin-refresh-2", refreshed.RefreshToken, "Pinterest refresh-token rotation must be persisted by the grant manager")

	reconnected, err := adapter.ExchangeCode(context.Background(), "reconnect-code", nil)
	require.NoError(t, err)
	require.Equal(t, "pin-access-reconnected", reconnected.AccessToken)
	require.Equal(t, "pin-refresh-reconnected", reconnected.RefreshToken)
	require.Len(t, grants, 3)
	require.Equal(t, "auth-code", grants[0].Get(oauthParamCode))
	require.Equal(t, "pin-refresh-1", grants[1].Get(string(RefreshCredentialRefreshToken)))
	require.Equal(t, "reconnect-code", grants[2].Get(oauthParamCode))

	require.NoError(t, adapter.RevokeAuthorization(context.Background(), refreshed.AccessToken))
	require.Equal(t, "pin-access-2", revokedToken)
}

func TestPinterestListsEveryBoardPageWithoutLossOrDuplicatesAndLoadsSectionsLazily(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	boardCalls := 0
	sectionCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "Bearer access", req.Header.Get(headerAuthorization))
		switch req.URL.Path {
		case "/v5/boards":
			boardCalls++
			if req.URL.Query().Get("bookmark") == "page-2" {
				return jsonResponse(req, pinterestFixture(t, "boards_page_2.json")), nil
			}
			return jsonResponse(req, pinterestFixture(t, "boards_page_1.json")), nil
		case "/v5/boards/board-1/sections":
			sectionCalls++
			return jsonResponse(req, pinterestFixture(t, "sections_page_1.json")), nil
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewPinterestAdapter("", "", "")
	groups, err := adapter.ListDestinationOptions(context.Background(), "access", DestinationOptionsInput{})
	require.NoError(t, err)
	require.Equal(t, []DestinationOption{
		{Value: "board-1", Label: "Launches"},
		{Value: "board-2", Label: "Lessons"},
		{Value: "board-3", Label: "Build notes"},
	}, groups["pinterest_boards"])
	require.Equal(t, 2, boardCalls)

	empty, err := adapter.SearchPublishingOptions(context.Background(), "access", PublishingOptionsInput{Source: "pinterest_sections", Limit: 25})
	require.NoError(t, err)
	require.Empty(t, empty.Options)
	require.Zero(t, sectionCalls, "sections must not load before a board is selected")

	sections, err := adapter.SearchPublishingOptions(context.Background(), "access", PublishingOptionsInput{
		Source: "pinterest_sections",
		Limit:  25,
		Context: map[string]string{
			"value": `{"board_id":"board-1"}`,
		},
	})
	require.NoError(t, err)
	require.Equal(t, []DestinationOption{{Value: "section-1", Label: "Product"}}, sections.Options)
	require.Equal(t, "sections-2", sections.NextCursor)
	require.Equal(t, 1, sectionCalls)
}

func TestPinterestPublishTargetValidationRejectsForeignStaleAndMismatchedTargetsBeforeMutation(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	mutations := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet {
			mutations++
			t.Fatalf("target validation attempted a provider mutation: %s %s", req.Method, req.URL.String())
		}
		switch req.URL.Path {
		case "/v5/user_account":
			return jsonResponse(req, `{"username":"openpost","business_name":"OpenPost","account_type":"BUSINESS","profile_image":"https://cdn.example/avatar.jpg"}`), nil
		case "/v5/boards/board-owned":
			return jsonResponse(req, `{"id":"board-owned","name":"Owned","owner":{"username":"openpost"}}`), nil
		case "/v5/boards/board-foreign":
			return jsonResponse(req, `{"id":"board-foreign","name":"Foreign","owner":{"username":"another-founder"}}`), nil
		case "/v5/boards/board-stale":
			return &http.Response{StatusCode: http.StatusNotFound, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"code":5,"message":"private provider detail"}`)), Request: req}, nil
		case "/v5/boards/board-owned/sections":
			if req.URL.Query().Get("bookmark") == "sections-2" {
				return jsonResponse(req, pinterestFixture(t, "sections_page_2.json")), nil
			}
			return jsonResponse(req, pinterestFixture(t, "sections_page_1.json")), nil
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewPinterestAdapter("", "", "")
	tests := []struct {
		name     string
		settings map[string]interface{}
		want     string
	}{
		{name: "foreign board", settings: map[string]interface{}{"board_id": "board-foreign"}, want: "not owned"},
		{name: "stale board", settings: map[string]interface{}{"board_id": "board-stale"}, want: "status 404"},
		{name: "mismatched section", settings: map[string]interface{}{"board_id": "board-owned", "section_id": "section-foreign"}, want: "does not belong"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := adapter.ValidatePublishingTarget(context.Background(), "access", "openpost", test.settings)
			require.ErrorContains(t, err, test.want)
			require.NotContains(t, err.Error(), "private provider detail")
		})
	}
	require.ErrorContains(t, adapter.ValidatePublishingTarget(context.Background(), "access", "another-account", map[string]interface{}{
		"board_id": "board-owned",
	}), "no longer belongs to the connected account")
	require.NoError(t, adapter.ValidatePublishingTarget(context.Background(), "access", "openpost", map[string]interface{}{
		"board_id": "board-owned", "section_id": "section-2",
	}))
	require.Zero(t, mutations)
}
