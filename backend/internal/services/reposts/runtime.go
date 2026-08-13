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
	"github.com/openpost/backend/internal/services/providerwrite"
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
		s.markExecutionFailed(ctx, execution, "ambiguous_provider_result", "The worker stopped during the provider repost. OpenPost did not retry because the provider result may be ambiguous.")
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
	inserted, _ := result.RowsAffected()
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
		_ = json.Unmarshal([]byte(state.MetricsJSON), &metrics)
	}
	eligible := thresholdsSatisfied(rule, metrics) && (!rule.RequirePlateau || (stateFound && state.UnchangedStreak >= rule.PlateauChecks))
	metricsJSON, _ := json.Marshal(metrics)
	execution.CheckCount++
	execution.LastMetricsJSON = string(metricsJSON)
	execution.UpdatedAt = now
	if eligible {
		execution.Status = StatusReady
		execution.NextCheckAt = now
		if _, err := s.db.NewUpdate().Model(execution).Column("status", "next_check_at", "check_count", "last_metrics_json", "updated_at").Where("id = ? AND status = ?", execution.ID, StatusPending).Exec(ctx); err != nil {
			return err
		}
		return s.enqueueExecution(ctx, execution.ID, JobTypeExecute, now)
	}
	if !now.Before(execution.DeadlineAt) {
		return s.finishExecution(ctx, execution, "threshold_not_met", "Engagement did not meet the repost rule before its evaluation window ended.")
	}
	next := now.Add(checkInterval)
	if next.After(execution.DeadlineAt) {
		next = execution.DeadlineAt
	}
	return s.rescheduleEvaluationWithMetrics(ctx, execution, next)
}

func (s *Service) execute(ctx context.Context, executionID string) error {
	execution, _, err := s.loadExecutionRule(ctx, executionID, StatusReady)
	if err != nil || execution == nil {
		return err
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
	token, err := s.tokenSource.GetValidAccessToken(ctx, target.ID)
	if err != nil {
		s.markExecutionFailed(ctx, execution, "authentication_failed", "The target account needs to be reconnected.")
		return fmt.Errorf("repost target authentication: %w", err)
	}
	result, err := s.executeRepostWrite(ctx, *execution, source, target, rendition, adapter, token)
	if err != nil {
		s.markExecutionFailed(ctx, execution, "provider_write_failed", "The provider write failed. OpenPost did not retry because the result may be ambiguous.")
		return err
	}
	now := time.Now().UTC()
	execution.Status = StatusSucceeded
	execution.ExternalID = result.ExternalID
	execution.ExternalURL = result.ExternalURL
	execution.ErrorCode = ""
	execution.ErrorMessage = ""
	execution.NextCheckAt = time.Time{}
	execution.CompletedAt = now
	execution.UpdatedAt = now
	if _, err := s.db.NewUpdate().Model(execution).
		Column("status", "external_id", "external_url", "error_code", "error_message", "next_check_at", "completed_at", "updated_at").
		Where("id = ? AND status = ?", execution.ID, StatusReady).Exec(ctx); err != nil {
		return err
	}
	s.recordEvent(ctx, *execution, lifecycle.StatusSucceeded, "post reposted", map[string]any{
		"target_account_id": target.ID,
		"external_id":       result.ExternalID,
		"external_url":      result.ExternalURL,
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
	fingerprint, err := providerwrite.Fingerprint("provider-repost-v1", request)
	if err != nil {
		return platform.PublishResult{}, err
	}
	jobExecution, _ := providerwrite.JobExecutionFromContext(ctx)
	return providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: "repost:" + execution.ID,
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
	if _, err := s.db.NewUpdate().Model(execution).Column("next_check_at", "updated_at").Where("id = ? AND status = ?", execution.ID, StatusPending).Exec(ctx); err != nil {
		return err
	}
	return s.enqueueExecution(ctx, execution.ID, JobTypeEvaluate, runAt)
}

func (s *Service) rescheduleEvaluationWithMetrics(ctx context.Context, execution *models.RepostExecution, runAt time.Time) error {
	execution.NextCheckAt = runAt
	if _, err := s.db.NewUpdate().Model(execution).
		Column("next_check_at", "check_count", "last_metrics_json", "updated_at").
		Where("id = ? AND status = ?", execution.ID, StatusPending).Exec(ctx); err != nil {
		return err
	}
	return s.enqueueExecution(ctx, execution.ID, JobTypeEvaluate, runAt)
}

func (s *Service) finishExecution(ctx context.Context, execution *models.RepostExecution, code, message string) error {
	now := time.Now().UTC()
	execution.Status = StatusSkipped
	execution.ErrorCode = code
	execution.ErrorMessage = message
	execution.NextCheckAt = time.Time{}
	execution.CompletedAt = now
	execution.UpdatedAt = now
	if _, err := s.db.NewUpdate().Model(execution).
		Column("status", "error_code", "error_message", "next_check_at", "check_count", "last_metrics_json", "completed_at", "updated_at").
		Where("id = ?", execution.ID).Exec(ctx); err != nil {
		return err
	}
	s.recordEvent(ctx, *execution, lifecycle.StatusInfo, "repost skipped", map[string]any{
		"target_account_id": execution.TargetAccountID,
		"reason":            message,
		"code":              code,
	})
	return nil
}

func (s *Service) markExecutionFailed(ctx context.Context, execution *models.RepostExecution, code, message string) {
	now := time.Now().UTC()
	execution.Status = StatusFailed
	execution.ErrorCode = code
	execution.ErrorMessage = message
	execution.NextCheckAt = time.Time{}
	execution.CompletedAt = now
	execution.UpdatedAt = now
	_, _ = s.db.NewUpdate().Model(execution).
		Column("status", "error_code", "error_message", "next_check_at", "completed_at", "updated_at").
		Where("id = ?", execution.ID).Exec(ctx)
	s.recordEvent(ctx, *execution, lifecycle.StatusFailed, "repost failed", map[string]any{
		"target_account_id": execution.TargetAccountID,
		"reason":            message,
		"code":              code,
	})
}

func (s *Service) enqueueExecution(ctx context.Context, executionID, jobType string, runAt time.Time) error {
	payload, err := json.Marshal(struct {
		ExecutionID string `json:"execution_id"`
	}{ExecutionID: executionID})
	if err != nil {
		return err
	}
	err = s.enqueue(ctx, jobType, string(payload), runAt)
	return err
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
		IdempotencyKey: "repost:" + execution.ID + ":" + execution.Status,
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
