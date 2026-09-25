package queue

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	databasemigrations "github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	accountpreflightservice "github.com/openpost/backend/internal/services/accountpreflight"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	billingservice "github.com/openpost/backend/internal/services/billing"
	botingressservice "github.com/openpost/backend/internal/services/botingress"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/externalwebhooks"
	"github.com/openpost/backend/internal/services/feedback"
	growthservice "github.com/openpost/backend/internal/services/growth"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	messagingservice "github.com/openpost/backend/internal/services/messaging"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationownership"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/publisher"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	// StorageDeleteMaxKeys is the largest storage deletion payload the worker accepts.
	StorageDeleteMaxKeys               = jobregistry.StorageDeleteMaxKeys
	jobTypePublishPublication          = jobregistry.TypePublishPublication
	jobTypeMediaCleanup                = jobregistry.TypeMediaCleanup
	jobTypeStorageDelete               = jobregistry.TypeStorageDelete
	jobTypeRefreshToken                = jobregistry.TypeRefreshToken
	jobStatusPending                   = jobregistry.StatusPending
	jobStatusProcessing                = jobregistry.StatusProcessing
	jobStatusFailed                    = jobregistry.StatusFailed
	jobStatusCompleted                 = jobregistry.StatusCompleted
	staleProcessingJobAge              = 15 * time.Minute
	processingHeartbeat                = staleProcessingJobAge / 3
	publicationBuilderUnavailableRetry = time.Minute
	jobFinalizationTimeout             = 3 * time.Second
)

