package engagement

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type AutomationReply struct {
	bun.BaseModel `bun:"table:engagement_automation_replies"`
	ID            string    `bun:",pk" json:"id"`
	WorkspaceID   string    `json:"workspace_id"`
	ItemID        string    `json:"item_id"`
	WorkflowID    string    `json:"workflow_id"`
	RunID         string    `json:"run_id"`
	StepID        string    `json:"step_id"`
	UserID        string    `json:"-"`
	Channel       string    `json:"channel"`
	RecipientKey  string    `json:"-"`
	Body          string    `json:"body"`
	ItemBody      string    `json:"-"`
	State         string    `json:"state"`
	JobID         string    `json:"job_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
type AutomationReplyRequest struct {
	Authority                                                  workspaceaccess.StoredAuthority
	WorkflowID, RunID, StepID, ItemID, Channel, Body, Delivery string
	Approve                                                    bool
}

// A workflow effect converges onto one owned delivery. Claims survive deleted
// runs and ambiguous provider writes; a retry never creates another send.
func (s *Service) AdvanceAutomationReply(ctx context.Context, in AutomationReplyRequest) (AutomationReply, error) {
	var reply AutomationReply
	err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, in.Authority.WorkspaceID); err != nil {
			return err
		}
		item, err := s.automationContext(ctx, tx, in)
		if err != nil {
			return err
		}
		reply, err = s.claimAutomationReply(ctx, tx, item, in)
		if err != nil {
			return err
		}
		if err := s.advanceClaimedAutomationReply(ctx, tx, item, in, &reply); err != nil {
			return err
		}
		return appendEngagementChange(ctx, tx, item)
	})
	return reply, err
}
func automationSettled(state string) bool {
	return state == "sent" || state == "failed" || state == "cancelled" || state == "skipped" || state == "needs_attention"
}
func (s *Service) automationContext(ctx context.Context, tx bun.Tx, in AutomationReplyRequest) (models.EngagementItem, error) {
	decision, err := workspaceaccess.NewAuthorizer(tx).AuthorizeStored(ctx, in.Authority, workspaceaccess.LevelAdminister)
	if err != nil {
		return models.EngagementItem{}, err
	}
	if !decision.Allowed {
		return models.EngagementItem{}, ErrAccessDenied
	}
	var run struct {
		State      string
		WorkflowID string
	}
	if err := tx.NewSelect().Table("workflow_runs").Column("state", "workflow_id").Where("id = ? AND workspace_id = ?", in.RunID, in.Authority.WorkspaceID).Scan(ctx, &run); err != nil {
		return models.EngagementItem{}, errors.New("workflow run is unavailable")
	}
	if run.WorkflowID != in.WorkflowID || (run.State != "running" && (!in.Approve || run.State != "awaiting_approval")) {
		return models.EngagementItem{}, errors.New("workflow run stopped before replying")
	}
	var item models.EngagementItem
	if err := tx.NewSelect().Model(&item).Where("id = ? AND workspace_id = ?", in.ItemID, in.Authority.WorkspaceID).Scan(ctx); err != nil {
		return item, ErrNotFound
	}
	return item, s.automationEligibility(ctx, tx, item, in)
}
func (s *Service) automationEligibility(ctx context.Context, db bun.IDB, item models.EngagementItem, in AutomationReplyRequest) error {
	if err := validateAutomationReplyInputs(item, in); err != nil {
		return err
	}
	authority, err := s.loadActivityAuthority(ctx, db, item.SocialAccountID)
	if err != nil {
		return err
	}
	if authority.Account.WorkspaceID != item.WorkspaceID {
		return ErrAccessDenied
	}
	if in.Delivery == "handoff" {
		return nil
	}
	if !item.CanReply {
		return errors.New("this provider does not allow a reply to this comment")
	}
	if err := s.automationAccountEligibility(authority.Account); err != nil {
		return err
	}
	if in.Channel == "private" {
		return s.privateReplyEligibility(item, authority.Account, in.Body)
	}
	return nil
}
func (s *Service) privateReplyEligibility(item models.EngagementItem, account models.SocialAccount, body string) error {
	if item.AuthorRemoteID == "" {
		return errors.New("the commenter identity is unavailable from Instagram; reply manually in Inbox")
	}
	if item.Platform != "instagram" || !item.CanReply {
		return errors.New("private replies require an eligible Instagram professional account")
	}
	if item.RemoteCreatedAt.IsZero() || s.now().After(item.RemoteCreatedAt.Add(7*24*time.Hour)) {
		return errors.New("the seven-day Instagram private reply window has expired")
	}
	if len(strings.TrimSpace(body)) > 1000 {
		return errors.New("private Instagram replies support up to 1000 bytes")
	}
	scope := "instagram_manage_comments"
	if strings.Contains(engagementProviderKey(account), "instagram_login") {
		scope = "instagram_business_manage_comments"
	}
	if len(platform.MissingAnalyticsScopes(account.GrantedScopes, []string{scope})) > 0 {
		return errors.New("reconnect Instagram with comment permissions before sending private replies")
	}
	return nil
}
func (s *Service) claimAutomationReply(ctx context.Context, tx bun.Tx, item models.EngagementItem, in AutomationReplyRequest) (AutomationReply, error) {
	existing, found, err := findClaimedAutomationReply(ctx, tx, item, in)
	if err != nil || found {
		return existing, err
	}

	key, err := s.automationRecipientKey(ctx, tx, item)
	if err != nil {
		return AutomationReply{}, err
	}
	if in.Channel == "private" && key == "" {
		return AutomationReply{}, errors.New("the Instagram post identity is unavailable; reply manually in Inbox")
	}
	if in.Channel == "private" && key != "" {
		exists, err := tx.NewSelect().Model((*AutomationReply)(nil)).Where("workspace_id = ? AND recipient_key = ? AND channel = 'private'", item.WorkspaceID, key).Exists(ctx)
		if err != nil {
			return AutomationReply{}, err
		}
		if exists {
			return AutomationReply{ItemID: item.ID, Channel: in.Channel, State: "skipped"}, nil
		}
	}
	state, err := initialAutomationReplyState(ctx, tx, item, in, existing)
	if err != nil {
		return AutomationReply{}, err
	}

	reply := AutomationReply{ID: uuid.NewString(), WorkspaceID: item.WorkspaceID, ItemID: item.ID, WorkflowID: in.WorkflowID, RunID: in.RunID, StepID: in.StepID, UserID: in.Authority.UserID, Channel: in.Channel, RecipientKey: key, Body: strings.TrimSpace(in.Body), ItemBody: item.Body, State: state, CreatedAt: s.now(), UpdatedAt: s.now()}
	if _, err := tx.NewInsert().Model(&reply).Exec(ctx); err != nil {
		return reply, err
	}
	return reply, appendEngagementChange(ctx, tx, item)
}
func (s *Service) automationRecipientKey(ctx context.Context, db bun.IDB, item models.EngagementItem) (string, error) {
	if item.AuthorRemoteID == "" {
		return "", nil
	}
	postID := item.ConversationRemoteID
	if postID == "" && item.RenditionID != "" {
		var rendition models.Rendition
		if err := db.NewSelect().Model(&rendition).Where("id = ? AND social_account_id = ?", item.RenditionID, item.SocialAccountID).Scan(ctx); err != nil {
			return "", err
		}
		postID = rendition.ExternalID
		if postID == "" {
			postID = rendition.ID
		}
	}
	if postID == "" {
		return "", nil
	}
	return idempotency.Hash([]string{item.SocialAccountID, postID, item.AuthorRemoteID})
}
func automationOptedOut(ctx context.Context, db bun.IDB, item models.EngagementItem) (bool, error) {
	return db.NewSelect().Table("engagement_automation_optouts").Where("social_account_id = ? AND author_remote_id = ?", item.SocialAccountID, item.AuthorRemoteID).Exists(ctx)
}
func (s *Service) advanceAutomationDelivery(ctx context.Context, tx bun.Tx, item models.EngagementItem, reply *AutomationReply) error {
	accepted, err := tx.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).Where("job_id = ? AND workspace_id = ? AND social_account_id = ? AND status = ?", reply.JobID, item.WorkspaceID, item.SocialAccountID, "accepted").Exists(ctx)
	if err != nil {
		return err
	}
	if accepted {
		reply.State = "sent"
		return nil
	}
	var job models.Job
	if err := tx.NewSelect().Model(&job).Where("id = ?", reply.JobID).Scan(ctx); err != nil {
		return errors.New("reply delivery receipt is unavailable; inspect before resending")
	}
	switch job.Status {
	case "completed":
		reply.State = "sent"
	case "failed":
		reply.State = "failed"
	}
	return nil
}
func (s *Service) queueAutomationJob(ctx context.Context, tx bun.Tx, item models.EngagementItem, reply AutomationReply) (string, error) {
	action := "reply"
	if reply.Channel == "private" {
		action = "private_reply"
	}
	job, err := s.newEngagementActionJob(Actor{UserID: reply.UserID}, item, action, reply.Body, "automation:"+reply.ID)
	if err != nil {
		return "", err
	}
	var payload engagementActionJob
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return "", err
	}
	payload.AutomationID = reply.ID
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	job.Payload = string(raw)
	_, err = tx.NewInsert().Model(job).Exec(ctx)
	return job.ID, err
}
func (s *Service) AutomationReplies(ctx context.Context, actor Actor, workspaceID, itemID string) ([]AutomationReply, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	rows := []AutomationReply{}
	err := s.db.NewSelect().Model(&rows).Where("workspace_id = ? AND item_id = ?", workspaceID, itemID).Order("created_at ASC").Scan(ctx)
	return rows, err
}
func (s *Service) StopAutomation(ctx context.Context, actor Actor, workspaceID, itemID string) error {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return err
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		var item models.EngagementItem
		if err := tx.NewSelect().Model(&item).Where("id = ? AND workspace_id = ?", itemID, workspaceID).Scan(ctx); err != nil {
			return ErrNotFound
		}
		if _, err := tx.NewUpdate().Model(&item).Set("automation_stopped_at = ?", s.now()).WherePK().Exec(ctx); err != nil {
			return err
		}
		if err := s.stopItemAutomation(ctx, tx, item); err != nil {
			return err
		}
		return appendEngagementChange(ctx, tx, item)
	})
}
func (s *Service) checkAutomationWrite(ctx context.Context, db bun.IDB, item models.EngagementItem, input engagementActionJob) error {
	if input.AutomationID == "" {
		return nil
	}
	decision, err := workspaceaccess.NewAuthorizer(db).Authorize(ctx, item.WorkspaceID, Actor{UserID: input.UserID}, workspaceaccess.LevelAdminister)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	var reply AutomationReply
	if err := db.NewSelect().Model(&reply).Where("id = ? AND item_id = ?", input.AutomationID, item.ID).Scan(ctx); err != nil {
		return err
	}
	var state string
	if err := db.NewSelect().Table("workflow_runs").Column("state").Where("id = ? AND workspace_id = ?", reply.RunID, item.WorkspaceID).Scan(ctx, &state); err != nil {
		return err
	}
	if automationWriteStopped(item, reply, state) {
		return errors.New("automatic reply stopped before sending")
	}

	optedOut, err := automationOptedOut(ctx, db, item)
	if err != nil {
		return err
	}
	if optedOut {
		return errors.New("this person opted out of automatic replies")
	}
	authority, err := s.loadActivityAuthority(ctx, db, item.SocialAccountID)
	if err != nil {
		return err
	}
	if !item.CanReply || item.IsOurs || item.Hidden {
		return errors.New("this comment can no longer receive automatic replies")
	}
	if err := s.automationAccountEligibility(authority.Account); err != nil {
		return err
	}
	return s.checkPrivateAutomationWrite(ctx, db, item, authority.Account, input, reply)
}
func (s *Service) StopWorkflowReplies(ctx context.Context, authority workspaceaccess.StoredAuthority, workflowID, runID string) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).AuthorizeStored(ctx, authority, workspaceaccess.LevelAdminister)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, authority.WorkspaceID); err != nil {
			return err
		}
		query := tx.NewSelect().Model((*AutomationReply)(nil)).Where("workspace_id = ? AND state NOT IN ('sent','failed','skipped','cancelled')", authority.WorkspaceID)
		if workflowID != "" {
			query = query.Where("workflow_id = ?", workflowID)
		} else {
			query = query.Where("run_id = ?", runID)
		}
		var replies []AutomationReply
		if err := query.Scan(ctx, &replies); err != nil {
			return err
		}
		for _, reply := range replies {
			if _, err := tx.NewUpdate().Model(&reply).Set("state='cancelled',updated_at=?", s.now()).WherePK().Exec(ctx); err != nil {
				return err
			}
			var item models.EngagementItem
			if err := tx.NewSelect().Model(&item).Where("id = ?", reply.ItemID).Scan(ctx); err != nil {
				return err
			}
			if err := appendEngagementChange(ctx, tx, item); err != nil {
				return err
			}
		}
		return nil
	})
}
func (s *Service) CheckAutomationAccount(ctx context.Context, authority workspaceaccess.StoredAuthority, accountID string, private bool) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).AuthorizeStored(ctx, authority, workspaceaccess.LevelAdminister)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	current, err := s.loadActivityAuthority(ctx, s.db, accountID)
	if err != nil {
		return err
	}
	if current.Account.WorkspaceID != authority.WorkspaceID {
		return ErrAccessDenied
	}
	if current.Account.Platform == "x" {
		return errors.New("automatic X reply automation is unavailable")
	}
	adapter := s.adapter(current.Account)
	if adapter == nil || !adapter.EngagementSupport().Enabled || !adapter.EngagementSupport().CanReply {
		return errors.New("comment replies are unavailable for this account")
	}
	if len(platform.MissingAnalyticsScopes(current.Account.GrantedScopes, adapter.EngagementSupport().RequiredScopes)) > 0 {
		return errors.New("reconnect the account with comment permissions")
	}
	if private {
		if current.Account.Platform != "instagram" {
			return errors.New("private comment replies require Instagram")
		}
		if _, ok := adapter.(platform.PrivateCommentReplyAdapter); !ok {
			return errors.New("private replies are unavailable for this connection")
		}
	}
	return nil
}

func (s *Service) SetAutomationRunStopper(stop func(context.Context, bun.Tx, string, []string) error) {
	s.automationRunStopper = stop
}
func (s *Service) stopItemAutomation(ctx context.Context, tx bun.Tx, item models.EngagementItem) error {
	// A confirmed private send may still have an unclaimed public step after it.
	var replies []AutomationReply
	if err := tx.NewSelect().Model(&replies).Where("item_id = ?", item.ID).Scan(ctx); err != nil {
		return err
	}
	ids := make([]string, 0, len(replies))
	for _, reply := range replies {
		ids = append(ids, reply.RunID)
	}
	if _, err := tx.NewUpdate().Model((*AutomationReply)(nil)).Set("state='cancelled',updated_at=?", s.now()).Where("item_id = ? AND state NOT IN ('sent','failed','skipped')", item.ID).Exec(ctx); err != nil {
		return err
	}
	if len(ids) > 0 && s.automationRunStopper != nil {
		return s.automationRunStopper(ctx, tx, item.WorkspaceID, ids)
	}
	return nil
}

func (s *Service) advanceClaimedAutomationReply(ctx context.Context, tx bun.Tx, item models.EngagementItem, in AutomationReplyRequest, reply *AutomationReply) error {
	if replyApprovalConflicts(in, *reply) {
		return ErrOperationConflict
	}
	if automationSettled(reply.State) {
		return nil
	}
	if automationItemStopped(item, *reply) {
		reply.State = "cancelled"
	}
	if reply.State == "awaiting_review" && in.Approve {
		reply.Body = strings.TrimSpace(in.Body)
		reply.State = "ready"
	}
	if reply.State == "ready" && !in.Approve {
		id, err := s.queueAutomationJob(ctx, tx, item, *reply)
		if err != nil {
			return err
		}
		reply.JobID = id
		reply.State = "sending"
	}
	if reply.State == "sending" {
		if err := s.advanceAutomationDelivery(ctx, tx, item, reply); err != nil {
			return err
		}
	}
	reply.UpdatedAt = s.now()
	if _, err := tx.NewUpdate().Model(reply).WherePK().Exec(ctx); err != nil {
		return err
	}
	return nil
}

func validateAutomationReplyInputs(item models.EngagementItem, in AutomationReplyRequest) error {
	if item.Kind != "" && item.Kind != "comment" {
		return errors.New("this workflow requires an incoming comment")
	}
	if in.Channel != "public" && in.Channel != "private" {
		return errors.New("choose public or private reply")
	}
	if in.Delivery != "automatic" && in.Delivery != "review" && in.Delivery != "handoff" {
		return errors.New("choose review or automatic delivery")
	}
	if strings.TrimSpace(in.Body) == "" || len(in.Body) > 20000 {
		return errors.New("enter reply text within the supported limit")
	}
	if item.Platform == "x" {
		return errors.New("automatic X replies are unavailable; reply manually in Inbox")
	}
	return nil
}

func findClaimedAutomationReply(ctx context.Context, tx bun.Tx, item models.EngagementItem, in AutomationReplyRequest) (AutomationReply, bool, error) {
	var owner AutomationReply
	ownerErr := tx.NewSelect().Model(&owner).Where("item_id = ?", item.ID).Order("created_at ASC").Limit(1).Scan(ctx)
	if ownerErr != nil && !errors.Is(ownerErr, sql.ErrNoRows) {
		return owner, false, ownerErr
	}
	if ownerErr == nil && owner.RunID != in.RunID {
		owner.State = "skipped"
		return owner, true, nil
	}
	var reply AutomationReply
	err := tx.NewSelect().Model(&reply).Where("item_id = ? AND channel = ?", item.ID, in.Channel).Scan(ctx)
	if err == nil {
		if reply.RunID != in.RunID || reply.StepID != in.StepID {
			reply.State = "skipped"
		}
		return reply, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return reply, false, err
	}
	return owner, false, nil
}

func initialAutomationReplyState(ctx context.Context, tx bun.Tx, item models.EngagementItem, in AutomationReplyRequest, owner AutomationReply) (string, error) {
	state := "ready"
	if in.Delivery == "review" {
		state = "awaiting_review"
	}
	if in.Delivery == "handoff" {
		state = "needs_attention"
	}
	privateAccepted := owner.RunID == in.RunID && owner.Channel == "private" && owner.State == "sent"
	if item.IsOurs || !item.DeletedAt.IsZero() || !item.AutomationStoppedAt.IsZero() || (!item.RepliedAt.IsZero() && !privateAccepted) {
		state = "skipped"
	}
	optedOut, err := automationOptedOut(ctx, tx, item)
	if err != nil {
		return "", err
	}
	if optedOut {
		state = "skipped"
	}
	return state, nil
}

func automationWriteStopped(item models.EngagementItem, reply AutomationReply, state string) bool {
	return state == "cancelled" || state == "failed" || state == "succeeded" || reply.State == "cancelled" || !item.AutomationStoppedAt.IsZero() || !item.DeletedAt.IsZero() || item.Body != reply.ItemBody
}

func (s *Service) checkPrivateAutomationWrite(ctx context.Context, db bun.IDB, item models.EngagementItem, account models.SocialAccount, input engagementActionJob, reply AutomationReply) error {
	if input.Action == "private_reply" {
		key, err := s.automationRecipientKey(ctx, db, item)
		if err != nil {
			return err
		}
		if key == "" || key != reply.RecipientKey {
			return errors.New("the Instagram comment identity changed before sending")
		}
		return s.privateReplyEligibility(item, account, input.Message)
	}
	return nil
}

func replyApprovalConflicts(in AutomationReplyRequest, reply AutomationReply) bool {
	return in.Approve && reply.State == "ready" && reply.Body != strings.TrimSpace(in.Body)
}
func automationItemStopped(item models.EngagementItem, reply AutomationReply) bool {
	return item.IsOurs || !item.DeletedAt.IsZero() || !item.AutomationStoppedAt.IsZero() || item.Body != reply.ItemBody
}

func (s *Service) automationAccountEligibility(account models.SocialAccount) error {
	adapter := s.adapter(account)
	if adapter == nil {
		return errors.New("comment replies are unavailable for this account")
	}
	support := adapter.EngagementSupport()
	if !support.Enabled || !support.CanReply {
		return errors.New("comment replies are unavailable for this account")
	}
	if len(platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes)) > 0 {
		return errors.New("reconnect the account with comment permissions")
	}
	return nil
}

// Provider acceptance is an outcome even when a later action cancelled the run.
// It never reactivates that run or clears the comment's takeover timestamp.
func recordAutomationAcceptance(ctx context.Context, tx bun.Tx, item models.EngagementItem, id string, now time.Time) error {
	if id == "" {
		return nil
	}
	_, err := tx.NewUpdate().Model((*AutomationReply)(nil)).Set("state='sent',updated_at=?", now).Where("id=? AND item_id=? AND workspace_id=?", id, item.ID, item.WorkspaceID).Exec(ctx)
	return err
}
