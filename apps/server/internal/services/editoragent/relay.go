package editoragent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	sessionLifetime = 45 * time.Second
	requestLifetime = 24 * time.Hour
	leaseLifetime   = 30 * time.Second
	maxResultBytes  = 2 * 1024 * 1024
)

var (
	ErrSessionUnavailable = errors.New("editor session is unavailable")
	ErrRequestConflict    = errors.New("request key already belongs to a different operation")
	ErrRequestUnavailable = errors.New("editor request is unavailable")
	ErrResultTooLarge     = errors.New("editor result exceeds the relay limit")
)

type Session struct {
	bun.BaseModel `bun:"table:editor_agent_sessions"`
	ID            string    `bun:"id,pk" json:"id"`
	WorkspaceID   string    `bun:"workspace_id,notnull" json:"workspace_id"`
	UserID        string    `bun:"user_id,notnull" json:"-"`
	ProjectID     string    `bun:"project_id,notnull" json:"project_id"`
	EditorKind    string    `bun:"editor_kind,notnull" json:"editor_kind"`
	Epoch         string    `bun:"epoch,notnull" json:"-"`
	CreatedAt     time.Time `bun:"created_at,notnull" json:"created_at"`
	LastSeenAt    time.Time `bun:"last_seen_at,notnull" json:"last_seen_at"`
	ExpiresAt     time.Time `bun:"expires_at,notnull" json:"expires_at"`
}

type Request struct {
	bun.BaseModel `bun:"table:editor_agent_requests"`
	ID            string          `bun:"id,pk" json:"id"`
	SessionID     string          `bun:"session_id,notnull" json:"session_id"`
	WorkspaceID   string          `bun:"workspace_id,notnull" json:"workspace_id"`
	CallerUserID  string          `bun:"caller_user_id,notnull" json:"-"`
	RequestKey    string          `bun:"request_key,notnull" json:"request_key"`
	Operation     string          `bun:"operation,notnull" json:"operation"`
	Arguments     json.RawMessage `bun:"arguments_json,notnull" json:"arguments"`
	Status        string          `bun:"status,notnull" json:"status"`
	Result        json.RawMessage `bun:"result_json,notnull" json:"result,omitempty"`
	Error         json.RawMessage `bun:"error_json,notnull" json:"error,omitempty"`
	CreatedAt     time.Time       `bun:"created_at,notnull" json:"created_at"`
	UpdatedAt     time.Time       `bun:"updated_at,notnull" json:"updated_at"`
	ExpiresAt     time.Time       `bun:"expires_at,notnull" json:"expires_at"`
	LeaseUntil    *time.Time      `bun:"lease_until" json:"-"`
}

type Relay struct {
	db  *bun.DB
	now func() time.Time
}

func NewRelay(db *bun.DB) *Relay {
	return &Relay{db: db, now: time.Now}
}

func (r *Relay) Register(ctx context.Context, workspaceID, userID, projectID, kind string) (*Session, error) {
	if r.db == nil || workspaceID == "" || userID == "" || projectID == "" || (kind != "video" && kind != "image") {
		return nil, errors.New("invalid editor session")
	}
	now := r.now().UTC()
	// Expired receipts no longer provide idempotency and can be removed before
	// old sessions. Keep recent receipts even after their browser has closed.
	if _, err := r.db.NewDelete().Model((*Request)(nil)).Where("expires_at <= ?", now).Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := r.db.NewDelete().Model((*Session)(nil)).Where("expires_at <= ? AND created_at <= ?", now, now.Add(-requestLifetime)).Exec(ctx); err != nil {
		return nil, err
	}
	session := &Session{
		ID: uuid.NewString(), WorkspaceID: workspaceID, UserID: userID,
		ProjectID: projectID, EditorKind: kind, Epoch: uuid.NewString(),
		CreatedAt: now, LastSeenAt: now, ExpiresAt: now.Add(sessionLifetime),
	}
	if _, err := r.db.NewInsert().Model(session).Exec(ctx); err != nil {
		return nil, fmt.Errorf("register editor session: %w", err)
	}
	return session, nil
}

func (r *Relay) List(ctx context.Context, workspaceID string) ([]Session, error) {
	var sessions []Session
	err := r.db.NewSelect().Model(&sessions).
		Where("workspace_id = ? AND expires_at > ?", workspaceID, r.now().UTC()).
		Order("last_seen_at DESC").Limit(100).Scan(ctx)
	return sessions, err
}

func (r *Relay) ActiveSession(ctx context.Context, sessionID, workspaceID string) (*Session, error) {
	session := new(Session)
	err := r.db.NewSelect().Model(session).
		Where("id = ? AND workspace_id = ? AND expires_at > ?", sessionID, workspaceID, r.now().UTC()).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSessionUnavailable
		}
		return nil, err
	}
	return session, nil
}

