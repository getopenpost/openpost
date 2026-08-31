package analytics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/uptrace/bun"
)

const (
	initialDiscoveryHistory = 90 * 24 * time.Hour
	initialDiscoveryItemCap = 250
	routineDiscoveryCadence = 24 * time.Hour
	defaultDiscoveryBackoff = time.Hour
	providerSlotRetry       = 30 * time.Second
)

// DiscoveryPolicy is instance-owned rate policy. It is provider-overridable,
// but never workspace-controlled. ReadRequestsPerDay counts every listing or
// measurement request that reaches the provider.
type DiscoveryPolicy struct {
	ProviderConcurrency int
	ReadRequestsPerDay  int
	PageSize            int
}

func DefaultDiscoveryPolicy(provider string) DiscoveryPolicy {
	policy := DiscoveryPolicy{
		ProviderConcurrency: 1,
		ReadRequestsPerDay:  10,
		PageSize:            platform.AccountContentMaxPageSize,
	}
	if strings.EqualFold(strings.TrimSpace(provider), "x") {
		policy.ReadRequestsPerDay = 0
	}
	return policy
}

func (s *Service) SetDiscoveryPolicy(provider string, policy DiscoveryPolicy) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return
	}
	policy.ProviderConcurrency = max(0, policy.ProviderConcurrency)
	policy.ReadRequestsPerDay = max(0, policy.ReadRequestsPerDay)
	policy.PageSize = min(max(1, policy.PageSize), platform.AccountContentMaxPageSize)
	s.providersMu.Lock()
	s.discoveryPolicies[provider] = policy
	s.providersMu.Unlock()
}

func (s *Service) discoveryPolicy(provider string) DiscoveryPolicy {
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.providersMu.RLock()
	policy, ok := s.discoveryPolicies[provider]
	s.providersMu.RUnlock()
	if !ok {
		return DefaultDiscoveryPolicy(provider)
	}
	return policy
}

// DiscoveryContinuationError asks the worker to requeue the same durable job.
// The page transaction has already committed, so a crash before requeue safely
// resumes from the stored cursor without duplicating the committed page.
type DiscoveryContinuationError struct {
	RetryAfter time.Duration
}

func (e *DiscoveryContinuationError) Error() string {
	return "account content discovery will continue from its committed cursor"
}

func IsDiscoveryContinuation(err error) (time.Duration, bool) {
	var continuation *DiscoveryContinuationError
	if !errors.As(err, &continuation) {
		return 0, false
	}
	return max(0, continuation.RetryAfter), true
}

func (s *Service) reconsiderAccountContentAccounts(ctx context.Context, accounts []models.SocialAccount, now time.Time) (int, error) {
	queued := 0
	for _, account := range accounts {
		inserted, err := s.reconsiderAccountContentDiscovery(ctx, account, now)
		if err != nil {
			return queued, err
		}
		if inserted {
			queued++
		}
	}
	return queued, nil
}

// ReconsiderAccountContentDiscovery is the manual-refresh seam. It rechecks
// support and eligibility but never bypasses routine cadence, stored backoff,
// concurrency, cost policy, or the durable account read budget.
func (s *Service) ReconsiderAccountContentDiscovery(ctx context.Context, accountID string) (bool, error) {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND is_active = ?", strings.TrimSpace(accountID), true).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("load discovery account: %w", err)
	}
	return s.reconsiderAccountContentDiscovery(ctx, account, s.now().UTC())
}

