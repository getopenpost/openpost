CREATE TABLE idempotency_records (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
    http_status INTEGER NOT NULL DEFAULT 0,
    response_json TEXT NOT NULL DEFAULT '',
    resource_id TEXT NOT NULL DEFAULT '',
    job_id TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE UNIQUE INDEX idempotency_records_scope_key_idx
    ON idempotency_records (principal_id, workspace_id, operation_id, idempotency_key);

CREATE INDEX idempotency_records_expiry_idx
    ON idempotency_records (expires_at);
