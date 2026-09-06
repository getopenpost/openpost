package reposts

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
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publisher"
	"github.com/uptrace/bun"
)

const (
	sweepInterval = 15 * time.Minute
	checkInterval = 15 * time.Minute
)

func (s *Service) ScheduleSweep(ctx context.Context, runAt time.Time) error {
	payload, err := json.Marshal(struct {
		ScheduledFor string `json:"scheduled_for"`
	}{ScheduledFor: runAt.UTC().Truncate(time.Minute).Format(time.RFC3339)})
	if err != nil {
		return fmt.Errorf("encode repost sweep: %w", err)
	}
	err = s.enqueue(ctx, JobTypeSweep, string(payload), runAt)
	return err
}

// ScheduleForRendition snapshots the applicable rule as soon as publishing has
// persisted the provider result. It is safe to call repeatedly.
//
//nolint:gocyclo
func (s *Service) ScheduleForRendition(ctx context.Context, renditionID string) error {
	var rendition models.Rendition
	if err := s.db.NewSelect().Model(&rendition).Where("id = ? AND status = ?", renditionID, models.RenditionStatusPublished).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load repost source rendition: %w", err)
	}
	var publication models.Publication
	if err := s.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return fmt.Errorf("load repost source publication: %w", err)
	}
	var source models.SocialAccount
	if err := s.db.NewSelect().Model(&source).Where("id = ? AND is_active = ?", rendition.SocialAccountID, true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load repost source account: %w", err)
	}
	if !SupportsPlatform(source.Platform) || s.repostAdapter(source) == nil {
		return nil
	}

	type candidate struct {
		policyID   string
		policyName string
		targetID   string
		rule       Rule
	}
	candidates := make([]candidate, 0)
	override := DecodeOverride(publication.RepostOverride)
	switch override.Mode {
	case ModeOff:
		return nil
	case ModeCustom:
		for _, targetID := range override.TargetAccountIDs {
			candidates = append(candidates, candidate{targetID: targetID, rule: override.Rule})
		}
	default:
		policies, err := s.listPolicies(ctx, publication.WorkspaceID)
		if err != nil {
			return err
		}
		for _, policy := range policies {
			if !policy.Enabled || (len(policy.SourceAccountIDs) > 0 && !containsID(policy.SourceAccountIDs, source.ID)) {
				continue
			}
			for _, targetID := range policy.TargetAccountIDs {
				candidates = append(candidates, candidate{
					policyID: policy.ID, policyName: policy.Name, targetID: targetID, rule: policy.Rule,
				})
			}
		}
	}

	publishedAt := publication.ActualRunAt
	if publishedAt.IsZero() {
		publishedAt = rendition.UpdatedAt
	}
	if publishedAt.IsZero() {
		publishedAt = time.Now().UTC()
	}
	seenTargets := make(map[string]bool)
	for _, item := range candidates {
		if seenTargets[item.targetID] {
			continue
		}
		seenTargets[item.targetID] = true
		var target models.SocialAccount
		if err := s.db.NewSelect().Model(&target).Where("id = ? AND is_active = ?", item.targetID, true).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return err
		}
		if target.Platform != source.Platform || s.repostAdapter(target) == nil {
			continue
		}
		if target.WorkspaceID != publication.WorkspaceID {
			granted, err := s.hasActiveGrant(ctx, publication.WorkspaceID, target.ID)
			if err != nil {
				return err
			}
			if !granted {
				continue
			}
		}
		if err := s.createExecution(ctx, publication, rendition, source, target, item.policyID, item.policyName, item.rule, publishedAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	switch jobType {
	case JobTypeSweep:
		return s.handleSweep(ctx)
	case JobTypeEvaluate, JobTypeExecute:
		var input struct {
			ExecutionID string `json:"execution_id"`
		}
		if err := json.Unmarshal([]byte(payload), &input); err != nil || strings.TrimSpace(input.ExecutionID) == "" {
			return fmt.Errorf("decode repost job")
		}
		if jobType == JobTypeEvaluate {
			return s.evaluate(ctx, input.ExecutionID)
		}
		return s.execute(ctx, input.ExecutionID)
	default:
		return fmt.Errorf("unsupported repost job type %q", jobType)
	}
}

