package engagement

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var ErrOperationConflict = errors.New("client operation ID was already used for another comment action")

func (s *Service) QueueEngagementActionReceipt(ctx context.Context, actor Actor, itemID, action, message, operationID string) (string, error) {
	var item models.EngagementItem
	if err := s.db.NewSelect().Model(&item).Where("id=?", itemID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	if err := s.authorize(ctx, item.WorkspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return "", err
	}
	if !s.isEngagementEnabled(ctx, item.SocialAccountID) {
		return "", fmt.Errorf("engagement is disabled for this account")
	}
	operationID = strings.TrimSpace(operationID)
	if len(operationID) > 128 {
		return "", fmt.Errorf("client operation ID is too long")
	}
	message = strings.TrimSpace(message)
	encoded, _ := json.Marshal([]string{action, message})
	digest := sha256.Sum256(encoded)
	bodyHash := hex.EncodeToString(digest[:])
	jobID := ""
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		jobID, err = s.queueEngagementActionWithDB(txCtx, tx, actor, item, action, message, operationID, bodyHash)
		return err
	})
	return jobID, err
}

func (s *Service) queueEngagementActionWithDB(ctx context.Context, tx bun.Tx, actor Actor, item models.EngagementItem, action, message, operationID, bodyHash string) (string, error) {
	if err := organizationguard.LockWorkspace(ctx, tx, item.WorkspaceID); err != nil {
		return "", err
	}
	decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(ctx, item.WorkspaceID, actor, workspaceaccess.LevelEdit)
	if err != nil {
		return "", err
	}
	if !decision.Allowed {
		return "", ErrAccessDenied
	}
	if storedID, found, err := engagementOperationReceipt(ctx, tx, actor, item, operationID, bodyHash); found || err != nil {
		return storedID, err
	}
	if err = tx.NewSelect().Model(&item).WherePK().Scan(ctx); err != nil {
		return "", err
	}
	if err := s.requireEngagementFeature(ctx, tx, item.SocialAccountID); err != nil {
		return "", err
	}
	if _, err = validateEngagementAction(item, action, message); err != nil {
		return "", err
	}
	if err := s.stopAutomationForManualReply(ctx, tx, item, action); err != nil {
		return "", err
	}
	if item.Kind == "review" {
		if err := requireReviewActionAvailable(ctx, tx, item.ID); err != nil {
			return "", err
		}
	}
	job, err := s.newEngagementActionJob(actor, item, action, message, operationID)
	if err != nil {
		return "", err
	}
	if _, err = tx.NewInsert().Model(job).Exec(ctx); err != nil {
		return "", err
	}
	err = s.persistEngagementActionReceipt(ctx, tx, actor, item, operationID, bodyHash, job.ID)
	return job.ID, err
}

func engagementOperationReceipt(ctx context.Context, tx bun.Tx, actor Actor, item models.EngagementItem, operationID, bodyHash string) (string, bool, error) {
	if operationID == "" {
		return "", false, nil
	}
	var stored struct {
		BodyHash string
		JobID    string
	}
	err := tx.NewRaw(`SELECT body_hash,job_id FROM engagement_operations WHERE workspace_id=? AND user_id=? AND item_id=? AND operation_id=?`, item.WorkspaceID, actor.UserID, item.ID, operationID).Scan(ctx, &stored)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if stored.BodyHash != bodyHash {
		return "", true, ErrOperationConflict
	}
	return stored.JobID, true, nil
}

func firstActionID(operationID string) string {
	if operationID != "" {
		return operationID
	}
	return uuid.NewString()
}

func (s *Service) newEngagementActionJob(actor Actor, item models.EngagementItem, action, message, operationID string) (*models.Job, error) {
	id := uuid.NewString()
	input := engagementActionJob{ItemID: item.ID, Action: action, Message: message, UserID: actor.UserID, ClientOperationID: firstActionID(operationID)}
	if item.Kind == "review" {
		input.ReviewJobID = id
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	jobType := JobTypeEngagementAct
	if item.Kind == "review" {
		jobType = jobregistry.TypeEngagementReviewAction
	}
	job, err := jobregistry.NewJob(jobType, string(payload), s.now())
	if err != nil {
		return nil, err
	}
	job.ID, job.ScopeID = id, item.WorkspaceID
	return job, nil
}

func (s *Service) persistEngagementActionReceipt(ctx context.Context, tx bun.Tx, actor Actor, item models.EngagementItem, operationID, bodyHash, jobID string) error {
	var err error
	if operationID != "" {
		_, err = tx.NewRaw(`INSERT INTO engagement_operations(workspace_id,user_id,item_id,operation_id,body_hash,job_id) VALUES(?,?,?,?,?,?)`, item.WorkspaceID, actor.UserID, item.ID, operationID, bodyHash, jobID).Exec(ctx)
	}
	if err == nil && item.Kind == "review" {
		_, err = tx.NewInsert().Model(&models.EngagementReviewOperation{ItemID: item.ID, JobID: jobID, State: "active", UpdatedAt: s.now()}).On("CONFLICT (item_id) DO UPDATE").Set("job_id=EXCLUDED.job_id").Set("state=EXCLUDED.state").Set("updated_at=EXCLUDED.updated_at").Exec(ctx)
		if err == nil {
			err = appendEngagementChange(ctx, tx, item)
		}
	}
	return err
}

func (s *Service) stopAutomationForManualReply(ctx context.Context, tx bun.Tx, item models.EngagementItem, action string) error {
	if action != "reply" {
		return nil
	}

	if err := s.stopItemAutomation(ctx, tx, item); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().Model(&item).Set("automation_stopped_at = ?", s.now()).WherePK().Exec(ctx); err != nil {
		return err
	}

	return nil
}

func (s *Service) requireEngagementFeature(ctx context.Context, tx bun.Tx, accountID string) error {
	if scoped, ok := s.featureGate.(interface {
		IsEffectiveEnabledWithDB(context.Context, bun.IDB, string, string) (bool, error)
	}); ok {
		enabled, err := scoped.IsEffectiveEnabledWithDB(ctx, tx, accountID, "engagement")
		if err != nil {
			return err
		}
		if !enabled {
			return fmt.Errorf("engagement is disabled for this account")
		}
	}
	return nil
}
