package setupprojection

import (
	"context"
	"database/sql"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	StepWorkspace    = "workspace"
	StepSubscription = "subscription"
	StepDestination  = "destination"
	StepComposition  = "composition"
	StepPublication  = "publication"
)

type Step struct {
	ID        string
	Completed bool
}

type Projection struct {
	Visible        bool
	Activated      bool
	CompletedSteps int
	TotalSteps     int
	NextStep       string
	NextAction     string
	ActionHref     string
	Steps          []Step
}

type Input struct {
	WorkspaceID        string
	UserID             string
	CanEdit            bool
	CanManageWorkspace bool
	Hosted             bool
}

type Service struct {
	db *bun.DB
}

type state struct {
	workspace            models.Workspace
	subscriptionComplete bool
	destinationComplete  bool
	compositionComplete  bool
	publicationComplete  bool
	organizationRole     string
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Project(ctx context.Context, input Input) (Projection, error) {
	state, err := s.loadState(ctx, input)
	if err != nil {
		return Projection{}, err
	}
	projection := newProjection(state, input)
	if len(projection.Steps) == 0 {
		return projection, nil
	}
	return s.withNextAction(ctx, projection, input)
}

func (s *Service) loadState(ctx context.Context, input Input) (state, error) {
	var workspace models.Workspace
	if err := s.db.NewSelect().Model(&workspace).Where("id = ?", input.WorkspaceID).Scan(ctx); err != nil {
		return state{}, err
	}

	result := state{workspace: workspace, subscriptionComplete: !input.Hosted}
	var err error
	result.organizationRole, err = s.organizationRole(ctx, workspace.OrganizationID, input.UserID)
	if err != nil {
		return state{}, err
	}
	if input.Hosted {
		var subscription models.BillingSubscription
		err := s.db.NewSelect().Model(&subscription).
			Where("organization_id = ?", workspace.OrganizationID).
			Where("provider IN (?)", bun.List(models.BillingGrantingProviders)).
			Scan(ctx)
		if err != nil && err != sql.ErrNoRows {
			return state{}, err
		}
		result.subscriptionComplete = err == nil && subscriptionAllowsUsage(subscription.Status)
	}

	result.destinationComplete, err = s.exists(ctx, (*models.SocialAccount)(nil), "workspace_id = ? AND is_active = ?", input.WorkspaceID, true)
	if err != nil {
		return state{}, err
	}
	result.compositionComplete, err = s.exists(ctx, (*models.WorkspaceFirstComposition)(nil), "workspace_id = ?", input.WorkspaceID)
	if err != nil {
		return state{}, err
	}
	result.publicationComplete, err = s.exists(ctx, (*models.WorkspaceActivation)(nil), "workspace_id = ?", input.WorkspaceID)
	if err != nil {
		return state{}, err
	}
	if result.publicationComplete {
		result.compositionComplete = true
	}
	return result, nil
}

func newProjection(state state, input Input) Projection {
	steps := make([]Step, 0, 5)
	if state.organizationRole == models.OrganizationRoleOwner && input.CanManageWorkspace {
		steps = append(steps, Step{ID: StepWorkspace, Completed: strings.TrimSpace(state.workspace.Name) != ""})
	}
	if input.CanEdit && canManageBilling(state.organizationRole) && input.Hosted {
		steps = append(steps, Step{ID: StepSubscription, Completed: state.subscriptionComplete})
	}
	if input.CanEdit {
		steps = append(steps,
			Step{ID: StepDestination, Completed: state.destinationComplete},
			Step{ID: StepComposition, Completed: state.compositionComplete},
			Step{ID: StepPublication, Completed: state.publicationComplete},
		)
	}

	projection := Projection{Steps: steps, TotalSteps: len(steps)}
	for _, step := range projection.Steps {
		if step.Completed {
			projection.CompletedSteps++
		}
	}
	projection.Activated = state.publicationComplete
	return projection
}

func (s *Service) withNextAction(ctx context.Context, projection Projection, input Input) (Projection, error) {
	if projection.Activated {
		return projection, nil
	}
	for _, step := range projection.Steps {
		if step.Completed {
			continue
		}
		projection.NextStep = step.ID
		switch step.ID {
		case StepWorkspace:
			if input.CanManageWorkspace {
				projection.NextAction = "name_workspace"
				projection.ActionHref = "/settings?tab=general#workspace-name"
			}
		case StepSubscription:
			projection.NextAction = "resume_checkout"
			var err error
			projection.ActionHref, err = s.checkoutHref(ctx, input.WorkspaceID, input.UserID)
			if err != nil {
				return Projection{}, err
			}
		case StepDestination:
			projection.NextAction = "connect_destination"
			projection.ActionHref = "/settings?tab=accounts"
		case StepComposition:
			projection.NextAction = "create_publication"
			projection.ActionHref = "/"
		case StepPublication:
			projection.NextAction = "create_publication"
			projection.ActionHref = "/"
		}
		break
	}
	projection.Visible = projection.NextAction != ""
	return projection, nil
}

func (s *Service) exists(ctx context.Context, model any, where string, values ...any) (bool, error) {
	return s.db.NewSelect().Model(model).Where(where, values...).Exists(ctx)
}

func (s *Service) organizationRole(ctx context.Context, organizationID, userID string) (string, error) {
	if strings.TrimSpace(organizationID) == "" {
		return "", nil
	}
	var role string
	err := s.db.NewSelect().Model((*models.OrganizationMember)(nil)).Column("role").
		Where("organization_id = ? AND user_id = ?", organizationID, userID).
		Scan(ctx, &role)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return role, err
}

func canManageBilling(role string) bool {
	return role == models.OrganizationRoleOwner || role == models.OrganizationRoleAdmin
}

func (s *Service) checkoutHref(ctx context.Context, workspaceID, userID string) (string, error) {
	var attempt models.BillingCheckoutAttempt
	err := s.db.NewSelect().Model(&attempt).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Where("status IN (?)", bun.List([]string{"created", "pending"})).
		OrderExpr("created_at DESC").
		Limit(1).
		Scan(ctx)
	if err == sql.ErrNoRows {
		return "/settings?tab=billing", nil
	}
	if err != nil {
		return "", err
	}
	return "/checkout?attempt=" + attempt.CheckoutAttemptID, nil
}

func subscriptionAllowsUsage(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "trialing":
		return true
	default:
		return false
	}
}
