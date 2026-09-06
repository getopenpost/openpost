CREATE UNIQUE INDEX IF NOT EXISTS publications_id_workspace_unique
    ON publications (id, workspace_id);

CREATE TABLE IF NOT EXISTS publication_authorizations (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    job_id TEXT NOT NULL DEFAULT '',
    workspace_id TEXT NOT NULL,
    publication_id TEXT NOT NULL,
    rendition_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_origin TEXT NOT NULL,
    actor_user_id TEXT NOT NULL DEFAULT '',
    actor_session_id TEXT NOT NULL DEFAULT '',
    actor_token_id TEXT NOT NULL DEFAULT '',
    actor_client_id TEXT NOT NULL DEFAULT '',
    actor_client_name TEXT NOT NULL DEFAULT '',
    publication_revision INTEGER NOT NULL,
    social_account_id TEXT NOT NULL,
    target_key TEXT NOT NULL,
    scheduled_at DATETIME NOT NULL,
    content_hash TEXT NOT NULL,
    media_hash TEXT NOT NULL,
    settings_hash TEXT NOT NULL,
    policy_mode TEXT NOT NULL,
    confirmed_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (publication_id, workspace_id) REFERENCES publications(id, workspace_id) ON DELETE CASCADE,
    UNIQUE (batch_id, rendition_id, action),
    CHECK (publication_revision > 0),
    CHECK (action IN ('publish', 'reply')),
    CHECK (actor_origin IN ('browser', 'api', 'mcp', 'cli', 'worker', 'legacy')),
    CHECK (
        (actor_origin = 'browser' AND actor_user_id <> '' AND actor_session_id <> '' AND actor_token_id = '') OR
        (actor_origin IN ('api', 'cli') AND actor_user_id <> '' AND actor_token_id <> '') OR
        (actor_origin = 'mcp' AND actor_user_id <> '' AND (actor_token_id <> '' OR actor_session_id <> '')) OR
        (actor_origin IN ('worker', 'legacy') AND actor_user_id <> '')
    ),
    CHECK (target_key <> ''),
    CHECK (content_hash LIKE 'sha256:%'),
    CHECK (media_hash LIKE 'sha256:%'),
    CHECK (settings_hash LIKE 'sha256:%'),
    CHECK (policy_mode IN ('immediate', 'scheduled', 'retry', 'reply_immediate', 'reply_scheduled', 'legacy_scheduled'))
);

CREATE INDEX IF NOT EXISTS publication_authorizations_publication_idx
    ON publication_authorizations (publication_id, confirmed_at);

CREATE INDEX IF NOT EXISTS publication_authorizations_batch_idx
    ON publication_authorizations (batch_id, rendition_id);

CREATE INDEX IF NOT EXISTS publication_authorizations_job_idx
    ON publication_authorizations (job_id);
