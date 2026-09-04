package connectors

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewRegistryRejectsInvalidRequiredConnector(t *testing.T) {
	t.Parallel()

	server := manifestServer(t, Manifest{ProtocolVersion: "2.0"})
	defer server.Close()
	config, options := registryTestConfig(t, server.URL, true)

	_, err := NewRegistry(context.Background(), config, options)
	require.ErrorContains(t, err, `required connector installation "directus-main"`)
}

func TestNewRegistryRejectsConnectorThatShadowsBuiltInProvider(t *testing.T) {
	t.Parallel()

	manifest := validManifest()
	manifest.Provider.ID = "x"
	server := manifestServer(t, manifest)
	defer server.Close()
	config, options := registryTestConfig(t, server.URL, false)

	registry, err := NewRegistry(context.Background(), config, options)
	require.NoError(t, err)
	entry, ok := registry.Installation("directus-main")
	require.True(t, ok)
	require.False(t, entry.Available)
	require.Equal(t, InstallationStatusInvalidManifest, entry.Status)
	require.Contains(t, entry.StatusDetail, "conflicts with a built-in provider")
}

func TestRegistryScopesInstallationsToConfiguredWorkspaces(t *testing.T) {
	t.Parallel()

	server := manifestServer(t, validManifest())
	defer server.Close()
	config, options := registryTestConfig(t, server.URL, false)
	config.Installations[0].WorkspaceAllowlist = []string{"workspace-1"}

	registry, err := NewRegistry(context.Background(), config, options)
	require.NoError(t, err)
	allowed := registry.AvailableForWorkspace("workspace-1")
	require.Len(t, allowed, 1)
	require.Equal(t, "io.directus.items", allowed[0].Manifest.Provider.ID)
	require.Empty(t, registry.AvailableForWorkspace("workspace-2"))

	client, entry, err := registry.ClientForWorkspace("directus-main", "workspace-2")
	require.Nil(t, client)
	require.Empty(t, entry.InstallationID)
	require.ErrorContains(t, err, "not available to this Workspace")
}

func manifestServer(t *testing.T, manifest Manifest) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v1/manifest":
			require.NoError(t, json.NewEncoder(response).Encode(manifest))
		case "/v1/health":
			require.NoError(t, json.NewEncoder(response).Encode(HealthResponse{Status: "ready"}))
		default:
			http.NotFound(response, request)
		}
	}))
}

func registryTestConfig(t *testing.T, rawURL string, required bool) (Config, RegistryOptions) {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	require.NoError(t, err)
	port, err := strconv.Atoi(parsed.Port())
	require.NoError(t, err)
	return Config{Version: configVersion, Installations: []InstallationConfig{{
			ID: "directus-main", Required: required, BearerToken: "secret",
			Endpoint: EndpointConfig{
				Mode: TransportPrivateAllow, BaseURL: "http://connector.test:" + parsed.Port(),
				AllowedHosts: []string{"connector.test"},
				AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")},
				AllowedPorts: []int{port},
			},
		}}}, RegistryOptions{Client: ClientOptions{Resolver: resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP(parsed.Hostname())}}, nil
		})}}
}
