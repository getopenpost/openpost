package workflows

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"math"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

// approvalExpiredMessage is the run error recorded when a wait runs out. It is
// unchanged from the silent version of this sweep.
const approvalExpiredMessage = "The approval expired after 30 days."

// Approval delivery runs after lifecycle commits. A durable job retains each
// transition, and the workspace fence prevents delayed requests after a decision.

// approvalRecipient is one person to tell, and how the message should read to
// them. The audience travels with the recipient because the same transition is
// good news for nobody and different news for each of them.
type approvalRecipient struct {
	userID   string
	audience string
}

// approvalRecipients resolves who may decide a parked approval: the workspace's
// active members whose role satisfies LevelApprove, excluding excludeUserID.
//
// The audience is derived from the access package rather than written out here.
// Approving is LevelApprove, and the roles that satisfy it are not only the
// administrators — a client may decide an approval without being able to
// administer the workspace, which is the entire point of that role. A hardcoded
// administrator filter would leave the client out of the audience, so the
// person the run is waiting for would be the one person never told about it.
func (s *Service) approvalRecipients(ctx context.Context, db bun.IDB, workspaceID, excludeUserID string, levels ...workspaceaccess.Level) ([]string, error) {
	level := workspaceaccess.LevelApprove
	if len(levels) > 0 {
		level = levels[0]
	}
	roles := workspaceaccess.RolesMeetingLevel(level)
	if len(roles) == 0 {
		return nil, nil
	}
	members := []models.WorkspaceMember{}
	if err := db.NewSelect().Model(&members).
		Column("user_id").
		Where("workspace_id = ? AND status = ?", workspaceID, models.WorkspaceMemberStatusActive).
		Where("role IN (?)", bun.List(roles)).
		Order("created_at ASC", "user_id ASC").
		Scan(ctx); err != nil {
		return nil, err
	}
	recipients := make([]string, 0, len(members))
	for _, member := range members {
		userID := strings.TrimSpace(member.UserID)
		if userID == "" || userID == excludeUserID {
			continue
		}
		recipients = append(recipients, userID)
	}
	return recipients, nil
}

// authorCanApprove reports whether the author holds the level needed to decide
// their own approval. It decides which copy a fallback recipient gets: telling
// an editor to "review the post" would hand them a button that fails.
func (s *Service) authorCanApprove(ctx context.Context, db bun.IDB, workspaceID, userID string, levels ...workspaceaccess.Level) (bool, error) {
	if userID == "" {
		return false, nil
	}
	level := workspaceaccess.LevelApprove
	if len(levels) > 0 {
		level = levels[0]
	}
	roles := workspaceaccess.RolesMeetingLevel(level)
	if len(roles) == 0 {
		return false, nil
	}
	exists, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, userID, models.WorkspaceMemberStatusActive).
		Where("role IN (?)", bun.List(roles)).
		Exists(ctx)
	return exists, err
}

// runAuthor reports who started the run, as recorded in its stored authority.
func runAuthor(record runRecord) string {
	var authority workspaceaccess.StoredAuthority
	if err := json.Unmarshal([]byte(record.AuthorityJSON), &authority); err != nil {
		return ""
	}
	return strings.TrimSpace(authority.UserID)
}

// parkedApproval finds the step result that put the run into the approval
// state. It is how the publication being reviewed is recovered, both when the
// wait starts and when it expires much later.
func parkedApproval(results []StepResult) (StepResult, bool) {
	for index := len(results) - 1; index >= 0; index-- {
		if results[index].State == StateApproval {
			return results[index], true
		}
	}
	return StepResult{}, false
}

func decodeRunResults(record runRecord) []StepResult {
	results := []StepResult{}
	if err := json.Unmarshal([]byte(record.ResultsJSON), &results); err != nil {
		return nil
	}
	return results
}

func approvalPublicationID(result StepResult) string {
	publicationID, _ := result.Inputs["publication_id"].(string)
	return strings.TrimSpace(publicationID)
}

