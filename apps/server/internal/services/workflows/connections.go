package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) Connections(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string) ([]Connection, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	records := []connectionRecord{}
	if err := s.db.NewSelect().Model(&records).Column("id", "name", "kind", "host", "header_name", "created_at").Where("workspace_id = ?", workspaceID).Order("name ASC").Scan(ctx); err != nil {
		return nil, err
	}
	result := make([]Connection, 0, len(records))
	for _, record := range records {
		result = append(result, Connection{ID: record.ID, Name: record.Name, Kind: record.Kind, Host: record.Host, HeaderName: record.HeaderName, CreatedAt: record.CreatedAt})
	}
	return result, nil
}
func (s *Service) SaveConnection(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, name, token string) (Connection, error) {
	return s.SaveCredential(ctx, actor, workspaceID, WorkflowCredentialRequest{Name: name, Kind: "github", Token: token})
}
func (s *Service) SaveCredential(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string, input WorkflowCredentialRequest) (Connection, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return Connection{}, err
	}
	record, err := s.prepareCredential(workspaceID, input)
	if err != nil {
		return Connection{}, err
	}
	if _, err = s.db.NewInsert().Model(&record).Exec(ctx); err != nil {
		return Connection{}, err
	}
	return connectionMetadata(record), nil
}
func (s *Service) prepareCredential(workspaceID string, input WorkflowCredentialRequest) (connectionRecord, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Token = strings.TrimSpace(input.Token)
	if input.Kind == "" {
		input.Kind = "github"
	}
	if input.Kind == "github" {
		input.Host = "api.github.com"
	}
	if err := validateCredential(input); err != nil {
		return connectionRecord{}, err
	}
	if s.encryptor == nil {
		return connectionRecord{}, errors.New("credential storage is unavailable")
	}
	ciphertext, err := s.encryptor.Encrypt(input.Token)
	if err != nil {
		return connectionRecord{}, err
	}
	return connectionRecord{ID: uuid.NewString(), WorkspaceID: workspaceID, Name: input.Name, Kind: input.Kind, Host: input.Host, HeaderName: input.HeaderName, Ciphertext: ciphertext, CreatedAt: time.Now().UTC()}, nil
}
func validateCredential(input WorkflowCredentialRequest) error {
	if input.Name == "" || len(input.Name) > 100 || input.Token == "" || len(input.Token) > 4000 || strings.ContainsAny(input.Token, "\r\n") {
		return invalid("enter a connection name and secret value")
	}
	if !slices.Contains([]string{"github", "bearer", "header", "basic"}, input.Kind) {
		return invalid("unsupported authentication type")
	}
	if err := validateCredentialHost(input.Host); err != nil {
		return err
	}
	if input.Kind == "header" && (!headerNamePattern.MatchString(input.HeaderName) || forbiddenHeader(input.HeaderName)) {
		return invalid("enter a valid authentication header name")
	}
	if input.Kind == "basic" && !strings.Contains(input.Token, ":") {
		return invalid("basic authentication needs username:password")
	}
	return nil
}
func validateCredentialHost(host string) error {
	hostURL, err := url.Parse("https://" + host)
	if host == "" || err != nil || hostURL.Hostname() != host || hostURL.User != nil || hostURL.Path != "" || hostURL.RawQuery != "" || hostURL.Fragment != "" {
		return invalid("enter only the HTTPS host allowed to receive this secret")
	}
	return nil
}

func connectionMetadata(record connectionRecord) Connection {
	return Connection{ID: record.ID, Name: record.Name, Kind: record.Kind, Host: record.Host, HeaderName: record.HeaderName, CreatedAt: record.CreatedAt}
}
func (s *Service) RotateCredential(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, id, token string) (Connection, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelAdminister); err != nil {
		return Connection{}, err
	}
	var record connectionRecord
	if err := s.db.NewSelect().Model(&record).Where("workspace_id = ? AND id = ?", workspaceID, id).Scan(ctx); err != nil {
		return Connection{}, ErrNotFound
	}
	prepared, err := s.prepareCredential(workspaceID, WorkflowCredentialRequest{Name: record.Name, Kind: record.Kind, Token: token, Host: record.Host, HeaderName: record.HeaderName})
	if err != nil {
		return Connection{}, err
	}
	result, err := s.db.NewUpdate().Model((*connectionRecord)(nil)).Set("ciphertext = ?", prepared.Ciphertext).Where("workspace_id = ? AND id = ?", workspaceID, id).Exec(ctx)
	if err != nil {
		return Connection{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return Connection{}, ErrNotFound
	}
	return connectionMetadata(record), nil
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
				if definitionUsesConnection(definition, id) {
					return invalid("remove this connection from its workflows and pause enabled revisions first")
				}
			}
		}
		var runs []runRecord
		if err := tx.NewSelect().Model(&runs).Column("definition_json").Where("workspace_id = ? AND state IN (?)", workspaceID, bun.List([]string{StateQueued, StateRunning, StateWaiting, StateApproval})).Scan(ctx); err != nil {
			return err
		}
		for _, run := range runs {
			var definition Definition
			if err := json.Unmarshal([]byte(run.DefinitionJSON), &definition); err != nil {
				return err
			}
			if definitionUsesConnection(definition, id) {
				return invalid("this connection is used by an active run")
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

func definitionUsesConnection(def Definition, id string) bool {
	if def.Source.ConnectionID == id {
		return true
	}
	var visit func([]Step) bool
	visit = func(steps []Step) bool {
		for _, step := range steps {
			if step.Inputs["connection_id"].Literal == id || visit(step.Then) || visit(step.Else) {
				return true
			}
		}
		return false
	}
	return visit(def.Steps)
}

func validateStepConnections(ctx context.Context, db bun.IDB, workspaceID string, steps []Step) error {
	for _, step := range steps {
		if id, ok := step.Inputs["connection_id"].Literal.(string); ok && id != "" {
			exists, err := db.NewSelect().Model((*connectionRecord)(nil)).Where("workspace_id = ? AND id = ? AND kind IN (?)", workspaceID, id, bun.List([]string{"bearer", "header", "basic"})).Exists(ctx)
			if err != nil {
				return err
			}
			if !exists {
				return invalid("HTTP connection is unavailable in this workspace")
			}
		}
		if err := validateStepConnections(ctx, db, workspaceID, step.Then); err != nil {
			return err
		}
		if err := validateStepConnections(ctx, db, workspaceID, step.Else); err != nil {
			return err
		}
	}
	return nil
}
