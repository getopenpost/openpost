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

func TestHandleJobChecksOnlyActiveDestinationsDueSoon(t *testing.T) {
	tests := []struct {
		name             string
		publicationRunAt time.Duration
		overrideRunAt    time.Duration
		wantCalls        int
	}{
		{name: "publication outside window", publicationRunAt: 3 * time.Hour},
		{name: "rendition override moves destination into window", publicationRunAt: 3 * time.Hour, overrideRunAt: time.Hour, wantCalls: 1},
		{name: "rendition override moves destination outside window", publicationRunAt: time.Hour, overrideRunAt: 3 * time.Hour},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := preflightTestDB(t)
			now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
			seedPreflightCandidate(t, db, now.Add(test.publicationRunAt))
			if test.overrideRunAt > 0 {
				_, err := db.NewUpdate().Model((*models.Rendition)(nil)).Set("schedule_override = ?", now.Add(test.overrideRunAt)).Where("id = ?", "rendition-1").Exec(t.Context())
				require.NoError(t, err)
			}
			adapter := &preflightAdapter{}
			service := NewService(db, preflightTokens{}, &preflightNotifications{})
			service.now = func() time.Time { return now }
			service.SetProvider("x", adapter)

			require.NoError(t, service.HandleJob(t.Context(), JobType))
			require.Equal(t, test.wantCalls, adapter.calls)
		})
	}
}

func TestHandleJobWarnsForAlreadyDisconnectedUpcomingDestination(t *testing.T) {
	db := preflightTestDB(t)
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	seedPreflightCandidate(t, db, now.Add(time.Hour))
	_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", "account-1").Exec(t.Context())
	require.NoError(t, err)
	adapter := &preflightAdapter{}
	recorder := &preflightNotifications{}
	service := NewService(db, preflightTokens{}, recorder)
	service.now = func() time.Time { return now }
	service.SetProvider("x", adapter)

	require.NoError(t, service.HandleJob(t.Context(), JobType))
	require.Zero(t, adapter.calls)
	require.Equal(t, 1, recorder.count)
}

func TestScheduleDeduplicatesActiveRecurringJob(t *testing.T) {
	db := preflightTestDB(t)
	runAt := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	service := NewService(db, nil, nil)

	require.NoError(t, service.Schedule(t.Context(), runAt))
	require.NoError(t, service.Schedule(t.Context(), runAt))
	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobType).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func preflightTestDB(t *testing.T) *bun.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:preflight-%d?mode=memory&cache=shared", time.Now().UnixNano())
	raw, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)
	db := bun.NewDB(raw, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	for _, model := range []any{(*models.SocialAccount)(nil), (*models.Publication)(nil), (*models.Rendition)(nil), (*models.Job)(nil)} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewCreateIndex().Index("jobs_active_dedupe_unique_idx").Table("jobs").Column("type", "scope_id", "dedupe_key").Unique().Where("status IN ('pending', 'processing') AND scope_id <> '' AND dedupe_key <> ''").Exec(t.Context())
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
