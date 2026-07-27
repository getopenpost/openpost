package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/queue"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

type WorkspaceHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	entitlement entitlements.Service
	frontendURL string
}

func NewWorkspaceHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement ...entitlements.Service) *WorkspaceHandler {
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if len(entitlement) > 0 && entitlement[0] != nil {
		entitlementService = entitlement[0]
	}
	return &WorkspaceHandler{db: db, auth: authenticator, entitlement: entitlementService}
}

func (h *WorkspaceHandler) SetFrontendURL(frontendURL string) {
	h.frontendURL = strings.TrimRight(strings.TrimSpace(frontendURL), "/")
}

type CreateWorkspaceInput struct {
	Body struct {
		Name           string `json:"name" minLength:"1" maxLength:"100" doc:"Workspace name"`
		OrganizationID string `json:"organization_id,omitempty" doc:"Organization ID. Omit to create a personal organization for this workspace."`
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
	WorkspaceCreatedAt string `json:"created_at"`
	Role               string `json:"role" enum:"admin,editor,viewer" doc:"Current user's workspace role"`
	CanEdit            bool   `json:"can_edit" doc:"Whether the current user can change workspace content"`
}

type ListWorkspacesOutput struct {
	Body []WorkspaceResponse
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
	UserID string `json:"user_id" doc:"User ID"`
	Email  string `json:"email" doc:"User email"`
	Role   string `json:"role" doc:"Workspace role"`
}

type WorkspaceInvitationResponse struct {
	ID               string  `json:"id" doc:"Invitation ID"`
	WorkspaceID      string  `json:"workspace_id" doc:"Workspace ID"`
	Email            string  `json:"email" doc:"Invited email"`
	Role             string  `json:"role" doc:"Workspace role to grant"`
	InvitedByUserID  string  `json:"invited_by_user_id" doc:"Inviting user ID"`
	AcceptedByUserID *string `json:"accepted_by_user_id,omitempty" doc:"Accepting user ID"`
	Token            string  `json:"token,omitempty" doc:"Raw invite token returned once on creation"`
	AcceptURL        string  `json:"accept_url,omitempty" doc:"Browser URL that accepts the invitation"`
	ExpiresAt        string  `json:"expires_at" doc:"Invitation expiry time"`
	AcceptedAt       *string `json:"accepted_at,omitempty" doc:"When the invitation was accepted"`
	RevokedAt        *string `json:"revoked_at,omitempty" doc:"When the invitation was revoked"`
	CreatedAt        string  `json:"created_at" doc:"Invitation creation time"`
}

type WorkspaceTeamOutput struct {
	Body struct {
		Members      []WorkspaceMemberResponse     `json:"members"`
		Invitations  []WorkspaceInvitationResponse `json:"invitations"`
		CurrentSeats int64                         `json:"current_seats"`
	}
}

type WorkspaceTeamInput struct {
	PathID string `path:"id" doc:"Workspace ID"`
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

type AcceptWorkspaceInvitationInput struct {
	Body struct {
		Token string `json:"token" minLength:"16" doc:"Raw invitation token"`
	}
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
	}, func(ctx context.Context, input *CreateWorkspaceInput) (*CreateWorkspaceOutput, error) {
		userID := middleware.GetUserID(ctx)
		if middleware.GetWorkspaceID(ctx) != "" {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}

		organizationID := strings.TrimSpace(input.Body.OrganizationID)
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
			CreatedAt:      now,
		}

		member := &models.WorkspaceMember{
			WorkspaceID: workspace.ID,
			UserID:      userID,
			Role:        models.WorkspaceRoleAdmin,
		}

		err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
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
			if _, err := tx.NewInsert().Model(workspace).Exec(txCtx); err != nil {
				return err
			}
			if _, err := tx.NewInsert().Model(member).Exec(txCtx); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
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
		if _, err := h.requireWorkspaceMember(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}

		members, err := h.listWorkspaceMembers(ctx, input.PathID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace members")
		}
		invitations, err := h.listPendingWorkspaceInvitations(ctx, input.PathID, time.Now().UTC())
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace invitations")
		}

		resp := &WorkspaceTeamOutput{}
		resp.Body.Members = members
		resp.Body.Invitations = workspaceInvitationResponses(invitations, "", "")
		resp.Body.CurrentSeats = int64(len(members) + len(invitations))
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
	}, func(ctx context.Context, _ *struct{}) (*ListOrganizationsOutput, error) {
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
		Errors:        []int{400, 402, 403, 404, 409},
	}, func(ctx context.Context, input *CreateWorkspaceInvitationInput) (*CreateWorkspaceInvitationOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, userID); err != nil {
			return nil, err
		}

		email := normalizeWorkspaceInvitationEmail(input.Body.Email)
		if email == "" {
			return nil, huma.Error400BadRequest("email is required")
		}
		role := strings.TrimSpace(input.Body.Role)
		if role == "" {
			role = models.WorkspaceRoleEditor
		}
		if !isWorkspaceRole(role) {
			return nil, huma.Error400BadRequest("invalid workspace role")
		}

		now := time.Now().UTC()
		if err := h.ensureCanInviteWorkspaceSeat(ctx, input.PathID, email, now); err != nil {
			return nil, err
		}

		token, tokenHash, err := generateWorkspaceInvitationToken()
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to generate invitation token")
		}
		invitation := &models.WorkspaceInvitation{
			ID:              uuid.New().String(),
			WorkspaceID:     input.PathID,
			Email:           email,
			Role:            role,
			InvitedByUserID: userID,
			TokenHash:       tokenHash,
			ExpiresAt:       now.Add(7 * 24 * time.Hour),
			CreatedAt:       now,
		}
		if _, err := h.db.NewInsert().Model(invitation).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to create workspace invitation")
		}

		resp := &CreateWorkspaceInvitationOutput{}
		resp.Body = workspaceInvitationResponse(*invitation, token, h.acceptWorkspaceInvitationURL(token))
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
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *RevokeWorkspaceInvitationInput) (*RevokeWorkspaceInvitationOutput, error) {
		if err := h.requireWorkspaceAdmin(ctx, input.PathID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}

		res, err := h.db.NewUpdate().
			Model((*models.WorkspaceInvitation)(nil)).
			Set("revoked_at = ?", time.Now().UTC()).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", input.InvitationID, input.PathID).
			Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to revoke workspace invitation")
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return nil, huma.Error404NotFound("workspace invitation not found")
		}

		return &RevokeWorkspaceInvitationOutput{Body: struct {
			Revoked bool `json:"revoked"`
		}{Revoked: true}}, nil
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
		userID := middleware.GetUserID(ctx)
		userEmail := normalizeWorkspaceInvitationEmail(middleware.GetUserEmail(ctx))
		tokenHash := hashWorkspaceInvitationToken(input.Body.Token)
		now := time.Now().UTC()

		var invitation models.WorkspaceInvitation
		err := h.db.NewSelect().
			Model(&invitation).
			Where("token_hash = ?", tokenHash).
			Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("workspace invitation not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspace invitation")
		}
		if !middleware.WorkspaceScopeAllows(ctx, invitation.WorkspaceID) {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}
		if !invitation.AcceptedAt.IsZero() {
			return nil, huma.NewError(http.StatusConflict, "workspace invitation already accepted")
		}
		if !invitation.RevokedAt.IsZero() {
			return nil, huma.NewError(http.StatusConflict, "workspace invitation was revoked")
		}
		if !invitation.ExpiresAt.After(now) {
			return nil, huma.NewError(http.StatusConflict, "workspace invitation expired")
		}
		if invitation.Email != userEmail {
			return nil, huma.Error403Forbidden("workspace invitation belongs to a different email address")
		}

		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			member := &models.WorkspaceMember{
				WorkspaceID: invitation.WorkspaceID,
				UserID:      userID,
				Role:        invitation.Role,
			}
			if _, err := tx.NewInsert().
				Model(member).
				On("CONFLICT (workspace_id, user_id) DO NOTHING").
				Exec(txCtx); err != nil {
				return err
			}
			res, err := tx.NewUpdate().
				Model((*models.WorkspaceInvitation)(nil)).
				Set("accepted_by_user_id = ?", userID).
				Set("accepted_at = ?", now).
				Where("id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitation.ID).
				Exec(txCtx)
			if err != nil {
				return err
			}
			affected, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if affected == 0 {
				return sql.ErrNoRows
			}
			return nil
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.NewError(http.StatusConflict, "workspace invitation is no longer pending")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to accept workspace invitation")
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
	})
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
			Where("user_id = ?", userID).
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

