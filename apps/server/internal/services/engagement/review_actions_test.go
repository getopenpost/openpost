package engagement

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const reviewLocation = "accounts/123/locations/456"
const reviewName = reviewLocation + "/reviews/customer"

type reviewProvider struct {
	reply                  *inboxactivity.ReviewReply
	listingReply           *inboxactivity.ReviewReply
	ambiguous              bool
	afterWrite             func()
	getErr                 error
	writes, deletes, reads int
}

func (*reviewProvider) AccountActivitySupport() []platform.AccountActivitySupport {
	return []platform.AccountActivitySupport{{Feed: "reviews", RequiredScopes: []string{"https://www.googleapis.com/auth/business.manage"}}}
}
func (p *reviewProvider) ListAccountActivity(context.Context, string, string, platform.AccountActivityRequest) (platform.AccountActivityPage, error) {
	if p.listingReply == nil {
		return platform.AccountActivityPage{}, nil
	}
	return platform.AccountActivityPage{Items: []platform.AccountActivityItem{normalizedReview(p.listingReply)}}, nil
}
func (p *reviewProvider) GetReview(context.Context, string, string, string) (platform.AccountActivityItem, error) {
	p.reads++
	if p.getErr != nil {
		return platform.AccountActivityItem{}, p.getErr
	}
	return normalizedReview(p.reply), nil
}
func (p *reviewProvider) SetReviewReply(_ context.Context, _, _, _, message string) (inboxactivity.ReviewReply, error) {
	p.writes++
	if p.afterWrite != nil {
		p.afterWrite()
	}
	p.reply = &inboxactivity.ReviewReply{Text: message, State: "PENDING", UpdatedAt: time.Now().UTC()}
	if p.ambiguous {
		return inboxactivity.ReviewReply{}, fmt.Errorf("connection dropped after Google accepted the reply")
	}
	return *p.reply, nil
}
func (p *reviewProvider) DeleteReviewReply(context.Context, string, string, string) error {
	p.deletes++
	p.reply = nil
	return nil
}

func normalizedReview(reply *inboxactivity.ReviewReply) platform.AccountActivityItem {
	stars := 5
	return platform.AccountActivityItem{Kind: "review", ObservedAt: time.Now().UTC(),
		Comment: platform.Comment{ID: reviewName, Text: "Customer review", CanReply: true},
		Subject: inboxactivity.EngagementSubject{Kind: "review", RemoteID: reviewName, Review: &inboxactivity.ReviewContext{Stars: &stars, Anonymous: true, OwnerReply: reply}}}
}

func reviewTestService(t *testing.T) (*Service, *reviewProvider) {
	t.Helper()
	s := admissionTestService(t)
	s.tokenSource = moderationTokens{}
	_, err := s.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform='googlebusiness'").Set("account_id=?", reviewLocation).Set("granted_scopes=?", "https://www.googleapis.com/auth/business.manage").Where("id='a'").Exec(t.Context())
	require.NoError(t, err)
	remote := normalizedReview(nil)
	subject, err := json.Marshal(remote.Subject)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.EngagementItem{ID: "review", WorkspaceID: "w", SocialAccountID: "a", Platform: "googlebusiness", Kind: "review", RemoteID: reviewName, SubjectJSON: string(subject), Body: remote.Text, CanReply: true, LastSeenAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	provider := &reviewProvider{}
	s.SetActivityProvider("googlebusiness", provider)
	return s, provider
}

func runReviewAction(t *testing.T, s *Service, jobID string) error {
	t.Helper()
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).Where("id=?", jobID).Scan(t.Context()))
	job.Status, job.Attempts, job.LockedAt = "processing", job.Attempts+1, time.Now().UTC()
	_, err := s.db.NewUpdate().Model(&job).Column("status", "attempts", "locked_at").WherePK().Exec(t.Context())
	require.NoError(t, err)
	return s.HandleJob(providerwrite.WithJobExecution(t.Context(), job.ID, job.Attempts, job.LockedAt), job.Type, job.Payload)
}

