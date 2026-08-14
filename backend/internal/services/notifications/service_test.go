package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func notificationsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
		(*models.UserNotificationDigestItem)(nil),
		(*models.UserNotificationMute)(nil),
		(*models.Job)(nil),
		(*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceInvitationDeliveryEvent)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "one@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "One"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	return db
}

func TestNotificationMutesResolveWorkspaceBeforeAccountAndExpireWithoutChangingPreferences(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{Sender: &recordingNotificationSender{}})
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	before, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}},
		DigestTime:  "09:00", DigestTimezone: "Europe/Lisbon",
	})
	require.NoError(t, err)

	account, err := service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(8 * time.Hour)})
	require.NoError(t, err)
	workspace, err := service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(2 * time.Hour)})
	require.NoError(t, err)

	effective, err := service.ResolveEffectiveMute(t.Context(), "user-1", "workspace-1")
	require.NoError(t, err)
	require.Equal(t, workspace.ID, effective.ID, "the most specific active Mute wins")
	effective, err = service.ResolveEffectiveMute(t.Context(), "user-1", "workspace-2")
	require.NoError(t, err)
	require.Equal(t, account.ID, effective.ID)

	now = now.Add(3 * time.Hour)
	effective, err = service.ResolveEffectiveMute(t.Context(), "user-1", "workspace-1")
	require.NoError(t, err)
	require.Equal(t, account.ID, effective.ID, "the account Mute applies after the Workspace Mute expires")
	require.NoError(t, service.EndMute(t.Context(), MuteActor{UserID: "user-1"}, account.ID))
	effective, err = service.ResolveEffectiveMute(t.Context(), "user-1", "workspace-1")
	require.NoError(t, err)
	require.Empty(t, effective.ID)

	after, err := service.GetPreferenceSettings(t.Context(), "user-1")
	require.NoError(t, err)
	require.Equal(t, before.Preferences, after.Preferences)
	require.Equal(t, before.DigestTime, after.DigestTime)
	require.Equal(t, before.DigestTimezone, after.DigestTimezone)
}

func TestWorkspaceMuteCreationRequiresActiveMembershipInTheService(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-2", Name: "Other organization"}).Exec(t.Context())
	require.NoError(t, err)

	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-2", EndsAt: time.Now().Add(time.Hour),
	})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "unknown-user"}, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: time.Now().Add(time.Hour),
	})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)
}

func TestWorkspaceBoundActorCannotUpdateAccountPreferencesInTheService(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)

	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{
		UserID: "user-1", WorkspaceBindingID: "workspace-1",
	}, PreferenceUpdate{
		Preferences: Preferences{
			TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyImmediate},
		},
		DigestTime: "09:00", DigestTimezone: "UTC",
	})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)

	count, err := db.NewSelect().Model((*models.UserNotificationPreference)(nil)).
		Where("user_id = ?", "user-1").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "a rejected Workspace-bound write must not create account preferences")
}

func TestWorkspaceBoundMuteActorCannotCrossItsCredentialBoundary(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	now := time.Now().UTC()
	bound := MuteActor{UserID: "user-1", WorkspaceBindingID: "workspace-1"}

	_, err := service.CreateMute(t.Context(), bound, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(time.Hour)})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)
	_, err = service.CreateMute(t.Context(), bound, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-2", EndsAt: now.Add(time.Hour),
	})
	require.ErrorIs(t, err, ErrMuteWorkspaceAccess)

	account, err := service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{
		Scope: MuteScopeAccount, EndsAt: now.Add(time.Hour),
	})
	require.NoError(t, err)
	require.ErrorIs(t, service.EndMute(t.Context(), bound, account.ID), ErrMuteWorkspaceAccess)

	workspace, err := service.CreateMute(t.Context(), bound, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour),
	})
	require.NoError(t, err)
	scoped, err := service.GetPreferenceSettingsForActor(t.Context(), bound)
	require.NoError(t, err)
	require.Empty(t, scoped.Preferences)
	require.Len(t, scoped.Mutes, 1)
	require.Equal(t, workspace.ID, scoped.Mutes[0].ID)
	require.Equal(t, workspace.WorkspaceID, scoped.Mutes[0].WorkspaceID)
	require.NoError(t, service.EndMute(t.Context(), bound, workspace.ID))
}

func TestNotificationMutesSuppressOptionalEmailButKeepInAppAndTransactionalDelivery(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test"})
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyImmediate}},
		DigestTime:  "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour)})
	require.NoError(t, err)

	require.NoError(t, service.Create(t.Context(), CreateInput{
		UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeNewMessage,
		Title: "Optional message", DedupKey: "message:muted",
	}))
	inApp, err := db.NewSelect().Model((*models.UserNotification)(nil)).Where("dedup_key = ?", "message:muted").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, inApp, "in-app delivery stays immediate")
	jobs, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, jobs, "optional immediate email is paused")

	require.NoError(t, service.Create(t.Context(), CreateInput{
		UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeSecurityAction,
		Title: "Security action", DedupKey: "security:required",
	}))
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Scan(t.Context()))
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Len(t, sender.messages, 1, "Transactional email bypasses Mutes")
}

