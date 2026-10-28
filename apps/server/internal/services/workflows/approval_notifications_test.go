package workflows

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// approvalNotificationService wires a real notification service into a workflow
// service so the transitions can be observed through the notifications table.
func approvalNotificationService(t *testing.T, s *Service) {
	t.Helper()
	s.SetNotificationService(notifications.NewService(s.db))
}

// addApprover inserts an active member with the given role who is not the run's
// author, which is the audience an approval wait is actually for.
func addApprover(t *testing.T, s *Service, userID, role string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := s.db.NewInsert().Model(&models.User{ID: userID, Email: userID + "@example.com", PasswordHash: "hash", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: userID, Role: role, Status: models.WorkspaceMemberStatusActive, CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
}

func approvalSteps() []Step {
	return []Step{
		{ID: "review", Kind: KindApproval, Inputs: map[string]Value{"publication_id": literal("post-1")}},
		{ID: "outcomes", Kind: KindFields, Inputs: map[string]Value{"fields": reference("review.publication_id")}},
	}
}

func approvalAction() actionFunc {
	return func(_ context.Context, input EffectRequest) (EffectResult, error) {
		if input.Kind == KindApproval {
			return EffectResult{Output: map[string]any{"publication_id": "post-1", "revision": 1, "text": "review me"}}, nil
		}
		return EffectResult{Output: map[string]any{"ok": true}}, nil
	}
}

func notificationsFor(t *testing.T, s *Service, userID string) []models.UserNotification {
	t.Helper()
	rows := []models.UserNotification{}
	require.NoError(t, s.db.NewSelect().Model(&rows).
		Where("user_id = ? AND type = ?", userID, notifications.TypeWorkflowApproval).
		Order("created_at ASC").Scan(t.Context()))
	return rows
}

// noticesInState selects the approval notices a person holds for one state, so
// a recipient who has both a "waiting" and an "expired" row is unambiguous.
func noticesInState(t *testing.T, s *Service, userID, state string) []models.UserNotification {
	t.Helper()
	matching := []models.UserNotification{}
	for _, row := range notificationsFor(t, s, userID) {
		if strings.Contains(row.DedupKey, ":"+state) {
			matching = append(matching, row)
		}
	}
	return matching
}

// parkApproval starts a workflow that stops for approval and returns the run.
func parkApproval(t *testing.T, s *Service, actor workspaceaccess.ActorFacts) Run {
	t.Helper()
	workflow := saveTestWorkflow(t, s, actor, approvalSteps())
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	awaiting, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateApproval, awaiting.State)
	return awaiting
}

// parkApprovalTwice parks the run, then parks it again by driving the service
// directly. There is no live path that re-parks the same step, but the dedup key
// is permanent and must still be the thing that makes the two notices distinct,
// so the test drives the real emission twice instead of asserting on a no-op.
func emitWaitingTwice(t *testing.T, s *Service, run Run) {
	t.Helper()
	var record runRecord
	require.NoError(t, s.db.NewSelect().Model(&record).Where("id = ?", run.ID).Scan(t.Context()))
	s.notifyParkedApproval(t.Context(), record, decodeRunResults(record))
	s.notifyParkedApproval(t.Context(), record, decodeRunResults(record))
}

// The client role exists so the person who owns the accounts can decide an
// approval without being able to administer the workspace. Approving is
// LevelApprove, which a client satisfies, so the client is exactly who a parked
// run is waiting for — and must therefore be told. An audience built from the
// administrator role alone would leave the client out, which is the one person
// the notification is for.
func TestParkedApprovalNotifiesClientsBecauseTheyCanApprove(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "client", models.WorkspaceRoleClient)

	run := parkApproval(t, s, actor)

	client := notificationsFor(t, s, "client")
	require.Len(t, client, 1)
	require.Contains(t, client[0].Href, "run="+run.ID)

	require.Empty(t, notificationsFor(t, s, "user"))
}

