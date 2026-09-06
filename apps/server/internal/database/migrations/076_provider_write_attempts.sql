CREATE UNIQUE INDEX IF NOT EXISTS publication_authorizations_provider_write_owner_idx
    ON publication_authorizations (
        id, workspace_id, publication_id, rendition_id, social_account_id, target_key
    );

CREATE UNIQUE INDEX IF NOT EXISTS publications_provider_write_owner_idx
    ON publications (id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS renditions_provider_write_owner_idx
    ON renditions (id, publication_id, social_account_id, platform);

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_provider_write_owner_idx
    ON social_accounts (id, workspace_id, platform);

CREATE TABLE IF NOT EXISTS provider_write_attempts (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    job_id TEXT NOT NULL DEFAULT '',
    authorization_id TEXT,
    workspace_id TEXT NOT NULL,
    publication_id TEXT,
    rendition_id TEXT,
    social_account_id TEXT NOT NULL,
    target_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    submission_state TEXT NOT NULL,
    provider_state TEXT NOT NULL DEFAULT '',
    provider_reference TEXT NOT NULL DEFAULT '',
    retry_safety TEXT NOT NULL,
    idempotency_key TEXT NOT NULL DEFAULT '',
    idempotency_expires_at DATETIME,
    external_id TEXT NOT NULL DEFAULT '',
    external_url TEXT NOT NULL DEFAULT '',
    safe_error_class TEXT NOT NULL DEFAULT '',
    safe_error_code TEXT NOT NULL DEFAULT '',
    error_http_status INTEGER NOT NULL DEFAULT 0,
    reconcile_after DATETIME,
    sending_started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    updated_at DATETIME NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (
        authorization_id, workspace_id, publication_id, rendition_id,
        social_account_id, target_key
    ) REFERENCES publication_authorizations (
        id, workspace_id, publication_id, rendition_id,
        social_account_id, target_key
    ) ON DELETE CASCADE,
    FOREIGN KEY (publication_id, workspace_id)
        REFERENCES publications(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (rendition_id, publication_id, social_account_id, provider)
        REFERENCES renditions(id, publication_id, social_account_id, platform) ON DELETE CASCADE,
    FOREIGN KEY (social_account_id, workspace_id, provider)
        REFERENCES social_accounts(id, workspace_id, platform) ON DELETE CASCADE,
    UNIQUE (operation_id, attempt_number),
    CHECK (attempt_number > 0),
    CHECK (operation_id <> ''),
    CHECK (target_key <> ''),
    CHECK (provider <> ''),
    CHECK (operation <> ''),
    CHECK (payload_fingerprint LIKE 'sha256:%'),
    CHECK (status IN ('prepared', 'sending', 'accepted', 'definite_failure', 'ambiguous')),
    CHECK (submission_state IN ('not_sent', 'accepted', 'pending', 'rejected', 'unknown')),
    CHECK (retry_safety IN ('safe', 'idempotent', 'reconcile_only', 'never')),
    CHECK (error_http_status >= 0 AND error_http_status <= 599),
    CHECK (
        (authorization_id IS NULL AND publication_id IS NULL AND rendition_id IS NULL) OR
        (authorization_id IS NOT NULL AND publication_id IS NOT NULL AND rendition_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_write_attempts_active_operation_idx
    ON provider_write_attempts (operation_id)
    WHERE status IN ('prepared', 'sending');

CREATE INDEX IF NOT EXISTS provider_write_attempts_job_idx
    ON provider_write_attempts (job_id, status);

CREATE INDEX IF NOT EXISTS provider_write_attempts_authorization_idx
    ON provider_write_attempts (authorization_id, created_at);

CREATE INDEX IF NOT EXISTS provider_write_attempts_subject_idx
    ON provider_write_attempts (workspace_id, social_account_id, operation, created_at);

CREATE INDEX IF NOT EXISTS provider_write_attempts_reconcile_idx
    ON provider_write_attempts (status, retry_safety, reconcile_after);
