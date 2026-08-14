package workspaceteam

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/credentialguard"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

const (
	InvitationTokenPrefix  = "op_inv"
	InvitationLifetime     = 7 * 24 * time.Hour
	InvitationResendDelay  = time.Minute
	InvitationResendLimit  = 5
	InvitationResendWindow = time.Hour

	ActionInvitationCreated  = "invitation.created"
	ActionInvitationResent   = "invitation.resent"
	ActionInvitationRevoked  = "invitation.revoked"
	ActionInvitationAccepted = "invitation.accepted"
	ActionMemberRoleChanged  = "member.role_changed"
	ActionMemberDeactivated  = "member.deactivated"
	ActionMemberReactivated  = "member.reactivated"
	ActionMemberRemoved      = "member.removed"
)

type ErrorKind string

const (
	ErrorNotFound    ErrorKind = "not_found"
	ErrorForbidden   ErrorKind = "forbidden"
	ErrorConflict    ErrorKind = "conflict"
	ErrorPayment     ErrorKind = "payment_required"
	ErrorInvalid     ErrorKind = "invalid"
	ErrorRateLimited ErrorKind = "rate_limited"
)

type LifecycleError struct {
	Kind    ErrorKind
	Message string
	RetryAt time.Time
}

func (e *LifecycleError) Error() string { return e.Message }

func lifecycleError(kind ErrorKind, message string) error {
	return &LifecycleError{Kind: kind, Message: message}
}

func rateLimitError(message string, retryAt time.Time) error {
	return &LifecycleError{Kind: ErrorRateLimited, Message: message, RetryAt: retryAt.UTC()}
}

func RetryAtOf(err error) time.Time {
	var lifecycleErr *LifecycleError
	if errors.As(err, &lifecycleErr) {
		return lifecycleErr.RetryAt
	}
	return time.Time{}
}

func ErrorKindOf(err error) ErrorKind {
	var lifecycleErr *LifecycleError
	if errors.As(err, &lifecycleErr) {
		return lifecycleErr.Kind
	}
	return ""
}

type Service struct {
	db            *bun.DB
	entitlement   entitlements.Service
	notifications *notifications.Service
	now           func() time.Time
}

func NewService(db *bun.DB, entitlement entitlements.Service, notificationService *notifications.Service) *Service {
	if entitlement == nil {
		entitlement = entitlements.NewSelfHostedService()
	}
	return &Service{
		db:            db,
		entitlement:   entitlement,
		notifications: notificationService,
		now:           func() time.Time { return time.Now().UTC() },
	}
}

type Filters struct {
	Query  string
	Role   string
	Status string
}

type Member struct {
	models.WorkspaceMember
	Email string `bun:"email" json:"email"`
}

type Invitation struct {
	models.WorkspaceInvitation
	Status string `bun:"-" json:"status"`
}

type Team struct {
	Members      []Member
	Invitations  []Invitation
	CurrentSeats int64
	CanManage    bool
}

type InviteInput struct {
	WorkspaceID string
	ActorUserID string
	Email       string
	Role        string
}

type UpdateMemberInput struct {
	WorkspaceID   string
	ActorUserID   string
	SubjectUserID string
	Role          string
	Status        string
}

func (s *Service) List(ctx context.Context, workspaceID, userID string, filters Filters) (Team, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	member, err := s.member(ctx, s.db, workspaceID, strings.TrimSpace(userID), true)
	if err != nil {
		return Team{}, err
	}
	filters = normalizeFilters(filters)
	members, err := s.listMembers(ctx, workspaceID, filters)
	if err != nil {
		return Team{}, err
	}

	now := s.now()
	canManage := member.Role == models.WorkspaceRoleAdmin
	invitations, err := s.listInvitations(ctx, workspaceID, filters, now, canManage)
	if err != nil {
		return Team{}, err
	}

	currentSeats, err := s.currentSeats(ctx, s.db, workspaceID, now)
	if err != nil {
		return Team{}, fmt.Errorf("count workspace seats: %w", err)
	}
	return Team{
		Members: members, Invitations: invitations, CurrentSeats: currentSeats,
		CanManage: canManage,
	}, nil
}

func (s *Service) listMembers(ctx context.Context, workspaceID string, filters Filters) ([]Member, error) {
	members := []Member{}
	if !statusIncludesMembers(filters.Status) {
		return members, nil
	}

	query := s.db.NewSelect().
		Model(&members).
		ModelTableExpr("workspace_members AS workspace_member").
		ColumnExpr("workspace_member.*").
		ColumnExpr("u.email").
		Join("JOIN users AS u ON u.id = workspace_member.user_id").
		Where("workspace_member.workspace_id = ?", workspaceID)
	if filters.Status == models.WorkspaceMemberStatusActive || filters.Status == models.WorkspaceMemberStatusInactive {
		query = query.Where("workspace_member.status = ?", filters.Status)
	}
	if filters.Role != "" && filters.Role != "all" {
		query = query.Where("workspace_member.role = ?", filters.Role)
	}
	if filters.Query != "" {
		query = query.Where("LOWER(u.email) LIKE ?", "%"+filters.Query+"%")
	}
	if err := query.OrderExpr("CASE WHEN workspace_member.status = 'active' THEN 0 ELSE 1 END, LOWER(u.email) ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list workspace members: %w", err)
	}
	return members, nil
}

