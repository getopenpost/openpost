package accountpreflight

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
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

type preflightNotifications struct {
	count int
}

func (recorder *preflightNotifications) Record(context.Context, notifications.Outcome) error {
	recorder.count++
	return nil
}

func TestHandleJobWarnsOnlyForConfirmedUserActionFailure(t *testing.T) {
	tests := []struct {
		name         string
		err          error
		tokenErr     error
		emptyProfile bool
		wantWarning  bool
		wantFailure  string
		wantSuccess  bool
	}{
		{name: "healthy", wantSuccess: true},
		{name: "expired token", err: &platform.HTTPError{StatusCode: 401, Code: "invalid_token"}, wantWarning: true, wantFailure: "authentication"},
		{name: "expired token without refresh support", tokenErr: fmt.Errorf("token expired for account account-1 and provider does not support refresh"), wantWarning: true, wantFailure: "authentication"},
		{name: "missing permission", err: &platform.HTTPError{StatusCode: 403, Code: "permission_denied"}, wantWarning: true, wantFailure: "permission"},
		{name: "unclassified forbidden", err: &platform.HTTPError{StatusCode: 403}, wantFailure: "unknown"},
		{name: "rate limit", err: &platform.HTTPError{StatusCode: 429, Code: "rate_limit"}, wantFailure: "unknown"},
		{name: "malformed response", err: fmt.Errorf("decoding profile response"), wantFailure: "unknown"},
		{name: "empty profile", emptyProfile: true, wantFailure: "unknown"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := preflightTestDB(t)
			now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
			seedPreflightCandidate(t, db, now.Add(time.Hour))
			adapter := &preflightAdapter{err: test.err, empty: test.emptyProfile}
			recorder := &preflightNotifications{}
			service := NewService(db, preflightTokens{err: test.tokenErr}, recorder)
			service.now = func() time.Time { return now }
			service.SetProvider("x", adapter)

			require.NoError(t, service.HandleJob(t.Context(), JobType))
			if test.tokenErr != nil {
				require.Zero(t, adapter.calls)
			} else {
				require.Equal(t, 1, adapter.calls)
			}
			if test.wantWarning {
				require.Equal(t, 1, recorder.count)
			} else {
				require.Zero(t, recorder.count)
			}
			var account models.SocialAccount
			require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(t.Context()))
			require.Equal(t, test.wantFailure, account.PreflightFailure)
			require.Equal(t, now, account.PreflightCheckedAt)
			if test.wantWarning {
				require.Equal(t, now, account.PreflightWarnedAt)
				service.now = func() time.Time { return now.Add(checkCadence + time.Minute) }
				require.NoError(t, service.HandleJob(t.Context(), JobType))
				require.Equal(t, 1, recorder.count, "repeat checks must not send another warning during the cooldown")
			} else {
				require.True(t, account.PreflightWarnedAt.IsZero())
			}
			if test.wantSuccess {
				require.Equal(t, now, account.PreflightSuccessAt)
			} else {
				require.True(t, account.PreflightSuccessAt.IsZero())
			}
		})
	}
}

func preflightTestDB(t *testing.T) *bun.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:preflight-%d?mode=memory&cache=shared", time.Now().UnixNano())
	raw, err := sql.Open("sqlite3", dsn)
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

