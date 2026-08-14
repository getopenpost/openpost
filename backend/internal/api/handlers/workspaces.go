package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auditprojection"
	authservice "github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationdeletion"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/setupprojection"
	"github.com/openpost/backend/internal/services/workspacedeletion"
	"github.com/openpost/backend/internal/services/workspaceteam"
	"github.com/uptrace/bun"
)

type WorkspaceHandler struct {
	db                   *bun.DB
	auth                 middleware.Authenticator
	entitlement          entitlements.Service
	notifications        *notifications.Service
	team                 *workspaceteam.Service
	setup                *setupprojection.Service
	audit                *auditprojection.Service
	deletion             *workspacedeletion.Service
	organizationDeletion *organizationdeletion.Service
	hosted               bool
	frontendURL          string
	inviteLimiter        *ratelimit.Limiter
}

const (
	workspaceInvitationCreateLimit = 20
)

func NewWorkspaceHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement ...entitlements.Service) *WorkspaceHandler {
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if len(entitlement) > 0 && entitlement[0] != nil {
		entitlementService = entitlement[0]
	}
	_, hosted := entitlementService.(*entitlements.SubscriptionService)
	return &WorkspaceHandler{
		db: db, auth: authenticator, entitlement: entitlementService,
		team:          workspaceteam.NewService(db, entitlementService, nil),
		setup:         setupprojection.NewService(db),
		audit:         auditprojection.NewService(db),
		hosted:        hosted,
		inviteLimiter: ratelimit.New(),
	}
}

func (h *WorkspaceHandler) SetFrontendURL(frontendURL string) {
	h.frontendURL = strings.TrimRight(strings.TrimSpace(frontendURL), "/")
}

func (h *WorkspaceHandler) SetNotificationService(service *notifications.Service) {
	h.notifications = service
	h.team = workspaceteam.NewService(h.db, h.entitlement, service)
}

func (h *WorkspaceHandler) SetSensitiveActionServices(authService *authservice.Service, identityService *identity.Service, decryptors ...workspacedeletion.AcceptURLDecryptor) {
	h.deletion = workspacedeletion.NewService(h.db, authService, identityService, decryptors...)
	h.organizationDeletion = organizationdeletion.NewService(h.db, authService, identityService, decryptors...)
}

type CreateWorkspaceInput struct {
	Body struct {
		Name           string `json:"name" minLength:"1" maxLength:"100" doc:"Workspace name"`
		OrganizationID string `json:"organization_id,omitempty" doc:"Organization ID. Omit to use the signed-in owner's active subscribed organization when available, or create a personal organization."`
	}
}

type CreateWorkspaceOutput struct {
	Body struct {
		WorkspaceID        string `json:"id"`
		OrganizationID     string `json:"organization_id"`
		WorkspaceName      string `json:"name"`
		WorkspaceCreatedAt string `json:"created_at"`
	}
}

type WorkspaceResponse struct {
	WorkspaceID        string `json:"id"`
	OrganizationID     string `json:"organization_id"`
	OrganizationName   string `json:"organization_name"`
	WorkspaceName      string `json:"name"`
	AvatarURL          string `json:"avatar_url"`
	Color              string `json:"color"`
	WorkspaceCreatedAt string `json:"created_at"`
	Role               string `json:"role" enum:"admin,editor,viewer" doc:"Current user's workspace role"`
	CanEdit            bool   `json:"can_edit" doc:"Whether the current user can change workspace content"`
	SSORequired        bool   `json:"sso_required" doc:"Whether this workspace requires organization SSO"`
	SSOAuthenticated   bool   `json:"sso_authenticated" doc:"Whether the current credential satisfies organization SSO"`
	SSOProviderID      string `json:"sso_provider_id,omitempty" doc:"Identity provider required for this workspace"`
	SSOProviderName    string `json:"sso_provider_name,omitempty" doc:"Identity provider name required for this workspace"`
	SSOIdentityLinked  bool   `json:"sso_identity_linked" doc:"Whether the required provider is explicitly linked to this user"`
}

type ListWorkspacesOutput struct {
	Body []WorkspaceResponse
}

type WorkspaceSetupStepResponse struct {
	ID        string `json:"id" enum:"workspace,subscription,destination,composition,publication" doc:"Setup step derived from Workspace state"`
	Completed bool   `json:"completed" doc:"Whether the authoritative product state completes this step"`
}

type WorkspaceSetupResponse struct {
	Visible        bool                         `json:"visible" doc:"Whether the current user has an applicable, authorized incomplete setup step"`
	Activated      bool                         `json:"activated" doc:"Whether the Workspace has a connected destination and a scheduled or submitted Publication"`
	CompletedSteps int                          `json:"completed_steps" doc:"Number of completed setup steps"`
	TotalSteps     int                          `json:"total_steps" doc:"Number of applicable setup steps"`
	NextStep       string                       `json:"next_step,omitempty" enum:"workspace,subscription,destination,composition,publication" doc:"First incomplete setup step available to the current user"`
	NextAction     string                       `json:"next_action,omitempty" enum:"name_workspace,resume_checkout,connect_destination,create_publication" doc:"Authorized action for the next setup step"`
	ActionHref     string                       `json:"action_href,omitempty" doc:"Safe same-origin application route for the next setup action"`
	Steps          []WorkspaceSetupStepResponse `json:"steps" doc:"Ordered authoritative setup progress applicable to the current user's role and deployment"`
}

type GetWorkspaceSetupInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
}

type GetWorkspaceSetupOutput struct {
	Body WorkspaceSetupResponse
}

type StartWorkspaceCompositionInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	Body   struct {
		Signal    string `json:"signal" enum:"text,media,content_mode" doc:"Meaningful composer interaction category"`
		OriginKey string `json:"origin_key" minLength:"16" maxLength:"100" doc:"Opaque browser-generated key used to reconcile an uncertain claim response"`
	}
}

type StartWorkspaceCompositionResponse struct {
	Claimed bool `json:"claimed" doc:"Whether this request recorded the Workspace's first meaningful composition"`
}

type StartWorkspaceCompositionOutput struct {
	Body StartWorkspaceCompositionResponse
}

type DeleteWorkspaceInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	Body   struct {
		ConfirmName     string `json:"confirm_name" minLength:"1" doc:"Exact canonical Workspace name"`
		CurrentPassword string `json:"current_password,omitempty" doc:"Current account password"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time grant for workspace.delete"`
	}
}

type DeleteWorkspaceOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type WorkspaceDeletionBlocker struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type WorkspaceDeletionPreview struct {
	WorkspaceID      string                     `json:"workspace_id"`
	WorkspaceName    string                     `json:"workspace_name"`
	Removed          []string                   `json:"removed" enum:"access,content,connected_assets"`
	Retained         []string                   `json:"retained" enum:"required_records"`
	RecoveryPossible bool                       `json:"recovery_possible"`
	Blockers         []WorkspaceDeletionBlocker `json:"blockers"`
}

type GetWorkspaceDeletionPreviewInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
}

type GetWorkspaceDeletionPreviewOutput struct {
	Body WorkspaceDeletionPreview
}

type OrganizationDeletionInput struct {
	PathID string `path:"id" doc:"Organization ID"`
	Body   struct {
		ConfirmName     string `json:"confirm_name" minLength:"1" doc:"Exact canonical Organization name"`
		CurrentPassword string `json:"current_password,omitempty" doc:"Current account password"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time grant for organization.delete"`
	}
}

type OrganizationDeletionOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}
type OrganizationDeletionPreviewInput struct {
	PathID string `path:"id" doc:"Organization ID"`
}
type OrganizationDeletionWorkspace struct {
	WorkspaceID   string `json:"workspace_id"`
	WorkspaceName string `json:"workspace_name"`
}
type OrganizationDeletionPendingWork struct {
	PendingProviderWrites int `json:"pending_provider_writes"`
	PendingJobs           int `json:"pending_jobs"`
	PendingCleanupJobs    int `json:"pending_cleanup_jobs"`
}
type OrganizationDeletionPreview struct {
	OrganizationID   string                          `json:"organization_id"`
	OrganizationName string                          `json:"organization_name"`
	Workspaces       []OrganizationDeletionWorkspace `json:"workspaces"`
	BillingState     string                          `json:"billing_state" doc:"Latest local Paddle subscription state, or none"`
	PendingWork      OrganizationDeletionPendingWork `json:"pending_work"`
	AccessEffects    []string                        `json:"access_effects" enum:"organization_memberships,workspace_memberships,organization_credentials"`
	Retained         []string                        `json:"retained" enum:"required_audit_evidence,required_billing_evidence"`
	IrreversibleLoss []string                        `json:"irreversible_loss" enum:"workspaces,content,connected_accounts,media,settings"`
	RecoveryPossible bool                            `json:"recovery_possible"`
	Blockers         []WorkspaceDeletionBlocker      `json:"blockers"`
}
type OrganizationDeletionPreviewOutput struct{ Body OrganizationDeletionPreview }
type CancelOrganizationCheckoutAttemptsInput struct {
	PathID string `path:"id" doc:"Organization ID"`
}
type CancelOrganizationCheckoutAttemptsOutput struct {
	Body struct {
		Canceled int64 `json:"canceled"`
	}
}

