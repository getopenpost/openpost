package oauthstate

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type synchronizeConsumeSelectsHook struct {
	mu       sync.Mutex
	arrivals int
	release  chan struct{}
}

func (hook *synchronizeConsumeSelectsHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if event.Operation() != "SELECT" || !strings.Contains(event.Query, "auth_challenges") {
		return ctx
	}

	hook.mu.Lock()
	hook.arrivals++
	if hook.arrivals == 2 {
		close(hook.release)
	}
	hook.mu.Unlock()

	select {
	case <-hook.release:
	case <-ctx.Done():
	}
	return ctx
}

func (*synchronizeConsumeSelectsHook) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestConsumeReturnsPayloadToOneConcurrentConsumer(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", "file:"+filepath.Join(t.TempDir(), "oauth-state.db")+"?mode=rwc")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.NewCreateTable().Model((*models.AuthChallenge)(nil)).Exec(ctx); err != nil {
		t.Fatalf("create auth challenges table: %v", err)
	}

	store := NewStore(db)
	state, err := store.Create(ctx, Payload{
		UserID:      "user-1",
		WorkspaceID: "workspace-1",
		Platform:    "threads",
	})
	if err != nil {
		t.Fatalf("create OAuth state: %v", err)
	}

	// Force an implementation that selects before deleting to let both consumers
	// observe the row. An atomic delete-and-return implementation skips this hook.
	db.AddQueryHook(&synchronizeConsumeSelectsHook{release: make(chan struct{})})

	type consumeResult struct {
		payload *Payload
		err     error
	}
	results := make(chan consumeResult, 2)
	start := make(chan struct{})
	consumeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for range 2 {
		go func() {
			<-start
			payload, consumeErr := store.Consume(consumeCtx, state)
			results <- consumeResult{payload: payload, err: consumeErr}
		}()
	}
	close(start)

	var successes, rejected int
	for range 2 {
		result := <-results
		switch {
		case result.err == nil:
			successes++
			if result.payload == nil || result.payload.UserID != "user-1" {
				t.Fatalf("successful consumer received the wrong payload: %#v", result.payload)
			}
		case errors.Is(result.err, ErrInvalidState):
			rejected++
			if result.payload != nil {
				t.Fatalf("rejected consumer received OAuth payload: %#v", result.payload)
			}
		default:
			t.Fatalf("consumer returned unexpected error: %v", result.err)
		}
	}
	if successes != 1 || rejected != 1 {
		t.Fatalf("expected one successful and one rejected consumer, got successes=%d rejected=%d", successes, rejected)
	}
}
