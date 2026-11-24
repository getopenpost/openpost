package engagement

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
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
