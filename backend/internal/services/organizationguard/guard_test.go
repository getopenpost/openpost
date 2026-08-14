package organizationguard

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestWithWorkspaceRejectsJobAfterOrganizationDeletion(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.Organization)(nil), (*models.Workspace)(nil), (*models.Job)(nil)} {
		_, err = db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Studio", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Studio", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewDelete().Model((*models.Organization)(nil)).Where("id = ?", "organization-1").Exec(t.Context())
	require.NoError(t, err)

	err = WithWorkspace(t.Context(), db, "workspace-1", func(ctx context.Context, fenced bun.IDB) error {
		_, insertErr := fenced.NewInsert().Model(&models.Job{ID: "late-job", Type: "test", Payload: `{}`, Status: "pending", RunAt: now}).Exec(ctx)
		return insertErr
	})
	require.ErrorIs(t, err, sql.ErrNoRows)
	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}
