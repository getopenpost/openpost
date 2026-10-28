package publisher

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

	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/stretchr/testify/require"
)

type connectorTestResolver struct {
	address net.IP
}

func (r connectorTestResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: r.address}}, nil
}

func TestScheduledConnectorPublishSurvivesServiceRestartAndRecordsExternalID(t *testing.T) {
	t.Parallel()

	manifest := connectors.Manifest{
		ProtocolVersion:       connectors.ProtocolVersion,
		ImplementationVersion: "0.1.0",
		Provider: connectors.ProviderDescriptor{
			ID: "io.directus.items", DisplayName: "Directus",
		},
		CapabilityRevision: "directus-items-v1",
		Connection:         connectors.ConnectionDescriptor{Modes: []string{"preconfigured"}},
		Publishing: connectors.PublishingDescriptor{OutputProfiles: []connectors.OutputProfile{{
			ID: "directus.item", DisplayName: "Create Directus item", Profile: "short_text",
			Intents: []string{"post"}, Content: connectors.TextConstraint{Required: true, MaxLength: 100_000},
			Media: connectors.MediaConstraint{MinItems: 0, MaxItems: 0},
		}}},
		Operations: connectors.OperationDescriptor{Polling: true},
	}
	publishCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v1/manifest":
			require.NoError(t, json.NewEncoder(response).Encode(manifest))
		case "/v1/health":
			require.NoError(t, json.NewEncoder(response).Encode(connectors.HealthResponse{Status: "ready"}))
		case "/v1/publishes":
			publishCalls++
			require.NoError(t, json.NewEncoder(response).Encode(connectors.PublishResponse{
				Status: "published", ExternalID: "item-after-restart",
			}))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL)
	require.NoError(t, err)
	port, err := strconv.Atoi(parsed.Port())
	require.NoError(t, err)
	config := connectors.Config{Version: 1, Installations: []connectors.InstallationConfig{{
		ID: "directus-main", BearerToken: "connector-secret",
		Endpoint: connectors.EndpointConfig{
			Mode: connectors.TransportPrivateAllow, BaseURL: "http://connector.test:" + parsed.Port(),
			AllowedHosts: []string{"connector.test"}, AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")},
			AllowedPorts: []int{port},
		},
	}}}
	options := connectors.RegistryOptions{Client: connectors.ClientOptions{
		Resolver: connectorTestResolver{address: net.ParseIP(parsed.Hostname())},
	}}

	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{})
	initialRegistry, err := connectors.NewRegistry(t.Context(), config, options)
	require.NoError(t, err)
	initialStore := connectors.NewStore(srv.db)
	require.NoError(t, initialStore.SyncRegistry(t.Context(), initialRegistry))
	_, err = srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("platform = ?", manifest.Provider.ID).
		Set("account_id = ?", "posts").
		Set("slug = ?", "directus-posts").
		Set("access_token_encrypted = ?", []byte("connector-managed")).
		Set("oauth_grant_id = ''").
		Where("id = ?", "account-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("platform = ?", manifest.Provider.ID).
		Set("output_profile = ?", "directus.item").
		Set("settings_json = ?", `{"status":"published"}`).
		Where("id = ?", "rendition-1").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, initialStore.BindAccount(t.Context(), models.ProviderAccountBinding{
		SocialAccountID: "account-1", WorkspaceID: "ws-1", InstallationID: "directus-main",
		ConnectionRef: "directus/posts", ExternalAccountID: "posts",
		CapabilityRevision: manifest.CapabilityRevision,
	}))
	jobContext, payload := srv.authorizedPublicationJob(t)

	restartedRegistry, err := connectors.NewRegistry(t.Context(), config, options)
	require.NoError(t, err)
	restartedStore := connectors.NewStore(srv.db)
	require.NoError(t, restartedStore.SyncRegistry(t.Context(), restartedRegistry))
	restartedService := NewService(srv.db, nil)
	restartedService.SetProviderReadiness(srv.service.readiness)
	restartedService.SetConnectorRegistry(restartedRegistry, restartedStore)

	require.NoError(t, restartedService.HandlePublishPublicationJob(jobContext, payload))
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)
	require.Equal(t, "item-after-restart", rendition.ExternalID)
	require.Equal(t, 1, publishCalls)
	var event models.PublicationLifecycleEvent
	require.NoError(t, srv.db.NewSelect().Model(&event).Where("rendition_id = ? AND type = ?", "rendition-1", lifecycle.EventProviderProcessing).Scan(t.Context()))
	var metadata map[string]any
	require.NoError(t, json.Unmarshal([]byte(event.MetadataJSON), &metadata))
	require.Equal(t, "directus-main", metadata["provider_key"])
	require.Equal(t, "io.directus.items", metadata["platform"])
}
