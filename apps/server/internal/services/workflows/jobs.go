package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func enqueueRun(ctx context.Context, db bun.IDB, record runRecord, runAt time.Time) error {
	payload, err := json.Marshal(map[string]string{"run_id": record.ID})
	if err != nil {
		return err
	}
	return enqueue(ctx, db, jobregistry.TypeWorkflowRun, record.WorkspaceID, record.ID+":"+strconv.Itoa(record.Revision), string(payload), runAt)
}
func enqueue(ctx context.Context, db bun.IDB, kind, scope, key, payload string, runAt time.Time) error {
	job, err := jobregistry.NewJob(kind, payload, runAt)
	if err != nil {
		return err
	}
	job.ScopeID = scope
	job.DedupeKey = key
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}
func (s *Service) ScheduleSweep(ctx context.Context, runAt time.Time) error {
	return enqueue(ctx, s.db, jobregistry.TypeWorkflowSweep, "workflows", "sweep", "{}", runAt)
}
func (s *Service) HandleJob(ctx context.Context, kind, payload string) error {
	if kind == jobregistry.TypeWorkflowSweep {
		return s.sweep(ctx)
	}
	decoded, err := decodeJobPayload(payload)
	if err != nil {
		return err
	}
	switch kind {
	case jobregistry.TypeWorkflowPoll:
		if decoded["workflow_id"] == "" {
			return errors.New("workflow job has no workflow ID")
		}
		return s.poll(ctx, decoded["workflow_id"])
	case jobregistry.TypeWorkflowRun:
		if decoded["run_id"] == "" {
			return errors.New("workflow job has no run ID")
		}
		return s.executeRun(ctx, decoded["run_id"])
	default:
		return fmt.Errorf("unsupported workflow job %q", kind)
	}
}
func (s *Service) sweep(ctx context.Context) error {
	now := time.Now().UTC()
	records := []workflowRecord{}
	if err := s.db.NewSelect().Model(&records).Where("enabled = ? AND (last_checked_at IS NULL OR last_checked_at <= ?)", true, now.Add(-SourceInterval)).Order("last_checked_at ASC").Limit(100).Scan(ctx); err != nil {
		return err
	}
	for _, record := range records {
		payload, err := json.Marshal(map[string]string{"workflow_id": record.ID})
		if err != nil {
			return err
		}
		if err := enqueue(ctx, s.db, jobregistry.TypeWorkflowPoll, record.WorkspaceID, record.ID, string(payload), now); err != nil {
			return err
		}
	}
	// Recover a run whose checkpoint committed but whose queue job exhausted
	// infrastructure retries. Native effects retain the same idempotency key.
	runs := []runRecord{}
	if err := s.db.NewSelect().Model(&runs).Where("state IN (?)", bun.List([]string{StateQueued, StateRunning, StateWaiting})).Where("(wake_at IS NULL OR wake_at <= ?) AND (lease_until IS NULL OR lease_until <= ?)", now, now).Order("updated_at ASC").Limit(100).Scan(ctx); err != nil {
		return err
	}
	for _, run := range runs {
		if err := enqueueRun(ctx, s.db, run, now); err != nil {
			return err
		}
	}
	// Approval waits also expire. They have no running worker or recurring job.
	_, err := s.db.NewUpdate().Model((*runRecord)(nil)).Set("state = ?, error = ?, revision = revision + 1, updated_at = ?", StateFailed, "The approval expired after 30 days.", now).Where("state = ? AND created_at < ?", StateApproval, now.Add(-MaxRunAge)).Exec(ctx)
	return err
}
func (s *Service) poll(ctx context.Context, id string) error {
	now := time.Now().UTC()
	leaseUntil := now.Add(time.Minute)
	result, err := s.db.NewUpdate().Model((*workflowRecord)(nil)).Set("poll_lease_until = ?", leaseUntil).Where("id = ? AND enabled = ? AND (poll_lease_until IS NULL OR poll_lease_until <= ?)", id, true, now).Exec(ctx)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return nil
	}
	var record workflowRecord
	if err := s.db.NewSelect().Model(&record).Where("id = ?", id).Scan(ctx); err != nil {
		return err
	}
	var def Definition
	var authority workspaceaccess.StoredAuthority
	if err := json.Unmarshal([]byte(record.PublishedJSON), &def); err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(record.AuthorityJSON), &authority); err != nil {
		return err
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).AuthorizeStored(ctx, authority, workspaceaccess.LevelAdminister)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return s.pollError(ctx, record, leaseUntil, ErrAccess)
	}
	if def.Source.Kind == "manual" {
		return s.pollError(ctx, record, leaseUntil, nil)
	}
	items, nextPage, err := s.readPolledSource(ctx, record, def.Source)

	if err != nil {
		return s.pollError(ctx, record, leaseUntil, err)
	}
	err = s.commitSourcePoll(ctx, record, def, authority, leaseUntil, items, nextPage)
	if errors.Is(err, ErrInvalid) {
		return s.pollError(ctx, record, leaseUntil, err)
	}
	return err
}
func (s *Service) readPolledSource(ctx context.Context, record workflowRecord, source Source) ([]SourceItem, int, error) {
	since := record.CreatedAt
	if record.SourceStartedAt != nil {
		since = *record.SourceStartedAt
	}
	var err error
	var items []SourceItem
	nextPage := record.SourcePage
	switch source.Kind {
	case "publication_created":
		items, err = s.publicationItems(ctx, record.WorkspaceID, since, &record)
	case "rendition_failed":
		items, err = s.failedItems(ctx, record.WorkspaceID, source.AccountIDs, since, &record)
	case "rendition_published":
		items, err = s.publishedItems(ctx, record.WorkspaceID, source.AccountIDs, since, &record)
	case "github_release":
		items, nextPage, err = s.pollGitHub(ctx, record, source, since)
	default:
		items, err = s.readSource(ctx, record.WorkspaceID, source, since)
	}
	return items, nextPage, err
}

