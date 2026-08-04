package reposts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

var (
	ErrWorkspaceAccess = errors.New("workspace access required")
	ErrWorkspaceAdmin  = errors.New("workspace admin role required")
	ErrGrantNotFound   = errors.New("repost account grant not found")
)

func (s *Service) Settings(ctx context.Context, workspaceID, userID string) (SettingsResponse, error) {
	member, err := s.workspaceMember(ctx, workspaceID, userID)
	if err != nil {
		return SettingsResponse{}, err
	}
	policies, err := s.listPolicies(ctx, workspaceID)
	if err != nil {
		return SettingsResponse{}, err
	}
	accounts, err := s.listAvailableAccounts(ctx, workspaceID, userID, member.Role == models.WorkspaceRoleAdmin)
	if err != nil {
		return SettingsResponse{}, err
	}
	grants, err := s.listGrants(ctx, workspaceID)
	if err != nil {
		return SettingsResponse{}, err
	}
	return SettingsResponse{
		WorkspaceID:        workspaceID,
		CanManage:          member.Role == models.WorkspaceRoleAdmin,
		SupportedPlatforms: append([]string(nil), supportedPlatforms...),
		Policies:           policies,
		Accounts:           accounts,
		Grants:             grants,
	}, nil
}

//nolint:gocyclo
func (s *Service) ReplacePolicies(ctx context.Context, workspaceID, userID string, inputs []PolicyInput) (SettingsResponse, error) {
	if err := s.requireWorkspaceAdmin(ctx, workspaceID, userID); err != nil {
		return SettingsResponse{}, err
	}
	if len(inputs) > 50 {
		return SettingsResponse{}, invalidInputf("a workspace supports at most 50 repost rules")
	}

	normalized := make([]PolicyInput, 0, len(inputs))
	seenIDs := make(map[string]struct{}, len(inputs))
	for index, input := range inputs {
		input.Name = strings.TrimSpace(input.Name)
		if input.Name == "" {
			return SettingsResponse{}, invalidInputf("repost rule %d requires a name", index+1)
		}
		if len([]rune(input.Name)) > 80 {
			return SettingsResponse{}, invalidInputf("repost rule names support at most 80 characters")
		}
		if input.ID == "" {
			input.ID = uuid.NewString()
		}
		if _, duplicate := seenIDs[input.ID]; duplicate {
			return SettingsResponse{}, invalidInputf("repost rule ids must be unique")
		}
		seenIDs[input.ID] = struct{}{}
		input.SourceAccountIDs = uniqueIDs(input.SourceAccountIDs)
		input.TargetAccountIDs = uniqueIDs(input.TargetAccountIDs)
		if len(input.SourceAccountIDs) > maxAccountsPerRule || len(input.TargetAccountIDs) > maxAccountsPerRule {
			return SettingsResponse{}, invalidInputf("each repost rule supports at most %d source and target accounts", maxAccountsPerRule)
		}
		if len(input.TargetAccountIDs) == 0 {
			return SettingsResponse{}, invalidInputf("repost rule %q requires at least one target account", input.Name)
		}
		rule, err := NormalizeRule(input.Rule)
		if err != nil {
			return SettingsResponse{}, fmt.Errorf("repost rule %q: %w", input.Name, err)
		}
		input.Rule = rule
		normalized = append(normalized, input)
	}

	accountIDs := make([]string, 0)
	for _, input := range normalized {
		accountIDs = append(accountIDs, input.SourceAccountIDs...)
		accountIDs = append(accountIDs, input.TargetAccountIDs...)
	}
	accounts, err := s.loadActiveAccounts(ctx, uniqueIDs(accountIDs))
	if err != nil {
		return SettingsResponse{}, err
	}
	for _, input := range normalized {
		if err := s.validatePolicyAccounts(ctx, workspaceID, userID, input, accounts); err != nil {
			return SettingsResponse{}, err
		}
	}

	now := time.Now().UTC()
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewDelete().Model((*models.RepostPolicy)(nil)).Where("workspace_id = ?", workspaceID).Exec(txCtx); err != nil {
			return fmt.Errorf("replace repost rules: %w", err)
		}
		for _, input := range normalized {
			for _, targetID := range input.TargetAccountIDs {
				account := accounts[targetID]
				if account.WorkspaceID != workspaceID {
					if err := ensureGrantTx(txCtx, tx, workspaceID, account, userID, now); err != nil {
						return err
					}
				}
			}
			policy := policyModel(input, workspaceID, userID, now)
			if _, err := tx.NewInsert().Model(policy).Exec(txCtx); err != nil {
				return fmt.Errorf("store repost rule %q: %w", input.Name, err)
			}
			assignments := make([]models.RepostPolicyAccount, 0, len(input.SourceAccountIDs)+len(input.TargetAccountIDs))
			for _, accountID := range input.SourceAccountIDs {
				assignments = append(assignments, models.RepostPolicyAccount{PolicyID: input.ID, SocialAccountID: accountID, Role: RoleSource})
			}
			for _, accountID := range input.TargetAccountIDs {
				assignments = append(assignments, models.RepostPolicyAccount{PolicyID: input.ID, SocialAccountID: accountID, Role: RoleTarget})
			}
			if len(assignments) > 0 {
				if _, err := tx.NewInsert().Model(&assignments).Exec(txCtx); err != nil {
					return fmt.Errorf("store repost rule accounts: %w", err)
				}
			}
		}
		return nil
	})
	if err != nil {
		return SettingsResponse{}, err
	}
	return s.Settings(ctx, workspaceID, userID)
}