type OrganizationResponse struct {
	ID        string `json:"id" doc:"Organization ID"`
	Name      string `json:"name" doc:"Organization name"`
	Role      string `json:"role" doc:"Current user's organization role"`
	CreatedAt string `json:"created_at" doc:"Organization creation time"`
}

type ListOrganizationsOutput struct {
	Body []OrganizationResponse
}

type OrganizationTeamInput struct {
	PathID string `path:"id" doc:"Organization ID"`
}

type OrganizationMemberResponse struct {
	UserID string `json:"user_id" doc:"User ID"`
	Email  string `json:"email" doc:"User email"`
	Role   string `json:"role" doc:"Organization role"`
}

type OrganizationTeamOutput struct {
	Body struct {
		Members      []OrganizationMemberResponse `json:"members"`
		CurrentSeats int64                        `json:"current_seats"`
	}
}

type WorkspaceMemberResponse struct {
	UserID        string  `json:"user_id" doc:"User ID"`
	Email         string  `json:"email" doc:"User email"`
	Role          string  `json:"role" enum:"admin,editor,viewer" doc:"Workspace role"`
	Status        string  `json:"status" enum:"active,inactive" doc:"Workspace access state"`
	CreatedAt     string  `json:"created_at" doc:"When access was first granted"`
	UpdatedAt     string  `json:"updated_at" doc:"When access last changed"`
	DeactivatedAt *string `json:"deactivated_at,omitempty" doc:"When access was temporarily deactivated"`
}

type WorkspaceInvitationResponse struct {
	ID                     string  `json:"id" doc:"Invitation ID"`
	WorkspaceID            string  `json:"workspace_id" doc:"Workspace ID"`
	Email                  string  `json:"email" doc:"Invited email"`
	Role                   string  `json:"role" doc:"Workspace role to grant"`
	InvitedByUserID        string  `json:"invited_by_user_id" doc:"Inviting user ID"`
	AcceptedByUserID       *string `json:"accepted_by_user_id,omitempty" doc:"Accepting user ID"`
	AcceptURL              string  `json:"accept_url,omitempty" doc:"Browser URL that accepts the invitation"`
	ExpiresAt              string  `json:"expires_at" doc:"Invitation expiry time"`
	AcceptedAt             *string `json:"accepted_at,omitempty" doc:"When the invitation was accepted"`
	RevokedAt              *string `json:"revoked_at,omitempty" doc:"When the invitation was revoked"`
	LastSentAt             string  `json:"last_sent_at" doc:"When the invitation was most recently sent"`
	EmailDeliveryStatus    string  `json:"email_delivery_status" enum:"created,queued,sent,delivered,failed,unavailable" doc:"Truthful transport outcome for the latest Transactional invitation email. Sent means provider accepted; Delivered requires an authenticated callback."`
	EmailDeliveryUpdatedAt *string `json:"email_delivery_updated_at,omitempty" doc:"Provider callback time for the latest terminal delivery outcome"`
	Status                 string  `json:"status" enum:"created,queued,sent,delivered,delivery_failed,delivery_unavailable,expired,revoked,accepted" doc:"Current invitation lifecycle, with terminal invitation state taking precedence over email delivery state"`
	CreatedAt              string  `json:"created_at" doc:"Invitation creation time"`
}

type WorkspaceTeamOutput struct {
	Body struct {
		Members      []WorkspaceMemberResponse     `json:"members"`
		Invitations  []WorkspaceInvitationResponse `json:"invitations"`
		CurrentSeats int64                         `json:"current_seats"`
		CanManage    bool                          `json:"can_manage" doc:"Whether the current user may administer workspace access"`
	}
}

type WorkspaceTeamInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	Query  string `query:"q" maxLength:"200" doc:"Case-insensitive member or invitation email search"`
	Role   string `query:"role" enum:"all,admin,editor,viewer" default:"all" doc:"Filter by role"`
	Status string `query:"status" enum:"all,active,inactive,pending,created,queued,sent,delivered,delivery_failed,delivery_unavailable,expired,revoked,accepted" default:"all" doc:"Filter by member access or exact invitation lifecycle state"`
}

type CreateWorkspaceInvitationInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	Body   struct {
		Email string `json:"email" format:"email" doc:"Email address to invite"`
		Role  string `json:"role" enum:"admin,editor,viewer" doc:"Workspace role to grant"`
	}
}

type CreateWorkspaceInvitationOutput struct {
	Body WorkspaceInvitationResponse
}

type RevokeWorkspaceInvitationInput struct {
	PathID       string `path:"id" doc:"Workspace ID"`
	InvitationID string `path:"invitation_id" doc:"Invitation ID"`
}

type RevokeWorkspaceInvitationOutput struct {
	Body struct {
		Revoked bool `json:"revoked"`
	}
}

type ResendWorkspaceInvitationInput struct {
	PathID       string `path:"id" doc:"Workspace ID"`
	InvitationID string `path:"invitation_id" doc:"Invitation ID"`
}

type ResendWorkspaceInvitationOutput struct {
	Body WorkspaceInvitationResponse
}

type UpdateWorkspaceMemberInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	UserID string `path:"user_id" doc:"Workspace member user ID"`
	Body   struct {
		Role   string `json:"role,omitempty" enum:"admin,editor,viewer" doc:"Replacement workspace role"`
		Status string `json:"status,omitempty" enum:"active,inactive" doc:"Replacement workspace access state"`
	}
}

type UpdateWorkspaceMemberOutput struct {
	Body WorkspaceMemberResponse
}

type RemoveWorkspaceMemberInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	UserID string `path:"user_id" doc:"Workspace member user ID"`
}

type RemoveWorkspaceMemberOutput struct {
	Body struct {
		Removed bool `json:"removed"`
	}
}

type WorkspaceAccessAuditInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	Limit  int    `query:"limit" minimum:"1" maximum:"200" default:"50" doc:"Maximum events to return"`
}

type WorkspaceAccessAuditResponse struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspace_id"`
	ActorUserID    string `json:"actor_user_id,omitempty"`
	SubjectUserID  string `json:"subject_user_id,omitempty"`
	InvitationID   string `json:"invitation_id,omitempty"`
	SubjectEmail   string `json:"subject_email,omitempty"`
	Action         string `json:"action"`
	PreviousRole   string `json:"previous_role,omitempty"`
	Role           string `json:"role,omitempty"`
	PreviousStatus string `json:"previous_status,omitempty"`
	Status         string `json:"status,omitempty"`
	CreatedAt      string `json:"created_at"`
}

type WorkspaceAccessAuditOutput struct {
	Body []WorkspaceAccessAuditResponse
}

type AcceptWorkspaceInvitationInput struct {
	Body struct {
		Token string `json:"token" minLength:"16" doc:"Raw invitation token"`
	}
}

type AcceptWorkspaceInvitationByIDInput struct {
	PathID string `path:"id" doc:"Invitation ID shown to the invited signed-in user"`
}

type AcceptWorkspaceInvitationOutput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id"`
		Role        string `json:"role"`
		Accepted    bool   `json:"accepted"`
	}
}

