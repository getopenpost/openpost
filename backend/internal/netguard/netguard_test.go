package netguard

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func TestValidateURLRejectsPrivateAndLocalHosts(t *testing.T) {
	t.Parallel()

	policy := URLPolicy{Label: "url", AllowedSchemes: []string{"http", "https"}, AllowCustomPorts: true}
	blocked := []string{
		"http://127.0.0.1/private.png",
		"http://10.0.0.5/private.png",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]/private.png",
	}
	for _, raw := range blocked {
		t.Run(raw, func(t *testing.T) {
			t.Parallel()
			parsed, err := url.Parse(raw)
			require.NoError(t, err)
			require.ErrorContains(t, ValidateURL(context.Background(), parsed, policy), "private or local")
		})
	}
}

func TestValidateURLRejectsUnsupportedSchemeAndPort(t *testing.T) {
	t.Parallel()

	parsed, err := url.Parse("http://example.com:8443")
	require.NoError(t, err)
	err = ValidateURL(context.Background(), parsed, URLPolicy{
		Label:            "instance_url",
		AllowedSchemes:   []string{"https"},
		AllowCustomPorts: false,
		Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}),
	})
	require.ErrorContains(t, err, "instance_url scheme must be https")

	parsed, err = url.Parse("https://example.com:8443")
	require.NoError(t, err)
	err = ValidateURL(context.Background(), parsed, URLPolicy{
		Label:            "instance_url",
		AllowedSchemes:   []string{"https"},
		AllowCustomPorts: false,
		Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}),
	})
	require.ErrorContains(t, err, "instance_url cannot include a custom port")
}

func TestTransportRejectsPrivateAddressAtDialTime(t *testing.T) {
	t.Parallel()

	client := &http.Client{Transport: NewTransport(URLPolicy{
		Label:            "url",
		AllowedSchemes:   []string{"http"},
		AllowCustomPorts: true,
		Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
		}),
	})}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://cdn.example/asset.png", nil)
	require.NoError(t, err)
	resp, err := client.Do(req)
	if resp != nil {
		require.NoError(t, resp.Body.Close())
	}
	require.ErrorContains(t, err, "private or local")
}

func TestTransportDoesNotUseEnvironmentProxy(t *testing.T) {
	t.Parallel()

	transport := NewTransport(URLPolicy{AllowedSchemes: []string{"https"}})
	require.Nil(t, transport.Proxy)
}