func (s *Service) listInvitations(ctx context.Context, workspaceID string, filters Filters, now time.Time, includeTerminal bool) ([]Invitation, error) {
	rows := []models.WorkspaceInvitation{}
	if !statusIncludesInvitations(filters.Status) {
		return []Invitation{}, nil
	}

	query := s.db.NewSelect().Model(&rows).Where("workspace_id = ?", workspaceID)
	if !includeTerminal {
		query = query.Where("accepted_at IS NULL AND revoked_at IS NULL")
	}
	if filters.Role != "" && filters.Role != "all" {
		query = query.Where("role = ?", filters.Role)
	}
	if filters.Query != "" {
		query = query.Where("LOWER(email) LIKE ?", "%"+filters.Query+"%")
	}
	if err := query.OrderExpr("created_at DESC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list workspace invitations: %w", err)
	}

	invitations := make([]Invitation, 0, len(rows))
	for _, row := range rows {
		if s.notifications != nil {
			deliveryStatus, err := s.notifications.ResolveEmailDeliveryStatus(ctx, row.EmailDeliveryJobID, row.EmailDeliveryStatus)
			if err != nil {
				return nil, fmt.Errorf("resolve workspace invitation email delivery: %w", err)
			}
			row.EmailDeliveryStatus = deliveryStatus
		}
		status := InvitationLifecycleStatus(row, now)
		if !invitationStatusMatchesFilter(status, filters.Status) {
			continue
		}
		invitations = append(invitations, Invitation{WorkspaceInvitation: row, Status: status})
	}
	return invitations, nil
}

func statusIncludesMembers(status string) bool {
	switch status {
	case "", "all", models.WorkspaceMemberStatusActive, models.WorkspaceMemberStatusInactive:
		return true
	default:
		return false
	}
}

func statusIncludesInvitations(status string) bool {
	switch status {
	case "", "all", "pending", "created", "queued", "sent", "delivered", "delivery_failed", "delivery_unavailable", "expired", "revoked", "accepted":
		return true
	default:
		return false
	}
}

func InvitationLifecycleStatus(invitation models.WorkspaceInvitation, now time.Time) string {
	if !invitation.AcceptedAt.IsZero() {
		return "accepted"
	}
	if !invitation.RevokedAt.IsZero() {
		return "revoked"
	}
	if !invitation.ExpiresAt.After(now) {
		return "expired"
	}
	switch invitation.EmailDeliveryStatus {
	case notifications.EmailDeliveryCreated, notifications.EmailDeliveryQueued,
		notifications.EmailDeliverySent, notifications.EmailDeliveryDelivered:
		return invitation.EmailDeliveryStatus
	case notifications.EmailDeliveryFailed:
		return "delivery_failed"
	case notifications.EmailDeliveryUnavailable:
		return "delivery_unavailable"
	default:
		return "created"
	}
}

func invitationStatusMatchesFilter(status, filter string) bool {
	if filter == "" || filter == "all" {
		return true
	}
	if filter == "pending" {
		return status != "expired" && status != "revoked" && status != "accepted"
	}
	return status == filter
}

func (s *Service) Invite(ctx context.Context, input InviteInput) (models.WorkspaceInvitation, string, error) {
	input, err := normalizeInviteInput(input)
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	seatDecision, err := s.seatDecision(ctx, input.WorkspaceID)
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	if !seatDecision.Allowed {
		return models.WorkspaceInvitation{}, "", lifecycleError(ErrorPayment, decisionReason(seatDecision))
	}
	rawToken, tokenHash, err := GenerateInvitationToken()
	if err != nil {
		return models.WorkspaceInvitation{}, "", fmt.Errorf("generate invitation token: %w", err)
	}
	now := s.now()
	invitation := models.WorkspaceInvitation{
		ID: uuid.NewString(), WorkspaceID: input.WorkspaceID, Email: input.Email,
		Role: input.Role, InvitedByUserID: input.ActorUserID, TokenHash: tokenHash,
		ExpiresAt: now.Add(InvitationLifetime), LastSentAt: now, CreatedAt: now,
		EmailDeliveryStatus: notifications.EmailDeliveryCreated,
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return s.createInvitation(txCtx, tx, input, invitation, seatDecision, now)
	})
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	if err := s.finishInvitationDelivery(ctx, &invitation, rawToken, false); err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	return invitation, rawToken, nil
}

func normalizeInviteInput(input InviteInput) (InviteInput, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.Email = NormalizeEmail(input.Email)
	input.Role = strings.TrimSpace(input.Role)
	if input.Email == "" {
		return InviteInput{}, lifecycleError(ErrorInvalid, "email is required")
	}
	if input.Role == "" {
		input.Role = models.WorkspaceRoleEditor
	}
	if !ValidRole(input.Role) {
		return InviteInput{}, lifecycleError(ErrorInvalid, "invalid workspace role")
	}
	return input, nil
}