func (s *Service) MarkAmbiguousWrite(ctx context.Context, payload string) {
	var input struct {
		ExecutionID string `json:"execution_id"`
	}
	if json.Unmarshal([]byte(payload), &input) != nil || input.ExecutionID == "" {
		return
	}
	execution, _, err := s.loadExecutionRule(ctx, input.ExecutionID, StatusReady)
	if err == nil && execution != nil {
		_ = s.failExecution(ctx, execution, "ambiguous_provider_result", "The worker stopped during the provider repost. OpenPost did not retry because the provider result may be ambiguous.")
	}
}

func (s *Service) handleSweep(ctx context.Context) error {
	now := time.Now().UTC()
	cutoff := now.Add(-maxEvaluationWindow)
	var renditions []models.Rendition
	if err := s.db.NewSelect().Model(&renditions).
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Where("rendition.status = ?", models.RenditionStatusPublished).
		Where("COALESCE(publication.actual_run_at, rendition.updated_at) >= ?", cutoff).
		Where("publication.repost_override_json NOT LIKE ?", `%"mode":"off"%`).
		Where("publication.repost_override_json LIKE ? OR EXISTS (SELECT 1 FROM repost_policies AS policy WHERE policy.workspace_id = publication.workspace_id AND policy.enabled = ?)", `%"mode":"custom"%`, true).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("list repost sweep renditions: %w", err)
	}
	var combined error
	for _, rendition := range renditions {
		if err := s.ScheduleForRendition(ctx, rendition.ID); err != nil {
			combined = errors.Join(combined, err)
		}
	}
	var due []models.RepostExecution
	if err := s.db.NewSelect().Model(&due).
		Where("status IN (?, ?) AND next_check_at IS NOT NULL AND next_check_at <= ?", StatusPending, StatusReady, now).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		combined = errors.Join(combined, fmt.Errorf("list due reposts: %w", err))
	}
	for _, execution := range due {
		jobType := JobTypeEvaluate
		if execution.Status == StatusReady {
			jobType = JobTypeExecute
		}
		if err := s.enqueueExecution(ctx, execution.ID, jobType, now); err != nil {
			combined = errors.Join(combined, err)
		}
	}
	if err := s.ScheduleSweep(ctx, now.Add(sweepInterval)); err != nil {
		combined = errors.Join(combined, err)
	}
	return combined
}