func TestReviewRepliesSerializeReplacementsAndReconcileWithoutResending(t *testing.T) {
	s, provider := reviewTestService(t)
	actor := Actor{UserID: "u"}
	_, err := s.QueueEngagementActionReceipt(t.Context(), actor, "review", "reply", strings.Repeat("🚀", 1025), "too-long")
	require.Error(t, err)
	_, err = s.QueueEngagementActionReceipt(t.Context(), actor, "review", "delete", "", "delete-customer")
	require.Error(t, err)
	provider.ambiguous = true
	first, err := s.QueueEngagementActionReceipt(t.Context(), actor, "review", "reply", "Thanks 日本語", "first")
	require.NoError(t, err)
	_, err = s.QueueEngagementActionReceipt(t.Context(), actor, "review", "reply", "Replacement", "second")
	require.ErrorIs(t, err, ErrReviewReplyBusy)
	err = runReviewAction(t, s, first)
	_, pending := providerwrite.IsPending(err)
	require.True(t, pending, "a transport failure must reconcile the accepted upstream write: %v", err)
	require.Equal(t, 1, provider.writes)
	_, err = s.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).Set("reconcile_after=?", time.Now().UTC().Add(-time.Minute)).Where("operation_id=?", "engagement-review:"+first).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, runReviewAction(t, s, first))
	require.Equal(t, 1, provider.writes)
	require.Equal(t, 1, provider.reads)
	detail, err := s.GetEngagement(t.Context(), actor, "w", "review")
	require.NoError(t, err)
	require.Equal(t, "Thanks 日本語", detail.Item.Subject.Review.OwnerReply.Text)
	require.Equal(t, "PENDING", detail.Item.Subject.Review.OwnerReply.State, "submission acceptance is separate from moderation approval")
	require.True(t, detail.Item.CanDeleteReply)
	replay, err := s.QueueEngagementActionReceipt(t.Context(), actor, "review", "reply", "Thanks 日本語", "first")
	require.NoError(t, err)
	require.Equal(t, first, replay)
	provider.ambiguous = false
	second, err := s.QueueEngagementActionReceipt(t.Context(), actor, "review", "reply", "Replacement", "second")
	require.NoError(t, err)
	require.NoError(t, runReviewAction(t, s, second))
	require.NoError(t, runReviewAction(t, s, first))
	detail, err = s.GetEngagement(t.Context(), actor, "w", "review")
	require.NoError(t, err)
	require.Equal(t, "Replacement", detail.Item.Subject.Review.OwnerReply.Text, "old completed jobs cannot restore an earlier reply")
	third, err := s.QueueEngagementActionReceipt(t.Context(), actor, "review", "delete_reply", "", "remove-owner-reply")
	require.NoError(t, err)
	require.NoError(t, runReviewAction(t, s, third))
	require.Equal(t, 1, provider.deletes)
	detail, err = s.GetEngagement(t.Context(), actor, "w", "review")
	require.NoError(t, err)
	require.Nil(t, detail.Item.Subject.Review.OwnerReply)
	require.Equal(t, "Customer review", detail.Item.Body)
	require.Equal(t, 5, *detail.Item.Subject.Review.Stars)
	require.True(t, detail.Item.DeletedAt.IsZero())
}

func TestPendingReviewModerationRechecksIndependentlyOfListing(t *testing.T) {
	s, provider := reviewTestService(t)
	provider.reply = &inboxactivity.ReviewReply{Text: "Thanks", State: "APPROVED"}
	provider.listingReply = &inboxactivity.ReviewReply{Text: "Thanks", State: "PENDING"}
	old := normalizedReview(provider.listingReply)
	subject, err := json.Marshal(old.Subject)
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.EngagementItem)(nil)).Set("subject_json=?", string(subject)).Set("review_reply_check_at=?", time.Now().UTC().Add(-time.Minute)).Where("id='review'").Exec(t.Context())
	require.NoError(t, err)
	job := accountActivityReceipt(t, s)
	executeAccountActivity(t, s, job)
	detail, err := s.GetEngagement(t.Context(), Actor{UserID: "u"}, "w", "review")
	require.NoError(t, err)
	require.Equal(t, 1, provider.reads)
	require.Equal(t, "APPROVED", detail.Item.Subject.Review.OwnerReply.State, "the independent moderation read wins over the older listing echo")
	_, err = s.db.NewUpdate().Model((*models.Job)(nil)).Set("status='completed'").Where("id=?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	executeAccountActivity(t, s, accountActivityReceipt(t, s))
	detail, err = s.GetEngagement(t.Context(), Actor{UserID: "u"}, "w", "review")
	require.NoError(t, err)
	require.Equal(t, 2, provider.reads)
	require.Equal(t, "APPROVED", detail.Item.Subject.Review.OwnerReply.State)
}

func TestReviewReconciliationCanRecordAnAcceptedWriteAfterActorRoleChanges(t *testing.T) {
	s, provider := reviewTestService(t)
	provider.ambiguous = true
	job, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "Thanks", "role-change")
	require.NoError(t, err)
	err = runReviewAction(t, s, job)
	_, pending := providerwrite.IsPending(err)
	require.True(t, pending)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role=?", models.WorkspaceRoleViewer).Where("workspace_id='w' AND user_id='u'").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).Set("reconcile_after=?", time.Now().UTC().Add(-time.Minute)).Where("operation_id=?", "engagement-review:"+job).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, runReviewAction(t, s, job))
	require.Equal(t, 1, provider.writes)
	detail, err := s.GetEngagement(t.Context(), Actor{UserID: "u"}, "w", "review")
	require.NoError(t, err)
	require.Equal(t, "Thanks", detail.Item.Subject.Review.OwnerReply.Text)
}

