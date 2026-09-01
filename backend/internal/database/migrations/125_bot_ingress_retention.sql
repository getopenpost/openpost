ALTER TABLE bot_ingress_events
  ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;
