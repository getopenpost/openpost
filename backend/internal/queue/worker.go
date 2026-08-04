package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	billingservice "github.com/openpost/backend/internal/services/billing"
	communicationsservice "github.com/openpost/backend/internal/services/communications"
	"github.com/openpost/backend/internal/services/feedback"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/publisher"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/uptrace/bun"
)

const (
	// StorageDeleteMaxKeys is the largest storage deletion payload the worker accepts.
	StorageDeleteMaxKeys      = 10_000
	jobTypePublishPost        = "publish_post"
	jobTypePublishPublication = "publish_publication"
	jobStatusPending          = "pending"
	jobTypeMediaCleanup       = "media_cleanup"
	jobTypeStorageDelete      = "storage_delete"
	jobTypeRefreshToken       = "refresh_token"
	jobStatusProcessing       = "processing"
	jobStatusFailed           = "failed"
	jobStatusCompleted        = "completed"
	staleProcessingJobAge     = 15 * time.Minute
	processingHeartbeat       = staleProcessingJobAge / 3
)

// BackgroundWorker polls the configured database for pending jobs.
type BackgroundWorker struct {
	db             *bun.DB
	workerID       string
	interval       time.Duration
	publisher      *publisher.Service
	tokens         *tokenmanager.TokenManager
	storage        mediastore.BlobStorage
	feedback       *feedback.Service
	analytics      *analyticsservice.Service
	billing        *billingservice.Service
	communications *communicationsservice.Service
	video          *videoprocessing.Service
	done           chan struct{}
}

func (w *BackgroundWorker) SetFeedbackService(service *feedback.Service) {
	w.feedback = service
}

func (w *BackgroundWorker) SetAnalyticsService(service *analyticsservice.Service) {
	w.analytics = service
}

func (w *BackgroundWorker) SetBillingService(service *billingservice.Service) {
	w.billing = service
}

func (w *BackgroundWorker) SetCommunicationsService(service *communicationsservice.Service) {
	w.communications = service
}

func (w *BackgroundWorker) SetVideoProcessingService(service *videoprocessing.Service) {
	w.video = service
}

func NewWorker(db *bun.DB, id string, interval time.Duration, pub *publisher.Service, tokens *tokenmanager.TokenManager, storage mediastore.BlobStorage) *BackgroundWorker {
	return &BackgroundWorker{
		db:        db,
		workerID:  id,
		interval:  interval,
		publisher: pub,
		tokens:    tokens,
		storage:   storage,
		done:      make(chan struct{}),
	}
}

func (w *BackgroundWorker) Start(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	log.Printf("Worker %s started polling every %v\n", w.workerID, w.interval)
	w.processDueJobs(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Worker %s shutting down\n", w.workerID)
			close(w.done)
			return
		case <-ticker.C:
			w.processDueJobs(ctx)
		}
	}
}

// Stop signals the worker to stop and waits for it to finish.
func (w *BackgroundWorker) Stop() {
	<-w.done
}

func (w *BackgroundWorker) processDueJobs(ctx context.Context) {
	w.requeueStaleProcessingJobs(ctx)
	for {
		if !w.processNextJobIfAvailable(ctx) {
			return
		}
	}
}

