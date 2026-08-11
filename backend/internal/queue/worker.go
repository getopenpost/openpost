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

	databasemigrations "github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	billingservice "github.com/openpost/backend/internal/services/billing"
	communicationsservice "github.com/openpost/backend/internal/services/communications"
	"github.com/openpost/backend/internal/services/feedback"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publisher"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const (
	// StorageDeleteMaxKeys is the largest storage deletion payload the worker accepts.
	StorageDeleteMaxKeys      = 10_000
	jobTypePublishPost        = jobregistry.TypePublishPost
	jobTypePublishPublication = jobregistry.TypePublishPublication
	jobTypeMediaCleanup       = jobregistry.TypeMediaCleanup
	jobTypeStorageDelete      = jobregistry.TypeStorageDelete
	jobTypeRefreshToken       = jobregistry.TypeRefreshToken
	jobStatusPending          = jobregistry.StatusPending
	jobStatusProcessing       = jobregistry.StatusProcessing
	jobStatusFailed           = jobregistry.StatusFailed
	jobStatusCompleted        = jobregistry.StatusCompleted
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
	notifications  *notifications.Service
	reposts        *repostservice.Service
	video          *videoprocessing.Service
	telemetry      telemetry.Recorder
	executors      map[jobregistry.ExecutionKind]jobExecutor
	done           chan struct{}
}

type jobExecutor func(context.Context, *models.Job) error

func (w *BackgroundWorker) SetFeedbackService(service *feedback.Service) {
	w.feedback = service
	w.executors[jobregistry.ExecuteFeedback] = func(ctx context.Context, job *models.Job) error {
		if w.feedback == nil {
			return fmt.Errorf("feedback delivery is not configured")
		}
		return w.feedback.HandleDeliveryJob(ctx, job.Payload)
	}
}

