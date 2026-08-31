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

func TestPinterestPublishesCertifiedSingleAndOrderedMultiImageRequestFixtures(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	tests := []struct {
		name    string
		fixture string
		request *PublishRequest
	}{
		{
			name:    "single image",
			fixture: "create_single_image_request.json",
			request: &PublishRequest{
				Profile: "image_post", Title: "Fallback title", Description: "What changed in this release.",
				Settings: map[string]interface{}{
					"board_id": "board-owned", "section_id": "section-2", "pin_title": "Launch notes",
					"destination_link": "https://openpost.example/launch", "is_ai_generated": true,
				},
				PlatformMediaIDs: []string{"https://media.openpost.example/launch.jpg?lease=single"},
				MediaAltTexts:    []string{"OpenPost launch dashboard"},
				Media:            []MediaItem{{ID: "image-1", MimeType: "image/jpeg"}},
			},
		},
		{
			name:    "ordered multi image",
			fixture: "create_multi_image_request.json",
			request: &PublishRequest{
				Profile: "carousel", Content: "The launch in three steps.",
				Settings: map[string]interface{}{
					"board_id": "board-owned", "section_id": "section-2", "pin_title": "Launch sequence",
					"destination_link": "https://openpost.example/launch-sequence", "is_ai_generated": false,
				},
				PlatformMediaIDs: []string{
					"https://media.openpost.example/step-1.jpg?lease=first",
					"https://media.openpost.example/step-2.png?lease=second",
					"https://media.openpost.example/step-3.webp?lease=third",
				},
				MediaAltTexts: []string{"Step one", "Step two", "Step three"},
				Media: []MediaItem{
					{ID: "image-1", MimeType: "image/jpeg"},
					{ID: "image-2", MimeType: "image/png"},
					{ID: "image-3", MimeType: "image/webp"},
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			writeStarted := false
			var checkpoint PublishResult
			test.request.SetWriteFence(func(result PublishResult) error {
				require.Equal(t, "create_pin", result.ProviderState)
				require.Equal(t, PublishRetryNever, result.RetrySafety)
				writeStarted = true
				return nil
			}, func(result PublishResult) error {
				checkpoint = result
				return nil
			})
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				require.Equal(t, "Bearer access", req.Header.Get(headerAuthorization))
				switch req.URL.Path {
				case "/v5/user_account":
					return jsonResponse(req, `{"username":"openpost","business_name":"OpenPost","account_type":"BUSINESS"}`), nil
				case "/v5/boards/board-owned":
					return jsonResponse(req, `{"id":"board-owned","name":"Owned","owner":{"username":"openpost"}}`), nil
				case "/v5/boards/board-owned/sections":
					if req.URL.Query().Get("bookmark") == "sections-2" {
						return jsonResponse(req, pinterestFixture(t, "sections_page_2.json")), nil
					}
					return jsonResponse(req, pinterestFixture(t, "sections_page_1.json")), nil
				case "/v5/pins":
					require.True(t, writeStarted, "the durable write fence must be entered before Pin creation")
					require.Equal(t, http.MethodPost, req.Method)
					require.Equal(t, contentTypeJSON, req.Header.Get(headerContentType))
					body, err := io.ReadAll(req.Body)
					require.NoError(t, err)
					require.JSONEq(t, pinterestFixture(t, test.fixture), string(body))
					return jsonResponse(req, pinterestFixture(t, "create_pin_response.json")), nil
				default:
					t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
					return nil, nil
				}
			})}

			result, err := NewPinterestAdapter("", "", "").Publish(context.Background(), "access", "openpost", test.request)
			require.NoError(t, err)
			require.Equal(t, "993607355001234567", result.ExternalID)
			require.Equal(t, "https://www.pinterest.com/pin/993607355001234567/", result.ExternalURL)
			require.Equal(t, PublishSubmissionAccepted, result.SubmissionState)
			require.Equal(t, result, checkpoint)
		})
	}
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