func TestUnsentReviewReplyHonorsRoleRevocationAndAllowsANewIntent(t *testing.T) {
	s, provider := reviewTestService(t)
	job, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "Old intent", "old")
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role=?", models.WorkspaceRoleViewer).Where("workspace_id='w' AND user_id='u'").Exec(t.Context())
	require.NoError(t, err)
	require.ErrorIs(t, runReviewAction(t, s, job), ErrAccessDenied)
	require.Zero(t, provider.writes)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role=?", models.WorkspaceRoleAdmin).Where("workspace_id='w' AND user_id='u'").Exec(t.Context())
	require.NoError(t, err)
	next, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "New intent", "new")
	require.NoError(t, err)
	require.NoError(t, runReviewAction(t, s, next))
	require.Equal(t, 1, provider.writes)
}

func TestAcceptedReviewReplySurvivesStaleListingOnlyDuringPropagation(t *testing.T) {
	s, provider := reviewTestService(t)
	actor := Actor{UserID: "u"}
	job, err := s.QueueEngagementActionReceipt(t.Context(), actor, "review", "reply", "New reply", "new-reply")
	require.NoError(t, err)
	require.NoError(t, runReviewAction(t, s, job))
	provider.listingReply = &inboxactivity.ReviewReply{Text: "Old reply", State: "APPROVED"}
	sync := accountActivityReceipt(t, s)
	executeAccountActivity(t, s, sync)
	detail, err := s.GetEngagement(t.Context(), actor, "w", "review")
	require.NoError(t, err)
	require.Equal(t, "New reply", detail.Item.Subject.Review.OwnerReply.Text)
	_, err = s.db.NewUpdate().Model((*models.EngagementItem)(nil)).Set("review_reply_written_at=?", time.Now().UTC().Add(-3*time.Minute)).Where("id='review'").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.Job)(nil)).Set("status='completed'").Where("id=?", sync.ID).Exec(t.Context())
	require.NoError(t, err)
	executeAccountActivity(t, s, accountActivityReceipt(t, s))
	detail, err = s.GetEngagement(t.Context(), actor, "w", "review")
	require.NoError(t, err)
	require.Equal(t, "Old reply", detail.Item.Subject.Review.OwnerReply.Text, "later provider edits remain authoritative")
}

type failingReviewTokens struct{}

func (failingReviewTokens) GetValidAccessToken(context.Context, string) (string, error) {
	return "", fmt.Errorf("reconnect required")
}
func TestUnsentReviewTokenFailureReleasesOperation(t *testing.T) {
	s, provider := reviewTestService(t)
	s.tokenSource = failingReviewTokens{}
	job, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "First", "token-failure")
	require.NoError(t, err)
	require.Error(t, runReviewAction(t, s, job))
	require.Zero(t, provider.writes)
	s.tokenSource = moderationTokens{}
	_, err = s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "New intent", "after-reconnect")
	require.NoError(t, err)
}
func TestReviewReplyRejectsStaleWorkerBeforeSendAndCommit(t *testing.T) {
	for _, when := range []string{"before send", "after send"} {
		t.Run(when, func(t *testing.T) {
			s, provider := reviewTestService(t)
			id, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "Thanks", "stale")
			require.NoError(t, err)
			var job models.Job
			require.NoError(t, s.db.NewSelect().Model(&job).Where("id=?", id).Scan(t.Context()))
			job.Status = "processing"
			job.Attempts = 1
			job.LockedAt = time.Now().UTC()
			_, err = s.db.NewUpdate().Model(&job).Column("status", "attempts", "locked_at").WherePK().Exec(t.Context())
			require.NoError(t, err)
			expire := func() {
				_, err := s.db.NewUpdate().Model((*models.Job)(nil)).Set("status='failed'").Where("id=?", id).Exec(t.Context())
				require.NoError(t, err)
			}
			if when == "before send" {
				expire()
			} else {
				provider.afterWrite = expire
			}
			ctx := providerwrite.WithJobExecution(t.Context(), id, job.Attempts, job.LockedAt)
			require.Error(t, s.HandleJob(ctx, job.Type, job.Payload))
			if when == "before send" {
				require.Zero(t, provider.writes)
			} else {
				require.Equal(t, 1, provider.writes)
			}
			detail, err := s.GetEngagement(t.Context(), Actor{UserID: "u"}, "w", "review")
			require.NoError(t, err)
			require.Nil(t, detail.Item.Subject.Review.OwnerReply, "a stale worker cannot commit Inbox state")
		})
	}
}

