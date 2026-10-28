package workflows

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/telemetry"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/netguard"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type Service struct {
	aiEnabled      bool
	aiMonthlyCalls int64
	telemetry      telemetry.Recorder
	decider        ai.Decider
	decisionModel  string
	generator      ai.Generator
	model          string
	db             *bun.DB
	actions        Actions
	encryptor      *servicecrypto.TokenEncryptor
	client         *http.Client
	notifications  *notifications.Service
}

func NewService(db *bun.DB, actions Actions, encryptor *servicecrypto.TokenEncryptor) *Service {
	return &Service{aiEnabled: true, aiMonthlyCalls: 1000, db: db, actions: actions, encryptor: encryptor, client: netguard.NewHTTPClient(25*time.Second, sourceURLPolicy)}
}

func (s *Service) SetTelemetry(recorder telemetry.Recorder) { s.telemetry = recorder }

// SetNotificationService enables approval notifications. A workflow service
// without one still runs; it simply stays silent at the approval transitions.
func (s *Service) SetNotificationService(service *notifications.Service) {
	s.notifications = service
}

func (s *Service) authorize(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string, level workspaceaccess.Level) (workspaceaccess.StoredAuthority, error) {
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return workspaceaccess.StoredAuthority{}, err
	}
	if !decision.Allowed {
		return workspaceaccess.StoredAuthority{}, ErrAccess
	}
	return workspaceaccess.StoredAuthority{UserID: actor.UserID, WorkspaceID: workspaceID, OrganizationID: decision.OrganizationID, IdentityProviderID: decision.ProviderID, AssuredAt: time.Now().UTC()}, nil
}

func (s *Service) List(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string) ([]Workflow, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	records := []workflowRecord{}
	if err := s.db.NewSelect().Model(&records).Where("workspace_id = ?", workspaceID).Order("updated_at DESC").Limit(100).Scan(ctx); err != nil {
		return nil, err
	}
	result := make([]Workflow, 0, len(records))
	for _, record := range records {
		item, err := decodeWorkflow(record)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) Get(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string) (Workflow, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return Workflow{}, err
	}
	record, err := s.loadWorkflow(ctx, workspaceID, id)
	if err != nil {
		return Workflow{}, err
	}
	return decodeWorkflow(record)
}

func (s *Service) Save(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, input SaveRequest) (Workflow, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelEdit); err != nil {
		return Workflow{}, err
	}
	name, err := validateSaveRequest(input)
	if err != nil {
		return Workflow{}, err
	}
	encoded, err := json.Marshal(input.Definition)
	if err != nil {
		return Workflow{}, err
	}
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		if err := validateConnection(ctx, tx, workspaceID, input.Definition.Source.ConnectionID); err != nil {
			return err
		}
		if err := validateStepConnections(ctx, tx, workspaceID, input.Definition.Steps); err != nil {
			return err
		}
		now := time.Now().UTC()
		if id == "" {
			count, err := tx.NewSelect().Model((*workflowRecord)(nil)).Where("workspace_id = ?", workspaceID).Count(ctx)
			if err != nil {
				return err
			}
			if count >= maxWorkflows {
				return invalid("this workspace has reached its 100 workflow limit")
			}
			id = uuid.NewString()
			record := workflowRecord{ID: id, WorkspaceID: workspaceID, Name: name, Description: input.Description, Revision: 1, DraftJSON: string(encoded), PublishedJSON: "{}", AuthorityJSON: "{}", CreatedAt: now, UpdatedAt: now}
			_, err = tx.NewInsert().Model(&record).Exec(ctx)
			return err
		}
		result, err := tx.NewUpdate().Model((*workflowRecord)(nil)).Set("name = ?, description = ?, draft_json = ?, revision = revision + 1, updated_at = ?", name, input.Description, string(encoded), now).Where("id = ? AND workspace_id = ? AND revision = ?", id, workspaceID, input.ExpectedRevision).Exec(ctx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrConflict
		}
		return nil
	})
	if err != nil {
		return Workflow{}, err
	}
	return s.Get(ctx, actor, workspaceID, id)
}

