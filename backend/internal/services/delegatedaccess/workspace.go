// Package delegatedaccess revalidates the workspace authority captured by an
// external application grant without depending on an HTTP credential.
package delegatedaccess

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func WorkspaceAllowed(ctx context.Context, db bun.IDB, installationID, sponsorUserID, workspaceID string) (bool, error) {
	grant, err := activeGrant(ctx, db, installationID, sponsorUserID, workspaceID)
	if err != nil || grant == nil {
		return false, err
	}
	return grantSatisfiesOrganizationPolicy(ctx, db, *grant)
}

func activeGrant(ctx context.Context, db bun.IDB, installationID, sponsorUserID, workspaceID string) (*models.ExternalAppWorkspaceGrant, error) {
	var grant models.ExternalAppWorkspaceGrant
	err := db.NewSelect().Model(&grant).
		Join("JOIN external_app_installations AS installation ON installation.id = external_app_workspace_grant.installation_id").
		Join("JOIN workspace_members AS member ON member.workspace_id = external_app_workspace_grant.workspace_id AND member.user_id = installation.sponsor_user_id").
		Join("JOIN workspaces AS workspace ON workspace.id = external_app_workspace_grant.workspace_id").
		Where("external_app_workspace_grant.installation_id = ? AND external_app_workspace_grant.workspace_id = ?", strings.TrimSpace(installationID), strings.TrimSpace(workspaceID)).
		Where("installation.sponsor_user_id = ? AND installation.revoked_at IS NULL AND external_app_workspace_grant.revoked_at IS NULL", strings.TrimSpace(sponsorUserID)).
		Where("member.status = ? AND member.role = ?", models.WorkspaceMemberStatusActive, models.WorkspaceRoleAdmin).
		Where("workspace.organization_id = external_app_workspace_grant.organization_id").
		Column("external_app_workspace_grant.*").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &grant, nil
}

func grantSatisfiesOrganizationPolicy(ctx context.Context, db bun.IDB, grant models.ExternalAppWorkspaceGrant) (bool, error) {
	if grant.OrganizationID == "" {
		return true, nil
	}
	var policy models.OrganizationSSOPolicy
	err := db.NewSelect().Model(&policy).Where("organization_id = ?", grant.OrganizationID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) || missingPolicyTable(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if policy.Mode != models.OrganizationSSOModeRequired {
		return true, nil
	}
	if !delegatedTokenModeAllowed(policy.APITokenMode) ||
		(!grant.CredentialExpiresAt.IsZero() && !grant.CredentialExpiresAt.After(time.Now().UTC())) {
		return false, nil
	}
	var providerIDs []string
	if json.Unmarshal([]byte(policy.ProviderIDs), &providerIDs) != nil ||
		!slices.Contains(providerIDs, grant.IdentityProviderID) || grant.AssuredAt.IsZero() {
		return false, nil
	}
	maxAge := time.Duration(policy.AssuranceMaxAgeSeconds) * time.Second
	if maxAge <= 0 || grant.AssuredAt.Add(maxAge).Before(time.Now().UTC()) {
		return false, nil
	}
	count, err := db.NewSelect().Model((*models.IdentityProvider)(nil)).
		Where("id = ? AND is_active = ?", grant.IdentityProviderID, true).Count(ctx)
	return count == 1, err
}

func delegatedTokenModeAllowed(mode string) bool {
	return mode == models.OrganizationSSOTokensScoped || mode == "allow"
}

func missingPolicyTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: organization_sso_policies") ||
		(strings.Contains(message, `relation "organization_sso_policies"`) && strings.Contains(message, "does not exist"))
}
