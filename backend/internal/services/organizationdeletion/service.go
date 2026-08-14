package organizationdeletion

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/workspacedeletion"
	"github.com/uptrace/bun"
)

const ReauthAction = "organization.delete"

type ErrorKind string

const (
	ErrorInvalid   ErrorKind = "invalid"
	ErrorAuth      ErrorKind = "auth"
	ErrorForbidden ErrorKind = "forbidden"
	ErrorNotFound  ErrorKind = "not_found"
	ErrorConflict  ErrorKind = "conflict"
)

type UseCaseError struct {
	Kind    ErrorKind
	Message string
}

func (e *UseCaseError) Error() string { return e.Message }

type Actor struct{ UserID, SessionID, TokenID, WorkspaceBindingID string }
type Confirmation struct{ CanonicalName, CurrentPassword, ReauthGrant string }
type Blocker struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Workspace struct {
	ID   string `json:"workspace_id"`
	Name string `json:"workspace_name"`
}
type Preview struct {
	OrganizationID   string                        `json:"organization_id"`
	OrganizationName string                        `json:"organization_name"`
	Workspaces       []Workspace                   `json:"workspaces"`
	BillingState     string                        `json:"billing_state"`
	PendingWork      workspacedeletion.PendingWork `json:"pending_work"`
	AccessEffects    []string                      `json:"access_effects"`
	Retained         []string                      `json:"retained"`
	IrreversibleLoss []string                      `json:"irreversible_loss"`
	RecoveryPossible bool                          `json:"recovery_possible"`
	Blockers         []Blocker                     `json:"blockers"`
}

type Service struct {
	db        *bun.DB
	auth      *auth.Service
	identity  *identity.Service
	now       func() time.Time
	decryptor workspacedeletion.AcceptURLDecryptor
}

func NewService(db *bun.DB, authService *auth.Service, identityService *identity.Service, decryptors ...workspacedeletion.AcceptURLDecryptor) *Service {
	service := &Service{db: db, auth: authService, identity: identityService, now: func() time.Time { return time.Now().UTC() }}
	if len(decryptors) > 0 {
		service.decryptor = decryptors[0]
	}
	return service
}

func (s *Service) Preview(ctx context.Context, organizationID string, actor Actor) (Preview, error) {
	organization, err := s.authorizeOwner(ctx, s.db, organizationID, actor)
	if err != nil {
		return Preview{}, err
	}
	return s.preview(ctx, s.db, organization)
}

func (s *Service) CancelPendingCheckouts(ctx context.Context, organizationID string, actor Actor) (int64, error) {
	if _, err := s.authorizeOwner(ctx, s.db, organizationID, actor); err != nil {
		return 0, err
	}
	var canceled int64
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.Organization)(nil)).Set("name = name").Where("id = ?", organizationID).Exec(txCtx)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return &UseCaseError{Kind: ErrorNotFound, Message: "Organization not found"}
		}
		if _, err := loadCurrentOwner(txCtx, tx, organizationID, actor.UserID); err != nil {
			return err
		}
		var attempts []models.BillingCheckoutAttempt
		if err := tx.NewSelect().Model(&attempts).
			Where("organization_id = ? AND status = ? AND provider_subscription_id = ''", organizationID, "created").
			Scan(txCtx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		for _, attempt := range attempts {
			boundary := &models.BillingCheckoutCancellation{
				CheckoutAttemptID: attempt.CheckoutAttemptID, OrganizationID: organizationID,
				Provider: attempt.Provider, CanceledAt: s.now().UTC(),
			}
			if _, err := tx.NewInsert().Model(boundary).On("CONFLICT DO NOTHING").Exec(txCtx); err != nil {
				return err
			}
		}
		result, err = tx.NewUpdate().Model((*models.BillingCheckoutAttempt)(nil)).Set("status = ?", "canceled").Set("updated_at = ?", s.now()).Where("organization_id = ? AND status = ? AND provider_subscription_id = ''", organizationID, "created").Exec(txCtx)
		if err != nil {
			return err
		}
		canceled, _ = result.RowsAffected()
		return nil
	})
	return canceled, err
}

func (s *Service) Delete(ctx context.Context, organizationID string, actor Actor, confirmation Confirmation) error {
	organization, err := s.authorizeOwner(ctx, s.db, organizationID, actor)
	if err != nil {
		return err
	}
	if confirmation.CanonicalName != organization.Name {
		return &UseCaseError{Kind: ErrorInvalid, Message: "Organization name confirmation does not match the canonical name"}
	}
	preview, err := s.preview(ctx, s.db, organization)
	if err != nil {
		return err
	}
	if len(preview.Blockers) > 0 {
		return &UseCaseError{Kind: ErrorConflict, Message: preview.Blockers[0].Message}
	}
	if err := s.reauthenticate(ctx, actor, confirmation); err != nil {
		return err
	}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return s.deleteInTx(txCtx, tx, organizationID, actor.UserID, confirmation.CanonicalName)
	})
}

