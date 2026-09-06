package platform

import (
	"bytes"
	"context"
	"errors"
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

func TestPinterestAmbiguousCreateIsFencedAcrossWorkerRestart(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	postCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v5/user_account":
			return jsonResponse(req, `{"username":"openpost","business_name":"OpenPost","account_type":"BUSINESS"}`), nil
		case "/v5/boards/board-owned":
			return jsonResponse(req, `{"id":"board-owned","name":"Owned","owner":{"username":"openpost"}}`), nil
		case "/v5/pins":
			postCalls++
			return jsonResponse(req, pinterestFixture(t, "create_pin_response.json")), nil
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	restarted := false
	request := &PublishRequest{
		Profile: "image_post", Content: "Launch", Settings: map[string]interface{}{"board_id": "board-owned"},
		PlatformMediaIDs: []string{"https://media.openpost.example/launch.jpg?lease=single"},
		Media:            []MediaItem{{ID: "image-1", MimeType: "image/jpeg"}},
	}
	request.SetWriteFence(func(PublishResult) error {
		if restarted {
			return errors.New("persisted Pinterest create is ambiguous")
		}
		return nil
	}, func(PublishResult) error {
		return context.DeadlineExceeded
	})

	_, err := NewPinterestAdapter("", "", "").Publish(context.Background(), "access", "openpost", request)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	restarted = true
	_, err = NewPinterestAdapter("", "", "").Publish(context.Background(), "access", "openpost", request)
	require.ErrorContains(t, err, "persisted Pinterest create is ambiguous")
	require.Equal(t, 1, postCalls, "an ambiguous Pin create must never be replayed after restart")
}

func TestPinterestImagePublishingRejectsUncertifiedFormatsBeforeProviderReads(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		t.Fatalf("invalid Pinterest media reached provider request %s %s", req.Method, req.URL.String())
		return nil, nil
	})}

	adapter := NewPinterestAdapter("", "", "")
	_, err := adapter.Publish(context.Background(), "access", "openpost", &PublishRequest{
		Profile: "image_post", Settings: map[string]interface{}{"board_id": "board-owned"},
		PlatformMediaIDs: []string{"https://media.openpost.example/video.mp4"},
		Media:            []MediaItem{{ID: "video", MimeType: "video/mp4"}},
	})
	require.ErrorContains(t, err, "must be JPEG, PNG, or WebP")
}

func TestPinterestVideoUploadReconcilesAmbiguousUploadBeforeSendingBytesAgain(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	uploadCalls := 0
	statusCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Path == "/v5/media" && req.Method == http.MethodPost:
			return jsonResponse(req, `{"media_id":"media-ambiguous","upload_url":"https://pin-upload.s3.amazonaws.com/","upload_parameters":{"policy":"secret-policy"}}`), nil
		case req.URL.Host == "pin-upload.s3.amazonaws.com":
			uploadCalls++
			_, err := io.Copy(io.Discard, req.Body)
			require.NoError(t, err)
			return nil, context.DeadlineExceeded
		case req.URL.Path == "/v5/media/media-ambiguous":
			statusCalls++
			switch statusCalls {
			case 1:
				return jsonResponse(req, `{"status":"registered"}`), nil
			case 2:
				return jsonResponse(req, `{"status":"processing"}`), nil
			default:
				return jsonResponse(req, `{"status":"succeeded"}`), nil
			}
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewPinterestAdapter("", "", "")
	adapter.mediaPollDelay = 0
	req := pinterestVideoUploadRequest()
	var registered ResumableMediaUploadState
	_, err := adapter.UploadMediaResumable(t.Context(), "access", "account", req, ResumableMediaUploadState{}, func(state ResumableMediaUploadState) error {
		registered = state
		return nil
	})
	require.Error(t, err)
	classification, ok := MediaRetryClassificationForError(err)
	require.True(t, ok)
	require.Equal(t, MediaRetrySafeResume, classification)
	require.NotEmpty(t, registered.OpaqueState)

	var accepted ResumableMediaUploadState
	mediaID, err := adapter.UploadMediaResumable(t.Context(), "access", "account", req, registered, func(state ResumableMediaUploadState) error {
		accepted = state
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, "media-ambiguous", mediaID)
	require.Equal(t, 1, uploadCalls, "processing status proves the ambiguous upload was accepted")
	require.Empty(t, accepted.OpaqueState)
	require.True(t, accepted.SessionExpiresAt.IsZero())
}

func TestPinterestVideoUploadCheckpointsTerminalProviderFailure(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "/v5/media/media-failed", req.URL.Path)
		return jsonResponse(req, `{"status":"failed"}`), nil
	})}
	adapter := NewPinterestAdapter("", "", "")
	state := ResumableMediaUploadState{
		ProviderMediaID: "media-failed", UploadedBytes: int64(len("video-body")), TotalBytes: int64(len("video-body")),
		Status: MediaUploadUploaded, RetryClassification: MediaRetryReconcile,
	}
	var failed ResumableMediaUploadState
	_, err := adapter.UploadMediaResumable(t.Context(), "access", "account", pinterestVideoUploadRequest(), state, func(next ResumableMediaUploadState) error {
		failed = next
		return nil
	})
	require.Error(t, err)
	classification, ok := MediaRetryClassificationForError(err)
	require.True(t, ok)
	require.Equal(t, MediaRetryTerminal, classification)
	require.Equal(t, MediaUploadFailed, failed.Status)
	require.Equal(t, MediaRetryTerminal, failed.RetryClassification)
	require.Empty(t, failed.OpaqueState)
}

