package queue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publisher"
	"github.com/stretchr/testify/require"
)

type diagnosticsSink struct {
	mu      sync.Mutex
	reports []diagnostics.Report
	server  *httptest.Server
}

func newDiagnosticsSink(t *testing.T) *diagnosticsSink {
	t.Helper()
	sink := &diagnosticsSink{}
	sink.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var report diagnostics.Report
		if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		sink.mu.Lock()
		sink.reports = append(sink.reports, report)
		sink.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(sink.server.Close)
	return sink
}

func (s *diagnosticsSink) reporter(t *testing.T) *diagnostics.Reporter {
	t.Helper()
	reporter := diagnostics.NewReporter(diagnostics.Config{
		Enabled:            true,
		ReceiverURL:        s.server.URL,
		InstallationIDFile: filepath.Join(t.TempDir(), "diagnostics-id"),
		Version:            "test",
		SendsPerHour:       100,
	})
	t.Cleanup(func() { _ = reporter.Close() })
	return reporter
}

func (s *diagnosticsSink) all() []diagnostics.Report {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]diagnostics.Report(nil), s.reports...)
}

func TestWorkerDiagnosticsReportedWhenPersistenceFails(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	job := &models.Job{
		ID: "job-diag-persist", Type: jobregistry.TypePublishPost, Payload: `{}`,
		Status: jobStatusProcessing, RunAt: time.Now().UTC().Add(-time.Minute),
		MaxAttempts: 1, LockedAt: time.Now().UTC(), LockedBy: "worker-diag",
	}
	_, err := db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	sink := newDiagnosticsSink(t)
	reporter := sink.reporter(t)
	worker := NewWorker(db, "worker-diag", time.Second, nil, nil, stubStorage{})
	worker.SetDiagnosticsReporter(reporter)

	// Break persistence: the job row is deleted before finalization, so the
	// terminal-state update affects zero rows and returns early.
	_, err = db.NewDelete().Model((*models.Job)(nil)).Where("id = ?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	worker.finishFailedJob(t.Context(), job, errors.New("nil pointer dereference in publish renderer"))

	reporter.Flush()
	reports := sink.all()
	require.Len(t, reports, 1)
	require.Equal(t, diagnostics.CodePublishFailed, reports[0].ErrorCode)
	require.Equal(t, diagnostics.SurfaceWorker, reports[0].Surface)
	require.Equal(t, jobregistry.TypePublishPost, reports[0].Operation)
	require.NotEmpty(t, reports[0].InstallationID)
	require.NotContains(t, reports[0].Operation, "exploded")
}

func TestWorkerNotificationFailureDoesNotReportPublishingFailure(t *testing.T) {
	db := createTestDB(t)
	sink := newDiagnosticsSink(t)
	reporter := sink.reporter(t)
	worker := NewWorker(db, "worker-diag-notification", time.Second, nil, nil, stubStorage{})
	worker.SetDiagnosticsReporter(reporter)
	worker.reportWorkerDiagnostic(&models.Job{ID: "notification", Type: jobregistry.TypeNotificationEmail}, errors.New("email delivery refused"))
	reporter.Flush()
	reports := sink.all()
	require.Len(t, reports, 1)
	require.Equal(t, diagnostics.CodeWorkerFailed, reports[0].ErrorCode)
	require.Equal(t, jobregistry.TypeNotificationEmail, reports[0].Operation)
}

func TestWorkerDiagnosticsExpectedFailuresUseStructuredCodes(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	sink := newDiagnosticsSink(t)
	reporter := sink.reporter(t)
	worker := NewWorker(db, "worker-diag-expected", time.Second, nil, nil, stubStorage{})
	worker.SetDiagnosticsReporter(reporter)

	rateLimited := &publisher.RetryableError{
		Provider: "mastodon",
		Failure:  publisher.Failure{Kind: publisher.FailureRateLimited, Code: "rate_limited", Retryable: true},
	}
	code, expected := classifyWorkerDiagnostic(rateLimited, jobregistry.TypePublishPost)
	require.Equal(t, diagnostics.CodeProviderRateLimited, code)
	require.True(t, expected)

	worker.reportWorkerDiagnostic(&models.Job{ID: "j1", Type: jobregistry.TypePublishPost}, rateLimited)
	reporter.Flush()
	reports := sink.all()
	require.Len(t, reports, 1)
	require.Equal(t, diagnostics.CodeProviderRateLimited, reports[0].ErrorCode)
	require.Equal(t, "mastodon", reports[0].Provider)
	require.Empty(t, reports[0].Frames, "expected failures aggregate as counts without stacks")
}

func TestWorkerDiagnosticsIgnoresValidationAndCancellation(t *testing.T) {
	t.Parallel()

	for _, err := range []error{
		&publisher.RetryableError{Failure: publisher.Failure{Kind: publisher.FailureValidation}},
		errors.New("validation failed: missing caption"),
		errors.New("account not found (404)"),
		context.Canceled,
	} {
		code, _ := classifyWorkerDiagnostic(err, jobregistry.TypePublishPost)
		require.Empty(t, code, "error %v must not produce a diagnostic report", err)
	}

	db := createTestDB(t)
	sink := newDiagnosticsSink(t)
	reporter := sink.reporter(t)
	worker := NewWorker(db, "worker-diag-ignore", time.Second, nil, nil, stubStorage{})
	worker.SetDiagnosticsReporter(reporter)
	worker.reportWorkerDiagnostic(&models.Job{ID: "j2", Type: jobregistry.TypePublishPost}, context.Canceled)
	reporter.Flush()
	require.Empty(t, sink.all())
}

func TestWorkerPanicGuardReportsOriginalStack(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	job := models.Job{
		ID: "job-panic", Type: jobregistry.TypeRefreshToken, Payload: `{}`,
		Status: jobStatusPending, RunAt: time.Now().UTC().Add(-time.Minute), MaxAttempts: 1,
	}
	_, err := db.NewInsert().Model(&job).Exec(t.Context())
	require.NoError(t, err)

	sink := newDiagnosticsSink(t)
	reporter := sink.reporter(t)
	worker := NewWorker(db, "worker-diag-panic", time.Hour, nil, nil, stubStorage{})
	worker.SetDiagnosticsReporter(reporter)
	worker.executors[jobregistry.ExecuteRefreshToken] = func(context.Context, *models.Job) error {
		panic("simulated executor panic")
	}

	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	var stored models.Job
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", job.ID).Scan(t.Context()))
	require.Equal(t, jobStatusFailed, stored.Status)
	require.Contains(t, stored.LastError, "Token refresh failed")

	reporter.Flush()
	reports := sink.all()
	require.Len(t, reports, 1)
	require.Equal(t, diagnostics.CodeWorkerPanic, reports[0].ErrorCode)
	require.NotEmpty(t, reports[0].Frames, "panics must preserve the original failure location")
	require.NotContains(t, reports[0].Frames[0].Module, "simulated")
}
