ALTER TABLE renditions ADD COLUMN error_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE renditions ADD COLUMN error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE renditions ADD COLUMN error_http_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE renditions ADD COLUMN error_retryable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE renditions ADD COLUMN error_retry_at TIMESTAMP;
ALTER TABLE renditions ADD COLUMN error_action TEXT NOT NULL DEFAULT '';

ALTER TABLE rendition_segments ADD COLUMN error_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE rendition_segments ADD COLUMN error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE rendition_segments ADD COLUMN error_http_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rendition_segments ADD COLUMN error_retryable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rendition_segments ADD COLUMN error_retry_at TIMESTAMP;
ALTER TABLE rendition_segments ADD COLUMN error_action TEXT NOT NULL DEFAULT '';