//nolint:gocyclo // Eligibility deliberately centralizes independent support, cadence, backoff, and budget gates.
func (s *Service) reconsiderAccountContentDiscovery(ctx context.Context, account models.SocialAccount, now time.Time) (bool, error) {
	state, err := s.loadDiscoveryState(ctx, account.ID)
	if err != nil {
		return false, err
	}
	discoverer := s.accountContentDiscoverer(account)
	if !s.isAnalyticsEnabled(ctx, account.ID) {
		return false, s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryPermissionRequired,
			"feature_disabled", "Analytics is disabled for this account.", now.Add(routineDiscoveryCadence), now, false)
	}
	if discoverer == nil {
		return false, s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryUnsupported,
			"discovery_not_supported", "This provider does not expose account content discovery in OpenPost.", now.Add(routineDiscoveryCadence), now, false)
	}
	support := discoverer.AccountContentDiscoverySupport(discoveryAccountContext(account))
	if !support.Supported {
		message := boundedDiscoveryMessage(support.UnavailableReason)
		if message == "" {
			message = "This provider does not expose account content discovery for this account."
		}
		return false, s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryUnsupported,
			"discovery_not_supported", message, now.Add(routineDiscoveryCadence), now, false)
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
		return false, s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryPermissionRequired,
			"missing_scope", missingScopeMessage(missing), now.Add(routineDiscoveryCadence), now, false)
	}
	policy := s.discoveryPolicy(account.Platform)
	if policy.ProviderConcurrency == 0 || policy.ReadRequestsPerDay == 0 {
		return false, s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryCostLimited,
			"provider_read_budget_disabled", "Account content discovery is disabled by the provider read-cost policy.", nextUTCDay(now), now, false)
	}

	if state != nil {
		if state.NextEligibleAt.After(now) {
			return false, nil
		}
		if state.Cursor == "" && !state.InitialCompletedAt.IsZero() && state.LastSuccessAt.Add(routineDiscoveryCadence).After(now) {
			return false, nil
		}
	}
	switch {
	case state == nil:
		state = newDiscoveryState(account, now)
	case state.Cursor == "" && state.InitialCompletedAt.IsZero() && state.LastAttemptedAt.IsZero() && state.InitialItemsDiscovered == 0:
		lowerBound := now.Add(-initialDiscoveryHistory)
		state.BackfillWatermark = lowerBound
		state.CyclePublishedAfter = lowerBound
		state.Status = string(platform.AccountContentDiscoveryPartial)
		state.NextEligibleAt = time.Time{}
		state.UpdatedAt = now
	case state.Cursor == "" && !state.InitialCompletedAt.IsZero():
		state.CyclePublishedAfter = state.LastSuccessAt.UTC()
		state.Status = string(platform.AccountContentDiscoveryPartial)
		state.NextEligibleAt = time.Time{}
		state.UpdatedAt = now
	}
	if err := upsertDiscoveryState(ctx, s.db, state); err != nil {
		return false, err
	}
	return s.enqueueAccountContentDiscovery(ctx, account, now)
}

func (s *Service) enqueueAccountContentDiscovery(ctx context.Context, account models.SocialAccount, runAt time.Time) (bool, error) {
	payload, err := jobregistry.EncodeAccountContentDiscoveryPayload(jobregistry.AccountContentDiscoveryPayload{
		WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
	})
	if err != nil {
		return false, err
	}
	identity, err := jobregistry.AccountContentDiscoveryIdentity(account.ID)
	if err != nil {
		return false, err
	}
	job, err := jobregistry.NewJob(jobregistry.TypeAccountContentDiscovery, payload, runAt)
	if err != nil {
		return false, err
	}
	job.ScopeID, job.DedupeKey = identity.ScopeID, identity.DedupeKey
	var inserted bool
	err = organizationguard.WithWorkspace(ctx, s.db, account.WorkspaceID, func(txCtx context.Context, db bun.IDB) error {
		result, insertErr := db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(txCtx)
		if insertErr != nil {
			return insertErr
		}
		rows, rowsErr := result.RowsAffected()
		inserted = rows > 0
		return rowsErr
	})
	if err != nil {
		return false, fmt.Errorf("enqueue account content discovery: %w", err)
	}
	return inserted, nil
}

