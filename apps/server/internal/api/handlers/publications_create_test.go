package handlers

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"
)

func createIdempotencyRecordTable(t *testing.T, db interface {
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
}) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `
		CREATE TABLE idempotency_records (
			id TEXT PRIMARY KEY,
			principal_id TEXT NOT NULL,
			workspace_id TEXT NOT NULL,
			operation_id TEXT NOT NULL,
			idempotency_key TEXT NOT NULL,
			request_hash TEXT NOT NULL,
			state TEXT NOT NULL,
			http_status INTEGER NOT NULL DEFAULT 0,
			response_json TEXT NOT NULL DEFAULT '',
			resource_id TEXT NOT NULL DEFAULT '',
			job_id TEXT NOT NULL DEFAULT '',
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP NOT NULL,
			completed_at TIMESTAMP
		);
		CREATE UNIQUE INDEX idempotency_records_scope_key_idx
		ON idempotency_records (principal_id, workspace_id, operation_id, idempotency_key);
	`)
	require.NoError(t, err)
}