func (s *Service) deleteInTx(ctx context.Context, tx bun.Tx, organizationID, actorUserID, canonicalName string) error {
	if _, err := tx.NewUpdate().Model((*models.Organization)(nil)).Set("name = name").Where("id = ?", organizationID).Exec(ctx); err != nil {
		return err
	}
	current, err := loadCurrentOwner(ctx, tx, organizationID, actorUserID)
	if err != nil {
		return err
	}
	if current.Name != canonicalName {
		return &UseCaseError{Kind: ErrorConflict, Message: "The Organization name changed; review deletion again and enter the current canonical name"}
	}
	preview, err := s.preview(ctx, tx, current)
	if err != nil {
		return err
	}
	if len(preview.Blockers) > 0 {
		return &UseCaseError{Kind: ErrorConflict, Message: preview.Blockers[0].Message}
	}
	workspaceIDs := workspaceIDs(preview.Workspaces)
	if err := prepareBoundaryDeletion(ctx, tx, workspaceIDs); err != nil {
		return err
	}
	event := &models.OrganizationLifecycleAuditEvent{ID: uuid.NewString(), OrganizationID: current.ID, OrganizationName: current.Name, WorkspaceCount: len(workspaceIDs), BillingState: preview.BillingState, ActorUserID: actorUserID, Action: "organization.deleted", CreatedAt: s.now()}
	if _, err := tx.NewInsert().Model(event).Exec(ctx); err != nil {
		return err
	}
	if err := workspacedeletion.DeleteWorkspaceData(ctx, tx, workspaceIDs, s.decryptor); err != nil {
		return err
	}
	if err := deleteOrganizationData(ctx, tx, current.ID, workspaceIDs); err != nil {
		return err
	}
	result, err := tx.NewDelete().Model((*models.Organization)(nil)).Where("id = ?", current.ID).Exec(ctx)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return &UseCaseError{Kind: ErrorConflict, Message: "Organization changed; review deletion again"}
	}
	return nil
}

func workspaceIDs(workspaces []Workspace) []string {
	ids := make([]string, 0, len(workspaces))
	for _, workspace := range workspaces {
		ids = append(ids, workspace.ID)
	}
	return ids
}

func prepareBoundaryDeletion(ctx context.Context, tx bun.Tx, workspaceIDs []string) error {
	keys, err := workspacedeletion.StoredObjectKeys(ctx, tx, workspaceIDs)
	if err != nil {
		return err
	}
	_, err = workspacedeletion.EnqueueStorageCleanup(ctx, tx, keys)
	return err
}

func deleteOrganizationData(ctx context.Context, tx bun.Tx, organizationID string, workspaceIDs []string) error {
	providerIDs, err := organizationIdentityProviderIDs(ctx, tx, organizationID)
	if err != nil {
		return err
	}
	transferIDs, err := organizationTransferIDs(ctx, tx, organizationID)
	if err != nil {
		return err
	}
	if err := deleteTransferNotifications(ctx, tx, transferIDs); err != nil {
		return err
	}
	jobReferences := map[string]struct{}{organizationID: {}}
	for _, transferID := range transferIDs {
		jobReferences[transferID] = struct{}{}
		jobReferences["/ownership-transfer?id="+transferID] = struct{}{}
	}
	billingReferences, err := workspacedeletion.OrganizationBillingReferences(ctx, tx, organizationID)
	if err != nil {
		return err
	}
	for reference := range billingReferences {
		jobReferences[reference] = struct{}{}
	}
	if err := workspacedeletion.DeleteJobsReferencing(ctx, tx, jobReferences); err != nil {
		return err
	}
	if err := deleteOrganizationRows(ctx, tx, organizationID); err != nil {
		return err
	}
	if err := deleteProviderIdentityRows(ctx, tx, providerIDs); err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model((*models.IdentityProvider)(nil)).Where("organization_id = ?", organizationID).Exec(ctx); err != nil {
		return err
	}
	return deleteWorkspaceCredentials(ctx, tx, workspaceIDs)
}

func organizationIdentityProviderIDs(ctx context.Context, tx bun.Tx, organizationID string) ([]string, error) {
	var ids []string
	err := tx.NewSelect().Model((*models.IdentityProvider)(nil)).Column("id").Where("organization_id = ?", organizationID).Scan(ctx, &ids)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return ids, err
}