func (s *Service) createInvitation(
	ctx context.Context,
	tx bun.Tx,
	input InviteInput,
	invitation models.WorkspaceInvitation,
	seatDecision entitlements.Decision,
	now time.Time,
) error {
	if err := s.lockWorkspaceAndRequireAdmin(ctx, tx, input.WorkspaceID, input.ActorUserID); err != nil {
		return err
	}
	if err := revokeExpiredInvitations(ctx, tx, input.WorkspaceID, input.Email, now); err != nil {
		return err
	}
	if err := ensureInvitationAvailable(ctx, tx, input.WorkspaceID, input.Email, now); err != nil {
		return err
	}
	currentSeats, err := s.currentSeats(ctx, tx, input.WorkspaceID, now)
	if err != nil {
		return err
	}
	if !seatAllowed(seatDecision, currentSeats) {
		return lifecycleError(ErrorPayment, seatDecisionReason(seatDecision, currentSeats))
	}
	if _, err := tx.NewInsert().Model(&invitation).Exec(ctx); err != nil {
		return err
	}
	return insertAudit(ctx, tx, models.WorkspaceAccessAuditEvent{
		WorkspaceID: input.WorkspaceID, ActorUserID: input.ActorUserID,
		InvitationID: invitation.ID, SubjectEmail: input.Email,
		Action: ActionInvitationCreated, Role: input.Role, Status: "pending", CreatedAt: now,
	})
}

func revokeExpiredInvitations(ctx context.Context, tx bun.Tx, workspaceID, email string, now time.Time) error {
	_, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
		Set("revoked_at = ?", now).
		Where("workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?", workspaceID, email, now).
		Exec(ctx)
	return err
}

func ensureInvitationAvailable(ctx context.Context, db bun.IDB, workspaceID, email string, now time.Time) error {
	memberCount, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id IN (SELECT id FROM users WHERE LOWER(email) = ?)", workspaceID, email).
		Count(ctx)
	if err != nil {
		return err
	}
	if memberCount > 0 {
		return lifecycleError(ErrorConflict, "user is already a workspace member")
	}

	pendingCount, err := db.NewSelect().Model((*models.WorkspaceInvitation)(nil)).
		Where("workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceID, email, now).
		Count(ctx)
	if err != nil {
		return err
	}
	if pendingCount > 0 {
		return lifecycleError(ErrorConflict, "workspace invitation already pending")
	}
	return nil
}

func (s *Service) ResendInvitation(ctx context.Context, workspaceID, invitationID, actorUserID string) (models.WorkspaceInvitation, string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	actorUserID = strings.TrimSpace(actorUserID)
	seatDecision, err := s.seatDecision(ctx, workspaceID)
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	rawToken, tokenHash, err := GenerateInvitationToken()
	if err != nil {
		return models.WorkspaceInvitation{}, "", fmt.Errorf("generate invitation token: %w", err)
	}
	now := s.now()
	invitation, err := s.rotateInvitation(ctx, workspaceID, invitationID, actorUserID, tokenHash, seatDecision, now)
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	if err := s.finishInvitationDelivery(ctx, &invitation, rawToken, true); err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	return invitation, rawToken, nil
}

func (s *Service) rotateInvitation(
	ctx context.Context,
	workspaceID string,
	invitationID string,
	actorUserID string,
	tokenHash string,
	seatDecision entitlements.Decision,
	now time.Time,
) (models.WorkspaceInvitation, error) {
	var invitation models.WorkspaceInvitation
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, workspaceID, actorUserID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(&invitation).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID, workspaceID).
			Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return lifecycleError(ErrorNotFound, "workspace invitation not found")
		} else if err != nil {
			return err
		}
		retryAt := invitation.LastSentAt.Add(InvitationResendDelay)
		if !invitation.LastSentAt.IsZero() && retryAt.After(now) {
			return rateLimitError("invitation can be resent after "+retryAt.Format(time.RFC3339), retryAt)
		}
		if err := enforceInvitationResendLimit(txCtx, tx, invitation, actorUserID, now); err != nil {
			return err
		}
		// A still-pending invitation already reserves its seat. Resending an
		// expired invitation makes it pending again, so reserve that seat under
		// the same workspace lock used by invites and member reactivation.
		if !invitation.ExpiresAt.After(now) {
			currentSeats, err := s.currentSeats(txCtx, tx, workspaceID, now)
			if err != nil {
				return err
			}
			if !seatAllowed(seatDecision, currentSeats) {
				return lifecycleError(ErrorPayment, seatDecisionReason(seatDecision, currentSeats))
			}
		}
		previousTokenHash := invitation.TokenHash
		invitation.TokenHash = tokenHash
		invitation.ExpiresAt = now.Add(InvitationLifetime)
		invitation.LastSentAt = now
		invitation.InvitedByUserID = actorUserID
		invitation.EmailDeliveryStatus = notifications.EmailDeliveryCreated
		invitation.EmailDeliveryJobID = ""
		invitation.EmailDeliveryUpdatedAt = time.Time{}
		result, err := tx.NewUpdate().Model(&invitation).
			Column("token_hash", "expires_at", "last_sent_at", "invited_by_user_id", "email_delivery_status", "email_delivery_job_id", "email_delivery_updated_at").
			WherePK().Where("token_hash = ?", previousTokenHash).Exec(txCtx)
		if err != nil {
			return err
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if updated != 1 {
			return rateLimitError("invitation resend is already in progress; try again after "+now.Add(InvitationResendDelay).Format(time.RFC3339), now.Add(InvitationResendDelay))
		}
		if _, err := tx.NewInsert().Model(&models.WorkspaceInvitationResend{
			ID: uuid.NewString(), InvitationID: invitation.ID, ActorUserID: actorUserID, ResentAt: now,
		}).Exec(txCtx); err != nil {
			return err
		}
		return insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: workspaceID, ActorUserID: actorUserID, InvitationID: invitation.ID,
			SubjectEmail: invitation.Email, Action: ActionInvitationResent,
			Role: invitation.Role, Status: "pending", CreatedAt: now,
		})
	})
	if err != nil {
		return models.WorkspaceInvitation{}, err
	}
	return invitation, nil
}

