package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/workspacedeletion"
	"github.com/uptrace/bun"
)

var activeBillingStatuses = []string{"active", "trialing", "past_due"}

const (
	reauthActionAccountExport = "account.export"
	reauthActionAccountDelete = "account.delete"
)

type AccountLifecycleHandler struct {
	db       *bun.DB
	auth     *auth.Service
	authn    middleware.Authenticator
	storage  mediastore.BlobStorage
	identity *identity.Service
}

func (h *AccountLifecycleHandler) SetIdentityService(service *identity.Service) {
	h.identity = service
}

func NewAccountLifecycleHandler(db *bun.DB, authService *auth.Service, authenticator middleware.Authenticator, storage mediastore.BlobStorage) *AccountLifecycleHandler {
	return &AccountLifecycleHandler{db: db, auth: authService, authn: authenticator, storage: storage}
}

type AccountReauthenticationInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current account password"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
	}
}

type AccountExportUser struct {
	ID              string    `json:"id"`
	Email           string    `json:"email"`
	DisplayName     string    `json:"display_name"`
	AvatarURL       string    `json:"avatar_url"`
	IsAdmin         bool      `json:"is_admin"`
	TermsVersion    string    `json:"terms_version,omitempty"`
	PrivacyVersion  string    `json:"privacy_version,omitempty"`
	LegalAcceptedAt time.Time `json:"legal_accepted_at,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type AccountExportOrganization struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type AccountExportWorkspace struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id,omitempty"`
	Name           string    `json:"name"`
	Role           string    `json:"role"`
	Timezone       string    `json:"timezone"`
	CreatedAt      time.Time `json:"created_at"`
}

type AccountExportSocialAccount struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspace_id"`
	Platform        string    `json:"platform"`
	AccountID       string    `json:"account_id"`
	AccountUsername string    `json:"account_username"`
	InstanceURL     string    `json:"instance_url,omitempty"`
	IsActive        bool      `json:"is_active"`
	GrantedScopes   string    `json:"granted_scopes,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type AccountExportPublication struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspace_id"`
	Title          string    `json:"title"`
	ContentProfile string    `json:"content_profile"`
	SourceText     string    `json:"source_text"`
	SourceURL      string    `json:"source_url,omitempty"`
	Status         string    `json:"status"`
	ScheduledAt    time.Time `json:"scheduled_at,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type AccountExportPost struct {
	ID            string    `json:"id"`
	WorkspaceID   string    `json:"workspace_id"`
	PublicationID string    `json:"publication_id,omitempty"`
	Content       string    `json:"content"`
	Status        string    `json:"status"`
	ScheduledAt   time.Time `json:"scheduled_at,omitempty"`
	PublishedAt   time.Time `json:"published_at,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type AccountExportMedia struct {
	ID               string    `json:"id"`
	WorkspaceID      string    `json:"workspace_id"`
	MimeType         string    `json:"mime_type"`
	Size             int64     `json:"size"`
	OriginalFilename string    `json:"original_filename"`
	Width            int       `json:"width"`
	Height           int       `json:"height"`
	DurationMS       int64     `json:"duration_ms"`
	AltText          string    `json:"alt_text"`
	CreatedAt        time.Time `json:"created_at"`
}

