package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesMastodonInstancesSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'mastodon_instances'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "instance_url TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "client_secret_encrypted BLOB NOT NULL")
	require.Contains(t, schema, "registration_status TEXT NOT NULL DEFAULT 'registered'")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('mastodon_instances_host_idx', 'mastodon_instances_status_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)

	_, err := db.NewInsert().Model(&models.MastodonInstance{
		ID:              "masto-1",
		InstanceURL:     "https://mastodon.social",
		Host:            "mastodon.social",
		ClientID:        "client",
		ClientSecretEnc: []byte("encrypted"),
		RedirectURI:     "urn:ietf:wg:oauth:2.0:oob",
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.MastodonInstance{
		ID:              "masto-2",
		InstanceURL:     "https://mastodon.social",
		Host:            "mastodon.social",
		ClientID:        "client-2",
		ClientSecretEnc: []byte("encrypted-2"),
		RedirectURI:     "urn:ietf:wg:oauth:2.0:oob",
	}).Exec(ctx)
	require.Error(t, err)
}