func (h *WorkspaceHandler) requireWorkspaceMember(ctx context.Context, workspaceID, userID string) (*models.WorkspaceMember, error) {
	if !middleware.WorkspaceScopeAllows(ctx, workspaceID) {
		return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	var member models.WorkspaceMember
	err := h.db.NewSelect().
		Model(&member).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	if err != nil {
		return nil, huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	return &member, nil
}

func (h *WorkspaceHandler) requireWorkspaceAdmin(ctx context.Context, workspaceID, userID string) error {
	member, err := h.requireWorkspaceMember(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if member.Role != models.WorkspaceRoleAdmin {
		return huma.Error403Forbidden("workspace admin role required")
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
	var member models.OrganizationMember
	err := h.db.NewSelect().
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

func (h *WorkspaceHandler) listWorkspaceMembers(ctx context.Context, workspaceID string) ([]WorkspaceMemberResponse, error) {
	var rows []WorkspaceMemberResponse
	err := h.db.NewSelect().
		Model((*models.WorkspaceMember)(nil)).
		ModelTableExpr("workspace_members AS wm").
		ColumnExpr("wm.user_id, u.email, wm.role").
		Join("JOIN users AS u ON u.id = wm.user_id").
		Where("wm.workspace_id = ?", workspaceID).
		Order("u.email ASC").
		Scan(ctx, &rows)
	return rows, err
}

func (h *WorkspaceHandler) listPendingWorkspaceInvitations(ctx context.Context, workspaceID string, now time.Time) ([]models.WorkspaceInvitation, error) {
	var invitations []models.WorkspaceInvitation
	err := h.db.NewSelect().
		Model(&invitations).
		Where("workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceID, now).
		Order("created_at DESC").
		Scan(ctx)
	return invitations, err
}

func (h *WorkspaceHandler) ensureCanInviteWorkspaceSeat(ctx context.Context, workspaceID, email string, now time.Time) error {
	var existingMemberCount int
	if err := h.db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("workspace_members AS wm").
		Join("JOIN users AS u ON u.id = wm.user_id").
		Where("wm.workspace_id = ? AND u.email = ?", workspaceID, email).
		Scan(ctx, &existingMemberCount); err != nil {
		return huma.Error500InternalServerError("failed to check workspace members")
	}
	if existingMemberCount > 0 {
		return huma.NewError(http.StatusConflict, "user is already a workspace member")
	}

	var pendingForEmail int
	if err := h.db.NewSelect().
		ColumnExpr("COUNT(*)").
		Model((*models.WorkspaceInvitation)(nil)).
		Where("workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceID, email, now).
		Scan(ctx, &pendingForEmail); err != nil {
		return huma.Error500InternalServerError("failed to check workspace invitations")
	}
	if pendingForEmail > 0 {
		return huma.NewError(http.StatusConflict, "workspace invitation already pending")
	}

	var memberCount int
	if err := h.db.NewSelect().
		ColumnExpr("COUNT(*)").
		Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ?", workspaceID).
		Scan(ctx, &memberCount); err != nil {
		return huma.Error500InternalServerError("failed to check team member limit")
	}
	var pendingCount int
	if err := h.db.NewSelect().
		ColumnExpr("COUNT(*)").
		Model((*models.WorkspaceInvitation)(nil)).
		Where("workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceID, now).
		Scan(ctx, &pendingCount); err != nil {
		return huma.Error500InternalServerError("failed to check team member limit")
	}

	decision, err := h.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       entitlements.LimitTeamMembers,
		Current:     int64(memberCount + pendingCount),
		Amount:      1,
	})
	if err != nil {
		return huma.Error500InternalServerError("failed to check team member limit")
	}
	if !decision.Allowed {
		reason := decision.Reason
		if reason == "" {
			reason = "team member limit exceeded"
		}
		return huma.NewError(http.StatusPaymentRequired, reason)
	}
	return nil
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
			Role             string    `bun:"role"`
			CreatedAt        time.Time `bun:"created_at"`
		}
		query := h.db.NewSelect().
			TableExpr("workspaces AS w").
			ColumnExpr("w.id, w.organization_id, w.name, w.avatar_url, w.created_at, wm.role").
			ColumnExpr("COALESCE(o.name, '') AS organization_name").
			Join("JOIN workspace_members AS wm ON wm.workspace_id = w.id").
			Join("LEFT JOIN organizations AS o ON o.id = w.organization_id").
			Where("wm.user_id = ?", userID)
		if workspaceID := middleware.GetWorkspaceID(ctx); workspaceID != "" {
			query = query.Where("w.id = ?", workspaceID)
		}
		err := query.Order("organization_name ASC", "w.name ASC").Scan(ctx, &rows)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspaces")
		}

		resp := &ListWorkspacesOutput{Body: []WorkspaceResponse{}}
		for _, ws := range rows {
			resp.Body = append(resp.Body, WorkspaceResponse{
				WorkspaceID:        ws.ID,
				OrganizationID:     ws.OrganizationID,
				OrganizationName:   ws.OrganizationName,
				WorkspaceName:      ws.Name,
				AvatarURL:          ws.AvatarURL,
				WorkspaceCreatedAt: ws.CreatedAt.Format(time.RFC3339),
				Role:               ws.Role,
				CanEdit:            ws.Role == models.WorkspaceRoleAdmin || ws.Role == models.WorkspaceRoleEditor,
			})
		}
		return resp, nil
	})
}

func workspaceInvitationResponses(invitations []models.WorkspaceInvitation, rawToken, acceptURL string) []WorkspaceInvitationResponse {
	out := make([]WorkspaceInvitationResponse, 0, len(invitations))
	for _, invitation := range invitations {
		out = append(out, workspaceInvitationResponse(invitation, rawToken, acceptURL))
	}
	return out
}

func workspaceInvitationResponse(invitation models.WorkspaceInvitation, rawToken, acceptURL string) WorkspaceInvitationResponse {
	return WorkspaceInvitationResponse{
		ID:               invitation.ID,
		WorkspaceID:      invitation.WorkspaceID,
		Email:            invitation.Email,
		Role:             invitation.Role,
		InvitedByUserID:  invitation.InvitedByUserID,
		AcceptedByUserID: optionalString(invitation.AcceptedByUserID),
		Token:            rawToken,
		AcceptURL:        acceptURL,
		ExpiresAt:        invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AcceptedAt:       optionalTime(invitation.AcceptedAt),
		RevokedAt:        optionalTime(invitation.RevokedAt),
		CreatedAt:        invitation.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func optionalString(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func normalizeWorkspaceInvitationEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

func isWorkspaceRole(role string) bool {
	switch role {
	case models.WorkspaceRoleAdmin, models.WorkspaceRoleEditor, models.WorkspaceRoleViewer:
		return true
	default:
		return false
	}
}

const workspaceInvitationTokenPrefix = "op_inv"

func generateWorkspaceInvitationToken() (string, string, error) {
	secret, err := randomWorkspaceInvitationSecret()
	if err != nil {
		return "", "", err
	}
	token := workspaceInvitationTokenPrefix + "_" + secret
	return token, hashWorkspaceInvitationToken(token), nil
}

func randomWorkspaceInvitationSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashWorkspaceInvitationToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
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
		AvatarURL           string `json:"avatar_url"`
		Timezone            string `json:"timezone"`
		WeekStart           int    `json:"week_start"`
		MediaCleanupDays    int    `json:"media_cleanup_days"`
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
		AvatarURL           *string `json:"avatar_url,omitempty"`
		Timezone            *string `json:"timezone,omitempty"`
		WeekStart           *int    `json:"week_start,omitempty"`
		MediaCleanupDays    *int    `json:"media_cleanup_days,omitempty"`
		RandomDelayMinutes  *int    `json:"random_delay_minutes,omitempty"`
		DraftGapMinutes     *int    `json:"draft_gap_minutes,omitempty"`
		SlotStartHour       *int    `json:"slot_start_hour,omitempty"`
		SlotEndHour         *int    `json:"slot_end_hour,omitempty"`
		SlotIntervalMinutes *int    `json:"slot_interval_minutes,omitempty"`
	}
}

type UpdateWorkspaceSettingsOutput struct {
	Body struct {
		AvatarURL           string `json:"avatar_url"`
		Timezone            string `json:"timezone"`
		WeekStart           int    `json:"week_start"`
		MediaCleanupDays    int    `json:"media_cleanup_days"`
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

		var memberCount int
		memberCount, err := h.db.NewSelect().Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id = ?", input.PathID, userID).
			Count(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError(errValidateWorkspaceAccess)
		}
		if memberCount == 0 {
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
			AvatarURL           string `json:"avatar_url"`
			Timezone            string `json:"timezone"`
			WeekStart           int    `json:"week_start"`
			MediaCleanupDays    int    `json:"media_cleanup_days"`
			RandomDelayMinutes  int    `json:"random_delay_minutes"`
			DraftGapMinutes     int    `json:"draft_gap_minutes"`
			SlotStartHour       int    `json:"slot_start_hour"`
			SlotEndHour         int    `json:"slot_end_hour"`
			SlotIntervalMinutes int    `json:"slot_interval_minutes"`
		}{
			AvatarURL:           workspace.AvatarURL,
			Timezone:            workspace.Timezone,
			WeekStart:           workspace.WeekStart,
			MediaCleanupDays:    workspace.MediaCleanupDays,
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
		if input.Body.AvatarURL != nil {
			avatarURL := strings.TrimSpace(*input.Body.AvatarURL)
			if len(avatarURL) > 1000 {
				return nil, huma.Error400BadRequest("avatar_url must be at most 1000 characters")
			}
			workspace.AvatarURL = avatarURL
		}
		if input.Body.WeekStart != nil {
			if *input.Body.WeekStart < 0 || *input.Body.WeekStart > 1 {
				return nil, huma.Error400BadRequest("week_start must be 0 (Sunday) or 1 (Monday)")
			}
			workspace.WeekStart = *input.Body.WeekStart
		}
		if input.Body.MediaCleanupDays != nil {
			if *input.Body.MediaCleanupDays < 0 || *input.Body.MediaCleanupDays > 365 {
				return nil, huma.Error400BadRequest("media_cleanup_days must be between 0 and 365")
			}
			workspace.MediaCleanupDays = *input.Body.MediaCleanupDays
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
			Column("avatar_url", "timezone", "week_start", "media_cleanup_days", "random_delay_minutes", "draft_gap_minutes", "slot_start_hour", "slot_end_hour", "slot_interval_minutes").
			Where("id = ?", input.PathID).
			Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to update workspace")
		}

		if input.Body.MediaCleanupDays != nil {
			_ = queue.ScheduleMediaCleanup(h.db, input.PathID, workspace.MediaCleanupDays) //nolint:errcheck
		}

		return &UpdateWorkspaceSettingsOutput{Body: struct {
			AvatarURL           string `json:"avatar_url"`
			Timezone            string `json:"timezone"`
			WeekStart           int    `json:"week_start"`
			MediaCleanupDays    int    `json:"media_cleanup_days"`
			RandomDelayMinutes  int    `json:"random_delay_minutes"`
			DraftGapMinutes     int    `json:"draft_gap_minutes"`
			SlotStartHour       int    `json:"slot_start_hour"`
			SlotEndHour         int    `json:"slot_end_hour"`
			SlotIntervalMinutes int    `json:"slot_interval_minutes"`
		}{
			AvatarURL:           workspace.AvatarURL,
			Timezone:            workspace.Timezone,
			WeekStart:           workspace.WeekStart,
			MediaCleanupDays:    workspace.MediaCleanupDays,
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