//nolint:gocyclo // The durable page boundary owns eligibility, provider outcomes, and checkpointing.
func (s *Service) handleAccountContentDiscovery(ctx context.Context, payload jobregistry.AccountContentDiscoveryPayload) error {
	now := s.now().UTC()
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", payload.SocialAccountID, payload.WorkspaceID, true).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load account content discovery account: %w", err)
	}
	discoverer := s.accountContentDiscoverer(account)
	if discoverer == nil {
		return s.recordDiscoveryOutcome(ctx, account, nil, platform.AccountContentDiscoveryUnsupported,
			"discovery_not_supported", "This provider does not expose account content discovery in OpenPost.", now.Add(routineDiscoveryCadence), now, true)
	}
	support := discoverer.AccountContentDiscoverySupport(discoveryAccountContext(account))
	if !support.Supported {
		return s.recordDiscoveryOutcome(ctx, account, nil, platform.AccountContentDiscoveryUnsupported,
			"discovery_not_supported", boundedDiscoveryMessage(support.UnavailableReason), now.Add(routineDiscoveryCadence), now, true)
	}
	if missing := platform.MissingAnalyticsScopes(account.GrantedScopes, support.RequiredScopes); len(missing) > 0 {
		return s.recordDiscoveryOutcome(ctx, account, nil, platform.AccountContentDiscoveryPermissionRequired,
			"missing_scope", missingScopeMessage(missing), now.Add(routineDiscoveryCadence), now, true)
	}
	state, err := s.loadDiscoveryState(ctx, account.ID)
	if err != nil {
		return err
	}
	if state == nil || state.NextEligibleAt.After(now) {
		return nil
	}
	policy := s.discoveryPolicy(account.Platform)
	if policy.ProviderConcurrency == 0 || policy.ReadRequestsPerDay == 0 {
		return s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryCostLimited,
			"provider_read_budget_disabled", "Account content discovery is disabled by the provider read-cost policy.", nextUTCDay(now), now, true)
	}
	if available, err := s.discoveryProviderSlotAvailable(ctx, account.Platform, policy.ProviderConcurrency); err != nil {
		return err
	} else if !available {
		return &DiscoveryContinuationError{RetryAfter: providerSlotRetry}
	}

	pageSize := min(policy.PageSize, platform.AccountContentMaxPageSize)
	if support.MaxPageSize > 0 {
		pageSize = min(pageSize, support.MaxPageSize)
	}
	initial := state.InitialCompletedAt.IsZero()
	if initial {
		remaining := initialDiscoveryItemCap - state.InitialItemsDiscovered
		if remaining <= 0 {
			return s.finishDiscoveryCap(ctx, state, now)
		}
		pageSize = min(pageSize, remaining)
	}
	token, err := s.discoveryAccessToken(ctx, discoverer, account.ID)
	if err != nil {
		status, code, retryAfter := classifyDiscoveryError(err)
		return s.recordDiscoveryOutcome(ctx, account, state, status, code, safeDiscoveryMessage(status), now.Add(max(defaultDiscoveryBackoff, retryAfter)), now, true)
	}
	discoveryRequest := platform.AccountContentDiscoveryRequest{
		AccountID: account.AccountID, GrantedScopes: strings.Fields(account.GrantedScopes),
		CapabilityState: analyticsCapabilityState(account.CapabilityState), Cursor: state.Cursor,
		PublishedAfter: state.CyclePublishedAfter, PageSize: pageSize,
	}
	listingReads := 1
	if estimator, ok := discoverer.(platform.AccountContentDiscoveryReadEstimator); ok {
		listingReads = max(1, estimator.AccountContentDiscoveryReadRequests(discoveryRequest))
	}
	allowed, err := s.reserveDiscoveryReads(ctx, state, policy.ReadRequestsPerDay, listingReads, now)
	if err != nil {
		return err
	}
	if !allowed {
		return nil
	}

	page, err := discoverer.DiscoverAccountContent(ctx, token, discoveryRequest)
	if err != nil {
		return s.recordDiscoveryProviderError(ctx, account, state, err, now)
	}
	if measurer, ok := discoverer.(platform.AccountContentBatchMeasurer); ok {
		providerIDs := discoveryProviderContentIDs(page.Items, state.CyclePublishedAfter)
		if len(providerIDs) > 0 {
			allowed, err = s.reserveDiscoveryReads(ctx, state, policy.ReadRequestsPerDay, 1, now)
			if err != nil {
				return err
			}
			if !allowed {
				return nil
			}
			measurements, measurementErr := measurer.FetchAccountContentBatchMeasurements(ctx, token, platform.AccountContentBatchMeasurementRequest{
				AccountID: account.AccountID, GrantedScopes: strings.Fields(account.GrantedScopes),
				CapabilityState: analyticsCapabilityState(account.CapabilityState), ProviderContentIDs: providerIDs,
			})
			if measurementErr != nil {
				return s.recordDiscoveryProviderError(ctx, account, state, measurementErr, now)
			}
			page = attachDiscoveryMeasurements(page, providerIDs, measurements)
		}
	}
	continuation, err := s.commitDiscoveryPage(ctx, account, state, page, pageSize, now)
	if err != nil {
		recordErr := s.recordDiscoveryOutcome(ctx, account, state, platform.AccountContentDiscoveryFailed,
			"invalid_provider_page", safeDiscoveryMessage(platform.AccountContentDiscoveryFailed), now.Add(defaultDiscoveryBackoff), now, true)
		if recordErr != nil {
			return errors.Join(err, recordErr)
		}
		return nil
	}
	if continuation {
		return &DiscoveryContinuationError{}
	}
	return nil
}

