package workspaceaccess

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/uptrace/bun"
)

// Level is the required Workspace access level for an application action.
type Level string

const (
	LevelRead       Level = "read"
	LevelEdit       Level = "edit"
	LevelAdminister Level = "administer"
)

// ActorFacts are the transport-independent facts known after authentication.
type ActorFacts struct {
	UserID                 string
	SessionID              string
	TokenID                string
	ClientID               string
	CredentialWorkspaceID  string
	ExternalInstallationID string
}

// StoredAuthority is exact authorization evidence persisted by a workflow
// while an authenticated actor is present. Recovery and token-consumption
// paths use it instead of fabricating a current actor.
type StoredAuthority struct {
	UserID             string
	WorkspaceID        string
	OrganizationID     string
	IdentityProviderID string
	AssuredAt          time.Time
}

// Decision separates a safe authorization denial from an operational failure.
type Decision struct {
	Allowed        bool
	Level          Level
	Role           string
	Reason         string
	SSORequired    bool
	OrganizationID string
	ProviderID     string
	ProviderName   string
}

// Authorizer evaluates Workspace access using credential scope, Organization
// identity policy, active Workspace membership, and the role level required by
// the action. The DB may be a transaction so mutation callers can authorize
// against locked rows before writing.
type Authorizer struct {
	db bun.IDB
}

func NewAuthorizer(db bun.IDB) Authorizer {
	return Authorizer{db: db}
}

// CredentialAllowsWorkspace applies only the authenticated credential's
// optional Workspace boundary. It is used before membership exists, such as
// invitation acceptance; ordinary application actions use Authorize.
func CredentialAllowsWorkspace(actor ActorFacts, workspaceID string) bool {
	actor = normalizeActor(actor)
	workspaceID = strings.TrimSpace(workspaceID)
	return workspaceID != "" && (actor.CredentialWorkspaceID == "" || actor.CredentialWorkspaceID == workspaceID)
}

// AuthorizePreMembership verifies the credential boundary and Organization
// identity policy for a flow that may create membership. Invitation acceptance
// is the only ordinary caller; content actions must use Authorize.
func (a Authorizer) AuthorizePreMembership(ctx context.Context, workspaceID string, actor ActorFacts) (Decision, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	actor = normalizeActor(actor)
	decision := Decision{Level: LevelRead}
	if actor.UserID == "" || !CredentialAllowsWorkspace(actor, workspaceID) {
		decision.Reason = "credential is bound to another workspace"
		return decision, nil
	}
	identityDecision, err := identity.EvaluateWorkspaceAccess(ctx, a.db, workspaceID, actor.UserID, actor.SessionID, actor.TokenID)
	if err != nil {
		return Decision{}, err
	}
	applyIdentityDecision(&decision, identityDecision)
	if !identityDecision.Allowed {
		decision.Reason = firstNonEmpty(identityDecision.Reason, "credential does not satisfy organization policy")
		return decision, nil
	}
	decision.Allowed = true
	return decision, nil
}

func (a Authorizer) Authorize(ctx context.Context, workspaceID string, actor ActorFacts, level Level) (Decision, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	actor = normalizeActor(actor)
	level = normalizeLevel(level)
	decision := Decision{Level: level}
	if workspaceID == "" || actor.UserID == "" {
		decision.Reason = "workspace access denied"
		return decision, nil
	}
	if actor.CredentialWorkspaceID != "" && actor.CredentialWorkspaceID != workspaceID {
		decision.Reason = "credential is bound to another workspace"
		return decision, nil
	}
	if actor.ExternalInstallationID != "" {
		count, err := a.db.NewSelect().TableExpr("external_app_workspace_grants AS grant").
			Join("JOIN external_app_installations AS installation ON installation.id = grant.installation_id").
			Where("grant.installation_id = ? AND grant.workspace_id = ?", actor.ExternalInstallationID, workspaceID).
			Where("installation.sponsor_user_id = ?", actor.UserID).
			Where("installation.revoked_at IS NULL AND grant.revoked_at IS NULL").Count(ctx)
		if err != nil {
			return Decision{}, err
		}
		if count != 1 {
			decision.Reason = "external application is not granted this workspace"
			return decision, nil
		}
		level = LevelAdminister
		decision.Level = level
	}

	var member models.WorkspaceMember
	err := a.db.NewSelect().Model(&member).
		Where("workspace_id = ? AND user_id = ? AND status = ?", workspaceID, actor.UserID, models.WorkspaceMemberStatusActive).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		decision.Reason = "active workspace membership required"
		return decision, nil
	}
	if err != nil {
		return Decision{}, err
	}
	decision.Role = member.Role
	if !roleMeetsLevel(member.Role, level) {
		decision.Reason = "workspace role does not allow this action"
		return decision, nil
	}

	identityDecision, err := identity.EvaluateWorkspaceAccess(
		ctx,
		a.db,
		workspaceID,
		actor.UserID,
		actor.SessionID,
		actor.TokenID,
	)
	if err != nil {
		return Decision{}, err
	}
	applyIdentityDecision(&decision, identityDecision)
	if !identityDecision.Allowed {
		decision.Reason = firstNonEmpty(identityDecision.Reason, "credential does not satisfy organization policy")
		return decision, nil
	}
	decision.Allowed = true
	return decision, nil
}