func TestMuteCreatedAfterQueueSuppressesOptionalImmediateDelivery(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender})
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyImmediate}},
		DigestTime:  "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(t.Context(), CreateInput{
		UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeNewMessage,
		Title: "Queued before Mute", DedupKey: "message:queued-before-mute",
	}))
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Scan(t.Context()))
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(time.Hour)})
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Empty(t, sender.messages)
}

func TestLegacyOptionalEmailWithoutWorkspaceScopeIsConservativelyMuted(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender})
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyImmediate}},
		DigestTime:  "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour)})
	require.NoError(t, err)
	legacy, err := json.Marshal(map[string]any{
		"delivery_id": "legacy", "user_id": "user-1", "type": TypeNewMessage, "title": "Legacy queued email",
	})
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(t.Context(), JobTypeEmailDelivery, string(legacy)))
	require.Empty(t, sender.messages)
}

func TestOptionalProducerRechecksMuteWhenCreateReplaceOrEndRacesIt(t *testing.T) {
	for _, action := range []string{"create", "replace", "end"} {
		t.Run(action, func(t *testing.T) {
			db := notificationsTestDB(t)
			service := NewService(db, Options{Sender: &recordingNotificationSender{}})
			now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
			service.now = func() time.Time { return now }
			_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyImmediate}}, DigestTime: "09:00", DigestTimezone: "UTC"})
			require.NoError(t, err)
			var mute Mute
			if action != "create" {
				mute, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour)})
				require.NoError(t, err)
			}
			paused, resume := make(chan struct{}), make(chan struct{})
			service.beforeOptionalMuteCheck = func() { close(paused); <-resume }
			result := make(chan error, 1)
			go func() {
				result <- service.CreateWithDB(t.Context(), db, CreateInput{UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeNewMessage, Title: action, DedupKey: "race:" + action})
			}()
			<-paused
			switch action {
			case "create":
				_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(time.Hour)})
			case "replace":
				_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(2 * time.Hour)})
			case "end":
				err = service.EndMute(t.Context(), MuteActor{UserID: "user-1"}, mute.ID)
			}
			require.NoError(t, err)
			close(resume)
			require.NoError(t, <-result)
			jobs, countErr := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
			require.NoError(t, countErr)
			if action == "end" {
				require.Equal(t, 1, jobs)
			} else {
				require.Zero(t, jobs)
			}
		})
	}
}

func TestWorkspaceMuteSuppressesAnAlreadyQueuedDailyItemAtDelivery(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}},
		DigestTime:  "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(t.Context(), CreateInput{
		UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeNewMessage,
		Title: "Queued digest item", DedupKey: "message:daily-before-mute",
	}))
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", JobTypeEmailDelivery).Scan(t.Context()))
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{
		Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(4 * time.Hour),
	})
	require.NoError(t, err)

	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Empty(t, sender.messages)
	pending, err := db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, pending, "muted items are discarded rather than sent after expiry")
}

func TestLegacyDigestItemWithoutWorkspaceScopeIsConservativelyMuted(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}}, DigestTime: "09:00", DigestTimezone: "UTC"})
	require.NoError(t, err)
	require.NoError(t, service.Create(t.Context(), CreateInput{UserID: "user-1", WorkspaceID: "workspace-1", Type: TypeNewMessage, Title: "Legacy", DedupKey: "legacy:digest"}))
	_, err = db.NewUpdate().Model((*models.UserNotificationDigestItem)(nil)).Set("workspace_id = ''").Set("workspace_scope_known = FALSE").Where("dedup_key = ?", "legacy:digest").Exec(t.Context())
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Scan(t.Context()))
	_, err = service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeWorkspace, WorkspaceID: "workspace-1", EndsAt: now.Add(4 * time.Hour)})
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Empty(t, sender.messages)
}

