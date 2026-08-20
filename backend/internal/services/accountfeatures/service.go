package accountfeatures

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/uptrace/bun"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

const (
	FeatureMessaging  = "messaging"
	FeatureEngagement = "engagement"
	FeatureAnalytics  = "analytics"
	FeatureGrow       = "grow"
)

var ValidFeatures = []string{FeatureMessaging, FeatureEngagement, FeatureAnalytics, FeatureGrow}

var validFeatureSet = map[string]struct{}{
	FeatureMessaging:  {},
	FeatureEngagement: {},
	FeatureAnalytics:  {},
	FeatureGrow:       {},
}

const (
	AvailabilityAvailable      = "available"
	AvailabilityUnsupported    = "unsupported"
	AvailabilityMissingScope   = "missing_scope"
	AvailabilityPlanRestricted = "plan_restricted"
)

const (
	ReasonAvailable      = "available"
	ReasonUnsupported    = "unsupported"
	ReasonMissingScope   = "missing_scope"
	ReasonPlanRestricted = "plan_restricted"
)

type PlanPolicy interface {
	Allowed(ctx context.Context, workspaceID, feature string) (bool, string)
}

type AlwaysAllowedPolicy struct{}

func (AlwaysAllowedPolicy) Allowed(_ context.Context, _, _ string) (bool, string) { return true, "" }

type SupportResolver struct {
	Providers map[string]platform.Adapter
}

type Service struct {
	db         bun.IDB
	providers  map[string]platform.Adapter
	planPolicy PlanPolicy
	now        func() time.Time
}

func NewService(db bun.IDB, providers map[string]platform.Adapter, policy PlanPolicy) *Service {
	if policy == nil {
		policy = AlwaysAllowedPolicy{}
	}
	// Keep direct reference to the live providers map when possible so dynamic
	// Mastodon registrations are visible without an extra registrar. Copy only
	// when the caller cannot share the live map.
	ref := providers
	return &Service{
		db:         db,
		providers:  ref,
		planPolicy: policy,
		now:        func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetPlanPolicy(p PlanPolicy) {
	if p != nil {
		s.planPolicy = p
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	if s.providers == nil {
		s.providers = map[string]platform.Adapter{}
	}
	s.providers[name] = adapter
}

func IsValidFeature(f string) bool {
	_, ok := validFeatureSet[strings.TrimSpace(f)]
	return ok
}

type ChoiceInput struct {
	AccountID string
	Feature   string
	Enabled   bool
	Source    string
}

type ResolvedFeature struct {
	WorkspaceID      string     `json:"workspace_id"`
	SocialAccountID  string     `json:"social_account_id"`
	Platform         string     `json:"platform"`
	Feature          string     `json:"feature"`
	Supported        bool       `json:"supported"`
	Availability     string     `json:"availability"`
	ReasonCode       string     `json:"reason_code"`
	RequiredScopes   []string   `json:"required_scopes,omitempty"`
	MissingScopes    []string   `json:"missing_scopes,omitempty"`
	UnavailableReason string    `json:"unavailable_reason,omitempty"`
	StoredExists     bool       `json:"stored_exists"`
	StoredEnabled    bool       `json:"stored_enabled"`
	DecidedByUserID  string     `json:"decided_by_user_id,omitempty"`
	Source           string     `json:"source,omitempty"`
	DecidedAt        *time.Time `json:"decided_at,omitempty"`
	EffectiveEnabled bool       `json:"effective_enabled"`
}

func (s *Service) IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error) {
	feature = strings.TrimSpace(feature)
	if !IsValidFeature(feature) {
		return false, nil
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	resolved, err := s.resolveOne(ctx, account, feature)
	if err != nil {
		return false, err
	}
	return resolved.EffectiveEnabled, nil
}

func (s *Service) Read(ctx context.Context, workspaceID string, actor workspaceaccess.ActorFacts, accountIDs []string) ([]ResolvedFeature, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return nil, fmt.Errorf("workspace_id is required")
	}
	authz := workspaceaccess.NewAuthorizer(s.db)
	decision, err := authz.Authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead)
	if err != nil {
		return nil, err
	}
	if !decision.Allowed {
		return nil, fmt.Errorf("workspace read denied: %s", decision.Reason)
	}
	if len(accountIDs) == 0 {
		return []ResolvedFeature{}, nil
	}
	seen := map[string]struct{}{}
	uniqueIDs := make([]string, 0, len(accountIDs))
	for _, id := range accountIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniqueIDs = append(uniqueIDs, id)
	}
	if len(uniqueIDs) == 0 {
		return []ResolvedFeature{}, nil
	}
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("id IN (?)", bun.In(uniqueIDs)).Scan(ctx); err != nil {
		return nil, err
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	for _, acc := range accounts {
		byID[acc.ID] = acc
	}
	for _, id := range uniqueIDs {
		acc, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("account %s not found", id)
		}
		if acc.WorkspaceID != workspaceID {
			return nil, fmt.Errorf("account %s does not belong to workspace %s", id, workspaceID)
		}
	}
	result := make([]ResolvedFeature, 0, len(uniqueIDs)*len(ValidFeatures))
	for _, id := range uniqueIDs {
		acc := byID[id]
		for _, feature := range ValidFeatures {
			resolved, err := s.resolveOne(ctx, acc, feature)
			if err != nil {
				return nil, err
			}
			result = append(result, resolved)
		}
	}
	return result, nil
}

