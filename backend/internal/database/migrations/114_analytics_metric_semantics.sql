ALTER TABLE analytics_account_snapshots
  ADD COLUMN metric_metadata_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE analytics_rendition_snapshots
  ADD COLUMN metric_metadata_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE analytics_sync_states
  ADD COLUMN metric_metadata_json TEXT NOT NULL DEFAULT '{}';
