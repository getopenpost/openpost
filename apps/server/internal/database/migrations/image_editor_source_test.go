package migrations

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestSourceEditingDesignMigrationAllowsReplacementAfterTrash(t *testing.T) {
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "source-workspace", Name: "Source editing"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "source-user", Email: "source@example.com"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{ID: "source-media", WorkspaceID: "source-workspace", FilePath: "source.png", MimeType: "image/png", FileHash: "source-hash", AssetKind: "library"}).Exec(t.Context())
	require.NoError(t, err)
	design := &models.DesignDocument{ID: "first-source-design", WorkspaceID: "source-workspace", CreatedByID: "source-user", Title: "Source", WidthPX: 1080, HeightPX: 1080, SourceMediaID: "source-media"}
	_, err = db.NewInsert().Model(design).Exec(t.Context())
	require.NoError(t, err)
	design.ID = "replacement-source-design"
	_, err = db.NewInsert().Model(design).Exec(t.Context())
	require.Error(t, err)
	_, err = db.Exec("UPDATE design_documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'first-source-design'")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(design).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.Exec("DELETE FROM media_attachments WHERE id = 'source-media'")
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.DesignDocument)(nil)).Where("source_media_id IS NOT NULL").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}