func (s *Service) BatchSave(ctx context.Context, workspaceID string, actor workspaceaccess.ActorFacts, inputs []ChoiceInput) ([]ResolvedFeature, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return nil, fmt.Errorf("workspace_id is required")
	}
	if len(inputs) == 0 {
		return nil, fmt.Errorf("choices are required")
	}
	authz := workspaceaccess.NewAuthorizer(s.db)
	decision, err := authz.Authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit)
	if err != nil {
		return nil, err
	}
	if !decision.Allowed {
		return nil, fmt.Errorf("workspace edit denied: %s", decision.Reason)
	}
	// Validate complete batch before any write
	normalized := make([]ChoiceInput, 0, len(inputs))
	for i, in := range inputs {
		in.AccountID = strings.TrimSpace(in.AccountID)
		in.Feature = strings.TrimSpace(in.Feature)
		in.Source = strings.TrimSpace(in.Source)
		if in.AccountID == "" {
			return nil, fmt.Errorf("choice %d: account_id is required", i)
		}
		if !IsValidFeature(in.Feature) {
			return nil, fmt.Errorf("choice %d: unknown feature %q", i, in.Feature)
		}
		normalized = append(normalized, in)
	}
	// Load accounts and validate ownership
	accountIDs := make([]string, 0, len(normalized))
	seenAcc := map[string]struct{}{}
	for _, in := range normalized {
		if _, ok := seenAcc[in.AccountID]; !ok {
			seenAcc[in.AccountID] = struct{}{}
			accountIDs = append(accountIDs, in.AccountID)
		}
	}
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("id IN (?)", bun.In(accountIDs)).Scan(ctx); err != nil {
		return nil, err
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	for _, acc := range accounts {
		byID[acc.ID] = acc
	}
	for _, id := range accountIDs {
		acc, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("account %s not found", id)
		}
		if acc.WorkspaceID != workspaceID {
			return nil, fmt.Errorf("account %s does not belong to workspace %s", id, workspaceID)
		}
	}
	// Last-write-wins deduplication for (account, feature)
	type key struct{ acc, feat string }
	last := make(map[key]ChoiceInput)
	order := []key{}
	for _, in := range normalized {
		k := key{acc: in.AccountID, feat: in.Feature}
		if _, exists := last[k]; !exists {
			order = append(order, k)
		} else {
			// move to end to preserve last occurrence order? but we keep map, order reflects first appearance
			// we want deduped list, last wins
		}
		last[k] = in
	}
	deduped := make([]ChoiceInput, 0, len(last))
	// Need deterministic order: use order of last occurrence. So iterate normalized and keep last.
	seenKey := map[key]bool{}
	for i := len(normalized) - 1; i >= 0; i-- {
		in := normalized[i]
		k := key{acc: in.AccountID, feat: in.Feature}
		if seenKey[k] {
			continue
		}
		seenKey[k] = true
		deduped = append(deduped, in)
	}
	// reverse to keep original order of last occurrences? Not needed, but preserve
	slices.Reverse(deduped)

	now := s.now().UTC()
	sourceDefault := "user_save"
	if err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, in := range deduped {
			src := in.Source
			if src == "" {
				src = sourceDefault
			}
			acc := byID[in.AccountID]
			row := &models.AccountFeature{
				SocialAccountID: in.AccountID,
				WorkspaceID:     workspaceID,
				Feature:         in.Feature,
				Enabled:         in.Enabled,
				DecidedByUserID: strings.TrimSpace(actor.UserID),
				Source:          src,
				DecidedAt:       now,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			// Ensure workspace_id matches account's workspace (already validated)
			row.WorkspaceID = acc.WorkspaceID
			_, err := tx.NewInsert().Model(row).
				On("CONFLICT (social_account_id, feature) DO UPDATE").
				Set("enabled = EXCLUDED.enabled").
				Set("decided_by_user_id = EXCLUDED.decided_by_user_id").
				Set("source = EXCLUDED.source").
				Set("decided_at = EXCLUDED.decided_at").
				Set("updated_at = EXCLUDED.updated_at").
				Exec(txCtx)
			if err != nil {
				return fmt.Errorf("upsert feature %s for %s: %w", in.Feature, in.AccountID, err)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	// Return stored and effective state after writes for affected accounts
	affectedIDs := make([]string, 0, len(byID))
	for id := range byID {
		affectedIDs = append(affectedIDs, id)
	}
	return s.Read(ctx, workspaceID, actor, affectedIDs)
}

func (s *Service) resolveOne(ctx context.Context, account models.SocialAccount, feature string) (ResolvedFeature, error) {
	feature = strings.TrimSpace(feature)
	required, missing, unavailable, supported := s.supportFor(ctx, account, feature)
	allowed, planReason := true, ""
	if s.planPolicy != nil {
		allowed, planReason = s.planPolicy.Allowed(ctx, account.WorkspaceID, feature)
	}
	var pref *models.AccountFeature
	var pf models.AccountFeature
	err := s.db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", account.ID, feature).Scan(ctx)
	if err == nil {
		pref = &pf
	} else if err != sql.ErrNoRows {
		return ResolvedFeature{}, err
	}
	storedExists := pref != nil
	storedEnabled := storedExists && pref.Enabled
	availability := AvailabilityAvailable
	reason := ReasonAvailable
	if !supported {
		availability = AvailabilityUnsupported
		reason = ReasonUnsupported
	} else if !allowed {
		availability = AvailabilityPlanRestricted
		reason = ReasonPlanRestricted
		if planReason != "" {
			unavailable = planReason
		}
	} else if len(missing) > 0 {
		availability = AvailabilityMissingScope
		reason = ReasonMissingScope
	}
	effective := storedExists && storedEnabled && supported && len(missing) == 0 && allowed
	decidedAt := (*time.Time)(nil)
	decidedBy := ""
	source := ""
	if pref != nil {
		t := pref.DecidedAt
		decidedAt = &t
		decidedBy = pref.DecidedByUserID
		source = pref.Source
	}
	return ResolvedFeature{
		WorkspaceID:       account.WorkspaceID,
		SocialAccountID:   account.ID,
		Platform:          account.Platform,
		Feature:           feature,
		Supported:         supported,
		Availability:      availability,
		ReasonCode:        reason,
		RequiredScopes:    required,
		MissingScopes:     missing,
		UnavailableReason: unavailable,
		StoredExists:      storedExists,
		StoredEnabled:     storedEnabled,
		DecidedByUserID:   decidedBy,
		Source:            source,
		DecidedAt:         decidedAt,
		EffectiveEnabled:  effective,
	}, nil
}

func (s *Service) supportFor(ctx context.Context, account models.SocialAccount, feature string) ([]string, []string, string, bool) {
	providerKey := account.Platform
	// Special handling for mastodon dynamic instances: provider key might be "mastodon:<url>"
	adapter, ok := s.providers[providerKey]
	if !ok {
		// try fallback for mastodon instances
		if strings.HasPrefix(providerKey, "mastodon") {
			// search any mastodon adapter
			for k, v := range s.providers {
				if strings.HasPrefix(k, "mastodon") {
					adapter = v
					ok = true
					break
				}
			}
		}
	}
	if !ok || adapter == nil {
		return nil, nil, "", false
	}
	switch feature {
	case FeatureMessaging:
		if m, ok := adapter.(platform.MessagingAdapter); ok {
			sup := m.MessagingSupport()
			supported := sup.Enabled
			required := sup.RequiredScopes
			unavailable := sup.Unavailable
			var missing []string
			if supported {
				missing = missingScopes(account.GrantedScopes, required)
			}
			return required, missing, unavailable, supported
		}
		return nil, nil, "", false
	case FeatureEngagement:
		if e, ok := adapter.(platform.EngagementAdapter); ok {
			sup := e.EngagementSupport()
			supported := sup.Enabled
			required := sup.RequiredScopes
			unavailable := sup.Unavailable
			var missing []string
			if supported {
				missing = missingScopes(account.GrantedScopes, required)
			}
			return required, missing, unavailable, supported
		}
		return nil, nil, "", false
	case FeatureAnalytics:
		if a, ok := adapter.(platform.AnalyticsAdapter); ok {
			var sup platform.AnalyticsSupport
			if resolver, ok := adapter.(platform.AccountAnalyticsSupportResolver); ok {
				var capState map[string]string
				_ = json.Unmarshal([]byte(account.CapabilityState), &capState)
				sup = resolver.AnalyticsSupportForAccount(platform.AnalyticsAccountContext{
					AccountID:       account.AccountID,
					GrantedScopes:   account.GrantedScopes,
					CapabilityState: capState,
				})
			} else {
				sup = a.AnalyticsSupport()
			}
			supported := sup.Account || sup.Content
			required := append([]string{}, sup.AccountRequiredScopes...)
			required = append(required, sup.ContentRequiredScopes...)
			unavailable := firstNonEmpty(sup.AccountUnavailable, sup.ContentUnavailable)
			var missing []string
			if supported {
				missing = missingScopes(account.GrantedScopes, required)
			}
			return required, missing, unavailable, supported
		}
		return nil, nil, "", false
	case FeatureGrow:
		if _, ok := adapter.(platform.GrowthDiscoverer); ok {
			return nil, nil, "", true
		}
		if _, ok := adapter.(platform.GrowthFollower); ok {
			return nil, nil, "", true
		}
		return nil, nil, "", false
	default:
		return nil, nil, "", false
	}
}

func missingScopes(granted string, required []string) []string {
	if len(required) == 0 {
		return nil
	}
	fields := strings.FieldsFunc(granted, func(r rune) bool { return r == ' ' || r == ',' || r == ';' })
	set := make(map[string]struct{}, len(fields))
	for _, f := range fields {
		set[strings.TrimSpace(f)] = struct{}{}
	}
	var missing []string
	for _, need := range required {
		if _, ok := set[need]; !ok {
			missing = append(missing, need)
		}
	}
	return missing
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