func (w *BackgroundWorker) requeueStaleProcessingJobs(ctx context.Context) {
	cutoff := time.Now().UTC().Add(-staleProcessingJobAge)
	superseded, err := w.db.NewUpdate().
		Model((*models.Job)(nil)).
		Set("status = ?", jobStatusCompleted).
		Set("last_error = ?", "A later analytics sweep was already queued after worker recovery.").
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("type = ? AND status = ?", analyticsservice.JobTypeSweep, jobStatusProcessing).
		Where("locked_at IS NOT NULL").
		Where("locked_at <= ?", cutoff).
		Where("EXISTS (SELECT 1 FROM jobs AS queued_sweep WHERE queued_sweep.type = ? AND queued_sweep.status = ?)", analyticsservice.JobTypeSweep, jobStatusPending).
		Exec(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to supersede stale analytics sweep: %v\n", w.workerID, err)
		return
	}
	if rows, rowsErr := superseded.RowsAffected(); rowsErr == nil && rows > 0 {
		log.Printf("[Worker %s] superseded %d stale analytics sweep job(s)\n", w.workerID, rows)
	}
	communicationsSuperseded, err := w.db.NewUpdate().
		Model((*models.Job)(nil)).
		Set("status = ?", jobStatusCompleted).
		Set("last_error = ?", "A later communications sweep was already queued after worker recovery.").
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("type = ? AND status = ?", communicationsservice.JobTypeSweep, jobStatusProcessing).
		Where("locked_at IS NOT NULL").
		Where("locked_at <= ?", cutoff).
		Where("EXISTS (SELECT 1 FROM jobs AS queued_sweep WHERE queued_sweep.type = ? AND queued_sweep.status = ?)", communicationsservice.JobTypeSweep, jobStatusPending).
		Exec(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to supersede stale communications sweep: %v\n", w.workerID, err)
		return
	}
	if rows, rowsErr := communicationsSuperseded.RowsAffected(); rowsErr == nil && rows > 0 {
		log.Printf("[Worker %s] superseded %d stale communications sweep job(s)\n", w.workerID, rows)
	}

	result, err := w.db.NewUpdate().
		Model((*models.Job)(nil)).
		Set("status = ?", jobStatusPending).
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("status = ?", jobStatusProcessing).
		Where("locked_at IS NOT NULL").
		Where("locked_at <= ?", cutoff).
		Exec(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to requeue stale processing jobs: %v\n", w.workerID, err)
		return
	}
	rows, err := result.RowsAffected()
	if err == nil && rows > 0 {
		log.Printf("[Worker %s] requeued %d stale processing job(s)\n", w.workerID, rows)
	}
}

func (w *BackgroundWorker) processNextJobIfAvailable(ctx context.Context) bool {
	job := new(models.Job)

	err := w.db.NewRaw(`
		UPDATE jobs
		SET status = ?, locked_at = CURRENT_TIMESTAMP, locked_by = ?
		WHERE status = ? AND id = (
			SELECT id FROM jobs 
			WHERE status = ? AND run_at <= CURRENT_TIMESTAMP
			ORDER BY run_at ASC 
			LIMIT 1
		)
		RETURNING *
	`, jobStatusProcessing, w.workerID, jobStatusPending, jobStatusPending).Scan(ctx, job)

	if err != nil {
		if err.Error() != "sql: no rows in result set" {
			log.Printf("[Worker %s] database error polling for jobs: %v\n", w.workerID, err)
		}
		return false
	}

	w.handleLockedJob(ctx, job)
	return true
}

