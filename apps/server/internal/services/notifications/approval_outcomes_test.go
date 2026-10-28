package notifications

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestWorkflowApprovalOutcomesRejectIncompleteFacts(t *testing.T) {
	valid := WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
	}

	_, err := NewWorkflowApprovalOutcome(WorkflowApprovalFacts{
		WorkspaceID: "workspace-1", RunID: "run-1", StepID: "step-1",
		State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
	})
	require.ErrorIs(t, err, ErrInvalidOutcome, "a recipient is required")

	_, err = NewWorkflowApprovalOutcome(WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
	})
	require.ErrorIs(t, err, ErrInvalidOutcome, "a wait is identified by its step")

	// An expiry is per run, so it needs no step.
	expired := valid
	expired.State = ApprovalStateExpired
	expired.StepID = ""
	_, err = NewWorkflowApprovalOutcome(expired)
	require.NoError(t, err)

	unknownState := valid
	unknownState.State = "pending"
	_, err = NewWorkflowApprovalOutcome(unknownState)
	require.ErrorIs(t, err, ErrInvalidOutcome)

	unknownAudience := valid
	unknownAudience.Audience = "everyone"
	_, err = NewWorkflowApprovalOutcome(unknownAudience)
	require.ErrorIs(t, err, ErrInvalidOutcome)
}

// One topic carries the whole life of a wait, and each state gets its own
// identity so the three can coexist and be resolved independently.
func TestWorkflowApprovalStatesShareATopicAndKeepDistinctIdentities(t *testing.T) {
	base := WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", Audience: ApprovalAudienceApprover,
	}

	waiting := base
	waiting.State = ApprovalStateWaiting
	reminder := base
	reminder.State = ApprovalStateReminder
	reminder.DaysLeft = 3
	expired := base
	expired.State = ApprovalStateExpired
	expired.StepID = ""

	for _, facts := range []WorkflowApprovalFacts{waiting, reminder, expired} {
		outcome, err := NewWorkflowApprovalOutcome(facts)
		require.NoError(t, err)
		require.Equal(t, TypeWorkflowApproval, outcome.notificationOutcome().topic)
	}

	waitingValue := mustOutcome(t, waiting).notificationOutcome()
	reminderValue := mustOutcome(t, reminder).notificationOutcome()
	expiredValue := mustOutcome(t, expired).notificationOutcome()

	require.Equal(t, "run-1:step-1:waiting", waitingValue.eventID)
	require.Equal(t, "run-1:step-1:reminder", reminderValue.eventID)
	require.Equal(t, "run-1:expired", expiredValue.eventID)

	// The dedup key the producer will later resolve must match the stored one.
	require.Equal(t, "workflow_approval:run-1:step-1:waiting", WorkflowApprovalDedupKey("run-1", "step-1", ApprovalStateWaiting))
	require.Equal(t, "workflow_approval:run-1:expired", WorkflowApprovalDedupKey("run-1", "", ApprovalStateExpired))
}

// A workflow may contain two approval steps, so one run can park twice. Keying
// the wait on the run alone would silently swallow the second notice.
func TestWorkflowApprovalKeepsASecondWaitOnTheSameRunDistinct(t *testing.T) {
	first, err := NewWorkflowApprovalOutcome(WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
	})
	require.NoError(t, err)
	second, err := NewWorkflowApprovalOutcome(WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-2", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
	})
	require.NoError(t, err)

	require.NotEqual(t, first.notificationOutcome().eventID, second.notificationOutcome().eventID)
	require.NotEqual(t, WorkflowApprovalDedupKey("run-1", "step-1", ApprovalStateWaiting),
		WorkflowApprovalDedupKey("run-1", "step-2", ApprovalStateWaiting))
}

// Each state says something different, and the expiry speaks differently to the
// person who could have decided it and to the person whose post died.
func TestWorkflowApprovalCopyFollowsStateAndAudience(t *testing.T) {
	base := WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", PublicationID: "publication-1", WorkflowName: "Weekly review",
	}

	waiting := base
	waiting.State = ApprovalStateWaiting
	waiting.Audience = ApprovalAudienceApprover
	waitingInput := materialize(t, waiting)

	expiredApprover := base
	expiredApprover.State = ApprovalStateExpired
	expiredApprover.Audience = ApprovalAudienceApprover
	expiredApproverInput := materialize(t, expiredApprover)

	expiredAuthor := expiredApprover
	expiredAuthor.Audience = ApprovalAudienceAuthor
	expiredAuthorInput := materialize(t, expiredAuthor)

	require.NotEqual(t, waitingInput.Title, expiredApproverInput.Title)
	require.NotEqual(t, expiredApproverInput.Title, expiredAuthorInput.Title)
	require.NotEqual(t, expiredApproverInput.Body, expiredAuthorInput.Body)

	// The approver hears about the run; the author hears about their post.
	require.Contains(t, expiredApproverInput.Href, "/workflows?run=run-1")
	require.Contains(t, expiredAuthorInput.Href, "/publications/publication-1")
}