func (s *Service) recordDiscoveryProviderError(ctx context.Context, account models.SocialAccount, state *models.AccountContentDiscoveryState, err error, now time.Time) error {
	status, code, retryAfter := classifyDiscoveryError(err)
	next := now.Add(defaultDiscoveryBackoff)
	switch status {
	case platform.AccountContentDiscoveryRateLimited:
		next = now.Add(max(defaultDiscoveryBackoff, retryAfter))
	case platform.AccountContentDiscoveryPermissionRequired, platform.AccountContentDiscoveryUnsupported:
		next = now.Add(routineDiscoveryCadence)
	case platform.AccountContentDiscoveryCostLimited:
		next = nextUTCDay(now)
	}
	return s.recordDiscoveryOutcome(ctx, account, state, status, code, safeDiscoveryMessage(status), next, now, true)
}

func discoveryProviderContentIDs(items []platform.AccountContentItem, publishedAfter time.Time) []string {
	seen := make(map[string]struct{}, len(items))
	ids := make([]string, 0, len(items))
	for _, item := range items {
		id := strings.TrimSpace(item.ProviderContentID)
		if id == "" || item.PublishedAt.Before(publishedAfter) {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func attachDiscoveryMeasurements(page platform.AccountContentPage, requestedIDs []string, measurements platform.AccountContentBatchMeasurements) platform.AccountContentPage {
	missing := false
	requested := make(map[string]struct{}, len(requestedIDs))
	for _, id := range requestedIDs {
		requested[id] = struct{}{}
		if _, ok := measurements[id]; !ok {
			missing = true
		}
	}
	for index := range page.Items {
		id := strings.TrimSpace(page.Items[index].ProviderContentID)
		if _, ok := requested[id]; !ok {
			continue
		}
		batch, ok := measurements[id]
		if !ok {
			continue
		}
		if page.Items[index].Measurements == nil {
			page.Items[index].Measurements = platform.AnalyticsMeasurements{}
		}
		for metric, measurement := range batch {
			page.Items[index].Measurements[metric] = measurement
		}
	}
	if missing {
		page.Coverage.Status = platform.AccountContentDiscoveryPartial
		page.Coverage.Description = boundedDiscoveryMessage(strings.TrimSpace(page.Coverage.Description + " Some item statistics were unavailable."))
	}
	return page
}

func exactDiscoveryRenditions(ctx context.Context, db bun.IDB, account models.SocialAccount, items []platform.AccountContentItem) (map[string]string, error) {
	ids := discoveryProviderContentIDs(items, time.Time{})
	matches := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return matches, nil
	}
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).
		Column("id", "external_id").
		Where("social_account_id = ? AND platform = ?", account.ID, account.Platform).
		Where("external_id IN (?)", bun.List(ids)).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load exact discovery renditions: %w", err)
	}
	counts := make(map[string]int, len(renditions))
	for _, rendition := range renditions {
		externalID := strings.TrimSpace(rendition.ExternalID)
		counts[externalID]++
		matches[externalID] = rendition.ID
	}
	for externalID, count := range counts {
		if count != 1 {
			delete(matches, externalID)
		}
	}
	return matches, nil
}