//nolint:gocyclo // Centralizes lock heartbeat, typed failure policy, retries, and terminal job state.
func (w *BackgroundWorker) handleLockedJob(ctx context.Context, job *models.Job) {
	log.Printf("[Worker %s] processing job: %s (Type: %s)\n", w.workerID, job.ID, job.Type)

	heartbeatCtx, cancelHeartbeat := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		w.heartbeatJobLock(heartbeatCtx, job.ID)
	}()
	processErr := w.executeJob(ctx, job)
	cancelHeartbeat()
	<-heartbeatDone

	if processErr != nil {
		log.Printf("[Worker %s] job %s failed\n", w.workerID, job.ID)
		job.Attempts++
		retryable := true
		retryAfter := time.Duration(0)
		lastError := processErr.Error()
		switch job.Type {
		case jobTypePublishPost, jobTypePublishPublication:
			failure := publisher.ClassifyFailure(processErr)
			retryable = failure.Retryable
			retryAfter = failure.RetryAfter
			lastError = failure.Message
			var directed *publisher.RetryableError
			if errors.As(processErr, &directed) {
				retryable = true
				retryAfter = directed.Failure.RetryAfter
				lastError = directed.Failure.Message
			}
		case analyticsservice.JobTypeSweep,
			analyticsservice.JobTypeAccountSync,
			analyticsservice.JobTypeRenditionSync:
			failure := publisher.ClassifyFailure(processErr)
			retryable = failure.Retryable || failure.Kind == publisher.FailureUnknown
			retryAfter = failure.RetryAfter
			lastError = "Analytics collection failed. OpenPost will retry when the failure is temporary."
			if job.Type == analyticsservice.JobTypeSweep && w.hasPendingAnalyticsSweep(ctx, job.ID) {
				retryable = false
				lastError = "Analytics sweep finished with an error; the next sweep remains queued."
			}
		case communicationsservice.JobTypeSweep,
			communicationsservice.JobTypeEngagementSync,
			communicationsservice.JobTypeMessagesSync:
			failure := publisher.ClassifyFailure(processErr)
			retryable = failure.Retryable || failure.Kind == publisher.FailureUnknown
			retryAfter = failure.RetryAfter
			lastError = "Communications collection failed. OpenPost will retry when the failure is temporary."
			if job.Type == communicationsservice.JobTypeSweep && w.hasPendingCommunicationsSweep(ctx, job.ID) {
				retryable = false
				lastError = "Communications sweep finished with an error; the next sweep remains queued."
			}
		case communicationsservice.JobTypeEngagementAct, communicationsservice.JobTypeMessageSend:
			retryable = false
			lastError = "The provider write failed. OpenPost did not retry because the provider result may be ambiguous."
		}
		if !retryable || job.Attempts >= job.MaxAttempts {
			job.Status = jobStatusFailed
		} else {
			job.Status = jobStatusPending
			jitter := float64((time.Now().UnixNano()%401)-200) / 1000
			backoff := publisher.RetryDelay(job.Attempts, retryAfter, jitter)
			job.RunAt = time.Now().Add(backoff).UTC()
			if job.Type == jobTypePublishPost || job.Type == jobTypePublishPublication {
				if retryErr := w.publisher.UpdateJobRetryAt(ctx, job.Type, job.Payload, job.RunAt); retryErr != nil {
					log.Printf("[Worker %s] failed to align publish retry time for job %s: %v\n", w.workerID, job.ID, retryErr)
				}
			}
		}
		job.LastError = lastError

		if _, dbErr := w.db.NewUpdate().Model((*models.Job)(nil)).
			Set("status = ?", job.Status).
			Set("attempts = ?", job.Attempts).
			Set("last_error = ?", job.LastError).
			Set("run_at = ?", job.RunAt).
			Set("locked_at = NULL").
			Set("locked_by = ''").
			Where("id = ?", job.ID).
			Exec(ctx); dbErr != nil {
			log.Printf("[Worker %s] failed to update job %s status: %v\n", w.workerID, job.ID, dbErr)
		}
		return
	}

	if _, dbErr := w.db.NewUpdate().Model(job).
		Set("status = ?", jobStatusCompleted).
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("id = ?", job.ID).
		Exec(ctx); dbErr != nil {
		log.Printf("[Worker %s] failed to mark job %s as completed: %v\n", w.workerID, job.ID, dbErr)
	}

	log.Printf("[Worker %s] job %s completed successfully\n", w.workerID, job.ID)
}

func (w *BackgroundWorker) hasPendingAnalyticsSweep(ctx context.Context, excludeID string) bool {
	exists, err := w.db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ? AND id != ?", analyticsservice.JobTypeSweep, jobStatusPending, excludeID).
		Exists(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to inspect queued analytics sweep: %v\n", w.workerID, err)
		return false
	}
	return exists
}

