package reposts

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func policyRevision(ctx context.Context, db bun.IDB, workspaceID string) (string, error) {
	var policies []models.RepostPolicy
	if err := db.NewSelect().Model(&policies).Where("workspace_id = ?", workspaceID).Order("id ASC").Scan(ctx); err != nil {
		return "", err
	}
	return idempotency.Hash(policies)
}

func (s *Service) executionHistory(ctx context.Context, workspaceID string) ([]RepostExecutionResponse, error) {
	var records []models.RepostExecution
	if err := s.db.NewSelect().Model(&records).Where("workspace_id = ?", workspaceID).Order("created_at DESC").Limit(50).Scan(ctx); err != nil {
		return nil, err
	}
	result := make([]RepostExecutionResponse, 0, len(records))
	for _, record := range records {
		var snapshot ruleSnapshot
		history := []StageHistoryEntry{}
		if err := json.Unmarshal([]byte(record.RuleSnapshotJSON), &snapshot); err != nil {
			return nil, fmt.Errorf("decode saved repost rule: %w", err)
		}
		if err := json.Unmarshal([]byte(record.StageHistoryJSON), &history); err != nil {
			return nil, fmt.Errorf("decode repost history: %w", err)
		}
		item := RepostExecutionResponse{ID: record.ID, PolicyID: record.PolicyID, PolicyName: snapshot.PolicyName, PublicationID: record.PublicationID, TargetAccountID: record.TargetAccountID, Status: record.Status, CurrentStage: record.CurrentStage, TotalStages: record.TotalStages, Error: record.ErrorMessage, Rule: snapshot.Rule, History: history, CreatedAt: record.CreatedAt}
		if !record.NextCheckAt.IsZero() {
			item.NextCheckAt = &record.NextCheckAt
		}
		result = append(result, item)
	}
	return result, nil
}
