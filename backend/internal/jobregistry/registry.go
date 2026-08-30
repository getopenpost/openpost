// Package jobregistry owns durable job identities and scheduling policy that
// must be shared by enqueue callers, migrations, and the queue worker.
package jobregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

const (
	StatusPending        = "pending"
	StatusProcessing     = "processing"
	StatusCompleted      = "completed"
	StatusFailed         = "failed"
	StorageDeleteMaxKeys = 10_000

	mediaCleanupDedupeKey = "daily"
)

// Identity is the exact database key used to deduplicate active jobs.
type Identity struct {
	ScopeID   string
	DedupeKey string
}

// MediaCleanupPayload identifies the workspace lifecycle sweep. Historical
// payloads may also contain a days field; JSON decoding deliberately ignores it
// because retention policy belongs to medialifecycle and is not configurable.
type MediaCleanupPayload struct {
	WorkspaceID string `json:"workspace_id"`
}

type PublicationBuildPayload struct {
	BuildID string `json:"build_id"`
}

type InvalidPayloadError struct {
	err error
}

func (err *InvalidPayloadError) Error() string { return err.err.Error() }
func (err *InvalidPayloadError) Unwrap() error { return err.err }

func IsInvalidPayload(err error) bool {
	var invalid *InvalidPayloadError
	return errors.As(err, &invalid)
}

func Lookup(jobType string) (Definition, bool) {
	definition, ok := definitions[jobType]
	return definition, ok
}

// NewJob creates a pending Job from the registered defaults. Callers may add
// a scope or dedupe identity before insertion, but cannot choose retry policy
// independently from the Job kind.
func NewJob(jobType, payload string, runAt time.Time) (*models.Job, error) {
	definition, ok := Lookup(jobType)
	if !ok {
		return nil, fmt.Errorf("job type %q is not registered", jobType)
	}
	if runAt.IsZero() {
		runAt = time.Now().UTC()
	}
	return &models.Job{
		ID:          uuid.NewString(),
		Type:        definition.Type,
		Payload:     payload,
		Status:      StatusPending,
		RunAt:       runAt.UTC(),
		MaxAttempts: definition.DefaultMaxAttempts,
	}, nil
}

// EnqueueStorageDeletes records object cleanup in the caller's transaction so
// database ownership cannot disappear before the worker has the object keys.
func EnqueueStorageDeletes(ctx context.Context, db bun.IDB, objectKeys []string) ([]string, error) {
	jobIDs := make([]string, 0, (len(objectKeys)+StorageDeleteMaxKeys-1)/StorageDeleteMaxKeys)
	for start := 0; start < len(objectKeys); start += StorageDeleteMaxKeys {
		end := min(start+StorageDeleteMaxKeys, len(objectKeys))
		payload, err := json.Marshal(struct {
			Keys []string `json:"keys"`
		}{Keys: objectKeys[start:end]})
		if err != nil {
			return nil, fmt.Errorf("encode storage deletion payload: %w", err)
		}
		job, err := NewJob(TypeStorageDelete, string(payload), time.Now().UTC())
		if err != nil {
			return nil, err
		}
		if _, err := db.NewInsert().Model(job).Exec(ctx); err != nil {
			return nil, fmt.Errorf("enqueue storage deletion: %w", err)
		}
		jobIDs = append(jobIDs, job.ID)
	}
	return jobIDs, nil
}

// IdentityForPayload decodes the registered payload instead of inspecting its
// serialized bytes. It is used by forward migrations as well as enqueue code.
func IdentityForPayload(jobType, payload string) (Identity, error) {
	definition, ok := Lookup(jobType)
	if !ok || definition.identity == nil {
		return Identity{}, fmt.Errorf("job type %q has no registered identity", jobType)
	}
	return definition.identity(payload)
}

func DecodeMediaCleanupPayload(payload string) (MediaCleanupPayload, error) {
	var decoded MediaCleanupPayload
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		return MediaCleanupPayload{}, &InvalidPayloadError{err: fmt.Errorf("decode media cleanup payload: %w", err)}
	}
	decoded.WorkspaceID = strings.TrimSpace(decoded.WorkspaceID)
	if decoded.WorkspaceID == "" {
		return MediaCleanupPayload{}, &InvalidPayloadError{err: errors.New("workspace_id is required for media cleanup")}
	}
	return decoded, nil
}

func mediaCleanupIdentity(payload string) (Identity, error) {
	decoded, err := DecodeMediaCleanupPayload(payload)
	if err != nil {
		return Identity{}, err
	}
	return MediaCleanupIdentity(decoded.WorkspaceID)
}