func enforceInvitationResendLimit(
	ctx context.Context,
	db bun.IDB,
	invitation models.WorkspaceInvitation,
	actorUserID string,
	now time.Time,
) error {
	windowStart := now.Add(-InvitationResendWindow)
	if _, err := db.NewDelete().Model((*models.WorkspaceInvitationResend)(nil)).
		Where("invitation_id = ? AND actor_user_id = ? AND resent_at <= ?", invitation.ID, actorUserID, windowStart).
		Exec(ctx); err != nil {
		return err
	}
	recent := []models.WorkspaceInvitationResend{}
	err := db.NewSelect().Model(&recent).
		Where("invitation_id = ? AND actor_user_id = ? AND resent_at > ?", invitation.ID, actorUserID, windowStart).
		Order("resent_at ASC").
		Limit(InvitationResendLimit).
		Scan(ctx)
	if err != nil {
		return err
	}
	if len(recent) < InvitationResendLimit {
		return nil
	}
	retryAt := recent[0].ResentAt.Add(InvitationResendWindow)
	return rateLimitError("invitation resend limit reached; try again after "+retryAt.Format(time.RFC3339), retryAt)
}

func (s *Service) RevokeInvitation(ctx context.Context, workspaceID, invitationID, actorUserID string) error {
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, workspaceID, actorUserID); err != nil {
			return err
		}
		var invitation models.WorkspaceInvitation
		if err := tx.NewSelect().Model(&invitation).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID, workspaceID).
			Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return lifecycleError(ErrorNotFound, "workspace invitation not found")
		} else if err != nil {
			return err
		}
		result, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).Set("revoked_at = ?", now).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID, workspaceID).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return lifecycleError(ErrorConflict, "workspace invitation is no longer pending")
		}
		return insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: workspaceID, ActorUserID: actorUserID, InvitationID: invitation.ID,
			SubjectEmail: invitation.Email, Action: ActionInvitationRevoked,
			Role: invitation.Role, PreviousStatus: "pending", Status: "revoked", CreatedAt: now,
		})
	})
}

func (s *Service) FindInvitationByToken(ctx context.Context, token string) (models.WorkspaceInvitation, error) {
	var invitation models.WorkspaceInvitation
	err := s.db.NewSelect().Model(&invitation).Where("token_hash = ?", HashInvitationToken(token)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceInvitation{}, lifecycleError(ErrorNotFound, "workspace invitation not found")
	}
	return invitation, err
}

func (s *Service) FindInvitationByID(ctx context.Context, invitationID string) (models.WorkspaceInvitation, error) {
	var invitation models.WorkspaceInvitation
	err := s.db.NewSelect().Model(&invitation).Where("id = ?", strings.TrimSpace(invitationID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceInvitation{}, lifecycleError(ErrorNotFound, "workspace invitation not found")
	}
	return invitation, err
}

func (s *Service) AcceptInvitation(ctx context.Context, invitation models.WorkspaceInvitation, userID string) error {
	userID = strings.TrimSpace(userID)
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return s.acceptInvitation(txCtx, tx, invitation, userID, now)
	})
}

func (s *Service) acceptInvitation(ctx context.Context, tx bun.Tx, invitation models.WorkspaceInvitation, userID string, now time.Time) error {
	if err := lockWorkspace(ctx, tx, invitation.WorkspaceID); err != nil {
		return err
	}
	user, err := credentialguard.LockUserMutation(ctx, tx, userID)
	if err != nil {
		return err
	}
	if err := reloadInvitation(ctx, tx, &invitation); err != nil {
		return err
	}
	if err := validateInvitationAcceptance(invitation, NormalizeEmail(user.Email), now); err != nil {
		return err
	}
	if err := ensureNotWorkspaceMember(ctx, tx, invitation.WorkspaceID, userID); err != nil {
		return err
	}
	if err := createAcceptedMemberships(ctx, tx, invitation, userID, now); err != nil {
		return err
	}
	if err := markInvitationAccepted(ctx, tx, invitation.ID, userID, now); err != nil {
		return err
	}
	return insertAudit(ctx, tx, models.WorkspaceAccessAuditEvent{
		WorkspaceID: invitation.WorkspaceID, ActorUserID: userID, SubjectUserID: userID,
		InvitationID: invitation.ID, SubjectEmail: invitation.Email,
		Action: ActionInvitationAccepted, Role: invitation.Role,
		PreviousStatus: "pending", Status: models.WorkspaceMemberStatusActive, CreatedAt: now,
	})
}

func reloadInvitation(ctx context.Context, db bun.IDB, invitation *models.WorkspaceInvitation) error {
	err := db.NewSelect().Model(invitation).Where("id = ?", invitation.ID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return lifecycleError(ErrorNotFound, "workspace invitation not found")
	}
	return err
}