//nolint:gocyclo // The page transaction validates, deduplicates, caps, and checkpoints one provider result atomically.
func (s *Service) commitDiscoveryPage(ctx context.Context, account models.SocialAccount, state *models.AccountContentDiscoveryState, page platform.AccountContentPage, pageSize int, now time.Time) (bool, error) {
	if len(page.Items) > pageSize {
		return false, fmt.Errorf("provider returned %d discovery items for page size %d", len(page.Items), pageSize)
	}
	status := page.Coverage.Status
	if status == "" {
		status = platform.AccountContentDiscoveryPartial
	}
	if !validDiscoveryStatus(status) {
		return false, fmt.Errorf("provider returned unsupported discovery coverage status %q", status)
	}
	if utf8.RuneCountInString(page.Coverage.Description) > 500 || len(page.NextCursor) > 2000 {
		return false, fmt.Errorf("provider returned oversized discovery checkpoint metadata")
	}

	seen := make(map[string]struct{}, len(page.Items))
	items := make([]platform.AccountContentItem, 0, len(page.Items))
	for _, item := range page.Items {
		providerID := strings.TrimSpace(item.ProviderContentID)
		if _, duplicate := seen[providerID]; duplicate {
			continue
		}
		seen[providerID] = struct{}{}
		if item.PublishedAt.Before(state.CyclePublishedAfter) {
			continue
		}
		items = append(items, item)
	}

	continuation := false
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		renditions, err := exactDiscoveryRenditions(txCtx, tx, account, items)
		if err != nil {
			return err
		}
		for _, item := range items {
			item.RenditionID = ""
			item.Origin = platform.AccountContentOriginExternal
			item.OriginConfidence = platform.AccountContentOriginConfidenceExact
			if renditionID := renditions[strings.TrimSpace(item.ProviderContentID)]; renditionID != "" {
				item.RenditionID = renditionID
				item.Origin = platform.AccountContentOriginOpenPost
			}
			if _, err := upsertAccountContent(txCtx, tx, account, item, now); err != nil {
				return fmt.Errorf("store discovery page item: %w", err)
			}
		}
		state.Cursor = strings.TrimSpace(page.NextCursor)
		state.Status = string(status)
		state.CoverageStatus = string(status)
		state.CoverageDescription = boundedDiscoveryMessage(page.Coverage.Description)
		state.FailureCode, state.FailureMessage = "", ""
		state.LastAttemptedAt, state.LastSuccessAt, state.UpdatedAt = now, now, now
		if !page.BackfillWatermark.IsZero() {
			state.BackfillWatermark = page.BackfillWatermark.UTC()
		}
		if state.InitialCompletedAt.IsZero() {
			state.InitialItemsDiscovered += len(items)
			if state.InitialItemsDiscovered >= initialDiscoveryItemCap {
				state.Cursor = ""
				state.Status = string(platform.AccountContentDiscoveryPartial)
				state.CoverageStatus = string(platform.AccountContentDiscoveryPartial)
				state.CoverageDescription = "Initial discovery stopped after the 250-item account history limit."
				state.InitialCompletedAt = now
			}
		}
		if terminalDiscoveryStatus(status) {
			state.Cursor = ""
		}
		if state.Cursor == "" {
			if state.InitialCompletedAt.IsZero() && !terminalDiscoveryStatus(status) {
				state.InitialCompletedAt = now
			}
			state.NextEligibleAt = discoveryNextEligible(status, now)
		} else {
			state.NextEligibleAt = time.Time{}
			continuation = true
		}
		return upsertDiscoveryState(txCtx, tx, state)
	})
	return continuation, err
}

