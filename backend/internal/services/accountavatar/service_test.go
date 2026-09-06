package accountavatar

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func TestCacheLinkedInStoresAValidatedImageBehindAnOpenPostURL(t *testing.T) {
	t.Parallel()

	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	service := New(storage)
	service.validateURL = func(context.Context, *url.URL) error { return nil }
	service.httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "media.licdn.com", req.URL.Hostname())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
			Body:       io.NopCloser(strings.NewReader(string(jpegFixture))),
			Request:    req,
		}, nil
	})}

	avatarURL, err := service.CacheLinkedIn(
		t.Context(),
		"account-1",
		"https://media.licdn.com/profile.jpg?signature=provider",
	)
	require.NoError(t, err)
	require.Regexp(t, `^/avatars/avatar_account_account-1_[a-f0-9-]+\.jpg$`, avatarURL)

	key := strings.TrimPrefix(avatarURL, "/avatars/")
	stored, err := storage.Open(t.Context(), key)
	require.NoError(t, err)
	defer stored.Close()
	content, err := io.ReadAll(stored)
	require.NoError(t, err)
	require.Equal(t, jpegFixture, content)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

var jpegFixture = []byte{
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01, 0x01, 0x01,
	0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
}