func (s *Service) createExecution(
	ctx context.Context,
	publication models.Publication,
	rendition models.Rendition,
	source models.SocialAccount,
	target models.SocialAccount,
	policyID, policyName string,
	rule Rule,
	publishedAt time.Time,
) error {
	rule, err := NormalizeRule(rule)
	if err != nil {
		return err
	}
	snapshot, err := json.Marshal(ruleSnapshot{PolicyName: policyName, Rule: rule})
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	eligibleAfter := publishedAt.Add(time.Duration(rule.DelaySeconds) * time.Second)
	deadline := publishedAt.Add(time.Duration(rule.EvaluationWindowSeconds) * time.Second)
	if !deadline.After(eligibleAfter) {
		deadline = eligibleAfter.Add(checkInterval)
	}
	if deadline.Before(now) {
		return nil
	}
	execution := &models.RepostExecution{
		ID:               uuid.NewString(),
		WorkspaceID:      publication.WorkspaceID,
		PublicationID:    publication.ID,
		RenditionID:      rendition.ID,
		SourceAccountID:  source.ID,
		TargetAccountID:  target.ID,
		PolicyID:         policyID,
		RuleSnapshotJSON: string(snapshot),
		Status:           StatusPending,
		CurrentStage:     1,
		TotalStages:      len(rule.Stages),
		StageHistoryJSON: "[]",
		EligibleAfter:    eligibleAfter,
		DeadlineAt:       deadline,
		NextCheckAt:      maxTime(now, eligibleAfter),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	result, err := s.db.NewInsert().Model(execution).On("CONFLICT (rendition_id, target_account_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return fmt.Errorf("create repost execution: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read repost execution insert result: %w", err)
	}
	if inserted == 0 {
		return nil
	}
	if err := s.enqueueExecution(ctx, execution.ID, JobTypeEvaluate, execution.NextCheckAt); err != nil {
		return err
	}
	s.recordEvent(ctx, *execution, lifecycle.StatusStarted, "repost scheduled", map[string]any{
		"target_account_id": target.ID,
		"eligible_after":    eligibleAfter.Format(time.RFC3339),
		"deadline_at":       deadline.Format(time.RFC3339),
	})
	return nil
}

//nolint:gocyclo
func (s *Service) evaluate(ctx context.Context, executionID string) error {
	execution, rule, err := s.loadExecutionRule(ctx, executionID, StatusPending)
	if err != nil || execution == nil {
		return err
	}
	now := time.Now().UTC()
	if now.Before(execution.EligibleAfter) {
		return s.rescheduleEvaluation(ctx, execution, execution.EligibleAfter)
	}
	if !now.Before(execution.DeadlineAt) {
		return s.finishExecution(ctx, execution, "evaluation_window_expired", "The repost evaluation window ended before this stage could run.")
	}
	if reason, err := s.executionUnavailableReason(ctx, *execution); err != nil {
		return err
	} else if reason != "" {
		return s.finishExecution(ctx, execution, "target_unavailable", reason)
	}

	state := models.AnalyticsSyncState{}
	stateFound := true
	if err := s.db.NewSelect().Model(&state).Where("subject_type = ? AND subject_id = ?", "rendition", execution.RenditionID).Scan(ctx); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("load repost analytics: %w", err)
		}
		stateFound = false
	}
	metrics := platform.AnalyticsValues{}
	if stateFound && state.MetricsJSON != "" {
		if err := json.Unmarshal([]byte(state.MetricsJSON), &metrics); err != nil {
			return fmt.Errorf("decode repost analytics: %w", err)
		}
	}
	eligible := thresholdsSatisfied(rule, metrics) && (!rule.RequirePlateau || (stateFound && state.UnchangedStreak >= rule.PlateauChecks))
	metricsJSON, err := json.Marshal(metrics)
	if err != nil {
		return fmt.Errorf("encode repost analytics snapshot: %w", err)
	}
	execution.CheckCount++
	execution.LastMetricsJSON = string(metricsJSON)
	execution.UpdatedAt = now
	if eligible {
		execution.Status = StatusReady
		execution.NextCheckAt = now
		result, err := s.db.NewUpdate().Model(execution).Column("status", "next_check_at", "check_count", "last_metrics_json", "updated_at").Where("id = ? AND status = ?", execution.ID, StatusPending).Exec(ctx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return nil
		}
		return s.enqueueExecution(ctx, execution.ID, JobTypeExecute, now)
	}
	next := now.Add(checkInterval)
	if next.After(execution.DeadlineAt) {
		next = execution.DeadlineAt
	}
	return s.rescheduleEvaluationWithMetrics(ctx, execution, next)
}

