package organizationownership

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

const (
	JobTypeExpiry    = jobregistry.TypeOwnershipTransferExpiry
	TransferLifetime = 7 * 24 * time.Hour
	StatusPending    = "pending"
	StatusAccepted   = "accepted"
	StatusDeclined   = "declined"
	StatusRevoked    = "revoked"
	StatusExpired    = "expired"

	ActionInitiated        = "ownership_transfer.initiated"
	ActionRevoked          = "ownership_transfer.revoked"
	ActionExpired          = "ownership_transfer.expired"
	ActionAccepted         = "ownership_transfer.accepted"
	ActionDeclined         = "ownership_transfer.declined"
	ActionInitiationFailed = "ownership_transfer.initiation.failed"
	ActionRevocationFailed = "ownership_transfer.revocation.failed"
	ActionAcceptanceFailed = "ownership_transfer.acceptance.failed"
	ActionDeclineFailed    = "ownership_transfer.decline.failed"
	ActionExpiryFailed     = "ownership_transfer.expiry.failed"
)

var (
	ErrOwnerRequired     = errors.New("organization owner role required")
	ErrNomineeIneligible = errors.New("nominee must be another active Organization member")
	ErrPendingExists     = errors.New("an ownership transfer is already pending")
	ErrNotFound          = errors.New("ownership transfer not found")
	ErrNotPending        = errors.New("ownership transfer is no longer pending")
	ErrExpired           = errors.New("ownership transfer has expired")
	ErrNomineeRequired   = errors.New("ownership transfer is available only to its nominee")
	ErrConfirmation      = errors.New("enter the exact Organization name to confirm ownership transfer")
	ErrIdentityAssurance = errors.New("organization SSO authentication is required")
	ErrBrowserRequired   = errors.New("an unscoped browser session is required")
	ErrReauthUnavailable = errors.New("recent reauthentication is unavailable")
	ErrReauthRequired    = errors.New("recent reauthentication is required")
)

const ReauthAction = "organization.ownership.transfer"

type ReauthGrantConsumer interface {
	ConsumeReauthGrant(ctx context.Context, raw, userID, sessionID, action string) error
}

type Service struct {
	db            *bun.DB
	notifications *notifications.Service
	reauth        ReauthGrantConsumer
	now           func() time.Time
}

func NewService(db *bun.DB, notificationService *notifications.Service, reauth ReauthGrantConsumer) *Service {
	return &Service{db: db, notifications: notificationService, reauth: reauth, now: func() time.Time { return time.Now().UTC() }}
}

type InitiateInput struct {
	OrganizationID          string
	ActorUserID             string
	ActorSessionID          string
	ActorTokenID            string
	ActorWorkspaceID        string
	ReauthGrant             string
	NomineeUserID           string
	ConfirmOrganizationName string
}

type Credential struct {
	UserID      string
	SessionID   string
	TokenID     string
	WorkspaceID string
}

type Transfer struct {
	models.OrganizationOwnershipTransfer
	OrganizationName string `bun:"organization_name" json:"organization_name"`
	PriorOwnerEmail  string `bun:"prior_owner_email" json:"prior_owner_email"`
	NomineeEmail     string `bun:"nominee_email" json:"nominee_email"`
}