func TestCreatingTheSameMuteScopeReplacesItUsingAbsoluteInstants(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	firstEnd := time.Date(2026, 8, 14, 16, 0, 0, 0, time.FixedZone("west", -4*60*60))
	first, err := service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeAccount, EndsAt: firstEnd})
	require.NoError(t, err)
	secondEnd := now.Add(10 * time.Hour)
	second, err := service.CreateMute(t.Context(), MuteActor{UserID: "user-1"}, MuteCreate{Scope: MuteScopeAccount, EndsAt: secondEnd})
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)
	require.Equal(t, secondEnd, second.EndsAt)
	count, err := db.NewSelect().Model((*models.UserNotificationMute)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestSameMuteCreateAndEndContentionPersistsTheLastMutation(t *testing.T) {
	for _, test := range []struct {
		name        string
		pauseCreate bool
	}{
		{name: "create persists last", pauseCreate: true},
		{name: "end persists last", pauseCreate: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := notificationsTestDB(t)
			service := NewService(db)
			now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
			service.now = func() time.Time { return now }
			actor := MuteActor{UserID: "user-1"}
			initial, err := service.CreateMute(t.Context(), actor, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(time.Hour)})
			require.NoError(t, err)

			paused, resume := make(chan struct{}), make(chan struct{})
			if test.pauseCreate {
				service.beforeMuteCreatePersist = func() { close(paused); <-resume }
			} else {
				service.beforeMuteEndPersist = func() { close(paused); <-resume }
			}
			firstResult := make(chan error, 1)
			if test.pauseCreate {
				go func() {
					_, createErr := service.CreateMute(t.Context(), actor, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(2 * time.Hour)})
					firstResult <- createErr
				}()
			} else {
				go func() { firstResult <- service.EndMute(t.Context(), actor, initial.ID) }()
			}
			<-paused
			if test.pauseCreate {
				require.NoError(t, service.EndMute(t.Context(), actor, initial.ID))
			} else {
				_, err = service.CreateMute(t.Context(), actor, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(2 * time.Hour)})
				require.NoError(t, err)
			}
			close(resume)
			require.NoError(t, <-firstResult)

			effective, err := service.ResolveEffectiveMute(t.Context(), "user-1", "")
			require.NoError(t, err)
			if test.pauseCreate {
				require.Equal(t, initial.ID, effective.ID)
				require.Equal(t, now.Add(2*time.Hour), effective.EndsAt)
			} else {
				require.Empty(t, effective.ID)
			}
		})
	}
}

func TestConcurrentAndRepeatedEndMuteAreIdempotent(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	actor := MuteActor{UserID: "user-1"}
	mute, err := service.CreateMute(t.Context(), actor, MuteCreate{Scope: MuteScopeAccount, EndsAt: now.Add(time.Hour)})
	require.NoError(t, err)

	start := make(chan struct{})
	results := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			results <- service.EndMute(t.Context(), actor, mute.ID)
		}()
	}
	close(start)
	require.NoError(t, <-results)
	require.NoError(t, <-results)
	require.NoError(t, service.EndMute(t.Context(), actor, mute.ID), "a retry of an existing ended Mute stays successful")

	var stored models.UserNotificationMute
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", mute.ID).Scan(t.Context()))
	require.Equal(t, now, stored.EndedAt)
	effective, err := service.ResolveEffectiveMute(t.Context(), "user-1", "")
	require.NoError(t, err)
	require.Empty(t, effective.ID)
}

func TestDailyNotificationEmailBatchesOneUserWindowAndAdvancesAfterConfirmedSend(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test"})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{
			TypePostPublished: {InApp: true, EmailFrequency: EmailFrequencyDaily},
			TypeNewMessage:    {InApp: true, EmailFrequency: EmailFrequencyDaily},
		},
		DigestTime: "09:00", DigestTimezone: "Europe/Lisbon",
	})
	require.NoError(t, err)

	for _, input := range []CreateInput{
		{UserID: "user-1", Type: TypePostPublished, Title: "Published <safely>", Body: "Mastodon & Bluesky", DedupKey: "publication:1"},
		{UserID: "user-1", Type: TypeNewMessage, Title: "New message", Body: "Read it", DedupKey: "message:1"},
	} {
		require.NoError(t, service.Create(t.Context(), input))
		require.NoError(t, service.Create(t.Context(), input), "replayed producers must remain idempotent")
	}

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(t.Context()))
	require.Len(t, jobs, 1)
	require.Equal(t, time.Date(2026, 8, 14, 8, 0, 0, 0, time.UTC), jobs[0].RunAt)
	require.Equal(t, 5, jobs[0].MaxAttempts)

	sender.err = errors.New("temporary provider failure")
	require.Error(t, service.HandleJob(t.Context(), jobs[0].Type, jobs[0].Payload))
	undelivered, err := db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).Where("delivered_at IS NULL").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, undelivered, "a failed send must not advance the batch")

	sender.err = nil
	require.NoError(t, service.HandleJob(t.Context(), jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 2)
	digest := sender.messages[1]
	require.Equal(t, "Your daily OpenPost digest", digest.Title)
	require.Contains(t, digest.Body, "Published <safely>")
	require.Contains(t, digest.Body, "New message")
	require.Equal(t, "notification-digest-"+jobs[0].ID, digest.IdempotencyKey)
	undelivered, err = db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).Where("delivered_at IS NULL").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, undelivered)
}

func TestConcurrentDailyNotificationProducersKeepOneWindowJob(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{Sender: &recordingNotificationSender{}})
	service.now = func() time.Time { return time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC) }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}},
		DigestTime:  "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)

	const producers = 12
	errorsByProducer := make(chan error, producers)
	var wait sync.WaitGroup
	for index := range producers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			errorsByProducer <- service.Create(t.Context(), CreateInput{
				UserID: "user-1", Type: TypeNewMessage, Title: fmt.Sprintf("Message %d", index),
				DedupKey: fmt.Sprintf("message:%d", index),
			})
		}()
	}
	wait.Wait()
	close(errorsByProducer)
	for err := range errorsByProducer {
		require.NoError(t, err)
	}
	jobs, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobTypeEmailDelivery).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, jobs)
	items, err := db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, producers, items)
}

