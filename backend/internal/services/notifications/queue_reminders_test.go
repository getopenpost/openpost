package notifications

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestQueueReminderSweepSendsLowRunwayOncePerDepletionEpisode(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{EmailDelivery: sender, PublicURL: "https://app.openpost.test"})
	service.now = func() time.Time { return now }
	seedQueueReminderWorkspace(t, db, now)

	settings, err := service.UpdateQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1", QueueReminderUpdate{
		LowRunwayEnabled: true, QueueEmptiedEnabled: true, RunwayDays: 7,
	})
	require.NoError(t, err)
	require.True(t, settings.LowRunwayEnabled)
	require.Equal(t, 7, settings.RunwayDays)

	require.NoError(t, service.RunQueueReminderSweep(t.Context()))
	require.NoError(t, service.RunQueueReminderSweep(t.Context()))
	jobs := queueReminderEmailJobs(t, db)
	require.Len(t, jobs, 1)
	require.NoError(t, service.HandleJob(t.Context(), jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 1)
	require.Equal(t, "Your OpenPost queue has 3 days left", sender.messages[0].Title)
	require.Contains(t, sender.messages[0].Body, "One")
	require.Equal(t, "https://app.openpost.test/calendar", sender.messages[0].ActionURL)

	seedQueuedPublication(t, db, "later", now.Add(10*24*time.Hour))
	require.NoError(t, service.RunQueueReminderSweep(t.Context()))
	_, err = db.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusPublished).
		Where("id = ?", "later").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusPublished).
		Where("publication_id = ?", "later").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.RunQueueReminderSweep(t.Context()))
	require.Len(t, queueReminderEmailJobs(t, db), 2)
}

func TestQueueReminderEmailRechecksRecoveredQueueBeforeDelivery(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{EmailDelivery: sender, PublicURL: "https://app.openpost.test"})
	service.now = func() time.Time { return now }
	seedQueueReminderWorkspace(t, db, now)
	_, err := service.UpdateQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1", QueueReminderUpdate{
		LowRunwayEnabled: true, RunwayDays: 7,
	})
	require.NoError(t, err)

	require.NoError(t, service.RunQueueReminderSweep(t.Context()))
	job := queueReminderEmailJobs(t, db)[0]
	seedQueuedPublication(t, db, "recovered", now.Add(14*24*time.Hour))
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Empty(t, sender.messages)
}

func TestLowRunwayReminderSendsForAnAlreadyEmptyActivatedWorkspace(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{EmailDelivery: sender})
	service.now = func() time.Time { return now }
	_, err := db.NewInsert().Model(&models.WorkspaceActivation{
		ID: "activation:workspace-1", WorkspaceID: "workspace-1", PublicationID: "first", CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = service.UpdateQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1", QueueReminderUpdate{
		LowRunwayEnabled: true, QueueEmptiedEnabled: true, RunwayDays: 7,
	})
	require.NoError(t, err)

	require.NoError(t, service.RunQueueReminderSweep(t.Context()))
	jobs := queueReminderEmailJobs(t, db)
	require.Len(t, jobs, 1)
	require.NoError(t, service.HandleJob(t.Context(), jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 1)
	require.Equal(t, "Your OpenPost queue has 0 days left", sender.messages[0].Title)
}

func TestQueueEmptiedReminderOnlyFiresAfterTheLastQueuedPublicationFinishes(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{EmailDelivery: sender, PublicURL: "https://app.openpost.test"})
	service.now = func() time.Time { return now }
	seedQueueReminderWorkspace(t, db, now)
	_, err := service.UpdateQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1", QueueReminderUpdate{
		LowRunwayEnabled: true, QueueEmptiedEnabled: true, RunwayDays: 7,
	})
	require.NoError(t, err)

	_, err = db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusPublished).Where("id = ?", "queued").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusPublished).Where("publication_id = ?", "queued").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.RecordQueueEmptiedAfterPublication(t.Context(), db, "workspace-1", "queued"))
	require.NoError(t, service.RecordQueueEmptiedAfterPublication(t.Context(), db, "workspace-1", "queued"))
	jobs := queueReminderEmailJobs(t, db)
	require.Len(t, jobs, 1)
	require.NoError(t, service.HandleJob(t.Context(), jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 1)
	require.Equal(t, "Your OpenPost queue is empty", sender.messages[0].Title)
}