//nolint:gocyclo // This is the durable stage transition boundary; each branch persists a distinct terminal or resumable outcome.
func (s *Service) execute(ctx context.Context, executionID string) error {
	execution, rule, err := s.loadExecutionRule(ctx, executionID, StatusReady)
	if err != nil || execution == nil {
		return err
	}
	if !time.Now().UTC().Before(execution.DeadlineAt) {
		return s.finishExecution(ctx, execution, "evaluation_window_expired", "The repost evaluation window ended before this stage could run.")
	}
	if reason, err := s.executionUnavailableReason(ctx, *execution); err != nil {
		return err
	} else if reason != "" {
		return s.finishExecution(ctx, execution, "target_unavailable", reason)
	}
	var rendition models.Rendition
	if err := s.db.NewSelect().Model(&rendition).Where("id = ? AND status = ?", execution.RenditionID, models.RenditionStatusPublished).Scan(ctx); err != nil {
		return s.finishExecution(ctx, execution, "source_unavailable", "The source rendition is no longer published.")
	}
	var source, target models.SocialAccount
	if err := s.db.NewSelect().Model(&source).Where("id = ? AND is_active = ?", execution.SourceAccountID, true).Scan(ctx); err != nil {
		return s.finishExecution(ctx, execution, "source_unavailable", "The source account is no longer active.")
	}
	if err := s.db.NewSelect().Model(&target).Where("id = ? AND is_active = ?", execution.TargetAccountID, true).Scan(ctx); err != nil {
		return s.finishExecution(ctx, execution, "target_unavailable", "The target account is no longer active.")
	}
	adapter := s.repostAdapter(target)
	if adapter == nil {
		return s.finishExecution(ctx, execution, "provider_unsupported", "The target provider no longer supports native reposts.")
	}
	stageIndex := execution.CurrentStage - 1
	if stageIndex < 0 || stageIndex >= len(rule.Stages) {
		return s.failExecution(ctx, execution, "invalid_stage", "The saved repost stage is invalid.")
	}
	stage := rule.Stages[stageIndex]
	history, err := decodeStageHistory(execution.StageHistoryJSON)
	if err != nil {
		return s.failExecution(ctx, execution, "invalid_stage_history", "The saved repost stage history is invalid.")
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, target.ID)
	if err != nil {
		if persistErr := s.failExecution(ctx, execution, "authentication_failed", "The target account needs to be reconnected."); persistErr != nil {
			return errors.Join(fmt.Errorf("repost target authentication: %w", err), persistErr)
		}
		return fmt.Errorf("repost target authentication: %w", err)
	}

	if stage.UnrepostPrevious && len(history) > 0 && history[len(history)-1].UnrepostedAt.IsZero() {
		unrepostAdapter, ok := adapter.(platform.UnrepostAdapter)
		if !ok {
			return s.failExecution(ctx, execution, "provider_unrepost_unsupported", "The target provider cannot remove the preceding repost.")
		}
		unrepostErr := s.executeUnrepostWrite(ctx, *execution, target, rendition, history[len(history)-1], unrepostAdapter, token)
		if unrepostErr != nil {
			return s.handleUnrepostFailure(ctx, execution, unrepostErr)
		}
		history[len(history)-1].UnrepostedAt = time.Now().UTC()
		if err := s.persistUnrepostCheckpoint(ctx, execution, history); err != nil {
			return err
		}
	}

	result, err := s.executeRepostWrite(ctx, *execution, source, target, rendition, adapter, token)
	if err != nil {
		if persistErr := s.failExecution(ctx, execution, "provider_write_failed", "The provider write failed. OpenPost did not retry because the result may be ambiguous."); persistErr != nil {
			return errors.Join(err, persistErr)
		}
		return err
	}
	now := time.Now().UTC()
	history = append(history, StageHistoryEntry{
		Stage: execution.CurrentStage, DelaySeconds: stage.DelaySeconds, UnrepostPrevious: stage.UnrepostPrevious,
		RepostExternalID: result.ExternalID, ExternalURL: result.ExternalURL, ExecutedAt: now,
	})
	historyJSON, err := json.Marshal(history)
	if err != nil {
		return fmt.Errorf("encode repost stage history: %w", err)
	}
	execution.ExternalID = result.ExternalID
	execution.ExternalURL = result.ExternalURL
	execution.StageHistoryJSON = string(historyJSON)
	execution.ErrorCode = ""
	execution.ErrorMessage = ""
	execution.UpdatedAt = now

	if execution.CurrentStage < execution.TotalStages {
		nextStage := rule.Stages[execution.CurrentStage]
		execution.CurrentStage++
		execution.UnrepostAttempts = 0
		execution.Status = StatusPending
		var publication models.Publication
		if err := s.db.NewSelect().Model(&publication).Where("id = ?", execution.PublicationID).Scan(ctx); err != nil {
			return fmt.Errorf("load repost publication timing: %w", err)
		}
		publishedAt := publication.ActualRunAt
		if publishedAt.IsZero() {
			publishedAt = rendition.UpdatedAt
		}
		if publishedAt.IsZero() {
			publishedAt = execution.CreatedAt
		}
		execution.EligibleAfter = publishedAt.Add(time.Duration(nextStage.DelaySeconds) * time.Second)
		execution.NextCheckAt = maxTime(now, execution.EligibleAfter)
		result, err := s.db.NewUpdate().Model(execution).
			Column("current_stage", "unrepost_attempts", "status", "eligible_after", "next_check_at", "external_id", "external_url", "stage_history_json", "error_code", "error_message", "updated_at").
			Where("id = ? AND status = ?", execution.ID, StatusReady).Exec(ctx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return nil
		}
		if err := s.enqueueExecution(ctx, execution.ID, JobTypeEvaluate, execution.NextCheckAt); err != nil {
			return err
		}
		s.recordEvent(ctx, *execution, lifecycle.StatusInfo, "repost stage scheduled", map[string]any{
			"target_account_id": target.ID, "completed_stage": execution.CurrentStage - 1,
			"current_stage": execution.CurrentStage, "total_stages": execution.TotalStages,
			"next_check_at": execution.NextCheckAt.Format(time.RFC3339),
		})
		return nil
	}

	execution.Status = StatusSucceeded
	execution.NextCheckAt = time.Time{}
	execution.CompletedAt = now
	resultUpdate, err := s.db.NewUpdate().Model(execution).
		Column("status", "external_id", "external_url", "stage_history_json", "error_code", "error_message", "next_check_at", "completed_at", "updated_at").
		Where("id = ? AND status = ?", execution.ID, StatusReady).Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := resultUpdate.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	s.recordEvent(ctx, *execution, lifecycle.StatusSucceeded, "post reposted", map[string]any{
		"target_account_id": target.ID,
		"external_id":       result.ExternalID,
		"external_url":      result.ExternalURL,
		"total_stages":      execution.TotalStages,
	})
	return nil
}