func validateInvitationAcceptance(invitation models.WorkspaceInvitation, userEmail string, now time.Time) error {
	if !invitation.AcceptedAt.IsZero() {
		return lifecycleError(ErrorConflict, "workspace invitation already accepted")
	}
	if !invitation.RevokedAt.IsZero() {
		return lifecycleError(ErrorConflict, "workspace invitation was revoked")
	}
	if !invitation.ExpiresAt.After(now) {
		return lifecycleError(ErrorConflict, "workspace invitation expired")
	}
	if invitation.Email != userEmail {
		return lifecycleError(ErrorForbidden, "workspace invitation belongs to a different email address")
	}
	return nil
}

func ensureNotWorkspaceMember(ctx context.Context, db bun.IDB, workspaceID, userID string) error {
	existing, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(ctx)
	if err != nil {
		return err
	}
	if existing > 0 {
		return lifecycleError(ErrorConflict, "user is already a workspace member")
	}
	return nil
}

func createAcceptedMemberships(ctx context.Context, tx bun.Tx, invitation models.WorkspaceInvitation, userID string, now time.Time) error {
	member := &models.WorkspaceMember{
		WorkspaceID: invitation.WorkspaceID, UserID: userID, Role: invitation.Role,
		Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if _, err := tx.NewInsert().Model(member).Exec(ctx); err != nil {
		return err
	}

	var workspace models.Workspace
	if err := tx.NewSelect().Model(&workspace).Column("id", "organization_id").Where("id = ?", invitation.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	organizationMember := &models.OrganizationMember{
		OrganizationID: workspace.OrganizationID, UserID: userID,
		Role: models.OrganizationRoleMember, CreatedAt: now,
	}
	_, err := tx.NewInsert().Model(organizationMember).On("CONFLICT (organization_id, user_id) DO NOTHING").Exec(ctx)
	return err
}

func markInvitationAccepted(ctx context.Context, tx bun.Tx, invitationID, userID string, now time.Time) error {
	result, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
		Set("accepted_by_user_id = ?", userID).Set("accepted_at = ?", now).
		Where("id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID).Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return lifecycleError(ErrorConflict, "workspace invitation is no longer pending")
	}
	return nil
}

func (s *Service) UpdateMember(ctx context.Context, input UpdateMemberInput) (Member, error) {
	input, err := normalizeUpdateMemberInput(input)
	if err != nil {
		return Member{}, err
	}
	seatDecision, err := s.memberActivationDecision(ctx, input)
	if err != nil {
		return Member{}, err
	}
	now := s.now()
	var updated Member
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var updateErr error
		updated, updateErr = s.updateMember(txCtx, tx, input, seatDecision, now)
		return updateErr
	})
	return updated, err
}

func normalizeUpdateMemberInput(input UpdateMemberInput) (UpdateMemberInput, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.SubjectUserID = strings.TrimSpace(input.SubjectUserID)
	input.Role = strings.TrimSpace(input.Role)
	input.Status = strings.TrimSpace(input.Status)
	if input.Role == "" && input.Status == "" {
		return UpdateMemberInput{}, lifecycleError(ErrorInvalid, "role or status is required")
	}
	if input.Role != "" && !ValidRole(input.Role) {
		return UpdateMemberInput{}, lifecycleError(ErrorInvalid, "invalid workspace role")
	}
	if input.Status != "" && input.Status != models.WorkspaceMemberStatusActive && input.Status != models.WorkspaceMemberStatusInactive {
		return UpdateMemberInput{}, lifecycleError(ErrorInvalid, "invalid workspace member status")
	}
	return input, nil
}

func (s *Service) memberActivationDecision(ctx context.Context, input UpdateMemberInput) (entitlements.Decision, error) {
	if input.Status != models.WorkspaceMemberStatusActive {
		return entitlements.Decision{}, nil
	}
	decision, err := s.seatDecision(ctx, input.WorkspaceID)
	if err != nil {
		return entitlements.Decision{}, err
	}
	if !decision.Allowed {
		return entitlements.Decision{}, lifecycleError(ErrorPayment, decisionReason(decision))
	}
	return decision, nil
}

func (s *Service) updateMember(
	ctx context.Context,
	tx bun.Tx,
	input UpdateMemberInput,
	seatDecision entitlements.Decision,
	now time.Time,
) (Member, error) {
	if err := s.lockWorkspaceAndRequireAdmin(ctx, tx, input.WorkspaceID, input.ActorUserID); err != nil {
		return Member{}, err
	}
	member, err := s.memberForUpdate(ctx, tx, input)
	if err != nil {
		return Member{}, err
	}
	userEmail, err := memberEmail(ctx, tx, input.SubjectUserID)
	if err != nil {
		return Member{}, err
	}
	newRole, newStatus := requestedMemberState(member, input)
	if err := s.validateMemberStateChange(ctx, tx, input, member, newRole, newStatus, seatDecision, now); err != nil {
		return Member{}, err
	}
	if newRole == member.Role && newStatus == member.Status {
		return Member{WorkspaceMember: member, Email: userEmail}, nil
	}
	deactivatedAt := updatedDeactivatedAt(member, newStatus, now)
	if err := persistMemberState(ctx, tx, input, member, newRole, newStatus, deactivatedAt, now); err != nil {
		return Member{}, err
	}
	if err := auditMemberStateChanges(ctx, tx, input, member, userEmail, newRole, newStatus, now); err != nil {
		return Member{}, err
	}
	member.Role = newRole
	member.Status = newStatus
	member.UpdatedAt = now
	member.DeactivatedAt = deactivatedAt
	return Member{WorkspaceMember: member, Email: userEmail}, nil
}

