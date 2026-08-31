package migrations

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsProviderAppsEnforcesOneAppPerProviderInstance(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	require.NoError(t, runTestMigrations(t, db))

	for _, column := range []string{"connection_mode", "bot_token_encrypted", "bot_username", "webhook_secret_encrypted"} {
		var count int
		require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM pragma_table_info('provider_apps') WHERE name = ?`, column).Scan(ctx, &count))
		require.Equal(t, 1, count, column)
	}

	_, err := db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id)
		VALUES ('x-1', 'x', 'client-1')
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id)
		VALUES ('x-2', 'x', 'client-2')
	`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "unique")

	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id, instance_url)
		VALUES ('mastodon-1', 'mastodon', 'client-1', 'https://masto.pt')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id, instance_url)
		VALUES ('mastodon-2', 'mastodon', 'client-2', 'https://example.social')
	`)
	require.NoError(t, err)
}
