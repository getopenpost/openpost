package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConnectorBindingsKeepProviderInstallationsSeparate(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, runTestMigrations(t, db))
	seedMigrationUser(ctx, t, db)
	_, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, organization_id, name) VALUES ('workspace-connectors', 'org-migration', 'Connectors')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO social_accounts (
			id, workspace_id, slug, platform, account_id, access_token_encrypted
		) VALUES
			('account-one', 'workspace-connectors', 'directus-one', 'io.directus.items', 'posts', x'00'),
			('account-two', 'workspace-connectors', 'directus-two', 'io.directus.items', 'posts', x'00')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_installations (
			id, kind, provider_id, display_name, protocol_version,
			implementation_version, capability_revision, manifest_json,
			config_fingerprint, status, required, last_seen_at
		) VALUES
			('directus-one', 'connector', 'io.directus.items', 'Directus One', '1.0', '0.1.0', 'rev-1', '{}', 'sha256:one', 'available', 0, CURRENT_TIMESTAMP),
			('directus-two', 'connector', 'io.directus.items', 'Directus Two', '1.0', '0.1.0', 'rev-1', '{}', 'sha256:two', 'available', 0, CURRENT_TIMESTAMP)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_account_bindings (
			social_account_id, workspace_id, installation_id, connection_ref,
			external_account_id, capability_revision
		) VALUES
			('account-one', 'workspace-connectors', 'directus-one', 'one/posts', 'posts', 'rev-1'),
			('account-two', 'workspace-connectors', 'directus-two', 'two/posts', 'posts', 'rev-1')
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO social_accounts (
			id, workspace_id, slug, platform, account_id, access_token_encrypted
		) VALUES ('account-duplicate', 'workspace-connectors', 'duplicate', 'io.directus.items', 'posts', x'00')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_account_bindings (
			social_account_id, workspace_id, installation_id, connection_ref,
			external_account_id, capability_revision
		) VALUES ('account-duplicate', 'workspace-connectors', 'directus-one', 'one/posts', 'posts', 'rev-1')
	`)
	require.Error(t, err, "one external account can bind only once per Workspace and installation")

	_, err = db.ExecContext(ctx, "DELETE FROM provider_installations WHERE id = 'directus-one'")
	require.Error(t, err, "an installation with account history cannot be deleted")
}

func TestConnectorConnectionSessionStateIsBounded(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, runTestMigrations(t, db))
	seedMigrationUser(ctx, t, db)
	_, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, organization_id, name) VALUES ('workspace-connectors', 'org-migration', 'Connectors')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_installations (
			id, kind, provider_id, display_name, protocol_version,
			implementation_version, capability_revision, manifest_json,
			config_fingerprint, status, required, last_seen_at
		) VALUES ('directus-one', 'connector', 'io.directus.items', 'Directus', '1.0', '0.1.0', 'rev-1', '{}', 'sha256:one', 'available', 0, CURRENT_TIMESTAMP)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO connector_connection_sessions (
			id, workspace_id, installation_id, state, expires_at
		) VALUES ('session-1', 'workspace-connectors', 'directus-one', 'arbitrary', CURRENT_TIMESTAMP)
	`)
	require.Error(t, err)
}