// The audience follows the same matrix that authorizes the decision. An editor
// and a viewer cannot approve, so telling them would be noise pointing at a
// button they do not have.
func TestParkedApprovalSkipsRolesThatCannotApprove(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "editor", models.WorkspaceRoleEditor)
	addApprover(t, s, "viewer", models.WorkspaceRoleViewer)

	run := parkApproval(t, s, actor)

	for _, userID := range []string{"editor", "viewer"} {
		require.Empty(t, notificationsFor(t, s, userID), userID)
	}

	// Nobody in this workspace could approve except the author, so the author is
	// told after all rather than leaving the wait invisible. The author here is
	// an administrator, so the copy invites them to decide it.
	author := notificationsFor(t, s, "user")
	require.Len(t, author, 1)
	require.Contains(t, author[0].Href, "run="+run.ID)
}

// A workspace where nobody — not even the author — can approve cannot end in an
// approval. Telling that author to review the post would be a dead button, so
// the audience resolver marks them separately and the copy names the real
// problem. Demoting the author mid-run would fail the run's own authorization,
// so this drives the resolver that makes the decision.
func TestWaitingAudienceMarksAnAuthorWhoCannotApprove(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	run := parkApproval(t, s, actor)

	_, err := s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleEditor).
		Where("workspace_id = ? AND user_id = ?", "ws", actor.UserID).Exec(t.Context())
	require.NoError(t, err)

	var record runRecord
	require.NoError(t, s.db.NewSelect().Model(&record).Where("id = ?", run.ID).Scan(t.Context()))

	recipients, err := s.waitingAudience(t.Context(), s.db, record, actor.UserID)
	require.NoError(t, err)
	require.Len(t, recipients, 1)
	require.Equal(t, actor.UserID, recipients[0].userID)
	require.Equal(t, notifications.ApprovalAudienceNoApprover, recipients[0].audience)
}

// An inactive member keeps their role but has left the workspace, so they must
// not be addressed.
func TestParkedApprovalSkipsInactiveMembers(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	now := time.Now().UTC()
	_, err := s.db.NewInsert().Model(&models.User{ID: "gone", Email: "gone@example.com", PasswordHash: "hash", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "gone", Role: models.WorkspaceRoleClient, Status: models.WorkspaceMemberStatusInactive, CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)

	parkApproval(t, s, actor)

	require.Empty(t, notificationsFor(t, s, "gone"))
}

// The same wait, emitted twice, must leave one row. This drives the real
// emission twice rather than re-running a job that cannot claim an
// awaiting_approval run, so it actually reaches the insert both times.
func TestParkedApprovalNotifiesOncePerWait(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)

	run := parkApproval(t, s, actor)
	emitWaitingTwice(t, s, run)

	require.Len(t, notificationsFor(t, s, "approver"), 1)
}

// An expiry is final and used to be silent. Both the approvers and the author
// are told, because the author's post just died — and they are told different
// things.
func TestExpiredApprovalNotifiesApproversAndAuthor(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	recorder := &telemetry.MemoryRecorder{}
	s.SetTelemetry(recorder)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)
	addApprover(t, s, "client", models.WorkspaceRoleClient)

	run := parkApproval(t, s, actor)
	require.Empty(t, notificationsFor(t, s, "user"))
	waitingAdmin := noticesInState(t, s, "approver", "waiting")
	require.Len(t, waitingAdmin, 1)
	require.Equal(t, "ws", waitingAdmin[0].WorkspaceID)
	require.Contains(t, waitingAdmin[0].Href, "run="+run.ID)

	// Age the wait past MaxRunAge, then run the sweep that fails stale waits.
	_, err := s.db.NewUpdate().Model((*runRecord)(nil)).
		Set("created_at = ?", time.Now().UTC().Add(-MaxRunAge-time.Hour)).
		Where("id = ?", run.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowSweep, "{}"))

	var stored runRecord
	require.NoError(t, s.db.NewSelect().Model(&stored).Where("id = ?", run.ID).Scan(t.Context()))
	require.Equal(t, StateFailed, stored.State)

	for _, userID := range []string{"approver", "client"} {
		waiting := noticesInState(t, s, userID, "waiting")
		require.Len(t, waiting, 1)
		require.False(t, waiting[0].ReadAt.IsZero())
		require.NotContains(t, waiting[0].PayloadJSON, "Review post")
		require.Contains(t, waiting[0].Title, "expired")
		expired := noticesInState(t, s, userID, "expired")
		require.Len(t, expired, 1, userID)
		require.Contains(t, expired[0].Href, "run="+run.ID)
		require.Contains(t, expired[0].Title, "expired")
	}

	author := noticesInState(t, s, "user", "expired")
	require.Len(t, author, 1)
	require.Contains(t, author[0].Title, "Your post was not published")
	require.Contains(t, author[0].Href, "/publications/post-1")

	// A second sweep must not re-report an expiry that was already recorded.
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowSweep, "{}"))
	for _, userID := range []string{"approver", "client", "user"} {
		require.Len(t, noticesInState(t, s, userID, "expired"), 1, userID)
	}
	require.Len(t, recorder.Events, 1)
	require.Equal(t, telemetry.EventWorkflowRunFinished, recorder.Events[0].Name)
	require.Equal(t, StateFailed, recorder.Events[0].Properties["outcome"])
}

