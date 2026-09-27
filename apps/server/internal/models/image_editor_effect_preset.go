package models

import (
	"time"

	"github.com/uptrace/bun"
)

type ImageEditorEffectPreset struct {
	bun.BaseModel `bun:"table:image_editor_effect_presets"`
	WorkspaceID   string    `bun:",pk"`
	ID            string    `bun:",pk"`
	Name          string    `bun:",notnull"`
	EffectsJSON   string    `bun:"effects_json,notnull"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp"`
	UpdatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp"`
}