func TestDigestPreferenceChangeMovesUnclaimedItemsToTheNewWindow(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{Sender: &recordingNotificationSender{}})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	daily := Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}}
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: daily, DigestTime: "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(t.Context(), CreateInput{
		UserID: "user-1", Type: TypeNewMessage, Title: "Queued", DedupKey: "message:reschedule",
	}))

	_, err = service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: daily, DigestTime: "16:45", DigestTimezone: "Europe/Lisbon",
	})
	require.NoError(t, err)
	var item models.UserNotificationDigestItem
	require.NoError(t, db.NewSelect().Model(&item).Scan(t.Context()))
	require.Equal(t, time.Date(2026, 8, 14, 15, 45, 0, 0, time.UTC), item.DeliveryWindowAt)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Order("run_at ASC").Scan(t.Context()))
	require.Len(t, jobs, 2)
	require.Equal(t, time.Date(2026, 8, 14, 15, 45, 0, 0, time.UTC), jobs[1].RunAt)
}

func TestDigestProducerRechecksScheduleAfterConcurrentPreferenceChange(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{Sender: &recordingNotificationSender{}})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	daily := Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}}
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: daily, DigestTime: "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)

	producerPaused := make(chan struct{})
	resumeProducer := make(chan struct{})
	service.beforeDigestPreferenceLock = func() {
		close(producerPaused)
		<-resumeProducer
	}
	producerResult := make(chan error, 1)
	go func() {
		// A caller-owned transaction uses the same row lock in production. Passing
		// the DB here lets this SQLite test pause the producer after its stale read.
		producerResult <- service.CreateWithDB(t.Context(), db, CreateInput{
			UserID: "user-1", Type: TypeNewMessage, Title: "Concurrent",
			DedupKey: "message:concurrent-settings",
		})
	}()
	<-producerPaused
	_, err = service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: daily, DigestTime: "16:45", DigestTimezone: "Europe/Lisbon",
	})
	require.NoError(t, err)
	close(resumeProducer)
	require.NoError(t, <-producerResult)

	var item models.UserNotificationDigestItem
	require.NoError(t, db.NewSelect().Model(&item).Where("dedup_key = ?", "message:concurrent-settings").Scan(t.Context()))
	require.Equal(t, time.Date(2026, 8, 14, 15, 45, 0, 0, time.UTC), item.DeliveryWindowAt)
}

func TestDigestDeliveryAdvancesOnlyItsClaimedSnapshot(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}},
		DigestTime:  "09:00", DigestTimezone: "UTC",
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(t.Context(), CreateInput{
		UserID: "user-1", Type: TypeNewMessage, Title: "Claimed", DedupKey: "message:claimed",
	}))
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", JobTypeEmailDelivery).Scan(t.Context()))
	sender.onNotification = func(passwordmail.NotificationMessage) {
		_, insertErr := db.NewInsert().Model(&models.UserNotificationDigestItem{
			ID: "late-item", UserID: "user-1", Type: TypeNewMessage, Title: "Too late",
			DedupKey: "message:late", DeliveryWindowAt: job.RunAt, CreatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, insertErr)
	}

	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	var late models.UserNotificationDigestItem
	require.NoError(t, db.NewSelect().Model(&late).Where("id = ?", "late-item").Scan(t.Context()))
	require.True(t, late.DeliveredAt.IsZero())
	require.Empty(t, late.DeliveryID)
}

func TestTransactionalNotificationClassesRemainImmediate(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{Sender: &recordingNotificationSender{}})
	now := time.Date(2026, 8, 14, 7, 30, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	for _, eventType := range []string{TypeSecurityAction, TypeAccessChanged, TypeWorkspaceInvite, TypeCriticalBilling} {
		preference := DefaultPreferences()[eventType]
		require.True(t, preference.InApp, eventType)
		require.Equal(t, EmailFrequencyImmediate, preference.EmailFrequency, eventType)
		require.NoError(t, service.Create(t.Context(), CreateInput{
			UserID: "user-1", Type: eventType, Title: "Required action", DedupKey: "transactional:" + eventType,
		}))
	}
	count, err := db.NewSelect().Model((*models.UserNotificationDigestItem)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(t.Context()))
	require.Len(t, jobs, 4)
	for _, job := range jobs {
		require.Equal(t, now, job.RunAt)
		require.Contains(t, job.Payload, `"classification":"required_notification"`)
	}
}

