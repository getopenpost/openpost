-- 074: Split provider media delivery state by its real aggregate owner.
--
-- provider_media_states was created as post-owned in migration 020, then
-- gained a rendition_id column in migration 027. The rendition publisher
-- nevertheless wrote the rendition ID into post_id, which violates the
-- posts foreign key whenever foreign-key enforcement is enabled. Keep legacy
-- post publishing and canonical rendition publishing in separate tables so
-- each path has enforceable ownership instead of a polymorphic identifier.

CREATE UNIQUE INDEX IF NOT EXISTS posts_media_delivery_owner_idx
  ON posts (id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS publications_media_delivery_owner_idx
  ON publications (id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS renditions_media_delivery_owner_idx
  ON renditions (id, publication_id, social_account_id, platform);

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_media_delivery_owner_idx
  ON social_accounts (id, workspace_id, platform);

CREATE UNIQUE INDEX IF NOT EXISTS media_attachments_media_delivery_owner_idx
  ON media_attachments (id, workspace_id);

CREATE TABLE IF NOT EXISTS post_media_deliveries (
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider_media_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (post_id, social_account_id, media_id),
  FOREIGN KEY (post_id, workspace_id)
    REFERENCES posts(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id, workspace_id, platform)
    REFERENCES social_accounts(id, workspace_id, platform) ON DELETE CASCADE,
  FOREIGN KEY (media_id, workspace_id)
    REFERENCES media_attachments(id, workspace_id) ON DELETE CASCADE,
  CHECK (status IN ('ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS post_media_deliveries_account_status_idx
  ON post_media_deliveries (social_account_id, status);

CREATE INDEX IF NOT EXISTS post_media_deliveries_media_idx
  ON post_media_deliveries (media_id);

CREATE TABLE IF NOT EXISTS rendition_media_deliveries (
  workspace_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider_media_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  session_state_encrypted BLOB,
  uploaded_bytes BIGINT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  session_expires_at TIMESTAMP,
  last_checked_at TIMESTAMP,
  retry_classification TEXT NOT NULL DEFAULT 'safe_resume',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (rendition_id, media_id),
  FOREIGN KEY (publication_id, workspace_id)
    REFERENCES publications(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (rendition_id, publication_id, social_account_id, platform)
    REFERENCES renditions(id, publication_id, social_account_id, platform) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id, workspace_id, platform)
    REFERENCES social_accounts(id, workspace_id, platform) ON DELETE CASCADE,
  FOREIGN KEY (media_id, workspace_id)
    REFERENCES media_attachments(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (rendition_id, media_id)
    REFERENCES rendition_media(rendition_id, media_id) ON DELETE CASCADE,
  CHECK (status IN ('pending', 'uploading', 'uploaded', 'ready', 'failed')),
  CHECK (retry_classification IN ('none', 'safe_resume', 'reconcile', 'terminal')),
  CHECK (uploaded_bytes >= 0),
  CHECK (total_bytes >= 0),
  CHECK (total_bytes = 0 OR uploaded_bytes <= total_bytes)
);

CREATE INDEX IF NOT EXISTS rendition_media_deliveries_account_status_idx
  ON rendition_media_deliveries (social_account_id, status);

CREATE INDEX IF NOT EXISTS rendition_media_deliveries_retry_idx
  ON rendition_media_deliveries (status, retry_classification, updated_at);

CREATE INDEX IF NOT EXISTS rendition_media_deliveries_publication_idx
  ON rendition_media_deliveries (publication_id);

CREATE INDEX IF NOT EXISTS rendition_media_deliveries_media_idx
  ON rendition_media_deliveries (media_id);

CREATE UNIQUE INDEX IF NOT EXISTS rendition_media_deliveries_relation_owner_idx
  ON rendition_media_deliveries (rendition_id, media_id, workspace_id);

CREATE TABLE IF NOT EXISTS rendition_media_delivery_relations (
  workspace_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  delivery_media_id TEXT NOT NULL,
  role TEXT NOT NULL,
  related_media_id TEXT NOT NULL,
  PRIMARY KEY (rendition_id, delivery_media_id, role),
  FOREIGN KEY (rendition_id, delivery_media_id, workspace_id)
    REFERENCES rendition_media_deliveries(rendition_id, media_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (related_media_id, workspace_id)
    REFERENCES media_attachments(id, workspace_id) ON DELETE CASCADE,
  CHECK (role IN ('cover', 'thumbnail', 'caption'))
);

CREATE INDEX IF NOT EXISTS rendition_media_delivery_relations_media_idx
  ON rendition_media_delivery_relations (related_media_id, workspace_id);

-- Preserve valid legacy post-owned cache entries.
INSERT INTO post_media_deliveries (
  workspace_id, post_id, social_account_id, media_id, platform,
  provider_media_id, status, error_message, created_at, updated_at
)
SELECT
  p.workspace_id, state.post_id, state.social_account_id, state.media_id,
  state.platform, state.platform_media_id,
  CASE WHEN state.status = 'failed' THEN 'failed' ELSE 'ready' END,
  COALESCE(state.error_message, ''), state.created_at,
  COALESCE(state.updated_at, state.created_at)
FROM provider_media_states AS state
JOIN posts AS p ON p.id = state.post_id
JOIN social_accounts AS account
  ON account.id = state.social_account_id
 AND account.workspace_id = p.workspace_id
 AND account.platform = state.platform
JOIN media_attachments AS media
  ON media.id = state.media_id
 AND media.workspace_id = p.workspace_id
WHERE COALESCE(state.rendition_id, '') = ''
ON CONFLICT (post_id, social_account_id, media_id) DO NOTHING;

-- Preserve any rendition rows written by databases that historically ran
-- with foreign keys disabled, but only when every owner relation is valid.
INSERT INTO rendition_media_deliveries (
  workspace_id, publication_id, rendition_id, social_account_id, media_id,
  platform, provider_media_id, status, retry_classification, error_message,
  created_at, updated_at
)
SELECT
  publication.workspace_id, rendition.publication_id, rendition.id,
  state.social_account_id, state.media_id, state.platform,
  state.platform_media_id,
  CASE WHEN state.status = 'failed' THEN 'failed' ELSE 'ready' END,
  CASE WHEN state.status = 'failed' THEN 'terminal' ELSE 'none' END,
  COALESCE(state.error_message, ''), state.created_at,
  COALESCE(state.updated_at, state.created_at)
FROM provider_media_states AS state
JOIN renditions AS rendition
  ON rendition.id = state.rendition_id
 AND rendition.social_account_id = state.social_account_id
 AND rendition.platform = state.platform
JOIN publications AS publication
  ON publication.id = rendition.publication_id
JOIN social_accounts AS account
  ON account.id = state.social_account_id
 AND account.workspace_id = publication.workspace_id
 AND account.platform = state.platform
JOIN rendition_media AS rendition_media
  ON rendition_media.rendition_id = rendition.id
 AND rendition_media.media_id = state.media_id
JOIN media_attachments AS media
  ON media.id = state.media_id
 AND media.workspace_id = publication.workspace_id
WHERE COALESCE(state.rendition_id, '') <> ''
ON CONFLICT (rendition_id, media_id) DO NOTHING;

DROP TABLE provider_media_states;