func DecodePublicationBuildPayload(payload string) (PublicationBuildPayload, error) {
	var decoded PublicationBuildPayload
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		return PublicationBuildPayload{}, &InvalidPayloadError{err: fmt.Errorf("decode publication build payload: %w", err)}
	}
	decoded.BuildID = strings.TrimSpace(decoded.BuildID)
	if decoded.BuildID == "" {
		return PublicationBuildPayload{}, &InvalidPayloadError{err: errors.New("build_id is required for publication build")}
	}
	return decoded, nil
}

func publicationBuildIdentity(payload string) (Identity, error) {
	decoded, err := DecodePublicationBuildPayload(payload)
	if err != nil {
		return Identity{}, err
	}
	return PublicationBuildIdentity(decoded.BuildID)
}

func PublicationBuildIdentity(buildID string) (Identity, error) {
	buildID = strings.TrimSpace(buildID)
	if buildID == "" {
		return Identity{}, errors.New("build_id is required for publication build")
	}
	return Identity{ScopeID: buildID, DedupeKey: "generate"}, nil
}

func MediaCleanupIdentity(workspaceID string) (Identity, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return Identity{}, errors.New("workspace_id is required for media cleanup")
	}
	return Identity{ScopeID: workspaceID, DedupeKey: mediaCleanupDedupeKey}, nil
}

// EnqueueMediaCleanup atomically creates one active recurring chain for a
// workspace. Completed and failed history never suppresses a new chain.
func EnqueueMediaCleanup(ctx context.Context, db bun.IDB, workspaceID string, runAt time.Time) (string, bool, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", false, errors.New("workspace_id is required for media cleanup")
	}
	if runAt.IsZero() {
		runAt = time.Now().UTC().Add(definitions[TypeMediaCleanup].Recurrence)
	}
	payload, err := json.Marshal(MediaCleanupPayload{WorkspaceID: workspaceID})
	if err != nil {
		return "", false, fmt.Errorf("encode media cleanup payload: %w", err)
	}
	identity, err := MediaCleanupIdentity(workspaceID)
	if err != nil {
		return "", false, err
	}
	job, err := NewJob(TypeMediaCleanup, string(payload), runAt)
	if err != nil {
		return "", false, err
	}
	job.ScopeID = identity.ScopeID
	job.DedupeKey = identity.DedupeKey
	for attempt := 0; ; attempt++ {
		var id string
		var created bool
		err := organizationguard.WithWorkspace(ctx, db, workspaceID, func(txCtx context.Context, fenced bun.IDB) error {
			var enqueueErr error
			id, created, enqueueErr = enqueueMediaCleanupOnce(txCtx, fenced, job)
			return enqueueErr
		})
		if err == nil {
			return id, created, nil
		}
		if attempt >= 49 || !isTransientSQLiteContention(err) {
			return "", false, err
		}
		timer := time.NewTimer(2 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", false, ctx.Err()
		case <-timer.C:
		}
	}
}

func enqueueMediaCleanupOnce(ctx context.Context, db bun.IDB, job *models.Job) (string, bool, error) {
	result, err := db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return "", false, fmt.Errorf("enqueue media cleanup: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", false, fmt.Errorf("inspect media cleanup enqueue: %w", err)
	}
	if rows == 1 {
		return job.ID, true, nil
	}

	var existing models.Job
	if err := db.NewSelect().Model(&existing).
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", job.Type, job.ScopeID, job.DedupeKey).
		Where("status IN (?, ?)", StatusPending, StatusProcessing).
		Limit(1).
		Scan(ctx); err != nil {
		return "", false, fmt.Errorf("load active media cleanup after enqueue conflict: %w", err)
	}
	return existing.ID, false, nil
}

func isTransientSQLiteContention(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") || strings.Contains(message, "database table is locked")
}

// EnsureActiveDedupeIndex installs the cross-database uniqueness contract.
// The forward migration backfills exact identities before calling this helper.
func EnsureActiveDedupeIndex(ctx context.Context, db bun.IDB) error {
	_, err := db.NewCreateIndex().
		Index("jobs_active_dedupe_unique_idx").
		Table("jobs").
		Column("type", "scope_id", "dedupe_key").
		Unique().
		Where("status IN ('pending', 'processing') AND scope_id <> '' AND dedupe_key <> ''").
		IfNotExists().
		Exec(ctx)
	return err
}
