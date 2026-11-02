package engagement

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

func (s *Service) commitActivityPage(ctx context.Context, input accountActivityJob, authority activityAuthority, state models.EngagementAccountSyncState, page platform.AccountActivityPage, since time.Time) error {
	if len(page.Items) > 100 || len(page.NextCursor) > 4096 {
		return fmt.Errorf("account activity page exceeds its bounds")
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, authority.Account.WorkspaceID); err != nil {
			return err
		}
		current, latest, _, err := s.activityCheckpoint(ctx, tx, input)
		if err != nil {
			return err
		}
		if current.Cursor != state.Cursor || latest.Account.GrantedScopes != authority.Account.GrantedScopes {
			return errActivityChanged
		}
		for _, remote := range page.Items {
			if !remote.ObservedAt.IsZero() && remote.ObservedAt.Before(since) {
				continue
			}
			if err := s.persistAccountActivity(ctx, tx, latest.Account, remote); err != nil {
				return err
			}
		}
		now := s.now()
		status, next := "pending", now
		watermark, cycle, pending := state.Watermark, state.CycleStartedAt, state.PendingWatermark
		lastSuccess := state.LastSuccessAt
		if page.NextCursor == "" {
			status, next, lastSuccess = "ok", now.Add(5*time.Minute), now
			watermark, cycle, pending = pending, time.Time{}, time.Time{}
		}
		_, err = tx.NewUpdate().Model((*models.EngagementAccountSyncState)(nil)).
			Set("cursor=?", page.NextCursor).Set("watermark=?", nullableActivityTime(watermark)).Set("cycle_started_at=?", nullableActivityTime(cycle)).Set("pending_watermark=?", nullableActivityTime(pending)).
			Set("status=?", status).Set("error_code=?", "").Set("error_message=?", "").
			Set("last_attempted_at=?", now).Set("last_success_at=?", nullableActivityTime(lastSuccess)).Set("next_sync_at=?", next).Set("updated_at=?", now).
			Where("social_account_id=? AND feed=? AND generation=?", input.AccountID, input.Feed, input.Generation).Exec(ctx)
		return err
	})
}

func nullableActivityTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func (s *Service) persistAccountActivity(ctx context.Context, tx bun.Tx, account models.SocialAccount, remote platform.AccountActivityItem) error {
	if remote.IsOurs {
		return nil
	}
	if err := validateAccountActivity(remote); err != nil {
		return err
	}
	existing, err := findEngagementIdentity(ctx, tx, account, remote.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	item := engagementItemFromComment(models.Rendition{}, account, existing, remote.Comment, s.now())
	item.Kind = remote.Kind
	if remote.Kind == "review" {
		item.CanDelete, item.CanHide, item.CanLike, item.CanUnlike = false, false, false, false
	}
	item.SubjectJSON, item.ReviewReplyCheckAt, err = normalizedActivitySubject(remote, existing, s.now())
	if err != nil {
		return err
	}
	if err := saveEngagementItem(ctx, tx, item); err != nil {
		return err
	}
	if existing.ID != "" || s.notifications == nil {
		return nil
	}
	return s.notifyAccountActivity(ctx, tx, account, item)
}

// Reply moderation can change without changing the customer's review timestamp.
// Recheck at most two pending replies per cycle, independently of page coverage.
func (s *Service) recheckReviewReplies(ctx context.Context, authority activityAuthority, token string, input accountActivityJob, ids []string) error {
	reader, ok := s.activityAdapter(authority.Account).(platform.ReviewAdapter)
	if !ok {
		return fmt.Errorf("review reads are unavailable")
	}
	var items []models.EngagementItem
	if len(ids) == 0 {
		return nil
	}
	if err := s.db.NewSelect().Model(&items).Where("id IN (?) AND social_account_id=? AND kind='review'", bun.List(ids), input.AccountID).Scan(ctx); err != nil {
		return err
	}
	for _, item := range items {
		if _, _, _, err := s.activityCheckpoint(ctx, s.db, input); err != nil {
			return err
		}
		remote, err := reader.GetReview(ctx, token, authority.Account.AccountID, item.RemoteID)
		if err != nil {
			return err
		} // Absence or a lone 404 never proves deletion.
		if remote.ID != item.RemoteID {
			return fmt.Errorf("review identity changed during moderation lookup")
		}
		if err := s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			if err := organizationguard.LockWorkspace(ctx, tx, authority.Account.WorkspaceID); err != nil {
				return err
			}
			_, current, _, err := s.activityCheckpoint(ctx, tx, input)
			if err != nil {
				return err
			}
			if current.Account.GrantedScopes != authority.Account.GrantedScopes {
				return errActivityChanged
			}
			return s.persistAccountActivity(ctx, tx, current.Account, remote)
		}); err != nil {
			return err
		}
	}
	return nil
}