// AuthorizeStored verifies the exact persisted Workspace scope and current
// membership level. Identity assurance is the immutable evidence accepted by
// the initiating flow; this path never represents it as a live session/token.
func (a Authorizer) AuthorizeStored(ctx context.Context, authority StoredAuthority, level Level) (Decision, error) {
	authority.UserID = strings.TrimSpace(authority.UserID)
	authority.WorkspaceID = strings.TrimSpace(authority.WorkspaceID)
	authority.OrganizationID = strings.TrimSpace(authority.OrganizationID)
	decision := Decision{Level: normalizeLevel(level)}
	if authority.UserID == "" || authority.WorkspaceID == "" {
		decision.Reason = "stored workspace authority is incomplete"
		return decision, nil
	}
	var workspace models.Workspace
	if err := a.db.NewSelect().Model(&workspace).Column("id", "organization_id").Where("id = ?", authority.WorkspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			decision.Reason = "stored workspace authority is unavailable"
			return decision, nil
		}
		return Decision{}, err
	}
	if authority.OrganizationID != "" && authority.OrganizationID != workspace.OrganizationID {
		decision.Reason = "stored organization scope no longer matches workspace"
		return decision, nil
	}
	var member models.WorkspaceMember
	if err := a.db.NewSelect().Model(&member).
		Where("workspace_id = ? AND user_id = ? AND status = ?", authority.WorkspaceID, authority.UserID, models.WorkspaceMemberStatusActive).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			decision.Reason = "active workspace membership required"
			return decision, nil
		}
		return Decision{}, err
	}
	decision.Role = member.Role
	if !roleMeetsLevel(member.Role, level) {
		decision.Reason = "workspace role does not allow this action"
		return decision, nil
	}
	decision.Allowed = true
	decision.OrganizationID = workspace.OrganizationID
	decision.ProviderID = strings.TrimSpace(authority.IdentityProviderID)
	return decision, nil
}

func applyIdentityDecision(decision *Decision, identityDecision identity.WorkspaceAccessDecision) {
	decision.SSORequired = identityDecision.SSORequired
	decision.OrganizationID = identityDecision.OrganizationID
	decision.ProviderID = identityDecision.ProviderID
	decision.ProviderName = identityDecision.ProviderName
}

func normalizeActor(actor ActorFacts) ActorFacts {
	actor.UserID = strings.TrimSpace(actor.UserID)
	actor.SessionID = strings.TrimSpace(actor.SessionID)
	actor.TokenID = strings.TrimSpace(actor.TokenID)
	actor.ClientID = strings.TrimSpace(actor.ClientID)
	actor.CredentialWorkspaceID = strings.TrimSpace(actor.CredentialWorkspaceID)
	actor.ExternalInstallationID = strings.TrimSpace(actor.ExternalInstallationID)
	return actor
}

func normalizeLevel(level Level) Level {
	switch level {
	case LevelEdit, LevelAdminister:
		return level
	default:
		return LevelRead
	}
}

func roleMeetsLevel(role string, level Level) bool {
	switch normalizeLevel(level) {
	case LevelRead:
		return role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor || role == models.WorkspaceRoleViewer
	case LevelEdit:
		return role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor
	case LevelAdminister:
		return role == models.WorkspaceRoleAdmin
	default:
		return false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
