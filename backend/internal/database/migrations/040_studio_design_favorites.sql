-- 040: Favorite Studio designs alongside media library assets.

ALTER TABLE design_documents
  ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT false;
