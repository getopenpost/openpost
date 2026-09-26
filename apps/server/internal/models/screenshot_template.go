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