func TestNotificationPreferenceSettingsValidateFrequenciesAndTimezone(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)

	for name, update := range map[string]PreferenceUpdate{
		"unknown frequency": {Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: "weekly"}}, DigestTime: "09:00", DigestTimezone: "UTC"},
		"invalid time":      {Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}}, DigestTime: "9am", DigestTimezone: "UTC"},
		"invalid timezone":  {Preferences: Preferences{TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyDaily}}, DigestTime: "09:00", DigestTimezone: "Mars/Olympus"},
		"transactional off": {Preferences: Preferences{TypeWorkspaceInvite: {InApp: true, EmailFrequency: EmailFrequencyOff}}, DigestTime: "09:00", DigestTimezone: "UTC"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, update)
			require.ErrorIs(t, err, ErrInvalidPreferences)
		})
	}
}

func TestPreferenceSettingsKeepExistingDigestChoice(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	_, err := service.UpdatePreferenceSettings(t.Context(), MuteActor{UserID: "user-1"}, PreferenceUpdate{
		Preferences: DefaultPreferences(), DigestTime: "16:45", DigestTimezone: "America/New_York",
	})
	require.NoError(t, err)

	settings, err := service.GetPreferenceSettings(t.Context(), "user-1")
	require.NoError(t, err)
	require.Equal(t, "16:45", settings.DigestTime)
	require.Equal(t, "America/New_York", settings.DigestTimezone)
	require.True(t, settings.DigestConfigured)

	_, err = service.UpdatePreferences(t.Context(), "user-1", Preferences{
		TypeNewMessage: {InApp: true, EmailFrequency: EmailFrequencyOff},
	})
	require.NoError(t, err)
	settings, err = service.GetPreferenceSettings(t.Context(), "user-1")
	require.NoError(t, err)
	require.Equal(t, "16:45", settings.DigestTime)
	require.Equal(t, "America/New_York", settings.DigestTimezone)
}

func TestDailyDigestBodyBoundsContentAndAccountsForEveryItem(t *testing.T) {
	items := make([]models.UserNotificationDigestItem, 25)
	for index := range items {
		items[index] = models.UserNotificationDigestItem{
			Title: strings.Repeat("unsafe <title> & ", 20),
			Body:  strings.Repeat("long body ", 80),
		}
	}
	body := renderDailyDigestBody(items[:20], len(items))
	require.LessOrEqual(t, len([]rune(body)), 2_000)
	require.Contains(t, body, "more notifications are included in this digest")
}

func TestInvitationDeliveryCallbackIsIdempotentAndGenerationSafe(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	invitation := &models.WorkspaceInvitation{
		ID: "invitation-1", WorkspaceID: "workspace-1", Email: "person@example.com",
		Role: "viewer", InvitedByUserID: "admin-1", TokenHash: "current-secret-hash",
		ExpiresAt: now.Add(time.Hour), EmailDeliveryStatus: EmailDeliveryQueued,
		EmailDeliveryJobID: "delivery-current", CreatedAt: now,
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(invitation).Exec(t.Context()); return err }())
	service := NewService(db)

	result, err := service.RecordWorkspaceInvitationDelivery(t.Context(), WorkspaceInvitationDeliveryEvent{
		EventID: "event-delivered", InvitationID: invitation.ID, DeliveryID: "delivery-current",
		Outcome: EmailDeliveryDelivered, OccurredAt: now.Add(time.Minute),
	})
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.False(t, result.Duplicate)

	result, err = service.RecordWorkspaceInvitationDelivery(t.Context(), WorkspaceInvitationDeliveryEvent{
		EventID: "event-delivered", InvitationID: invitation.ID, DeliveryID: "delivery-current",
		Outcome: EmailDeliveryDelivered, OccurredAt: now.Add(time.Minute),
	})
	require.NoError(t, err)
	require.True(t, result.Duplicate)
	require.False(t, result.Applied)

	result, err = service.RecordWorkspaceInvitationDelivery(t.Context(), WorkspaceInvitationDeliveryEvent{
		EventID: "event-stale", InvitationID: invitation.ID, DeliveryID: "delivery-old",
		Outcome: EmailDeliveryFailed, OccurredAt: now.Add(2 * time.Minute),
	})
	require.NoError(t, err)
	require.True(t, result.Ignored)

	var stored models.WorkspaceInvitation
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", invitation.ID).Scan(t.Context()))
	require.Equal(t, EmailDeliveryDelivered, stored.EmailDeliveryStatus)
	require.Equal(t, now.Add(time.Minute), stored.EmailDeliveryUpdatedAt)
}