func (s *Service) Initiate(ctx context.Context, input InitiateInput) (Transfer, error) {
	input.OrganizationID = strings.TrimSpace(input.OrganizationID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.NomineeUserID = strings.TrimSpace(input.NomineeUserID)
	now := s.now()
	row := models.OrganizationOwnershipTransfer{
		ID: uuid.NewString(), OrganizationID: input.OrganizationID, PriorOwnerUserID: input.ActorUserID,
		NomineeUserID: input.NomineeUserID, Status: StatusPending,
		ExpiresAt: now.Add(TransferLifetime), CreatedAt: now, UpdatedAt: now,
	}
	fail := func(cause error) (Transfer, error) {
		if auditErr := s.RecordInitiationFailure(ctx, input); auditErr != nil {
			return Transfer{}, auditErr
		}
		return Transfer{}, cause
	}
	if err := s.authorizeInitiation(ctx, input); err != nil {
		return fail(err)
	}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		organizationName, err := validateInitiation(txCtx, tx, input)
		if err != nil {
			return err
		}
		if err := s.expireOrganizationPending(txCtx, tx, input.OrganizationID, now); err != nil {
			return err
		}
		pending, err := tx.NewSelect().Model((*models.OrganizationOwnershipTransfer)(nil)).
			Where("organization_id = ? AND status = ?", input.OrganizationID, StatusPending).Count(txCtx)
		if err != nil {
			return err
		}
		if pending != 0 {
			return ErrPendingExists
		}
		if _, err := tx.NewInsert().Model(&row).Exec(txCtx); err != nil {
			return err
		}
		if err := enqueueExpiryJob(txCtx, tx, row); err != nil {
			return err
		}
		if err := insertAudit(txCtx, tx, row, input.ActorUserID, ActionInitiated, now); err != nil {
			return err
		}
		if s.notifications != nil {
			href := "/ownership-transfer?id=" + row.ID
			if err := s.notifications.CreateWithDB(txCtx, tx, notifications.CreateInput{
				UserID: input.NomineeUserID, Type: notifications.TypeOwnershipTransfer,
				Href: href, DedupKey: "ownership-transfer:" + row.ID,
				Payload: map[string]any{"kind": notifications.OwnershipTransferSemanticKind, "organization_name": organizationName},
				Actions: []models.NotificationAction{{Label: notifications.OwnershipTransferReviewAction, Href: href, Kind: "primary"}},
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Transfer{}, errors.Join(err, s.auditRowFailure(ctx, row, input.ActorUserID, ActionInitiationFailed))
	}
	transfer, err := s.getForOrganization(ctx, input.OrganizationID, input.ActorUserID)
	return transfer, err
}

func (s *Service) authorizeInitiation(ctx context.Context, input InitiateInput) error {
	credential := Credential{UserID: input.ActorUserID, SessionID: input.ActorSessionID, TokenID: input.ActorTokenID, WorkspaceID: input.ActorWorkspaceID}
	if err := requireBrowserCredential(credential); err != nil {
		return err
	}
	if err := s.requireOrganizationAccess(ctx, input.OrganizationID, Credential{UserID: input.ActorUserID, SessionID: input.ActorSessionID, TokenID: input.ActorTokenID}); err != nil {
		return err
	}
	if _, err := validateInitiation(ctx, s.db, input); err != nil {
		return err
	}
	if s.reauth == nil {
		return ErrReauthUnavailable
	}
	if strings.TrimSpace(input.ReauthGrant) == "" {
		return ErrReauthRequired
	}
	if err := s.reauth.ConsumeReauthGrant(ctx, input.ReauthGrant, input.ActorUserID, input.ActorSessionID, ReauthAction); err != nil {
		return ErrReauthRequired
	}
	return nil
}

func (s *Service) RecordInitiationFailure(ctx context.Context, input InitiateInput) error {
	organizationID := strings.TrimSpace(input.OrganizationID)
	organizationExists, err := s.db.NewSelect().Model((*models.Organization)(nil)).Where("id = ?", organizationID).Exists(ctx)
	if err != nil {
		return err
	}
	if !organizationExists {
		return nil
	}
	validatedUserID := func(userID string) (string, error) {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			return "", nil
		}
		exists, lookupErr := s.db.NewSelect().Model((*models.User)(nil)).Where("id = ?", userID).Exists(ctx)
		if lookupErr != nil || !exists {
			return "", lookupErr
		}
		return userID, nil
	}
	actorUserID, err := validatedUserID(input.ActorUserID)
	if err != nil {
		return err
	}
	nomineeUserID, err := validatedUserID(input.NomineeUserID)
	if err != nil {
		return err
	}
	return s.auditRowFailure(ctx, models.OrganizationOwnershipTransfer{
		ID: uuid.NewString(), OrganizationID: organizationID,
		PriorOwnerUserID: actorUserID, NomineeUserID: nomineeUserID,
	}, actorUserID, ActionInitiationFailed)
}

func validateInitiation(ctx context.Context, db bun.IDB, input InitiateInput) (string, error) {
	if err := requireOwner(ctx, db, input.OrganizationID, input.ActorUserID); err != nil {
		return "", err
	}
	if strings.TrimSpace(input.NomineeUserID) == strings.TrimSpace(input.ActorUserID) {
		return "", ErrNomineeIneligible
	}
	count, err := db.NewSelect().TableExpr("organization_members AS om").Join("JOIN users AS u ON u.id = om.user_id").Where("om.organization_id = ? AND om.user_id = ?", input.OrganizationID, input.NomineeUserID).Count(ctx)
	if err != nil {
		return "", err
	}
	if count != 1 {
		return "", ErrNomineeIneligible
	}
	var organizationName string
	if err := db.NewSelect().Model((*models.Organization)(nil)).Column("name").Where("id = ?", input.OrganizationID).Scan(ctx, &organizationName); err != nil {
		return "", err
	}
	if input.ConfirmOrganizationName != organizationName {
		return "", ErrConfirmation
	}
	return organizationName, nil
}

func (s *Service) GetForOrganization(ctx context.Context, organizationID string, credential Credential) (Transfer, error) {
	if err := requireBrowserCredential(credential); err != nil {
		return Transfer{}, err
	}
	if err := s.requireOrganizationAccess(ctx, organizationID, credential); err != nil {
		return Transfer{}, err
	}
	return s.getForOrganization(ctx, organizationID, credential.UserID)
}

func (s *Service) getForOrganization(ctx context.Context, organizationID, userID string) (Transfer, error) {
	var transfer Transfer
	err := s.transferQuery().Where("transfer.organization_id = ? AND transfer.status = ? AND transfer.expires_at > ?", strings.TrimSpace(organizationID), StatusPending, s.now()).Scan(ctx, &transfer)
	if errors.Is(err, sql.ErrNoRows) {
		return Transfer{}, ErrNotFound
	}
	if err != nil {
		return Transfer{}, err
	}
	if transfer.PriorOwnerUserID != userID && transfer.NomineeUserID != userID {
		return Transfer{}, ErrNotFound
	}
	return transfer, nil
}

func (s *Service) Resolve(ctx context.Context, transferID string, credential Credential) (Transfer, error) {
	if err := requireBrowserCredential(credential); err != nil {
		return Transfer{}, err
	}
	var transfer Transfer
	err := s.transferQuery().Where("transfer.id = ?", strings.TrimSpace(transferID)).Scan(ctx, &transfer)
	if errors.Is(err, sql.ErrNoRows) {
		return Transfer{}, ErrNotFound
	}
	if err != nil {
		return Transfer{}, err
	}
	if err := s.requireOrganizationAccess(ctx, transfer.OrganizationID, credential); err != nil {
		return Transfer{}, err
	}
	if transfer.Status == StatusPending && !transfer.ExpiresAt.After(s.now()) {
		return Transfer{}, ErrExpired
	}
	if transfer.NomineeUserID != strings.TrimSpace(credential.UserID) {
		return Transfer{}, ErrNomineeRequired
	}
	if transfer.Status != StatusPending {
		return Transfer{}, ErrNotPending
	}
	return transfer, nil
}

func (s *Service) Revoke(ctx context.Context, organizationID string, credential Credential) error {
	now := s.now()
	row := models.OrganizationOwnershipTransfer{ID: uuid.NewString(), OrganizationID: strings.TrimSpace(organizationID)}
	if err := requireBrowserCredential(credential); err != nil {
		return errors.Join(err, s.auditRowFailure(ctx, row, credential.UserID, ActionRevocationFailed))
	}
	if err := s.requireOrganizationAccess(ctx, organizationID, credential); err != nil {
		return errors.Join(err, s.auditRowFailure(ctx, row, credential.UserID, ActionRevocationFailed))
	}
	expired := false
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := requireOwner(txCtx, tx, organizationID, credential.UserID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(&row).Where("organization_id = ? AND status = ?", organizationID, StatusPending).Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		if !row.ExpiresAt.After(now) {
			if err := expireTransfer(txCtx, tx, row, now); err != nil {
				return err
			}
			expired = true
			return nil
		}
		result, err := tx.NewUpdate().Model((*models.OrganizationOwnershipTransfer)(nil)).Set("status = ?, revoked_at = ?, updated_at = ?", StatusRevoked, now, now).Where("id = ? AND status = ?", row.ID, StatusPending).Exec(txCtx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrNotPending
		}
		return insertAudit(txCtx, tx, row, credential.UserID, ActionRevoked, now)
	})
	if err == nil && expired {
		return errors.Join(ErrExpired, s.auditRowFailure(ctx, row, credential.UserID, ActionRevocationFailed))
	}
	if err != nil {
		return errors.Join(err, s.auditRowFailure(ctx, row, credential.UserID, ActionRevocationFailed))
	}
	return nil
}

func (s *Service) Accept(ctx context.Context, transferID string, credential Credential) (Transfer, error) {
	resolved, err := s.Resolve(ctx, transferID, credential)
	if err != nil {
		return Transfer{}, errors.Join(err, s.auditFailure(ctx, transferID, credential.UserID, ActionAcceptanceFailed))
	}
	nomineeUserID := credential.UserID
	now := s.now()
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		// The transfer row is the compare-and-swap guard. Role changes are only
		// visible after this transaction commits, so readers never observe zero
		// or two Owners.
		result, err := tx.NewUpdate().Model((*models.OrganizationOwnershipTransfer)(nil)).
			Set("status = ?, accepted_at = ?, updated_at = ?", StatusAccepted, now, now).
			Where("id = ? AND status = ? AND nominee_user_id = ? AND expires_at > ?", resolved.ID, StatusPending, nomineeUserID, now).Exec(txCtx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrNotPending
		}
		creatorResult, err := tx.NewUpdate().Model((*models.Organization)(nil)).
			Set("created_by = ?, updated_at = ?", nomineeUserID, now).
			Where("id = ? AND created_by = ?", resolved.OrganizationID, resolved.PriorOwnerUserID).Exec(txCtx)
		if err != nil {
			return err
		}
		if n, _ := creatorResult.RowsAffected(); n != 1 {
			return ErrOwnerRequired
		}
		ownerResult, err := tx.NewUpdate().Model((*models.OrganizationMember)(nil)).Set("role = ?", models.OrganizationRoleAdmin).
			Where("organization_id = ? AND user_id = ? AND role = ?", resolved.OrganizationID, resolved.PriorOwnerUserID, models.OrganizationRoleOwner).Exec(txCtx)
		if err != nil {
			return err
		}
		if n, _ := ownerResult.RowsAffected(); n != 1 {
			return ErrOwnerRequired
		}
		nomineeResult, err := tx.NewUpdate().Model((*models.OrganizationMember)(nil)).Set("role = ?", models.OrganizationRoleOwner).
			Where("organization_id = ? AND user_id = ? AND role != ?", resolved.OrganizationID, nomineeUserID, models.OrganizationRoleOwner).Exec(txCtx)
		if err != nil {
			return err
		}
		if n, _ := nomineeResult.RowsAffected(); n != 1 {
			return ErrNomineeIneligible
		}
		owners, err := tx.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND role = ?", resolved.OrganizationID, models.OrganizationRoleOwner).Count(txCtx)
		if err != nil {
			return err
		}
		if owners != 1 {
			return fmt.Errorf("organization must have exactly one owner")
		}
		return insertAudit(txCtx, tx, resolved.OrganizationOwnershipTransfer, nomineeUserID, ActionAccepted, now)
	})
	if err != nil {
		return Transfer{}, errors.Join(err, s.auditFailure(ctx, transferID, nomineeUserID, ActionAcceptanceFailed))
	}
	resolved.Status, resolved.AcceptedAt, resolved.UpdatedAt = StatusAccepted, now, now
	return resolved, nil
}