func (w *BackgroundWorker) hasPendingCommunicationsSweep(ctx context.Context, excludeID string) bool {
	exists, err := w.db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ? AND id != ?", communicationsservice.JobTypeSweep, jobStatusPending, excludeID).
		Exists(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to inspect queued communications sweep: %v\n", w.workerID, err)
		return false
	}
	return exists
}

func (w *BackgroundWorker) heartbeatJobLock(ctx context.Context, jobID string) {
	ticker := time.NewTicker(processingHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.db.NewUpdate().
				Model((*models.Job)(nil)).
				Set("locked_at = ?", time.Now().UTC()).
				Where("id = ? AND status = ? AND locked_by = ?", jobID, jobStatusProcessing, w.workerID).
				Exec(ctx); err != nil && ctx.Err() == nil {
				log.Printf("[Worker %s] failed to heartbeat job %s: %v\n", w.workerID, jobID, err)
			}
		}
	}
}

func (w *BackgroundWorker) executeJob(ctx context.Context, job *models.Job) error {
	ctx = publisher.WithJobExecution(ctx, job.ID, job.Attempts, job.LockedAt)
	// Job handlers will be injected or called from here based on Type
	switch job.Type {
	case jobTypePublishPost:
		return w.publisher.HandlePublishJob(ctx, job.Payload)
	case jobTypePublishPublication:
		return w.publisher.HandlePublishPublicationJob(ctx, job.Payload)
	case jobTypeRefreshToken:
		return w.handleRefreshTokenJob(ctx, job.Payload)
	case jobTypeMediaCleanup:
		return w.handleMediaCleanup(ctx, job.Payload)
	case jobTypeStorageDelete:
		return w.handleStorageDelete(job.Payload)
	case feedback.JobType:
		if w.feedback == nil {
			return fmt.Errorf("feedback delivery is not configured")
		}
		return w.feedback.HandleDeliveryJob(ctx, job.Payload)
	case analyticsservice.JobTypeSweep, analyticsservice.JobTypeAccountSync, analyticsservice.JobTypeRenditionSync:
		if w.analytics == nil {
			return fmt.Errorf("analytics collection is not configured")
		}
		return w.analytics.HandleJob(ctx, job.Type, job.Payload)
	case billingservice.JobTypeWebhook:
		return w.handleBillingJob(ctx, job)
	case communicationsservice.JobTypeSweep,
		communicationsservice.JobTypeEngagementSync,
		communicationsservice.JobTypeMessagesSync,
		communicationsservice.JobTypeEngagementAct,
		communicationsservice.JobTypeMessageSend:
		if w.communications == nil {
			return fmt.Errorf("communications collection is not configured")
		}
		return w.communications.HandleJob(ctx, job.Type, job.Payload)
	case videoprocessing.JobTypeAnalyze:
		if w.video == nil {
			return fmt.Errorf("video processing is not configured")
		}
		return w.video.HandleJob(ctx, job.Type, job.Payload)
	default:
		return fmt.Errorf("unsupported job type %q", job.Type)
	}
}

func (w *BackgroundWorker) handleBillingJob(ctx context.Context, job *models.Job) error {
	if w.billing == nil {
		return fmt.Errorf("billing reconciliation is not configured")
	}
	return w.billing.HandleJob(ctx, job.Type, job.Payload)
}

func (w *BackgroundWorker) handleStorageDelete(payload string) error {
	if w.storage == nil {
		return fmt.Errorf("storage is not configured")
	}
	var cleanup struct {
		Keys []string `json:"keys"`
	}
	if err := json.Unmarshal([]byte(payload), &cleanup); err != nil {
		return fmt.Errorf("decode storage deletion payload: %w", err)
	}
	if len(cleanup.Keys) == 0 || len(cleanup.Keys) > StorageDeleteMaxKeys {
		return fmt.Errorf("storage deletion payload must contain 1 to 10000 keys")
	}
	for _, key := range cleanup.Keys {
		key = filepath.Clean(key)
		if key == "." || filepath.IsAbs(key) || key == ".." || strings.HasPrefix(key, ".."+string(filepath.Separator)) {
			return fmt.Errorf("storage deletion payload contains an invalid key")
		}
		if err := w.storage.Delete(key); err != nil {
			return fmt.Errorf("delete storage object %q: %w", key, err)
		}
	}
	return nil
}

