package accountpreflight

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

type preflightTokens struct {
	err error
}

func (tokens preflightTokens) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token", tokens.err
}

type preflightAdapter struct {
	platform.Adapter
	err   error
	calls int
	empty bool
}

func (adapter *preflightAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	adapter.calls++
	if adapter.err != nil {
		return nil, adapter.err
	}
	if adapter.empty {
		return &platform.UserProfile{}, nil
	}
	return &platform.UserProfile{ID: "provider-account-1"}, nil
}

func preflightTestDB(t *testing.T) *bun.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:preflight-%d?mode=memory&cache=shared", time.Now().UnixNano())
	raw, err := sql.Open(sqliteshim.ShimName, dsn)
	require.NoError(t, err)
	db := bun.NewDB(raw, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	for _, model := range []any{
		(*models.SocialAccount)(nil), (*models.Publication)(nil), (*models.Rendition)(nil), (*models.Job)(nil),
		(*models.Organization)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.OAuthGrant)(nil), (*models.UserNotification)(nil), (*models.UserNotificationPreference)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewCreateIndex().Index("jobs_active_dedupe_unique_idx").Table("jobs").Column("type", "scope_id", "dedupe_key").Unique().Where("status IN ('pending', 'processing') AND scope_id <> '' AND dedupe_key <> ''").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `CREATE UNIQUE INDEX user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)
	return db
}

func seedPreflightCandidate(t *testing.T, db *bun.DB, runAt time.Time) {
	t.Helper()
	now := runAt.Add(-time.Hour)
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Slug: "account", Platform: "x",
		AccountID: "provider-account-1", AccountUsername: "Founder", CapabilityState: "{}",
		AccessTokenEnc: []byte("test-token"), IsActive: true, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Launch",
		SourceContent: "Launch", Status: models.PublicationStatusScheduled, ScheduledAt: runAt,
		ActualRunAt: runAt, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
		TargetKey: "x", Platform: "x", Profile: "post", Status: models.RenditionStatusScheduled,
		SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
}

// seedPreflightReconnectRecipients wires the account from
// seedPreflightCandidate to an OAuth grant consented by connectorID and to
// workspace members that cover every recipient filtering branch.
func seedPreflightReconnectRecipients(t *testing.T, db *bun.DB, connectorID string) {
	t.Helper()
	ctx := t.Context()
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Org"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthGrant{
		ID: "grant-1", WorkspaceID: "workspace-1", Provider: "x",
		ConsentedByID: connectorID, AccessTokenEnc: []byte("test-token"),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("oauth_grant_id = ?", "grant-1").
		Where("id = ?", "account-1").
		Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "admin-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "workspace-1", UserID: "admin-2", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "workspace-1", UserID: "editor-1", Role: "editor", Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "workspace-1", UserID: "admin-inactive", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusInactive},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)
}

func preflightNotificationRows(t *testing.T, db *bun.DB, userID string) []models.UserNotification {
	t.Helper()
	var rows []models.UserNotification
	require.NoError(t, db.NewSelect().Model(&rows).
		Where("user_id = ?", userID).
		OrderExpr("created_at ASC, id ASC").
		Scan(t.Context()))
	return rows
}

func requirePreflightNotifications(t *testing.T, db *bun.DB, userID string, want int, message string) {
	t.Helper()
	rows := preflightNotificationRows(t, db, userID)
	require.Len(t, rows, want, "%s: want %d notifications for %s, got %d", message, want, userID, len(rows))
}

func requirePreflightAccountState(t *testing.T, db *bun.DB, wantGeneration int64, wantFailure string) {
	t.Helper()
	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(t.Context()))
	require.Equal(t, wantGeneration, account.CredentialFailureGeneration)
	require.Equal(t, wantFailure, account.PreflightFailure)
}

// The connector who is also a workspace administrator is notified once.
func TestCredentialFailureTransitionDeduplicatesConnectorWhoIsAdmin(t *testing.T) {
	db := preflightTestDB(t)
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	seedPreflightCandidate(t, db, now.Add(time.Hour))
	seedPreflightReconnectRecipients(t, db, "admin-1")

	service := NewService(db, preflightTokens{}, notifications.NewService(db))
	service.now = func() time.Time { return now }
	service.SetProvider("x", &preflightAdapter{err: &platform.HTTPError{StatusCode: 401, Code: "invalid_token"}})

	require.NoError(t, service.HandleJob(t.Context(), JobType))
	requirePreflightAccountState(t, db, 1, "authentication")
	requirePreflightNotifications(t, db, "admin-1", 1, "the connector who is also an admin is notified once")
	requirePreflightNotifications(t, db, "admin-2", 1, "other administrators are notified once")
	requirePreflightNotifications(t, db, "user-1", 1, "the publication creator keeps the scheduled-at-risk warning")
}

func TestTransientChecksDoNotHideOrRepeatCredentialFailureNotifications(t *testing.T) {
	db := preflightTestDB(t)
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	seedPreflightCandidate(t, db, now.Add(100*time.Minute))
	seedPreflightReconnectRecipients(t, db, "connector-1")
	service := NewService(db, preflightTokens{}, notifications.NewService(db))
	transient := &platform.HTTPError{StatusCode: 503}
	authentication := &platform.HTTPError{StatusCode: 401, Code: "invalid_token"}
	steps := []struct {
		err        error
		generation int64
		failure    string
	}{
		{transient, 0, "unknown"},
		{authentication, 1, "authentication"},
		{transient, 1, "authentication"},
		{authentication, 1, "authentication"},
		{nil, 1, ""},
		{authentication, 2, "authentication"},
	}
	for index, step := range steps {
		service.now = func() time.Time { return now.Add(time.Duration(index) * (checkCadence + time.Minute)) }
		service.SetProvider("x", &preflightAdapter{err: step.err})
		require.NoError(t, service.HandleJob(t.Context(), JobType))
		requirePreflightAccountState(t, db, step.generation, step.failure)
		requirePreflightNotifications(t, db, "connector-1", int(step.generation), "one notification per confirmed credential break")
		requirePreflightNotifications(t, db, "admin-1", int(step.generation), "one notification per confirmed credential break")
	}
}