func (s *Service) Decline(ctx context.Context, transferID string, credential Credential) (Transfer, error) {
	resolved, err := s.Resolve(ctx, transferID, credential)
	if err != nil {
		return Transfer{}, errors.Join(err, s.auditFailure(ctx, transferID, credential.UserID, ActionDeclineFailed))
	}
	nomineeUserID := credential.UserID
	now := s.now()
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.OrganizationOwnershipTransfer)(nil)).Set("status = ?, declined_at = ?, updated_at = ?", StatusDeclined, now, now).Where("id = ? AND status = ?", resolved.ID, StatusPending).Exec(txCtx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrNotPending
		}
		return insertAudit(txCtx, tx, resolved.OrganizationOwnershipTransfer, nomineeUserID, ActionDeclined, now)
	})
	if err != nil {
		return Transfer{}, errors.Join(err, s.auditFailure(ctx, transferID, nomineeUserID, ActionDeclineFailed))
	}
	resolved.Status, resolved.DeclinedAt, resolved.UpdatedAt = StatusDeclined, now, now
	return resolved, nil
}

func (s *Service) expireOrganizationPending(ctx context.Context, db bun.IDB, organizationID string, now time.Time) error {
	var rows []models.OrganizationOwnershipTransfer
	if err := db.NewSelect().Model(&rows).Where("organization_id = ? AND status = ? AND expires_at <= ?", organizationID, StatusPending, now).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	for _, row := range rows {
		if err := expireTransfer(ctx, db, row, now); err != nil {
			return err
		}
	}
	return nil
}

