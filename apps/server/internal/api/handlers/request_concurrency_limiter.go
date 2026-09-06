package handlers

import (
	"strings"
	"sync"
)

type requestConcurrencyLimiter struct {
	mu          sync.Mutex
	global      chan struct{}
	perUser     int
	activeUsers map[string]int
}

func newRequestConcurrencyLimiter(global, perUser int) *requestConcurrencyLimiter {
	return &requestConcurrencyLimiter{
		global:      make(chan struct{}, global),
		perUser:     perUser,
		activeUsers: make(map[string]int),
	}
}

func (l *requestConcurrencyLimiter) acquire(userID string) (func(), bool) {
	if l == nil || strings.TrimSpace(userID) == "" {
		return nil, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.activeUsers[userID] >= l.perUser {
		return nil, false
	}
	select {
	case l.global <- struct{}{}:
		l.activeUsers[userID]++
	default:
		return nil, false
	}
	return func() {
		l.mu.Lock()
		if l.activeUsers[userID] <= 1 {
			delete(l.activeUsers, userID)
		} else {
			l.activeUsers[userID]--
		}
		<-l.global
		l.mu.Unlock()
	}, true
}