func decodeEngagementSubject(item *models.EngagementItem) {
	if strings.TrimSpace(item.SubjectJSON) == "" || item.SubjectJSON == "{}" {
		return
	}
	var subject models.EngagementSubject
	if json.Unmarshal([]byte(item.SubjectJSON), &subject) != nil {
		return
	}
	subject.URL = safeExternalURL(subject.URL)
	item.Subject = &subject
	item.CanDeleteReply = item.Kind == "review" && item.CanReply && item.DeletedAt.IsZero() && subject.Review != nil && subject.Review.OwnerReply != nil
}

func (s *Service) dueReviewReplies(ctx context.Context, accountID string) ([]string, error) {
	var ids []string
	err := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Column("id").Where("social_account_id=? AND kind='review' AND review_reply_check_at <= ?", accountID, s.now()).Order("review_reply_check_at ASC", "id ASC").Limit(2).Scan(ctx, &ids)
	return ids, err
}

func (s *Service) loadReviewOperations(ctx context.Context, items []models.EngagementItem) (map[string]models.EngagementReviewOperation, error) {
	result := map[string]models.EngagementReviewOperation{}
	var ids []string
	for _, item := range items {
		if item.Kind == "review" {
			ids = append(ids, item.ID)
		}
	}
	if len(ids) == 0 {
		return result, nil
	}
	var operations []models.EngagementReviewOperation
	if err := s.db.NewSelect().Model(&operations).Where("item_id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil, err
	}
	for _, operation := range operations {
		result[operation.ItemID] = operation
	}
	return result, nil
}

func (s *Service) notifyAccountActivity(ctx context.Context, tx bun.Tx, account models.SocialAccount, item models.EngagementItem) error {
	var recipients []string
	if err := tx.NewSelect().Model((*models.WorkspaceMember)(nil)).Column("user_id").Where("workspace_id=? AND status=?", account.WorkspaceID, models.WorkspaceMemberStatusActive).Scan(ctx, &recipients); err != nil {
		return err
	}
	for _, userID := range recipients {
		outcome, err := notifications.NewEngagementReceivedOutcome(notifications.EngagementReceivedFacts{Kind: item.Kind, RecipientUserID: userID, WorkspaceID: account.WorkspaceID, EngagementID: item.ID, Provider: account.Platform, AuthorName: firstNonEmpty(item.AuthorName, item.AuthorHandle)})
		if err != nil {
			return err
		}
		if err := s.notifications.RecordWithDB(ctx, tx, outcome); err != nil {
			return err
		}
	}
	return nil
}

func validateAccountActivity(remote platform.AccountActivityItem) error {
	if (remote.Kind != "mention" && remote.Kind != "review") || remote.ID == "" || len(remote.ID) > 512 || remote.Subject.RemoteID == "" || len(remote.Subject.RemoteID) > 512 {
		return fmt.Errorf("invalid normalized account activity identity")
	}
	if remote.Kind == "review" && (remote.Subject.Kind != "review" || remote.Subject.Review == nil) {
		return fmt.Errorf("review context is missing")
	}
	if remote.Kind == "mention" && remote.Subject.Kind != "post" {
		return fmt.Errorf("mention post context is missing")
	}
	return nil
}