func validateSaveRequest(input SaveRequest) (string, error) {
	if err := Validate(input.Definition, false); err != nil {
		return "", err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 100 || len(input.Description) > 500 {
		return "", invalid("enter a name of 100 characters or fewer")
	}
	return name, nil
}

func (s *Service) Publish(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, expected int) (Workflow, error) {
	authority, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister)
	if err != nil {
		return Workflow{}, err
	}
	record, err := s.loadWorkflow(ctx, workspaceID, id)
	if err != nil {
		return Workflow{}, err
	}
	if record.Revision != expected {
		return Workflow{}, ErrConflict
	}
	item, err := decodeWorkflow(record)
	if err != nil {
		return Workflow{}, err
	}
	if err := Validate(item.Definition, true); err != nil {
		return Workflow{}, err
	}
	if err := s.activateWorkflow(ctx, record, item.Definition, authority); err != nil {
		return Workflow{}, err
	}
	return s.Get(ctx, actor, workspaceID, id)
}

func (s *Service) activateWorkflow(ctx context.Context, record workflowRecord, definition Definition, authority workspaceaccess.StoredAuthority) error {
	workspaceID, id, expected := record.WorkspaceID, record.ID, record.Revision
	if err := s.validateCommentAutomation(ctx, authority, definition); err != nil {
		return err
	}
	if _, err := s.connectionToken(ctx, workspaceID, definition.Source.ConnectionID); err != nil {
		return err
	}
	fingerprint, err := idempotency.Hash(definition.Source)
	if err != nil {
		return err
	}
	authorityJSON, err := json.Marshal(authority)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	initialized := workflowSourceInitialized(record, definition, fingerprint)
	var baseline []SourceItem
	if !initialized {
		baseline, err = s.readSource(ctx, workspaceID, definition.Source, now)
		if err != nil {
			return invalid(err.Error())
		}
	}
	err = s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		if err := validateConnection(ctx, tx, workspaceID, definition.Source.ConnectionID); err != nil {
			return err
		}
		update := tx.NewUpdate().Model((*workflowRecord)(nil)).
			Set("published_json = draft_json, published_revision = revision + 1, revision = revision + 1, enabled = ?", true).
			Set("authority_json = ?, source_fingerprint = ?, source_initialized = ?, source_error = '', updated_at = ?", string(authorityJSON), fingerprint, true, now).
			Where("id = ? AND workspace_id = ? AND revision = ?", id, workspaceID, expected)
		if !initialized {
			update = update.Set("source_started_at = ?, source_page = 1, last_checked_at = NULL", now)
		}
		result, err := update.Exec(ctx)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return ErrConflict
		}
		return recordSourceBaseline(ctx, tx, id, fingerprint, definition.Source.Kind, baseline, now)
	})
	if err != nil {
		return err
	}

	return s.ScheduleSweep(ctx, now)
}

func (s *Service) Pause(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, expected int) (Workflow, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return Workflow{}, err
	}
	result, err := s.db.NewUpdate().Model((*workflowRecord)(nil)).Set("enabled = ?, revision = revision + 1, updated_at = ?", false, time.Now().UTC()).Where("id = ? AND workspace_id = ? AND revision = ?", id, workspaceID, expected).Exec(ctx)
	if err != nil {
		return Workflow{}, err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return Workflow{}, ErrConflict
	}
	return s.Get(ctx, actor, workspaceID, id)
}

func (s *Service) Delete(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string) error {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return err
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		var record workflowRecord
		err := tx.NewSelect().Model(&record).Where("id = ? AND workspace_id = ?", id, workspaceID).Scan(ctx)
		if err != nil {
			return err
		}
		if record.Enabled {
			return ErrState
		}
		active, err := tx.NewSelect().Model((*runRecord)(nil)).Where("workflow_id = ? AND state IN (?)", id, bun.List([]string{StateQueued, StateRunning, StateWaiting, StateApproval})).Exists(ctx)
		if err != nil {
			return err
		}
		if active {
			return ErrState
		}
		_, err = tx.NewDelete().Model((*workflowRecord)(nil)).Where("id = ? AND workspace_id = ? AND enabled = ?", id, workspaceID, false).Exec(ctx)
		return err
	})
}