func TestAcceptedReviewRecoversFromReadAndLocalCommitFailuresWithoutResending(t *testing.T) {
	for _, phase := range []string{"recovery read", "recovery token", "dispatch database", "local commit"} {
		t.Run(phase, func(t *testing.T) {
			s, provider := reviewTestService(t)
			id, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "Thanks", "recover")
			require.NoError(t, err)
			if phase != "local commit" {
				provider.afterWrite = func() {
					_, err := s.db.NewUpdate().Model((*models.Job)(nil)).Set("status='failed'").Where("id=?", id).Exec(t.Context())
					require.NoError(t, err)
				}
				require.Error(t, runReviewAction(t, s, id))
				provider.afterWrite = nil
				if phase == "recovery read" {
					provider.getErr = &platform.HTTPError{StatusCode: 429}
				} else {
					s.tokenSource = failingReviewTokens{}
				}
			} else {
				_, err = s.db.ExecContext(t.Context(), `CREATE TRIGGER reject_review_save BEFORE UPDATE ON engagement_items BEGIN SELECT RAISE(FAIL,'storage unavailable'); END`)
				require.NoError(t, err)
			}
			originalDB := s.db
			if phase == "dispatch database" {
				var job models.Job
				require.NoError(t, s.db.NewSelect().Model(&job).Where("id=?", id).Scan(t.Context()))
				job.Status, job.LockedAt = "processing", time.Now().UTC()
				_, err = s.db.NewUpdate().Model(&job).Column("status", "locked_at").WherePK().Exec(t.Context())
				require.NoError(t, err)
				unavailable, openErr := testdb.OpenWithDriver("sqlite", "file:unavailable-review-"+t.Name()+"?mode=memory&cache=shared")
				require.NoError(t, openErr)
				require.NoError(t, unavailable.Close())
				s.db = unavailable
				err = s.HandleJob(providerwrite.WithJobExecution(t.Context(), id, job.Attempts, job.LockedAt), job.Type, job.Payload)
				s.db = originalDB
			} else {
				err = runReviewAction(t, s, id)
			}
			_, pending := providerwrite.IsPending(err)
			require.True(t, pending, "accepted writes must retain a durable continuation after %s: %v", phase, err)
			provider.getErr = nil
			s.tokenSource = moderationTokens{}
			if phase == "local commit" {
				_, err = s.db.ExecContext(t.Context(), `DROP TRIGGER reject_review_save`)
				require.NoError(t, err)
			}
			require.NoError(t, runReviewAction(t, s, id))
			require.Equal(t, 1, provider.writes)
			detail, err := s.GetEngagement(t.Context(), Actor{UserID: "u"}, "w", "review")
			require.NoError(t, err)
			require.Equal(t, "Thanks", detail.Item.Subject.Review.OwnerReply.Text)
			require.Equal(t, "complete", detail.Item.ReplyOperationState)
		})
	}
}

type cancelOneReviewQuery struct{ next bool }

func (h *cancelOneReviewQuery) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	if h.next {
		h.next = false
		unavailable, cancel := context.WithCancel(ctx)
		cancel()
		return unavailable
	}
	return ctx
}
func (*cancelOneReviewQuery) AfterQuery(context.Context, *bun.QueryEvent) {}
func TestUnsentReviewDispatchFailureRetainsItsActiveIntent(t *testing.T) {
	s, provider := reviewTestService(t)
	id, err := s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u"}, "review", "reply", "Thanks", "initial-read")
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, s.db.NewSelect().Model(&job).Where("id=?", id).Scan(t.Context()))
	job.Status, job.Attempts, job.LockedAt = "processing", 1, time.Now().UTC()
	_, err = s.db.NewUpdate().Model(&job).Column("status", "attempts", "locked_at").WherePK().Exec(t.Context())
	require.NoError(t, err)
	s.db.AddQueryHook(&cancelOneReviewQuery{next: true})
	err = s.HandleJob(providerwrite.WithJobExecution(t.Context(), id, job.Attempts, job.LockedAt), job.Type, job.Payload)
	_, pending := providerwrite.IsPending(err)
	require.True(t, pending, "a transient first read cannot strand an admitted unsent review: %v", err)
	require.Zero(t, provider.writes)
	require.NoError(t, runReviewAction(t, s, id))
	require.Equal(t, 1, provider.writes)
}
