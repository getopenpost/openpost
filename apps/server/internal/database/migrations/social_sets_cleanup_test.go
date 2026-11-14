package migrations

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRemoveLegacyAllChannelsSocialSets(t *testing.T) {
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	ctx := t.Context()

	workspaces := []models.Workspace{
		{ID: "ws-1", Name: "Untouched legacy default"},
		{ID: "ws-2", Name: "Edited legacy default"},
		{ID: "ws-3", Name: "Custom set"},
		{ID: "ws-4", Name: "Renamed legacy default"},
		{ID: "ws-5", Name: "Legacy set that is no longer default"},
	}
	_, err := db.NewInsert().Model(&workspaces).Exec(ctx)
	require.NoError(t, err)

	accounts := []models.SocialAccount{
		{ID: "acc-1", WorkspaceID: "ws-1", Slug: "x", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-2", WorkspaceID: "ws-2", Slug: "x", Platform: "x", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `INSERT INTO social_sets (id, workspace_id, name, is_default, created_at, updated_at)
		VALUES
			('default:ws-1', 'ws-1', 'All channels', true,  '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
			('default:ws-2', 'ws-2', 'All channels', true,  '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
			('custom-ws-3',  'ws-3', 'All channels', true,  '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
			('default:ws-4', 'ws-4', 'Renamed',       true,  '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
			('default:ws-5', 'ws-5', 'All channels', false, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
			('gone-set',     'ws-3', 'Already deleted', false, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `INSERT INTO social_set_accounts (social_set_id, social_account_id, display_order, default_output_profile, created_at)
		VALUES ('default:ws-1', 'acc-1', 0, '', '2026-01-01 00:00:00'),
		       ('default:ws-2', 'acc-2', 0, '', '2026-01-01 00:00:00'),
		       ('gone-set', 'acc-2', 0, '', '2026-01-01 00:00:00')`)
	require.NoError(t, err)

	// SQLite schemas created from the models kept memberships when their set
	// was deleted because those tables have no cascade. Seed that leftover.
	_, err = db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM social_sets WHERE id = 'gone-set'`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `PRAGMA foreign_keys=ON`)
	require.NoError(t, err)

	require.NoError(t, removeLegacyAllChannelsSocialSets(ctx, db))

	var ids []string
	require.NoError(t, db.NewSelect().Model((*models.SocialSet)(nil)).Column("id").Order("id ASC").Scan(ctx, &ids))
	require.Equal(t, []string{"custom-ws-3", "default:ws-2", "default:ws-4", "default:ws-5"}, ids)

	var legacyMembers int64
	legacyMembers, err = db.NewSelect().Model((*models.SocialSetAccount)(nil)).
		Where("social_set_id = ?", "default:ws-1").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, legacyMembers)
	var editedMembers int64
	editedMembers, err = db.NewSelect().Model((*models.SocialSetAccount)(nil)).
		Where("social_set_id = ?", "default:ws-2").Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, editedMembers)
	orphaned, err := db.NewSelect().Model((*models.SocialSetAccount)(nil)).
		Where("social_set_id = ?", "gone-set").Exists(ctx)
	require.NoError(t, err)
	require.False(t, orphaned)
}
