package publisher

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestLoadRenditionSegmentMediaPrefersContextualAltText(t *testing.T) {
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	ctx := context.Background()
	for _, model := range []interface{}{(*models.MediaAttachment)(nil), (*models.RenditionSegmentMedia)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&[]models.MediaAttachment{
		{ID: "image-1", WorkspaceID: "workspace-1", OriginalFilename: "image-1.png", MimeType: "image/png", Size: 1024, AltText: "Library description"},
		{ID: "image-2", WorkspaceID: "workspace-1", OriginalFilename: "image-2.png", MimeType: "image/png", Size: 1024, AltText: "Second library description"},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.RenditionSegmentMedia{
		{RenditionSegmentID: "segment-1", MediaID: "image-1", Role: "attachment", DisplayOrder: 0, AltText: "Publication description", SettingsJSON: "{}"},
		{RenditionSegmentID: "segment-1", MediaID: "image-2", Role: "attachment", DisplayOrder: 1, SettingsJSON: "{}"},
	}).Exec(ctx)
	require.NoError(t, err)

	_, altTexts, _, err := NewService(db, nil).loadRenditionSegmentMedia(ctx, "segment-1")
	require.NoError(t, err)
	require.Equal(t, []string{"Publication description", "Second library description"}, altTexts)
}
