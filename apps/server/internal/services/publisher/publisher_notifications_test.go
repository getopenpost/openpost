package publisher

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

type reconnectNotificationServer struct {
	db      *bun.DB
	service *Service
}

func newReconnectNotificationServer(t *testing.T) *reconnectNotificationServer {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:reconnect-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.OAuthGrant)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.ExecContext(context.Background(), `CREATE UNIQUE INDEX user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	ctx := context.Background()
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Org"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthGrant{
		ID: "grant-1", WorkspaceID: "ws-1", Provider: "x",
		ConsentedByID: "connector-1", AccessTokenEnc: []byte("test-token"),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Platform: "x", AccountID: "x-account",
		Slug: "x-account", AccountUsername: "Founder", OAuthGrantID: "grant-1",
		AccessTokenEnc: []byte("test-token"), IsActive: true, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "admin-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "ws-1", UserID: "editor-1", Role: "editor", Status: models.WorkspaceMemberStatusActive},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, nil)
	service.SetNotificationService(notifications.NewService(db))
	return &reconnectNotificationServer{db: db, service: service}
}

// finalizeWithReconnectFailure drives the reconnect notification flow the way
// finalizePublication does: inside one transaction per publication result.
func (server *reconnectNotificationServer) finalizeWithReconnectFailure(
	ctx context.Context,
	publicationID string,
	failedAccountIDs []string,
) error {
	publication := &models.Publication{ID: publicationID, WorkspaceID: "ws-1", CreatedByID: "creator-1"}
	result := publicationNotificationResult{
		accounts: map[string]models.SocialAccount{
			"account-1": {ID: "account-1", WorkspaceID: "ws-1", Platform: "x", AccountUsername: "Founder", Slug: "x-account"},
		},
		reconnectAccountIDs: failedAccountIDs,
		reconnect:           true,
	}
	return server.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return server.service.createReconnectNotifications(txCtx, tx, publication, result, nil)
	})
}

func reconnectNotificationRows(t *testing.T, db *bun.DB, userID string) []models.UserNotification {
	t.Helper()
	var rows []models.UserNotification
	require.NoError(t, db.NewSelect().Model(&rows).
		Where("user_id = ?", userID).
		OrderExpr("created_at ASC, id ASC").
		Scan(t.Context()))
	return rows
}

// One credential break behind several failed publications notifies the
// creator once per publication, but claims the account's credential failure
// generation once and routes that transition to the connector and the active
// workspace administrators.
func TestCreateReconnectNotificationsClaimsCredentialGenerationOnce(t *testing.T) {
	server := newReconnectNotificationServer(t)
	ctx := context.Background()

	// Publication one has two failed destinations on the same account, so
	// both the creator warning and the claim tolerate repeated accounts.
	require.NoError(t, server.finalizeWithReconnectFailure(ctx, "publication-1", []string{"account-1", "account-1"}))
	// A second concurrently failed publication for the same account claims
	// again sequentially: the second claim must be a no-op.
	require.NoError(t, server.finalizeWithReconnectFailure(ctx, "publication-2", []string{"account-1"}))

	creatorRows := reconnectNotificationRows(t, server.db, "creator-1")
	require.Len(t, creatorRows, 2, "the creator keeps one warning per failed publication")
	require.Equal(t, "account_needs_attention:account-1:publication-1", creatorRows[0].DedupKey)
	require.Equal(t, "account_needs_attention:account-1:publication-2", creatorRows[1].DedupKey)

	connectorRows := reconnectNotificationRows(t, server.db, "connector-1")
	require.Len(t, connectorRows, 1, "the connector is notified once for the claimed generation")
	require.Equal(t, "account_needs_attention:account-1:1", connectorRows[0].DedupKey)
	require.Equal(t, "Connected account needs attention", connectorRows[0].Title)
	require.Contains(t, connectorRows[0].PayloadJSON, `"credential_generation":"1"`)

	require.Len(t, reconnectNotificationRows(t, server.db, "admin-1"), 1, "active administrators are notified once")
	require.Len(t, reconnectNotificationRows(t, server.db, "editor-1"), 0, "editors cannot reconnect the account")

	var account models.SocialAccount
	require.NoError(t, server.db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(ctx))
	require.Equal(t, int64(1), account.CredentialFailureGeneration, "one claim per credential break")
	require.Equal(t, FailureReconnectRequired, account.PreflightFailure, "the claimed break marks the account unhealthy")
}

func TestPublicationCredentialFailureAfterTransientCheck(t *testing.T) {
	for _, previous := range []string{"unknown", "unsupported"} {
		t.Run(previous, func(t *testing.T) {
			server := newReconnectNotificationServer(t)
			_, err := server.db.NewUpdate().Model((*models.SocialAccount)(nil)).
				Set("preflight_failure = ?", previous).Where("id = ?", "account-1").Exec(t.Context())
			require.NoError(t, err)
			require.NoError(t, server.finalizeWithReconnectFailure(t.Context(), "publication-1", []string{"account-1"}))
			require.Len(t, reconnectNotificationRows(t, server.db, "connector-1"), 1)
			require.Len(t, reconnectNotificationRows(t, server.db, "admin-1"), 1)
		})
	}
}

func TestReconnectFailureOlderThanPreflightSuccessSkippedAfterInconclusiveCheck(t *testing.T) {
	server := newReconnectNotificationServer(t)
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Second)
	staleFailureAt := now.Add(-10 * time.Minute)
	confirmedHealthyAt := now.Add(-5 * time.Minute)
	inconclusiveCheckAt := now.Add(-1 * time.Minute)
	freshFailureAt := now

	_, err := server.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("preflight_success_at = ?", confirmedHealthyAt).
		Set("preflight_checked_at = ?", inconclusiveCheckAt).
		Set("preflight_failure = ?", "unknown").
		Where("id = ?", "account-1").
		Exec(ctx)
	require.NoError(t, err)

	// Even if the caller holds an older snapshot without PreflightSuccessAt,
	// the DB claim must reject a failure older than preflight_success_at.
	publication := &models.Publication{ID: "publication-stale", WorkspaceID: "ws-1", CreatedByID: "creator-1"}
	result := publicationNotificationResult{
		accounts: map[string]models.SocialAccount{
			"account-1": {ID: "account-1", WorkspaceID: "ws-1", Platform: "x", AccountUsername: "Founder", Slug: "x-account"},
		},
		reconnectAccountIDs: []string{"account-1"},
		reconnect:           true,
	}
	staleRenditions := []models.Rendition{{
		ID:              "rendition-stale",
		SocialAccountID: "account-1",
		Status:          models.RenditionStatusFailed,
		ErrorAction:     FailureActionReconnect,
		ErrorKind:       FailureReconnectRequired,
		UpdatedAt:       staleFailureAt,
	}}
	require.NoError(t, server.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return server.service.createReconnectNotifications(txCtx, tx, publication, result, staleRenditions)
	}))
	require.Empty(t, reconnectNotificationRows(t, server.db, "connector-1"), "stale failure before preflight_success_at must not claim a new generation")

	// A fresh reconnect failure after preflight_success_at must still claim.
	freshRenditions := []models.Rendition{{
		ID:              "rendition-fresh",
		SocialAccountID: "account-1",
		Status:          models.RenditionStatusFailed,
		ErrorAction:     FailureActionReconnect,
		ErrorKind:       FailureReconnectRequired,
		UpdatedAt:       freshFailureAt,
	}}
	freshPublication := &models.Publication{ID: "publication-fresh", WorkspaceID: "ws-1", CreatedByID: "creator-1"}
	require.NoError(t, server.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return server.service.createReconnectNotifications(txCtx, tx, freshPublication, result, freshRenditions)
	}))
	require.Len(t, reconnectNotificationRows(t, server.db, "connector-1"), 1)
	require.Len(t, reconnectNotificationRows(t, server.db, "admin-1"), 1)
}