// A wait that is about to run out is mentioned while the reader can still act
// on it. Without this the only notice arrives thirty days later, when the post
// is already dead.
func TestApprovalReminderFiresInsideTheReminderWindow(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)

	run := parkApproval(t, s, actor)

	// Too early: a fresh wait is nowhere near its deadline.
	require.NoError(t, s.sweep(context.Background()))
	for _, row := range notificationsFor(t, s, "approver") {
		require.NotContains(t, row.Title, "Still waiting", "a fresh wait must not be reminded")
	}

	// Move the wait into the reminder band: inside ReminderLead of the deadline.
	_, err := s.db.NewUpdate().Model((*runRecord)(nil)).
		Set("created_at = ?", time.Now().UTC().Add(-MaxRunAge+48*time.Hour)).
		Where("id = ?", run.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, s.sweep(context.Background()))

	var reminded []models.UserNotification
	for _, row := range notificationsFor(t, s, "approver") {
		if row.Title == "Still waiting for your approval" {
			reminded = append(reminded, row)
		}
	}
	require.Len(t, reminded, 1)
	require.Contains(t, reminded[0].Body, "2 days")

	// Sweeping again is a no-op: the dedup key carries the idempotency.
	require.NoError(t, s.sweep(context.Background()))
	count := 0
	for _, row := range notificationsFor(t, s, "approver") {
		if row.Title == "Still waiting for your approval" {
			count++
		}
	}
	require.Equal(t, 1, count)
}

// A recipient whose stored preferences cannot be decoded used to make the park
// itself fail: the notification ran inside the run's transaction, so the error
// rolled the state change back, the run stayed behind its lease, the sweep
// re-enqueued it and the step replayed — forever, invisibly. The state change
// must survive a notification that cannot be written.
func TestParkedApprovalSurvivesAPoisonedRecipient(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)
	addApprover(t, s, "broken", models.WorkspaceRoleClient)

	_, err := s.db.NewInsert().Model(&models.UserNotificationPreference{
		UserID: "broken", PreferencesJSON: "{not json", UpdatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	// The run must still park, and the healthy recipient must still be told.
	run := parkApproval(t, s, actor)
	require.Equal(t, StateApproval, run.State)
	require.Len(t, notificationsFor(t, s, "approver"), 1)
	require.Empty(t, notificationsFor(t, s, "broken"))
}

// The expiry batch must not be stopped by one run that cannot be notified.
// Before this, expireApprovals returned on the first error, so a single poisoned
// run left every other wait unexpired, every minute.
func TestExpiryBatchIsNotStoppedByOneRun(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)

	first := parkApproval(t, s, actor)
	second := parkApproval(t, s, actor)

	_, err := s.db.NewUpdate().Model((*runRecord)(nil)).
		Set("created_at = ?", time.Now().UTC().Add(-MaxRunAge-time.Hour)).
		Where("id IN (?)", bun.List([]string{first.ID, second.ID})).Exec(t.Context())
	require.NoError(t, err)

	_, err = s.db.ExecContext(t.Context(), fmt.Sprintf(`CREATE TRIGGER reject_one_expiry BEFORE UPDATE OF state ON workflow_runs
 WHEN OLD.id = '%s' AND NEW.state = 'failed'
 BEGIN SELECT RAISE(FAIL, 'expiry unavailable'); END`, first.ID))
	require.NoError(t, err)
	require.NoError(t, s.sweep(context.Background()))

	// Both expired, not just the first one in the batch.
	for _, id := range []string{second.ID} {
		var stored runRecord
		require.NoError(t, s.db.NewSelect().Model(&stored).Where("id = ?", id).Scan(t.Context()))
		require.Equal(t, StateFailed, stored.State, id)
	}
	require.Len(t, noticesInState(t, s, "approver", "expired"), 1)
	var blocked runRecord
	require.NoError(t, s.db.NewSelect().Model(&blocked).Where("id = ?", first.ID).Scan(t.Context()))
	require.Equal(t, StateApproval, blocked.State)
}

