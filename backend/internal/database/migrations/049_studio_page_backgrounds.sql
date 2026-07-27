-- 049: Persist structured Studio page backgrounds.

ALTER TABLE design_pages
  ADD COLUMN background_json TEXT NOT NULL DEFAULT '{}';