func (r *Relay) Touch(ctx context.Context, sessionID, userID, epoch string) error {
	now := r.now().UTC()
	result, err := r.db.NewUpdate().Model((*Session)(nil)).
		Set("last_seen_at = ?", now).Set("expires_at = ?", now.Add(sessionLifetime)).
		Where("id = ? AND user_id = ? AND epoch = ? AND expires_at > ?", sessionID, userID, epoch, now).Exec(ctx)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return ErrSessionUnavailable
	}
	return nil
}

func (r *Relay) Close(ctx context.Context, sessionID, userID, epoch string) error {
	now := r.now().UTC()
	result, err := r.db.NewUpdate().Model((*Session)(nil)).
		Set("expires_at = ?", now).Where("id = ? AND user_id = ? AND epoch = ?", sessionID, userID, epoch).Exec(ctx)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return ErrSessionUnavailable
	}
	_, err = r.db.NewUpdate().Model((*Request)(nil)).
		Set("status = 'failed'").Set("error_json = ?", `{"code":"editor_disconnected"}`).Set("updated_at = ?", now).
		Where("session_id = ? AND status = 'queued'", sessionID).Exec(ctx)
	if err != nil {
		return err
	}
	_, err = r.db.NewUpdate().Model((*Request)(nil)).
		Set("status = 'indeterminate'").Set("error_json = ?", `{"code":"commit_unknown","message":"The editor disconnected after leasing this request. Inspect the project before retrying with a new key."}`).Set("updated_at = ?", now).
		Where("session_id = ? AND status IN ('leased', 'cancel_requested')", sessionID).Exec(ctx)
	return err
}

func (r *Relay) BrowserRequest(ctx context.Context, sessionID, userID, epoch, requestID string) (*Request, error) {
	if err := r.Touch(ctx, sessionID, userID, epoch); err != nil {
		return nil, err
	}
	now := r.now().UTC()
	if _, err := r.db.NewUpdate().Model((*Request)(nil)).
		Set("lease_until = ?", now.Add(leaseLifetime)).
		Where("id = ? AND session_id = ? AND status = 'leased'", requestID, sessionID).Exec(ctx); err != nil {
		return nil, err
	}
	request := new(Request)
	err := r.db.NewSelect().Model(request).Where("id = ? AND session_id = ?", requestID, sessionID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRequestUnavailable
	}
	return request, err
}

func (r *Relay) Enqueue(ctx context.Context, session *Session, callerID, requestKey, operation string, arguments json.RawMessage) (*Request, error) {
	if session == nil || callerID == "" || requestKey == "" || operation == "" || !json.Valid(arguments) || len(arguments) > 256*1024 {
		return nil, errors.New("invalid editor request")
	}
	var canonical any
	if err := json.Unmarshal(arguments, &canonical); err != nil {
		return nil, errors.New("invalid editor arguments")
	}
	arguments, _ = json.Marshal(canonical)
	var existing Request
	err := r.db.NewSelect().Model(&existing).
		Where("workspace_id = ? AND caller_user_id = ? AND request_key = ?", session.WorkspaceID, callerID, requestKey).Scan(ctx)
	if err == nil {
		if existing.Operation != operation || string(existing.Arguments) != string(arguments) || existing.SessionID != session.ID {
			return nil, ErrRequestConflict
		}
		return &existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	now := r.now().UTC()
	request := &Request{
		ID: uuid.NewString(), SessionID: session.ID, WorkspaceID: session.WorkspaceID,
		CallerUserID: callerID, RequestKey: requestKey, Operation: operation, Arguments: arguments,
		Status: "queued", Result: json.RawMessage(`{}`), Error: json.RawMessage(`{}`),
		CreatedAt: now, UpdatedAt: now, ExpiresAt: now.Add(requestLifetime),
	}
	if _, err := r.db.NewInsert().Model(request).Exec(ctx); err != nil {
		// Return the winner of a concurrent retry when its payload matches.
		var winner Request
		if lookupErr := r.db.NewSelect().Model(&winner).
			Where("workspace_id = ? AND caller_user_id = ? AND request_key = ?", session.WorkspaceID, callerID, requestKey).Scan(ctx); lookupErr == nil {
			if winner.Operation != operation || string(winner.Arguments) != string(arguments) || winner.SessionID != session.ID {
				return nil, ErrRequestConflict
			}
			return &winner, nil
		}
		return nil, fmt.Errorf("enqueue editor request: %w", err)
	}
	return request, nil
}

func (r *Relay) LeaseNext(ctx context.Context, sessionID, userID, epoch string) (*Request, error) {
	if err := r.Touch(ctx, sessionID, userID, epoch); err != nil {
		return nil, err
	}
	now := r.now().UTC()
	for range 4 {
		request := new(Request)
		err := r.db.NewSelect().Model(request).
			Where("session_id = ? AND expires_at > ? AND (status = 'queued' OR (status = 'leased' AND lease_until < ?))", sessionID, now, now).
			Order("created_at ASC").Limit(1).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, nil
			}
			return nil, err
		}
		result, err := r.db.NewUpdate().Model((*Request)(nil)).
			Set("status = 'leased'").Set("lease_until = ?", now.Add(leaseLifetime)).Set("updated_at = ?", now).
			Where("id = ? AND (status = 'queued' OR (status = 'leased' AND lease_until < ?))", request.ID, now).Exec(ctx)
		if err != nil {
			return nil, err
		}
		if count, _ := result.RowsAffected(); count == 1 {
			request.Status = "leased"
			return request, nil
		}
	}
	return nil, nil
}