func TestQueueEmptiedReminderCatchesQueueFilledAndDrainedBetweenSweeps(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	service := NewService(db, Options{EmailDelivery: &recordingNotificationSender{}})
	service.now = func() time.Time { return now }
	_, err := db.NewInsert().Model(&models.WorkspaceActivation{
		ID: "activation:workspace-1", WorkspaceID: "workspace-1", PublicationID: "first", CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = service.UpdateQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1", QueueReminderUpdate{
		QueueEmptiedEnabled: true, RunwayDays: 7,
	})
	require.NoError(t, err)

	seedQueuedPublication(t, db, "between-sweeps", now.Add(time.Hour))
	_, err = db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusPublished).Where("id = ?", "between-sweeps").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusPublished).Where("publication_id = ?", "between-sweeps").Exec(t.Context())
	require.NoError(t, err)

	require.NoError(t, service.RecordQueueEmptiedAfterPublication(t.Context(), db, "workspace-1", "between-sweeps"))
	require.NoError(t, service.RecordQueueEmptiedAfterPublication(t.Context(), db, "workspace-1", "between-sweeps"))
	require.Len(t, queueReminderEmailJobs(t, db), 1)
}

func TestQueueReminderSnapshotKeepsFailedPublicationWithScheduledRendition(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	seedQueuedPublication(t, db, "partially-failed", now.Add(4*24*time.Hour))
	_, err := db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusFailed).Where("id = ?", "partially-failed").Exec(t.Context())
	require.NoError(t, err)

	snapshot, err := NewService(db, Options{}).queueSnapshot(t.Context(), db, "workspace-1")
	require.NoError(t, err)
	require.Equal(t, 1, snapshot.PendingCount)
	require.Equal(t, now.Add(4*24*time.Hour), snapshot.LatestRunAt)
}

func TestQueueEmptiedReminderSupersedesPendingLowRunwayEmail(t *testing.T) {
	db := notificationsTestDB(t)
	now := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{EmailDelivery: sender})
	service.now = func() time.Time { return now }
	seedQueueReminderWorkspace(t, db, now)
	_, err := service.UpdateQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1", QueueReminderUpdate{
		LowRunwayEnabled: true, QueueEmptiedEnabled: true, RunwayDays: 7,
	})
	require.NoError(t, err)
	require.NoError(t, service.RunQueueReminderSweep(t.Context()))

	_, err = db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusPublished).Where("id = ?", "queued").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusPublished).Where("publication_id = ?", "queued").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.RecordQueueEmptiedAfterPublication(t.Context(), db, "workspace-1", "queued"))

	jobs := queueReminderEmailJobs(t, db)
	require.Len(t, jobs, 2)
	for _, job := range jobs {
		require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	}
	require.Len(t, sender.messages, 1)
	require.Equal(t, "Your OpenPost queue is empty", sender.messages[0].Title)
}

func TestQueueReminderSettingsRequireActiveMembershipAndPropagateAuthorizationErrors(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db, Options{})
	_, err := db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("status = ''").Where("workspace_id = ? AND user_id = ?", "workspace-1", "user-1").Exec(t.Context())
	require.NoError(t, err)

	_, err = service.GetQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1")
	require.ErrorIs(t, err, ErrQueueReminderAccess)

	_, err = db.ExecContext(t.Context(), "DROP TABLE workspace_members")
	require.NoError(t, err)
	_, err = service.GetQueueReminderSettings(t.Context(), MuteActor{UserID: "user-1"}, "workspace-1")
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrQueueReminderAccess)
}

func seedQueueReminderWorkspace(t *testing.T, db *bun.DB, now time.Time) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.WorkspaceActivation{
		ID: "activation:workspace-1", WorkspaceID: "workspace-1", PublicationID: "queued", CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	seedQueuedPublication(t, db, "queued", now.Add(3*24*time.Hour))
}

func seedQueuedPublication(t *testing.T, db *bun.DB, id string, runAt time.Time) {
	t.Helper()
	publication := &models.Publication{
		ID: id, WorkspaceID: "workspace-1", CreatedByID: "user-1", SourceText: id,
		SourceContent: id, Status: models.PublicationStatusScheduled, ScheduledAt: runAt,
		ActualRunAt: runAt, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: runAt.Add(-time.Hour), UpdatedAt: runAt.Add(-time.Hour),
	}
	_, err := db.NewInsert().Model(publication).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-" + id, PublicationID: id, SocialAccountID: "account-1", Platform: "x",
		Body: id, SettingsJSON: "{}", Status: models.RenditionStatusScheduled, CreatedAt: runAt.Add(-time.Hour), UpdatedAt: runAt.Add(-time.Hour),
	}).Exec(t.Context())
	require.NoError(t, err)
}

func queueReminderEmailJobs(t *testing.T, db *bun.DB) []models.Job {
	t.Helper()
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).
		Where("type = ?", jobregistry.TypeNotificationEmail).
		Where("payload LIKE ?", "%queue_reminder%").
		Order("run_at ASC", "id ASC").Scan(t.Context()))
	return jobs
}