// waitingAudience answers who hears that a run has parked. The author is
// skipped: they just took the action that parked it, and the wait is for
// somebody else. If that leaves nobody — a workspace whose only approver is the
// author — the author is told after all, because a silent queue is the exact
// problem this exists to remove. Their copy depends on whether they can
// actually decide it.
func (s *Service) waitingAudience(ctx context.Context, db bun.IDB, record runRecord, author string) ([]approvalRecipient, error) {
	approvers, err := s.approvalRecipients(ctx, db, record.WorkspaceID, author, approvalLevel(record))
	if err != nil {
		return nil, err
	}
	if len(approvers) > 0 {
		recipients := make([]approvalRecipient, 0, len(approvers))
		for _, userID := range approvers {
			recipients = append(recipients, approvalRecipient{userID: userID, audience: notifications.ApprovalAudienceApprover})
		}
		return recipients, nil
	}
	if author == "" {
		return nil, nil
	}
	canApprove, err := s.authorCanApprove(ctx, db, record.WorkspaceID, author, approvalLevel(record))
	if err != nil {
		return nil, err
	}
	audience := notifications.ApprovalAudienceNoApprover
	if canApprove {
		audience = notifications.ApprovalAudienceApprover
	}
	return []approvalRecipient{{userID: author, audience: audience}}, nil
}

// expiredAudience answers who hears that a wait ran out. Unlike the request,
// the author is always included: their post died. An author who is also an
// approver gets the author copy rather than the approver copy, because "your
// post was not published" is the actionable half and the dedup key is per run.
func (s *Service) expiredAudience(ctx context.Context, db bun.IDB, record runRecord, author string) ([]approvalRecipient, error) {
	approvers, err := s.approvalRecipients(ctx, db, record.WorkspaceID, "", approvalLevel(record))
	if err != nil {
		return nil, err
	}
	recipients := make([]approvalRecipient, 0, len(approvers)+1)
	for _, userID := range approvers {
		if userID == author {
			continue
		}
		recipients = append(recipients, approvalRecipient{userID: userID, audience: notifications.ApprovalAudienceApprover})
	}
	if author != "" {
		recipients = append(recipients, approvalRecipient{userID: author, audience: notifications.ApprovalAudienceAuthor})
	}
	return recipients, nil
}

// approvalDaysLeft is how much of the wait remains, measured from the run's own
// creation time — the same clock expireApprovals uses. It is computed here, at
// emission, so the wording can never drift from the deadline that applies.
func approvalDaysLeft(record runRecord, now time.Time) int {
	remaining := record.CreatedAt.Add(MaxRunAge).Sub(now)
	if remaining <= 0 {
		return 0
	}
	// Round up: with 47h left the reader has two days to act, not one. Flooring
	// would understate the deadline on every reminder.
	return int(math.Ceil(remaining.Hours() / 24))
}

func (s *Service) enqueueApprovalNotice(ctx context.Context, db bun.IDB, record runRecord, stepID, state string) error {
	if s.notifications == nil {
		return nil
	}
	payload, err := json.Marshal(map[string]string{"run_id": record.ID, "step_id": stepID, "state": state})
	if err != nil {
		return err
	}
	return enqueue(ctx, db, jobregistry.TypeWorkflowApprovalNotice, record.WorkspaceID,
		record.ID+":"+stepID+":"+state, string(payload), time.Now().UTC())
}

func (s *Service) notifyParkedApproval(ctx context.Context, record runRecord, results []StepResult) {
	step, ok := parkedApproval(results)
	if !ok || record.State != StateApproval {
		return
	}
	if err := s.deliverApprovalNotice(ctx, record.ID, step.StepID, notifications.ApprovalStateWaiting); err != nil {
		log.Printf("Failed to deliver approval request for run %s: %v", record.ID, err)
	}
}

// Each recipient commits independently. A poisoned preference cannot prevent
// healthy recipients receiving the notice, and the job retries failed delivery.
func (s *Service) deliverApprovalNotice(ctx context.Context, runID, stepID, state string) error {
	if s.notifications == nil {
		return nil
	}
	var record runRecord
	if err := s.db.NewSelect().Model(&record).Where("id = ?", runID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if state == "resolved" || state == notifications.ApprovalStateExpired {
		if err := s.resolveApprovalNoticeDelivery(ctx, &record, stepID, state); err != nil {
			return err
		}
		if state == "resolved" {
			return nil
		}
	}

	var recipients []approvalRecipient
	var err error
	if state == notifications.ApprovalStateExpired {
		recipients, err = s.expiredAudience(ctx, s.db, record, runAuthor(record))
	} else {
		recipients, err = s.waitingAudience(ctx, s.db, record, runAuthor(record))
	}
	if err != nil {
		return err
	}
	var failures []error
	for _, recipient := range recipients {
		err := s.deliverApprovalNoticeToRecipient(ctx, record, stepID, state, recipient)
		if err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *Service) resolveApprovalNoticeDelivery(ctx context.Context, record *runRecord, stepID, state string) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, record.WorkspaceID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(record).Where("id = ?", record.ID).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		if state == notifications.ApprovalStateExpired && !approvalNoticeIsCurrent(*record, stepID, state) {
			return nil
		}
		if record.State == StateApproval && record.CurrentStepID == stepID {
			return nil
		}
		return s.resolveApprovalNotices(ctx, tx, *record, stepID)
	})
}