// BackgroundWorker polls the configured database for pending jobs.
type BackgroundWorker struct {
	db                    *bun.DB
	workerID              string
	interval              time.Duration
	publisher             *publisher.Service
	tokens                *tokenmanager.TokenManager
	storage               mediastore.BlobStorage
	feedback              *feedback.Service
	analytics             *analyticsservice.Service
	billing               *billingservice.Service
	botIngress            *botingressservice.Service
	engagement            *engagementservice.Service
	messaging             *messagingservice.Service
	notifications         *notifications.Service
	organizationOwnership *organizationownership.Service
	reposts               *repostservice.Service
	video                 *videoprocessing.Service
	growth                *growthservice.Service
	publicationBuilder    *publicationbuilder.Application
	accountPreflight      *accountpreflightservice.Service
	externalWebhooks      *externalwebhooks.Service
	telemetry             telemetry.Recorder
	diagnostics           *diagnostics.Reporter
	executors             map[jobregistry.ExecutionKind]jobExecutor
	done                  chan struct{}
	quiesce               chan struct{}
	quiesceOnce           sync.Once
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

func (w *BackgroundWorker) SetBotIngressService(service *botingressservice.Service) {
	w.botIngress = service
	w.executors[jobregistry.ExecuteBotIngress] = func(ctx context.Context, job *models.Job) error {
		if w.botIngress == nil {
			return botingressservice.ErrProcessorMissing
		}
		return w.botIngress.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetEngagementService(service *engagementservice.Service) {
	w.engagement = service
	w.executors[jobregistry.ExecuteEngagement] = func(ctx context.Context, job *models.Job) error {
		if w.engagement == nil {
			return fmt.Errorf("engagement collection is not configured")
		}
		return w.engagement.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetMessagingService(service *messagingservice.Service) {
	w.messaging = service
	w.executors[jobregistry.ExecuteMessaging] = func(ctx context.Context, job *models.Job) error {
		if w.messaging == nil {
			return fmt.Errorf("messaging collection is not configured")
		}
		return w.messaging.HandleJob(ctx, job.Type, job.Payload)
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

func (w *BackgroundWorker) SetOrganizationOwnershipService(service *organizationownership.Service) {
	w.organizationOwnership = service
	w.executors[jobregistry.ExecuteOrganizationOwnership] = func(ctx context.Context, job *models.Job) error {
		if w.organizationOwnership == nil {
			return fmt.Errorf("organization ownership is not configured")
		}
		return w.organizationOwnership.HandleJob(ctx, job.Type, job.Payload)
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

func (w *BackgroundWorker) SetGrowthService(service *growthservice.Service) {
	w.growth = service
	w.executors[jobregistry.ExecuteGrowth] = func(ctx context.Context, job *models.Job) error {
		if w.growth == nil {
			return fmt.Errorf("growth is not configured")
		}
		return w.growth.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetPublicationBuilderService(service *publicationbuilder.Application) {
	w.publicationBuilder = service
	w.executors[jobregistry.ExecutePublicationBuild] = func(ctx context.Context, job *models.Job) error {
		if w.publicationBuilder == nil {
			return publicationbuilder.ErrRuntimeUnavailable
		}
		return w.publicationBuilder.HandleJob(ctx, job.Type, job.Payload)
	}
}

func (w *BackgroundWorker) SetTelemetry(recorder telemetry.Recorder) {
	w.telemetry = recorder
}

// SetDiagnosticsReporter attaches the maintainer diagnostics channel. Worker
// failures are reported at the operation boundary independently of whether
// the job's terminal state persisted.
func (w *BackgroundWorker) SetDiagnosticsReporter(reporter *diagnostics.Reporter) {
	w.diagnostics = reporter
}

// workerPanicError carries a recovered worker panic through the normal
// failure path so panicking jobs fail durably instead of crashing the
// worker, and are reported once with their original stack.
type workerPanicError struct {
	recovered any
	frames    []diagnostics.Frame
}

func (e *workerPanicError) Error() string {
	return fmt.Sprintf("worker panic: %v", e.recovered)
}

// executeJobGuarded runs one job, converting panics into durable failures.
// Without this boundary a panicking job would take down the worker before
// any failure — or diagnostic — could be recorded.
func (w *BackgroundWorker) executeJobGuarded(ctx context.Context, job *models.Job) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = &workerPanicError{recovered: recovered, frames: diagnostics.CaptureFrames(2)}
		}
	}()
	return w.executeJob(ctx, job)
}

// reportWorkerDiagnostic reports an unexpected worker failure independently
// of whether the job's final state persisted. Expected conditions (expired
// credentials, rate limits, temporary provider outages) use structured
// codes and aggregate as counts; validation errors, 404s, and intentional
// cancellations are ignored.
func (w *BackgroundWorker) reportWorkerDiagnostic(job *models.Job, processErr error) {
	if w.diagnostics == nil || processErr == nil {
		return
	}
	if errors.Is(processErr, context.Canceled) {
		return
	}
	code, expected := classifyWorkerDiagnostic(processErr, job.Type)
	if code == "" {
		return
	}
	provider := ""
	if directed := (*publisher.RetryableError)(nil); errors.As(processErr, &directed) {
		provider = directed.Provider
	}
	report := diagnostics.Report{
		Surface:      diagnostics.SurfaceWorker,
		Operation:    normalizeWorkerOperation(job.Type),
		ErrorCode:    code,
		Provider:     provider,
		AttemptCount: job.Attempts,
		FirstSeen:    time.Now().UTC(),
		LastSeen:     time.Now().UTC(),
	}
	if panicErr := (*workerPanicError)(nil); errors.As(processErr, &panicErr) {
		report.Frames = panicErr.frames
	} else if !expected {
		report.Frames = diagnostics.CaptureFrames(2)
	}
	w.diagnostics.Report(report)
}

// classifyWorkerDiagnostic maps a job failure to a normalized diagnostics
// code. The second return reports whether the failure is an expected
// condition (counted, not alerted). Empty code means "do not report".
func classifyWorkerDiagnostic(processErr error, jobType string) (string, bool) {
	if panicErr := (*workerPanicError)(nil); errors.As(processErr, &panicErr) {
		return diagnostics.CodeWorkerPanic, false
	}
	if directed := (*publisher.RetryableError)(nil); errors.As(processErr, &directed) {
		if code, expected, handled := diagnosticForFailure(directed.Failure); handled {
			return code, expected
		}
	}
	if code, expected, handled := diagnosticForFailure(publisher.ClassifyFailure(processErr)); handled {
		return code, expected
	}
	lower := strings.ToLower(processErr.Error())
	if strings.Contains(lower, "not found") || strings.Contains(lower, "404") ||
		strings.Contains(lower, "validation") || strings.Contains(lower, "invalid") ||
		strings.Contains(lower, "cancel") {
		return "", false
	}
	return workerCodeForJobType(jobType), false
}

func diagnosticForFailure(failure publisher.Failure) (string, bool, bool) {
	switch failure.Kind {
	case publisher.FailureAuthExpired, publisher.FailureReconnectRequired:
		return diagnostics.CodeProviderAuthExpired, true, true
	case publisher.FailureRateLimited:
		return diagnostics.CodeProviderRateLimited, true, true
	case publisher.FailureNetwork, publisher.FailureProviderServer:
		return diagnostics.CodeProviderOutage, true, true
	case publisher.FailureValidation, publisher.FailurePermission,
		publisher.FailureBillingRequired, publisher.FailureDuplicateContent:
		return "", false, true
	case publisher.FailureProviderProcessing:
		if failure.Retryable {
			return "", false, true
		}
		return diagnostics.CodePublishFailed, false, true
	default:
		return "", false, false
	}
}

// workerCodeForJobType selects the unexpected-failure code by job family.
func workerCodeForJobType(jobType string) string {
	lower := strings.ToLower(jobType)
	switch {
	case strings.Contains(lower, "publish") || strings.Contains(lower, "deliver") ||
		strings.Contains(lower, "webhook") || strings.Contains(lower, "repost") ||
		strings.Contains(lower, "message") || strings.Contains(lower, "notif"):
		return diagnostics.CodePublishFailed
	case strings.Contains(lower, "media") || strings.Contains(lower, "image") ||
		strings.Contains(lower, "video") || strings.Contains(lower, "transcri"):
		return diagnostics.CodeMediaFailed
	case strings.Contains(lower, "export"):
		return diagnostics.CodeExportFailed
	default:
		return diagnostics.CodeWorkerFailed
	}
}

// normalizeWorkerOperation keeps the job type as the operation when it is a
// known identifier, so report aggregation cannot be polluted by payloads.
func normalizeWorkerOperation(jobType string) string {
	jobType = strings.TrimSpace(jobType)
	if jobType == "" {
		return "worker_job"
	}
	if len(jobType) > 160 {
		jobType = jobType[:160]
	}
	return jobType
}

func (w *BackgroundWorker) SetAccountPreflightService(service *accountpreflightservice.Service) {
	w.accountPreflight = service
	w.executors[jobregistry.ExecuteScheduledAccountCheck] = func(ctx context.Context, job *models.Job) error {
		if w.accountPreflight == nil {
			return fmt.Errorf("scheduled account preflight is not configured")
		}
		return w.accountPreflight.HandleJob(ctx, job.Type)
	}
}

func (w *BackgroundWorker) SetExternalWebhookService(service *externalwebhooks.Service) {
	w.externalWebhooks = service
	w.executors[jobregistry.ExecuteExternalWebhook] = func(ctx context.Context, job *models.Job) error {
		if w.externalWebhooks == nil {
			return fmt.Errorf("external webhook delivery is not configured")
		}
		return w.externalWebhooks.HandleJob(ctx, job.Payload)
	}
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
		quiesce:   make(chan struct{}),
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
	w.executors[jobregistry.ExecuteStorageDelete] = func(ctx context.Context, job *models.Job) error {
		return w.handleStorageDelete(ctx, job.Payload)
	}
	return w
}

func (w *BackgroundWorker) Start(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	defer close(w.done)

	log.Printf("Worker %s started polling every %v\n", w.workerID, w.interval)
	if w.isQuiescing() {
		return
	}
	w.ensureMediaLifecycleJobs(ctx)
	w.ensureQueueReminderSweepJob(ctx)
	w.processDueJobs(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Worker %s shutting down\n", w.workerID)
			return
		case <-w.quiesce:
			log.Printf("Worker %s drained\n", w.workerID)
			return
		case <-ticker.C:
			w.processDueJobs(ctx)
		}
	}
}

// Quiesce stops the worker from claiming another job. A job already running is
// allowed to finish so its durable status can be committed safely.
func (w *BackgroundWorker) Quiesce() {
	w.quiesceOnce.Do(func() { close(w.quiesce) })
}

// Wait waits until the worker has drained or the caller's termination budget
// expires.
func (w *BackgroundWorker) Wait(ctx context.Context) error {
	select {
	case <-w.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Stop preserves the old blocking API for callers outside the process runner.
func (w *BackgroundWorker) Stop() {
	w.Quiesce()
	_ = w.Wait(context.Background())
}

func (w *BackgroundWorker) isQuiescing() bool {
	select {
	case <-w.quiesce:
		return true
	default:
		return false
	}
}

func (w *BackgroundWorker) processDueJobs(ctx context.Context) {
	if w.isQuiescing() {
		return
	}
	requeuedPublicationJobIDs := w.requeueStaleProcessingJobs(ctx)
	if err := databasemigrations.ReconcileActiveLegacyPublicationJobs(ctx, w.db, requeuedPublicationJobIDs); err != nil {
		log.Printf("[Worker %s] failed to reconcile requeued publication jobs: %v\n", w.workerID, err)
		return
	}
	for {
		if w.isQuiescing() {
			return
		}
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

	var err error
	if w.db.Dialect().Name() == dialect.PG {
		err = w.db.NewRaw(`
			WITH next_job AS (
				SELECT id
				FROM jobs
				WHERE status = ? AND run_at <= CURRENT_TIMESTAMP
				ORDER BY run_at ASC, id ASC
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			UPDATE jobs
			SET status = ?, locked_at = CURRENT_TIMESTAMP, locked_by = ?
			FROM next_job
			WHERE jobs.id = next_job.id AND jobs.status = ?
			RETURNING jobs.*
		`, jobStatusPending, jobStatusProcessing, w.workerID, jobStatusPending).Scan(ctx, job)
	} else {
		err = w.db.NewRaw(`
		UPDATE jobs
		SET status = ?, locked_at = CURRENT_TIMESTAMP, locked_by = ?
		WHERE status = ? AND id = (
			SELECT id FROM jobs
			WHERE status = ? AND run_at <= CURRENT_TIMESTAMP
			ORDER BY run_at ASC, id ASC
			LIMIT 1
		)
		RETURNING *
		`, jobStatusProcessing, w.workerID, jobStatusPending, jobStatusPending).Scan(ctx, job)
	}

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
	processErr := w.executeJobGuarded(ctx, job)
	cancelHeartbeat()
	<-heartbeatDone
	finalizeCtx, cancelFinalize := workerFinalizationContext(ctx)
	defer cancelFinalize()

	if processErr != nil {
		w.finishFailedJob(finalizeCtx, job, processErr)
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
			Exec(finalizeCtx); dbErr != nil {
			log.Printf("[Worker %s] failed to reschedule recurring job %s: %v\n", w.workerID, job.ID, dbErr)
		}
		log.Printf("[Worker %s] recurring job %s scheduled for %s\n", w.workerID, job.ID, nextRun.Format(time.RFC3339))
		return
	}

	result, dbErr := w.db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobStatusCompleted).
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("id = ? AND status = ? AND locked_by = ?", job.ID, jobStatusProcessing, w.workerID).
		Exec(finalizeCtx)
	if dbErr != nil {
		log.Printf("[Worker %s] failed to mark job %s as completed: %v\n", w.workerID, job.ID, dbErr)
		return
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil {
		log.Printf("[Worker %s] failed to inspect completion of job %s: %v\n", w.workerID, job.ID, rowsErr)
	} else if rows == 1 {
		log.Printf("[Worker %s] job %s completed successfully\n", w.workerID, job.ID)
	}
}

func workerFinalizationContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), jobFinalizationTimeout)
}

//nolint:gocyclo // Durable retry, fencing, and terminal persistence share this transaction-aware path.
func (w *BackgroundWorker) finishFailedJob(ctx context.Context, job *models.Job, processErr error) {
	log.Printf("[Worker %s] job %s failed\n", w.workerID, job.ID)
	// Report unexpected failures at the operation boundary, independently
	// of whether the terminal state below persists. Database failures must
	// not silence their own diagnosis.
	w.reportWorkerDiagnostic(job, processErr)
	failure := w.classifyJobFailure(ctx, job, processErr)
	if !failure.preserveAttempts {
		job.Attempts++
	}
	definition, registered := jobregistry.Lookup(job.Type)
	switch {
	case failure.preserveAttempts:
		job.Status = jobStatusPending
		job.RunAt = time.Now().UTC().Add(failure.retryAfter)
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

	persistFailure := func(db bun.IDB) (int64, error) {
		result, err := db.NewUpdate().Model((*models.Job)(nil)).
			Set("status = ?", job.Status).
			Set("attempts = ?", job.Attempts).
			Set("last_error = ?", job.LastError).
			Set("run_at = ?", job.RunAt).
			Set("locked_at = NULL").
			Set("locked_by = ''").
			Where("id = ? AND status = ? AND locked_by = ?", job.ID, jobStatusProcessing, w.workerID).
			Exec(ctx)
		if err != nil {
			return 0, err
		}
		return result.RowsAffected()
	}

	var rows int64
	var dbErr error
	if job.Status == jobStatusFailed && job.Type == jobregistry.TypePublicationBuild && w.publicationBuilder != nil {
		dbErr = w.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			var err error
			rows, err = persistFailure(tx)
			if err != nil || rows == 0 {
				return err
			}
			return w.publicationBuilder.MarkTerminalJobFailure(txCtx, tx, job.Payload)
		})
	} else {
		rows, dbErr = persistFailure(w.db)
	}
	if dbErr != nil {
		log.Printf("[Worker %s] failed to update job %s status: %v\n", w.workerID, job.ID, dbErr)
		return
	}
	if rows == 0 {
		return
	}
	if job.Status != jobStatusFailed {
		return
	}
	w.recordTerminalFailure(ctx, job, processErr, failure)
}

func (w *BackgroundWorker) recordTerminalFailure(ctx context.Context, job *models.Job, processErr error, failure classifiedJobFailure) {
	log.Printf("[Worker %s] job %s failed: %s\n", w.workerID, job.ID, failure.message)
	if w.telemetry == nil {
		return
	}
	properties := map[string]any{
		"job_id": job.ID, "job_type": job.Type, "attempts": job.Attempts, "max_attempts": job.MaxAttempts,
		"error_type": telemetry.ErrorType(processErr), "error_boundary": "background_job", "retryable": failure.retryable,
	}
	providerFailure := publisher.ClassifyFailure(processErr)
	var directed *publisher.RetryableError
	if errors.As(processErr, &directed) {
		providerFailure = directed.Failure
		properties["platform"] = directed.Provider
		properties["rendition_id"] = directed.RenditionID
	}
	properties["error_kind"] = providerFailure.Kind
	properties["error_code"] = providerFailure.Code
	var coded interface{ FailureCode() string }
	if errors.As(processErr, &coded) {
		properties["error_code"] = coded.FailureCode()
	}
	properties["error_subcode"] = providerFailure.Subcode
	properties["provider_trace_id"] = providerFailure.TraceID
	properties["http_status"] = providerFailure.HTTPStatus
	captureErr := w.telemetry.CaptureException(ctx, telemetry.Exception{
		DistinctID:  "job:" + job.ID,
		WorkspaceID: w.jobErrorWorkspaceID(ctx, job),
		Title:       "OpenPost " + job.Type + " job failed",
		Description: "A durable background job reached a terminal failure",
		Properties:  properties,
	})
	if captureErr != nil {
		log.Printf("[Worker %s] failed to enqueue terminal job telemetry: %v\n", w.workerID, captureErr)
	}
}

// jobErrorWorkspaceID resolves the affected workspace for a terminal job
// failure from trusted database state. Publish jobs carry the publication in
// scope_id (with a payload fallback for old rows); refresh, cleanup, and
// build jobs resolve through their owning records. Unresolvable jobs return
// "" so dashboards report unknown impact instead of inventing it.
// The existing error_kind/error_code properties remain the cause vocabulary;
// no competing taxonomy is introduced here.
func (w *BackgroundWorker) jobErrorWorkspaceID(ctx context.Context, job *models.Job) string {
	switch job.Type {
	case jobTypePublishPublication, jobregistry.TypePublishPost:
		return w.publishJobWorkspaceID(ctx, job)
	case jobTypeRefreshToken:
		return w.refreshJobWorkspaceID(ctx, job.Payload)
	case jobTypeMediaCleanup:
		return mediaCleanupJobWorkspaceID(job.Payload)
	case jobregistry.TypePublicationBuild:
		return w.publicationBuildWorkspaceID(ctx, job)
	default:
		return ""
	}
}

func (w *BackgroundWorker) publishJobWorkspaceID(ctx context.Context, job *models.Job) string {
	publicationID := strings.TrimSpace(job.ScopeID)
	if publicationID == "" {
		var subject struct {
			PublicationID string `json:"publication_id"`
		}
		if err := json.Unmarshal([]byte(job.Payload), &subject); err != nil {
			return ""
		}
		publicationID = strings.TrimSpace(subject.PublicationID)
	}
	if publicationID == "" {
		return ""
	}
	var workspaceID string
	if err := w.db.NewSelect().Model((*models.Publication)(nil)).Column("workspace_id").Where("id = ?", publicationID).Scan(ctx, &workspaceID); err != nil {
		return ""
	}
	return strings.TrimSpace(workspaceID)
}

func (w *BackgroundWorker) refreshJobWorkspaceID(ctx context.Context, payload string) string {
	target, err := tokenmanager.ParseRefreshJobPayload(payload)
	if err != nil {
		return ""
	}
	var workspaceID string
	switch {
	case target.GrantID != "":
		err = w.db.NewSelect().Model((*models.OAuthGrant)(nil)).Column("workspace_id").Where("id = ?", target.GrantID).Scan(ctx, &workspaceID)
	case target.AccountID != "":
		err = w.db.NewSelect().Model((*models.SocialAccount)(nil)).Column("workspace_id").Where("id = ?", target.AccountID).Scan(ctx, &workspaceID)
	default:
		return ""
	}
	if err != nil {
		return ""
	}
	return strings.TrimSpace(workspaceID)
}

func mediaCleanupJobWorkspaceID(payload string) string {
	decoded, err := jobregistry.DecodeMediaCleanupPayload(payload)
	if err != nil {
		return ""
	}
	return decoded.WorkspaceID
}

func (w *BackgroundWorker) publicationBuildWorkspaceID(ctx context.Context, job *models.Job) string {
	buildID := strings.TrimSpace(job.ScopeID)
	if buildID == "" {
		decoded, err := jobregistry.DecodePublicationBuildPayload(job.Payload)
		if err != nil {
			return ""
		}
		buildID = decoded.BuildID
	}
	if buildID == "" {
		return ""
	}
	var workspaceID string
	if err := w.db.NewSelect().Model((*publicationbuilder.BuildRecord)(nil)).Column("workspace_id").Where("id = ?", buildID).Scan(ctx, &workspaceID); err != nil {
		return ""
	}
	return strings.TrimSpace(workspaceID)
}

type classifiedJobFailure struct {
	retryable        bool
	retryAfter       time.Duration
	message          string
	preserveAttempts bool
}

func (w *BackgroundWorker) classifyJobFailure(ctx context.Context, job *models.Job, processErr error) classifiedJobFailure {
	if continuation, ok := classifyJobContinuation(processErr); ok {
		return continuation
	}
	if job.Type == jobregistry.TypePublicationBuild {
		switch {
		case errors.Is(processErr, publicationbuilder.ErrRuntimeUnavailable):
			return classifiedJobFailure{retryable: true, retryAfter: publicationBuilderUnavailableRetry, message: "Publication Builder is temporarily unavailable. OpenPost will retry when it is configured.", preserveAttempts: true}
		case errors.Is(processErr, publicationbuilder.ErrTooManyActiveBuilds):
			return classifiedJobFailure{retryable: true, retryAfter: publicationBuilderUnavailableRetry, message: "Publication Builder is waiting for an active build slot.", preserveAttempts: true}
		case errors.Is(processErr, publicationbuilder.ErrBuildLeaseActive):
			return classifiedJobFailure{retryable: true, retryAfter: publicationBuilderUnavailableRetry, message: "Publication Builder is waiting for the active generation lease.", preserveAttempts: true}
		}
		return classifiedJobFailure{retryable: true, message: "Publication Builder could not complete this build. OpenPost will retry when possible."}
	}
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

func classifyJobContinuation(processErr error) (classifiedJobFailure, bool) {
	if retryAfter, continuation := repostservice.IsExecutionContinuation(processErr); continuation {
		return classifiedJobFailure{
			retryable: true, retryAfter: retryAfter,
			message:          "Repost removal will retry from its persisted stage.",
			preserveAttempts: true,
		}, true
	}
	return classifiedJobFailure{}, false
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

func (w *BackgroundWorker) handleStorageDelete(ctx context.Context, payload string) error {
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
		if err := w.storage.Delete(ctx, key); err != nil {
			return fmt.Errorf("delete storage object %q: %w", key, err)
		}
	}
	return nil
}

func (w *BackgroundWorker) handleRefreshTokenJob(ctx context.Context, payload string) error {
	if w.tokens == nil {
		return fmt.Errorf("token refresh is not configured")
	}

	target, err := tokenmanager.ParseRefreshJobPayload(payload)
	if err != nil {
		return err
	}
	if target.GrantID != "" {
		_, err = w.tokens.ForceRefreshGrant(ctx, target.GrantID)
	} else {
		_, err = w.tokens.ForceRefreshAccessToken(ctx, target.AccountID)
	}
	if tokenmanager.IsObsoleteRefreshTarget(err) {
		return nil
	}
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

func (w *BackgroundWorker) ensureQueueReminderSweepJob(ctx context.Context) {
	if _, _, err := jobregistry.EnqueueQueueReminderSweep(ctx, w.db, time.Time{}); err != nil {
		log.Printf("Failed to schedule queue reminder sweep: %v", err)
	}
}
