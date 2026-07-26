package entitlements

import (
	"context"
	"fmt"
)

type LimitKey string

const (
	LimitWorkspaces                LimitKey = "workspaces"
	LimitSocialAccounts            LimitKey = "social_accounts"
	LimitScheduledPostsMonthly     LimitKey = "scheduled_posts_monthly"
	LimitPublishedPostsMonthly     LimitKey = "published_posts_monthly"
	LimitMediaBytesStored          LimitKey = "media_bytes_stored"
	LimitMediaBytesUploadedMonthly LimitKey = "media_bytes_uploaded_monthly"
	LimitProviderWriteCallsMonthly LimitKey = "provider_write_calls_monthly"
	LimitTeamMembers               LimitKey = "team_members"
)

type Request struct {
	OrganizationID string
	WorkspaceID    string
	UserID         string
	Limit          LimitKey
	Current        int64
	Amount         int64
}

type Decision struct {
	Allowed   bool
	Unlimited bool
	Limit     int64
	Current   int64
	Amount    int64
	Reason    string
}

type Service interface {
	Check(context.Context, Request) (Decision, error)
}

type PlanSnapshot struct {
	PlanID string
	Limits map[LimitKey]int64
}

type StaticService struct {
	snapshot PlanSnapshot
}

func NewSelfHostedService() *StaticService {
	return NewStaticService(PlanSnapshot{PlanID: "selfhost"})
}

func NewCloudBootstrapService() *StaticService {
	return NewStaticService(PlanSnapshot{
		PlanID: "cloud-bootstrap",
		Limits: map[LimitKey]int64{
			LimitWorkspaces:                1,
			LimitSocialAccounts:            0,
			LimitScheduledPostsMonthly:     0,
			LimitPublishedPostsMonthly:     0,
			LimitMediaBytesStored:          0,
			LimitMediaBytesUploadedMonthly: 0,
			LimitProviderWriteCallsMonthly: 0,
			LimitTeamMembers:               0,
		},
	})
}

func NewStaticService(snapshot PlanSnapshot) *StaticService {
	return &StaticService{snapshot: snapshot}
}

func (s *StaticService) Check(_ context.Context, req Request) (Decision, error) {
	decision := Decision{
		Allowed: true,
		Current: req.Current,
		Amount:  req.Amount,
	}

	if req.Amount <= 0 {
		decision.Allowed = false
		return decision, fmt.Errorf("entitlement check amount must be positive")
	}

	limit, ok := s.snapshot.Limits[req.Limit]
	if !ok {
		decision.Unlimited = true
		return decision, nil
	}

	decision.Limit = limit
	if req.Current+req.Amount > limit {
		decision.Allowed = false
		decision.Reason = fmt.Sprintf("%s limit exceeded: current %d + requested %d > limit %d", req.Limit, req.Current, req.Amount, limit)
	}
	return decision, nil
}