func (s *Service) ValidateOverride(ctx context.Context, workspaceID, userID string, input Override) (Override, error) {
	member, err := s.workspaceMember(ctx, workspaceID, userID)
	if err != nil {
		return Override{}, err
	}
	if member.Role != models.WorkspaceRoleAdmin && member.Role != models.WorkspaceRoleEditor {
		return Override{}, ErrWorkspaceAccess
	}
	normalized, err := NormalizeOverride(input)
	if err != nil || normalized.Mode != ModeCustom {
		return normalized, err
	}
	accounts, err := s.loadActiveAccounts(ctx, normalized.TargetAccountIDs)
	if err != nil {
		return Override{}, err
	}
	for _, accountID := range normalized.TargetAccountIDs {
		account, ok := accounts[accountID]
		if !ok || !SupportsPlatform(account.Platform) || s.repostAdapter(account) == nil {
			return Override{}, invalidInputf("repost target account %q is unavailable", accountID)
		}
		if account.WorkspaceID != workspaceID {
			granted, grantErr := s.hasActiveGrant(ctx, workspaceID, accountID)
			if grantErr != nil {
				return Override{}, grantErr
			}
			if !granted {
				return Override{}, invalidInputf("repost target account %q requires a workspace grant", accountID)
			}
		}
	}
	return normalized, nil
}

func EncodeOverride(input Override) (string, error) {
	normalized, err := NormalizeOverride(input)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(normalized)
	if err != nil {
		return "", fmt.Errorf("encode repost override: %w", err)
	}
	return string(body), nil
}

func DecodeOverride(raw string) Override {
	var result Override
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return Override{Mode: ModeInherit}
	}
	normalized, err := NormalizeOverride(result)
	if err != nil {
		return Override{Mode: ModeInherit}
	}
	return normalized
}

func (s *Service) RevokeGrant(ctx context.Context, grantID, workspaceID, userID string) error {
	var grant models.RepostAccountGrant
	if err := s.db.NewSelect().Model(&grant).Where("id = ? AND revoked_at IS NULL", grantID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrGrantNotFound
		}
		return err
	}
	if workspaceID != grant.SourceWorkspaceID && workspaceID != grant.TargetWorkspaceID {
		return ErrGrantNotFound
	}
	if err := s.requireWorkspaceAdmin(ctx, workspaceID, userID); err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err := s.db.NewUpdate().Model(&grant).
		Set("revoked_at = ?", now).
		Set("revoked_by = ?", userID).
		Set("updated_at = ?", now).
		Where("id = ? AND revoked_at IS NULL", grant.ID).
		Exec(ctx)
	return err
}

func (s *Service) workspaceMember(ctx context.Context, workspaceID, userID string) (models.WorkspaceMember, error) {
	var member models.WorkspaceMember
	if err := s.db.NewSelect().Model(&member).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return member, ErrWorkspaceAccess
		}
		return member, err
	}
	return member, nil
}

