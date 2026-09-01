CREATE TABLE IF NOT EXISTS telegram_publish_receipts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  request_index INTEGER NOT NULL,
  message_index INTEGER NOT NULL,
  request_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  safe_error_code TEXT NOT NULL DEFAULT '',
  sending_started_at DATETIME,
  accepted_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  UNIQUE (operation_id, message_index),
  CHECK (operation_id <> '' AND LENGTH(operation_id) <= 512),
  CHECK (request_index >= 0 AND message_index >= 0),
  CHECK (request_kind IN ('message', 'photo', 'video', 'document', 'media_group')),
  CHECK (status IN ('prepared', 'sending', 'accepted', 'failed')),
  CHECK ((status = 'accepted' AND message_id <> '' AND accepted_at IS NOT NULL) OR status <> 'accepted'),
  CHECK (LENGTH(message_id) <= 64),
  CHECK (LENGTH(safe_error_code) <= 96)
);

CREATE INDEX IF NOT EXISTS telegram_publish_receipts_rendition_idx
  ON telegram_publish_receipts (rendition_id, message_index);
