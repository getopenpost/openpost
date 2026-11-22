package workflows

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type redirectTestTransport func(*http.Request) (*http.Response, error)

func (f redirectTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func redirectTo(location string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusFound,
		Header:     http.Header{"Location": []string{location}},
		Body:       io.NopCloser(strings.NewReader("")),
	}
}

func okResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

// The workflow source fetch attaches a token, so a redirect to another host
// must be refused before the second request is issued. IP literals keep
// netguard validation DNS-free.
func TestSourceFetchRefusesCredentialedCrossHostRedirect(t *testing.T) {
	t.Parallel()
	s, _ := workflowTestService(t, nil)
	calls := 0
	s.client = &http.Client{Transport: redirectTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		resp := redirectTo("https://9.9.9.9/other")
		resp.Request = req
		return resp, nil
	})}

	_, err := s.readURL(t.Context(), "https://8.8.8.8/releases", "token")
	require.ErrorContains(t, err, "source could not be reached")
	require.Equal(t, 1, calls)
}

func TestSourceFetchAllowsSameHostHTTPSRedirect(t *testing.T) {
	t.Parallel()
	s, _ := workflowTestService(t, nil)
	s.client = &http.Client{Transport: redirectTestTransport(func(req *http.Request) (*http.Response, error) {
		var resp *http.Response
		if req.URL.Path == "/b" {
			resp = okResponse("release notes")
		} else {
			resp = redirectTo("https://8.8.8.8/b")
		}
		resp.Request = req
		return resp, nil
	})}

	data, err := s.readURL(t.Context(), "https://8.8.8.8/a", "token")
	require.NoError(t, err)
	require.Equal(t, "release notes", string(data))
}

// The workflow HTTP step attaches a stored connection secret, so a redirect
// to another host must be refused before the second request is issued.
func TestHTTPRequestRefusesCredentialedCrossHostRedirect(t *testing.T) {
	t.Parallel()
	s, _ := workflowTestService(t, nil)
	ciphertext, err := s.encryptor.Encrypt("secret-token")
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&connectionRecord{
		ID: "conn", WorkspaceID: "ws", Name: "API", Kind: "bearer",
		Host: "8.8.8.8", Ciphertext: ciphertext, CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	calls := 0
	s.client = &http.Client{Transport: redirectTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		resp := redirectTo("https://9.9.9.9/other")
		resp.Request = req
		return resp, nil
	})}

	_, err = s.request(t.Context(), "ws", "key", map[string]any{
		"url": "https://8.8.8.8/", "method": "GET", "connection_id": "conn",
	})
	require.ErrorContains(t, err, "request did not complete")
	require.Equal(t, 1, calls)
}