func expireTransfer(ctx context.Context, db bun.IDB, row models.OrganizationOwnershipTransfer, now time.Time) error {
	result, err := db.NewUpdate().Model((*models.OrganizationOwnershipTransfer)(nil)).Set("status = ?, expired_at = ?, updated_at = ?", StatusExpired, now, now).Where("id = ? AND status = ? AND expires_at <= ?", row.ID, StatusPending, now).Exec(ctx)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return nil
	}
	return insertAudit(ctx, db, row, row.PriorOwnerUserID, ActionExpired, now)
}

type expiryJob struct {
	TransferID string `json:"transfer_id"`
}

func enqueueExpiryJob(ctx context.Context, db bun.IDB, row models.OrganizationOwnershipTransfer) error {
	payload, err := json.Marshal(expiryJob{TransferID: row.ID})
	if err != nil {
		return fmt.Errorf("encode ownership transfer expiry job: %w", err)
	}
	job, err := jobregistry.NewJob(JobTypeExpiry, string(payload), row.ExpiresAt)
	if err != nil {
		return err
	}
	job.ID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("organization-ownership-expiry\x00"+row.ID)).String()
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	if jobType != JobTypeExpiry {
		return fmt.Errorf("unsupported organization ownership job type %q", jobType)
	}
	var decoded expiryJob
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil || strings.TrimSpace(decoded.TransferID) == "" {
		return errors.New("invalid organization ownership expiry payload")
	}
	now := s.now()
	var row models.OrganizationOwnershipTransfer
	err := s.db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		if err := tx.NewSelect().Model(&row).Where("id = ?", decoded.TransferID).Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return nil
		} else if err != nil {
			return err
		}
		if row.Status != StatusPending {
			return nil
		}
		if row.ExpiresAt.After(now) {
			return errors.New("organization ownership transfer expiry is not due")
		}
		return expireTransfer(txCtx, tx, row, now)
	})
	if err != nil {
		return errors.Join(err, s.auditRowFailure(ctx, row, row.PriorOwnerUserID, ActionExpiryFailed))
	}
	return nil
}