func TestProviderMatchesTheAccountSpecificAdapter(t *testing.T) {
	db := preflightTestDB(t)
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	runAt := now.Add(30 * time.Minute)

	accounts := []models.SocialAccount{
		{ID: "account-bluesky-default", WorkspaceID: "workspace-1", Slug: "bluesky-default", Platform: "bluesky",
			AccountID: "provider-bluesky-default", AccountUsername: "Founder", InstanceURL: "https://bsky.social",
			CapabilityState: "{}", AccessTokenEnc: []byte("test-token"), IsActive: true, CreatedAt: now},
		{ID: "account-bluesky-selfhosted", WorkspaceID: "workspace-1", Slug: "bluesky-selfhosted", Platform: "bluesky",
			AccountID: "provider-bluesky-selfhosted", AccountUsername: "Founder", InstanceURL: "https://PDS.example.com/",
			CapabilityState: "{}", AccessTokenEnc: []byte("test-token"), IsActive: true, CreatedAt: now},
		{ID: "account-discord-webhook", WorkspaceID: "workspace-1", Slug: "discord-webhook", Platform: "discord",
			AccountID: "provider-discord-webhook", AccountUsername: "Founder",
			CapabilityState: "{}", AccessTokenEnc: []byte("test-token"), IsActive: true, CreatedAt: now},
		{ID: "account-discord-bot", WorkspaceID: "workspace-1", Slug: "discord-bot", Platform: "discord",
			AccountID: "provider-discord-bot", AccountUsername: "Founder",
			CapabilityState: `{"connection_type":"bot"}`, AccessTokenEnc: []byte("test-token"), IsActive: true, CreatedAt: now},
	}
	_, err := db.NewInsert().Model(&accounts).Exec(t.Context())
	require.NoError(t, err)
	for _, account := range accounts {
		publicationID := "publication-" + account.ID
		_, err := db.NewInsert().Model(&models.Publication{
			ID: publicationID, WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Launch",
			SourceContent: "Launch", Status: models.PublicationStatusScheduled, ScheduledAt: runAt,
			ActualRunAt: runAt, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.Rendition{
			ID: "rendition-" + account.ID, PublicationID: publicationID, SocialAccountID: account.ID,
			TargetKey: account.Platform, Platform: account.Platform, Profile: "post",
			Status: models.RenditionStatusScheduled, SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
	}

	// Each adapter answers for its own provider key with a distinguishable
	// outcome, so the stored per-account result identifies the adapter that ran.
	defaultBluesky := &preflightAdapter{}
	selfHostedBluesky := &preflightAdapter{err: &platform.HTTPError{StatusCode: 401, Code: "invalid_token"}}
	discordWebhook := &preflightAdapter{err: &platform.HTTPError{StatusCode: 429, Code: "rate_limit"}}
	discordBot := &preflightAdapter{err: &platform.HTTPError{StatusCode: 403, Code: "permission_denied"}}
	recorder := &preflightNotifications{}
	service := NewService(db, preflightTokens{}, recorder)
	service.now = func() time.Time { return now }
	service.SetProvider("bluesky", defaultBluesky)
	service.SetProvider("bluesky:https://pds.example.com", selfHostedBluesky)
	service.SetProvider("discord", discordWebhook)
	service.SetProvider("discord:bot", discordBot)

	require.NoError(t, service.HandleJob(t.Context(), JobType))

	require.Equal(t, 1, defaultBluesky.calls)
	require.Equal(t, 1, selfHostedBluesky.calls)
	require.Equal(t, 1, discordWebhook.calls)
	require.Equal(t, 1, discordBot.calls)

	// Four different stored outcomes: healthy, authentication, unclassified
	// (rate limited), permission. Swapping any two adapters changes a stored
	// result even when both would have been called once.
	wantFailures := map[string]string{
		"account-bluesky-default":    "",
		"account-bluesky-selfhosted": "authentication",
		"account-discord-webhook":    "unknown",
		"account-discord-bot":        "permission",
	}
	for accountID, wantFailure := range wantFailures {
		var account models.SocialAccount
		require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(t.Context()))
		require.Equal(t, wantFailure, account.PreflightFailure, "preflight failure stored for %s", accountID)
		require.Equal(t, now, account.PreflightCheckedAt, "preflight check time stored for %s", accountID)
		if wantFailure == "" {
			require.Equal(t, now, account.PreflightSuccessAt, "preflight success stored for %s", accountID)
		} else {
			require.True(t, account.PreflightSuccessAt.IsZero(), "a failed preflight must not store a success for %s", accountID)
		}
	}
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

func requirePreflightNotifications(t *testing.T, db *bun.DB, userID string, want int, message string) []models.UserNotification {
	t.Helper()
	rows := preflightNotificationRows(t, db, userID)
	require.Len(t, rows, want, "%s: want %d notifications for %s, got %d", message, want, userID, len(rows))
	return rows
}

func requirePreflightAccountState(t *testing.T, db *bun.DB, wantGeneration int64, wantFailure string) {
	t.Helper()
	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(t.Context()))
	require.Equal(t, wantGeneration, account.CredentialFailureGeneration)
	require.Equal(t, wantFailure, account.PreflightFailure)
}

// The first confirmed credential failure on a healthy account claims
// generation 1 and routes the transition to the connector and the active
// workspace administrators. Repeated failures inside the same generation
// dedupe, and only a successful check arms a fresh generation.
func TestConfirmedPreflightFailureNotifiesReconnectRecipientsPerGeneration(t *testing.T) {
	db := preflightTestDB(t)
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	seedPreflightCandidate(t, db, now.Add(time.Hour))
	seedPreflightReconnectRecipients(t, db, "connector-1")

	service := NewService(db, preflightTokens{}, notifications.NewService(db))
	authFailure := &platform.HTTPError{StatusCode: 401, Code: "invalid_token"}
	service.SetProvider("x", &preflightAdapter{err: authFailure})

	// First confirmed failure: the healthy account claims generation 1.
	service.now = func() time.Time { return now }
	require.NoError(t, service.HandleJob(t.Context(), JobType))
	requirePreflightAccountState(t, db, 1, "authentication")
	connectorRows := requirePreflightNotifications(t, db, "connector-1", 1, "the connector can reconnect the account")
	require.Equal(t, "account_needs_attention:account-1:1", connectorRows[0].DedupKey)
	require.Equal(t, "Connected account needs attention", connectorRows[0].Title)
	require.Contains(t, connectorRows[0].PayloadJSON, `"credential_generation":"1"`)
	requirePreflightNotifications(t, db, "admin-1", 1, "active administrators can reconnect the account")
	requirePreflightNotifications(t, db, "admin-2", 1, "active administrators can reconnect the account")
	requirePreflightNotifications(t, db, "editor-1", 0, "editors cannot reconnect the account")
	requirePreflightNotifications(t, db, "admin-inactive", 0, "inactive administrators are not notified")
	// The existing per-publication creator warning still fires unchanged.
	requirePreflightNotifications(t, db, "user-1", 1, "the publication creator keeps the scheduled-at-risk warning")

	// A second failure without an intervening success stays in generation 1
	// and notifies nobody again.
	service.now = func() time.Time { return now.Add(checkCadence + time.Minute) }
	require.NoError(t, service.HandleJob(t.Context(), JobType))
	requirePreflightAccountState(t, db, 1, "authentication")
	requirePreflightNotifications(t, db, "connector-1", 1, "repeated failures inside one generation dedupe")
	requirePreflightNotifications(t, db, "admin-1", 1, "repeated failures inside one generation dedupe")
	requirePreflightNotifications(t, db, "user-1", 1, "the creator warning keeps its cooldown")

	// A successful check resets the failure state, so the account is healthy
	// again and the generation stays claimed until the next failure.
	service.SetProvider("x", &preflightAdapter{})
	service.now = func() time.Time { return now.Add(2*checkCadence + 2*time.Minute) }
	require.NoError(t, service.HandleJob(t.Context(), JobType))
	requirePreflightAccountState(t, db, 1, "")

	// The next confirmed failure claims generation 2 and notifies again.
	service.SetProvider("x", &preflightAdapter{err: authFailure})
	service.now = func() time.Time { return now.Add(3*checkCadence + 3*time.Minute) }
	require.NoError(t, service.HandleJob(t.Context(), JobType))
	requirePreflightAccountState(t, db, 2, "authentication")
	secondGeneration := requirePreflightNotifications(t, db, "connector-1", 2, "a fresh generation notifies again")
	require.Equal(t, "account_needs_attention:account-1:2", secondGeneration[1].DedupKey)
	requirePreflightNotifications(t, db, "admin-1", 2, "a fresh generation notifies again")
	requirePreflightNotifications(t, db, "admin-2", 2, "a fresh generation notifies again")
	requirePreflightNotifications(t, db, "user-1", 1, "the creator warning cooldown still suppresses repeats")
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