func TestInvitationDeliveryCallbackCannotMutateTerminalInvitation(t *testing.T) {
	for _, terminal := range []string{"accepted", "revoked"} {
		t.Run(terminal, func(t *testing.T) {
			db := notificationsTestDB(t)
			now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
			invitation := &models.WorkspaceInvitation{
				ID: "invitation-" + terminal, WorkspaceID: "workspace-1", Email: "person@example.com",
				Role: "viewer", InvitedByUserID: "admin-1", TokenHash: "secret-hash",
				ExpiresAt: now.Add(time.Hour), EmailDeliveryStatus: EmailDeliverySent,
				EmailDeliveryJobID: "delivery-1", CreatedAt: now,
			}
			if terminal == "accepted" {
				invitation.AcceptedAt = now
			}
			if terminal == "revoked" {
				invitation.RevokedAt = now
			}
			_, err := db.NewInsert().Model(invitation).Exec(t.Context())
			require.NoError(t, err)

			result, err := NewService(db).RecordWorkspaceInvitationDelivery(t.Context(), WorkspaceInvitationDeliveryEvent{
				EventID: "event-1", InvitationID: invitation.ID, DeliveryID: "delivery-1",
				Outcome: EmailDeliveryDelivered, OccurredAt: now.Add(time.Minute),
			})
			require.NoError(t, err)
			require.True(t, result.Ignored)
		})
	}
}

type recordingNotificationSender struct {
	messages           []passwordmail.NotificationMessage
	invitationMessages []transactionalmail.WorkspaceInvitationMessage
	err                error
	onNotification     func(passwordmail.NotificationMessage)
}

func (s *recordingNotificationSender) SendPasswordReset(_ context.Context, _ passwordmail.ResetMessage) error {
	return s.err
}

func (s *recordingNotificationSender) SendEmailVerification(_ context.Context, _ passwordmail.VerificationMessage) error {
	return s.err
}

func (s *recordingNotificationSender) SendNotification(_ context.Context, message passwordmail.NotificationMessage) error {
	s.messages = append(s.messages, message)
	if s.onNotification != nil {
		s.onNotification(message)
	}
	return s.err
}

func (s *recordingNotificationSender) SendWorkspaceInvitation(_ context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	s.invitationMessages = append(s.invitationMessages, message)
	return s.err
}

func TestWorkspaceInvitationEmailIsTransactionalDurableAndRecipientIndependent(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test/",
	})
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypeWorkspaceInvite: {InApp: true, EmailFrequency: EmailFrequencyImmediate},
	})
	require.NoError(t, err)
	require.True(t, preferences[TypeWorkspaceInvite].InApp)
	require.Equal(t, EmailFrequencyImmediate, preferences[TypeWorkspaceInvite].EmailFrequency,
		"Transactional access email is not an optional preference")

	delivery, err := service.EnqueueWorkspaceInvitation(ctx, WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", Recipient: "new-person@example.com",
		WorkspaceName: "Launch team", InviterName: "Ada Lovelace", Role: "editor",
		ExpiresAt: now.Add(7 * 24 * time.Hour), RawToken: "op_inv_private-token",
		DeliveryKey: "invitation-1:2026-08-14T12:00:00Z",
	})
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryQueued, delivery.Status)
	require.NotEmpty(t, delivery.JobID)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Contains(t, jobs[0].Payload, `"classification":"transactional"`)
	require.NotContains(t, jobs[0].Payload, `"raw_token"`)
	require.NotContains(t, jobs[0].Payload, `"token_hash"`)
	require.NotContains(t, jobs[0].Payload, "op_inv_private-token")

	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Equal(t, []transactionalmail.WorkspaceInvitationMessage{{
		Recipient: "new-person@example.com", WorkspaceName: "Launch team",
		InviterName: "Ada Lovelace", Role: "editor",
		AcceptURL:      "https://app.openpost.test/invite?token=op_inv_private-token",
		ExpiresAt:      now.Add(7 * 24 * time.Hour),
		IdempotencyKey: "notification-" + jobs[0].ID,
	}}, sender.invitationMessages)

	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "transactional email content must not be persisted as an in-app notification")
}

func TestWorkspaceInvitationEmailReportsProviderUnavailableWithoutQueueing(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{PublicURL: "https://app.openpost.test"})

	delivery, err := service.EnqueueWorkspaceInvitation(t.Context(), WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", Recipient: "person@example.com",
		WorkspaceName: "Launch team", InviterName: "Ada", Role: "viewer",
		ExpiresAt: time.Now().UTC().Add(time.Hour), RawToken: "op_inv_private-token",
		DeliveryKey: "delivery-1",
	})
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryUnavailable, delivery.Status)
	require.Empty(t, delivery.JobID)

	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestWorkspaceInvitationEmailProjectsDurableProviderOutcome(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	job := &models.Job{
		ID: "invite-job", Type: JobTypeEmailDelivery, Payload: `{}`,
		Status: "pending", RunAt: time.Now().UTC(), MaxAttempts: 5,
	}
	_, err := db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	status, err := service.ResolveEmailDeliveryStatus(t.Context(), job.ID, EmailDeliveryUnavailable)
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryQueued, status)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", "completed").Where("id = ?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	status, err = service.ResolveEmailDeliveryStatus(t.Context(), job.ID, EmailDeliveryUnavailable)
	require.NoError(t, err)
	require.Equal(t, EmailDeliverySent, status)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", "failed").Where("id = ?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	status, err = service.ResolveEmailDeliveryStatus(t.Context(), job.ID, EmailDeliveryUnavailable)
	require.NoError(t, err)
	require.Equal(t, EmailDeliveryFailed, status)
}

