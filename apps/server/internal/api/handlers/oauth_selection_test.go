package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"

	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/openpost/backend/internal/platform"

	"github.com/stretchr/testify/require"
)

type selectionTestAdapter struct {
	exchangeCalls int
	profileCalls  int
	listCalls     int
	selectCalls   int
	listErr       error
	onSelect      func()
}

func (a *selectionTestAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return "https://provider.example/oauth?state=" + url.QueryEscape(state), nil
}

func (a *selectionTestAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	a.exchangeCalls++
	return &platform.TokenResult{
		AccessToken:  "user-access-token",
		RefreshToken: "user-refresh-token",
		ExpiresIn:    3600,
		TokenType:    "Bearer",
		Extra: map[string]string{
			"scope": "pages",
		},
	}, nil
}

func (a *selectionTestAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}

func (a *selectionTestAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}

func (a *selectionTestAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	a.profileCalls++
	return &platform.UserProfile{ID: "direct-user", Username: "direct"}, nil
}

func (a *selectionTestAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}

func (a *selectionTestAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func (a *selectionTestAdapter) ListAccountSelections(_ context.Context, token *platform.TokenResult) ([]platform.AccountSelectionOption, error) {
	a.listCalls++
	if a.listErr != nil {
		return nil, a.listErr
	}
	if token.AccessToken != "user-access-token" {
		return nil, nil
	}
	return []platform.AccountSelectionOption{
		{ID: "page-1", DisplayName: "Main Page", Username: "main-page", Kind: "page"},
		{ID: "page-2", DisplayName: "OpenPost Image Editor Page", Username: "studio", AvatarURL: "https://cdn.example/image-editor.png", Kind: "page"},
	}, nil
}

func (a *selectionTestAdapter) SelectAccount(_ context.Context, token *platform.TokenResult, selectionID string) (*platform.SelectedAccount, error) {
	a.selectCalls++
	if a.onSelect != nil {
		a.onSelect()
	}
	if token.AccessToken != "user-access-token" || selectionID != "page-2" {
		return nil, nil
	}
	return &platform.SelectedAccount{
		AccountID:        "page-2",
		AccountUsername:  "studio",
		AccountAvatarURL: "https://cdn.example/image-editor.png",
		Token: &platform.TokenResult{
			AccessToken: "page-access-token",
			ExpiresIn:   7200,
			TokenType:   "Bearer",
			Extra: map[string]string{
				"selected": selectionID,
			},
		},
	}, nil
}

func oauthSelectionRequest(t *testing.T, e *echo.Echo, method, path string, body any, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	var payload io.Reader
	if body != nil {
		buf := bytes.NewBuffer(nil)
		require.NoError(t, json.NewEncoder(buf).Encode(body))
		payload = buf
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, payload)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", "Bearer web-token")
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