func (r *Relay) Respond(ctx context.Context, sessionID, userID, epoch, requestID string, result, failure json.RawMessage) error {
	if len(result)+len(failure) > maxResultBytes || !json.Valid(result) || !json.Valid(failure) {
		return ErrResultTooLarge
	}
	if err := r.Touch(ctx, sessionID, userID, epoch); err != nil {
		return err
	}
	status := "completed"
	if string(failure) != "{}" {
		status = "failed"
	}
	update, err := r.db.NewUpdate().Model((*Request)(nil)).
		Set("status = ?", status).Set("result_json = ?", string(result)).Set("error_json = ?", string(failure)).
		Set("updated_at = ?", r.now().UTC()).Set("lease_until = NULL").
		Where("id = ? AND session_id = ? AND status IN ('leased', 'cancel_requested')", requestID, sessionID).Exec(ctx)
	if err != nil {
		return err
	}
	if count, _ := update.RowsAffected(); count != 1 {
		return ErrRequestUnavailable
	}
	return nil
}

func (r *Relay) GetRequest(ctx context.Context, requestID, workspaceID, callerID string) (*Request, error) {
	request := new(Request)
	now := r.now().UTC()
	err := r.db.NewSelect().Model(request).
		Where("id = ? AND workspace_id = ? AND caller_user_id = ? AND expires_at > ?", requestID, workspaceID, callerID, now).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrRequestUnavailable
		}
		return nil, err
	}
	if request.Status == "queued" || request.Status == "leased" || request.Status == "cancel_requested" {
		session := new(Session)
		if err := r.db.NewSelect().Model(session).Where("id = ?", request.SessionID).Scan(ctx); err != nil {
			return nil, err
		}
		if !session.ExpiresAt.After(now) {
			status := "failed"
			errorJSON := `{"code":"editor_disconnected"}`
			if request.Status != "queued" {
				status = "indeterminate"
				errorJSON = `{"code":"commit_unknown","message":"The editor stopped polling after leasing this request. Inspect the project before retrying with a new key."}`
			}
			_, err := r.db.NewUpdate().Model((*Request)(nil)).
				Set("status = ?", status).Set("error_json = ?", errorJSON).Set("updated_at = ?", now).
				Where("id = ? AND status IN ('queued', 'leased', 'cancel_requested')", request.ID).Exec(ctx)
			if err != nil {
				return nil, err
			}
			return r.GetRequest(ctx, requestID, workspaceID, callerID)
		}
	}
	return request, nil
}

func (r *Relay) Cancel(ctx context.Context, requestID, workspaceID, callerID string) (*Request, error) {
	request, err := r.GetRequest(ctx, requestID, workspaceID, callerID)
	if err != nil {
		return nil, err
	}
	status := request.Status
	switch status {
	case "queued":
		status = "cancelled"
	case "leased":
		status = "cancel_requested"
	default:
		return request, nil
	}
	_, err = r.db.NewUpdate().Model((*Request)(nil)).Set("status = ?", status).
		Set("updated_at = ?", r.now().UTC()).Where("id = ? AND status = ?", requestID, request.Status).Exec(ctx)
	if err != nil {
		return nil, err
	}
	return r.GetRequest(ctx, requestID, workspaceID, callerID)
}

func (r *Relay) Wait(ctx context.Context, requestID, workspaceID, callerID string, timeout time.Duration) (*Request, error) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		request, err := r.GetRequest(ctx, requestID, workspaceID, callerID)
		if err != nil || request.Status == "completed" || request.Status == "failed" || request.Status == "cancelled" || request.Status == "indeterminate" {
			return request, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline.C:
			return request, nil
		case <-ticker.C:
		}
	}
}
