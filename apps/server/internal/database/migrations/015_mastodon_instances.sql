CREATE TABLE IF NOT EXISTS mastodon_instances (
    id TEXT PRIMARY KEY,
    instance_url TEXT NOT NULL UNIQUE,
    host TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_encrypted BLOB NOT NULL,
    redirect_uri TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'read write',
    registration_status TEXT NOT NULL DEFAULT 'registered',
    last_verified_at TIMESTAMP,
    blocked_at TIMESTAMP,
    block_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mastodon_instances_host_idx ON mastodon_instances(host);
CREATE INDEX IF NOT EXISTS mastodon_instances_status_idx ON mastodon_instances(registration_status);
