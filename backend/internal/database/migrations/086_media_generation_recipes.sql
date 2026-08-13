-- 086: Durable, media-owned generation recipes.

CREATE TABLE IF NOT EXISTS media_generation_recipes (
  media_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_id TEXT,
  kind TEXT NOT NULL,
  renderer_key TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_name TEXT NOT NULL DEFAULT '',
  template_source_url TEXT NOT NULL DEFAULT '',
  catalog_revision TEXT NOT NULL DEFAULT '',
  recipe_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS media_generation_recipes_workspace_created_idx
  ON media_generation_recipes (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS media_generation_recipes_template_idx
  ON media_generation_recipes (renderer_key, template_id);