func organizationTransferIDs(ctx context.Context, tx bun.Tx, organizationID string) ([]string, error) {
	var ids []string
	err := tx.NewSelect().Model((*models.OrganizationOwnershipTransfer)(nil)).Column("id").Where("organization_id = ?", organizationID).Scan(ctx, &ids)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return ids, err
}

func deleteTransferNotifications(ctx context.Context, tx bun.Tx, transferIDs []string) error {
	for _, transferID := range transferIDs {
		if _, err := tx.NewDelete().Model((*models.UserNotification)(nil)).Where("dedup_key = ?", "ownership-transfer:"+transferID).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func deleteOrganizationRows(ctx context.Context, tx bun.Tx, organizationID string) error {
	for _, deletion := range []struct {
		model any
		where string
		args  []any
	}{
		{(*models.APIToken)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.MCPOAuthCode)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.CLIAuthSession)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.OIDCAuthRequest)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.UserImpersonationGrantOrganization)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.IdentityProviderDomain)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.OrganizationSSOPolicy)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.BillingCheckoutAttempt)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.BillingSubscription)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.OrganizationInvitation)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.OrganizationOwnershipTransfer)(nil), "organization_id = ?", []any{organizationID}},
		{(*models.OrganizationMember)(nil), "organization_id = ?", []any{organizationID}},
	} {
		if _, err := tx.NewDelete().Model(deletion.model).Where(deletion.where, deletion.args...).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func deleteProviderIdentityRows(ctx context.Context, tx bun.Tx, providerIDs []string) error {
	if len(providerIDs) > 0 {
		for _, model := range []any{(*models.SessionIdentityAssurance)(nil), (*models.UserIdentity)(nil)} {
			if _, err := tx.NewDelete().Model(model).Where("provider_id IN (?)", bun.List(providerIDs)).Exec(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

func deleteWorkspaceCredentials(ctx context.Context, tx bun.Tx, workspaceIDs []string) error {
	if len(workspaceIDs) == 0 {
		return nil
	}
	for _, model := range []any{(*models.APIToken)(nil), (*models.MCPOAuthCode)(nil), (*models.CLIAuthSession)(nil)} {
		if _, err := tx.NewDelete().Model(model).Where("workspace_id IN (?)", bun.List(workspaceIDs)).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

type organizationDB interface{ NewSelect() *bun.SelectQuery }

func (s *Service) preview(ctx context.Context, db organizationDB, organization *models.Organization) (Preview, error) {
	workspaces, ids, err := loadOrganizationWorkspaces(ctx, db, organization.ID)
	if err != nil {
		return Preview{}, err
	}
	billingReferences, err := workspacedeletion.OrganizationBillingReferences(ctx, db, organization.ID)
	if err != nil {
		return Preview{}, err
	}
	pending, err := workspacedeletion.InspectPendingWorkWithReferences(ctx, db, ids, billingReferences, s.decryptor)
	if err != nil {
		return Preview{}, err
	}
	billingState, err := loadBillingState(ctx, db, organization.ID)
	if err != nil {
		return Preview{}, err
	}
	blockers, err := s.deletionBlockers(ctx, db, organization.ID, billingState, pending)
	if err != nil {
		return Preview{}, err
	}
	return Preview{OrganizationID: organization.ID, OrganizationName: organization.Name, Workspaces: workspaces, BillingState: billingState, PendingWork: pending,
		AccessEffects:    []string{"organization_memberships", "workspace_memberships", "organization_credentials"},
		Retained:         []string{"required_audit_evidence", "required_billing_evidence"},
		IrreversibleLoss: []string{"workspaces", "content", "connected_accounts", "media", "settings"},
		RecoveryPossible: false, Blockers: blockers}, nil
}

func loadOrganizationWorkspaces(ctx context.Context, db organizationDB, organizationID string) ([]Workspace, []string, error) {
	var rows []models.Workspace
	if err := db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID).Order("name ASC", "id ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, err
	}
	workspaces := make([]Workspace, 0, len(rows))
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		workspaces = append(workspaces, Workspace{ID: row.ID, Name: row.Name})
		ids = append(ids, row.ID)
	}
	return workspaces, ids, nil
}

func loadBillingState(ctx context.Context, db organizationDB, organizationID string) (string, error) {
	var subscription models.BillingSubscription
	err := db.NewSelect().Model(&subscription).Where("organization_id = ?", organizationID).Scan(ctx)
	if err == nil {
		billingState := strings.ToLower(strings.TrimSpace(subscription.Status))
		if billingState == "" {
			billingState = "unknown"
		}
		return billingState, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "none", nil
	}
	return "", err
}

func (s *Service) deletionBlockers(ctx context.Context, db organizationDB, organizationID, billingState string, pending workspacedeletion.PendingWork) ([]Blocker, error) {
	blockers := []Blocker{}
	if billingState != "none" && billingState != "canceled" {
		blockers = append(blockers, Blocker{Code: "active_billing", Message: "Resolve the Paddle subscription and wait for Paddle to confirm a canceled state before deleting this Organization"})
	}
	pendingCheckout, err := db.NewSelect().Model((*models.BillingCheckoutAttempt)(nil)).Where("organization_id = ? AND LOWER(status) != ?", organizationID, "canceled").Exists(ctx)
	if err != nil {
		return nil, err
	}
	if pendingCheckout {
		blockers = append(blockers, Blocker{Code: "pending_billing_checkout", Message: "Resolve the pending Paddle checkout before deleting this Organization"})
	}
	pendingTransfer, err := db.NewSelect().Model((*models.OrganizationOwnershipTransfer)(nil)).Where("organization_id = ? AND status = ? AND expires_at > ?", organizationID, "pending", s.now()).Exists(ctx)
	if err != nil {
		return nil, err
	}
	if pendingTransfer {
		blockers = append(blockers, Blocker{Code: "pending_ownership_transfer", Message: "Revoke or complete the pending ownership transfer before deleting this Organization"})
	}
	if pending.ProviderWrites > 0 || pending.Jobs > 0 {
		blockers = append(blockers, Blocker{Code: "pending_external_writes", Message: "Wait for publishing and provider actions to finish or resolve them before deleting this Organization"})
	}
	if pending.CleanupJobs > 0 {
		blockers = append(blockers, Blocker{Code: "pending_cleanup", Message: "Wait for active cleanup jobs to finish before deleting this Organization"})
	}
	return blockers, nil
}

func (s *Service) authorizeOwner(ctx context.Context, db organizationDB, organizationID string, actor Actor) (*models.Organization, error) {
	if strings.TrimSpace(actor.WorkspaceBindingID) != "" {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "workspace-bound tokens cannot access organization-level resources"}
	}
	var organization models.Organization
	if err := db.NewSelect().Model(&organization).Where("id = ?", strings.TrimSpace(organizationID)).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &UseCaseError{Kind: ErrorNotFound, Message: "Organization not found"}
		}
		return nil, err
	}
	decision, err := identity.EvaluateOrganizationAccess(ctx, s.db, organization.ID, actor.UserID, actor.SessionID, actor.TokenID)
	if err != nil {
		return nil, err
	}
	if !decision.Allowed {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "organization SSO authentication is required"}
	}
	count, err := db.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND user_id = ? AND role = ?", organization.ID, actor.UserID, models.OrganizationRoleOwner).Count(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "Organization Owner role required"}
	}
	return &organization, nil
}

