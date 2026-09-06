package database

import (
	"context"
	"database/sql"
	"sync"

	"github.com/uptrace/bun"
)

// poolObserver reports new connection waits and transitions into saturation.
// The PostgreSQL query hook calls it without a separate monitoring goroutine
// or per-query log noise.
type poolObserver struct {
	mu            sync.Mutex
	logf          func(string, ...any)
	lastWaitCount int64
	saturated     bool
}

func newPoolObserver(logf func(string, ...any)) *poolObserver {
	return &poolObserver{logf: logf}
}

type poolObserverHook struct {
	observer *poolObserver
}

func newPoolObserverHook(logf func(string, ...any)) *poolObserverHook {
	return &poolObserverHook{observer: newPoolObserver(logf)}
}

func (h *poolObserverHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	h.observer.Observe(event.DB.Stats())
	return ctx
}

func (h *poolObserverHook) AfterQuery(_ context.Context, event *bun.QueryEvent) {
	h.observer.Observe(event.DB.Stats())
}

func (o *poolObserver) Observe(stats sql.DBStats) {
	if o == nil || o.logf == nil {
		return
	}

	o.mu.Lock()
	waitDelta := stats.WaitCount - o.lastWaitCount
	if waitDelta < 0 {
		waitDelta = stats.WaitCount
	}
	isSaturated := stats.MaxOpenConnections > 0 && stats.InUse >= stats.MaxOpenConnections
	shouldReport := waitDelta > 0 || isSaturated && !o.saturated
	o.lastWaitCount = stats.WaitCount
	o.saturated = isSaturated
	if !shouldReport {
		o.mu.Unlock()
		return
	}
	o.mu.Unlock()

	o.logf(
		"database connection pool pressure: max_open=%d open=%d in_use=%d idle=%d wait_count=%d wait_delta=%d wait_duration=%s",
		stats.MaxOpenConnections,
		stats.OpenConnections,
		stats.InUse,
		stats.Idle,
		stats.WaitCount,
		waitDelta,
		stats.WaitDuration,
	)
}