// A stale compare-and-set must not expire a row that moved on. The revision is
// part of the guard, so a caller holding an older revision loses the race.
func TestExpireApprovalWaitRequiresTheCurrentRevision(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)

	run := parkApproval(t, s, actor)

	var stale runRecord
	require.NoError(t, s.db.NewSelect().Model(&stale).Where("id = ?", run.ID).Scan(t.Context()))
	stale.Revision-- // a reader that saw the row before it parked

	expired, err := s.expireApprovalWait(t.Context(), stale, time.Now().UTC())
	require.NoError(t, err)
	require.False(t, expired, "a stale revision must not expire the wait")

	var stored runRecord
	require.NoError(t, s.db.NewSelect().Model(&stored).Where("id = ?", run.ID).Scan(t.Context()))
	require.Equal(t, StateApproval, stored.State)

	// With the current revision it goes through.
	expired, err = s.expireApprovalWait(t.Context(), stored, time.Now().UTC())
	require.NoError(t, err)
	require.True(t, expired)
}

// Deciding a wait must resolve the notices it left behind, or the other
// approvers keep a button that now answers ErrState.
func TestApprovingResolvesTheOtherApproversNotices(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)
	addApprover(t, s, "client", models.WorkspaceRoleClient)

	run := parkApproval(t, s, actor)
	require.Len(t, notificationsFor(t, s, "client"), 1)

	clientActor := workspaceaccess.ActorFacts{UserID: "client"}
	_, err := s.Approve(t.Context(), clientActor, "ws", run.ID, run.Revision, 1)
	require.NoError(t, err)

	rows := notificationsFor(t, s, "approver")
	require.Len(t, rows, 1)
	require.False(t, rows[0].ReadAt.IsZero(), "the stale notice must be resolved")
	require.Contains(t, rows[0].Title, "already decided")
	require.NotContains(t, rows[0].Body, "Someone else")
	require.NotContains(t, rows[0].PayloadJSON, "Review post")
}

func TestApprovalRemindersReachBeyondFirstBatch(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	run := parkApproval(t, s, actor)
	var original runRecord
	require.NoError(t, s.db.NewSelect().Model(&original).Where("id = ?", run.ID).Scan(t.Context()))
	now := time.Now().UTC()
	for index := range 101 {
		record := original
		record.ID = fmt.Sprintf("reminder-%03d", index)
		record.CreatedAt = now.Add(-MaxRunAge + 48*time.Hour)
		_, err := s.db.NewInsert().Model(&record).Exec(t.Context())
		require.NoError(t, err)
	}
	require.NoError(t, s.sweep(t.Context()))
	require.Len(t, noticesInState(t, s, "user", "reminder"), 101)
	require.NoError(t, s.sweep(t.Context()))
	require.Len(t, noticesInState(t, s, "user", "reminder"), 101)
}

func TestApprovalResolutionIncludesFormerApprovers(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "client", models.WorkspaceRoleClient)
	addApprover(t, s, "approver", models.WorkspaceRoleAdmin)
	run := parkApproval(t, s, actor)
	_, err := s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).Where("user_id = ?", "client").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.Cancel(t.Context(), actor, "ws", run.ID, run.Revision)
	require.NoError(t, err)
	for _, userID := range []string{"client", "approver"} {
		rows := notificationsFor(t, s, userID)
		require.Len(t, rows, 1, userID)
		require.False(t, rows[0].ReadAt.IsZero(), userID)
		require.NotContains(t, rows[0].PayloadJSON, "Review post", userID)
	}
}

