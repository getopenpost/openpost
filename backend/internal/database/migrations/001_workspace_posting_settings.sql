-- Add workspace settings for natural posting and time slot configuration
-- This migration is idempotent: duplicate column errors are ignored

ALTER TABLE workspaces ADD COLUMN random_delay_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN slot_start_hour INTEGER NOT NULL DEFAULT 5;
ALTER TABLE workspaces ADD COLUMN slot_end_hour INTEGER NOT NULL DEFAULT 23;
ALTER TABLE workspaces ADD COLUMN slot_interval_minutes INTEGER NOT NULL DEFAULT 15;