func (s *Service) memberForUpdate(ctx context.Context, db bun.IDB, input UpdateMemberInput) (models.WorkspaceMember, error) {
	member, err := s.member(ctx, db, input.WorkspaceID, input.SubjectUserID, false)
	if ErrorKindOf(err) == ErrorForbidden {
		return models.WorkspaceMember{}, lifecycleError(ErrorNotFound, "workspace member not found")
	}
	return member, err
}

func memberEmail(ctx context.Context, db bun.IDB, userID string) (string, error) {
	var user models.User
	if err := db.NewSelect().Model(&user).Column("id", "email").Where("id = ?", userID).Scan(ctx); err != nil {
		return "", err
	}
	return user.Email, nil
}

func requestedMemberState(member models.WorkspaceMember, input UpdateMemberInput) (string, string) {
	role := member.Role
	if input.Role != "" {
		role = input.Role
	}
	status := member.Status
	if input.Status != "" {
		status = input.Status
	}
	return role, status
}

func (s *Service) validateMemberStateChange(
	ctx context.Context,
	tx bun.Tx,
	input UpdateMemberInput,
	member models.WorkspaceMember,
	newRole string,
	newStatus string,
	seatDecision entitlements.Decision,
	now time.Time,
) error {
	removesActiveAdmin := member.Role == models.WorkspaceRoleAdmin &&
		member.Status == models.WorkspaceMemberStatusActive &&
		(newRole != models.WorkspaceRoleAdmin || newStatus != models.WorkspaceMemberStatusActive)
	if removesActiveAdmin {
		if err := s.requireAnotherActiveAdmin(ctx, tx, input.WorkspaceID, input.SubjectUserID); err != nil {
			return err
		}
	}
	if member.Status != models.WorkspaceMemberStatusInactive || newStatus != models.WorkspaceMemberStatusActive {
		return nil
	}
	currentSeats, err := s.currentSeats(ctx, tx, input.WorkspaceID, now)
	if err != nil {
		return err
	}
	if !seatAllowed(seatDecision, currentSeats) {
		return lifecycleError(ErrorPayment, seatDecisionReason(seatDecision, currentSeats))
	}
	return nil
}

func updatedDeactivatedAt(member models.WorkspaceMember, newStatus string, now time.Time) time.Time {
	if member.Status == newStatus {
		return member.DeactivatedAt
	}
	if newStatus == models.WorkspaceMemberStatusInactive {
		return now
	}
	return time.Time{}
}

func persistMemberState(
	ctx context.Context,
	tx bun.Tx,
	input UpdateMemberInput,
	member models.WorkspaceMember,
	newRole string,
	newStatus string,
	deactivatedAt time.Time,
	now time.Time,
) error {
	result, err := tx.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", newRole).Set("status = ?", newStatus).Set("updated_at = ?", now).
		Set("deactivated_at = ?", nullTime(deactivatedAt)).
		Where("workspace_id = ? AND user_id = ? AND role = ? AND status = ?", input.WorkspaceID, input.SubjectUserID, member.Role, member.Status).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return lifecycleError(ErrorConflict, "workspace member changed; reload and try again")
	}
	return nil
}

func auditMemberStateChanges(
	ctx context.Context,
	db bun.IDB,
	input UpdateMemberInput,
	member models.WorkspaceMember,
	userEmail string,
	newRole string,
	newStatus string,
	now time.Time,
) error {
	if member.Role != newRole {
		if err := insertAudit(ctx, db, models.WorkspaceAccessAuditEvent{
			WorkspaceID: input.WorkspaceID, ActorUserID: input.ActorUserID, SubjectUserID: input.SubjectUserID,
			SubjectEmail: userEmail, Action: ActionMemberRoleChanged,
			PreviousRole: member.Role, Role: newRole, Status: newStatus, CreatedAt: now,
		}); err != nil {
			return err
		}
	}
	if member.Status == newStatus {
		return nil
	}
	action := ActionMemberDeactivated
	if newStatus == models.WorkspaceMemberStatusActive {
		action = ActionMemberReactivated
	}
	return insertAudit(ctx, db, models.WorkspaceAccessAuditEvent{
		WorkspaceID: input.WorkspaceID, ActorUserID: input.ActorUserID, SubjectUserID: input.SubjectUserID,
		SubjectEmail: userEmail, Action: action, Role: newRole,
		PreviousStatus: member.Status, Status: newStatus, CreatedAt: now,
	})
}

