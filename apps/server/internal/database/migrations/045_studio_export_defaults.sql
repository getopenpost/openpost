-- 045: Persist each Studio design's chosen export format and quality.

ALTER TABLE design_documents
  ADD COLUMN export_format TEXT NOT NULL DEFAULT 'png';

ALTER TABLE design_documents
  ADD COLUMN export_quality REAL NOT NULL DEFAULT 0.92;

UPDATE design_documents
SET export_format = 'jpeg'
WHERE preset_key = 'youtube-thumbnail';
