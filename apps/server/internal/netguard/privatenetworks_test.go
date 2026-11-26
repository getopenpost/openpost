package netguard

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Tests that change the allowed private networks must not run in parallel:
// the setting is process-wide, and the package's parallel tests resume only
// after these sequential tests and their cleanups finish.
func allowPrivateNetworksForTest(t *testing.T, cidrs ...string) {
	t.Helper()
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	for _, cidr := range cidrs {
		prefix, err := ParsePrivateNetworkPrefix(cidr)
		require.NoError(t, err)
		prefixes = append(prefixes, prefix)
	}
	AllowPrivateNetworks(prefixes)
	t.Cleanup(func() { AllowPrivateNetworks(nil) })
}

func TestClientReachesOnlyAnAllowedPrivateNetwork(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	serverURL, err := url.Parse(server.URL)
	require.NoError(t, err)
	client := NewHTTPClient(5*time.Second, URLPolicy{
		Label:            "instance_url",
		AllowedSchemes:   []string{"http"},
		AllowCustomPorts: true,
		Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
		}),
	})
	get := func() (int, error) {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://mastodon.internal.example:"+serverURL.Port()+"/api/v1/instance", nil)
		require.NoError(t, err)
		resp, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		require.NoError(t, resp.Body.Close())
		return resp.StatusCode, nil
	}

	_, err = get()
	require.ErrorContains(t, err, "private or local")
	require.Zero(t, requests.Load())

	allowPrivateNetworksForTest(t, "127.0.0.0/8")
	status, err := get()
	require.NoError(t, err)
	require.Equal(t, http.StatusNoContent, status)
	require.Equal(t, int32(1), requests.Load())
}

func TestAllowedPrivateNetworksAdmitOnlyTheirOwnAddresses(t *testing.T) {
	allowPrivateNetworksForTest(t, "10.7.7.0/24", "fd00:7::/64")
	policy := URLPolicy{Label: "instance_url", AllowedSchemes: []string{"https"}}
	for raw, allowed := range map[string]bool{
		"https://10.7.7.20/":          true,
		"https://[::ffff:10.7.7.20]/": true,
		"https://[fd00:7::20]/":       true,
		"https://10.7.8.20/":          false,
		"https://[fd00:8::20]/":       false,
		"https://127.0.0.1/":          false,
		"https://169.254.169.254/":    false,
	} {
		parsed, err := url.Parse(raw)
		require.NoError(t, err)
		err = ValidateURL(context.Background(), parsed, policy)
		if allowed {
			require.NoError(t, err, raw)
		} else {
			require.ErrorContains(t, err, "private or local", raw)
		}
	}
}

func TestAllowedPrivateNetworksStayNonPublic(t *testing.T) {
	allowPrivateNetworksForTest(t, "10.7.7.0/24")

	require.False(t, IsPublicAddress(net.ParseIP("10.7.7.20")))
}

func TestParsePrivateNetworkPrefix(t *testing.T) {
	t.Parallel()

	prefix, err := ParsePrivateNetworkPrefix("::ffff:10.7.7.9/120")
	require.NoError(t, err)
	require.Equal(t, netip.MustParsePrefix("10.7.7.0/24"), prefix)

	_, err = ParsePrivateNetworkPrefix("10.7.7.9")
	require.Error(t, err)

	_, err = ParsePrivateNetworkPrefix("::ffff:0:0/95")
	require.ErrorContains(t, err, "IPv4-mapped private network CIDR must have at least 96 prefix bits")
}
