-- prepareMigration extends provider-readiness operation/check constraints for
-- observation and analytics on both SQLite and PostgreSQL before this SQL runs.
ALTER TABLE bot_ingress_events ADD COLUMN content_profile TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_ingress_events ADD COLUMN content_text TEXT NOT NULL DEFAULT '';
ALTER TABLE bot_ingress_events ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}';