func (s *Service) finishDiscoveryCap(ctx context.Context, state *models.AccountContentDiscoveryState, now time.Time) error {
	state.Cursor = ""
	state.Status = string(platform.AccountContentDiscoveryPartial)
	state.CoverageStatus = string(platform.AccountContentDiscoveryPartial)
	state.CoverageDescription = "Initial discovery stopped after the 250-item account history limit."
	state.InitialCompletedAt = now
	state.LastSuccessAt = now
	state.NextEligibleAt = now.Add(routineDiscoveryCadence)
	state.UpdatedAt = now
	return upsertDiscoveryState(ctx, s.db, state)
}

func (s *Service) reserveDiscoveryReads(ctx context.Context, state *models.AccountContentDiscoveryState, limit, requested int, now time.Time) (bool, error) {
	window := utcDay(now)
	if state.ReadBudgetWindowStart.IsZero() || !state.ReadBudgetWindowStart.Equal(window) {
		state.ReadBudgetWindowStart = window
		state.ReadBudgetUsed = 0
	}
	requested = max(1, requested)
	if requested > limit-state.ReadBudgetUsed {
		state.Status = string(platform.AccountContentDiscoveryPartial)
		state.CoverageStatus = string(platform.AccountContentDiscoveryPartial)
		state.FailureCode = "account_read_budget_exhausted"
		state.FailureMessage = "Provider reads will resume after the daily account budget resets."
		state.NextEligibleAt = maxTime(nextUTCDay(now), state.LastSuccessAt.Add(routineDiscoveryCadence))
		state.UpdatedAt = now
		return false, upsertDiscoveryState(ctx, s.db, state)
	}
	state.ReadBudgetUsed += requested
	state.LastAttemptedAt = now
	state.UpdatedAt = now
	return true, upsertDiscoveryState(ctx, s.db, state)
}

func (s *Service) discoveryProviderSlotAvailable(ctx context.Context, provider string, limit int) (bool, error) {
	execution, ok := providerwrite.JobExecutionFromContext(ctx)
	if !ok {
		return true, nil
	}
	var jobs []models.Job
	if err := s.db.NewSelect().Model(&jobs).
		Where("type = ? AND status = ?", jobregistry.TypeAccountContentDiscovery, jobregistry.StatusProcessing).
		Order("id ASC").Scan(ctx); err != nil {
		return false, fmt.Errorf("inspect discovery provider concurrency: %w", err)
	}
	eligible := make([]string, 0, len(jobs))
	for _, job := range jobs {
		payload, err := jobregistry.DecodeAccountContentDiscoveryPayload(job.Payload)
		if err != nil {
			continue
		}
		var jobProvider string
		if err := s.db.NewSelect().Model((*models.SocialAccount)(nil)).Column("platform").
			Where("id = ?", payload.SocialAccountID).Scan(ctx, &jobProvider); err != nil {
			continue
		}
		if strings.EqualFold(jobProvider, provider) {
			eligible = append(eligible, job.ID)
		}
	}
	sort.Strings(eligible)
	for index, jobID := range eligible {
		if jobID == execution.ID {
			return index < limit, nil
		}
	}
	return true, nil
}

func (s *Service) recordDiscoveryOutcome(ctx context.Context, account models.SocialAccount, state *models.AccountContentDiscoveryState, status platform.AccountContentDiscoveryStatus, code, message string, next, now time.Time, attempted bool) error {
	code = safeDiscoveryCode(code)
	message = boundedDiscoveryMessage(message)
	if state != nil && !attempted && state.Status == string(status) && state.FailureCode == code &&
		state.FailureMessage == message && state.NextEligibleAt.After(now) {
		return nil
	}
	if state == nil {
		state = newDiscoveryState(account, now)
	}
	state.Status, state.CoverageStatus = string(status), string(status)
	state.CoverageDescription = message
	state.FailureCode = code
	state.FailureMessage = message
	state.NextEligibleAt = next.UTC()
	if attempted {
		state.LastAttemptedAt = now
	}
	state.UpdatedAt = now
	return upsertDiscoveryState(ctx, s.db, state)
}

