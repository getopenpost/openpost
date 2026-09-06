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
	Aliases    []IdentityAlias
}

type IdentityAlias struct {
	DistinctID string
	Alias      string
}

func (r *MemoryRecorder) Enabled() bool { return true }

func (r *MemoryRecorder) PublicConfig() BrowserConfig {
	return BrowserConfig{Enabled: true}
}

func (r *MemoryRecorder) Capture(_ context.Context, event Event) error {
	if err := ValidateEvent(event); err != nil {
		return err
	}
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

func (r *MemoryRecorder) Alias(_ context.Context, distinctID, alias string) error {
	if err := validateAlias(distinctID, alias); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Aliases = append(r.Aliases, IdentityAlias{DistinctID: distinctID, Alias: alias})
	return nil
}

func (r *MemoryRecorder) WrapHTTP(next http.Handler) http.Handler { return next }
func (r *MemoryRecorder) Close() error                            { return nil }