func TestWorkspaceInvitationProviderFailureDoesNotExposeAcceptanceSecret(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{err: errors.New("provider echoed op_inv_private-token")}
	service := NewService(db, Options{
		Sender: sender, Encryptor: servicecrypto.NewTokenEncryptor("invitation-test-key"),
		PublicURL: "https://app.openpost.test",
	})
	delivery, err := service.EnqueueWorkspaceInvitation(t.Context(), WorkspaceInvitationEmailInput{
		InvitationID: "invitation-1", Recipient: "person@example.com",
		WorkspaceName: "Launch", InviterName: "Ada", Role: "viewer",
		ExpiresAt: time.Now().UTC().Add(time.Hour), RawToken: "op_inv_private-token",
		DeliveryKey: "delivery-1",
	})
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", delivery.JobID).Scan(t.Context()))

	err = service.HandleJob(t.Context(), job.Type, job.Payload)
	require.EqualError(t, err, "workspace invitation email delivery failed")
	require.NotContains(t, err.Error(), "op_inv_private-token")
}

func TestNotificationDedupKeyIsIdempotent(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	input := CreateInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Published",
		DedupKey: "publication:one:published",
	}
	require.NoError(t, service.Create(ctx, input))
	require.NoError(t, service.Create(ctx, input))
	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestNotificationPreferencesSuppressOptionalButKeepCritical(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypeNewMessage: {InApp: false, EmailFrequency: EmailFrequencyOff},
	})
	require.NoError(t, err)
	require.False(t, preferences[TypeNewMessage].InApp)
	require.True(t, preferences[TypePublishFailed].InApp)

	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypeNewMessage, Title: "Optional",
	}))
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Critical",
	}))
	page, err := service.List(ctx, "user-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "Critical", page.Items[0].Title)
	require.Equal(t, 1, page.UnreadCount)
}

func TestLegacyNotificationPreferencesAdoptNewEmailDefaults(t *testing.T) {
	db := notificationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.UserNotificationPreference{
		UserID:          "user-1",
		PreferencesJSON: `{"publish_failed":{"in_app":true},"post_published":{"in_app":false}}`,
		UpdatedAt:       time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	preferences, err := NewService(db).GetPreferences(ctx, "user-1")
	require.NoError(t, err)
	require.Equal(t, EmailFrequencyImmediate, preferences[TypePublishFailed].EmailFrequency)
	require.Equal(t, EmailFrequencyOff, preferences[TypePostPublished].EmailFrequency)
	require.False(t, preferences[TypePostPublished].InApp)
}

func TestNotificationEmailDeliveryIsDurableDeduplicatedAndPreferenceAware(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test/"})
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	require.Equal(t, EmailFrequencyImmediate, DefaultPreferences()[TypePublishFailed].EmailFrequency)
	require.Equal(t, EmailFrequencyOff, DefaultPreferences()[TypePostPublished].EmailFrequency)
	input := CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Publication failed",
		Body: "OpenPost could not publish to Mastodon.", Href: "/activity?publication=publication-1",
		DedupKey: "publication:publication-1:failed",
	}
	require.NoError(t, service.Create(ctx, input))
	require.NoError(t, service.Create(ctx, input))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Equal(t, "pending", jobs[0].Status)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Equal(t, []passwordmail.NotificationMessage{{
		Recipient:      "one@example.com",
		Title:          "Publication failed",
		Body:           "OpenPost could not publish to Mastodon.",
		ActionURL:      "https://app.openpost.test/activity?publication=publication-1",
		PreferencesURL: "https://app.openpost.test/settings?tab=notifications",
		IdempotencyKey: "notification-" + jobs[0].ID,
	}}, sender.messages)

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypePublishFailed: {InApp: true, EmailFrequency: EmailFrequencyOff},
	})
	require.NoError(t, err)
	require.Equal(t, EmailFrequencyOff, preferences[TypePublishFailed].EmailFrequency)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 1)
}

func TestNotificationCanDeliverEmailWithoutCreatingOptionalInAppItem(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test"})
	ctx := context.Background()

	_, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypePostPublished: {InApp: false, EmailFrequency: EmailFrequencyImmediate},
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Publication completed",
		DedupKey: "publication:publication-1:published",
	}))

	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	jobs, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobTypeEmailDelivery).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, jobs)
}