func normalizedActivitySubject(remote platform.AccountActivityItem, existing models.EngagementItem, now time.Time) (string, time.Time, error) {
	subject := remote.Subject
	subject.URL = safeExternalURL(subject.URL)
	checkAt := time.Time{}
	if subject.Review != nil {
		review := *subject.Review
		subject.Review = &review
		if review.OwnerReply != nil {
			reply := *review.OwnerReply
			review.OwnerReply = &reply
		}
		decodeEngagementSubject(&existing)
		retainRecentReviewReceipt(&review, existing, now)
		checkAt = reviewReplyNextCheck(review.OwnerReply, now)
		if !checkAt.IsZero() && existing.Subject != nil && existing.Subject.Review != nil {
			old := existing.Subject.Review.OwnerReply
			if old != nil && (old.State == "APPROVED" || old.State == "REJECTED") && old.State != review.OwnerReply.State {
				checkAt = now
			}
		}
	}
	encoded, err := json.Marshal(subject)
	if err != nil {
		return "", time.Time{}, err
	}
	if len(encoded) > 16*1024 {
		return "", time.Time{}, fmt.Errorf("account activity context exceeds its bounds")
	}
	return string(encoded), checkAt, nil
}

func reviewReplyNextCheck(reply *inboxactivity.ReviewReply, now time.Time) time.Time {
	if reply == nil {
		return time.Time{}
	}
	reply.Text, reply.State, reply.PolicyViolation = boundedText(reply.Text, 4096), boundedText(reply.State, 100), boundedText(reply.PolicyViolation, 100)
	if reply.State == "APPROVED" || reply.State == "REJECTED" {
		return time.Time{}
	}
	return now.Add(5 * time.Minute)
}

// Preserve a just-accepted local receipt during a short propagation window.
// Matching text can still acquire its current moderation status immediately.
func retainRecentReviewReceipt(review *inboxactivity.ReviewContext, existing models.EngagementItem, now time.Time) {
	if existing.ReviewReplyWrittenAt.IsZero() || !now.Before(existing.ReviewReplyWrittenAt.Add(2*time.Minute)) || existing.Subject == nil || existing.Subject.Review == nil {
		return
	}
	old, next := existing.Subject.Review.OwnerReply, review.OwnerReply
	if old == nil && next == nil {
		return
	}
	if old != nil && next != nil && old.Text == next.Text {
		return
	}
	if next != nil && next.UpdatedAt.After(existing.ReviewReplyWrittenAt) {
		return
	}
	review.OwnerReply = old
}

func findEngagementIdentity(ctx context.Context, db bun.Tx, account models.SocialAccount, remoteID string) (models.EngagementItem, error) {
	var existing models.EngagementItem
	query := db.NewSelect().Model(&existing).Where("social_account_id=? AND platform=?", account.ID, account.Platform)
	retired := ""
	if account.Platform == "youtube" {
		retired = dataretention.RetiredYouTubeIdentity(account.WorkspaceID, remoteID)
		query = query.Where("(native_remote_id=? OR remote_id=? OR remote_id=?)", inboxactivity.NativeIdentity(account.Platform, remoteID), remoteID, retired)
	} else {
		query = query.Where("(native_remote_id=? OR remote_id=?)", inboxactivity.NativeIdentity(account.Platform, remoteID), remoteID)
	}
	err := query.OrderExpr("CASE WHEN rendition_id IS NOT NULL THEN 0 ELSE 1 END").Order("created_at ASC", "id ASC").Limit(1).Scan(ctx)
	if err == nil && retired != "" && existing.RemoteID == retired {
		// Restore the provider key inside the caller's persistence transaction.
		// saveEngagementItem upserts by (account, remote_id), so its insert must
		// conflict with this existing row while preserving the local primary key.
		if _, err := db.NewUpdate().Model((*models.EngagementItem)(nil)).
			Set("remote_id = ?", remoteID).
			Where("id = ? AND workspace_id = ? AND remote_id = ?", existing.ID, account.WorkspaceID, retired).Exec(ctx); err != nil {
			return existing, err
		}
		existing.RemoteID = remoteID
	}
	return existing, err
}