func (h *WorkspaceHandler) CreateWorkspace(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-workspace",
		Method:        http.MethodPost,
		Path:          "/workspaces",
		Summary:       "Create a new workspace",
		Tags:          []string{tagWorkspaces},
		DefaultStatus: http.StatusOK,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{402, 403, 500},
	}, func(ctx context.Context, input *CreateWorkspaceInput) (*CreateWorkspaceOutput, error) {
		userID := middleware.GetUserID(ctx)
		if middleware.GetWorkspaceID(ctx) != "" {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}

		organizationID := strings.TrimSpace(input.Body.OrganizationID)
		if organizationID == "" {
			var resolveErr error
			organizationID, resolveErr = h.preferredOrganizationForNewWorkspace(ctx, userID)
			if resolveErr != nil {
				return nil, huma.Error500InternalServerError("failed to resolve workspace organization")
			}
		}
		if organizationID != "" {
			if err := h.requireOrganizationAdmin(ctx, organizationID, userID); err != nil {
				return nil, err
			}
		}
		if err := h.checkCreateWorkspaceEntitlement(ctx, organizationID, userID); err != nil {
			return nil, err
		}
		now := time.Now().UTC()
		var organization *models.Organization
		var organizationMember *models.OrganizationMember
		if organizationID == "" {
			organization = &models.Organization{
				ID:          uuid.New().String(),
				Name:        input.Body.Name,
				CreatedByID: userID,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			organizationID = organization.ID
			organizationMember = &models.OrganizationMember{
				OrganizationID: organizationID,
				UserID:         userID,
				Role:           models.OrganizationRoleOwner,
				CreatedAt:      now,
			}
		}

		workspace := &models.Workspace{
			ID:             uuid.New().String(),
			OrganizationID: organizationID,
			Name:           input.Body.Name,
			WeekStart:      1,
			CreatedAt:      now,
		}

		member := &models.WorkspaceMember{
			WorkspaceID: workspace.ID,
			UserID:      userID,
			Role:        models.WorkspaceRoleAdmin,
			Status:      models.WorkspaceMemberStatusActive,
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		err := h.insertWorkspaceBoundary(ctx, organization, organizationMember, workspace, member, userID)
		if err != nil {
			if errors.Is(err, errOrganizationChangedDuringWorkspaceCreation) {
				return nil, huma.Error409Conflict("Organization access changed; review the Workspace destination and try again")
			}
			return nil, huma.Error500InternalServerError("failed to create workspace")
		}
		resp := &CreateWorkspaceOutput{}
		resp.Body.WorkspaceID = workspace.ID
		resp.Body.OrganizationID = workspace.OrganizationID
		resp.Body.WorkspaceName = workspace.Name
		resp.Body.WorkspaceCreatedAt = workspace.CreatedAt.Format(time.RFC3339)
		return resp, nil
	})
}

var errOrganizationChangedDuringWorkspaceCreation = errors.New("organization changed during workspace creation")

func (h *WorkspaceHandler) insertWorkspaceBoundary(ctx context.Context, organization *models.Organization, organizationMember *models.OrganizationMember, workspace *models.Workspace, member *models.WorkspaceMember, userID string) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if organization != nil {
			if _, err := tx.NewInsert().Model(organization).Exec(txCtx); err != nil {
				return err
			}
		}
		if organizationMember != nil {
			if _, err := tx.NewInsert().Model(organizationMember).Exec(txCtx); err != nil {
				return err
			}
		}
		if organization == nil {
			if err := lockOrganizationForWorkspaceCreation(txCtx, tx, workspace.OrganizationID, userID); err != nil {
				return err
			}
		}
		if _, err := tx.NewInsert().Model(workspace).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(member).Exec(txCtx); err != nil {
			return err
		}
		if _, _, err := jobregistry.EnqueueMediaCleanup(txCtx, tx, workspace.ID, time.Time{}); err != nil {
			return err
		}
		return nil
	})
}

func lockOrganizationForWorkspaceCreation(ctx context.Context, tx bun.Tx, organizationID, userID string) error {
	result, err := tx.NewUpdate().Model((*models.Organization)(nil)).Set("name = name").Where("id = ?", organizationID).Exec(ctx)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return errOrganizationChangedDuringWorkspaceCreation
	}
	adminCount, err := tx.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND user_id = ? AND role IN (?)", organizationID, userID, bun.List([]string{models.OrganizationRoleOwner, models.OrganizationRoleAdmin})).Count(ctx)
	if err != nil {
		return err
	}
	if adminCount != 1 {
		return errOrganizationChangedDuringWorkspaceCreation
	}
	return nil
}

func (h *WorkspaceHandler) preferredOrganizationForNewWorkspace(ctx context.Context, userID string) (string, error) {
	var organizationID string
	err := h.db.NewSelect().
		TableExpr("organizations AS o").
		ColumnExpr("o.id").
		Join("JOIN organization_members AS om ON om.organization_id = o.id").
		Join("JOIN billing_subscriptions AS bs ON bs.organization_id = o.id").
		Where("om.user_id = ?", userID).
		Where("bs.provider = ?", models.BillingProviderPaddle).
		Where("o.created_by = ?", userID).
		Where("om.role IN (?)", bun.List([]string{models.OrganizationRoleOwner, models.OrganizationRoleAdmin})).
		Where("LOWER(bs.status) IN (?)", bun.List([]string{"active", "trialing"})).
		OrderExpr("bs.updated_at DESC").
		Limit(1).
		Scan(ctx, &organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return organizationID, nil
}

func (h *WorkspaceHandler) ListWorkspaceTeam(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-workspace-team",
		Method:      http.MethodGet,
		Path:        "/workspaces/{id}/team",
		Summary:     "List workspace members and pending invitations",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *WorkspaceTeamInput) (*WorkspaceTeamOutput, error) {
		if err := h.requireWorkspaceAccess(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		team, err := h.team.List(ctx, input.PathID, middleware.GetUserID(ctx), workspaceteam.Filters{
			Query: input.Query, Role: input.Role, Status: input.Status,
		})
		if err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to fetch workspace team")
		}

		resp := &WorkspaceTeamOutput{}
		resp.Body.Members = workspaceMemberResponses(team.Members)
		resp.Body.Invitations = workspaceTeamInvitationResponses(team.Invitations)
		resp.Body.CurrentSeats = team.CurrentSeats
		resp.Body.CanManage = team.CanManage
		return resp, nil
	})
}

func (h *WorkspaceHandler) ListOrganizations(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-organizations",
		Method:      http.MethodGet,
		Path:        "/organizations",
		Summary:     "List organizations for the current user",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 500},
	}, func(ctx context.Context, _ *struct{}) (*ListOrganizationsOutput, error) {
		if err := requireUnscopedOrganizationCredential(ctx); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		var rows []struct {
			ID        string    `bun:"id"`
			Name      string    `bun:"name"`
			Role      string    `bun:"role"`
			CreatedAt time.Time `bun:"created_at"`
		}
		err := h.db.NewSelect().
			TableExpr("organizations AS o").
			ColumnExpr("o.id, o.name, om.role, o.created_at").
			Join("JOIN organization_members AS om ON om.organization_id = o.id").
			Where("om.user_id = ?", userID).
			Order("o.name ASC").
			Scan(ctx, &rows)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch organizations")
		}
		resp := &ListOrganizationsOutput{Body: []OrganizationResponse{}}
		for _, row := range rows {
			if tokenID := middleware.GetTokenID(ctx); tokenID != "" {
				decision, err := identity.EvaluateOrganizationAccess(
					ctx,
					h.db,
					row.ID,
					userID,
					middleware.GetSessionID(ctx),
					tokenID,
				)
				if err != nil {
					return nil, huma.Error500InternalServerError("failed to validate organization access")
				}
				if !decision.Allowed {
					continue
				}
			}
			resp.Body = append(resp.Body, OrganizationResponse{
				ID:        row.ID,
				Name:      row.Name,
				Role:      row.Role,
				CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		return resp, nil
	})
}

func (h *WorkspaceHandler) ListOrganizationTeam(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-organization-team",
		Method:      http.MethodGet,
		Path:        "/organizations/{id}/team",
		Summary:     "List organization members",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *OrganizationTeamInput) (*OrganizationTeamOutput, error) {
		if _, err := h.requireOrganizationMember(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		members, err := h.listOrganizationMembers(ctx, input.PathID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch organization members")
		}
		resp := &OrganizationTeamOutput{}
		resp.Body.Members = members
		resp.Body.CurrentSeats = int64(len(members))
		return resp, nil
	})
}

func (h *WorkspaceHandler) CreateWorkspaceInvitation(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-workspace-invitation",
		Method:        http.MethodPost,
		Path:          "/workspaces/{id}/invitations",
		Summary:       "Create a workspace invitation",
		Tags:          []string{tagWorkspaces},
		DefaultStatus: http.StatusOK,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 402, 403, 404, 409, 429},
	}, func(ctx context.Context, input *CreateWorkspaceInvitationInput) (*CreateWorkspaceInvitationOutput, error) {
		actorUserID := middleware.GetUserID(ctx)
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, actorUserID); err != nil {
			return nil, err
		}
		if h.inviteLimiter != nil && !h.inviteLimiter.Allow(
			"workspace-invitation-create:"+input.PathID+":"+actorUserID,
			workspaceInvitationCreateLimit,
			time.Hour,
		) {
			return nil, huma.Error429TooManyRequests("workspace invitation limit reached; try again later")
		}
		invitation, token, err := h.team.Invite(ctx, workspaceteam.InviteInput{
			WorkspaceID: input.PathID, ActorUserID: actorUserID,
			Email: input.Body.Email, Role: input.Body.Role,
		})
		if err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to create workspace invitation")
		}

		resp := &CreateWorkspaceInvitationOutput{}
		resp.Body = workspaceInvitationResponse(invitation, h.acceptWorkspaceInvitationURL(token), workspaceteam.InvitationLifecycleStatus(invitation, time.Now().UTC()))
		return resp, nil
	})
}