func (w *BackgroundWorker) handleRefreshTokenJob(ctx context.Context, payload string) error {
	if w.tokens == nil {
		return nil
	}

	accountID, err := tokenmanager.ParseRefreshJobPayload(payload)
	if err != nil {
		return err
	}

	_, err = w.tokens.ForceRefreshAccessToken(ctx, accountID)
	return err
}

func (w *BackgroundWorker) handleMediaCleanup(ctx context.Context, payload string) error {
	var cleanupJob struct {
		WorkspaceID string `json:"workspace_id"`
		Days        int    `json:"days"`
	}
	if err := json.Unmarshal([]byte(payload), &cleanupJob); err != nil {
		return err
	}

	if cleanupJob.Days <= 0 {
		return nil
	}

	cutoff := time.Now().Add(-time.Duration(cleanupJob.Days) * 24 * time.Hour)

	var media []models.MediaAttachment
	err := w.db.NewSelect().Model(&media).
		Where("workspace_id = ?", cleanupJob.WorkspaceID).
		Where("is_favorite = ?", false).
		Where("created_at < ?", cutoff).
		Where("id NOT IN (SELECT media_id FROM post_media)").
		Where("id NOT IN (SELECT media_id FROM publication_segment_media)").
		Where("id NOT IN (SELECT media_id FROM rendition_media)").
		Where("id NOT IN (SELECT media_id FROM rendition_segment_media)").
		Where("id NOT IN (SELECT media_id FROM design_media_references)").
		Where("id NOT IN (SELECT media_id FROM design_template_media_references)").
		Where("id NOT IN (SELECT media_id FROM brand_assets)").
		Where("id NOT IN (SELECT media_id FROM brand_fonts)").
		Where("id NOT IN (SELECT cover_preview_media_id FROM design_documents WHERE cover_preview_media_id IS NOT NULL AND cover_preview_media_id != '')").
		Where("id NOT IN (SELECT preview_media_id FROM design_pages WHERE preview_media_id IS NOT NULL AND preview_media_id != '')").
		Where("id NOT IN (SELECT latest_export_media_id FROM design_pages WHERE latest_export_media_id IS NOT NULL AND latest_export_media_id != '')").
		Scan(ctx)
	if err != nil {
		return err
	}

	variantMediaIDs, err := w.variantMediaIDs(ctx, cleanupJob.WorkspaceID)
	if err != nil {
		return err
	}

	for _, m := range media {
		if _, usedByVariant := variantMediaIDs[m.ID]; usedByVariant {
			continue
		}
		w.deleteUnusedMedia(ctx, m, cleanupJob.WorkspaceID)
	}

	var workspace models.Workspace
	if err := w.db.NewSelect().Model(&workspace).Where("id = ?", cleanupJob.WorkspaceID).Scan(ctx); err == nil && workspace.MediaCleanupDays > 0 {
		_ = w.scheduleMediaCleanup(ctx, cleanupJob.WorkspaceID, workspace.MediaCleanupDays)
	}

	return nil
}

