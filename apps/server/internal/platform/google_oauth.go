package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Shared Google OAuth 2.0 helpers for Google-backed adapters (YouTube and
// Google Business Profile). Both products authenticate against the same
// Google identity and token endpoints, so the exchange, refresh, and profile
// shapes stay in one place instead of drifting across adapters.

func exchangeGoogleOAuthToken(ctx context.Context, values map[string]string, label string) (*TokenResult, error) {
	respBody, err := DoFormURLEncoded(ctx, http.MethodPost, googleTokenURL, values, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
		Scope        string `json:"scope"`
		Error        string `json:"error"`
		Description  string `json:"error_description"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}
	if tokenResp.Error != "" {
		return nil, fmt.Errorf("%s: %s", label, firstNonEmptyString(tokenResp.Description, tokenResp.Error))
	}
	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("%s: missing access token", label)
	}

	extra := map[string]string{}
	if tokenResp.Scope != "" {
		extra["scope"] = tokenResp.Scope
	}
	return &TokenResult{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresIn:    tokenResp.ExpiresIn,
		TokenType:    firstNonEmptyString(tokenResp.TokenType, tokenTypeBearer),
		Extra:        extra,
	}, nil
}

func fetchGoogleUserProfile(ctx context.Context, accessToken, label string) (*UserProfile, error) {
	respBody, err := DoRequest(ctx, http.MethodGet, googleUserInfoURL, nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}

	var profile struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
		Email   string `json:"email"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &profile); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}
	if profile.Error.Message != "" {
		return nil, fmt.Errorf("%s: %s", label, profile.Error.Message)
	}
	return &UserProfile{
		ID:          profile.ID,
		Username:    firstNonEmptyString(profile.Email, profile.Name, profile.ID),
		DisplayName: firstNonEmptyString(profile.Name, profile.Email, profile.ID),
		AvatarURL:   profile.Picture,
	}, nil
}