func (h *WorkspaceHandler) RevokeWorkspaceInvitation(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "revoke-workspace-invitation",
		Method:      http.MethodDelete,
		Path:        "/workspaces/{id}/invitations/{invitation_id}",
		Summary:     "Revoke a pending workspace invitation",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409},
	}, func(ctx context.Context, input *RevokeWorkspaceInvitationInput) (*RevokeWorkspaceInvitationOutput, error) {
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		if err := h.team.RevokeInvitation(ctx, input.PathID, input.InvitationID, middleware.GetUserID(ctx)); err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to revoke workspace invitation")
		}

		return &RevokeWorkspaceInvitationOutput{Body: struct {
			Revoked bool `json:"revoked"`
		}{Revoked: true}}, nil
	})
}

func (h *WorkspaceHandler) ResendWorkspaceInvitation(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "resend-workspace-invitation",
		Method:      http.MethodPost,
		Path:        "/workspaces/{id}/invitations/{invitation_id}/resend",
		Summary:     "Resend a pending or expired workspace invitation",
		Description: "Rotates the invitation secret and returns the new invitation URL once.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409, 429},
	}, func(ctx context.Context, input *ResendWorkspaceInvitationInput) (*ResendWorkspaceInvitationOutput, error) {
		actorUserID := middleware.GetUserID(ctx)
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, actorUserID); err != nil {
			return nil, err
		}
		invitation, token, err := h.team.ResendInvitation(ctx, input.PathID, input.InvitationID, actorUserID)
		if err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to resend workspace invitation")
		}
		return &ResendWorkspaceInvitationOutput{Body: workspaceInvitationResponse(
			invitation, h.acceptWorkspaceInvitationURL(token), workspaceteam.InvitationLifecycleStatus(invitation, time.Now().UTC()),
		)}, nil
	})
}

func (h *WorkspaceHandler) UpdateWorkspaceMember(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-workspace-member",
		Method:      http.MethodPatch,
		Path:        "/workspaces/{id}/members/{user_id}",
		Summary:     "Change a workspace member's role or access state",
		Description: "Temporarily deactivate or reactivate access, or change the member role. The last active administrator cannot be demoted or deactivated.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 402, 403, 404, 409},
	}, func(ctx context.Context, input *UpdateWorkspaceMemberInput) (*UpdateWorkspaceMemberOutput, error) {
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		member, err := h.team.UpdateMember(ctx, workspaceteam.UpdateMemberInput{
			WorkspaceID: input.PathID, ActorUserID: middleware.GetUserID(ctx),
			SubjectUserID: input.UserID, Role: input.Body.Role, Status: input.Body.Status,
		})
		if err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to update workspace member")
		}
		return &UpdateWorkspaceMemberOutput{Body: workspaceMemberResponse(member)}, nil
	})
}

func (h *WorkspaceHandler) RemoveWorkspaceMember(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "remove-workspace-member",
		Method:      http.MethodDelete,
		Path:        "/workspaces/{id}/members/{user_id}",
		Summary:     "Permanently remove a workspace member",
		Description: "Removes workspace access. The last active administrator cannot be removed.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409},
	}, func(ctx context.Context, input *RemoveWorkspaceMemberInput) (*RemoveWorkspaceMemberOutput, error) {
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		if err := h.team.RemoveMember(ctx, input.PathID, input.UserID, middleware.GetUserID(ctx)); err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to remove workspace member")
		}
		return &RemoveWorkspaceMemberOutput{Body: struct {
			Removed bool `json:"removed"`
		}{Removed: true}}, nil
	})
}

func (h *WorkspaceHandler) ListWorkspaceAccessAudit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-workspace-access-audit",
		Method:      http.MethodGet,
		Path:        "/workspaces/{id}/access-audit",
		Summary:     "List workspace access changes",
		Description: "Returns the newest role, member-state, invitation, and removal events. Requires an active workspace administrator.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *WorkspaceAccessAuditInput) (*WorkspaceAccessAuditOutput, error) {
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		events, err := h.team.ListAudit(ctx, input.PathID, middleware.GetUserID(ctx), input.Limit)
		if err != nil {
			return nil, workspaceTeamHTTPError(err, "failed to fetch workspace access history")
		}
		out := make([]WorkspaceAccessAuditResponse, 0, len(events))
		for _, event := range events {
			out = append(out, WorkspaceAccessAuditResponse{
				ID: event.ID, WorkspaceID: event.WorkspaceID, ActorUserID: event.ActorUserID,
				SubjectUserID: event.SubjectUserID, InvitationID: event.InvitationID,
				SubjectEmail: event.SubjectEmail, Action: event.Action,
				PreviousRole: event.PreviousRole, Role: event.Role,
				PreviousStatus: event.PreviousStatus, Status: event.Status,
				CreatedAt: event.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		return &WorkspaceAccessAuditOutput{Body: out}, nil
	})
}

func (h *WorkspaceHandler) AcceptWorkspaceInvitation(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:   "accept-workspace-invitation",
		Method:        http.MethodPost,
		Path:          "/workspace-invitations/accept",
		Summary:       "Accept a workspace invitation",
		Tags:          []string{tagWorkspaces},
		DefaultStatus: http.StatusOK,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *AcceptWorkspaceInvitationInput) (*AcceptWorkspaceInvitationOutput, error) {
		invitation, err := h.team.FindInvitationByToken(ctx, input.Body.Token)
		if err != nil {
			return nil, invitationAcceptanceHTTPError(err)
		}
		return h.acceptWorkspaceInvitation(ctx, invitation, middleware.GetUserID(ctx))
	})

	huma.Register(api, huma.Operation{
		OperationID:   "accept-workspace-invitation-by-id",
		Method:        http.MethodPost,
		Path:          "/workspace-invitations/{id}/accept",
		Summary:       "Accept the current user's workspace invitation",
		Description:   "Accepts a pending invitation only when its email matches the signed-in user. This supports safe in-app invitation notifications without storing the invitation token.",
		Tags:          []string{tagWorkspaces},
		DefaultStatus: http.StatusOK,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *AcceptWorkspaceInvitationByIDInput) (*AcceptWorkspaceInvitationOutput, error) {
		invitation, err := h.team.FindInvitationByID(ctx, input.PathID)
		if err != nil {
			return nil, invitationAcceptanceHTTPError(err)
		}
		return h.acceptWorkspaceInvitation(ctx, invitation, middleware.GetUserID(ctx))
	})
}

func (h *WorkspaceHandler) acceptWorkspaceInvitation(
	ctx context.Context,
	invitation models.WorkspaceInvitation,
	userID string,
) (*AcceptWorkspaceInvitationOutput, error) {
	if !middleware.WorkspaceScopeAllows(ctx, invitation.WorkspaceID) {
		return nil, huma.Error403Forbidden("token is not scoped to this workspace")
	}
	decision, err := identity.EvaluateWorkspaceAccess(
		ctx,
		h.db,
		invitation.WorkspaceID,
		userID,
		middleware.GetSessionID(ctx),
		middleware.GetTokenID(ctx),
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to evaluate workspace SSO policy")
	}
	if !decision.Allowed {
		return nil, huma.Error403Forbidden("workspace SSO authentication is required")
	}
	if err := h.team.AcceptInvitation(ctx, invitation, userID); err != nil {
		return nil, invitationAcceptanceHTTPError(err)
	}

	return &AcceptWorkspaceInvitationOutput{Body: struct {
		WorkspaceID string `json:"workspace_id"`
		Role        string `json:"role"`
		Accepted    bool   `json:"accepted"`
	}{
		WorkspaceID: invitation.WorkspaceID,
		Role:        invitation.Role,
		Accepted:    true,
	}}, nil
}