func loadCurrentOwner(ctx context.Context, db organizationDB, organizationID, userID string) (*models.Organization, error) {
	var organization models.Organization
	if err := db.NewSelect().Model(&organization).Where("id = ?", organizationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &UseCaseError{Kind: ErrorNotFound, Message: "Organization not found"}
		}
		return nil, err
	}
	count, err := db.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND user_id = ? AND role = ?", organizationID, userID, models.OrganizationRoleOwner).Count(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, &UseCaseError{Kind: ErrorForbidden, Message: "Organization Owner role required"}
	}
	return &organization, nil
}

func (s *Service) reauthenticate(ctx context.Context, actor Actor, confirmation Confirmation) error {
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("id = ?", actor.UserID).Scan(ctx); err != nil {
		return &UseCaseError{Kind: ErrorAuth, Message: "account not found"}
	}
	if s.identity != nil && strings.TrimSpace(confirmation.ReauthGrant) != "" {
		if err := s.identity.ConsumeReauthGrant(ctx, confirmation.ReauthGrant, actor.UserID, actor.SessionID, ReauthAction); err == nil {
			return nil
		}
		return &UseCaseError{Kind: ErrorAuth, Message: "recent reauthentication is required"}
	}
	passwordAllowed := true
	if s.identity != nil {
		allowed, err := s.identity.PasswordCredentialAllowed(ctx, actor.UserID)
		if err != nil {
			return err
		}
		passwordAllowed = allowed
	}
	if passwordAllowed && s.auth != nil && s.auth.CheckPassword(confirmation.CurrentPassword, user.PasswordHash) {
		return nil
	}
	if strings.TrimSpace(confirmation.CurrentPassword) == "" && strings.TrimSpace(confirmation.ReauthGrant) == "" {
		return &UseCaseError{Kind: ErrorInvalid, Message: "a current password or one-time reauthentication grant is required"}
	}
	return &UseCaseError{Kind: ErrorAuth, Message: "recent reauthentication is required"}
}
