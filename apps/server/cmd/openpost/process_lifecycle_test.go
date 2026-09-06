package main

import (
	"context"
	"sync"
	"testing"
	"time"

	apiroutes "github.com/openpost/backend/internal/api"
	"github.com/stretchr/testify/require"
)

type recordingWebProcess struct {
	readiness *apiroutes.Readiness
	mu        sync.Mutex
	draining  bool
	wait      bool
}

func (p *recordingWebProcess) Shutdown(ctx context.Context) error {
	p.mu.Lock()
	p.draining = !p.readiness.IsReady()
	p.mu.Unlock()
	if p.wait {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

type recordingWorkerProcess struct {
	readiness *apiroutes.Readiness
	mu        sync.Mutex
	draining  bool
	quiesced  bool
	wait      bool
}

func (p *recordingWorkerProcess) Quiesce() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.draining = !p.readiness.IsReady()
	p.quiesced = true
}

func (p *recordingWorkerProcess) Wait(ctx context.Context) error {
	if p.wait {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

func TestDrainMarksReadinessFalseBeforeStoppingProcesses(t *testing.T) {
	t.Parallel()

	readiness := apiroutes.NewReadiness()
	web := &recordingWebProcess{readiness: readiness}
	worker := &recordingWorkerProcess{readiness: readiness}

	errors := drainRuntime(t.Context(), readiness, web, worker)

	require.Empty(t, errors)
	require.False(t, readiness.IsReady())
	require.True(t, web.draining)
	require.True(t, worker.draining)
	require.True(t, worker.quiesced)
}

func TestDrainUsesOneBoundedDeadlineForWebAndWorker(t *testing.T) {
	t.Parallel()

	readiness := apiroutes.NewReadiness()
	web := &recordingWebProcess{readiness: readiness, wait: true}
	worker := &recordingWorkerProcess{readiness: readiness, wait: true}
	shutdownCtx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	t.Cleanup(cancel)
	startedAt := time.Now()

	errors := drainRuntime(shutdownCtx, readiness, web, worker)

	require.ErrorIs(t, errors[0], context.DeadlineExceeded)
	require.Less(t, time.Since(startedAt), 500*time.Millisecond)
}