func (s *Service) loadWorkflow(ctx context.Context, workspaceID, id string) (workflowRecord, error) {
	var record workflowRecord
	err := s.db.NewSelect().Model(&record).Where("id = ? AND workspace_id = ?", id, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return record, ErrNotFound
	}
	return record, err
}
func decodeWorkflow(record workflowRecord) (Workflow, error) {
	item := Workflow{ID: record.ID, WorkspaceID: record.WorkspaceID, Name: record.Name, Description: record.Description, Revision: record.Revision, PublishedRevision: record.PublishedRevision, Enabled: record.Enabled, SourceError: record.SourceError, LastCheckedAt: record.LastCheckedAt, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt}
	if err := json.Unmarshal([]byte(record.DraftJSON), &item.Definition); err != nil {
		return Workflow{}, fmt.Errorf("decode workflow: %w", err)
	}
	var published Definition
	if err := json.Unmarshal([]byte(record.PublishedJSON), &published); err != nil {
		return Workflow{}, fmt.Errorf("decode published workflow: %w", err)
	}
	item.HasCommentReplies = published.Source.Kind == "comment_received" || commentResponseSteps(published.Steps)
	return item, nil
}

// SetActions is called during application assembly, before the worker starts.
func (s *Service) SetActions(actions Actions) { s.actions = actions }

func recordSourceBaseline(ctx context.Context, tx bun.Tx, id, fingerprint, sourceKind string, baseline []SourceItem, now time.Time) error {
	for _, sourceItem := range baseline {
		key, err := sourceEventKey(sourceKind, sourceItem.ID)
		if err != nil {
			return err
		}
		event := eventRecord{WorkflowID: id, SourceFingerprint: fingerprint, EventKey: key, CreatedAt: now}
		if _, err := tx.NewInsert().Model(&event).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) SetAI(generator ai.Generator, model string) {
	s.generator = generator
	s.model = model
}

func (s *Service) SetDecisionAI(decider ai.Decider, model string) {
	s.decider = decider
	s.decisionModel = model
}

func (s *Service) SetAILimits(enabled bool, monthlyCalls int64) {
	s.aiEnabled = enabled
	s.aiMonthlyCalls = max(0, monthlyCalls)
}

func (s *Service) StopReplies(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string, expected int) (Workflow, error) {
	authority, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister)
	if err != nil {
		return Workflow{}, err
	}
	current, err := s.Get(ctx, actor, workspaceID, id)
	if err != nil {
		return Workflow{}, err
	}
	record, err := s.loadWorkflow(ctx, workspaceID, id)
	if err != nil {
		return Workflow{}, err
	}
	var published Definition
	if err := json.Unmarshal([]byte(record.PublishedJSON), &published); err != nil {
		return Workflow{}, err
	}
	if current.Definition.Source.Kind != "comment_received" && published.Source.Kind != "comment_received" {
		return Workflow{}, invalid("this workflow does not automate comment replies")
	}
	item, err := s.Pause(ctx, actor, workspaceID, id, expected)
	if err != nil {
		return Workflow{}, err
	}
	if err := s.cancelWorkflowReplyRuns(ctx, workspaceID, id); err != nil {
		return Workflow{}, err
	}
	if stopper, ok := s.actions.(ReplyStopper); ok {
		if err := stopper.StopReplies(ctx, authority, id, ""); err != nil {
			return Workflow{}, err
		}
	}
	return item, nil
}

func (s *Service) validateCommentAutomation(ctx context.Context, authority workspaceaccess.StoredAuthority, definition Definition) error {
	if definition.Source.Kind == "comment_received" {
		if validator, ok := s.actions.(CommentSourceValidator); ok {
			if err := validator.ValidateCommentSource(ctx, authority, definition.Source, definition.Steps); err != nil {
				return invalid(err.Error())
			}
		}
	}
	return nil
}

func workflowSourceInitialized(record workflowRecord, definition Definition, fingerprint string) bool {
	return record.SourceInitialized && record.SourceFingerprint == fingerprint && (record.Enabled || definition.Source.Kind != "comment_received")
}

func (s *Service) cancelWorkflowReplyRuns(ctx context.Context, workspaceID, workflowID string) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		var ids []string
		if err := tx.NewSelect().Model((*runRecord)(nil)).Column("id").Where("workflow_id = ? AND workspace_id = ? AND state IN (?)", workflowID, workspaceID, bun.List([]string{StateQueued, StateRunning, StateWaiting, StateApproval})).Scan(ctx, &ids); err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		return s.CancelCommentReplyRuns(ctx, tx, workspaceID, ids)
	})
}