func approvalNoticeIsCurrent(record runRecord, stepID, state string) bool {
	if state == notifications.ApprovalStateExpired {
		return record.State == StateFailed && record.Error == approvalExpiredMessage
	}
	return record.State == StateApproval && record.CurrentStepID == stepID
}

func (s *Service) deliverApprovalNoticeToRecipient(ctx context.Context, record runRecord, stepID, state string, recipient approvalRecipient) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, record.WorkspaceID); err != nil {
			return err
		}
		var current runRecord
		if err := tx.NewSelect().Model(&current).Where("id = ?", record.ID).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		if !approvalNoticeIsCurrent(current, stepID, state) {
			return nil
		}
		// Recheck membership while holding the same fence as workspace changes.
		membership := tx.NewSelect().Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id = ? AND status = ?", current.WorkspaceID, recipient.userID, models.WorkspaceMemberStatusActive)
		if recipient.audience == notifications.ApprovalAudienceApprover {
			membership = membership.Where("role IN (?)", bun.List(workspaceaccess.RolesMeetingLevel(approvalLevel(current))))
		}
		active, err := membership.Exists(ctx)
		if err != nil || !active {
			return err
		}
		var step StepResult
		for _, candidate := range decodeRunResults(current) {
			if candidate.StepID == stepID {
				step = candidate
				break
			}
		}
		if step.StepID == "" {
			return nil
		}
		outcome, err := notifications.NewWorkflowApprovalOutcome(notifications.WorkflowApprovalFacts{
			RecipientUserID: recipient.userID, WorkspaceID: current.WorkspaceID, RunID: current.ID, StepID: stepID,
			State: state, Audience: recipient.audience, PublicationID: approvalPublicationID(step), EngagementID: commentApprovalID(step),
			WorkflowName: current.WorkflowName, DaysLeft: approvalDaysLeft(current, time.Now().UTC()),
		})
		if err != nil {
			return err
		}
		return s.notifications.RecordWithDB(ctx, tx, outcome)
	})
}

// remindApprovals tells the approvers of a wait that is running out of time.
// The reminder is the point of the whole mechanism: without it the only notice
// arrives when the post is already dead, thirty days after anyone last thought
// about it.
//
// It is idempotent through the notification's own dedup key, so sweeping twice
// writes nothing the second time. That is why no marker column is needed: the
// cost is a repeated no-op insert for each run in the reminder band, which is
// cheaper than a schema change and cannot drift out of sync with reality.
func (s *Service) remindApprovals(ctx context.Context, now time.Time) error {
	if s.notifications == nil {
		return nil
	}
	cutoff := now.Add(-MaxRunAge).Add(ReminderLead)
	var cursorTime time.Time
	cursorID := ""
	for {
		reminding := []runRecord{}
		query := s.db.NewSelect().Model(&reminding).
			Where("state = ? AND created_at <= ? AND created_at >= ?", StateApproval, cutoff, now.Add(-MaxRunAge)).
			Order("created_at ASC", "id ASC").Limit(100)
		if cursorID != "" {
			query = query.Where("(created_at > ? OR (created_at = ? AND id > ?))", cursorTime, cursorTime, cursorID)
		}
		if err := query.Scan(ctx); err != nil {
			return err
		}
		for _, run := range reminding {
			if err := s.deliverApprovalNotice(ctx, run.ID, run.CurrentStepID, notifications.ApprovalStateReminder); err != nil {
				log.Printf("Failed to deliver approval reminder for run %s: %v", run.ID, err)
			}
		}
		if len(reminding) < 100 {
			break
		}
		last := reminding[len(reminding)-1]
		cursorTime, cursorID = last.CreatedAt, last.ID
	}

	return nil
}

