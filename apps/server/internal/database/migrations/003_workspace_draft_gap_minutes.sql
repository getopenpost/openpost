-- Add workspace setting for minimum gap between consecutive suggested draft times.
ALTER TABLE workspaces ADD COLUMN draft_gap_minutes INTEGER NOT NULL DEFAULT 60;