// A workspace where nobody holds the approving level cannot end in an approval,
// so telling the author to "review" the post would hand them a button that
// fails. They get copy that names the real problem.
func TestWorkflowApprovalTellsTheAuthorWhenNobodyCanApprove(t *testing.T) {
	noApprover := materialize(t, WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceNoApprover,
		PublicationID: "publication-1",
	})
	approver := materialize(t, WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
		PublicationID: "publication-1",
	})
	require.NotEqual(t, noApprover.Title, approver.Title)
	require.NotEqual(t, noApprover.Body, approver.Body)
	require.NotEqual(t, noApprover.Href, approver.Href)
}

// The reminder is the only notice that arrives while the reader can still act,
// so its wording has to reflect the time that is actually left.
func TestWorkflowApprovalReminderReportsTheTimeLeft(t *testing.T) {
	base := WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateReminder, Audience: ApprovalAudienceApprover,
	}

	oneDay := base
	oneDay.DaysLeft = 1
	threeDays := base
	threeDays.DaysLeft = 3
	lastDay := base
	lastDay.DaysLeft = 0

	oneDayInput := materialize(t, oneDay)
	threeDaysInput := materialize(t, threeDays)
	lastDayInput := materialize(t, lastDay)

	require.Contains(t, oneDayInput.Body, "One day")
	require.Contains(t, threeDaysInput.Body, "3 days")
	require.NotEqual(t, oneDayInput.Body, threeDaysInput.Body)
	require.Contains(t, lastDayInput.Body, "expires today", "the final day must say the approval expires today")
	require.NotContains(t, lastDayInput.Body, "1 day")
	require.NotEqual(t, lastDayInput.Body, oneDayInput.Body)
}

// One topic joins the publishing group, so the whole mechanism inherits the
// existing preference surface instead of adding a new one.
func TestWorkflowApprovalJoinsThePublishingGroup(t *testing.T) {
	policy, ok := topicPolicyFor(TypeWorkflowApproval)
	require.True(t, ok)
	require.Equal(t, "publishing", policy.definition.Group)
	require.False(t, policy.definition.Transactional)
	require.True(t, policy.definition.EmailMutable)
	require.Contains(t, policy.definition.EmailFrequencies, EmailFrequencyImmediate)
	require.Contains(t, policy.definition.EmailFrequencies, EmailFrequencyDaily)
	require.Equal(t, "notifications.event."+TypeWorkflowApproval, policy.definition.PresentationKey)

	// The retired per-transition topics must be gone, or the preferences page
	// would offer two switches for one mechanism.
	for _, retired := range []string{"approval_requested", "approval_expired"} {
		_, exists := topicPolicyFor(retired)
		require.False(t, exists, retired)
	}
}

// A parked draft must reach the inbox even at default preferences: the whole
// point is that the queue stops being invisible.
func TestWorkflowApprovalReachesTheInboxByDefault(t *testing.T) {
	ctx := context.Background()
	db := notificationsTestDB(t)
	service := NewService(db)

	outcome := mustOutcome(t, WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
		PublicationID: "publication-1", WorkflowName: "Weekly review",
	})
	require.NoError(t, service.Record(ctx, outcome))

	var stored models.UserNotification
	require.NoError(t, db.NewSelect().Model(&stored).
		Where("user_id = ? AND workspace_id = ?", "user-1", "workspace-1").Scan(ctx))
	require.Equal(t, TypeWorkflowApproval, stored.Type)
	require.Contains(t, stored.Href, "/workflows?run=run-1")
	require.Contains(t, stored.Href, "workspace_id=workspace-1")

	// Recording the same park twice must not duplicate the notification.
	require.NoError(t, service.Record(ctx, outcome))
	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).
		Where("user_id = ? AND dedup_key = ?", "user-1", WorkflowApprovalDedupKey("run-1", "step-1", ApprovalStateWaiting)).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