func TestNotificationListAndChangesUseVisibleWorkspaceScope(t *testing.T) {
	db := notificationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{ID: "user-2", Email: "two@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db)
	for _, input := range []CreateInput{
		{UserID: "user-1", WorkspaceID: "workspace-1", Type: TypePostPublished, Title: "Workspace one"},
		{UserID: "user-1", WorkspaceID: "workspace-2", Type: TypePostPublished, Title: "Workspace two"},
		{UserID: "user-1", Type: TypeWorkspaceInvite, Title: "Global"},
		{UserID: "user-2", WorkspaceID: "workspace-1", Type: TypePostPublished, Title: "Other user"},
	} {
		require.NoError(t, service.Create(ctx, input))
	}

	page, err := service.List(ctx, "user-1", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	require.Equal(t, 2, page.UnreadCount)

	var workspaceTwoID string
	require.NoError(t, db.NewSelect().Model((*models.UserNotification)(nil)).
		Column("id").Where("user_id = ? AND workspace_id = ?", "user-1", "workspace-2").
		Scan(ctx, &workspaceTwoID))
	require.NoError(t, service.MarkRead(ctx, "user-1", "workspace-1", []string{workspaceTwoID}, false))

	otherWorkspace, err := service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Equal(t, 2, otherWorkspace.UnreadCount, "an ID from another workspace must not bypass the visible-workspace scope")
	require.NoError(t, service.MarkRead(ctx, "user-1", "workspace-1", nil, true))

	page, err = service.List(ctx, "user-1", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Zero(t, page.UnreadCount)

	otherWorkspace, err = service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Equal(t, 1, otherWorkspace.UnreadCount, "a workspace-one bulk action must not mark workspace-two notifications read")

	require.NoError(t, service.Delete(ctx, "user-1", "workspace-1", []string{workspaceTwoID}, false))
	require.NoError(t, service.Delete(ctx, "user-1", "workspace-1", nil, true))

	otherWorkspace, err = service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Len(t, otherWorkspace.Items, 1)
	require.Equal(t, "Workspace two", otherWorkspace.Items[0].Title)
	require.Equal(t, 1, otherWorkspace.UnreadCount)

	require.ErrorIs(t, service.MarkRead(ctx, "user-1", "", nil, true), errWorkspaceScopeRequired)
	require.ErrorIs(t, service.Delete(ctx, "user-1", "", nil, true), errWorkspaceScopeRequired)
	otherWorkspace, err = service.List(ctx, "user-1", "workspace-2", "", 30)
	require.NoError(t, err)
	require.Len(t, otherWorkspace.Items, 1)
	require.Equal(t, 1, otherWorkspace.UnreadCount)

	other, err := service.List(ctx, "user-2", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Len(t, other.Items, 1)
}

func TestNotificationListCursorReachesEveryItemWithoutDuplicates(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	base := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	items := make([]models.UserNotification, 0, 125)
	for index := range 125 {
		items = append(items, models.UserNotification{
			ID:          fmt.Sprintf("notification-%03d", index),
			UserID:      "user-1",
			WorkspaceID: "workspace-1",
			Type:        TypePostPublished,
			Title:       fmt.Sprintf("Notification %03d", index),
			CreatedAt:   base.Add(-time.Duration(index/2) * time.Minute),
		})
	}
	_, err := db.NewInsert().Model(&items).Exec(ctx)
	require.NoError(t, err)

	seen := make(map[string]bool, len(items))
	cursor := ""
	pageCount := 0
	for {
		page, err := service.List(ctx, "user-1", "workspace-1", cursor, 30)
		require.NoError(t, err)
		require.Equal(t, len(items), page.UnreadCount)
		for _, item := range page.Items {
			require.False(t, seen[item.ID], "notification %s appeared on more than one page", item.ID)
			seen[item.ID] = true
		}
		pageCount++
		if page.NextCursor == "" {
			break
		}
		require.NotEqual(t, cursor, page.NextCursor)
		cursor = page.NextCursor
	}
	require.Equal(t, 5, pageCount)
	require.Len(t, seen, len(items))

	_, err = service.List(ctx, "user-1", "workspace-1", "not-a-cursor", 30)
	require.ErrorIs(t, err, ErrInvalidCursor)
	_, err = service.List(ctx, "user-1", "workspace-1", base.Format(time.RFC3339Nano)+"|", 30)
	require.ErrorIs(t, err, ErrInvalidCursor)
}

func TestNotificationActionsKeepOnlySafeLocalOperations(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Partial failure",
		Actions: []models.NotificationAction{
			{Label: "Retry failed", Operation: "retry_failed_publication", TargetID: "publication-1", Kind: "primary"},
			{Label: "View results", Href: "/activity?tab=failed"},
			{Label: "Mixed", Href: "https://provider.example/private", Operation: "retry_failed_publication", TargetID: "publication-2"},
			{Label: "Unsafe", Href: "https://provider.example/private"},
			{Label: "Backslash", Href: `/\provider.example/private`},
			{Label: "Unknown", Operation: "delete_everything", TargetID: "publication-1"},
		},
	}))

	page, err := service.List(ctx, "user-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, []models.NotificationAction{
		{Label: "Retry failed", Kind: "primary", Operation: "retry_failed_publication", TargetID: "publication-1"},
		{Label: "View results", Href: "/activity?tab=failed", Kind: "secondary"},
		{Label: "Mixed", Kind: "secondary", Operation: "retry_failed_publication", TargetID: "publication-2"},
	}, page.Items[0].Actions)
}
