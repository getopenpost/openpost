package tokenmanager

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/stretchr/testify/require"
)

func TestPermanentRefreshFailureNotifiesConnectorAndAdminOncePerGeneration(t *testing.T) {
	db := newGrantSQLiteDB(t)
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	_, err := db.ExecContext(t.Context(), `CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)

	encryptor := crypto.NewTokenEncryptor("grant-notify-secret")
	seedSharedGrant(t, db, encryptor)

	_, err = db.NewInsert().Model(&[]models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "user-connector", Role: "editor", Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "workspace-1", UserID: "user-admin", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "workspace-1", UserID: "user-editor", Role: "editor", Status: models.WorkspaceMemberStatusActive},
	}).Exec(t.Context())
	require.NoError(t, err)

	_, err = db.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("consented_by_id = ?", "user-connector").
		Where("id = ?", "grant-shared").
		Exec(t.Context())
	require.NoError(t, err)

	notifSvc := notifications.NewService(db)
	manager := NewTokenManager(db, encryptor)
	manager.SetNotifications(notifSvc)

	adapter := &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialRefreshToken,
		},
		refreshErr: &platform.HTTPError{StatusCode: 401, Code: "invalid_grant"},
	}
	manager.SetProvider("linkedin", adapter)

	// First permanent failure claims generation 1 and notifies connector + admin.
	_, err = manager.ForceRefreshGrant(t.Context(), "grant-shared")
	require.Error(t, err)

	var firstBatch []models.UserNotification
	require.NoError(t, db.NewSelect().Model(&firstBatch).OrderExpr("user_id ASC, id ASC").Scan(t.Context()))
	recipients := map[string]int{}
	for _, n := range firstBatch {
		require.Equal(t, notifications.TypeAccountNeedsAttention, n.Type)
		recipients[n.UserID]++
	}
	require.GreaterOrEqual(t, recipients["user-connector"], 1)
	require.GreaterOrEqual(t, recipients["user-admin"], 1)
	require.Zero(t, recipients["user-editor"], "non-admin non-connector must not receive reconnect alert")

	// Second failure for the same unhealthy break must not spam another generation.
	_, err = manager.ForceRefreshGrant(t.Context(), "grant-shared")
	require.Error(t, err)

	var secondBatch []models.UserNotification
	require.NoError(t, db.NewSelect().Model(&secondBatch).Scan(t.Context()))
	require.Len(t, secondBatch, len(firstBatch))

	// A successful refresh heals preflight_failure so a later break claims a fresh generation.
	adapter.refreshErr = nil
	adapter.tokenResp = &platform.TokenResult{
		AccessToken:  "healed-access",
		RefreshToken: "healed-refresh",
		ExpiresIn:    int((2 * time.Hour).Seconds()),
	}
	_, err = manager.ForceRefreshGrant(t.Context(), "grant-shared")
	require.NoError(t, err)

	adapter.refreshErr = &platform.HTTPError{StatusCode: 401, Code: "invalid_grant"}
	adapter.tokenResp = nil
	_, err = manager.ForceRefreshGrant(t.Context(), "grant-shared")
	require.Error(t, err)

	var thirdBatch []models.UserNotification
	require.NoError(t, db.NewSelect().Model(&thirdBatch).Scan(t.Context()))
	require.Greater(t, len(thirdBatch), len(firstBatch))
}
