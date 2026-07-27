package mastodonapps

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func createMastodonAppsTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.NewCreateTable().
		Model((*models.MastodonInstance)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	return db
}

func TestAdapterForInstanceRegistersAndCachesMastodonApp(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createMastodonAppsTestDB(t)
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")

	var registrationCalls int
	instanceServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/api/v1/apps", r.URL.Path)
		require.NoError(t, r.ParseForm())
		require.Equal(t, "OpenPost", r.Form.Get("client_name"))
		require.Equal(t, "urn:ietf:wg:oauth:2.0:oob", r.Form.Get("redirect_uris"))
		require.Equal(t, "read write", r.Form.Get("scopes"))
		require.Equal(t, "https://openpost.social", r.Form.Get("website"))
		registrationCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"client_id":"registered-client","client_secret":"registered-secret"}`))
	}))
	defer instanceServer.Close()

	service := NewService(db, encryptor, Options{
		RedirectURI: "urn:ietf:wg:oauth:2.0:oob",
		Website:     "https://openpost.social",
		HTTPClient:  instanceServer.Client(),
		Validator: func(_ context.Context, instanceURL *url.URL) error {
			require.Equal(t, "https", instanceURL.Scheme)
			return nil
		},
	})

	adapter, canonicalURL, err := service.AdapterForInstance(ctx, instanceServer.URL+"/ignored/path?x=1")
	require.NoError(t, err)
	require.NotNil(t, adapter)
	require.Equal(t, instanceServer.URL, canonicalURL)
	require.Equal(t, 1, registrationCalls)

	var stored models.MastodonInstance
	require.NoError(t, db.NewSelect().Model(&stored).Where("instance_url = ?", instanceServer.URL).Scan(ctx))
	require.Equal(t, "registered-client", stored.ClientID)
	require.Equal(t, "registered", stored.RegistrationStatus)
	require.NotEqual(t, []byte("registered-secret"), stored.ClientSecretEnc)
	decrypted, err := encryptor.Decrypt(stored.ClientSecretEnc)
	require.NoError(t, err)
	require.Equal(t, "registered-secret", decrypted)

	adapter, canonicalURL, err = service.AdapterForInstance(ctx, strings.TrimPrefix(instanceServer.URL, "https://"))
	require.NoError(t, err)
	require.NotNil(t, adapter)
	require.Equal(t, instanceServer.URL, canonicalURL)
	require.Equal(t, 1, registrationCalls)
}

func TestListActiveAppConfigsReturnsPersistedDynamicMastodonInstances(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createMastodonAppsTestDB(t)
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	secretEnc, err := encryptor.Encrypt("stored-secret")
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.MastodonInstance{
		ID:                 "instance-1",
		InstanceURL:        "https://masto.pt",
		Host:               "masto.pt",
		ClientID:           "stored-client",
		ClientSecretEnc:    secretEnc,
		RedirectURI:        "urn:ietf:wg:oauth:2.0:oob",
		Scopes:             defaultScopes,
		RegistrationStatus: registrationStatusActive,
	}).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, encryptor, Options{})
	configs, err := service.ListActiveAppConfigs(ctx)
	require.NoError(t, err)
	require.Len(t, configs, 1)
	require.Equal(t, "mastodon", configs[0].Provider)
	require.Equal(t, "masto.pt", configs[0].Name)
	require.Equal(t, "stored-client", configs[0].ClientID)
	require.Equal(t, "stored-secret", configs[0].ClientSecret)
	require.Equal(t, "https://masto.pt", configs[0].InstanceURL)
}

func TestAdapterForInstanceRejectsUnsafeURLs(t *testing.T) {
	t.Parallel()

	service := NewService(createMastodonAppsTestDB(t), crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), Options{
		RedirectURI: "urn:ietf:wg:oauth:2.0:oob",
	})

	_, _, err := service.AdapterForInstance(context.Background(), "http://mastodon.social")
	require.ErrorContains(t, err, "https")

	_, _, err = service.AdapterForInstance(context.Background(), "https://127.0.0.1")
	require.ErrorContains(t, err, "private or local")
}