func (w *BackgroundWorker) SetAnalyticsService(service *analyticsservice.Service) {
	w.analytics = service
	w.executors[jobregistry.ExecuteAnalytics] = func(ctx context.Context, job *models.Job) error {
		if w.analytics == nil {
			return fmt.Errorf("analytics collection is not configured")
		}
		return w.analytics.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetBillingService(service *billingservice.Service) {
	w.billing = service
	w.executors[jobregistry.ExecuteBilling] = func(ctx context.Context, job *models.Job) error {
		if w.billing == nil {
			return fmt.Errorf("billing reconciliation is not configured")
		}
		return w.billing.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetCommunicationsService(service *communicationsservice.Service) {
	w.communications = service
	w.executors[jobregistry.ExecuteCommunications] = func(ctx context.Context, job *models.Job) error {
		if w.communications == nil {
			return fmt.Errorf("communications collection is not configured")
		}
		return w.communications.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetNotificationService(service *notifications.Service) {
	w.notifications = service
	w.executors[jobregistry.ExecuteNotification] = func(ctx context.Context, job *models.Job) error {
		if w.notifications == nil {
			return fmt.Errorf("notification delivery is not configured")
		}
		return w.notifications.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetRepostService(service *repostservice.Service) {
	w.reposts = service
	w.executors[jobregistry.ExecuteRepost] = func(ctx context.Context, job *models.Job) error {
		if w.reposts == nil {
			return fmt.Errorf("repost automation is not configured")
		}
		return w.reposts.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetVideoProcessingService(service *videoprocessing.Service) {
	w.video = service
	w.executors[jobregistry.ExecuteVideo] = func(ctx context.Context, job *models.Job) error {
		if w.video == nil {
			return fmt.Errorf("video processing is not configured")
		}
		return w.video.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetTelemetry(recorder telemetry.Recorder) {
	w.telemetry = recorder
}

func NewWorker(db *bun.DB, id string, interval time.Duration, pub *publisher.Service, tokens *tokenmanager.TokenManager, storage mediastore.BlobStorage) *BackgroundWorker {
	w := &BackgroundWorker{
		db:        db,
		workerID:  id,
		interval:  interval,
		publisher: pub,
		tokens:    tokens,
		storage:   storage,
		executors: map[jobregistry.ExecutionKind]jobExecutor{},
		done:      make(chan struct{}),
	}
	w.executors[jobregistry.ExecutePublishPost] = func(ctx context.Context, job *models.Job) error {
		if w.publisher == nil {
			return fmt.Errorf("publishing is not configured")
		}
		return w.publisher.HandlePublishJob(ctx, job.Payload)
	}
	w.executors[jobregistry.ExecutePublishPublication] = func(ctx context.Context, job *models.Job) error {
		if w.publisher == nil {
			return fmt.Errorf("publishing is not configured")
		}
		return w.publisher.HandlePublishPublicationJob(ctx, job.Payload)
	}
	w.executors[jobregistry.ExecuteRefreshToken] = func(ctx context.Context, job *models.Job) error {
		return w.handleRefreshTokenJob(ctx, job.Payload)
	}
	w.executors[jobregistry.ExecuteMediaCleanup] = func(ctx context.Context, job *models.Job) error {
		return w.handleMediaCleanup(ctx, job.Payload)
	}
	w.executors[jobregistry.ExecuteStorageDelete] = func(_ context.Context, job *models.Job) error {
		return w.handleStorageDelete(job.Payload)
	}
	return w
}

func (w *BackgroundWorker) Start(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	log.Printf("Worker %s started polling every %v\n", w.workerID, w.interval)
	w.ensureMediaLifecycleJobs(ctx)
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
	requeuedPublicationJobIDs := w.requeueStaleProcessingJobs(ctx)
	if err := databasemigrations.ReconcileActiveLegacyPublicationJobs(ctx, w.db, requeuedPublicationJobIDs); err != nil {
		log.Printf("[Worker %s] failed to reconcile requeued publication jobs: %v\n", w.workerID, err)
		return
	}
	for {
		if !w.processNextJobIfAvailable(ctx) {
			return
		}
	}
}

func (w *BackgroundWorker) requeueStaleProcessingJobs(ctx context.Context) []string {
	cutoff := time.Now().UTC().Add(-staleProcessingJobAge)
	protected, err := providerwrite.New(w.db).MarkStaleJobAttempts(ctx, cutoff)
	if err != nil {
		log.Printf("[Worker %s] failed to fence stale provider writes: %v\n", w.workerID, err)
		return nil
	}
	if protected > 0 {
		log.Printf("[Worker %s] marked %d stale provider write attempt(s) ambiguous before recovery\n", w.workerID, protected)
	}
	if err := w.failAmbiguousStaleJobs(ctx, cutoff); err != nil {
		log.Printf("[Worker %s] failed to fence ambiguous stale jobs: %v\n", w.workerID, err)
		return nil
	}
	for _, jobType := range jobregistry.TypesByRecovery(jobregistry.RecoverySupersedeSweep) {
		definition, _ := jobregistry.Lookup(jobType)
		result, supersedeErr := w.db.NewUpdate().
			Model((*models.Job)(nil)).
			Set("status = ?", jobStatusCompleted).
			Set("last_error = ?", definition.RecoveryMessage).
			Set("locked_at = NULL").
			Set("locked_by = ''").
			Where("type = ? AND status = ?", jobType, jobStatusProcessing).
			Where("locked_at IS NOT NULL AND locked_at <= ?", cutoff).
			Where("EXISTS (SELECT 1 FROM jobs AS queued_sweep WHERE queued_sweep.type = ? AND queued_sweep.status = ?)", jobType, jobStatusPending).
			Exec(ctx)
		if supersedeErr != nil {
			log.Printf("[Worker %s] failed to supersede stale %s job: %v\n", w.workerID, jobType, supersedeErr)
			return nil
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr == nil && rows > 0 {
			log.Printf("[Worker %s] superseded %d stale %s job(s)\n", w.workerID, rows, jobType)
		}
	}

	var requeuedPublicationJobIDs []string
	if err := w.db.NewSelect().Model((*models.Job)(nil)).
		Column("id").
		Where("type IN (?)", bun.List(jobregistry.TypesByRecovery(jobregistry.RecoveryReconcilePublication))).
		Where("status = ?", jobStatusProcessing).
		Where("locked_at IS NOT NULL").
		Where("locked_at <= ?", cutoff).
		Order("id ASC").
		Scan(ctx, &requeuedPublicationJobIDs); err != nil {
		log.Printf("[Worker %s] failed to identify stale publication jobs: %v\n", w.workerID, err)
		return nil
	}

	result, err := w.db.NewUpdate().
		Model((*models.Job)(nil)).
		Set("status = ?", jobStatusPending).
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("type NOT IN (?)", bun.List(append(
			jobregistry.TypesByRecovery(jobregistry.RecoveryReconcilePublication),
			jobregistry.TypesByRecovery(jobregistry.RecoveryFailAmbiguous)...,
		))).
		Where("status = ?", jobStatusProcessing).
		Where("locked_at IS NOT NULL").
		Where("locked_at <= ?", cutoff).
		Exec(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to requeue stale processing jobs: %v\n", w.workerID, err)
		return nil
	}
	rows, err := result.RowsAffected()
	if err == nil && rows > 0 {
		log.Printf("[Worker %s] requeued %d stale processing job(s)\n", w.workerID, rows)
	}
	return requeuedPublicationJobIDs
}

func (w *BackgroundWorker) failAmbiguousStaleJobs(ctx context.Context, cutoff time.Time) error {
	for _, jobType := range jobregistry.TypesByRecovery(jobregistry.RecoveryFailAmbiguous) {
		definition, _ := jobregistry.Lookup(jobType)
		var jobs []models.Job
		if err := w.db.NewSelect().Model(&jobs).
			Where("type = ? AND status = ? AND locked_at IS NOT NULL AND locked_at <= ?", jobType, jobStatusProcessing, cutoff).
			Scan(ctx); err != nil {
			return err
		}
		for _, job := range jobs {
			if definition.Execution == jobregistry.ExecuteRepost && w.reposts != nil {
				w.reposts.MarkAmbiguousWrite(ctx, job.Payload)
			}
			if _, err := w.db.NewUpdate().Model((*models.Job)(nil)).
				Set("status = ?", jobStatusFailed).
				Set("last_error = ?", definition.RecoveryMessage).
				Set("locked_at = NULL").
				Set("locked_by = ''").
				Where("id = ? AND status = ?", job.ID, jobStatusProcessing).
				Exec(ctx); err != nil {
				return err
			}
		}
	}
	return nil
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
		w.finishFailedJob(ctx, job, processErr)
		return
	}
	if definition, ok := jobregistry.Lookup(job.Type); ok && definition.Recurrence > 0 {
		nextRun := time.Now().UTC().Add(definition.Recurrence)
		if _, dbErr := w.db.NewUpdate().Model((*models.Job)(nil)).
			Set("status = ?", jobStatusPending).
			Set("attempts = 0").
			Set("last_error = ''").
			Set("run_at = ?", nextRun).
			Set("locked_at = NULL").
			Set("locked_by = ''").
			Where("id = ? AND status = ? AND locked_by = ?", job.ID, jobStatusProcessing, w.workerID).
			Exec(ctx); dbErr != nil {
			log.Printf("[Worker %s] failed to reschedule recurring job %s: %v\n", w.workerID, job.ID, dbErr)
		}
		log.Printf("[Worker %s] recurring job %s scheduled for %s\n", w.workerID, job.ID, nextRun.Format(time.RFC3339))
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

func (w *BackgroundWorker) finishFailedJob(ctx context.Context, job *models.Job, processErr error) {
	log.Printf("[Worker %s] job %s failed\n", w.workerID, job.ID)
	job.Attempts++
	failure := w.classifyJobFailure(ctx, job, processErr)
	definition, registered := jobregistry.Lookup(job.Type)
	switch {
	case registered && definition.Recurrence > 0 && failure.retryable && job.Attempts >= job.MaxAttempts:
		job.Status = jobStatusPending
		job.Attempts = 0
		job.RunAt = time.Now().UTC().Add(definition.Recurrence)
	case !failure.retryable || job.Attempts >= job.MaxAttempts:
		job.Status = jobStatusFailed
	default:
		job.Status = jobStatusPending
		jitter := float64((time.Now().UnixNano()%401)-200) / 1000
		backoff := publisher.RetryDelay(job.Attempts, failure.retryAfter, jitter)
		job.RunAt = time.Now().Add(backoff).UTC()
		if registered && definition.Failure == jobregistry.FailurePublish && w.publisher != nil {
			if retryErr := w.publisher.UpdateJobRetryAt(ctx, job.Type, job.Payload, job.RunAt); retryErr != nil {
				log.Printf("[Worker %s] failed to align publish retry time for job %s: %v\n", w.workerID, job.ID, retryErr)
			}
		}
	}
	job.LastError = failure.message

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
		return
	}
	if job.Status == jobStatusFailed && w.telemetry != nil {
		captureErr := w.telemetry.CaptureException(ctx, telemetry.Exception{
			DistinctID:  "job:" + job.ID,
			Title:       "OpenPost " + job.Type + " job failed",
			Description: "A durable background job reached a terminal failure",
			Properties: map[string]any{
				"job_id":         job.ID,
				"job_type":       job.Type,
				"attempts":       job.Attempts,
				"max_attempts":   job.MaxAttempts,
				"error_type":     telemetry.ErrorType(processErr),
				"error_boundary": "background_job",
			},
		})
		if captureErr != nil {
			log.Printf("[Worker %s] failed to enqueue terminal job telemetry: %v\n", w.workerID, captureErr)
		}
	}
}

type classifiedJobFailure struct {
	retryable  bool
	retryAfter time.Duration
	message    string
}

func (w *BackgroundWorker) classifyJobFailure(ctx context.Context, job *models.Job, processErr error) classifiedJobFailure {
	result := classifiedJobFailure{retryable: true, message: processErr.Error()}
	definition, ok := jobregistry.Lookup(job.Type)
	if !ok {
		return result
	}
	switch definition.Failure {
	case jobregistry.FailurePublish:
		failure := publisher.ClassifyFailure(processErr)
		result.retryable = failure.Retryable
		result.retryAfter = failure.RetryAfter
		result.message = failure.Message
		var directed *publisher.RetryableError
		if errors.As(processErr, &directed) {
			result.retryable = true
			result.retryAfter = directed.Failure.RetryAfter
			result.message = directed.Failure.Message
		}
	case jobregistry.FailureProviderRead:
		failure := publisher.ClassifyFailure(processErr)
		result.retryable = failure.Retryable || failure.Kind == publisher.FailureUnknown
		result.retryAfter = failure.RetryAfter
		result.message = definition.FailureMessage
		if definition.Recovery == jobregistry.RecoverySupersedeSweep && w.hasPendingSuccessor(ctx, job.Type, job.ID) {
			result.retryable = false
			result.message = definition.RecoveryMessage
		}
	case jobregistry.FailureProviderWrite:
		result.retryable = false
		result.message = definition.FailureMessage
	case jobregistry.FailureMediaCleanup:
		result.retryable = !jobregistry.IsInvalidPayload(processErr)
	}
	return result
}

func (w *BackgroundWorker) hasPendingSuccessor(ctx context.Context, jobType, excludeID string) bool {
	exists, err := w.db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ? AND id != ?", jobType, jobStatusPending, excludeID).
		Exists(ctx)
	if err != nil {
		log.Printf("[Worker %s] failed to inspect queued %s successor: %v\n", w.workerID, jobType, err)
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
	definition, ok := jobregistry.Lookup(job.Type)
	if !ok {
		return fmt.Errorf("unsupported job type %q", job.Type)
	}
	executor := w.executors[definition.Execution]
	if executor == nil {
		return fmt.Errorf("job type %q has no configured executor", job.Type)
	}
	return executor(ctx, job)
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

	target, err := tokenmanager.ParseRefreshJobPayload(payload)
	if err != nil {
		return err
	}
	if target.GrantID != "" {
		_, err = w.tokens.ForceRefreshGrant(ctx, target.GrantID)
		return err
	}
	_, err = w.tokens.ForceRefreshAccessToken(ctx, target.AccountID)
	return err
}

func (w *BackgroundWorker) handleMediaCleanup(ctx context.Context, payload string) error {
	cleanupJob, err := jobregistry.DecodeMediaCleanupPayload(payload)
	if err != nil {
		return err
	}
	return medialifecycle.NewService(w.db, w.storage).Sweep(ctx, cleanupJob.WorkspaceID, time.Now().UTC())
}

func (w *BackgroundWorker) scheduleMediaCleanup(ctx context.Context, workspaceID string) error {
	_, _, err := jobregistry.EnqueueMediaCleanup(ctx, w.db, workspaceID, time.Time{})
	if err != nil {
		log.Printf("Failed to schedule media cleanup for workspace %s: %v", workspaceID, err)
	}
	return err
}

func (w *BackgroundWorker) ensureMediaLifecycleJobs(ctx context.Context) {
	var workspaceIDs []string
	if err := w.db.NewSelect().Model((*models.Workspace)(nil)).Column("id").Scan(ctx, &workspaceIDs); err != nil {
		log.Printf("Failed to list workspaces for media lifecycle scheduling: %v", err)
		return
	}
	for _, workspaceID := range workspaceIDs {
		if err := w.scheduleMediaCleanup(ctx, workspaceID); err != nil {
			log.Printf("Failed to schedule media lifecycle for workspace %s: %v", workspaceID, err)
		}
	}
}

func ScheduleMediaCleanup(db *bun.DB, workspaceID string) error {
	_, _, err := jobregistry.EnqueueMediaCleanup(context.Background(), db, workspaceID, time.Time{})
	if err != nil {
		log.Printf("Failed to schedule media cleanup for workspace %s: %v", workspaceID, err)
	}
	return err
}