func (h *WorkspaceHandler) checkCreateWorkspaceEntitlement(ctx context.Context, organizationID, userID string) error {
	var current int
	if organizationID != "" {
		if err := h.db.NewSelect().
			ColumnExpr("COUNT(*)").
			Model((*models.Workspace)(nil)).
			Where("organization_id = ?", organizationID).
			Scan(ctx, &current); err != nil {
			return huma.Error500InternalServerError("failed to check workspace limit")
		}
	} else {
		if err := h.db.NewSelect().
			ColumnExpr("COUNT(*)").
			Model((*models.WorkspaceMember)(nil)).
			Where("user_id = ? AND status = ?", userID, models.WorkspaceMemberStatusActive).
			Scan(ctx, &current); err != nil {
			return huma.Error500InternalServerError("failed to check workspace limit")
		}
	}

	decision, err := h.entitlement.Check(ctx, entitlements.Request{
		OrganizationID: organizationID,
		UserID:         userID,
		Limit:          entitlements.LimitWorkspaces,
		Current:        int64(current),
		Amount:         1,
	})
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace limit")
	}
	if !decision.Allowed {
		reason := decision.Reason
		if reason == "" {
			reason = "workspace limit exceeded"
		}
		return huma.NewError(http.StatusPaymentRequired, reason)
	}
	return nil
}

func (h *WorkspaceHandler) requireWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *WorkspaceHandler) requireWorkspaceAdmin(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceAdminAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace admin role required")
	}
	return nil
}

func requireUnscopedOrganizationCredential(ctx context.Context) error {
	if strings.TrimSpace(middleware.GetWorkspaceID(ctx)) != "" {
		return huma.Error403Forbidden("workspace-bound tokens cannot access organization-level resources")
	}
	return nil
}

func (h *WorkspaceHandler) requireOrganizationAdmin(ctx context.Context, organizationID, userID string) error {
	member, err := h.requireOrganizationMember(ctx, organizationID, userID)
	if err != nil {
		return err
	}
	if member.Role != models.OrganizationRoleOwner && member.Role != models.OrganizationRoleAdmin {
		return huma.Error403Forbidden("organization admin role required")
	}
	return nil
}

func (h *WorkspaceHandler) requireOrganizationMember(ctx context.Context, organizationID, userID string) (*models.OrganizationMember, error) {
	decision, err := identity.EvaluateOrganizationAccess(
		ctx,
		h.db,
		organizationID,
		userID,
		middleware.GetSessionID(ctx),
		middleware.GetTokenID(ctx),
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to validate organization SSO access")
	}
	if !decision.Allowed {
		return nil, huma.Error403Forbidden("organization SSO authentication is required")
	}
	var member models.OrganizationMember
	err = h.db.NewSelect().
		Model(&member).
		Where("organization_id = ? AND user_id = ?", organizationID, userID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error403Forbidden("organization not accessible")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to validate organization access")
	}
	return &member, nil
}

func (h *WorkspaceHandler) listOrganizationMembers(ctx context.Context, organizationID string) ([]OrganizationMemberResponse, error) {
	var rows []OrganizationMemberResponse
	err := h.db.NewSelect().
		TableExpr("organization_members AS om").
		ColumnExpr("om.user_id, u.email, om.role").
		Join("JOIN users AS u ON u.id = om.user_id").
		Where("om.organization_id = ?", organizationID).
		Order("u.email ASC").
		Scan(ctx, &rows)
	return rows, err
}

func (h *WorkspaceHandler) ListWorkspaces(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-workspaces",
		Method:      http.MethodGet,
		Path:        "/workspaces",
		Summary:     "List workspaces for the current user",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, _ *struct{}) (*ListWorkspacesOutput, error) {
		userID := middleware.GetUserID(ctx)

		var rows []struct {
			ID               string    `bun:"id"`
			OrganizationID   string    `bun:"organization_id"`
			OrganizationName string    `bun:"organization_name"`
			Name             string    `bun:"name"`
			AvatarURL        string    `bun:"avatar_url"`
			Color            string    `bun:"color"`
			Role             string    `bun:"role"`
			CreatedAt        time.Time `bun:"created_at"`
		}
		query := h.db.NewSelect().
			TableExpr("workspaces AS w").
			ColumnExpr("w.id, w.organization_id, w.name, w.avatar_url, w.color, w.created_at, wm.role").
			ColumnExpr("COALESCE(o.name, '') AS organization_name").
			Join("JOIN workspace_members AS wm ON wm.workspace_id = w.id").
			Join("LEFT JOIN organizations AS o ON o.id = w.organization_id").
			Where("wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive)
		if workspaceID := middleware.GetWorkspaceID(ctx); workspaceID != "" {
			query = query.Where("w.id = ?", workspaceID)
		}
		err := query.Order("organization_name ASC", "w.name ASC").Scan(ctx, &rows)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspaces")
		}

		resp := &ListWorkspacesOutput{Body: []WorkspaceResponse{}}
		for _, ws := range rows {
			decision, err := identity.EvaluateWorkspaceAccess(
				ctx,
				h.db,
				ws.ID,
				userID,
				middleware.GetSessionID(ctx),
				middleware.GetTokenID(ctx),
			)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to evaluate workspace SSO policy")
			}
			if middleware.GetTokenID(ctx) != "" && !decision.Allowed {
				continue
			}
			identityLinked := true
			if decision.SSORequired && decision.ProviderID != "" {
				identityLinked, err = h.db.NewSelect().Model((*models.UserIdentity)(nil)).
					Where("user_id = ? AND provider_id = ?", userID, decision.ProviderID).
					Exists(ctx)
				if err != nil {
					return nil, huma.Error500InternalServerError("failed to inspect workspace SSO identity")
				}
			}
			resp.Body = append(resp.Body, WorkspaceResponse{
				WorkspaceID:        ws.ID,
				OrganizationID:     ws.OrganizationID,
				OrganizationName:   ws.OrganizationName,
				WorkspaceName:      ws.Name,
				AvatarURL:          ws.AvatarURL,
				Color:              normalizedWorkspaceColor(ws.Color),
				WorkspaceCreatedAt: ws.CreatedAt.Format(time.RFC3339),
				Role:               ws.Role,
				CanEdit:            decision.Allowed && (ws.Role == models.WorkspaceRoleAdmin || ws.Role == models.WorkspaceRoleEditor),
				SSORequired:        decision.SSORequired,
				SSOAuthenticated:   decision.Allowed,
				SSOProviderID:      decision.ProviderID,
				SSOProviderName:    decision.ProviderName,
				SSOIdentityLinked:  identityLinked,
			})
		}
		return resp, nil
	})
}

func (h *WorkspaceHandler) GetWorkspaceSetup(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-workspace-setup",
		Method:      http.MethodGet,
		Path:        "/workspaces/{id}/setup",
		Summary:     "Get workspace setup progress",
		Description: "Projects role- and deployment-applicable setup progress from the Workspace, subscription, connected-destination, and Publication state without storing a separate onboarding step index.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *GetWorkspaceSetupInput) (*GetWorkspaceSetupOutput, error) {
		userID := middleware.GetUserID(ctx)
		if !middleware.WorkspaceScopeAllows(ctx, input.PathID) {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}
		if err := h.requireWorkspaceAccess(ctx, input.PathID, userID); err != nil {
			return nil, err
		}
		canEdit, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, input.PathID, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError(errValidateWorkspaceAccess)
		}
		canManageWorkspace, err := middleware.CheckWorkspaceAdminAccess(ctx, h.db, input.PathID, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError(errValidateWorkspaceAccess)
		}
		projection, err := h.setup.Project(ctx, setupprojection.Input{
			WorkspaceID: input.PathID, UserID: userID, CanEdit: canEdit, CanManageWorkspace: canManageWorkspace, Hosted: h.hosted,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("workspace not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to project workspace setup")
		}
		response := WorkspaceSetupResponse{
			Visible: projection.Visible, Activated: projection.Activated,
			CompletedSteps: projection.CompletedSteps, TotalSteps: projection.TotalSteps,
			NextStep: projection.NextStep, NextAction: projection.NextAction, ActionHref: projection.ActionHref,
			Steps: make([]WorkspaceSetupStepResponse, 0, len(projection.Steps)),
		}
		for _, step := range projection.Steps {
			response.Steps = append(response.Steps, WorkspaceSetupStepResponse{ID: step.ID, Completed: step.Completed})
		}
		return &GetWorkspaceSetupOutput{Body: response}, nil
	})
}