func TestApprovalExpiryNotificationRetriesAfterRecipientFailure(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "approver", models.WorkspaceRoleClient)
	run := parkApproval(t, s, actor)
	_, err := s.db.NewInsert().Model(&models.UserNotificationPreference{
		UserID: "approver", PreferencesJSON: "{invalid", UpdatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*runRecord)(nil)).Set("created_at = ?", time.Now().UTC().Add(-MaxRunAge-time.Hour)).Where("id = ?", run.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, s.sweep(t.Context()))
	require.Empty(t, noticesInState(t, s, "approver", "expired"))
	require.Len(t, noticesInState(t, s, "user", "expired"), 1, "a poisoned recipient must not block healthy recipients")
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).Where("type = ? AND dedupe_key = ?", "workflow_approval_notice", run.ID+":review:expired").Scan(t.Context()))
	_, err = s.db.NewDelete().Model((*models.UserNotificationPreference)(nil)).Where("user_id = ?", "approver").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, s.HandleJob(t.Context(), job.Type, job.Payload))
	require.Len(t, noticesInState(t, s, "approver", "expired"), 1)
	require.Len(t, noticesInState(t, s, "user", "expired"), 1)
}

func TestDelayedApprovalNoticeDoesNotReopenDecidedWait(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	run := parkApproval(t, s, actor)
	var stale runRecord
	require.NoError(t, s.db.NewSelect().Model(&stale).Where("id = ?", run.ID).Scan(t.Context()))
	_, err := s.db.NewDelete().Model((*models.UserNotification)(nil)).Where("workspace_id = ?", "ws").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.Cancel(t.Context(), actor, "ws", run.ID, run.Revision)
	require.NoError(t, err)
	s.notifyParkedApproval(t.Context(), stale, decodeRunResults(stale))
	require.Empty(t, notificationsFor(t, s, "user"))
	// Exercise the same stale delivery through the real queue dispatch boundary.
	require.NoError(t, s.HandleJob(t.Context(), "workflow_approval_notice",
		fmt.Sprintf(`{"run_id":%q,"step_id":"review","state":"waiting"}`, run.ID)))
	require.Empty(t, notificationsFor(t, s, "user"))
}

func TestApprovalRecipientRechecksRoleBeforeDelivery(t *testing.T) {
	s, actor := workflowTestService(t, approvalAction())
	approvalNotificationService(t, s)
	addApprover(t, s, "client", models.WorkspaceRoleClient)
	run := parkApproval(t, s, actor)
	var record runRecord
	require.NoError(t, s.db.NewSelect().Model(&record).Where("id = ?", run.ID).Scan(t.Context()))
	_, err := s.db.NewDelete().Model((*models.UserNotification)(nil)).Where("user_id = ?", "client").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("user_id = ?", "client").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, s.deliverApprovalNoticeToRecipient(t.Context(), record, "review", notifications.ApprovalStateWaiting,
		approvalRecipient{userID: "client", audience: notifications.ApprovalAudienceApprover}))
	require.Empty(t, notificationsFor(t, s, "client"))
}

func TestApprovedNoticeRetainsDecisionAfterRunEnds(t *testing.T) {
	for _, state := range []string{StateFailed, StateCancelled} {
		t.Run(state, func(t *testing.T) {
			s, actor := workflowTestService(t, approvalAction())
			approvalNotificationService(t, s)
			run := parkApproval(t, s, actor)
			approved, err := s.Approve(t.Context(), actor, "ws", run.ID, run.Revision, 1)
			require.NoError(t, err)
			if state == StateCancelled {
				_, err = s.Cancel(t.Context(), actor, "ws", run.ID, approved.Revision)
			} else {
				_, err = s.db.NewUpdate().Model((*runRecord)(nil)).Set("state = ?, error = ?, current_step_id = ?", state, "Later step failed", "outcomes").Where("id = ?", run.ID).Exec(t.Context())
			}
			require.NoError(t, err)
			var job models.Job
			require.NoError(t, s.db.NewSelect().Model(&job).Where("type = ? AND dedupe_key = ?", "workflow_approval_notice", run.ID+":review:resolved").Scan(t.Context()))
			require.NoError(t, s.HandleJob(t.Context(), job.Type, job.Payload))
			rows := notificationsFor(t, s, "user")
			require.Len(t, rows, 1)
			require.Contains(t, rows[0].Title, "decided")
			require.NotContains(t, rows[0].Title, "expired")
			require.NotContains(t, rows[0].Title, "cancelled")
		})
	}
}