func (s *Service) executeRepostWrite(
	ctx context.Context,
	execution models.RepostExecution,
	source, target models.SocialAccount,
	rendition models.Rendition,
	adapter platform.RepostAdapter,
	token string,
) (platform.PublishResult, error) {
	request := platform.RepostRequest{
		SourceAccountID: source.AccountID, SourceInstanceURL: source.InstanceURL,
		ExternalID: rendition.ExternalID, ExternalURL: repostSourceURL(source, rendition),
	}
	fingerprint, err := providerwrite.Fingerprint("provider-repost-v2", struct {
		Request platform.RepostRequest `json:"request"`
		Stage   int                    `json:"stage"`
	}{Request: request, Stage: execution.CurrentStage})
	if err != nil {
		return platform.PublishResult{}, err
	}
	jobExecution, _ := providerwrite.JobExecutionFromContext(ctx)
	return providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: fmt.Sprintf("repost:%s:stage:%d", execution.ID, execution.CurrentStage),
		JobID:       jobExecution.ID, WorkspaceID: execution.WorkspaceID,
		SocialAccountID: target.ID, TargetKey: repostProviderKey(target),
		Provider: target.Platform, Operation: "repost", PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		allowed, reason, quotaErr := s.checkProviderWriteQuota(sendCtx, execution.WorkspaceID)
		if quotaErr != nil {
			return platform.PublishResult{}, quotaErr
		}
		if !allowed {
			if strings.TrimSpace(reason) == "" {
				reason = "The workspace provider-write quota was reached."
			}
			return platform.PublishResult{}, fmt.Errorf("repost provider-write quota: %s", reason)
		}
		if beginErr := control.Begin(platform.PublishResult{
			ProviderState: "repost", RetrySafety: platform.PublishRetryNever,
		}); beginErr != nil {
			return platform.PublishResult{}, beginErr
		}
		repostResult, repostErr := adapter.Repost(sendCtx, token, target.AccountID, request)
		if repostErr != nil {
			return platform.PublishResult{}, repostErr
		}
		s.recordProviderWrite(sendCtx, execution.WorkspaceID)
		accepted := platform.AcceptedPublishResult(repostResult.ExternalID)
		accepted.ExternalURL = repostResult.ExternalURL
		return accepted, nil
	}, nil)
}