func (s *Service) requireWorkspaceAdmin(ctx context.Context, workspaceID, userID string) error {
	member, err := s.workspaceMember(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if member.Role != models.WorkspaceRoleAdmin {
		return ErrWorkspaceAdmin
	}
	return nil
}

func (s *Service) listPolicies(ctx context.Context, workspaceID string) ([]PolicyResponse, error) {
	var policies []models.RepostPolicy
	if err := s.db.NewSelect().Model(&policies).Where("workspace_id = ?", workspaceID).Order("created_at ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list repost rules: %w", err)
	}
	if len(policies) == 0 {
		return []PolicyResponse{}, nil
	}
	policyIDs := make([]string, 0, len(policies))
	for _, policy := range policies {
		policyIDs = append(policyIDs, policy.ID)
	}
	var assignments []models.RepostPolicyAccount
	if err := s.db.NewSelect().Model(&assignments).Where("policy_id IN (?)", bun.List(policyIDs)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("list repost rule accounts: %w", err)
	}
	byPolicy := make(map[string]map[string][]string)
	for _, assignment := range assignments {
		if byPolicy[assignment.PolicyID] == nil {
			byPolicy[assignment.PolicyID] = make(map[string][]string)
		}
		byPolicy[assignment.PolicyID][assignment.Role] = append(byPolicy[assignment.PolicyID][assignment.Role], assignment.SocialAccountID)
	}
	result := make([]PolicyResponse, 0, len(policies))
	for _, policy := range policies {
		result = append(result, PolicyResponse{
			PolicyInput: PolicyInput{
				ID:               policy.ID,
				Name:             policy.Name,
				Enabled:          policy.Enabled,
				SourceAccountIDs: byPolicy[policy.ID][RoleSource],
				TargetAccountIDs: byPolicy[policy.ID][RoleTarget],
				Rule:             ruleFromPolicy(policy),
			},
			CreatedAt: policy.CreatedAt.Format(time.RFC3339),
			UpdatedAt: policy.UpdatedAt.Format(time.RFC3339),
		})
	}
	return result, nil
}

//nolint:gocyclo
func (s *Service) listAvailableAccounts(ctx context.Context, workspaceID, userID string, includeAdminCandidates bool) ([]AccountOption, error) {
	accountByID := make(map[string]models.SocialAccount)
	var own []models.SocialAccount
	if err := s.db.NewSelect().Model(&own).Where("workspace_id = ? AND is_active = ?", workspaceID, true).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	for _, account := range own {
		accountByID[account.ID] = account
	}

	var activeGrants []models.RepostAccountGrant
	if err := s.db.NewSelect().Model(&activeGrants).Where("source_workspace_id = ? AND revoked_at IS NULL", workspaceID).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	grantedIDs := make(map[string]bool, len(activeGrants))
	for _, grant := range activeGrants {
		grantedIDs[grant.TargetAccountID] = true
	}
	if len(grantedIDs) > 0 {
		ids := make([]string, 0, len(grantedIDs))
		for id := range grantedIDs {
			ids = append(ids, id)
		}
		grantedAccounts, err := s.loadActiveAccounts(ctx, ids)
		if err != nil {
			return nil, err
		}
		for id, account := range grantedAccounts {
			accountByID[id] = account
		}
	}

	adminWorkspaceIDs := make(map[string]bool)
	if includeAdminCandidates {
		var memberships []models.WorkspaceMember
		if err := s.db.NewSelect().Model(&memberships).Where("user_id = ? AND role = ?", userID, models.WorkspaceRoleAdmin).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		ids := make([]string, 0, len(memberships))
		for _, membership := range memberships {
			adminWorkspaceIDs[membership.WorkspaceID] = true
			ids = append(ids, membership.WorkspaceID)
		}
		if len(ids) > 0 {
			var candidates []models.SocialAccount
			if err := s.db.NewSelect().Model(&candidates).Where("workspace_id IN (?) AND is_active = ?", bun.List(ids), true).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
			for _, account := range candidates {
				accountByID[account.ID] = account
			}
		}
	}

	workspaceNames, err := s.workspaceNames(ctx, accountByID)
	if err != nil {
		return nil, err
	}
	result := make([]AccountOption, 0, len(accountByID))
	for _, account := range accountByID {
		supported := SupportsPlatform(account.Platform) && s.repostAdapter(account) != nil
		reason := ""
		if !supported {
			reason = "This provider does not expose a native repost action in OpenPost."
		}
		cross := account.WorkspaceID != workspaceID
		result = append(result, AccountOption{
			ID:                account.ID,
			WorkspaceID:       account.WorkspaceID,
			WorkspaceName:     workspaceNames[account.WorkspaceID],
			Platform:          account.Platform,
			Username:          firstNonEmpty(account.AccountUsername, account.Slug, account.AccountID),
			AvatarURL:         account.AccountAvatarURL,
			InstanceURL:       account.InstanceURL,
			SupportsRepost:    supported,
			UnavailableReason: reason,
			CrossWorkspace:    cross,
			GrantRequired:     cross && !grantedIDs[account.ID],
			GrantActive:       !cross || grantedIDs[account.ID],
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].WorkspaceName != result[j].WorkspaceName {
			return result[i].WorkspaceName < result[j].WorkspaceName
		}
		if result[i].Platform != result[j].Platform {
			return result[i].Platform < result[j].Platform
		}
		return result[i].Username < result[j].Username
	})
	return result, nil
}