// expireApprovalWait fails one wait that ran out. It reports whether the wait
// was actually expired, so the caller can notify and record telemetry only for
// a change that really committed.
//
// The compare-and-set covers the revision as well as the state. State alone
// would still yield one winner, but it would overwrite a row that advanced
// while remaining in awaiting_approval, and the contract this hook relies on is
// that a writer only ever replaces the row it read.
func (s *Service) expireApprovalWait(ctx context.Context, record runRecord, now time.Time) (bool, error) {
	expired := false
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, record.WorkspaceID); err != nil {
			return err
		}
		updated, err := tx.NewUpdate().Model((*runRecord)(nil)).
			Set("state = ?, error = ?, revision = revision + 1, updated_at = ?", StateFailed, approvalExpiredMessage, now).
			Where("id = ? AND state = ? AND revision = ?", record.ID, StateApproval, record.Revision).Exec(ctx)
		if err != nil {
			return err
		}
		if affected, _ := updated.RowsAffected(); affected != 1 {
			return nil
		}
		expired = true
		return s.enqueueApprovalNotice(ctx, tx, record, record.CurrentStepID, notifications.ApprovalStateExpired)
	})
	if err != nil || !expired {
		return expired, err
	}
	// After the commit, for the reasons at the top of this file.
	record.State = StateFailed
	if err := s.deliverApprovalNotice(ctx, record.ID, record.CurrentStepID, notifications.ApprovalStateExpired); err != nil {
		log.Printf("Failed to deliver approval expiry for run %s: %v", record.ID, err)
	}
	return true, nil
}

// resolveApprovalNoticesAfterDecision resolves the notices a decided wait left
// behind, logging rather than failing. It runs after the decision has already
// committed, so a stale notification is a worse outcome than an error here, but
// neither is worth undoing a decision that already happened.
func (s *Service) resolveApprovalNoticesAfterDecision(ctx context.Context, record runRecord) {
	if err := s.deliverApprovalNotice(ctx, record.ID, record.CurrentStepID, "resolved"); err != nil {
		log.Printf("Failed to resolve approval notifications for run %s: %v", record.ID, err)
	}
}

// resolveApprovalNotices clears the notices that a decided wait left behind.
// When one approver decides, the others are still holding an item that says
// "waiting for your approval" and a button that leads to a run which will
// answer ErrState. The row keeps its place in the history, but stops claiming
// something untrue.
func (s *Service) resolveApprovalNotices(ctx context.Context, db bun.IDB, record runRecord, stepID string) error {
	if s.notifications == nil {
		return nil
	}
	if stepID == "" {
		return nil
	}
	keys := []string{
		notifications.WorkflowApprovalDedupKey(record.ID, stepID, notifications.ApprovalStateWaiting),
		notifications.WorkflowApprovalDedupKey(record.ID, stepID, notifications.ApprovalStateReminder),
	}
	recipients := []string{}
	if err := db.NewSelect().Model((*models.UserNotification)(nil)).ColumnExpr("DISTINCT user_id").
		Where("workspace_id = ? AND dedup_key IN (?)", record.WorkspaceID, bun.List(keys)).Scan(ctx, &recipients); err != nil {
		return err
	}
	title, body := "Approval already decided", "This approval was decided, so there is nothing left to review."
	switch record.State {
	case StateFailed:
		if record.Error == approvalExpiredMessage && record.CurrentStepID == stepID {
			title, body = "Approval expired", "The approval window closed, so there is nothing left to review."
		}
	case StateCancelled:
		if step, ok := parkedApproval(decodeRunResults(record)); ok && step.StepID == stepID {
			title, body = "Approval cancelled", "This workflow was cancelled, so there is nothing left to review."
		}
	}

	return s.notifications.ResolveByDedupKeys(ctx, db, recipients, keys,
		title, body)
}

func approvalLevel(record runRecord) workspaceaccess.Level {
	step, ok := parkedApproval(decodeRunResults(record))
	if ok && (step.Kind == KindCommentReply || step.Kind == KindPrivateReply) {
		return workspaceaccess.LevelAdminister
	}
	return workspaceaccess.LevelApprove
}
func commentApprovalID(step StepResult) string {
	if step.Kind == KindCommentReply || step.Kind == KindPrivateReply {
		id, _ := step.Inputs["engagement_id"].(string)
		return id
	}
	return ""
}
