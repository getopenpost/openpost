package accountfeatures

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/uptrace/bun"

	"github.com/openpost/backend/internal/jobregistry"
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

var (
	ErrWorkspaceReadDenied    = errors.New("workspace read denied")
	ErrWorkspaceEditDenied    = errors.New("workspace edit denied")
	ErrAccountNotFound        = errors.New("account not found")
	ErrAccountWrongWorkspace  = errors.New("account does not belong to workspace")
	ErrUnknownFeature         = errors.New("unknown feature")
	ErrFeatureGateUnavailable = errors.New("feature gate unavailable")
)

type PlanPolicy interface {
	Allowed(ctx context.Context, workspaceID, feature string) (bool, string)
}

type AlwaysAllowedPolicy struct{}

func (AlwaysAllowedPolicy) Allowed(_ context.Context, _, _ string) (bool, string) { return true, "" }

// engagementSupporter is the minimal seam required to derive engagement availability.
// It avoids pulling the full EngagementAdapter (CommentAdapter + Support) into the
// feature resolver so test fakes can stay adapter-derived without unreachable methods.
type engagementSupporter interface {
	EngagementSupport() platform.EngagementSupport
}

type SupportResolver struct {
	Providers map[string]platform.Adapter
}

type Service struct {
	db               bun.IDB
	providers        map[string]platform.Adapter
	analyticsSources map[string]platform.AnalyticsAdapter
	planPolicy       PlanPolicy
	now              func() time.Time
}

