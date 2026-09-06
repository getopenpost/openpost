package connectors

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func TestClientRejectsCredentialBearingRedirects(t *testing.T) {
	t.Parallel()

	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect target must not receive connector credentials")
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	client := newPrivateTestClient(t, source.URL)
	_, err := client.Manifest(context.Background())
	require.ErrorContains(t, err, "HTTP status 307")
}

func TestClientRejectsPrivateAddressOutsideConfiguredCIDR(t *testing.T) {
	t.Parallel()

	parsed, err := url.Parse("http://connector.test:8090")
	require.NoError(t, err)
	client, err := NewClient(InstallationConfig{
		ID: "blocked", BearerToken: "secret",
		Endpoint: EndpointConfig{
			Mode: TransportPrivateAllow, BaseURL: parsed.String(),
			AllowedHosts: []string{"connector.test"},
			AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
			AllowedPorts: []int{8090},
		},
	}, ClientOptions{Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	})})
	require.NoError(t, err)
	_, err = client.Manifest(context.Background())
	require.ErrorContains(t, err, "outside the private connector allowlist")
}

func newPrivateTestClient(t *testing.T, rawURL string) *Client {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	require.NoError(t, err)
	port, err := strconv.Atoi(parsed.Port())
	require.NoError(t, err)
	baseURL := "http://connector.test:" + parsed.Port()
	client, err := NewClient(InstallationConfig{
		ID: "directus-main", BearerToken: "connector-secret",
		Endpoint: EndpointConfig{
			Mode: TransportPrivateAllow, BaseURL: baseURL,
			AllowedHosts: []string{"connector.test"},
			AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")},
			AllowedPorts: []int{port},
		},
	}, ClientOptions{
		Timeout: 2 * time.Second,
		Resolver: resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
			require.Equal(t, "connector.test", host)
			return []net.IPAddr{{IP: net.ParseIP(parsed.Hostname())}}, nil
		}),
	})
	require.NoError(t, err)
	return client
}
