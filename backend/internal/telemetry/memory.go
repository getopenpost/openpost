package telemetry

import (
	"context"
	"net/http"
	"sync"
)

// MemoryRecorder is a deterministic test adapter for application telemetry.
type MemoryRecorder struct {
	mu         sync.Mutex
	Events     []Event
	Exceptions []Exception
}

func (r *MemoryRecorder) Enabled() bool { return true }

func (r *MemoryRecorder) PublicConfig() BrowserConfig {
	return BrowserConfig{Enabled: true}
}

func (r *MemoryRecorder) Capture(_ context.Context, event Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Events = append(r.Events, event)
	return nil
}

func (r *MemoryRecorder) CaptureException(_ context.Context, exception Exception) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Exceptions = append(r.Exceptions, exception)
	return nil
}

func (r *MemoryRecorder) WrapHTTP(next http.Handler) http.Handler { return next }
func (r *MemoryRecorder) Close() error                            { return nil }
