package workspaceaccess

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/openpost/backend/internal/textutil"

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
	// LevelConnect covers starting and completing an account connection. It sits
	// below LevelEdit on purpose: connecting an account changes who may publish
	// as that account, but it does not change any content.
	LevelConnect Level = "connect"
	// LevelApprove covers deciding a parked approval. It is separate from
	// LevelAdminister so a role can be trusted with a decision without being
	// trusted with the workspace.
	LevelApprove Level = "approve"
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
		decision.Reason = textutil.FirstNonEmpty(identityDecision.Reason, "credential does not satisfy organization policy")
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
		decision.Reason = textutil.FirstNonEmpty(identityDecision.Reason, "credential does not satisfy organization policy")
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

// normalizeLevel canonicalizes a requested level. An unrecognized level falls
// back to LevelRead, so every level this package can be asked for must be
// listed here; an omission would silently downgrade the requirement rather
// than deny it.
func normalizeLevel(level Level) Level {
	switch level {
	case LevelEdit, LevelAdminister, LevelConnect, LevelApprove:
		return level
	default:
		return LevelRead
	}
}

// roleMeetsLevel is the single place a role is turned into a capability. Every
// role is listed explicitly in each branch so adding one is a deliberate act.
func roleMeetsLevel(role string, level Level) bool {
	switch normalizeLevel(level) {
	case LevelRead:
		return role == models.WorkspaceRoleAdmin ||
			role == models.WorkspaceRoleEditor ||
			role == models.WorkspaceRoleClient ||
			role == models.WorkspaceRoleViewer
	case LevelConnect:
		return role == models.WorkspaceRoleAdmin ||
			role == models.WorkspaceRoleEditor ||
			role == models.WorkspaceRoleClient
	case LevelApprove:
		return role == models.WorkspaceRoleAdmin ||
			role == models.WorkspaceRoleClient
	case LevelEdit:
		return role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor
	case LevelAdminister:
		return role == models.WorkspaceRoleAdmin
	default:
		return false
	}
}

// RoleMeetsLevel exposes the role-to-capability mapping for callers that have
// already authorized the actor and only need to report a finer-grained
// capability, such as a workspace summary telling the UI whether to offer the
// account-connection controls. It answers only about the role: it does not
// evaluate membership, credential scope, or identity policy, so it must never
// replace Authorize for an action that changes state.
func RoleMeetsLevel(role string, level Level) bool {
	return roleMeetsLevel(role, level)
}

// knownRoles is every role this package can resolve. RolesMeetingLevel derives
// its answer from this list, so a role added to the model without being added
// here would be invisible to that helper.
var knownRoles = []string{
	models.WorkspaceRoleAdmin,
	models.WorkspaceRoleEditor,
	models.WorkspaceRoleClient,
	models.WorkspaceRoleViewer,
}

// RolesMeetingLevel returns the roles that satisfy a level, derived from the
// same matrix that authorizes it. Callers that need to address everyone who may
// perform an action — telling the people who can approve that a post is waiting
// — use this instead of restating the rule, because a restated rule drifts: it
// is written once, the matrix changes, and the audience silently stops
// including the people the action is actually waiting for.
//
// The answer is derived by asking roleMeetsLevel, never by repeating it, so the
// two can never disagree. It is a capability question only; it does not evaluate
// membership, credential scope, or identity policy.
func RolesMeetingLevel(level Level) []string {
	roles := make([]string, 0, len(knownRoles))
	for _, role := range knownRoles {
		if roleMeetsLevel(role, level) {
			roles = append(roles, role)
		}
	}
	return roles
}