func (s *Service) listGrants(ctx context.Context, workspaceID string) ([]GrantResponse, error) {
	var grants []models.RepostAccountGrant
	if err := s.db.NewSelect().Model(&grants).
		Where("revoked_at IS NULL AND (source_workspace_id = ? OR target_workspace_id = ?)", workspaceID, workspaceID).
		Order("created_at DESC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if len(grants) == 0 {
		return []GrantResponse{}, nil
	}
	workspaceIDs := make(map[string]models.SocialAccount)
	accountIDs := make([]string, 0, len(grants))
	for _, grant := range grants {
		workspaceIDs[grant.SourceWorkspaceID] = models.SocialAccount{WorkspaceID: grant.SourceWorkspaceID}
		workspaceIDs[grant.TargetWorkspaceID] = models.SocialAccount{WorkspaceID: grant.TargetWorkspaceID}
		accountIDs = append(accountIDs, grant.TargetAccountID)
	}
	names, err := s.workspaceNames(ctx, workspaceIDs)
	if err != nil {
		return nil, err
	}
	accounts, err := s.loadActiveAccounts(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	result := make([]GrantResponse, 0, len(grants))
	for _, grant := range grants {
		account := accounts[grant.TargetAccountID]
		direction := "outbound"
		if grant.TargetWorkspaceID == workspaceID {
			direction = "inbound"
		}
		result = append(result, GrantResponse{
			ID:                  grant.ID,
			SourceWorkspaceID:   grant.SourceWorkspaceID,
			SourceWorkspaceName: names[grant.SourceWorkspaceID],
			TargetWorkspaceID:   grant.TargetWorkspaceID,
			TargetWorkspaceName: names[grant.TargetWorkspaceID],
			TargetAccountID:     grant.TargetAccountID,
			TargetUsername:      firstNonEmpty(account.AccountUsername, account.Slug, account.AccountID),
			Platform:            account.Platform,
			Direction:           direction,
			CreatedAt:           grant.CreatedAt.Format(time.RFC3339),
		})
	}
	return result, nil
}

//nolint:gocyclo
func (s *Service) validatePolicyAccounts(ctx context.Context, workspaceID, userID string, input PolicyInput, accounts map[string]models.SocialAccount) error {
	sourcePlatforms := make(map[string]bool)
	if len(input.SourceAccountIDs) == 0 {
		var sources []models.SocialAccount
		if err := s.db.NewSelect().Model(&sources).Where("workspace_id = ? AND is_active = ?", workspaceID, true).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		for _, source := range sources {
			if SupportsPlatform(source.Platform) {
				sourcePlatforms[source.Platform] = true
			}
		}
	} else {
		for _, accountID := range input.SourceAccountIDs {
			account, ok := accounts[accountID]
			if !ok || account.WorkspaceID != workspaceID || !SupportsPlatform(account.Platform) || s.repostAdapter(account) == nil {
				return invalidInputf("repost rule %q has an unavailable source account", input.Name)
			}
			sourcePlatforms[account.Platform] = true
		}
	}
	for _, accountID := range input.TargetAccountIDs {
		account, ok := accounts[accountID]
		if !ok || !SupportsPlatform(account.Platform) || s.repostAdapter(account) == nil {
			return invalidInputf("repost rule %q has an unavailable target account", input.Name)
		}
		if !sourcePlatforms[account.Platform] {
			return invalidInputf("repost rule %q needs a %s source account for target @%s", input.Name, account.Platform, firstNonEmpty(account.AccountUsername, account.Slug))
		}
		if account.WorkspaceID != workspaceID {
			granted, err := s.hasActiveGrant(ctx, workspaceID, accountID)
			if err != nil {
				return err
			}
			if !granted {
				if err := s.requireWorkspaceAdmin(ctx, account.WorkspaceID, userID); err != nil {
					return invalidInputf("target @%s requires admin access to its workspace", firstNonEmpty(account.AccountUsername, account.Slug))
				}
			}
		}
	}
	return nil
}

func (s *Service) loadActiveAccounts(ctx context.Context, ids []string) (map[string]models.SocialAccount, error) {
	result := make(map[string]models.SocialAccount)
	ids = uniqueIDs(ids)
	if len(ids) == 0 {
		return result, nil
	}
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("id IN (?) AND is_active = ?", bun.List(ids), true).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	for _, account := range accounts {
		result[account.ID] = account
	}
	return result, nil
}

func (s *Service) workspaceNames(ctx context.Context, accounts map[string]models.SocialAccount) (map[string]string, error) {
	ids := make([]string, 0)
	seen := make(map[string]bool)
	for _, account := range accounts {
		if account.WorkspaceID != "" && !seen[account.WorkspaceID] {
			seen[account.WorkspaceID] = true
			ids = append(ids, account.WorkspaceID)
		}
	}
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	var workspaces []models.Workspace
	if err := s.db.NewSelect().Model(&workspaces).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil, err
	}
	result := make(map[string]string, len(workspaces))
	for _, workspace := range workspaces {
		result[workspace.ID] = workspace.Name
	}
	return result, nil
}