func (s *Service) transferQuery() *bun.SelectQuery {
	return s.db.NewSelect().Model((*Transfer)(nil)).ModelTableExpr("organization_ownership_transfers AS transfer").
		ColumnExpr("transfer.*").ColumnExpr("o.name AS organization_name").ColumnExpr("owner.email AS prior_owner_email").ColumnExpr("nominee.email AS nominee_email").
		Join("JOIN organizations AS o ON o.id = transfer.organization_id").Join("JOIN users AS owner ON owner.id = transfer.prior_owner_user_id").Join("JOIN users AS nominee ON nominee.id = transfer.nominee_user_id")
}

func (s *Service) requireOrganizationAccess(ctx context.Context, organizationID string, credential Credential) error {
	decision, err := identity.EvaluateOrganizationAccess(
		ctx,
		s.db,
		strings.TrimSpace(organizationID),
		strings.TrimSpace(credential.UserID),
		strings.TrimSpace(credential.SessionID),
		strings.TrimSpace(credential.TokenID),
	)
	if err != nil {
		return fmt.Errorf("evaluate Organization identity access: %w", err)
	}
	if !decision.Allowed {
		return ErrIdentityAssurance
	}
	return nil
}

func requireBrowserCredential(credential Credential) error {
	if strings.TrimSpace(credential.SessionID) == "" || strings.TrimSpace(credential.TokenID) != "" || strings.TrimSpace(credential.WorkspaceID) != "" {
		return ErrBrowserRequired
	}
	return nil
}

func requireOwner(ctx context.Context, db bun.IDB, organizationID, userID string) error {
	count, err := db.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND user_id = ? AND role = ?", strings.TrimSpace(organizationID), strings.TrimSpace(userID), models.OrganizationRoleOwner).Count(ctx)
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrOwnerRequired
	}
	return nil
}

func insertAudit(ctx context.Context, db bun.IDB, transfer models.OrganizationOwnershipTransfer, actorUserID, action string, now time.Time) error {
	result := "succeeded"
	if strings.HasSuffix(action, ".failed") {
		result = "failed"
	}
	_, err := db.NewInsert().Model(&models.OrganizationOwnershipAuditEvent{
		ID: uuid.NewString(), OrganizationID: transfer.OrganizationID, TransferID: transfer.ID,
		ActorUserID: actorUserID, NomineeUserID: transfer.NomineeUserID,
		Action: action, Result: result, CreatedAt: now.UTC(),
	}).Exec(ctx)
	return err
}

func (s *Service) auditFailure(ctx context.Context, transferID, actorUserID, action string) error {
	var row models.OrganizationOwnershipTransfer
	err := s.db.NewSelect().Model(&row).Where("id = ?", strings.TrimSpace(transferID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.auditRowFailure(ctx, row, actorUserID, action)
}

func (s *Service) auditRowFailure(ctx context.Context, row models.OrganizationOwnershipTransfer, actorUserID, action string) error {
	if strings.TrimSpace(row.OrganizationID) == "" || strings.TrimSpace(row.ID) == "" {
		return nil
	}
	return insertAudit(ctx, s.db, row, strings.TrimSpace(actorUserID), action, s.now())
}