func newDiscoveryState(account models.SocialAccount, now time.Time) *models.AccountContentDiscoveryState {
	lowerBound := now.Add(-initialDiscoveryHistory)
	return &models.AccountContentDiscoveryState{
		ID: uuid.NewString(), WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
		Platform: account.Platform, Status: string(platform.AccountContentDiscoveryPartial),
		CoverageStatus:      string(platform.AccountContentDiscoveryPartial),
		CoverageDescription: "Building account history for up to the last 90 days and 250 items.",
		BackfillWatermark:   lowerBound, CyclePublishedAfter: lowerBound,
		CreatedAt: now, UpdatedAt: now,
	}
}

func (s *Service) loadDiscoveryState(ctx context.Context, accountID string) (*models.AccountContentDiscoveryState, error) {
	var state models.AccountContentDiscoveryState
	err := s.db.NewSelect().Model(&state).Where("social_account_id = ?", accountID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load account content discovery state: %w", err)
	}
	return &state, nil
}

func upsertDiscoveryState(ctx context.Context, db bun.IDB, state *models.AccountContentDiscoveryState) error {
	_, err := db.NewInsert().Model(state).
		On("CONFLICT (social_account_id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").Set("platform = EXCLUDED.platform").
		Set("status = EXCLUDED.status").Set("coverage_status = EXCLUDED.coverage_status").
		Set("coverage_description = EXCLUDED.coverage_description").Set("cursor = EXCLUDED.cursor").
		Set("backfill_watermark = EXCLUDED.backfill_watermark").Set("cycle_published_after = EXCLUDED.cycle_published_after").
		Set("initial_completed_at = EXCLUDED.initial_completed_at").Set("initial_items_discovered = EXCLUDED.initial_items_discovered").
		Set("read_budget_window_start = EXCLUDED.read_budget_window_start").Set("read_budget_used = EXCLUDED.read_budget_used").
		Set("last_attempted_at = EXCLUDED.last_attempted_at").Set("last_success_at = EXCLUDED.last_success_at").
		Set("failure_code = EXCLUDED.failure_code").Set("failure_message = EXCLUDED.failure_message").
		Set("next_eligible_at = EXCLUDED.next_eligible_at").Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	if err != nil {
		return fmt.Errorf("store account content discovery state: %w", err)
	}
	return nil
}

func (s *Service) discoveryAccessToken(ctx context.Context, discoverer platform.AccountContentDiscoverer, accountID string) (string, error) {
	if tokenPolicy, ok := discoverer.(interface{ UsesProviderToken() bool }); ok && !tokenPolicy.UsesProviderToken() {
		return "", nil
	}
	return s.accessToken(ctx, accountID)
}

func (s *Service) accountContentDiscoverer(account models.SocialAccount) platform.AccountContentDiscoverer {
	key := account.Platform
	if account.Platform == "mastodon" {
		key = "mastodon:" + account.InstanceURL
	}
	s.providersMu.RLock()
	adapter := s.providers[key]
	s.providersMu.RUnlock()
	discoverer, _ := adapter.(platform.AccountContentDiscoverer)
	return discoverer
}

func discoveryAccountContext(account models.SocialAccount) platform.AnalyticsAccountContext {
	return platform.AnalyticsAccountContext{AccountID: account.AccountID, GrantedScopes: account.GrantedScopes, CapabilityState: analyticsCapabilityState(account.CapabilityState)}
}

