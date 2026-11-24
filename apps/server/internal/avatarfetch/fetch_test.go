package avatarfetch

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/netguard"
	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func publicResolver() netguard.Resolver {
	return resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
}

func privateResolver() netguard.Resolver {
	return resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.5")}}, nil
	})
}

func TestFetchRejectsCredentialedURL(t *testing.T) {
	t.Parallel()

	_, err := Fetch(context.Background(), "https://user:secret@example.com/photo.jpg", Bounds{
		Label: "profile photo", Timeout: 5 * time.Second, MaxBytes: 4 * 1024 * 1024, Resolver: publicResolver(),
	})
	require.ErrorContains(t, err, "credential")
}

func TestFetchRejectsNonPublicHost(t *testing.T) {
	t.Parallel()

	_, err := Fetch(context.Background(), "https://cdn.example/photo.jpg", Bounds{
		Label: "profile photo", Timeout: 5 * time.Second, MaxBytes: 4 * 1024 * 1024, Resolver: privateResolver(),
	})
	require.ErrorContains(t, err, "private or local")
}

func TestFetchValidatesEveryRedirect(t *testing.T) {
	t.Parallel()

	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "cdn.example", req.URL.Hostname())
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"http://169.254.169.254/latest/meta-data"}},
			Body:       http.NoBody,
			Request:    req,
		}, nil
	})}
	_, err := Fetch(context.Background(), "https://cdn.example/photo.jpg", Bounds{
		Label: "profile photo", Timeout: 5 * time.Second, MaxBytes: 4 * 1024 * 1024,
		Resolver: publicResolver(), Client: client,
	})
	require.Error(t, err)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
