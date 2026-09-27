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

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/netguard"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type Service struct {
	db        *bun.DB
	actions   Actions
	encryptor *servicecrypto.TokenEncryptor
	client    *http.Client
}

func NewService(db *bun.DB, actions Actions, encryptor *servicecrypto.TokenEncryptor) *Service {
	return &Service{db: db, actions: actions, encryptor: encryptor, client: netguard.NewHTTPClient(25*time.Second, sourceURLPolicy)}
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
	if err := Validate(input.Definition, false); err != nil {
		return Workflow{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 100 || len(input.Description) > 500 {
		return Workflow{}, invalid("enter a name of 100 characters or fewer")
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
	initialized := record.SourceInitialized && record.SourceFingerprint == fingerprint
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
	return item, nil
}

func (s *Service) Connections(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string) ([]Connection, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	records := []connectionRecord{}
	if err := s.db.NewSelect().Model(&records).Column("id", "name", "kind", "created_at").Where("workspace_id = ?", workspaceID).Order("name ASC").Scan(ctx); err != nil {
		return nil, err
	}
	result := make([]Connection, 0, len(records))
	for _, record := range records {
		result = append(result, Connection{ID: record.ID, Name: record.Name, Kind: record.Kind, CreatedAt: record.CreatedAt})
	}
	return result, nil
}
func (s *Service) SaveConnection(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, name, token string) (Connection, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return Connection{}, err
	}
	name = strings.TrimSpace(name)
	token = strings.TrimSpace(token)
	if name == "" || len(name) > 100 || len(token) < 10 || len(token) > 1000 {
		return Connection{}, invalid("enter a connection name and GitHub access token")
	}
	if s.encryptor == nil {
		return Connection{}, errors.New("credential storage is unavailable")
	}
	ciphertext, err := s.encryptor.Encrypt(token)
	if err != nil {
		return Connection{}, err
	}
	record := connectionRecord{ID: uuid.NewString(), WorkspaceID: workspaceID, Name: name, Kind: "github", Ciphertext: ciphertext, CreatedAt: time.Now().UTC()}
	if _, err := s.db.NewInsert().Model(&record).Exec(ctx); err != nil {
		return Connection{}, err
	}
	return Connection{ID: record.ID, Name: name, Kind: record.Kind, CreatedAt: record.CreatedAt}, nil
}
func (s *Service) DeleteConnection(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id string) error {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return err
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, workspaceID); err != nil {
			return err
		}
		var records []workflowRecord
		if err := tx.NewSelect().Model(&records).Where("workspace_id = ?", workspaceID).Scan(ctx); err != nil {
			return err
		}
		for _, record := range records {
			definitions := []string{record.DraftJSON}
			if record.Enabled {
				definitions = append(definitions, record.PublishedJSON)
			}
			for _, encoded := range definitions {
				var definition Definition
				if err := json.Unmarshal([]byte(encoded), &definition); err != nil {
					return err
				}
				if definition.Source.ConnectionID == id {
					return invalid("remove this connection from its workflows and pause enabled revisions first")
				}
			}
		}
		_, err := tx.NewDelete().Model((*connectionRecord)(nil)).Where("workspace_id = ? AND id = ?", workspaceID, id).Exec(ctx)
		return err
	})
}
func validateConnection(ctx context.Context, db bun.IDB, workspaceID, id string) error {
	if id == "" {
		return nil
	}
	exists, err := db.NewSelect().Model((*connectionRecord)(nil)).Where("workspace_id = ? AND id = ? AND kind = ?", workspaceID, id, "github").Exists(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return invalid("GitHub connection is unavailable in this workspace")
	}
	return nil
}
func (s *Service) connectionToken(ctx context.Context, workspaceID, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	var record connectionRecord
	if err := s.db.NewSelect().Model(&record).Where("workspace_id = ? AND id = ? AND kind = ?", workspaceID, id, "github").Scan(ctx); err != nil {
		return "", invalid("GitHub connection is unavailable in this workspace")
	}
	if s.encryptor == nil {
		return "", errors.New("credential storage is unavailable")
	}
	token, err := s.encryptor.Decrypt(record.Ciphertext)
	if err != nil {
		return "", errors.New("GitHub connection could not be decrypted")
	}
	return token, nil
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