func classifyDiscoveryError(err error) (platform.AccountContentDiscoveryStatus, string, time.Duration) {
	var discoveryErr *platform.AccountContentDiscoveryError
	if errors.As(err, &discoveryErr) && validDiscoveryStatus(discoveryErr.Status) {
		return discoveryErr.Status, safeDiscoveryCode(discoveryErr.Code), max(0, discoveryErr.RetryAfter)
	}
	var analyticsErr *platform.AnalyticsError
	if errors.As(err, &analyticsErr) {
		switch analyticsErr.Status {
		case platform.AnalyticsStatusPermissionRequired:
			return platform.AccountContentDiscoveryPermissionRequired, safeDiscoveryCode(analyticsErr.Code), analyticsErr.RetryAfter
		case platform.AnalyticsStatusRateLimited:
			return platform.AccountContentDiscoveryRateLimited, safeDiscoveryCode(analyticsErr.Code), analyticsErr.RetryAfter
		case platform.AnalyticsStatusUnsupported:
			return platform.AccountContentDiscoveryUnsupported, safeDiscoveryCode(analyticsErr.Code), analyticsErr.RetryAfter
		}
	}
	var httpErr *platform.HTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return platform.AccountContentDiscoveryPermissionRequired, safeDiscoveryCode(httpErr.Code), httpErr.RetryAfter
		case http.StatusTooManyRequests:
			return platform.AccountContentDiscoveryRateLimited, safeDiscoveryCode(httpErr.Code), httpErr.RetryAfter
		}
		return platform.AccountContentDiscoveryFailed, safeDiscoveryCode(httpErr.Code), httpErr.RetryAfter
	}
	return platform.AccountContentDiscoveryFailed, "provider_request_failed", 0
}

func validDiscoveryStatus(status platform.AccountContentDiscoveryStatus) bool {
	switch status {
	case platform.AccountContentDiscoveryComplete, platform.AccountContentDiscoveryPartial,
		platform.AccountContentDiscoveryPermissionRequired, platform.AccountContentDiscoveryRateLimited,
		platform.AccountContentDiscoveryCostLimited, platform.AccountContentDiscoveryUnsupported,
		platform.AccountContentDiscoveryFailed:
		return true
	default:
		return false
	}
}

func terminalDiscoveryStatus(status platform.AccountContentDiscoveryStatus) bool {
	return status != platform.AccountContentDiscoveryComplete && status != platform.AccountContentDiscoveryPartial
}

func discoveryNextEligible(status platform.AccountContentDiscoveryStatus, now time.Time) time.Time {
	switch status {
	case platform.AccountContentDiscoveryCostLimited:
		return nextUTCDay(now)
	case platform.AccountContentDiscoveryRateLimited, platform.AccountContentDiscoveryFailed:
		return now.Add(defaultDiscoveryBackoff)
	default:
		return now.Add(routineDiscoveryCadence)
	}
}

func safeDiscoveryMessage(status platform.AccountContentDiscoveryStatus) string {
	switch status {
	case platform.AccountContentDiscoveryPermissionRequired:
		return "Reconnect this account to continue content discovery."
	case platform.AccountContentDiscoveryRateLimited:
		return "The provider rate limit delayed content discovery."
	case platform.AccountContentDiscoveryCostLimited:
		return "Content discovery is paused by the provider read-cost policy."
	case platform.AccountContentDiscoveryUnsupported:
		return "Account content discovery is not available for this provider."
	default:
		return "Account content discovery failed and will be reconsidered later."
	}
}

func safeDiscoveryCode(code string) string {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 64 {
		return "provider_request_failed"
	}
	for _, char := range code {
		letter := char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z'
		digit := char >= '0' && char <= '9'
		if !letter && !digit && !strings.ContainsRune("_.:-", char) {
			return "provider_request_failed"
		}
	}
	return code
}

func boundedDiscoveryMessage(message string) string {
	message = strings.TrimSpace(message)
	runes := []rune(message)
	if len(runes) > 500 {
		message = string(runes[:500])
	}
	return message
}

func utcDay(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func nextUTCDay(value time.Time) time.Time { return utcDay(value).Add(24 * time.Hour) }

func maxTime(left, right time.Time) time.Time {
	if right.After(left) {
		return right
	}
	return left
}
