package api

import "sync/atomic"

// Readiness tracks whether this process may receive new work. Dependency
// probes are evaluated separately by the readiness endpoint.
type Readiness struct {
	accepting atomic.Bool
}

func NewReadiness() *Readiness {
	readiness := &Readiness{}
	readiness.accepting.Store(true)
	return readiness
}

func (r *Readiness) BeginDrain() {
	if r != nil {
		r.accepting.Store(false)
	}
}

func (r *Readiness) IsReady() bool {
	return r == nil || r.accepting.Load()
}
