-- Native post imports live in their own library tables, separate from
-- analytics. Analytics reads publications and renditions only, so imported
-- rows can never clutter analytics views. A post_import_states row exists
-- only after explicit per-account opt-in; enabling sets the watermark to
-- now so activation never backfills provider history.

CREATE TABLE IF NOT EXISTS imported_posts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    social_account_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    provider_post_id TEXT NOT NULL,
    provider_parent_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    external_url TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMP NOT NULL,
    origin TEXT NOT NULL DEFAULT 'external',
    first_seen_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (social_account_id, provider_post_id)
);

CREATE INDEX IF NOT EXISTS imported_posts_workspace_account_published_idx
    ON imported_posts (workspace_id, social_account_id, published_at DESC);

CREATE TABLE IF NOT EXISTS post_import_states (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    social_account_id TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'partial',
    cursor TEXT NOT NULL DEFAULT '',
    import_watermark TIMESTAMP,
    cycle_started_at TIMESTAMP,
    initial_finished_at TIMESTAMP,
    initial_items_seen INTEGER NOT NULL DEFAULT 0,
    read_budget_start TIMESTAMP,
    read_budget_used INTEGER NOT NULL DEFAULT 0,
    last_attempted_at TIMESTAMP,
    last_success_at TIMESTAMP,
    failure_code TEXT NOT NULL DEFAULT '',
    failure_message TEXT NOT NULL DEFAULT '',
    next_eligible_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS post_import_states_platform_budget_idx
    ON post_import_states (platform, read_budget_start);
