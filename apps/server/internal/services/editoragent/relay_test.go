package editoragent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func relayTestDB(t *testing.T) *bun.DB {
	t.Helper()
	raw, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	raw.SetMaxOpenConns(1)
	db := bun.NewDB(raw, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	for _, statement := range []string{
		"CREATE TABLE users (id TEXT PRIMARY KEY)",
		"CREATE TABLE workspaces (id TEXT PRIMARY KEY)",
		"INSERT INTO users (id) VALUES ('editor'), ('caller')",
		"INSERT INTO workspaces (id) VALUES ('workspace')",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile("../../database/migrations/150_editor_agent_relay.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRelayDeliversOneIdempotentRequestToAuthorizedBrowser(t *testing.T) {
	ctx := context.Background()
	relay := NewRelay(relayTestDB(t))
	session, err := relay.Register(ctx, "workspace", "editor", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	arguments := json.RawMessage(`{"target":"clip-a","frame":12}`)
	request, err := relay.Enqueue(ctx, session, "caller", "stable-key", "video_edit", arguments)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := relay.Enqueue(ctx, session, "caller", "stable-key", "video_edit", json.RawMessage(`{"frame":12,"target":"clip-a"}`))
	if err != nil || retry.ID != request.ID {
		t.Fatalf("retry must reuse receipt: %v, %#v", err, retry)
	}
	if _, err := relay.Enqueue(ctx, session, "caller", "stable-key", "video_edit", json.RawMessage(`{"frame":13}`)); !errors.Is(err, ErrRequestConflict) {
		t.Fatalf("changed retry must conflict, got %v", err)
	}
	if _, err := relay.LeaseNext(ctx, session.ID, "caller", session.Epoch); !errors.Is(err, ErrSessionUnavailable) {
		t.Fatalf("other user must not lease: %v", err)
	}
	if _, err := relay.LeaseNext(ctx, session.ID, "editor", "wrong-epoch"); !errors.Is(err, ErrSessionUnavailable) {
		t.Fatalf("wrong epoch must not lease: %v", err)
	}
	leased, err := relay.LeaseNext(ctx, session.ID, "editor", session.Epoch)
	if err != nil || leased == nil || leased.ID != request.ID {
		t.Fatalf("browser did not receive request: %v, %#v", err, leased)
	}
	if err := relay.Respond(ctx, session.ID, "editor", session.Epoch, request.ID, json.RawMessage(`{"status":"committed"}`), json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	result, err := relay.GetRequest(ctx, request.ID, "workspace", "caller")
	if err != nil || result.Status != "completed" || string(result.Result) != `{"status":"committed"}` {
		t.Fatalf("caller did not receive committed result: %v, %#v", err, result)
	}
	if _, err := relay.GetRequest(ctx, request.ID, "workspace", "editor"); !errors.Is(err, ErrRequestUnavailable) {
		t.Fatalf("other user must not read receipt: %v", err)
	}
}

func TestRelayDisconnectFailsPendingRequests(t *testing.T) {
	ctx := context.Background()
	relay := NewRelay(relayTestDB(t))
	session, err := relay.Register(ctx, "workspace", "editor", "project", "image")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(ctx, session, "caller", "key", "image_edit", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := relay.Close(ctx, session.ID, "editor", session.Epoch); err != nil {
		t.Fatal(err)
	}
	result, err := relay.GetRequest(ctx, request.ID, "workspace", "caller")
	if err != nil || result.Status != "failed" {
		t.Fatalf("pending request must fail on disconnect: %v, %#v", err, result)
	}
	if _, err := relay.LeaseNext(ctx, session.ID, "editor", session.Epoch); !errors.Is(err, ErrSessionUnavailable) {
		t.Fatalf("closed session must not lease: %v", err)
	}
}

func TestRelayExpiresPendingRequestWhenBrowserStopsPolling(t *testing.T) {
	ctx := context.Background()
	relay := NewRelay(relayTestDB(t))
	start := time.Now().UTC()
	relay.now = func() time.Time { return start }
	session, err := relay.Register(ctx, "workspace", "editor", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(ctx, session, "caller", "key", "video_edit", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	relay.now = func() time.Time { return start.Add(sessionLifetime + time.Second) }
	result, err := relay.GetRequest(ctx, request.ID, "workspace", "caller")
	if err != nil || result.Status != "failed" || string(result.Error) != `{"code":"editor_disconnected"}` {
		t.Fatalf("expired browser must fail pending work: %v, %#v", err, result)
	}
}

func TestRelayMarksLeasedDisconnectAsIndeterminate(t *testing.T) {
	ctx := context.Background()
	relay := NewRelay(relayTestDB(t))
	session, err := relay.Register(ctx, "workspace", "editor", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(ctx, session, "caller", "key", "video_edit", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := relay.LeaseNext(ctx, session.ID, "editor", session.Epoch); err != nil {
		t.Fatal(err)
	}
	if err := relay.Close(ctx, session.ID, "editor", session.Epoch); err != nil {
		t.Fatal(err)
	}
	result, err := relay.GetRequest(ctx, request.ID, "workspace", "caller")
	if err != nil || result.Status != "indeterminate" {
		t.Fatalf("leased work must not be reported as unapplied: %v, %#v", err, result)
	}
	if result.Error == nil || !json.Valid(result.Error) {
		t.Fatalf("indeterminate work needs a typed diagnostic: %#v", result)
	}
}

func TestRelayBrowserHeartbeatRenewsActiveRequestLease(t *testing.T) {
	ctx := context.Background()
	relay := NewRelay(relayTestDB(t))
	start := time.Now().UTC()
	relay.now = func() time.Time { return start }
	session, err := relay.Register(ctx, "workspace", "editor", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(ctx, session, "caller", "long-edit", "video_edit", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := relay.LeaseNext(ctx, session.ID, "editor", session.Epoch); err != nil {
		t.Fatal(err)
	}
	relay.now = func() time.Time { return start.Add(leaseLifetime - time.Second) }
	active, err := relay.BrowserRequest(ctx, session.ID, "editor", session.Epoch, request.ID)
	if err != nil || active.Status != "leased" {
		t.Fatalf("heartbeat must see leased request: %v, %#v", err, active)
	}
	relay.now = func() time.Time { return start.Add(leaseLifetime + time.Second) }
	if next, err := relay.LeaseNext(ctx, session.ID, "editor", session.Epoch); err != nil || next != nil {
		t.Fatalf("renewed request must not be leased twice: %v, %#v", err, next)
	}
}
