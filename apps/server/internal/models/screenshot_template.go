package models

import (
	"time"

	"github.com/uptrace/bun"
)

// ScreenshotTemplateDesign stores editable content independently of immutable exports.
type ScreenshotTemplateDesign struct {
	bun.BaseModel `bun:"table:screenshot_template_designs"`
	ID            string    `bun:",pk"`
	WorkspaceID   string    `bun:",notnull"`
	CreatedByID   string    `bun:",nullzero"`
	Title         string    `bun:",notnull"`
	TemplateID    string    `bun:",notnull"`
	Revision      int       `bun:",notnull"`
	DocumentJSON  string    `bun:",notnull"`
	CreatedAt     time.Time `bun:",notnull"`
	UpdatedAt     time.Time `bun:",notnull"`
}

// ScreenshotTemplateMediaReference keeps images owned by editable drafts.
type ScreenshotTemplateMediaReference struct {
	bun.BaseModel `bun:"table:screenshot_template_media_references"`
	DesignID      string `bun:",pk"`
	MediaID       string `bun:",pk"`
}

// ScreenshotTemplateRecipeMediaReference retains sources for immutable exported recipes.
type ScreenshotTemplateRecipeMediaReference struct {
	bun.BaseModel `bun:"table:screenshot_template_recipe_media_references"`
	ExportMediaID string `bun:",pk"`
	MediaID       string `bun:",pk"`
}