func NewService(db bun.IDB, providers map[string]platform.Adapter, policy PlanPolicy) *Service {
	if policy == nil {
		policy = AlwaysAllowedPolicy{}
	}
	ref := providers
	return &Service{
		db:               db,
		providers:        ref,
		analyticsSources: make(map[string]platform.AnalyticsAdapter),
		planPolicy:       policy,
		now:              func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) SetPlanPolicy(p PlanPolicy) {
	if p != nil {
		s.planPolicy = p
	}
}

func (s *Service) SetAnalyticsSource(name string, adapter platform.AnalyticsAdapter) {
	if adapter != nil {
		s.analyticsSources[strings.ToLower(strings.TrimSpace(name))] = adapter
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
	WorkspaceID       string     `json:"workspace_id"`
	SocialAccountID   string     `json:"social_account_id"`
	Platform          string     `json:"platform"`
	Feature           string     `json:"feature"`
	Supported         bool       `json:"supported"`
	Availability      string     `json:"availability"`
	ReasonCode        string     `json:"reason_code"`
	RequiredScopes    []string   `json:"required_scopes,omitempty"`
	MissingScopes     []string   `json:"missing_scopes,omitempty"`
	UnavailableReason string     `json:"unavailable_reason,omitempty"`
	StoredExists      bool       `json:"stored_exists"`
	StoredEnabled     bool       `json:"stored_enabled"`
	DecidedByUserID   string     `json:"decided_by_user_id,omitempty"`
	Source            string     `json:"source,omitempty"`
	DecidedAt         *time.Time `json:"decided_at,omitempty"`
	EffectiveEnabled  bool       `json:"effective_enabled"`
}

func (s *Service) IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error) {
	feature = strings.TrimSpace(feature)
	if !IsValidFeature(feature) {
		return false, fmt.Errorf("%w: %q", ErrUnknownFeature, feature)
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, fmt.Errorf("%w: %s", ErrAccountNotFound, accountID)
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
	if err := s.authorizeRead(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	uniqueIDs := deduplicateIDs(accountIDs)
	if len(uniqueIDs) == 0 {
		return []ResolvedFeature{}, nil
	}
	byID, err := s.loadAccountsByIDs(ctx, uniqueIDs)
	if err != nil {
		return nil, err
	}
	if err := validateAccountOwnership(byID, workspaceID, uniqueIDs); err != nil {
		return nil, err
	}
	return s.buildResolvedFeatures(ctx, byID, uniqueIDs)
}

func (s *Service) authorizeRead(ctx context.Context, workspaceID string, actor workspaceaccess.ActorFacts) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return fmt.Errorf("workspace_id is required")
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return fmt.Errorf("%w: %s", ErrWorkspaceReadDenied, decision.Reason)
	}
	return nil
}

func deduplicateIDs(ids []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (s *Service) loadAccountsByIDs(ctx context.Context, ids []string) (map[string]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil, err
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	for _, acc := range accounts {
		byID[acc.ID] = acc
	}
	return byID, nil
}

func validateAccountOwnership(byID map[string]models.SocialAccount, workspaceID string, ids []string) error {
	for _, id := range ids {
		acc, ok := byID[id]
		if !ok {
			return fmt.Errorf("%w: %s", ErrAccountNotFound, id)
		}
		if acc.WorkspaceID != workspaceID {
			return fmt.Errorf("%w: %s does not belong to workspace %s", ErrAccountWrongWorkspace, id, workspaceID)
		}
	}
	return nil
}

func (s *Service) buildResolvedFeatures(ctx context.Context, byID map[string]models.SocialAccount, ids []string) ([]ResolvedFeature, error) {
	result := make([]ResolvedFeature, 0, len(ids)*len(ValidFeatures))
	for _, id := range ids {
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
	if err := s.authorizeEdit(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	normalized, err := normalizeChoiceInputs(inputs)
	if err != nil {
		return nil, err
	}
	byID, err := s.loadBatchAccounts(ctx, workspaceID, normalized)
	if err != nil {
		return nil, err
	}
	deduped := deduplicateChoices(normalized, byID)
	supportCache := s.buildSupportCache(ctx, byID, deduped)
	if err := s.executeBatchTx(ctx, actor, byID, deduped, supportCache); err != nil {
		return nil, err
	}
	affectedIDs := make([]string, 0, len(byID))
	for id := range byID {
		affectedIDs = append(affectedIDs, id)
	}
	return s.Read(ctx, workspaceID, actor, affectedIDs)
}

func (s *Service) authorizeEdit(ctx context.Context, workspaceID string, actor workspaceaccess.ActorFacts) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return fmt.Errorf("%w: %s", ErrWorkspaceEditDenied, decision.Reason)
	}
	return nil
}

func normalizeChoiceInputs(inputs []ChoiceInput) ([]ChoiceInput, error) {
	normalized := make([]ChoiceInput, 0, len(inputs))
	for i, in := range inputs {
		in.AccountID = strings.TrimSpace(in.AccountID)
		in.Feature = strings.TrimSpace(in.Feature)
		in.Source = strings.TrimSpace(in.Source)
		if in.AccountID == "" {
			return nil, fmt.Errorf("choice %d: account_id is required", i)
		}
		if !IsValidFeature(in.Feature) {
			return nil, fmt.Errorf("%w: choice %d: unknown feature %q", ErrUnknownFeature, i, in.Feature)
		}
		normalized = append(normalized, in)
	}
	return normalized, nil
}

func (s *Service) loadBatchAccounts(ctx context.Context, workspaceID string, normalized []ChoiceInput) (map[string]models.SocialAccount, error) {
	seenAcc := map[string]struct{}{}
	accountIDs := make([]string, 0, len(normalized))
	for _, in := range normalized {
		if _, ok := seenAcc[in.AccountID]; !ok {
			seenAcc[in.AccountID] = struct{}{}
			accountIDs = append(accountIDs, in.AccountID)
		}
	}
	var accounts []models.SocialAccount
	if err := s.db.NewSelect().Model(&accounts).Where("id IN (?)", bun.List(accountIDs)).Scan(ctx); err != nil {
		return nil, err
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	for _, acc := range accounts {
		byID[acc.ID] = acc
	}
	for _, id := range accountIDs {
		acc, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrAccountNotFound, id)
		}
		if acc.WorkspaceID != workspaceID {
			return nil, fmt.Errorf("%w: %s does not belong to workspace %s", ErrAccountWrongWorkspace, id, workspaceID)
		}
	}
	return byID, nil
}

func deduplicateChoices(normalized []ChoiceInput, byID map[string]models.SocialAccount) []ChoiceInput {
	type key struct{ acc, feat string }
	deduped := make([]ChoiceInput, 0, len(byID)*len(ValidFeatures))
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
	slices.Reverse(deduped)
	return deduped
}

func (s *Service) buildSupportCache(ctx context.Context, byID map[string]models.SocialAccount, deduped []ChoiceInput) map[string]struct {
	supported bool
	missing   []string
	allowed   bool
} {
	cache := make(map[string]struct {
		supported bool
		missing   []string
		allowed   bool
	}, len(deduped))
	for _, in := range deduped {
		acc := byID[in.AccountID]
		_, missing, _, supported := s.supportFor(ctx, acc, in.Feature)
		allowed := true
		if s.planPolicy != nil {
			allowed, _ = s.planPolicy.Allowed(ctx, acc.WorkspaceID, in.Feature)
		}
		cache[in.AccountID+"|"+in.Feature] = struct {
			supported bool
			missing   []string
			allowed   bool
		}{supported: supported, missing: missing, allowed: allowed}
	}
	return cache
}

func (s *Service) executeBatchTx(ctx context.Context, actor workspaceaccess.ActorFacts, byID map[string]models.SocialAccount, deduped []ChoiceInput, supportCache map[string]struct {
	supported bool
	missing   []string
	allowed   bool
}) error {
	now := s.now().UTC()
	sweepEnqueued := map[string]bool{}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, in := range deduped {
			if err := s.applyChoiceTx(txCtx, tx, actor, byID, in, supportCache, sweepEnqueued, now); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) applyChoiceTx(ctx context.Context, tx bun.Tx, actor workspaceaccess.ActorFacts, byID map[string]models.SocialAccount, in ChoiceInput, supportCache map[string]struct {
	supported bool
	missing   []string
	allowed   bool
}, sweepEnqueued map[string]bool, now time.Time) error {
	src := in.Source
	if src == "" {
		src = "user_save"
	}
	acc := byID[in.AccountID]
	cache := supportCache[in.AccountID+"|"+in.Feature]
	var existing models.AccountFeature
	err := tx.NewSelect().Model(&existing).Where("social_account_id = ? AND feature = ?", in.AccountID, in.Feature).Scan(ctx)
	beforeEffective := false
	if err == nil {
		beforeEffective = existing.Enabled && cache.supported && len(cache.missing) == 0 && cache.allowed
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	row := &models.AccountFeature{
		SocialAccountID: in.AccountID,
		WorkspaceID:     acc.WorkspaceID,
		Feature:         in.Feature,
		Enabled:         in.Enabled,
		DecidedByUserID: strings.TrimSpace(actor.UserID),
		Source:          src,
		DecidedAt:       now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err = tx.NewInsert().Model(row).
		On("CONFLICT (social_account_id, feature) DO UPDATE").
		Set("enabled = EXCLUDED.enabled").
		Set("decided_by_user_id = EXCLUDED.decided_by_user_id").
		Set("source = EXCLUDED.source").
		Set("decided_at = EXCLUDED.decided_at").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("upsert feature %s for %s: %w", in.Feature, in.AccountID, err)
	}
	if !in.Enabled || beforeEffective {
		return nil
	}
	if !cache.supported || len(cache.missing) > 0 || !cache.allowed {
		return nil
	}
	return s.enqueueForFeature(ctx, tx, acc, actor, in.Feature, sweepEnqueued, now)
}

func (s *Service) enqueueForFeature(ctx context.Context, tx bun.Tx, acc models.SocialAccount, actor workspaceaccess.ActorFacts, feature string, sweepEnqueued map[string]bool, now time.Time) error {
	switch feature {
	case FeatureMessaging:
		return s.enqueueMessagingSyncTx(ctx, tx, acc.ID, acc.WorkspaceID, now)
	case FeatureEngagement:
		if sweepEnqueued[acc.WorkspaceID+"|engagement"] {
			return nil
		}
		err := s.enqueueEngagementSweepTx(ctx, tx, now)
		if err == nil {
			sweepEnqueued[acc.WorkspaceID+"|engagement"] = true
		}
		return err
	case FeatureAnalytics:
		if sweepEnqueued[acc.WorkspaceID+"|analytics"] {
			return nil
		}
		err := s.enqueueAnalyticsSweepTx(ctx, tx, now)
		if err == nil {
			sweepEnqueued[acc.WorkspaceID+"|analytics"] = true
		}
		return err
	case FeatureGrow:
		return s.enqueueGrowthDiscoveryTx(ctx, tx, acc.WorkspaceID, acc.ID, actor.UserID, now)
	default:
		return nil
	}
}

func (s *Service) enqueueMessagingSyncTx(ctx context.Context, tx bun.Tx, accountID, workspaceID string, runAt time.Time) error {
	payload := fmt.Sprintf(`{"id":"%s"}`, accountID)
	exists, err := tx.NewSelect().Model((*models.Job)(nil)).Where("type = ? AND payload = ? AND status IN (?, ?)", jobregistry.TypeMessagesSync, payload, jobregistry.StatusPending, jobregistry.StatusProcessing).Exists(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	job, err := jobregistry.NewJob(jobregistry.TypeMessagesSync, payload, runAt)
	if err != nil {
		return err
	}
	job.ScopeID = workspaceID
	_, err = tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (s *Service) enqueueSweepTx(ctx context.Context, tx bun.Tx, jobType string, runAt time.Time) error {
	payloadBytes, _ := json.Marshal(map[string]string{"scheduled_for": runAt.UTC().Truncate(time.Minute).Format(time.RFC3339)})
	payload := string(payloadBytes)
	exists, err := tx.NewSelect().Model((*models.Job)(nil)).Where("type = ? AND status IN (?, ?)", jobType, jobregistry.StatusPending, jobregistry.StatusProcessing).Exists(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	job, err := jobregistry.NewJob(jobType, payload, runAt)
	if err != nil {
		return err
	}
	_, err = tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (s *Service) enqueueEngagementSweepTx(ctx context.Context, tx bun.Tx, runAt time.Time) error {
	return s.enqueueSweepTx(ctx, tx, jobregistry.TypeEngagementSweep, runAt)
}

func (s *Service) enqueueAnalyticsSweepTx(ctx context.Context, tx bun.Tx, runAt time.Time) error {
	return s.enqueueSweepTx(ctx, tx, jobregistry.TypeAnalyticsSweep, runAt)
}

func (s *Service) enqueueGrowthDiscoveryTx(ctx context.Context, tx bun.Tx, workspaceID, accountID, actorUserID string, runAt time.Time) error {
	payloadMap := map[string]string{"workspace_id": workspaceID, "social_account_id": accountID, "actor_user_id": strings.TrimSpace(actorUserID)}
	payloadBytes, _ := json.Marshal(payloadMap)
	payload := string(payloadBytes)
	identity := jobregistry.Identity{ScopeID: workspaceID, DedupeKey: "growth:" + accountID}
	exists, err := tx.NewSelect().Model((*models.Job)(nil)).Where("type = ? AND scope_id = ? AND dedupe_key = ? AND status IN (?, ?)", jobregistry.TypeGrowthDiscovery, identity.ScopeID, identity.DedupeKey, jobregistry.StatusPending, jobregistry.StatusProcessing).Exists(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	job, err := jobregistry.NewJob(jobregistry.TypeGrowthDiscovery, payload, runAt)
	if err != nil {
		return err
	}
	job.ScopeID = identity.ScopeID
	job.DedupeKey = identity.DedupeKey
	_, err = tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
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
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ResolvedFeature{}, err
	}
	availability, reason, unavailable := resolveAvailability(supported, allowed, missing, planReason, unavailable)
	storedExists := pref != nil
	storedEnabled := storedExists && pref.Enabled
	effective := storedExists && storedEnabled && supported && len(missing) == 0 && allowed
	decidedAt, decidedBy, source := extractPreferenceMeta(pref)
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

func resolveAvailability(supported, allowed bool, missing []string, planReason, unavailable string) (string, string, string) {
	switch {
	case !supported:
		return AvailabilityUnsupported, ReasonUnsupported, unavailable
	case !allowed:
		if planReason != "" {
			unavailable = planReason
		}
		return AvailabilityPlanRestricted, ReasonPlanRestricted, unavailable
	case len(missing) > 0:
		return AvailabilityMissingScope, ReasonMissingScope, unavailable
	default:
		return AvailabilityAvailable, ReasonAvailable, unavailable
	}
}

func extractPreferenceMeta(pref *models.AccountFeature) (*time.Time, string, string) {
	if pref == nil {
		return nil, "", ""
	}
	t := pref.DecidedAt
	return &t, pref.DecidedByUserID, pref.Source
}

func (s *Service) supportFor(_ context.Context, account models.SocialAccount, feature string) ([]string, []string, string, bool) {
	if feature == FeatureAnalytics {
		if source := s.analyticsSources[strings.ToLower(strings.TrimSpace(account.Platform))]; source != nil {
			return s.supportForAnalytics(account, source)
		}
	}
	adapter, ok := s.resolveAdapter(platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState))
	if !ok || adapter == nil {
		return nil, nil, "", false
	}
	switch feature {
	case FeatureMessaging:
		return s.supportForMessaging(account, adapter)
	case FeatureEngagement:
		return s.supportForEngagement(account, adapter)
	case FeatureAnalytics:
		return s.supportForAnalytics(account, adapter)
	case FeatureGrow:
		return s.supportForGrow(adapter)
	default:
		return nil, nil, "", false
	}
}

func (s *Service) resolveAdapter(providerKey string) (platform.Adapter, bool) {
	adapter, ok := s.providers[providerKey]
	if ok {
		return adapter, true
	}
	if strings.HasPrefix(providerKey, "mastodon") {
		for k, v := range s.providers {
			if strings.HasPrefix(k, "mastodon") {
				return v, true
			}
		}
	}
	return nil, false
}

func (s *Service) supportForMessaging(account models.SocialAccount, adapter platform.Adapter) ([]string, []string, string, bool) {
	m, ok := adapter.(platform.MessagingAdapter)
	if !ok {
		return nil, nil, "", false
	}
	sup := m.MessagingSupport()
	if !sup.Enabled {
		return sup.RequiredScopes, nil, sup.Unavailable, false
	}
	missing := missingScopes(account.GrantedScopes, sup.RequiredScopes)
	return sup.RequiredScopes, missing, sup.Unavailable, true
}

func (s *Service) supportForEngagement(account models.SocialAccount, adapter platform.Adapter) ([]string, []string, string, bool) {
	e, ok := adapter.(engagementSupporter)
	if !ok {
		return nil, nil, "", false
	}
	sup := e.EngagementSupport()
	if !sup.Enabled {
		return sup.RequiredScopes, nil, sup.Unavailable, false
	}
	missing := missingScopes(account.GrantedScopes, sup.RequiredScopes)
	return sup.RequiredScopes, missing, sup.Unavailable, true
}

func (s *Service) supportForAnalytics(account models.SocialAccount, adapter any) ([]string, []string, string, bool) {
	a, ok := adapter.(platform.AnalyticsAdapter)
	if !ok {
		return nil, nil, "", false
	}
	sup := s.resolveAnalyticsSupport(account, a, adapter)
	supported := sup.Account || sup.Content
	required := append([]string{}, sup.AccountRequiredScopes...)
	required = append(required, sup.ContentRequiredScopes...)
	unavailable := firstNonEmpty(sup.AccountUnavailable, sup.ContentUnavailable)
	if !supported {
		return required, nil, unavailable, false
	}
	missing := missingScopes(account.GrantedScopes, required)
	return required, missing, unavailable, true
}

func (s *Service) resolveAnalyticsSupport(account models.SocialAccount, a platform.AnalyticsAdapter, adapter any) platform.AnalyticsSupport {
	if resolver, ok := adapter.(platform.AccountAnalyticsSupportResolver); ok {
		var capState map[string]string
		_ = json.Unmarshal([]byte(account.CapabilityState), &capState)
		return resolver.AnalyticsSupportForAccount(platform.AnalyticsAccountContext{
			AccountID:       account.AccountID,
			GrantedScopes:   account.GrantedScopes,
			CapabilityState: capState,
		})
	}
	return a.AnalyticsSupport()
}

func (s *Service) supportForGrow(adapter platform.Adapter) ([]string, []string, string, bool) {
	if _, ok := adapter.(platform.GrowthDiscoverer); ok {
		return nil, nil, "", true
	}
	if _, ok := adapter.(platform.GrowthFollower); ok {
		return nil, nil, "", true
	}
	return nil, nil, "", false
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
