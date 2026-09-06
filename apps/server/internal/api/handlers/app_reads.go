package handlers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var (
	errEvaluateWorkspaceReadAccess = errors.New("evaluate workspace read access")
	errInspectWorkspaceSSOIdentity = errors.New("inspect workspace SSO identity")
	errValidateSettingsReadAccess  = errors.New("validate workspace settings access")
)

type appReadModel struct {
	db            bun.IDB
	accountPolicy AccountPolicy
	identity      *identity.Service
}

type workspaceSettingsRead struct {
	Name                string
	AvatarURL           string
	Color               string
	Timezone            string
	WeekStart           int
	MediaCleanupDays    int
	RandomDelayMinutes  int
	SlotStartHour       int
	SlotEndHour         int
	SlotIntervalMinutes int
}

func (r appReadModel) user(ctx context.Context, userID string) (*models.User, error) {
	user := new(models.User)
	if err := r.db.NewSelect().Model(user).Where("id = ?", userID).Scan(ctx); err != nil {
		return nil, err
	}
	return user, nil
}

func (r appReadModel) userProfile(ctx context.Context, userID string) (*UserProfile, error) {
	user, err := r.user(ctx, userID)
	if err != nil {
		return nil, err
	}
	return r.profileForUser(ctx, user), nil
}

func (r appReadModel) userProfileFromModel(user *models.User) *UserProfile {
	hasPassword := strings.TrimSpace(user.PasswordHash) != ""
	return &UserProfile{
		ID:                         user.ID,
		Email:                      user.Email,
		Username:                   user.Username,
		DisplayName:                user.DisplayName,
		AvatarURL:                  user.AvatarURL,
		PublicProfileEnabled:       user.PublicProfile,
		PublicProfileVisibleFields: publicprofiles.Parse(user.PublicProfileVisibilityJSON).Fields(),
		ComposerExperience:         normalizedComposerExperience(user.ComposerExperience),
		IsAdmin:                    user.IsAdmin,
		HasPassword:                hasPassword,
		PasswordUsable:             hasPassword,
		TermsVersion:               user.TermsVersion,
		PrivacyVersion:             user.PrivacyVersion,
		LegalAcceptedAt:            user.LegalAcceptedAt,
		EmailVerified:              !user.EmailVerifiedAt.IsZero(),
		LegalAcceptanceRequired: r.accountPolicy.Required &&
			(user.LegalAcceptedAt.IsZero() ||
				user.TermsVersion != r.accountPolicy.TermsVersion ||
				user.PrivacyVersion != r.accountPolicy.PrivacyVersion),
		CreatedAt: user.CreatedAt,
	}
}

func (r appReadModel) profileForUser(ctx context.Context, user *models.User) *UserProfile {
	profile := r.userProfileFromModel(user)
	if r.identity == nil {
		return profile
	}
	passwordAllowed, err := r.identity.PasswordCredentialAllowed(ctx, user.ID)
	if err != nil {
		profile.PasswordUsable = false
	} else {
		profile.PasswordUsable = profile.HasPassword && passwordAllowed
	}
	managed, organizationName, err := r.identity.ManagedUserState(ctx, user.ID)
	if err == nil {
		profile.IsManaged = managed
		profile.ManagedOrganizationName = organizationName
	}
	return profile
}

func (r appReadModel) workspaces(ctx context.Context, userID string) ([]WorkspaceResponse, error) {
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
	query := r.db.NewSelect().
		TableExpr("workspaces AS w").
		ColumnExpr("w.id, w.organization_id, w.name, w.avatar_url, w.color, w.created_at, wm.role").
		ColumnExpr("COALESCE(o.name, '') AS organization_name").
		Join("JOIN workspace_members AS wm ON wm.workspace_id = w.id").
		Join("LEFT JOIN organizations AS o ON o.id = w.organization_id").
		Where("wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive)
	if workspaceID := middleware.GetWorkspaceID(ctx); workspaceID != "" {
		query = query.Where("w.id = ?", workspaceID)
	}
	if err := query.Order("organization_name ASC", "w.name ASC").Scan(ctx, &rows); err != nil {
		return nil, err
	}

	workspaces := make([]WorkspaceResponse, 0, len(rows))
	for _, workspace := range rows {
		decision, err := workspaceDecision(ctx, r.db, workspace.ID, userID, workspaceaccess.LevelRead)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", errEvaluateWorkspaceReadAccess, err)
		}
		if middleware.GetTokenID(ctx) != "" && !decision.Allowed {
			continue
		}
		identityLinked := true
		if decision.SSORequired && decision.ProviderID != "" {
			identityLinked, err = r.db.NewSelect().Model((*models.UserIdentity)(nil)).
				Where("user_id = ? AND provider_id = ?", userID, decision.ProviderID).
				Exists(ctx)
			if err != nil {
				return nil, fmt.Errorf("%w: %v", errInspectWorkspaceSSOIdentity, err)
			}
		}
		workspaces = append(workspaces, WorkspaceResponse{
			WorkspaceID:        workspace.ID,
			OrganizationID:     workspace.OrganizationID,
			OrganizationName:   workspace.OrganizationName,
			WorkspaceName:      workspace.Name,
			AvatarURL:          workspace.AvatarURL,
			Color:              normalizedWorkspaceColor(workspace.Color),
			WorkspaceCreatedAt: workspace.CreatedAt.Format(time.RFC3339),
			Role:               workspace.Role,
			CanEdit:            decision.Allowed && (workspace.Role == models.WorkspaceRoleAdmin || workspace.Role == models.WorkspaceRoleEditor),
			SSORequired:        decision.SSORequired,
			SSOAuthenticated:   decision.Allowed,
			SSOProviderID:      decision.ProviderID,
			SSOProviderName:    decision.ProviderName,
			SSOIdentityLinked:  identityLinked,
		})
	}
	return workspaces, nil
}

func (r appReadModel) workspaceSettings(
	ctx context.Context,
	workspaceID string,
	userID string,
) (workspaceSettingsRead, bool, error) {
	allowed, err := workspaceReadAllowed(ctx, r.db, workspaceID, userID)
	if err != nil {
		return workspaceSettingsRead{}, false, fmt.Errorf("%w: %v", errValidateSettingsReadAccess, err)
	}
	if !allowed {
		return workspaceSettingsRead{}, false, nil
	}

	var workspace models.Workspace
	if err := r.db.NewSelect().Model(&workspace).Where("id = ?", workspaceID).Scan(ctx); err != nil {
		return workspaceSettingsRead{}, true, err
	}
	return workspaceSettingsRead{
		Name:                workspace.Name,
		AvatarURL:           workspace.AvatarURL,
		Color:               normalizedWorkspaceColor(workspace.Color),
		Timezone:            workspace.Timezone,
		WeekStart:           workspace.WeekStart,
		MediaCleanupDays:    medialifecycle.TemporaryIdleDays,
		RandomDelayMinutes:  workspace.RandomDelayMinutes,
		SlotStartHour:       workspace.SlotStartHour,
		SlotEndHour:         workspace.SlotEndHour,
		SlotIntervalMinutes: workspace.SlotIntervalMinutes,
	}, true, nil
}