func (w *BackgroundWorker) deleteUnusedMedia(ctx context.Context, media models.MediaAttachment, workspaceID string) {
	if err := w.storage.Delete(filepath.Base(media.FilePath)); err != nil {
		log.Printf("Failed to delete media file %s: %v", media.ID, err)
	}

	var thumbs struct {
		SM string `json:"sm,omitempty"`
		MD string `json:"md,omitempty"`
	}
	if media.ThumbnailsJSON != "" {
		if err := json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbs); err == nil {
			if thumbs.SM != "" {
				if err := w.storage.Delete(thumbs.SM); err != nil {
					log.Printf("Failed to delete thumbnail %s: %v", thumbs.SM, err)
				}
			}
			if thumbs.MD != "" {
				if err := w.storage.Delete(thumbs.MD); err != nil {
					log.Printf("Failed to delete thumbnail %s: %v", thumbs.MD, err)
				}
			}
		}
	}

	if _, err := w.db.NewDelete().Model(&media).Where("id = ?", media.ID).Exec(ctx); err != nil {
		log.Printf("Failed to delete media record %s: %v", media.ID, err)
	}
	log.Printf("Cleaned up media %s for workspace %s", media.ID, workspaceID)
}

func (w *BackgroundWorker) variantMediaIDs(ctx context.Context, workspaceID string) (map[string]struct{}, error) {
	var variantRows []struct {
		MediaIDs string `bun:"media_ids"`
	}
	if err := w.db.NewSelect().
		TableExpr("post_variants AS pv").
		ColumnExpr("pv.media_ids").
		Join("JOIN posts AS p ON p.id = pv.post_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("pv.media_ids != ''").
		Scan(ctx, &variantRows); err != nil {
		return nil, err
	}

	variantMediaIDs := make(map[string]struct{})
	for _, row := range variantRows {
		var ids []string
		if err := json.Unmarshal([]byte(row.MediaIDs), &ids); err != nil {
			log.Printf("Failed to parse variant media IDs during cleanup: %v", err)
			continue
		}
		for _, id := range ids {
			variantMediaIDs[id] = struct{}{}
		}
	}
	return variantMediaIDs, nil
}

func (w *BackgroundWorker) scheduleMediaCleanup(ctx context.Context, workspaceID string, days int) error {
	if days <= 0 {
		return nil
	}

	payload, err := json.Marshal(map[string]interface{}{
		"workspace_id": workspaceID,
		"days":         days,
	})
	if err != nil {
		return err
	}

	job := &models.Job{
		ID:      uuid.New().String(),
		Type:    "media_cleanup",
		Payload: string(payload),
		Status:  jobStatusPending,
		RunAt:   time.Now().Add(24 * time.Hour),
	}

	_, err = w.db.NewInsert().Model(job).Exec(ctx)
	if err != nil {
		log.Printf("Failed to schedule media cleanup for workspace %s: %v", workspaceID, err)
	}
	return err
}

func (w *BackgroundWorker) CancelMediaCleanup(ctx context.Context, workspaceID string) error {
	_, err := w.db.NewDelete().Model(&models.Job{}).
		Where("type = 'media_cleanup' AND payload LIKE ?", "%"+workspaceID+"%").
		Exec(ctx)
	return err
}

func ScheduleMediaCleanup(db *bun.DB, workspaceID string, days int) error {
	if days <= 0 {
		_, err := db.NewDelete().Model(&models.Job{}).
			Where("type = 'media_cleanup' AND payload LIKE ?", "%"+workspaceID+"%").
			Exec(context.Background())
		return err
	}

	payload, err := json.Marshal(map[string]interface{}{
		"workspace_id": workspaceID,
		"days":         days,
	})
	if err != nil {
		return err
	}

	var existing models.Job
	err = db.NewSelect().Model(&existing).
		Where("type = 'media_cleanup' AND payload LIKE ?", "%"+workspaceID+"%").
		Scan(context.Background())
	if err == nil {
		return nil
	}

	job := &models.Job{
		ID:      uuid.New().String(),
		Type:    "media_cleanup",
		Payload: string(payload),
		Status:  jobStatusPending,
		RunAt:   time.Now().Add(24 * time.Hour),
	}

	_, err = db.NewInsert().Model(job).Exec(context.Background())
	if err != nil {
		log.Printf("Failed to schedule media cleanup for workspace %s: %v", workspaceID, err)
	}
	return err
}