func (h *WorkspaceHandler) StartWorkspaceComposition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:   "start-workspace-composition",
		Method:        http.MethodPost,
		Path:          "/workspaces/{id}/setup/composition",
		Summary:       "Record the first meaningful Workspace composition",
		Description:   "Atomically records meaningful text, attached media, or an intentional content-mode choice once per Workspace.",
		Tags:          []string{tagWorkspaces},
		DefaultStatus: http.StatusOK,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{403, 404},
	}, func(ctx context.Context, input *StartWorkspaceCompositionInput) (*StartWorkspaceCompositionOutput, error) {
		userID := middleware.GetUserID(ctx)
		if !middleware.WorkspaceScopeAllows(ctx, input.PathID) {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}
		canEdit, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, input.PathID, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError(errValidateWorkspaceAccess)
		}
		if !canEdit {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}
		claim := &models.WorkspaceFirstComposition{
			WorkspaceID: input.PathID,
			Signal:      input.Body.Signal,
			OriginKey:   input.Body.OriginKey,
			CreatedAt:   time.Now().UTC(),
		}
		result, err := h.db.NewInsert().Model(claim).On("CONFLICT (workspace_id) DO NOTHING").Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to record Workspace composition")
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to inspect Workspace composition")
		}
		claimed := rows == 1
		if !claimed {
			var stored models.WorkspaceFirstComposition
			if err := h.db.NewSelect().Model(&stored).Where("workspace_id = ?", input.PathID).Scan(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to reconcile Workspace composition")
			}
			claimed = stored.OriginKey == input.Body.OriginKey
		}
		return &StartWorkspaceCompositionOutput{Body: StartWorkspaceCompositionResponse{Claimed: claimed}}, nil
	})
}

func (h *WorkspaceHandler) GetWorkspaceDeletionPreview(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-workspace-deletion-preview",
		Method:      http.MethodGet,
		Path:        "/workspaces/{id}/deletion-preview",
		Summary:     "Preview permanent Workspace deletion",
		Description: "Explains permanent data loss, retained records, recovery, and current lifecycle blockers. Only the Organization Owner can inspect this preview.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 500},
	}, func(ctx context.Context, input *GetWorkspaceDeletionPreviewInput) (*GetWorkspaceDeletionPreviewOutput, error) {
		preview, err := h.deletion.Preview(ctx, input.PathID, workspaceDeletionActor(ctx))
		if err != nil {
			return nil, workspaceDeletionHTTPError(err)
		}
		blockers := make([]WorkspaceDeletionBlocker, len(preview.Blockers))
		for index, blocker := range preview.Blockers {
			blockers[index] = WorkspaceDeletionBlocker{Code: blocker.Code, Message: blocker.Message}
		}
		return &GetWorkspaceDeletionPreviewOutput{Body: WorkspaceDeletionPreview{
			WorkspaceID: preview.WorkspaceID, WorkspaceName: preview.WorkspaceName, Removed: preview.Removed,
			Retained: preview.Retained, RecoveryPossible: preview.RecoveryPossible, Blockers: blockers,
		}}, nil
	})
}

func (h *WorkspaceHandler) DeleteWorkspace(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-workspace",
		Method:      http.MethodDelete,
		Path:        "/workspaces/{id}",
		Summary:     "Permanently delete a Workspace and its content",
		Description: "Permanently deletes the Workspace and its content only after Organization Owner authorization, exact canonical-name confirmation, recent authentication, and lifecycle-blocker checks. Billing and required audit records remain.",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 401, 403, 404, 409, 500},
	}, func(ctx context.Context, input *DeleteWorkspaceInput) (*DeleteWorkspaceOutput, error) {
		err := h.deletion.Delete(ctx, input.PathID, workspaceDeletionActor(ctx), workspacedeletion.Confirmation{
			CanonicalName: input.Body.ConfirmName, CurrentPassword: input.Body.CurrentPassword, ReauthGrant: input.Body.ReauthGrant,
		})
		if err != nil {
			return nil, workspaceDeletionHTTPError(err)
		}
		return &DeleteWorkspaceOutput{Body: struct {
			Deleted bool `json:"deleted"`
		}{Deleted: true}}, nil
	})
}

func (h *WorkspaceHandler) GetOrganizationDeletionPreview(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-organization-deletion-preview",
		Method:      http.MethodGet,
		Path:        "/organizations/{id}/deletion-preview",
		Summary:     "Preview permanent Organization deletion",
		Description: "Lists every owned Workspace, the local Paddle state, pending external work, access effects, retained evidence, irreversible loss, and every current blocker. Only the current Organization Owner can inspect it.",
		Tags:        []string{"Organizations"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusInternalServerError},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *OrganizationDeletionPreviewInput) (*OrganizationDeletionPreviewOutput, error) {
		if h.organizationDeletion == nil {
			return nil, huma.Error500InternalServerError("Organization deletion is not configured")
		}
		preview, err := h.organizationDeletion.Preview(ctx, input.PathID, organizationDeletionActor(ctx))
		if err != nil {
			return nil, organizationDeletionError(err)
		}
		body := OrganizationDeletionPreview{OrganizationID: preview.OrganizationID, OrganizationName: preview.OrganizationName, BillingState: preview.BillingState, AccessEffects: preview.AccessEffects, Retained: preview.Retained, IrreversibleLoss: preview.IrreversibleLoss, RecoveryPossible: preview.RecoveryPossible, Blockers: make([]WorkspaceDeletionBlocker, 0, len(preview.Blockers))}
		body.Workspaces = make([]OrganizationDeletionWorkspace, 0, len(preview.Workspaces))
		for _, workspace := range preview.Workspaces {
			body.Workspaces = append(body.Workspaces, OrganizationDeletionWorkspace{WorkspaceID: workspace.ID, WorkspaceName: workspace.Name})
		}
		body.PendingWork = OrganizationDeletionPendingWork{PendingProviderWrites: preview.PendingWork.ProviderWrites, PendingJobs: preview.PendingWork.Jobs, PendingCleanupJobs: preview.PendingWork.CleanupJobs}
		for _, blocker := range preview.Blockers {
			body.Blockers = append(body.Blockers, WorkspaceDeletionBlocker{Code: blocker.Code, Message: blocker.Message})
		}
		return &OrganizationDeletionPreviewOutput{Body: body}, nil
	})
}

func (h *WorkspaceHandler) DeleteOrganization(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-organization",
		Method:      http.MethodDelete,
		Path:        "/organizations/{id}",
		Summary:     "Permanently delete an Organization and all of its Workspaces",
		Description: "Atomically deletes the complete Organization boundary after current-Owner authorization, exact canonical-name confirmation, recent authentication, and a final blocker check. Required content-free billing and audit evidence remains.",
		Tags:        []string{"Organizations"},
		Errors:      []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusInternalServerError},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *OrganizationDeletionInput) (*OrganizationDeletionOutput, error) {
		if h.organizationDeletion == nil {
			return nil, huma.Error500InternalServerError("Organization deletion is not configured")
		}
		err := h.organizationDeletion.Delete(ctx, input.PathID, organizationDeletionActor(ctx), organizationdeletion.Confirmation{CanonicalName: input.Body.ConfirmName, CurrentPassword: input.Body.CurrentPassword, ReauthGrant: input.Body.ReauthGrant})
		if err != nil {
			return nil, organizationDeletionError(err)
		}
		output := &OrganizationDeletionOutput{}
		output.Body.Deleted = true
		return output, nil
	})
}

func (h *WorkspaceHandler) CancelOrganizationCheckoutAttempts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "cancel-organization-checkout-attempts",
		Method:      http.MethodDelete,
		Path:        "/organizations/{id}/billing-checkout-attempts/pending",
		Summary:     "Cancel pending local Paddle checkout attempts",
		Description: "Cancels checkout attempts that have not produced a Paddle subscription so an Organization Owner can resolve a deletion blocker without waiting.",
		Tags:        []string{"Organizations"},
		Errors:      []int{http.StatusForbidden, http.StatusNotFound, http.StatusInternalServerError},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *CancelOrganizationCheckoutAttemptsInput) (*CancelOrganizationCheckoutAttemptsOutput, error) {
		if h.organizationDeletion == nil {
			return nil, huma.Error500InternalServerError("Organization deletion is not configured")
		}
		canceled, err := h.organizationDeletion.CancelPendingCheckouts(ctx, input.PathID, organizationDeletionActor(ctx))
		if err != nil {
			return nil, organizationDeletionError(err)
		}
		output := &CancelOrganizationCheckoutAttemptsOutput{}
		output.Body.Canceled = canceled
		return output, nil
	})
}

func organizationDeletionActor(ctx context.Context) organizationdeletion.Actor {
	return organizationdeletion.Actor{UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), WorkspaceBindingID: middleware.GetWorkspaceID(ctx)}
}

