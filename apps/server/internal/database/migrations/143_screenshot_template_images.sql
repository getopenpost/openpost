CREATE TABLE IF NOT EXISTS screenshot_template_media_references (
    design_id TEXT NOT NULL REFERENCES screenshot_template_designs(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media_attachments(id) ON DELETE RESTRICT,
    PRIMARY KEY (design_id, media_id)
);
CREATE INDEX IF NOT EXISTS screenshot_template_media_references_media_idx
ON screenshot_template_media_references(media_id);

CREATE TABLE IF NOT EXISTS screenshot_template_recipe_media_references (
    export_media_id TEXT NOT NULL REFERENCES media_generation_recipes(media_id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media_attachments(id) ON DELETE RESTRICT,
    PRIMARY KEY (export_media_id, media_id),
    CHECK (export_media_id <> media_id)
);
CREATE INDEX IF NOT EXISTS screenshot_template_recipe_media_references_media_idx
ON screenshot_template_recipe_media_references(media_id);