func (s *Service) hasActiveGrant(ctx context.Context, workspaceID, accountID string) (bool, error) {
	return s.db.NewSelect().Model((*models.RepostAccountGrant)(nil)).
		Where("source_workspace_id = ? AND target_account_id = ? AND revoked_at IS NULL", workspaceID, accountID).
		Exists(ctx)
}

func ensureGrantTx(ctx context.Context, tx bun.Tx, workspaceID string, account models.SocialAccount, userID string, now time.Time) error {
	exists, err := tx.NewSelect().Model((*models.RepostAccountGrant)(nil)).
		Where("source_workspace_id = ? AND target_account_id = ? AND revoked_at IS NULL", workspaceID, account.ID).
		Exists(ctx)
	if err != nil || exists {
		return err
	}
	grant := &models.RepostAccountGrant{
		ID:                uuid.NewString(),
		SourceWorkspaceID: workspaceID,
		TargetWorkspaceID: account.WorkspaceID,
		TargetAccountID:   account.ID,
		CreatedByID:       userID,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if _, err := tx.NewInsert().Model(grant).Exec(ctx); err != nil {
		return fmt.Errorf("create cross-workspace repost grant: %w", err)
	}
	return nil
}

func policyModel(input PolicyInput, workspaceID, userID string, now time.Time) *models.RepostPolicy {
	return &models.RepostPolicy{
		ID:                      input.ID,
		WorkspaceID:             workspaceID,
		Name:                    input.Name,
		Enabled:                 input.Enabled,
		DelaySeconds:            input.Rule.DelaySeconds,
		EvaluationWindowSeconds: input.Rule.EvaluationWindowSeconds,
		ThresholdMode:           input.Rule.ThresholdMode,
		MinLikes:                input.Rule.MinLikes,
		MinComments:             input.Rule.MinComments,
		MinReposts:              input.Rule.MinReposts,
		MinViews:                input.Rule.MinViews,
		RequirePlateau:          input.Rule.RequirePlateau,
		PlateauChecks:           input.Rule.PlateauChecks,
		CreatedByID:             userID,
		UpdatedByID:             userID,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
}

func ruleFromPolicy(policy models.RepostPolicy) Rule {
	return Rule{
		DelaySeconds:            policy.DelaySeconds,
		EvaluationWindowSeconds: policy.EvaluationWindowSeconds,
		ThresholdMode:           policy.ThresholdMode,
		MinLikes:                policy.MinLikes,
		MinComments:             policy.MinComments,
		MinReposts:              policy.MinReposts,
		MinViews:                policy.MinViews,
		RequirePlateau:          policy.RequirePlateau,
		PlateauChecks:           policy.PlateauChecks,
	}
}

func (s *Service) repostAdapter(account models.SocialAccount) platform.RepostAdapter {
	key := account.Platform
	if account.Platform == "mastodon" {
		key = "mastodon:" + account.InstanceURL
	}
	s.providersMu.RLock()
	adapter := s.providers[key]
	s.providersMu.RUnlock()
	repost, _ := adapter.(platform.RepostAdapter)
	return repost
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