func organizationDeletionError(err error) error {
	var useCaseErr *organizationdeletion.UseCaseError
	if !errors.As(err, &useCaseErr) {
		return huma.Error500InternalServerError("failed to process Organization deletion")
	}
	switch useCaseErr.Kind {
	case organizationdeletion.ErrorInvalid:
		return huma.Error400BadRequest(useCaseErr.Message)
	case organizationdeletion.ErrorAuth:
		return huma.Error401Unauthorized(useCaseErr.Message)
	case organizationdeletion.ErrorForbidden:
		return huma.Error403Forbidden(useCaseErr.Message)
	case organizationdeletion.ErrorNotFound:
		return huma.Error404NotFound(useCaseErr.Message)
	case organizationdeletion.ErrorConflict:
		return huma.Error409Conflict(useCaseErr.Message)
	default:
		return huma.Error500InternalServerError("failed to process Organization deletion")
	}
}

func workspaceDeletionActor(ctx context.Context) workspacedeletion.Actor {
	return workspacedeletion.Actor{UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), WorkspaceBindingID: middleware.GetWorkspaceID(ctx)}
}

func workspaceDeletionHTTPError(err error) error {
	var useCaseErr *workspacedeletion.UseCaseError
	if !errors.As(err, &useCaseErr) {
		return huma.Error500InternalServerError("failed to process Workspace deletion")
	}
	switch useCaseErr.Kind {
	case workspacedeletion.ErrorInvalid:
		return huma.Error400BadRequest(useCaseErr.Message)
	case workspacedeletion.ErrorAuth:
		return huma.Error401Unauthorized(useCaseErr.Message)
	case workspacedeletion.ErrorForbidden:
		return huma.Error403Forbidden(useCaseErr.Message)
	case workspacedeletion.ErrorNotFound:
		return huma.Error404NotFound(useCaseErr.Message)
	case workspacedeletion.ErrorConflict:
		return huma.Error409Conflict(useCaseErr.Message)
	default:
		return huma.Error500InternalServerError("failed to process Workspace deletion")
	}
}

func workspaceInvitationResponse(invitation models.WorkspaceInvitation, acceptURL, status string) WorkspaceInvitationResponse {
	return WorkspaceInvitationResponse{
		ID:                     invitation.ID,
		WorkspaceID:            invitation.WorkspaceID,
		Email:                  invitation.Email,
		Role:                   invitation.Role,
		InvitedByUserID:        invitation.InvitedByUserID,
		AcceptedByUserID:       optionalString(invitation.AcceptedByUserID),
		AcceptURL:              acceptURL,
		ExpiresAt:              invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AcceptedAt:             optionalTime(invitation.AcceptedAt),
		RevokedAt:              optionalTime(invitation.RevokedAt),
		LastSentAt:             formatRequiredTime(invitation.LastSentAt, invitation.CreatedAt),
		EmailDeliveryStatus:    invitation.EmailDeliveryStatus,
		EmailDeliveryUpdatedAt: optionalTime(invitation.EmailDeliveryUpdatedAt),
		Status:                 status,
		CreatedAt:              invitation.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func workspaceTeamInvitationResponses(invitations []workspaceteam.Invitation) []WorkspaceInvitationResponse {
	out := make([]WorkspaceInvitationResponse, 0, len(invitations))
	for _, invitation := range invitations {
		out = append(out, workspaceInvitationResponse(invitation.WorkspaceInvitation, "", invitation.Status))
	}
	return out
}

func workspaceMemberResponses(members []workspaceteam.Member) []WorkspaceMemberResponse {
	out := make([]WorkspaceMemberResponse, 0, len(members))
	for _, member := range members {
		out = append(out, workspaceMemberResponse(member))
	}
	return out
}

func workspaceMemberResponse(member workspaceteam.Member) WorkspaceMemberResponse {
	return WorkspaceMemberResponse{
		UserID: member.UserID, Email: member.Email, Role: member.Role, Status: member.Status,
		CreatedAt: formatRequiredTime(member.CreatedAt), UpdatedAt: formatRequiredTime(member.UpdatedAt, member.CreatedAt),
		DeactivatedAt: optionalTime(member.DeactivatedAt),
	}
}

func formatRequiredTime(values ...time.Time) string {
	for _, value := range values {
		if !value.IsZero() {
			return value.UTC().Format(time.RFC3339)
		}
	}
	return ""
}

func optionalString(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func hashWorkspaceInvitationToken(token string) string {
	return workspaceteam.HashInvitationToken(token)
}

func workspaceTeamHTTPError(err error, fallback string) error {
	message := strings.TrimSpace(err.Error())
	if message == "" {
		message = fallback
	}
	switch workspaceteam.ErrorKindOf(err) {
	case workspaceteam.ErrorInvalid:
		return huma.Error400BadRequest(message)
	case workspaceteam.ErrorPayment:
		return huma.NewError(http.StatusPaymentRequired, message)
	case workspaceteam.ErrorForbidden:
		return huma.Error403Forbidden(message)
	case workspaceteam.ErrorNotFound:
		return huma.Error404NotFound(message)
	case workspaceteam.ErrorConflict:
		return huma.Error409Conflict(message)
	case workspaceteam.ErrorRateLimited:
		return huma.Error429TooManyRequests(message)
	default:
		return huma.Error500InternalServerError(fallback)
	}
}

func invitationAcceptanceHTTPError(err error) error {
	switch workspaceteam.ErrorKindOf(err) {
	case workspaceteam.ErrorNotFound, workspaceteam.ErrorForbidden, workspaceteam.ErrorConflict, workspaceteam.ErrorInvalid:
		return huma.Error409Conflict("This invitation cannot be accepted. Ask a Workspace administrator for a new invitation.")
	default:
		return huma.Error500InternalServerError("failed to accept workspace invitation")
	}
}

func (h *WorkspaceHandler) acceptWorkspaceInvitationURL(token string) string {
	if h.frontendURL == "" {
		return "/invite?token=" + token
	}
	return h.frontendURL + "/invite?token=" + token
}

type GetWorkspaceSettingsInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
}

type GetWorkspaceSettingsOutput struct {
	Body struct {
		Name                string `json:"name"`
		AvatarURL           string `json:"avatar_url"`
		Color               string `json:"color"`
		Timezone            string `json:"timezone"`
		WeekStart           int    `json:"week_start"`
		MediaCleanupDays    int    `json:"media_cleanup_days" enum:"14" default:"14" deprecated:"true" doc:"Deprecated compatibility value. Always 14; temporary-media cleanup cannot be configured."`
		RandomDelayMinutes  int    `json:"random_delay_minutes"`
		DraftGapMinutes     int    `json:"draft_gap_minutes"`
		SlotStartHour       int    `json:"slot_start_hour"`
		SlotEndHour         int    `json:"slot_end_hour"`
		SlotIntervalMinutes int    `json:"slot_interval_minutes"`
	}
}

type UpdateWorkspaceSettingsInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
	Body   struct {
		Name                *string `json:"name,omitempty" minLength:"1" maxLength:"100" doc:"Workspace name"`
		AvatarURL           *string `json:"avatar_url,omitempty"`
		Color               *string `json:"color,omitempty" pattern:"^#[0-9A-Fa-f]{6}$" doc:"Workspace accent color as a six-digit hex value"`
		Timezone            *string `json:"timezone,omitempty"`
		WeekStart           *int    `json:"week_start,omitempty"`
		MediaCleanupDays    *int    `json:"media_cleanup_days,omitempty" deprecated:"true" doc:"Deprecated and ignored. Temporary media always becomes eligible after 14 unused days."`
		RandomDelayMinutes  *int    `json:"random_delay_minutes,omitempty"`
		DraftGapMinutes     *int    `json:"draft_gap_minutes,omitempty"`
		SlotStartHour       *int    `json:"slot_start_hour,omitempty"`
		SlotEndHour         *int    `json:"slot_end_hour,omitempty"`
		SlotIntervalMinutes *int    `json:"slot_interval_minutes,omitempty"`
	}
}

type UpdateWorkspaceSettingsOutput struct {
	Body struct {
		Name                string `json:"name"`
		AvatarURL           string `json:"avatar_url"`
		Color               string `json:"color"`
		Timezone            string `json:"timezone"`
		WeekStart           int    `json:"week_start"`
		MediaCleanupDays    int    `json:"media_cleanup_days" enum:"14" default:"14" deprecated:"true" doc:"Deprecated compatibility value. Always 14; temporary-media cleanup cannot be configured."`
		RandomDelayMinutes  int    `json:"random_delay_minutes"`
		DraftGapMinutes     int    `json:"draft_gap_minutes"`
		SlotStartHour       int    `json:"slot_start_hour"`
		SlotEndHour         int    `json:"slot_end_hour"`
		SlotIntervalMinutes int    `json:"slot_interval_minutes"`
	}
}

func (h *WorkspaceHandler) GetWorkspaceSettings(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-workspace-settings",
		Method:      http.MethodGet,
		Path:        "/workspaces/{id}/settings",
		Summary:     "Get workspace settings",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *GetWorkspaceSettingsInput) (*GetWorkspaceSettingsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if !middleware.WorkspaceScopeAllows(ctx, input.PathID) {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}

		allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, input.PathID, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError(errValidateWorkspaceAccess)
		}
		if !allowed {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}

		var workspace models.Workspace
		err = h.db.NewSelect().Model(&workspace).Where("id = ?", input.PathID).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("workspace not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch workspace")
		}

		return &GetWorkspaceSettingsOutput{Body: struct {
			Name                string `json:"name"`
			AvatarURL           string `json:"avatar_url"`
			Color               string `json:"color"`
			Timezone            string `json:"timezone"`
			WeekStart           int    `json:"week_start"`
			MediaCleanupDays    int    `json:"media_cleanup_days" enum:"14" default:"14" deprecated:"true" doc:"Deprecated compatibility value. Always 14; temporary-media cleanup cannot be configured."`
			RandomDelayMinutes  int    `json:"random_delay_minutes"`
			DraftGapMinutes     int    `json:"draft_gap_minutes"`
			SlotStartHour       int    `json:"slot_start_hour"`
			SlotEndHour         int    `json:"slot_end_hour"`
			SlotIntervalMinutes int    `json:"slot_interval_minutes"`
		}{
			Name:                workspace.Name,
			AvatarURL:           workspace.AvatarURL,
			Color:               normalizedWorkspaceColor(workspace.Color),
			Timezone:            workspace.Timezone,
			WeekStart:           workspace.WeekStart,
			MediaCleanupDays:    medialifecycle.TemporaryIdleDays,
			RandomDelayMinutes:  workspace.RandomDelayMinutes,
			DraftGapMinutes:     workspace.DraftGapMinutes,
			SlotStartHour:       workspace.SlotStartHour,
			SlotEndHour:         workspace.SlotEndHour,
			SlotIntervalMinutes: workspace.SlotIntervalMinutes,
		}}, nil
	})
}