func (s *Service) RemoveMember(ctx context.Context, workspaceID, subjectUserID, actorUserID string) error {
	workspaceID = strings.TrimSpace(workspaceID)
	subjectUserID = strings.TrimSpace(subjectUserID)
	actorUserID = strings.TrimSpace(actorUserID)
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, workspaceID, actorUserID); err != nil {
			return err
		}
		member, err := s.member(txCtx, tx, workspaceID, subjectUserID, false)
		if err != nil {
			if ErrorKindOf(err) == ErrorForbidden {
				return lifecycleError(ErrorNotFound, "workspace member not found")
			}
			return err
		}
		if member.Role == models.WorkspaceRoleAdmin && member.Status == models.WorkspaceMemberStatusActive {
			if err := s.requireAnotherActiveAdmin(txCtx, tx, workspaceID, subjectUserID); err != nil {
				return err
			}
		}
		var user models.User
		if err := tx.NewSelect().Model(&user).Column("id", "email").Where("id = ?", subjectUserID).Scan(txCtx); err != nil {
			return err
		}
		result, err := tx.NewDelete().Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id = ?", workspaceID, subjectUserID).Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return lifecycleError(ErrorNotFound, "workspace member not found")
		}
		return insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: workspaceID, ActorUserID: actorUserID, SubjectUserID: subjectUserID,
			SubjectEmail: user.Email, Action: ActionMemberRemoved,
			PreviousRole: member.Role, Role: member.Role,
			PreviousStatus: member.Status, Status: "removed", CreatedAt: now,
		})
	})
}

func (s *Service) ListAudit(ctx context.Context, workspaceID, actorUserID string, limit int) ([]models.WorkspaceAccessAuditEvent, error) {
	member, err := s.member(ctx, s.db, workspaceID, actorUserID, true)
	if err != nil {
		return nil, err
	}
	if member.Role != models.WorkspaceRoleAdmin {
		return nil, lifecycleError(ErrorForbidden, "workspace admin role required")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	events := []models.WorkspaceAccessAuditEvent{}
	err = s.db.NewSelect().Model(&events).Where("workspace_id = ?", workspaceID).
		OrderExpr("created_at DESC, id DESC").Limit(limit).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return events, nil
	}
	return events, err
}

func (s *Service) member(ctx context.Context, db bun.IDB, workspaceID, userID string, activeOnly bool) (models.WorkspaceMember, error) {
	var member models.WorkspaceMember
	query := db.NewSelect().Model(&member).Where("workspace_id = ? AND user_id = ?", workspaceID, userID)
	if activeOnly {
		query = query.Where("status = ?", models.WorkspaceMemberStatusActive)
	}
	if err := query.Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceMember{}, lifecycleError(ErrorForbidden, "workspace not accessible")
	} else if err != nil {
		return models.WorkspaceMember{}, err
	}
	return member, nil
}

func (s *Service) lockWorkspaceAndRequireAdmin(ctx context.Context, tx bun.Tx, workspaceID, actorUserID string) error {
	if err := lockWorkspace(ctx, tx, workspaceID); err != nil {
		return err
	}
	member, err := s.member(ctx, tx, workspaceID, actorUserID, true)
	if err != nil {
		return err
	}
	if member.Role != models.WorkspaceRoleAdmin {
		return lifecycleError(ErrorForbidden, "workspace admin role required")
	}
	return nil
}

func lockWorkspace(ctx context.Context, tx bun.Tx, workspaceID string) error {
	result, err := tx.NewUpdate().Model((*models.Workspace)(nil)).Set("name = name").Where("id = ?", workspaceID).Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return lifecycleError(ErrorNotFound, "workspace not found")
	}
	return nil
}

func (s *Service) requireAnotherActiveAdmin(ctx context.Context, db bun.IDB, workspaceID, excludedUserID string) error {
	count, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id != ? AND role = ? AND status = ?", workspaceID, excludedUserID, models.WorkspaceRoleAdmin, models.WorkspaceMemberStatusActive).
		Count(ctx)
	if err != nil {
		return err
	}
	if count == 0 {
		return lifecycleError(ErrorConflict, "the workspace must keep at least one active administrator")
	}
	return nil
}

func (s *Service) currentSeats(ctx context.Context, db bun.IDB, workspaceID string, now time.Time) (int64, error) {
	activeMembers, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND status = ?", workspaceID, models.WorkspaceMemberStatusActive).Count(ctx)
	if err != nil {
		return 0, err
	}
	pendingInvites, err := db.NewSelect().Model((*models.WorkspaceInvitation)(nil)).
		Where("workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceID, now).Count(ctx)
	if err != nil {
		return 0, err
	}
	return int64(activeMembers + pendingInvites), nil
}

func (s *Service) seatDecision(ctx context.Context, workspaceID string) (entitlements.Decision, error) {
	decision, err := s.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID, Limit: entitlements.LimitTeamMembers, Current: 0, Amount: 1,
	})
	if err != nil {
		return entitlements.Decision{}, fmt.Errorf("check team member limit: %w", err)
	}
	return decision, nil
}

func seatAllowed(decision entitlements.Decision, current int64) bool {
	return decision.Allowed && (decision.Unlimited || current+1 <= decision.Limit)
}

func decisionReason(decision entitlements.Decision) string {
	if strings.TrimSpace(decision.Reason) != "" {
		return decision.Reason
	}
	return "team member limit exceeded"
}

func seatDecisionReason(decision entitlements.Decision, current int64) string {
	if strings.TrimSpace(decision.Reason) != "" {
		return decision.Reason
	}
	if !decision.Unlimited && decision.Limit >= 0 {
		return fmt.Sprintf("team_members limit exceeded: current %d + requested 1 > limit %d", current, decision.Limit)
	}
	return "team member limit exceeded"
}

