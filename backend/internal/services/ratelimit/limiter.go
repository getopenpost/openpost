package ratelimit

import (
	"sync"
	"time"
)

type Limiter struct {
	mu          sync.Mutex
	buckets     map[string]*bucket
	lastCleanup time.Time
}

type bucket struct {
	windowStart time.Time
	window      time.Duration
	count       int
	lastSeen    time.Time
}

const (
	cleanupInterval = time.Minute
	cleanupTimeout  = 10 * time.Minute
)

func New() *Limiter {
	return &Limiter{
		buckets:     make(map[string]*bucket),
		lastCleanup: time.Now().UTC(),
	}
}

func (l *Limiter) Allow(key string, limit int, window time.Duration) bool {
	now := time.Now().UTC()
	if key == "" {
		return false
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if now.Sub(l.lastCleanup) >= cleanupInterval {
		l.cleanup(now)
		l.lastCleanup = now
	}

	current, ok := l.buckets[key]
	if !ok || now.Sub(current.windowStart) >= window {
		l.buckets[key] = &bucket{
			windowStart: now,
			window:      window,
			count:       1,
			lastSeen:    now,
		}
		return true
	}

	if current.count >= limit {
		return false
	}

	current.count++
	current.lastSeen = now
	return true
}

func (l *Limiter) cleanup(now time.Time) {
	for key, b := range l.buckets {
		if now.Sub(b.windowStart) >= b.window && now.Sub(b.lastSeen) > cleanupTimeout {
			delete(l.buckets, key)
		}
	}
}