// Resolution is what stops a decided wait from leaving a dead button behind, so
// it must rewrite the text as well as clear the unread state.
func TestResolveByDedupKeysRewritesAndMarksRead(t *testing.T) {
	ctx := context.Background()
	db := notificationsTestDB(t)
	service := NewService(db)

	outcome := mustOutcome(t, WorkflowApprovalFacts{
		RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
		StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
	})
	require.NotContains(t, outcome.notificationOutcome().payload, "publication_id")
	require.NotContains(t, outcome.notificationOutcome().payload, "workflow_name")
	require.NoError(t, service.Record(ctx, outcome))

	require.NoError(t, service.ResolveByDedupKeys(ctx, db, []string{"user-1"},
		[]string{WorkflowApprovalDedupKey("run-1", "step-1", ApprovalStateWaiting)},
		"Approval already decided", "Someone else decided this approval."))

	var stored models.UserNotification
	require.NoError(t, db.NewSelect().Model(&stored).
		Where("user_id = ? AND workspace_id = ?", "user-1", "workspace-1").Scan(ctx))
	require.False(t, stored.ReadAt.IsZero())
	require.Equal(t, "Approval already decided", stored.Title)
	require.Equal(t, "Someone else decided this approval.", stored.Body)
	require.Empty(t, notificationActions(stored.PayloadJSON))

	readAt := stored.ReadAt
	require.NoError(t, service.ResolveByDedupKeys(ctx, db, []string{"user-1"},
		[]string{WorkflowApprovalDedupKey("run-1", "step-1", ApprovalStateWaiting)},
		"Approval expired", "The approval window closed."))
	require.NoError(t, db.NewSelect().Model(&stored).Where("user_id = ?", "user-1").Scan(ctx))
	require.WithinDuration(t, readAt, stored.ReadAt, time.Microsecond)
	require.Equal(t, "Approval expired", stored.Title)
}

// Resolution must be scoped to the named users. The unique index is
// (user_id, dedup_key), so a dedup_key-only update would rewrite other people's
// rows and skip the index while doing it.
func TestResolveByDedupKeysLeavesOtherUsersAlone(t *testing.T) {
	ctx := context.Background()
	db := notificationsTestDB(t)
	service := NewService(db)

	key := WorkflowApprovalDedupKey("run-1", "step-1", ApprovalStateWaiting)
	for _, userID := range []string{"user-1", "user-2"} {
		outcome := mustOutcome(t, WorkflowApprovalFacts{
			RecipientUserID: userID, WorkspaceID: "workspace-1", RunID: "run-1",
			StepID: "step-1", State: ApprovalStateWaiting, Audience: ApprovalAudienceApprover,
		})
		require.NoError(t, service.Record(ctx, outcome))
	}

	require.NoError(t, service.ResolveByDedupKeys(ctx, db, []string{"user-1"}, []string{key},
		"Approval already decided", "Someone else decided this approval."))

	var resolved models.UserNotification
	require.NoError(t, db.NewSelect().Model(&resolved).
		Where("user_id = ? AND dedup_key = ?", "user-1", key).Scan(ctx))
	require.False(t, resolved.ReadAt.IsZero())

	var untouched models.UserNotification
	require.NoError(t, db.NewSelect().Model(&untouched).
		Where("user_id = ? AND dedup_key = ?", "user-2", key).Scan(ctx))
	require.True(t, untouched.ReadAt.IsZero(), "another user's notice must stay unread")
}

func mustOutcome(t *testing.T, facts WorkflowApprovalFacts) Outcome {
	t.Helper()
	outcome, err := NewWorkflowApprovalOutcome(facts)
	require.NoError(t, err)
	return outcome
}

func materialize(t *testing.T, facts WorkflowApprovalFacts) createInput {
	t.Helper()
	input, err := materializeWorkflowApproval(mustOutcome(t, facts).notificationOutcome())
	require.NoError(t, err)
	return input
}

func TestWorkflowApprovalNoApproverActions(t *testing.T) {
	for _, state := range []string{ApprovalStateWaiting, ApprovalStateReminder} {
		for _, publicationID := range []string{"", "post-1"} {
			t.Run(state+publicationID, func(t *testing.T) {
				input := materialize(t, WorkflowApprovalFacts{
					RecipientUserID: "user-1", WorkspaceID: "workspace-1", RunID: "run-1",
					StepID: "step-1", State: state, Audience: ApprovalAudienceNoApprover,
					PublicationID: publicationID, DaysLeft: 3,
				})
				require.NotContains(t, input.Title, "your approval")
				require.NotContains(t, input.Body, "approve it yourself")
				require.Contains(t, input.Body, "workspace administrator")
				require.Len(t, input.Actions, 1)
				require.NotEqual(t, "Review post", input.Actions[0].Label)
				if publicationID == "" {
					require.Equal(t, "/workflows?run=run-1&workspace_id=workspace-1", input.Href)
					require.Equal(t, "View workflow run", input.Actions[0].Label)
				} else {
					require.Equal(t, "/publications/post-1?workspace_id=workspace-1", input.Href)
					require.Equal(t, "Open post", input.Actions[0].Label)
				}
			})
		}
	}
}
