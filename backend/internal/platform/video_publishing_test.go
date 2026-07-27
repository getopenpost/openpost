package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestServiceAuthPDSHost(t *testing.T) {
	host, err := serviceAuthPDSHost("https://bsky.social")
	if err != nil {
		t.Fatalf("serviceAuthPDSHost returned error: %v", err)
	}
	if host != "bsky.social" {
		t.Fatalf("expected bsky.social, got %q", host)
	}

	host, err = serviceAuthPDSHost("custom.pds.example")
	if err != nil {
		t.Fatalf("serviceAuthPDSHost returned error for host-only URL: %v", err)
	}
	if host != "custom.pds.example" {
		t.Fatalf("expected custom.pds.example, got %q", host)
	}
}

func TestDecodeBlueskyVideoJobStatusHandlesWrappedResponse(t *testing.T) {
	status, err := decodeBlueskyVideoJobStatus([]byte(`{
		"jobStatus": {
			"jobId": "job-1",
			"state": "JOB_STATE_COMPLETED",
			"blob": {"$type": "blob", "mimeType": "video/mp4"}
		}
	}`))
	if err != nil {
		t.Fatalf("decodeBlueskyVideoJobStatus returned error: %v", err)
	}
	if status.JobID != "job-1" {
		t.Fatalf("expected wrapped job ID, got %q", status.JobID)
	}
	if status.Blob == nil {
		t.Fatal("expected wrapped blob")
	}
}

func TestBlueskyServiceAuthAudienceUsesAccessTokenAudience(t *testing.T) {
	token := testJWT(t, map[string]interface{}{
		"aud": "did:web:polypore.us-west.host.bsky.network",
	})

	audience, err := blueskyServiceAuthAudience(token, "https://bsky.social")
	if err != nil {
		t.Fatalf("blueskyServiceAuthAudience returned error: %v", err)
	}
	if audience != "did:web:polypore.us-west.host.bsky.network" {
		t.Fatalf("expected token audience, got %q", audience)
	}
}

func TestBlueskyVideoServiceAuthRequestsTokenAudience(t *testing.T) {
	token := testJWT(t, map[string]interface{}{
		"aud": "did:web:polypore.us-west.host.bsky.network",
	})

	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != "GET" || req.URL.Path != "/xrpc/com.atproto.server.getServiceAuth" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if got := req.URL.Query().Get("aud"); got != "did:web:polypore.us-west.host.bsky.network" {
			t.Fatalf("expected service auth aud from access token, got %q", got)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"token":"service-token"}`)),
			Request:    req,
		}, nil
	})}

	adapter := NewBlueskyAdapter("https://bsky.social")
	serviceToken, err := adapter.videoServiceAuthToken(context.Background(), token)
	if err != nil {
		t.Fatalf("videoServiceAuthToken returned error: %v", err)
	}
	if serviceToken != "service-token" {
		t.Fatalf("expected service token, got %q", serviceToken)
	}
}

func TestLinkedInVideoStatusEncodesURNPathVariable(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != "GET" {
			t.Fatalf("unexpected request method %s", req.Method)
		}
		if req.URL.EscapedPath() != "/rest/videos/urn%3Ali%3Avideo%3AD4D10AQHRV0XIfe6hDw" {
			t.Fatalf("unexpected escaped path %q", req.URL.EscapedPath())
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"status":"AVAILABLE"}`)),
			Request:    req,
		}, nil
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	if err := adapter.waitForVideoAvailable(context.Background(), "token", "202601", "urn:li:video:D4D10AQHRV0XIfe6hDw"); err != nil {
		t.Fatalf("waitForVideoAvailable returned error: %v", err)
	}
}

func TestLinkedInCreatePostSkipsAltTextForVideoURN(t *testing.T) {
	payload := captureLinkedInCreatePostPayload(t, &PublishRequest{
		Content:          "video post",
		PlatformMediaIDs: []string{"urn:li:video:C5F10AQGKQg_6y2a4sQ"},
		MediaAltTexts:    []string{"do not send as alt text"},
	})

	media := linkedInPayloadMedia(t, payload)
	if _, ok := media["altText"]; ok {
		t.Fatalf("did not expect altText for video media: %#v", media)
	}
}

func testJWT(t *testing.T, payload map[string]interface{}) string {
	t.Helper()

	headerJSON, err := json.Marshal(map[string]string{"alg": "none"})
	if err != nil {
		t.Fatalf("marshaling jwt header: %v", err)
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshaling jwt payload: %v", err)
	}

	return base64.RawURLEncoding.EncodeToString(headerJSON) + "." +
		base64.RawURLEncoding.EncodeToString(payloadJSON) + ".signature"
}

func TestLinkedInCreatePostKeepsAltTextForImageURN(t *testing.T) {
	payload := captureLinkedInCreatePostPayload(t, &PublishRequest{
		Content:          "image post",
		PlatformMediaIDs: []string{"urn:li:image:C5F10AQGKQg_6y2a4sQ"},
		MediaAltTexts:    []string{"image description"},
	})

	media := linkedInPayloadMedia(t, payload)
	if media["altText"] != "image description" {
		t.Fatalf("expected image altText, got %#v", media["altText"])
	}
}

func captureLinkedInCreatePostPayload(t *testing.T, req *PublishRequest) map[string]interface{} {
	t.Helper()

	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var capturedBody []byte
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != "POST" || req.URL.String() != "https://api.linkedin.com/rest/posts" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		var err error
		capturedBody, err = io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("reading request body: %v", err)
		}
		headers := http.Header{}
		headers.Set("x-restli-id", "urn:li:share:1")
		return &http.Response{
			StatusCode: http.StatusCreated,
			Header:     headers,
			Body:       io.NopCloser(strings.NewReader("{}")),
			Request:    req,
		}, nil
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	if _, err := adapter.createPost(context.Background(), "token", "urn:li:person:abc", "202601", req); err != nil {
		t.Fatalf("createPost returned error: %v", err)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(capturedBody, &payload); err != nil {
		t.Fatalf("decoding captured payload: %v", err)
	}
	return payload
}

func linkedInPayloadMedia(t *testing.T, payload map[string]interface{}) map[string]interface{} {
	t.Helper()

	content, ok := payload["content"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload content missing or invalid: %#v", payload["content"])
	}
	media, ok := content["media"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload media missing or invalid: %#v", content["media"])
	}
	return media
}
