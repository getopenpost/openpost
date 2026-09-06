CREATE TABLE IF NOT EXISTS ai_prompt_overrides (
    key TEXT PRIMARY KEY,
    value_encrypted BLOB NOT NULL,
    updated_by_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_overrides_updated_by
    ON ai_prompt_overrides(updated_by_id);