func (s *Service) executeUnrepostWrite(
	ctx context.Context,
	execution models.RepostExecution,
	target models.SocialAccount,
	rendition models.Rendition,
	previous StageHistoryEntry,
	adapter platform.UnrepostAdapter,
	token string,
) error {
	request := platform.UnrepostRequest{
		SourceExternalID: rendition.ExternalID,
		RepostExternalID: previous.RepostExternalID,
	}
	fingerprint, err := providerwrite.Fingerprint("provider-unrepost-v1", request)
	if err != nil {
		return err
	}
	jobExecution, _ := providerwrite.JobExecutionFromContext(ctx)
	_, err = providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: fmt.Sprintf("unrepost:%s:stage:%d", execution.ID, previous.Stage),
		JobID:       jobExecution.ID, WorkspaceID: execution.WorkspaceID,
		SocialAccountID: target.ID, TargetKey: repostProviderKey(target),
		Provider: target.Platform, Operation: "unrepost", PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		allowed, reason, quotaErr := s.checkProviderWriteQuota(sendCtx, execution.WorkspaceID)
		if quotaErr != nil {
			return platform.PublishResult{}, quotaErr
		}
		if !allowed {
			if strings.TrimSpace(reason) == "" {
				reason = "The workspace provider-write quota was reached."
			}
			return platform.PublishResult{}, fmt.Errorf("unrepost provider-write quota: %s", reason)
		}
		if beginErr := control.Begin(platform.PublishResult{
			ProviderState: "unrepost", RetrySafety: platform.PublishRetryIdempotent,
			IdempotencyTTL: maxEvaluationWindow + 24*time.Hour,
		}); beginErr != nil {
			return platform.PublishResult{}, beginErr
		}
		if unrepostErr := adapter.Unrepost(sendCtx, token, target.AccountID, request); unrepostErr != nil {
			return platform.PublishResult{}, unrepostErr
		}
		s.recordProviderWrite(sendCtx, execution.WorkspaceID)
		return platform.AcceptedPublishResult(previous.RepostExternalID), nil
	}, nil)
	return err
}

func decodeStageHistory(raw string) ([]StageHistoryEntry, error) {
	if strings.TrimSpace(raw) == "" {
		return []StageHistoryEntry{}, nil
	}
	var history []StageHistoryEntry
	if err := json.Unmarshal([]byte(raw), &history); err != nil {
		return nil, fmt.Errorf("decode repost stage history: %w", err)
	}
	return history, nil
}

