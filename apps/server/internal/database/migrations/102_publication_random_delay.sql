ALTER TABLE publications ADD COLUMN random_delay_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN random_delay_explicit BOOLEAN NOT NULL DEFAULT FALSE;
