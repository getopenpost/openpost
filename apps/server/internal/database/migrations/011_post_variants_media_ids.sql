-- 011: Add media_ids column to post_variants.
--
-- The PostVariant model gained a `media_ids` column (JSON array of media IDs
-- override) but no migration was created for it. Existing databases that had
-- the post_variants table created before the column was added to the model
-- are missing it, which causes "no such column: pv.media_ids" errors in the
-- media cleanup background job.

ALTER TABLE post_variants ADD COLUMN media_ids TEXT NOT NULL DEFAULT '';