func (s *Service) persistUnrepostCheckpoint(ctx context.Context, execution *models.RepostExecution, history []StageHistoryEntry) error {
	historyJSON, err := json.Marshal(history)
	if err != nil {
		return fmt.Errorf("encode repost stage history: %w", err)
	}
	now := time.Now().UTC()
	durableCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	result, err := s.db.NewUpdate().Model((*models.RepostExecution)(nil)).
		Set("stage_history_json = ?", string(historyJSON)).
		Set("external_id = ''").
		Set("external_url = ''").
		Set("updated_at = ?", now).
		Where("id = ? AND status = ? AND current_stage = ?", execution.ID, StatusReady, execution.CurrentStage).
		Exec(durableCtx)
	if err != nil {
		return fmt.Errorf("persist unrepost checkpoint: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("persist unrepost checkpoint: execution is no longer ready")
	}
	execution.StageHistoryJSON = string(historyJSON)
	execution.ExternalID = ""
	execution.ExternalURL = ""
	execution.UpdatedAt = now
	return nil
}

func (s *Service) handleUnrepostFailure(ctx context.Context, execution *models.RepostExecution, unrepostErr error) error {
	failure := publisher.ClassifyFailure(unrepostErr)
	if !failure.Retryable {
		return s.failExecution(ctx, execution, "provider_unrepost_failed", "The provider refused to remove the preceding repost.")
	}
	now := time.Now().UTC()
	execution.UnrepostAttempts++
	retryAt := now.Add(publisher.RetryDelay(execution.UnrepostAttempts, failure.RetryAfter, 0))
	if !retryAt.Before(execution.DeadlineAt) {
		return s.failExecution(ctx, execution, "provider_unrepost_deadline", "The preceding repost could not be removed before the evaluation window ended.")
	}
	execution.NextCheckAt = retryAt
	execution.UpdatedAt = now
	result, err := s.db.NewUpdate().Model(execution).
		Column("unrepost_attempts", "next_check_at", "updated_at").
		Where("id = ? AND status = ?", execution.ID, StatusReady).Exec(ctx)
	if err != nil {
		return fmt.Errorf("reschedule unrepost: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	return &ExecutionContinuationError{RetryAfter: retryAt.Sub(now)}
}

func repostSourceURL(source models.SocialAccount, rendition models.Rendition) string {
	if platform.IsSafeContentURL(rendition.ExternalURL) {
		return rendition.ExternalURL
	}
	return platform.DeterministicContentURL(
		source.Platform,
		source.AccountID,
		source.AccountUsername,
		source.InstanceURL,
		rendition.ExternalID,
	)
}

func (s *Service) loadExecutionRule(ctx context.Context, executionID, status string) (*models.RepostExecution, Rule, error) {
	var execution models.RepostExecution
	if err := s.db.NewSelect().Model(&execution).Where("id = ? AND status = ?", executionID, status).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, Rule{}, nil
		}
		return nil, Rule{}, err
	}
	var snapshot ruleSnapshot
	if err := json.Unmarshal([]byte(execution.RuleSnapshotJSON), &snapshot); err != nil {
		return nil, Rule{}, fmt.Errorf("decode repost rule snapshot: %w", err)
	}
	rule, err := NormalizeRule(snapshot.Rule)
	if err == nil && len(snapshot.Rule.Stages) == 0 && !execution.DeadlineAt.After(execution.EligibleAfter) {
		execution.DeadlineAt = execution.EligibleAfter.Add(checkInterval)
	}
	return &execution, rule, err
}

func (s *Service) executionUnavailableReason(ctx context.Context, execution models.RepostExecution) (string, error) {
	var source, target models.SocialAccount
	if err := s.db.NewSelect().Model(&source).Where("id = ? AND is_active = ?", execution.SourceAccountID, true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "The source account is no longer active.", nil
		}
		return "", err
	}
	if err := s.db.NewSelect().Model(&target).Where("id = ? AND is_active = ?", execution.TargetAccountID, true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "The target account is no longer active.", nil
		}
		return "", err
	}
	if source.Platform != target.Platform || s.repostAdapter(target) == nil {
		return "The source and target no longer support the same native repost action.", nil
	}
	if target.WorkspaceID != execution.WorkspaceID {
		granted, err := s.hasActiveGrant(ctx, execution.WorkspaceID, target.ID)
		if err != nil {
			return "", err
		}
		if !granted {
			return "The cross-workspace account grant was revoked.", nil
		}
	}
	return "", nil
}

func (s *Service) rescheduleEvaluation(ctx context.Context, execution *models.RepostExecution, runAt time.Time) error {
	execution.NextCheckAt = runAt
	execution.UpdatedAt = time.Now().UTC()
	result, err := s.db.NewUpdate().Model(execution).Column("next_check_at", "updated_at").Where("id = ? AND status = ?", execution.ID, StatusPending).Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	return s.enqueueExecution(ctx, execution.ID, JobTypeEvaluate, runAt)
}

func (s *Service) rescheduleEvaluationWithMetrics(ctx context.Context, execution *models.RepostExecution, runAt time.Time) error {
	execution.NextCheckAt = runAt
	result, err := s.db.NewUpdate().Model(execution).
		Column("next_check_at", "check_count", "last_metrics_json", "updated_at").
		Where("id = ? AND status = ?", execution.ID, StatusPending).Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	return s.enqueueExecution(ctx, execution.ID, JobTypeEvaluate, runAt)
}

func (s *Service) finishExecution(ctx context.Context, execution *models.RepostExecution, code, message string) error {
	expectedStatus := execution.Status
	now := time.Now().UTC()
	execution.Status = StatusSkipped
	execution.ErrorCode = code
	execution.ErrorMessage = message
	execution.NextCheckAt = time.Time{}
	execution.CompletedAt = now
	execution.UpdatedAt = now
	result, err := s.db.NewUpdate().Model(execution).
		Column("status", "error_code", "error_message", "next_check_at", "check_count", "last_metrics_json", "completed_at", "updated_at").
		Where("id = ? AND status = ?", execution.ID, expectedStatus).Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	s.recordEvent(ctx, *execution, lifecycle.StatusInfo, "repost skipped", map[string]any{
		"target_account_id": execution.TargetAccountID,
		"reason":            message,
		"code":              code,
	})
	return nil
}