func TestPinterestVideoUploadRestartsFromRegistrationCheckpoint(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	registerCalls := 0
	uploadCalls := 0
	statusCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Path == "/v5/media" && req.Method == http.MethodPost:
			registerCalls++
			return jsonResponse(req, `{"media_id":"media-registered","upload_url":"https://pin-upload.s3.amazonaws.com/","upload_parameters":{"policy":"secret-policy","key":"video-key"}}`), nil
		case req.URL.Host == "pin-upload.s3.amazonaws.com":
			uploadCalls++
			body, err := io.ReadAll(req.Body)
			require.NoError(t, err)
			require.Contains(t, string(body), "video-body")
			return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
		case req.URL.Path == "/v5/media/media-registered":
			statusCalls++
			if statusCalls == 1 {
				return jsonResponse(req, `{"status":"registered"}`), nil
			}
			return jsonResponse(req, `{"status":"succeeded"}`), nil
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
		return errors.New("worker stopped after registration")
	})
	require.ErrorContains(t, err, "worker stopped after registration")
	require.Equal(t, "media-registered", registered.ProviderMediaID)
	require.Contains(t, registered.OpaqueState, "secret-policy")
	require.Equal(t, MediaUploadUploading, registered.Status)

	var checkpoints []ResumableMediaUploadState
	mediaID, err := adapter.UploadMediaResumable(t.Context(), "access", "account", req, registered, func(state ResumableMediaUploadState) error {
		checkpoints = append(checkpoints, state)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, "media-registered", mediaID)
	require.Equal(t, 1, registerCalls, "restart must reuse the registered media id")
	require.Equal(t, 1, uploadCalls)
	require.Equal(t, MediaUploadUploaded, checkpoints[0].Status)
	require.Empty(t, checkpoints[0].OpaqueState, "upload credentials must be released after upload")
	require.Equal(t, MediaUploadReady, checkpoints[len(checkpoints)-1].Status)
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

func TestPinterestVideoUploadRestartsFromUploadedAndProcessingCheckpoints(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	registerCalls := 0
	uploadCalls := 0
	statuses := []string{"registered", "processing", "processing", "processing", "succeeded"}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Path == "/v5/media" && req.Method == http.MethodPost:
			registerCalls++
			return jsonResponse(req, `{"media_id":"media-uploaded","upload_url":"https://pin-upload.s3.amazonaws.com/","upload_parameters":{"policy":"secret-policy"}}`), nil
		case req.URL.Host == "pin-upload.s3.amazonaws.com":
			uploadCalls++
			_, err := io.Copy(io.Discard, req.Body)
			require.NoError(t, err)
			return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
		case req.URL.Path == "/v5/media/media-uploaded":
			require.NotEmpty(t, statuses)
			status := statuses[0]
			statuses = statuses[1:]
			return jsonResponse(req, `{"status":"`+status+`"}`), nil
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewPinterestAdapter("", "", "")
	adapter.mediaPollAttempts = 2
	adapter.mediaPollDelay = 0
	req := pinterestVideoUploadRequest()
	checkpointNumber := 0
	var uploaded ResumableMediaUploadState
	_, err := adapter.UploadMediaResumable(t.Context(), "access", "account", req, ResumableMediaUploadState{}, func(state ResumableMediaUploadState) error {
		checkpointNumber++
		uploaded = state
		if checkpointNumber == 2 {
			return errors.New("worker stopped after upload")
		}
		return nil
	})
	require.ErrorContains(t, err, "worker stopped after upload")
	require.Equal(t, MediaUploadUploaded, uploaded.Status)
	require.Equal(t, uploaded.TotalBytes, uploaded.UploadedBytes)
	require.Empty(t, uploaded.OpaqueState)

	var processing ResumableMediaUploadState
	_, err = adapter.UploadMediaResumable(t.Context(), "access", "account", req, uploaded, func(state ResumableMediaUploadState) error {
		processing = state
		return nil
	})
	require.ErrorContains(t, err, "still processing")
	classification, ok := MediaRetryClassificationForError(err)
	require.True(t, ok)
	require.Equal(t, MediaRetryReconcile, classification)
	require.Equal(t, MediaUploadUploaded, processing.Status)

	mediaID, err := adapter.UploadMediaResumable(t.Context(), "access", "account", req, processing, func(ResumableMediaUploadState) error { return nil })
	require.NoError(t, err)
	require.Equal(t, "media-uploaded", mediaID)
	require.Equal(t, 1, registerCalls)
	require.Equal(t, 1, uploadCalls, "uploaded and processing checkpoints must never resend bytes")
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

func TestPinterestVideoPinCreateCheckpointResumesWithReadOnlyReconciliation(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	createCalls := 0
	reconcileCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v5/user_account":
			return jsonResponse(req, `{"username":"openpost","business_name":"OpenPost"}`), nil
		case "/v5/boards/board-owned":
			return jsonResponse(req, `{"id":"board-owned","owner":{"username":"openpost"}}`), nil
		case "/v5/pins":
			createCalls++
			require.Equal(t, http.MethodPost, req.Method)
			body, err := io.ReadAll(req.Body)
			require.NoError(t, err)
			require.Contains(t, string(body), `"source_type":"video_id"`)
			require.Contains(t, string(body), `"cover_image_url":"https://media.openpost.test/cover.jpg"`)
			return jsonResponse(req, `{"id":"pin-created"}`), nil
		case "/v5/pins/pin-created":
			reconcileCalls++
			require.Equal(t, http.MethodGet, req.Method)
			return jsonResponse(req, `{"id":"pin-created"}`), nil
		default:
			t.Fatalf("unexpected Pinterest request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewPinterestAdapter("", "", "")
	req := pinterestVideoPublishRequest()
	begins := 0
	req.SetWriteFence(func(result PublishResult) error {
		begins++
		require.Equal(t, PublishRetryNever, result.RetrySafety)
		return nil
	}, func(result PublishResult) error {
		require.Equal(t, pinterestPinReferencePrefix+"pin-created", result.ProviderReference)
		return errors.New("worker stopped after Pin checkpoint")
	})
	pending, err := adapter.Publish(t.Context(), "access", "openpost", req)
	require.ErrorContains(t, err, "worker stopped after Pin checkpoint")
	require.Equal(t, PublishSubmissionPending, pending.SubmissionState)
	require.Equal(t, 1, begins)

	result, err := adapter.ReconcilePublish(t.Context(), "access", "openpost", pending.ProviderReference)
	require.NoError(t, err)
	require.Equal(t, PublishSubmissionAccepted, result.SubmissionState)
	require.Equal(t, "pin-created", result.ExternalID)
	require.Equal(t, "https://www.pinterest.com/pin/pin-created/", result.ExternalURL)
	require.Equal(t, 1, createCalls)
	require.Equal(t, 1, reconcileCalls)
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
