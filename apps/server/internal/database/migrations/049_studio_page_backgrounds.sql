-- 049: Persist structured Studio page backgrounds.

ALTER TABLE design_pages
  ADD COLUMN background_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE design_documents
  ADD COLUMN export_matte_color TEXT NOT NULL DEFAULT '#ffffff';
