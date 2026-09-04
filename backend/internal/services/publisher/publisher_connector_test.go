package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type connectorTestResolver struct {
	address net.IP
}

func (r connectorTestResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: r.address}}, nil
}

func TestProviderForAccountResolvesConnectorBinding(t *testing.T) {
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
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v1/manifest":
			require.NoError(t, json.NewEncoder(response).Encode(manifest))
		case "/v1/health":
			require.NoError(t, json.NewEncoder(response).Encode(connectors.HealthResponse{Status: "ready"}))
		case "/v1/publishes":
			require.NoError(t, json.NewEncoder(response).Encode(connectors.PublishResponse{
				Status: "published", ExternalID: "item-42",
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
	registry, err := connectors.NewRegistry(context.Background(), connectors.Config{
		Version: 1,
		Installations: []connectors.InstallationConfig{{
			ID: "directus-main", BearerToken: "connector-secret",
			Endpoint: connectors.EndpointConfig{
				Mode: connectors.TransportPrivateAllow, BaseURL: "http://connector.test:" + parsed.Port(),
				AllowedHosts: []string{"connector.test"}, AllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")},
				AllowedPorts: []int{port},
			},
		}},
	}, connectors.RegistryOptions{Client: connectors.ClientOptions{
		Resolver: connectorTestResolver{address: net.ParseIP(parsed.Hostname())},
	}})
	require.NoError(t, err)

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{
		(*models.SocialAccount)(nil), (*models.ProviderInstallation)(nil), (*models.ProviderAccountBinding)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	store := connectors.NewStore(db)
	require.NoError(t, store.SyncRegistry(context.Background(), registry))
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "io.directus.items",
		AccountID: "posts", Slug: "directus-posts", AccessTokenEnc: []byte("connector-managed"), IsActive: true, CreatedAt: time.Now().UTC(),
	}
	_, err = db.NewInsert().Model(account).Exec(context.Background())
	require.NoError(t, err)
	require.NoError(t, store.BindAccount(context.Background(), models.ProviderAccountBinding{
		SocialAccountID: account.ID, WorkspaceID: account.WorkspaceID, InstallationID: "directus-main",
		ConnectionRef: "directus/posts", ExternalAccountID: account.AccountID,
		CapabilityRevision: manifest.CapabilityRevision,
	}))

	service := NewService(db, nil)
	service.SetConnectorRegistry(registry, store)
	require.NoError(t, service.requireRenditionReadiness(context.Background(), account, &models.Rendition{
		Profile: "short_text", OutputProfile: "directus.item", SettingsJSON: "{}",
	}, nil, "production"))
	publisher, providerKey, connectorBacked, err := service.providerForAccount(context.Background(), account.WorkspaceID, account)
	require.NoError(t, err)
	require.True(t, connectorBacked)
	require.Equal(t, "directus-main", providerKey)
	require.NotNil(t, publisher)

	request := &platform.PublishRequest{
		OperationID: "authorization:one:rendition:publish", OutputProfile: "directus.item", Content: "Hello",
	}
	request.SetWriteFence(func(platform.PublishResult) error { return nil }, func(platform.PublishResult) error { return nil })
	result, err := publisher.Publish(context.Background(), "", account.AccountID, request)
	require.NoError(t, err)
	require.Equal(t, "item-42", result.ExternalID)
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
}