//nolint:gocyclo
func (h *WorkspaceHandler) UpdateWorkspaceSettings(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-workspace-settings",
		Method:      http.MethodPatch,
		Path:        "/workspaces/{id}/settings",
		Summary:     "Update workspace settings",
		Tags:        []string{tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *UpdateWorkspaceSettingsInput) (*UpdateWorkspaceSettingsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, userID); err != nil {
			return nil, err
		}

		var workspace models.Workspace
		err := h.db.NewSelect().Model(&workspace).Where("id = ?", input.PathID).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("workspace not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch workspace")
		}

		if input.Body.Timezone != nil {
			timezone, valid := normalizedWorkspaceTimezone(*input.Body.Timezone)
			if !valid {
				return nil, huma.Error400BadRequest("timezone must be a valid IANA timezone")
			}
			workspace.Timezone = timezone
		}
		if input.Body.Name != nil {
			name := strings.TrimSpace(*input.Body.Name)
			if name == "" {
				return nil, huma.Error400BadRequest("workspace name is required")
			}
			workspace.Name = name
		}
		if input.Body.AvatarURL != nil {
			avatarURL := strings.TrimSpace(*input.Body.AvatarURL)
			if len(avatarURL) > 1000 {
				return nil, huma.Error400BadRequest("avatar_url must be at most 1000 characters")
			}
			workspace.AvatarURL = avatarURL
		}
		if input.Body.Color != nil {
			color, valid := normalizedWorkspaceColorInput(*input.Body.Color)
			if !valid {
				return nil, huma.Error400BadRequest("color must be a six-digit hex value")
			}
			workspace.Color = color
		}
		if input.Body.WeekStart != nil {
			if *input.Body.WeekStart < 0 || *input.Body.WeekStart > 1 {
				return nil, huma.Error400BadRequest("week_start must be 0 (Sunday) or 1 (Monday)")
			}
			workspace.WeekStart = *input.Body.WeekStart
		}
		if input.Body.RandomDelayMinutes != nil {
			if *input.Body.RandomDelayMinutes < 0 || *input.Body.RandomDelayMinutes > 60 {
				return nil, huma.Error400BadRequest("random_delay_minutes must be between 0 and 60")
			}
			workspace.RandomDelayMinutes = *input.Body.RandomDelayMinutes
		}
		if input.Body.DraftGapMinutes != nil {
			if *input.Body.DraftGapMinutes < 0 || *input.Body.DraftGapMinutes > 24*60 {
				return nil, huma.Error400BadRequest("draft_gap_minutes must be between 0 and 1440")
			}
			workspace.DraftGapMinutes = *input.Body.DraftGapMinutes
		}
		if input.Body.SlotStartHour != nil {
			if *input.Body.SlotStartHour < 0 || *input.Body.SlotStartHour > 23 {
				return nil, huma.Error400BadRequest("slot_start_hour must be between 0 and 23")
			}
			workspace.SlotStartHour = *input.Body.SlotStartHour
		}
		if input.Body.SlotEndHour != nil {
			if *input.Body.SlotEndHour < 0 || *input.Body.SlotEndHour > 23 {
				return nil, huma.Error400BadRequest("slot_end_hour must be between 0 and 23")
			}
			workspace.SlotEndHour = *input.Body.SlotEndHour
		}
		if input.Body.SlotIntervalMinutes != nil {
			if *input.Body.SlotIntervalMinutes < 1 || *input.Body.SlotIntervalMinutes > 180 {
				return nil, huma.Error400BadRequest("slot_interval_minutes must be between 1 and 180")
			}
			workspace.SlotIntervalMinutes = *input.Body.SlotIntervalMinutes
		}

		_, err = h.db.NewUpdate().Model(&workspace).
			Column("name", "avatar_url", "color", "timezone", "week_start", "random_delay_minutes", "draft_gap_minutes", "slot_start_hour", "slot_end_hour", "slot_interval_minutes").
			Where("id = ?", input.PathID).
			Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to update workspace")
		}

		return &UpdateWorkspaceSettingsOutput{Body: struct {
			Name                string `json:"name"`
			AvatarURL           string `json:"avatar_url"`
			Color               string `json:"color"`
			Timezone            string `json:"timezone"`
			WeekStart           int    `json:"week_start"`
			MediaCleanupDays    int    `json:"media_cleanup_days" enum:"14" default:"14" deprecated:"true" doc:"Deprecated compatibility value. Always 14; temporary-media cleanup cannot be configured."`
			RandomDelayMinutes  int    `json:"random_delay_minutes"`
			DraftGapMinutes     int    `json:"draft_gap_minutes"`
			SlotStartHour       int    `json:"slot_start_hour"`
			SlotEndHour         int    `json:"slot_end_hour"`
			SlotIntervalMinutes int    `json:"slot_interval_minutes"`
		}{
			Name:                workspace.Name,
			AvatarURL:           workspace.AvatarURL,
			Color:               normalizedWorkspaceColor(workspace.Color),
			Timezone:            workspace.Timezone,
			WeekStart:           workspace.WeekStart,
			MediaCleanupDays:    medialifecycle.TemporaryIdleDays,
			RandomDelayMinutes:  workspace.RandomDelayMinutes,
			DraftGapMinutes:     workspace.DraftGapMinutes,
			SlotStartHour:       workspace.SlotStartHour,
			SlotEndHour:         workspace.SlotEndHour,
			SlotIntervalMinutes: workspace.SlotIntervalMinutes,
		}}, nil
	})
}

func normalizedWorkspaceTimezone(value string) (string, bool) {
	timezone := strings.TrimSpace(value)
	if timezone == "" || timezone == "Local" {
		return "", false
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return "", false
	}
	return timezone, true
}

const defaultWorkspaceColor = "#f97316"

func normalizedWorkspaceColor(value string) string {
	color, valid := normalizedWorkspaceColorInput(value)
	if !valid {
		return defaultWorkspaceColor
	}
	return color
}

func normalizedWorkspaceColorInput(value string) (string, bool) {
	color := strings.ToLower(strings.TrimSpace(value))
	if len(color) != 7 || color[0] != '#' {
		return "", false
	}
	for _, digit := range color[1:] {
		if (digit < '0' || digit > '9') && (digit < 'a' || digit > 'f') {
			return "", false
		}
	}
	return color, true
}
