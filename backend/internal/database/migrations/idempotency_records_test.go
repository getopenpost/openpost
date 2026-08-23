package migrations

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestIdempotencyRecordMigrationScopesKeysAndKeepsReplayEvidence(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("108_idempotency_records.sql")
	require.NoError(t, err)
	require.NoError(t, runMigration(t.Context(), db, migration{
		version: 108,
		name:    "108_idempotency_records.sql",
		sql:     string(raw),
	}))

	insert := func(id, principalID, workspaceID, requestHash string) error {
		_, insertErr := db.ExecContext(t.Context(), `
			INSERT INTO idempotency_records (
				id, principal_id, workspace_id, operation_id, idempotency_key,
				request_hash, state, http_status, response_json, expires_at
			) VALUES (?, ?, ?, 'create-publication', 'event-1', ?, 'completed', 201, '{"id":"publication-1"}', ?)
		`, id, principalID, workspaceID, requestHash, time.Now().UTC().Add(time.Hour))
		return insertErr
	}

	require.NoError(t, insert("record-1", "token:one", "workspace-1", "hash-a"))
	require.Error(t, insert("record-duplicate", "token:one", "workspace-1", "hash-a"))
	require.NoError(t, insert("record-other-token", "token:two", "workspace-1", "hash-a"))
	require.NoError(t, insert("record-other-workspace", "token:one", "workspace-2", "hash-a"))
}