func (s *Service) failExecution(ctx context.Context, execution *models.RepostExecution, code, message string) error {
	expectedStatus := execution.Status
	now := time.Now().UTC()
	execution.Status = StatusFailed
	execution.ErrorCode = code
	execution.ErrorMessage = message
	execution.NextCheckAt = time.Time{}
	execution.CompletedAt = now
	execution.UpdatedAt = now
	result, err := s.db.NewUpdate().Model(execution).
		Column("status", "error_code", "error_message", "next_check_at", "completed_at", "updated_at").
		Where("id = ? AND status = ?", execution.ID, expectedStatus).Exec(ctx)
	if err != nil {
		return fmt.Errorf("fail repost execution: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	s.recordEvent(ctx, *execution, lifecycle.StatusFailed, "repost failed", map[string]any{
		"target_account_id": execution.TargetAccountID,
		"reason":            message,
		"code":              code,
	})
	return nil
}

func (s *Service) enqueueExecution(ctx context.Context, executionID, jobType string, runAt time.Time) error {
	payload, err := json.Marshal(struct {
		ExecutionID string `json:"execution_id"`
	}{ExecutionID: executionID})
	if err != nil {
		return err
	}
	job, err := jobregistry.NewJob(jobType, string(payload), runAt)
	if err != nil {
		return err
	}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var workspaceID string
		if err := tx.NewSelect().Model((*models.RepostExecution)(nil)).Column("workspace_id").Where("id = ?", executionID).Scan(txCtx, &workspaceID); err != nil {
			return err
		}
		if err := organizationguard.LockWorkspace(txCtx, tx, workspaceID); err != nil {
			return err
		}
		job.ScopeID = executionID
		job.DedupeKey = jobType
		_, err := tx.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(txCtx)
		return err
	})
}

func (s *Service) enqueue(ctx context.Context, jobType, payload string, runAt time.Time) error {
	exists, err := s.db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND payload = ? AND status IN (?, ?)", jobType, payload, "pending", "processing").
		Exists(ctx)
	if err != nil || exists {
		return err
	}
	job, err := jobregistry.NewJob(jobType, payload, runAt)
	if err != nil {
		return err
	}
	if _, err := s.db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
		return fmt.Errorf("enqueue %s: %w", jobType, err)
	}
	return nil
}

func (s *Service) recordEvent(ctx context.Context, execution models.RepostExecution, status, message string, metadata map[string]any) {
	_, _ = s.lifecycle.Record(ctx, lifecycle.EventInput{
		WorkspaceID: execution.WorkspaceID, PublicationID: execution.PublicationID, RenditionID: execution.RenditionID,
		Type: "repost", Status: status, Message: message, Metadata: metadata,
		IdempotencyKey: fmt.Sprintf("repost:%s:stage:%d:%s", execution.ID, execution.CurrentStage, execution.Status),
	})
}

//nolint:gocyclo
func thresholdsSatisfied(rule Rule, metrics platform.AnalyticsValues) bool {
	checks := make([]bool, 0, 4)
	if rule.MinLikes > 0 {
		value, present := metrics[platform.MetricLikes]
		checks = append(checks, present && value >= rule.MinLikes)
	}
	if rule.MinComments > 0 {
		value, present := metrics[platform.MetricComments]
		checks = append(checks, present && value >= rule.MinComments)
	}
	if rule.MinReposts > 0 {
		value, present := metrics[platform.MetricReposts]
		if shareValue, sharePresent := metrics[platform.MetricShares]; sharePresent && (!present || shareValue > value) {
			value, present = shareValue, true
		}
		checks = append(checks, present && value >= rule.MinReposts)
	}
	if rule.MinViews > 0 {
		value, present := metrics[platform.MetricViews]
		checks = append(checks, present && value >= rule.MinViews)
	}
	if len(checks) == 0 {
		return true
	}
	if rule.ThresholdMode == ThresholdAny {
		for _, passed := range checks {
			if passed {
				return true
			}
		}
		return false
	}
	for _, passed := range checks {
		if !passed {
			return false
		}
	}
	return true
}

func containsID(ids []string, id string) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