func insertAudit(ctx context.Context, db bun.IDB, event models.WorkspaceAccessAuditEvent) error {
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	_, err := db.NewInsert().Model(&event).Exec(ctx)
	return err
}

func (s *Service) finishInvitationDelivery(ctx context.Context, invitation *models.WorkspaceInvitation, rawToken string, resent bool) error {
	status := notifications.EmailDeliveryUnavailable
	jobID := ""
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if s.notifications == nil {
			return s.updateInvitationDelivery(txCtx, tx, invitation, status, jobID)
		}
		var workspace models.Workspace
		var inviter models.User
		workspaceErr := tx.NewSelect().Model(&workspace).Column("id", "name").Where("id = ?", invitation.WorkspaceID).Scan(txCtx)
		inviterErr := tx.NewSelect().Model(&inviter).Column("id", "email", "display_name").Where("id = ?", invitation.InvitedByUserID).Scan(txCtx)
		if workspaceErr != nil || inviterErr != nil {
			status = notifications.EmailDeliveryFailed
		} else {
			inviterName := strings.TrimSpace(inviter.DisplayName)
			if inviterName == "" {
				inviterName = inviter.Email
			}
			if _, err := tx.ExecContext(txCtx, "SAVEPOINT workspace_invitation_email_enqueue"); err != nil {
				return fmt.Errorf("start workspace invitation email enqueue: %w", err)
			}
			delivery, err := s.notifications.EnqueueWorkspaceInvitationTx(txCtx, tx, notifications.WorkspaceInvitationEmailInput{
				InvitationID:  invitation.ID,
				Recipient:     invitation.Email,
				WorkspaceName: workspace.Name,
				InviterName:   inviterName,
				Role:          invitation.Role,
				ExpiresAt:     invitation.ExpiresAt,
				RawToken:      rawToken,
				DeliveryKey:   invitation.ID + ":" + invitation.TokenHash,
			})
			status, jobID = delivery.Status, delivery.JobID
			if err != nil {
				if _, rollbackErr := tx.ExecContext(txCtx, "ROLLBACK TO SAVEPOINT workspace_invitation_email_enqueue"); rollbackErr != nil {
					return fmt.Errorf("roll back workspace invitation email enqueue: %w", rollbackErr)
				}
				status, jobID = notifications.EmailDeliveryFailed, ""
			}
			if _, err := tx.ExecContext(txCtx, "RELEASE SAVEPOINT workspace_invitation_email_enqueue"); err != nil {
				return fmt.Errorf("finish workspace invitation email enqueue: %w", err)
			}
		}
		return s.updateInvitationDelivery(txCtx, tx, invitation, status, jobID)
	})
	if err != nil {
		return err
	}
	invitation.EmailDeliveryStatus = status
	invitation.EmailDeliveryJobID = jobID
	_ = s.notifyInvitation(ctx, *invitation, resent)
	return nil
}

func (s *Service) updateInvitationDelivery(
	ctx context.Context,
	db bun.IDB,
	invitation *models.WorkspaceInvitation,
	status string,
	jobID string,
) error {
	result, err := db.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
		Set("email_delivery_status = ?", status).
		Set("email_delivery_job_id = ?", jobID).
		Where("id = ? AND token_hash = ?", invitation.ID, invitation.TokenHash).Exec(ctx)
	if err != nil {
		return fmt.Errorf("persist workspace invitation delivery state: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read workspace invitation delivery update: %w", err)
	}
	if updated != 1 {
		return lifecycleError(ErrorConflict, "invitation was resent again")
	}
	return nil
}

func (s *Service) notifyInvitation(ctx context.Context, invitation models.WorkspaceInvitation, resent bool) error {
	if s.notifications == nil {
		return nil
	}
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("LOWER(email) = ?", invitation.Email).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	var workspace models.Workspace
	if err := s.db.NewSelect().Model(&workspace).Column("id", "name").Where("id = ?", invitation.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	dedupKey := "workspace-invitation:" + invitation.ID
	if resent {
		dedupKey += ":" + invitation.LastSentAt.UTC().Format(time.RFC3339Nano)
	}
	return s.notifications.Create(ctx, notifications.CreateInput{
		// The invitee does not have workspace access yet, so this notification
		// must remain visible outside any workspace-scoped notification feed.
		UserID: user.ID,
		Type:   notifications.TypeWorkspaceInvite, Title: "Workspace invitation",
		Body: "You were invited to " + workspace.Name + ".",
		Href: "/invite?id=" + invitation.ID, DedupKey: dedupKey,
		Actions:       []models.NotificationAction{{Label: "Review invitation", Href: "/invite?id=" + invitation.ID, Kind: "primary"}},
		SuppressEmail: true,
	})
}

func normalizeFilters(filters Filters) Filters {
	filters.Query = NormalizeEmail(filters.Query)
	filters.Role = strings.ToLower(strings.TrimSpace(filters.Role))
	filters.Status = strings.ToLower(strings.TrimSpace(filters.Status))
	return filters
}

func NormalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func ValidRole(role string) bool {
	switch role {
	case models.WorkspaceRoleAdmin, models.WorkspaceRoleEditor, models.WorkspaceRoleViewer:
		return true
	default:
		return false
	}
}

func GenerateInvitationToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(buf)
	token := InvitationTokenPrefix + "_" + secret
	return token, HashInvitationToken(token), nil
}

func HashInvitationToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func nullTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}