type AccountExportToken struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	TokenPrefix string    `json:"token_prefix"`
	Scope       string    `json:"scope"`
	WorkspaceID string    `json:"workspace_id,omitempty"`
	LastUsedAt  time.Time `json:"last_used_at,omitempty"`
	RevokedAt   time.Time `json:"revoked_at,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// AccountExportPublicationAuthorization exposes consent/audit facts without
// exporting raw payloads, fingerprints, or session/token identifiers.
type AccountExportPublicationAuthorization struct {
	ID                    string    `json:"id"`
	BatchID               string    `json:"batch_id"`
	PublicationID         string    `json:"publication_id"`
	RenditionID           string    `json:"rendition_id"`
	Action                string    `json:"action"`
	ActorOrigin           string    `json:"actor_origin"`
	ActorClientID         string    `json:"actor_client_id,omitempty"`
	ActorClientName       string    `json:"actor_client_name,omitempty"`
	SessionIdentityStored bool      `json:"session_identity_stored"`
	TokenIdentityStored   bool      `json:"token_identity_stored"`
	PublicationRevision   int       `json:"publication_revision"`
	SocialAccountID       string    `json:"social_account_id"`
	TargetKey             string    `json:"target_key"`
	ScheduledAt           time.Time `json:"scheduled_at"`
	PolicyMode            string    `json:"policy_mode"`
	ConfirmedAt           time.Time `json:"confirmed_at"`
	FingerprintsRecorded  bool      `json:"fingerprints_recorded"`
}

type AccountExport struct {
	FormatVersion                  string                                  `json:"format_version"`
	GeneratedAt                    time.Time                               `json:"generated_at"`
	User                           AccountExportUser                       `json:"user"`
	Organizations                  []AccountExportOrganization             `json:"organizations"`
	Workspaces                     []AccountExportWorkspace                `json:"workspaces"`
	SocialAccounts                 []AccountExportSocialAccount            `json:"social_accounts"`
	Publications                   []AccountExportPublication              `json:"publications"`
	Posts                          []AccountExportPost                     `json:"posts"`
	Media                          []AccountExportMedia                    `json:"media"`
	APITokens                      []AccountExportToken                    `json:"api_tokens"`
	PublicationAuthorizations      []AccountExportPublicationAuthorization `json:"publication_authorizations"`
	SharedWorkspaceContentExcluded bool                                    `json:"shared_workspace_content_excluded"`
}

type AccountExportOutput struct {
	ContentDisposition string        `header:"Content-Disposition"`
	Body               AccountExport `json:"body"`
}

type DeletionBlocker struct {
	Code           string `json:"code"`
	Message        string `json:"message"`
	OrganizationID string `json:"organization_id,omitempty"`
	WorkspaceID    string `json:"workspace_id,omitempty"`
}

type DeletionOwnershipTransfer struct {
	OrganizationID   string `json:"organization_id"`
	OrganizationName string `json:"organization_name"`
	SuccessorEmail   string `json:"successor_email"`
}

type DeletionInstanceAdminTransfer struct {
	SuccessorEmail string `json:"successor_email"`
}

type AccountDeletionImpact struct {
	Organizations         int                            `json:"organizations"`
	Workspaces            int                            `json:"workspaces"`
	SocialAccounts        int                            `json:"social_accounts"`
	Publications          int                            `json:"publications"`
	Posts                 int                            `json:"posts"`
	Media                 int                            `json:"media"`
	Blockers              []DeletionBlocker              `json:"blockers"`
	OwnershipTransfers    []DeletionOwnershipTransfer    `json:"ownership_transfers"`
	InstanceAdminTransfer *DeletionInstanceAdminTransfer `json:"instance_admin_transfer,omitempty"`
}

type deletionOrganizationPlan struct {
	personalOrganizationIDs []string
	retainedSuccessors      map[string]string
	ownershipTransfers      []DeletionOwnershipTransfer
	blockers                []DeletionBlocker
}

type AccountDeletionImpactOutput struct {
	Body AccountDeletionImpact
}

type DeleteAccountInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current account password"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
		ConfirmEmail    string `json:"confirm_email" format:"email" doc:"Exact account email confirmation"`
	}
}

type DeleteAccountOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		Deleted bool `json:"deleted"`
	}
}

func (h *AccountLifecycleHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authn)
	huma.Register(api, huma.Operation{
		OperationID: "export-account-data",
		Method:      http.MethodPost,
		Path:        "/auth/account/export",
		Summary:     "Export the current user's account data",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{401},
	}, h.exportAccount)

	huma.Register(api, huma.Operation{
		OperationID: "get-account-deletion-impact",
		Method:      http.MethodGet,
		Path:        "/auth/account/deletion-impact",
		Summary:     "Preview the impact and blockers for account deletion",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{authMiddleware},
		Errors:      []int{401},
	}, h.deletionImpact)

	huma.Register(api, huma.Operation{
		OperationID: "delete-account",
		Method:      http.MethodDelete,
		Path:        "/auth/account",
		Summary:     "Permanently delete the current account",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 401, 409},
	}, h.deleteAccount)
}

func (h *AccountLifecycleHandler) exportAccount(ctx context.Context, input *AccountReauthenticationInput) (*AccountExportOutput, error) {
	user, err := h.reauthenticate(ctx, input.Body.CurrentPassword, input.Body.ReauthGrant, reauthActionAccountExport)
	if err != nil {
		return nil, err
	}
	exported, err := h.buildExport(ctx, user)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to export account data")
	}
	out := &AccountExportOutput{Body: exported}
	out.ContentDisposition = fmt.Sprintf("attachment; filename=%q", "openpost-account-export-"+time.Now().UTC().Format("2006-01-02")+".json")
	return out, nil
}

func (h *AccountLifecycleHandler) deletionImpact(ctx context.Context, _ *struct{}) (*AccountDeletionImpactOutput, error) {
	userID := middleware.GetUserID(ctx)
	impact, err := h.loadDeletionImpact(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to inspect account deletion impact")
	}
	return &AccountDeletionImpactOutput{Body: impact}, nil
}

func (h *AccountLifecycleHandler) deleteAccount(ctx context.Context, input *DeleteAccountInput) (*DeleteAccountOutput, error) {
	user, err := h.reauthenticate(ctx, input.Body.CurrentPassword, input.Body.ReauthGrant, reauthActionAccountDelete)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(strings.ToLower(input.Body.ConfirmEmail)) != strings.ToLower(user.Email) {
		return nil, huma.Error400BadRequest("email confirmation does not match this account")
	}
	impact, err := h.loadDeletionImpact(ctx, user.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to inspect account deletion impact")
	}
	if len(impact.Blockers) > 0 {
		return nil, huma.Error409Conflict("account deletion is blocked; resolve active billing, shared ownership, or instance administration first")
	}

	plan, err := h.planOrganizationDeletion(ctx, user.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to prepare account deletion")
	}
	workspaceIDs, err := h.workspaceIDsForOrganizations(ctx, plan.personalOrganizationIDs)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to prepare account deletion")
	}
	objectKeys, err := h.storedObjectKeys(ctx, user, workspaceIDs)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to prepare stored account media for deletion")
	}
	adminSuccessorID, _, err := h.planInstanceAdminTransfer(ctx, user.ID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to prepare instance administration transfer")
	}
	cleanupJobIDs, err := h.deleteDatabaseRecords(
		ctx, user.ID, adminSuccessorID, plan.personalOrganizationIDs, workspaceIDs, plan.retainedSuccessors, objectKeys,
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to delete account records")
	}
	if err := h.deleteStoredObjectKeys(ctx, objectKeys); err != nil {
		log.Printf("account %s deleted; %d deferred object cleanup jobs will retry: %v", user.ID, len(cleanupJobIDs), err)
	} else if len(cleanupJobIDs) > 0 {
		_, _ = h.db.NewDelete().Model((*models.Job)(nil)).Where("id IN (?)", bun.List(cleanupJobIDs)).Exec(ctx)
	}

	out := &DeleteAccountOutput{}
	out.SetCookie = expiredSessionCookie(middleware.IsSecureRequest(ctx)).String()
	out.Body.Deleted = true
	return out, nil
}

func (h *AccountLifecycleHandler) reauthenticate(
	ctx context.Context,
	password,
	grant,
	action string,
) (*models.User, error) {
	var user models.User
	if err := h.db.NewSelect().Model(&user).Where("id = ?", middleware.GetUserID(ctx)).Scan(ctx); err != nil {
		return nil, huma.Error401Unauthorized("account not found")
	}
	if h.identity != nil && strings.TrimSpace(grant) != "" {
		if err := h.identity.ConsumeReauthGrant(
			ctx,
			grant,
			user.ID,
			middleware.GetSessionID(ctx),
			action,
		); err == nil {
			return &user, nil
		}
		return nil, huma.Error401Unauthorized("recent reauthentication is required")
	}
	passwordAllowed := true
	if h.identity != nil {
		allowed, err := h.identity.PasswordCredentialAllowed(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to evaluate reauthentication policy")
		}
		passwordAllowed = allowed
	}
	if !passwordAllowed || h.auth == nil || !h.auth.CheckPassword(password, user.PasswordHash) {
		return nil, huma.Error401Unauthorized("recent reauthentication is required")
	}
	return &user, nil
}

func (h *AccountLifecycleHandler) buildExport(ctx context.Context, user *models.User) (AccountExport, error) {
	exported := AccountExport{
		FormatVersion: "2",
		GeneratedAt:   time.Now().UTC(),
		User: AccountExportUser{
			ID: user.ID, Email: user.Email, DisplayName: user.DisplayName, AvatarURL: user.AvatarURL,
			IsAdmin: user.IsAdmin, TermsVersion: user.TermsVersion, PrivacyVersion: user.PrivacyVersion,
			LegalAcceptedAt: user.LegalAcceptedAt, CreatedAt: user.CreatedAt,
		},
		Organizations:             []AccountExportOrganization{},
		Workspaces:                []AccountExportWorkspace{},
		SocialAccounts:            []AccountExportSocialAccount{},
		Publications:              []AccountExportPublication{},
		Posts:                     []AccountExportPost{},
		Media:                     []AccountExportMedia{},
		APITokens:                 []AccountExportToken{},
		PublicationAuthorizations: []AccountExportPublicationAuthorization{},
	}
	if err := h.loadExportMemberships(ctx, user.ID, &exported); err != nil {
		return AccountExport{}, err
	}
	if err := h.loadExportPersonalWorkspaceData(ctx, user.ID, &exported); err != nil {
		return AccountExport{}, err
	}
	if err := h.loadExportUserContent(ctx, user.ID, &exported); err != nil {
		return AccountExport{}, err
	}
	return exported, nil
}

func (h *AccountLifecycleHandler) loadExportMemberships(ctx context.Context, userID string, exported *AccountExport) error {
	if err := h.db.NewSelect().TableExpr("organizations AS o").
		ColumnExpr("o.id, o.name, om.role, o.created_at").
		Join("JOIN organization_members AS om ON om.organization_id = o.id").
		Where("om.user_id = ?", userID).OrderExpr("o.created_at ASC").Scan(ctx, &exported.Organizations); !isNoRowsOrNil(err) {
		return err
	}
	if err := h.db.NewSelect().TableExpr("workspaces AS w").
		ColumnExpr("w.id, w.organization_id, w.name, wm.role, w.timezone, w.created_at").
		Join("JOIN workspace_members AS wm ON wm.workspace_id = w.id").
		Where("wm.user_id = ?", userID).OrderExpr("w.created_at ASC").Scan(ctx, &exported.Workspaces); !isNoRowsOrNil(err) {
		return err
	}
	return nil
}

func (h *AccountLifecycleHandler) loadExportPersonalWorkspaceData(ctx context.Context, userID string, exported *AccountExport) error {
	workspaceIDs := make([]string, 0, len(exported.Workspaces))
	for _, workspace := range exported.Workspaces {
		workspaceIDs = append(workspaceIDs, workspace.ID)
	}
	plan, err := h.planOrganizationDeletion(ctx, userID)
	if err != nil {
		return err
	}
	personalWorkspaceIDs, err := h.workspaceIDsForOrganizations(ctx, plan.personalOrganizationIDs)
	if err != nil {
		return err
	}
	exported.SharedWorkspaceContentExcluded = len(personalWorkspaceIDs) < len(workspaceIDs)
	if len(personalWorkspaceIDs) == 0 {
		return nil
	}
	if err := h.db.NewSelect().Model((*models.SocialAccount)(nil)).
		Column("id", "workspace_id", "platform", "account_id", "account_username", "instance_url", "is_active", "granted_scopes", "created_at").
		Where("workspace_id IN (?)", bun.List(personalWorkspaceIDs)).Order("created_at ASC").Scan(ctx, &exported.SocialAccounts); !isNoRowsOrNil(err) {
		return err
	}
	if err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Column("id", "workspace_id", "mime_type", "size", "original_filename", "width", "height", "duration_ms", "alt_text", "created_at").
		Where("workspace_id IN (?)", bun.List(personalWorkspaceIDs)).Order("created_at ASC").Scan(ctx, &exported.Media); !isNoRowsOrNil(err) {
		return err
	}
	return nil
}

func (h *AccountLifecycleHandler) loadExportUserContent(ctx context.Context, userID string, exported *AccountExport) error {
	if err := h.db.NewSelect().Model((*models.Publication)(nil)).
		Column("id", "workspace_id", "title", "content_profile", "source_text", "source_url", "status", "scheduled_at", "created_at", "updated_at").
		Where("created_by = ?", userID).Order("created_at ASC").Scan(ctx, &exported.Publications); !isNoRowsOrNil(err) {
		return err
	}
	if err := h.db.NewSelect().Model((*models.APIToken)(nil)).
		Column("id", "name", "token_prefix", "scope", "workspace_id", "last_used_at", "revoked_at", "created_at").
		Where("user_id = ?", userID).Order("created_at ASC").Scan(ctx, &exported.APITokens); !isNoRowsOrNil(err) {
		return err
	}
	var authorizations []models.PublicationAuthorization
	if err := h.db.NewSelect().Model(&authorizations).
		Where("actor_user_id = ?", userID).
		Order("confirmed_at ASC", "id ASC").Scan(ctx); !isNoRowsOrNil(err) {
		return err
	}
	for _, authorization := range authorizations {
		exported.PublicationAuthorizations = append(exported.PublicationAuthorizations, AccountExportPublicationAuthorization{
			ID: authorization.ID, BatchID: authorization.BatchID,
			PublicationID: authorization.PublicationID, RenditionID: authorization.RenditionID,
			Action: authorization.Action, ActorOrigin: authorization.ActorOrigin,
			ActorClientID: authorization.ActorClientID, ActorClientName: authorization.ActorClientName,
			SessionIdentityStored: authorization.ActorSessionID != "",
			TokenIdentityStored:   authorization.ActorTokenID != "",
			PublicationRevision:   authorization.PublicationRevision,
			SocialAccountID:       authorization.SocialAccountID, TargetKey: authorization.TargetKey,
			ScheduledAt: authorization.ScheduledAt, PolicyMode: authorization.PolicyMode,
			ConfirmedAt:          authorization.ConfirmedAt,
			FingerprintsRecorded: authorization.ContentHash != "" && authorization.MediaHash != "" && authorization.SettingsHash != "",
		})
	}
	return nil
}

func isNoRowsOrNil(err error) bool {
	return err == nil || errors.Is(err, sql.ErrNoRows)
}

func (h *AccountLifecycleHandler) loadDeletionImpact(ctx context.Context, userID string) (AccountDeletionImpact, error) {
	impact := AccountDeletionImpact{
		Blockers:           []DeletionBlocker{},
		OwnershipTransfers: []DeletionOwnershipTransfer{},
	}
	plan, err := h.planOrganizationDeletion(ctx, userID)
	if err != nil {
		return impact, err
	}
	impact.Organizations = len(plan.personalOrganizationIDs)
	impact.Blockers = append(impact.Blockers, plan.blockers...)
	impact.OwnershipTransfers = append(impact.OwnershipTransfers, plan.ownershipTransfers...)
	if err := h.appendLegacyMembershipBlockers(ctx, userID, &impact); err != nil {
		return impact, err
	}
	workspaceIDs, err := h.workspaceIDsForOrganizations(ctx, plan.personalOrganizationIDs)
	if err != nil {
		return impact, err
	}
	impact.Workspaces = len(workspaceIDs)
	if err := h.countDeletionWorkspaceData(ctx, workspaceIDs, &impact); err != nil {
		return impact, err
	}
	if err := h.appendBillingBlockers(ctx, userID, &impact); err != nil {
		return impact, err
	}
	_, successorEmail, err := h.planInstanceAdminTransfer(ctx, userID)
	if err != nil {
		return impact, err
	}
	if successorEmail != "" {
		impact.InstanceAdminTransfer = &DeletionInstanceAdminTransfer{SuccessorEmail: successorEmail}
	}
	sort.Slice(impact.Blockers, func(i, j int) bool {
		return impact.Blockers[i].Code+impact.Blockers[i].OrganizationID < impact.Blockers[j].Code+impact.Blockers[j].OrganizationID
	})
	sort.Slice(impact.OwnershipTransfers, func(i, j int) bool {
		return impact.OwnershipTransfers[i].OrganizationID < impact.OwnershipTransfers[j].OrganizationID
	})
	return impact, nil
}

func (h *AccountLifecycleHandler) appendLegacyMembershipBlockers(ctx context.Context, userID string, impact *AccountDeletionImpact) error {
	workspaceIDs, err := h.userWorkspaceIDs(ctx, userID)
	if err != nil || len(workspaceIDs) == 0 {
		return err
	}
	organizationIDs, _, err := h.organizationMemberships(ctx, userID)
	if err != nil {
		return err
	}
	var workspaces []models.Workspace
	if err := h.db.NewSelect().Model(&workspaces).Column("id", "organization_id").
		Where("id IN (?)", bun.List(workspaceIDs)).Scan(ctx); !isNoRowsOrNil(err) {
		return err
	}
	organizationSet := make(map[string]struct{}, len(organizationIDs))
	for _, organizationID := range organizationIDs {
		organizationSet[organizationID] = struct{}{}
	}
	for _, workspace := range workspaces {
		_, hasOrganizationMembership := organizationSet[workspace.OrganizationID]
		if strings.TrimSpace(workspace.OrganizationID) == "" || !hasOrganizationMembership {
			impact.Blockers = append(impact.Blockers, DeletionBlocker{
				Code: "legacy_workspace_membership", WorkspaceID: workspace.ID,
				Message: "Ask the instance operator to remove this legacy workspace membership before deleting the account.",
			})
		}
	}
	return nil
}

func (h *AccountLifecycleHandler) countDeletionWorkspaceData(ctx context.Context, workspaceIDs []string, impact *AccountDeletionImpact) error {
	if len(workspaceIDs) == 0 {
		return nil
	}
	for target, model := range map[*int]any{
		&impact.SocialAccounts: (*models.SocialAccount)(nil),
		&impact.Publications:   (*models.Publication)(nil),
		&impact.Media:          (*models.MediaAttachment)(nil),
	} {
		count, err := h.db.NewSelect().Model(model).Where("workspace_id IN (?)", bun.List(workspaceIDs)).Count(ctx)
		if err != nil {
			return err
		}
		*target = count
	}
	return nil
}

func (h *AccountLifecycleHandler) appendBillingBlockers(ctx context.Context, userID string, impact *AccountDeletionImpact) error {
	_, organizationIDs, err := h.organizationMemberships(ctx, userID)
	if err != nil {
		return err
	}
	for _, organizationID := range organizationIDs {
		active, err := h.db.NewSelect().Model((*models.BillingSubscription)(nil)).
			Where("organization_id = ? AND status IN (?)", organizationID, bun.List(activeBillingStatuses)).
			Where("provider IN (?)", bun.List(models.BillingGrantingProviders)).
			Exists(ctx)
		if err != nil {
			return err
		}
		if active {
			impact.Blockers = append(impact.Blockers, DeletionBlocker{
				Code: "active_billing", OrganizationID: organizationID,
				Message: "Cancel the active hosted subscription in the customer portal before deleting this account.",
			})
		}
	}
	return nil
}

func (h *AccountLifecycleHandler) planInstanceAdminTransfer(ctx context.Context, userID string) (string, string, error) {
	var user models.User
	if err := h.db.NewSelect().Model(&user).Column("is_admin").Where("id = ?", userID).Scan(ctx); err != nil {
		return "", "", err
	}
	if !user.IsAdmin {
		return "", "", nil
	}
	otherAdmins, err := h.db.NewSelect().Model((*models.User)(nil)).Where("id != ? AND is_admin = ?", userID, true).Count(ctx)
	if err != nil {
		return "", "", err
	}
	if otherAdmins > 0 {
		return "", "", nil
	}
	var successor struct {
		ID    string `bun:"id"`
		Email string `bun:"email"`
	}
	err = h.db.NewSelect().Model((*models.User)(nil)).
		Column("id", "email").
		Where("id != ?", userID).
		OrderExpr("created_at ASC").
		OrderExpr("id ASC").
		Limit(1).
		Scan(ctx, &successor)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", nil
	}
	return successor.ID, successor.Email, err
}

func (h *AccountLifecycleHandler) organizationMemberships(ctx context.Context, userID string) ([]string, []string, error) {
	var memberships []models.OrganizationMember
	if err := h.db.NewSelect().Model(&memberships).Where("user_id = ?", userID).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, err
	}
	all := make([]string, 0, len(memberships))
	owners := make([]string, 0, len(memberships))
	for _, membership := range memberships {
		all = append(all, membership.OrganizationID)
		if membership.Role == models.OrganizationRoleOwner {
			owners = append(owners, membership.OrganizationID)
		}
	}
	return all, owners, nil
}

func (h *AccountLifecycleHandler) userWorkspaceIDs(ctx context.Context, userID string) ([]string, error) {
	var memberships []models.WorkspaceMember
	if err := h.db.NewSelect().Model(&memberships).Column("workspace_id").Where("user_id = ?", userID).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	ids := make([]string, 0, len(memberships))
	for _, membership := range memberships {
		ids = append(ids, membership.WorkspaceID)
	}
	return ids, nil
}

func (h *AccountLifecycleHandler) planOrganizationDeletion(ctx context.Context, userID string) (deletionOrganizationPlan, error) {
	plan := deletionOrganizationPlan{
		personalOrganizationIDs: []string{},
		retainedSuccessors:      map[string]string{},
		ownershipTransfers:      []DeletionOwnershipTransfer{},
		blockers:                []DeletionBlocker{},
	}
	var memberships []struct {
		OrganizationID   string `bun:"organization_id"`
		OrganizationName string `bun:"organization_name"`
		Role             string `bun:"role"`
	}
	if err := h.db.NewSelect().
		TableExpr("organization_members AS om").
		ColumnExpr("om.organization_id, o.name AS organization_name, om.role").
		Join("JOIN organizations AS o ON o.id = om.organization_id").
		Where("om.user_id = ?", userID).
		Order("om.organization_id ASC").
		Scan(ctx, &memberships); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return plan, err
	}
	for _, membership := range memberships {
		memberCount, err := h.db.NewSelect().Model((*models.OrganizationMember)(nil)).
			Where("organization_id = ?", membership.OrganizationID).Count(ctx)
		if err != nil {
			return plan, err
		}
		if memberCount == 1 && membership.Role == models.OrganizationRoleOwner {
			plan.personalOrganizationIDs = append(plan.personalOrganizationIDs, membership.OrganizationID)
			continue
		}
		if memberCount <= 1 {
			plan.blockers = append(plan.blockers, DeletionBlocker{
				Code: "orphaned_organization_membership", OrganizationID: membership.OrganizationID,
				Message: "Ask the instance operator to repair this organization membership before deleting the account.",
			})
			continue
		}

		var successor struct {
			UserID string `bun:"user_id"`
			Email  string `bun:"email"`
		}
		if err := h.db.NewSelect().
			TableExpr("organization_members AS om").
			ColumnExpr("om.user_id, u.email").
			Join("JOIN users AS u ON u.id = om.user_id").
			Where("om.organization_id = ? AND om.user_id != ?", membership.OrganizationID, userID).
			OrderExpr("CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC").
			OrderExpr("om.created_at ASC").
			Limit(1).
			Scan(ctx, &successor); err != nil {
			return plan, err
		}
		plan.retainedSuccessors[membership.OrganizationID] = successor.UserID
		if membership.Role == models.OrganizationRoleOwner {
			plan.ownershipTransfers = append(plan.ownershipTransfers, DeletionOwnershipTransfer{
				OrganizationID: membership.OrganizationID, OrganizationName: membership.OrganizationName,
				SuccessorEmail: successor.Email,
			})
		}
	}
	return plan, nil
}

func (h *AccountLifecycleHandler) workspaceIDsForOrganizations(ctx context.Context, organizationIDs []string) ([]string, error) {
	if len(organizationIDs) == 0 {
		return []string{}, nil
	}
	var workspaces []models.Workspace
	if err := h.db.NewSelect().Model(&workspaces).Column("id").Where("organization_id IN (?)", bun.List(organizationIDs)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	ids := make([]string, 0, len(workspaces))
	for _, workspace := range workspaces {
		ids = append(ids, workspace.ID)
	}
	return ids, nil
}

func (h *AccountLifecycleHandler) storedObjectKeys(ctx context.Context, user *models.User, workspaceIDs []string) ([]string, error) {
	keys := make(map[string]struct{})
	if user.AvatarObjectKey != "" {
		keys[user.AvatarObjectKey] = struct{}{}
	}
	if len(workspaceIDs) > 0 {
		var media []models.MediaAttachment
		if err := h.db.NewSelect().Model(&media).
			Column("file_path", "thumbnail_object_key", "thumbnails").
			Where("workspace_id IN (?)", bun.List(workspaceIDs)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		for _, item := range media {
			for _, key := range []string{filepath.Base(item.FilePath), item.ThumbnailObjectKey} {
				if strings.TrimSpace(key) != "" {
					keys[key] = struct{}{}
				}
			}
			var thumbnails map[string]string
			if json.Unmarshal([]byte(item.ThumbnailsJSON), &thumbnails) == nil {
				for _, key := range thumbnails {
					if strings.TrimSpace(key) != "" {
						keys[key] = struct{}{}
					}
				}
			}
		}
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	return ordered, nil
}

func (h *AccountLifecycleHandler) deleteStoredObjectKeys(ctx context.Context, keys []string) error {
	if h.storage == nil {
		return nil
	}
	for _, key := range keys {
		if err := h.storage.Delete(ctx, key); err != nil {
			return fmt.Errorf("delete stored object %q: %w", key, err)
		}
	}
	return nil
}

func (h *AccountLifecycleHandler) deleteDatabaseRecords(
	ctx context.Context,
	userID string,
	adminSuccessorID string,
	personalOrganizationIDs []string,
	workspaceIDs []string,
	retainedSuccessors map[string]string,
	objectKeys []string,
) ([]string, error) {
	var cleanupJobIDs []string
	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := transferInstanceAdministration(txCtx, tx, userID, adminSuccessorID); err != nil {
			return err
		}
		var err error
		cleanupJobIDs, err = workspacedeletion.EnqueueStorageCleanup(txCtx, tx, objectKeys)
		if err != nil {
			return err
		}
		if err := transferRetainedOrganizations(txCtx, tx, userID, retainedSuccessors); err != nil {
			return err
		}
		if len(workspaceIDs) > 0 {
			if err := workspacedeletion.DeleteWorkspaceData(txCtx, tx, workspaceIDs); err != nil {
				return err
			}
		}
		if err := deletePersonalOrganizations(txCtx, tx, personalOrganizationIDs); err != nil {
			return err
		}
		if err := deleteUserScopedData(txCtx, tx, userID); err != nil {
			return err
		}
		return deleteUserRow(txCtx, tx, userID)
	})
	return cleanupJobIDs, err
}

func transferInstanceAdministration(ctx context.Context, tx bun.Tx, userID, successorID string) error {
	var user models.User
	if err := tx.NewSelect().Model(&user).Column("is_admin").Where("id = ?", userID).Scan(ctx); err != nil {
		return err
	}
	if !user.IsAdmin {
		return nil
	}
	otherAdmins, err := tx.NewSelect().Model((*models.User)(nil)).
		Where("id != ? AND is_admin = ?", userID, true).
		Count(ctx)
	if err != nil || otherAdmins > 0 {
		return err
	}
	otherUsers, err := tx.NewSelect().Model((*models.User)(nil)).Where("id != ?", userID).Count(ctx)
	if err != nil || otherUsers == 0 {
		return err
	}
	if successorID == "" {
		return errors.New("instance administrator successor is required")
	}
	result, err := tx.NewUpdate().Model((*models.User)(nil)).
		Set("is_admin = ?", true).
		Where("id = ? AND id != ?", successorID, userID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("instance administrator successor changed; review account deletion again")
	}
	return nil
}

func transferRetainedOrganizations(ctx context.Context, tx bun.Tx, userID string, successors map[string]string) error {
	for organizationID, successorID := range successors {
		if err := transferRetainedOrganization(ctx, tx, userID, organizationID, successorID); err != nil {
			return err
		}
	}
	return nil
}

func transferRetainedOrganization(ctx context.Context, tx bun.Tx, userID, organizationID, successorID string) error {
	wasOwner, err := tx.NewSelect().Model((*models.OrganizationMember)(nil)).
		Where("organization_id = ? AND user_id = ? AND role = ?", organizationID, userID, models.OrganizationRoleOwner).
		Exists(ctx)
	if err != nil {
		return err
	}
	if wasOwner {
		if _, err := tx.NewUpdate().Model((*models.OrganizationMember)(nil)).
			Set("role = ?", models.OrganizationRoleOwner).
			Where("organization_id = ? AND user_id = ?", organizationID, successorID).
			Exec(ctx); err != nil {
			return err
		}
	}
	if _, err := tx.NewUpdate().Model((*models.Organization)(nil)).
		Set("created_by = ?", successorID).
		Where("id = ? AND created_by = ?", organizationID, userID).
		Exec(ctx); err != nil {
		return err
	}
	var workspaceIDs []string
	if err := tx.NewSelect().Model((*models.Workspace)(nil)).Column("id").
		Where("organization_id = ?", organizationID).Scan(ctx, &workspaceIDs); !isNoRowsOrNil(err) {
		return err
	}
	if len(workspaceIDs) > 0 {
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("created_by = ?", successorID).
			Where("created_by = ? AND workspace_id IN (?)", userID, bun.List(workspaceIDs)).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func deletePersonalOrganizations(ctx context.Context, tx bun.Tx, organizationIDs []string) error {
	if len(organizationIDs) == 0 {
		return nil
	}
	for _, deletion := range []struct {
		model any
		where string
	}{
		{(*models.BillingSubscription)(nil), "organization_id IN (?)"},
		{(*models.OrganizationInvitation)(nil), "organization_id IN (?)"},
		{(*models.OrganizationMember)(nil), "organization_id IN (?)"},
		{(*models.Organization)(nil), "id IN (?)"},
	} {
		if _, err := tx.NewDelete().Model(deletion.model).Where(deletion.where, bun.List(organizationIDs)).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func deleteUserScopedData(ctx context.Context, tx bun.Tx, userID string) error {
	if _, err := tx.NewDelete().Model((*models.PublicationAuthorization)(nil)).Where("actor_user_id = ?", userID).Exec(ctx); err != nil {
		return err
	}
	for _, invitation := range []any{(*models.OrganizationInvitation)(nil), (*models.WorkspaceInvitation)(nil)} {
		if _, err := tx.NewDelete().Model(invitation).Where("invited_by_user_id = ?", userID).Exec(ctx); err != nil {
			return err
		}
	}
	if err := workspacedeletion.DeleteJobsReferencing(ctx, tx, map[string]struct{}{userID: {}}); err != nil {
		return err
	}
	for _, model := range []any{
		(*models.UserPasskey)(nil), (*models.UserSession)(nil), (*models.AuthChallenge)(nil),
		(*models.PasswordResetToken)(nil), (*models.APIToken)(nil), (*models.MCPOAuthCode)(nil),
		(*models.CLIAuthSession)(nil), (*models.MCPToolCall)(nil), (*models.XOAuthRequestToken)(nil),
		(*models.OAuthAccountSelection)(nil), (*models.Prompt)(nil), (*models.WorkspaceMember)(nil),
		(*models.OrganizationMember)(nil),
	} {
		if _, err := tx.NewDelete().Model(model).Where("user_id = ?", userID).Exec(ctx); err != nil {
			return err
		}
	}
	for _, invitation := range []any{(*models.OrganizationInvitation)(nil), (*models.WorkspaceInvitation)(nil)} {
		if _, err := tx.NewUpdate().Model(invitation).Set("accepted_by_user_id = NULL").Where("accepted_by_user_id = ?", userID).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func deleteUserRow(ctx context.Context, tx bun.Tx, userID string) error {
	result, err := tx.NewDelete().Model((*models.User)(nil)).Where("id = ?", userID).Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return fmt.Errorf("delete user: expected one row")
	}
	return nil
}