func (s *Service) commitSourcePoll(ctx context.Context, record workflowRecord, def Definition, authority workspaceaccess.StoredAuthority, leaseUntil time.Time, items []SourceItem, nextPage int) error {
	now, id := time.Now().UTC(), record.ID
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, record.WorkspaceID); err != nil {
			return err
		}
		current, err := tx.NewUpdate().Model((*workflowRecord)(nil)).Set("source_initialized = ?, source_error = '', last_checked_at = ?, source_page = ?, poll_lease_until = NULL", true, now, nextPage).
			Where("id = ? AND enabled = ? AND published_revision = ? AND poll_lease_until = ?", id, true, record.PublishedRevision, leaseUntil).Exec(ctx)
		if err != nil {
			return err
		}
		if n, _ := current.RowsAffected(); n != 1 {
			return nil
		}
		active, err := tx.NewSelect().Model((*runRecord)(nil)).Where("workspace_id = ? AND state IN (?)", record.WorkspaceID, bun.List([]string{StateQueued, StateRunning, StateWaiting, StateApproval})).Count(ctx)
		if err != nil {
			return err
		}
		// Admit oldest first so a feed's newest-first presentation does not reverse
		// the order in which its posts reach the publication queue.
		for i := len(items) - 1; i >= 0; i-- {
			item := items[i]
			key, err := sourceEventKey(def.Source.Kind, item.ID)
			if err != nil {
				return err
			}
			if active >= maxActiveRuns && record.SourceInitialized {
				// Keep this page available until its unadmitted events have room to run.
				_, err := tx.NewUpdate().Model((*workflowRecord)(nil)).Set("source_page = ?, source_error = ?", record.SourcePage, "workspace has reached 1000 active workflow runs").Where("id = ?", id).Exec(ctx)
				return err
			}
			event := eventRecord{WorkflowID: id, SourceFingerprint: record.SourceFingerprint, EventKey: key, CreatedAt: now}
			inserted, err := tx.NewInsert().Model(&event).On("CONFLICT DO NOTHING").Exec(ctx)
			if err != nil {
				return err
			}
			n, err := inserted.RowsAffected()
			if err != nil {
				return err
			}
			if n == 0 || !record.SourceInitialized {
				continue
			}
			source, err := sourceItemValues(item)
			if err != nil {
				return err
			}
			if _, err := s.createRun(ctx, tx, record, def, authority, ModeLive, source); err != nil {
				return err
			}
			active++
		}
		return nil
	})
}
func (s *Service) pollError(ctx context.Context, record workflowRecord, leaseUntil time.Time, cause error) error {
	message := ""
	if cause != nil {
		message = cause.Error()
	}
	_, err := s.db.NewUpdate().Model((*workflowRecord)(nil)).Set("source_error = ?, last_checked_at = ?, poll_lease_until = NULL", message, time.Now().UTC()).Where("id = ? AND published_revision = ? AND poll_lease_until = ?", record.ID, record.PublishedRevision, leaseUntil).Exec(ctx)
	return err
}

func sourceEventKey(kind, id string) (string, error) {
	if kind == "rendition_published" || kind == "publication_created" || kind == "rendition_failed" {
		return id, nil
	}
	return idempotency.Hash([]string{kind, id})
}

func sourceItemValues(item SourceItem) (map[string]any, error) {
	data, err := json.Marshal(item)
	if err != nil {
		return nil, err
	}
	var source map[string]any
	err = json.Unmarshal(data, &source)
	return source, err
}
