package notifications

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

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