func TestPinterestVideoPinNeverReplaysAmbiguousCreate(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	createCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v5/user_account":
			return jsonResponse(req, `{"username":"openpost"}`), nil
		case "/v5/boards/board-owned":
			return jsonResponse(req, `{"id":"board-owned","owner":{"username":"openpost"}}`), nil
		case "/v5/pins":
			createCalls++
			return nil, context.DeadlineExceeded
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewPinterestAdapter("", "", "")
	req := pinterestVideoPublishRequest()
	req.SetWriteFence(func(PublishResult) error { return nil }, func(PublishResult) error {
		t.Fatal("ambiguous create must not have a provider checkpoint")
		return nil
	})
	result, err := adapter.Publish(t.Context(), "access", "openpost", req)
	require.Error(t, err)
	require.Equal(t, "creating", result.ProviderState)
	require.Equal(t, PublishRetryNever, result.RetrySafety)
	require.Empty(t, result.ProviderReference)

	resumed := pinterestVideoPublishRequest()
	resumed.ResumeProviderState = result.ProviderState
	resumed.SetWriteFence(func(PublishResult) error {
		t.Fatal("ambiguous create must not enter the write fence again")
		return nil
	}, nil)
	_, err = adapter.Publish(t.Context(), "access", "openpost", resumed)
	require.ErrorContains(t, err, "will not replay")
	require.Equal(t, 1, createCalls)
}

func TestPinterestVideoRequirementsRejectMissingCoverBeforeProviderMutation(t *testing.T) {
	req := pinterestVideoUploadRequest()
	req.ThumbnailReader = nil
	err := validatePinterestVideoUpload(req)
	require.ErrorContains(t, err, "cover image")

	publishReq := pinterestVideoPublishRequest()
	publishReq.Settings["cover_media_id"] = "cover-local-id"
	_, err = pinterestVideoPinPayload(publishReq)
	require.ErrorContains(t, err, "public HTTPS cover")
}

func pinterestVideoUploadRequest() UploadMediaRequest {
	body := []byte("video-body")
	return UploadMediaRequest{
		MimeType: "video/mp4", Filename: "launch.mp4", Size: int64(len(body)),
		ThumbnailMimeType: "image/jpeg", ThumbnailFilename: "cover.jpg", ThumbnailSize: 5,
		ThumbnailReader: bytes.NewReader([]byte("cover")),
		OpenReaderAt: func(offset int64) (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(body[offset:])), nil
		},
	}
}

func pinterestVideoPublishRequest() *PublishRequest {
	return &PublishRequest{
		Content: "Launch description", Title: "Launch", Profile: "short_video",
		Settings: map[string]interface{}{
			"board_id": "board-owned", "cover_media_id": "https://media.openpost.test/cover.jpg",
		},
		PlatformMediaIDs: []string{"media-ready"},
		Media:            []MediaItem{{ID: "video", MimeType: "video/mp4", Size: 10}},
	}
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
