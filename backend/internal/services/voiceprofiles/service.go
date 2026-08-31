package voiceprofiles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type profileRow struct {
	bun.BaseModel `bun:"table:voice_profiles"`

	ID             string    `bun:",pk"`
	WorkspaceID    string    `bun:"workspace_id,notnull"`
	Name           string    `bun:"name,notnull"`
	NormalizedName string    `bun:"normalized_name,notnull"`
	IsDefault      bool      `bun:"is_default,notnull"`
	Revision       int       `bun:"revision,notnull"`
	SchemaVersion  int       `bun:"schema_version,notnull"`
	DefinitionJSON string    `bun:"definition_json,notnull"`
	CreatedByID    string    `bun:"created_by_id,notnull"`
	CreatedAt      time.Time `bun:"created_at,notnull"`
	UpdatedAt      time.Time `bun:"updated_at,notnull"`
}

type assignmentRow struct {
	bun.BaseModel `bun:"table:voice_profile_account_assignments"`

	SocialAccountID string    `bun:"social_account_id,pk"`
	WorkspaceID     string    `bun:"workspace_id,notnull"`
	VoiceProfileID  string    `bun:"voice_profile_id,notnull"`
	CreatedAt       time.Time `bun:"created_at,notnull"`
	UpdatedAt       time.Time `bun:"updated_at,notnull"`
}

type socialAccountRow struct {
	bun.BaseModel `bun:"table:social_accounts"`

	ID          string `bun:"id,pk"`
	WorkspaceID string `bun:"workspace_id"`
	IsActive    bool   `bun:"is_active"`
}

// Service keeps validation, inheritance, optimistic concurrency, and default
// safety behind one interface used by HTTP handlers and the publication builder.
type Service struct {
	db    *bun.DB
	now   func() time.Time
	newID func() string
}

func New(db *bun.DB) *Service {
	return &Service{
		db:    db,
		now:   func() time.Time { return time.Now().UTC() },
		newID: uuid.NewString,
	}
}

func (s *Service) List(ctx context.Context, workspaceID string) ([]Profile, error) {
	workspaceID, err := requiredID(workspaceID, "workspace_id")
	if err != nil {
		return nil, err
	}
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	var rows []profileRow
	err = s.db.NewSelect().Model(&rows).
		Where("workspace_id = ?", workspaceID).
		OrderExpr("is_default DESC, normalized_name ASC, created_at ASC").
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: list profiles", ErrUnavailable)
	}
	return profilesFromRows(ctx, s.db, rows)
}

func (s *Service) Get(ctx context.Context, workspaceID, profileID string) (Profile, error) {
	row, err := s.loadProfile(ctx, s.db, workspaceID, profileID)
	if err != nil {
		return Profile{}, err
	}
	profiles, err := profilesFromRows(ctx, s.db, []profileRow{row})
	if err != nil {
		return Profile{}, err
	}
	return profiles[0], nil
}

func (s *Service) Default(ctx context.Context, workspaceID string) (Profile, error) {
	workspaceID, err := requiredID(workspaceID, "workspace_id")
	if err != nil {
		return Profile{}, err
	}
	if s == nil || s.db == nil {
		return Profile{}, ErrUnavailable
	}
	var row profileRow
	err = s.db.NewSelect().Model(&row).
		Where("workspace_id = ? AND is_default = ?", workspaceID, true).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrDefaultRequired
	}
	if err != nil {
		return Profile{}, fmt.Errorf("%w: load default profile", ErrUnavailable)
	}
	profiles, err := profilesFromRows(ctx, s.db, []profileRow{row})
	if err != nil {
		return Profile{}, err
	}
	return profiles[0], nil
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Profile, error) {
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return Profile{}, err
	}
	name, normalizedName, err := normalizeName(input.Name)
	if err != nil {
		return Profile{}, err
	}
	definition, definitionJSON, err := normalizeDefinition(input.Definition)
	if err != nil {
		return Profile{}, err
	}
	if s == nil || s.db == nil {
		return Profile{}, ErrUnavailable
	}
	now := s.now().UTC()
	row := profileRow{
		ID: s.newID(), WorkspaceID: workspaceID, Name: name, NormalizedName: normalizedName,
		IsDefault: input.IsDefault, Revision: 1, SchemaVersion: DefinitionSchemaVersion,
		DefinitionJSON: definitionJSON, CreatedByID: strings.TrimSpace(input.CreatedByID),
		CreatedAt: now, UpdatedAt: now,
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		count, countErr := tx.NewSelect().Model((*profileRow)(nil)).Where("workspace_id = ?", workspaceID).Count(txCtx)
		if countErr != nil {
			return countErr
		}
		if count == 0 {
			row.IsDefault = true
		}
		if row.IsDefault {
			if clearErr := clearDefault(txCtx, tx, workspaceID, row.ID, now); clearErr != nil {
				return clearErr
			}
		}
		_, insertErr := tx.NewInsert().Model(&row).Exec(txCtx)
		return insertErr
	})
	if err != nil {
		return Profile{}, writeError(err, "create profile")
	}
	return Profile{
		ID: row.ID, WorkspaceID: workspaceID, Name: name, IsDefault: row.IsDefault,
		Revision: 1, SchemaVersion: DefinitionSchemaVersion, Definition: definition,
		AssignedAccountIDs: []string{}, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (s *Service) Update(ctx context.Context, profileID string, input UpdateInput) (Profile, error) {
	if input.ExpectedRevision < 1 {
		return Profile{}, fmt.Errorf("%w: expected_revision must be positive", ErrInvalidInput)
	}
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return Profile{}, err
	}
	profileID, err = requiredID(profileID, "profile_id")
	if err != nil {
		return Profile{}, err
	}
	name, normalizedName, err := normalizeName(input.Name)
	if err != nil {
		return Profile{}, err
	}
	_, definitionJSON, err := normalizeDefinition(input.Definition)
	if err != nil {
		return Profile{}, err
	}
	if s == nil || s.db == nil {
		return Profile{}, ErrUnavailable
	}
	now := s.now().UTC()
	result, err := s.db.NewUpdate().Model((*profileRow)(nil)).
		Set("name = ?", name).
		Set("normalized_name = ?", normalizedName).
		Set("definition_json = ?", definitionJSON).
		Set("schema_version = ?", DefinitionSchemaVersion).
		Set("revision = revision + 1").
		Set("updated_at = ?", now).
		Where("id = ? AND workspace_id = ? AND revision = ?", profileID, workspaceID, input.ExpectedRevision).
		Exec(ctx)
	if err != nil {
		return Profile{}, writeError(err, "update profile")
	}
	if err := s.requireOneAffected(ctx, result, workspaceID, profileID); err != nil {
		return Profile{}, err
	}
	return s.Get(ctx, workspaceID, profileID)
}

//nolint:gocyclo // Default changes combine optimistic concurrency and invariant-preserving transaction checks.
func (s *Service) SetDefault(ctx context.Context, profileID string, input SetDefaultInput) (Profile, error) {
	if input.ExpectedRevision < 1 {
		return Profile{}, fmt.Errorf("%w: expected_revision must be positive", ErrInvalidInput)
	}
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return Profile{}, err
	}
	profileID, err = requiredID(profileID, "profile_id")
	if err != nil {
		return Profile{}, err
	}
	if s == nil || s.db == nil {
		return Profile{}, ErrUnavailable
	}
	now := s.now().UTC()
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		row, loadErr := s.loadProfile(txCtx, tx, workspaceID, profileID)
		if loadErr != nil {
			return loadErr
		}
		if row.Revision != input.ExpectedRevision {
			return ErrRevisionConflict
		}
		if row.IsDefault {
			return nil
		}
		if clearErr := clearDefault(txCtx, tx, workspaceID, profileID, now); clearErr != nil {
			return clearErr
		}
		result, updateErr := tx.NewUpdate().Model((*profileRow)(nil)).
			Set("is_default = ?", true).
			Set("revision = revision + 1").
			Set("updated_at = ?", now).
			Where("id = ? AND workspace_id = ? AND revision = ?", profileID, workspaceID, input.ExpectedRevision).
			Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return rowsErr
		}
		if rows != 1 {
			return ErrRevisionConflict
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrRevisionConflict) {
			return Profile{}, err
		}
		return Profile{}, writeError(err, "set default profile")
	}
	return s.Get(ctx, workspaceID, profileID)
}

//nolint:gocyclo // Deletion preserves the workspace default and account assignment invariants transactionally.
func (s *Service) Delete(ctx context.Context, profileID string, input DeleteInput) error {
	if input.ExpectedRevision < 1 {
		return fmt.Errorf("%w: expected_revision must be positive", ErrInvalidInput)
	}
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return err
	}
	profileID, err = requiredID(profileID, "profile_id")
	if err != nil {
		return err
	}
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		row, loadErr := s.loadProfile(txCtx, tx, workspaceID, profileID)
		if loadErr != nil {
			return loadErr
		}
		if row.Revision != input.ExpectedRevision {
			return ErrRevisionConflict
		}
		if row.IsDefault {
			return ErrDefaultRequired
		}
		count, countErr := tx.NewSelect().Model((*profileRow)(nil)).Where("workspace_id = ?", workspaceID).Count(txCtx)
		if countErr != nil {
			return countErr
		}
		if count <= 1 {
			return ErrDefaultRequired
		}
		if _, deleteErr := tx.NewDelete().Model((*assignmentRow)(nil)).
			Where("workspace_id = ? AND voice_profile_id = ?", workspaceID, profileID).
			Exec(txCtx); deleteErr != nil {
			return deleteErr
		}
		result, deleteErr := tx.NewDelete().Model((*profileRow)(nil)).
			Where("id = ? AND workspace_id = ? AND revision = ?", profileID, workspaceID, input.ExpectedRevision).
			Exec(txCtx)
		if deleteErr != nil {
			return deleteErr
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return rowsErr
		}
		if rows != 1 {
			return ErrRevisionConflict
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrRevisionConflict) || errors.Is(err, ErrDefaultRequired) {
			return err
		}
		return writeError(err, "delete profile")
	}
	return nil
}

func (s *Service) AssignAccount(ctx context.Context, input AssignmentInput) (EffectiveProfile, error) {
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return EffectiveProfile{}, err
	}
	accountID, err := requiredID(input.AccountID, "account_id")
	if err != nil {
		return EffectiveProfile{}, err
	}
	profileID := strings.TrimSpace(input.VoiceProfileID)
	if s == nil || s.db == nil {
		return EffectiveProfile{}, ErrUnavailable
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if accountErr := requireAccounts(txCtx, tx, workspaceID, []string{accountID}); accountErr != nil {
			return accountErr
		}
		if profileID == "" {
			_, deleteErr := tx.NewDelete().Model((*assignmentRow)(nil)).
				Where("social_account_id = ? AND workspace_id = ?", accountID, workspaceID).
				Exec(txCtx)
			return deleteErr
		}
		profile, profileErr := s.loadProfile(txCtx, tx, workspaceID, profileID)
		if profileErr != nil {
			return profileErr
		}
		if profile.IsDefault {
			_, deleteErr := tx.NewDelete().Model((*assignmentRow)(nil)).
				Where("social_account_id = ? AND workspace_id = ?", accountID, workspaceID).
				Exec(txCtx)
			return deleteErr
		}
		now := s.now().UTC()
		assignment := assignmentRow{
			SocialAccountID: accountID, WorkspaceID: workspaceID, VoiceProfileID: profileID,
			CreatedAt: now, UpdatedAt: now,
		}
		_, upsertErr := tx.NewInsert().Model(&assignment).
			On("CONFLICT (social_account_id) DO UPDATE").
			Set("workspace_id = EXCLUDED.workspace_id").
			Set("voice_profile_id = EXCLUDED.voice_profile_id").
			Set("updated_at = EXCLUDED.updated_at").
			Exec(txCtx)
		return upsertErr
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalidInput) {
			return EffectiveProfile{}, err
		}
		return EffectiveProfile{}, writeError(err, "assign profile")
	}
	resolved, err := s.Resolve(ctx, ResolveInput{WorkspaceID: workspaceID, AccountIDs: []string{accountID}})
	if err != nil {
		return EffectiveProfile{}, err
	}
	return resolved[0], nil
}

//nolint:gocyclo // Resolution joins workspace ownership, account assignments, and the frozen default fallback.
func (s *Service) Resolve(ctx context.Context, input ResolveInput) ([]EffectiveProfile, error) {
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return nil, err
	}
	accountIDs, err := uniqueIDs(input.AccountIDs, "account_ids")
	if err != nil {
		return nil, err
	}
	if len(accountIDs) == 0 {
		return []EffectiveProfile{}, nil
	}
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	if err := requireAccounts(ctx, s.db, workspaceID, accountIDs); err != nil {
		return nil, err
	}
	if overrideID := strings.TrimSpace(input.PublicationVoiceProfileID); overrideID != "" {
		profile, err := s.Get(ctx, workspaceID, overrideID)
		if err != nil {
			return nil, err
		}
		out := make([]EffectiveProfile, 0, len(accountIDs))
		for _, accountID := range accountIDs {
			out = append(out, EffectiveProfile{AccountID: accountID, Source: ResolutionPublicationOverride, Profile: profile})
		}
		return out, nil
	}

	defaultProfile, err := s.Default(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	var assignments []assignmentRow
	err = s.db.NewSelect().Model(&assignments).
		Where("workspace_id = ?", workspaceID).
		Where("social_account_id IN (?)", bun.List(accountIDs)).
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: load account assignments", ErrUnavailable)
	}
	assignmentByAccount := make(map[string]string, len(assignments))
	profileIDs := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		assignmentByAccount[assignment.SocialAccountID] = assignment.VoiceProfileID
		profileIDs = append(profileIDs, assignment.VoiceProfileID)
	}
	profileByID := map[string]Profile{}
	if len(profileIDs) > 0 {
		var rows []profileRow
		if err := s.db.NewSelect().Model(&rows).
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(profileIDs)).
			Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: load assigned profiles", ErrUnavailable)
		}
		profiles, err := profilesFromRows(ctx, s.db, rows)
		if err != nil {
			return nil, err
		}
		for _, profile := range profiles {
			profileByID[profile.ID] = profile
		}
	}

	out := make([]EffectiveProfile, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		if profileID := assignmentByAccount[accountID]; profileID != "" {
			profile, ok := profileByID[profileID]
			if !ok {
				return nil, fmt.Errorf("%w: account assignment references a missing profile", ErrUnavailable)
			}
			out = append(out, EffectiveProfile{AccountID: accountID, Source: ResolutionAccountOverride, Profile: profile})
			continue
		}
		out = append(out, EffectiveProfile{AccountID: accountID, Source: ResolutionWorkspaceDefault, Profile: defaultProfile})
	}
	return out, nil
}

// SeedDefault inserts the default Voice Profile inside a Workspace-creation
// transaction. It is idempotent if the caller retries the transaction.
func SeedDefault(ctx context.Context, db bun.IDB, input DefaultSeed) (Profile, error) {
	workspaceID, err := requiredID(input.WorkspaceID, "workspace_id")
	if err != nil {
		return Profile{}, err
	}
	if db == nil {
		return Profile{}, ErrUnavailable
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Default voice"
	}
	name, normalizedName, err := normalizeName(name)
	if err != nil {
		return Profile{}, err
	}
	now := input.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var existing profileRow
	err = db.NewSelect().Model(&existing).
		Where("workspace_id = ? AND is_default = ?", workspaceID, true).
		Scan(ctx)
	if err == nil {
		return profileFromRow(existing)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Profile{}, fmt.Errorf("%w: inspect default profile", ErrUnavailable)
	}
	definition, definitionJSON, err := normalizeDefinition(Definition{})
	if err != nil {
		return Profile{}, err
	}
	row := profileRow{
		ID: "default:" + workspaceID, WorkspaceID: workspaceID, Name: name, NormalizedName: normalizedName,
		IsDefault: true, Revision: 1, SchemaVersion: DefinitionSchemaVersion,
		DefinitionJSON: definitionJSON, CreatedByID: strings.TrimSpace(input.CreatedByID),
		CreatedAt: now, UpdatedAt: now,
	}
	if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
		if isUniqueViolation(err) {
			if loadErr := db.NewSelect().Model(&existing).
				Where("workspace_id = ? AND is_default = ?", workspaceID, true).
				Scan(ctx); loadErr == nil {
				return profileFromRow(existing)
			}
		}
		return Profile{}, writeError(err, "seed default profile")
	}
	return Profile{
		ID: row.ID, WorkspaceID: workspaceID, Name: name, IsDefault: true,
		Revision: 1, SchemaVersion: DefinitionSchemaVersion, Definition: definition,
		AssignedAccountIDs: []string{}, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (s *Service) loadProfile(ctx context.Context, db bun.IDB, workspaceID, profileID string) (profileRow, error) {
	workspaceID, err := requiredID(workspaceID, "workspace_id")
	if err != nil {
		return profileRow{}, err
	}
	profileID, err = requiredID(profileID, "profile_id")
	if err != nil {
		return profileRow{}, err
	}
	if db == nil {
		return profileRow{}, ErrUnavailable
	}
	var row profileRow
	err = db.NewSelect().Model(&row).
		Where("id = ? AND workspace_id = ?", profileID, workspaceID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return profileRow{}, ErrNotFound
	}
	if err != nil {
		return profileRow{}, fmt.Errorf("%w: load profile", ErrUnavailable)
	}
	return row, nil
}

func clearDefault(ctx context.Context, db bun.IDB, workspaceID, exceptID string, now time.Time) error {
	_, err := db.NewUpdate().Model((*profileRow)(nil)).
		Set("is_default = ?", false).
		Set("revision = revision + 1").
		Set("updated_at = ?", now).
		Where("workspace_id = ? AND is_default = ? AND id != ?", workspaceID, true, exceptID).
		Exec(ctx)
	return err
}

func profilesFromRows(ctx context.Context, db bun.IDB, rows []profileRow) ([]Profile, error) {
	profiles := make([]Profile, 0, len(rows))
	profileIndex := make(map[string]int, len(rows))
	profileIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		profile, err := profileFromRow(row)
		if err != nil {
			return nil, err
		}
		profileIndex[row.ID] = len(profiles)
		profileIDs = append(profileIDs, row.ID)
		profiles = append(profiles, profile)
	}
	if len(profileIDs) == 0 {
		return profiles, nil
	}
	var assignments []assignmentRow
	err := db.NewSelect().Model(&assignments).
		Where("voice_profile_id IN (?)", bun.List(profileIDs)).
		OrderExpr("social_account_id ASC").
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: load profile assignments", ErrUnavailable)
	}
	for _, assignment := range assignments {
		if index, ok := profileIndex[assignment.VoiceProfileID]; ok {
			profiles[index].AssignedAccountIDs = append(profiles[index].AssignedAccountIDs, assignment.SocialAccountID)
		}
	}
	return profiles, nil
}

func profileFromRow(row profileRow) (Profile, error) {
	if row.SchemaVersion != DefinitionSchemaVersion {
		return Profile{}, fmt.Errorf("%w: unsupported definition schema version", ErrUnavailable)
	}
	decoder := json.NewDecoder(strings.NewReader(row.DefinitionJSON))
	decoder.DisallowUnknownFields()
	var definition Definition
	if err := decoder.Decode(&definition); err != nil {
		return Profile{}, fmt.Errorf("%w: invalid stored definition", ErrUnavailable)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Profile{}, fmt.Errorf("%w: invalid stored definition", ErrUnavailable)
	}
	normalized, _, err := normalizeDefinition(definition)
	if err != nil {
		return Profile{}, fmt.Errorf("%w: invalid stored definition", ErrUnavailable)
	}
	return Profile{
		ID: row.ID, WorkspaceID: row.WorkspaceID, Name: row.Name, IsDefault: row.IsDefault,
		Revision: row.Revision, SchemaVersion: row.SchemaVersion, Definition: normalized,
		AssignedAccountIDs: []string{}, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(),
	}, nil
}

func requireAccounts(ctx context.Context, db bun.IDB, workspaceID string, accountIDs []string) error {
	if len(accountIDs) == 0 {
		return nil
	}
	var rows []socialAccountRow
	err := db.NewSelect().Model(&rows).
		Column("id", "workspace_id", "is_active").
		Where("workspace_id = ? AND is_active = ?", workspaceID, true).
		Where("id IN (?)", bun.List(accountIDs)).
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: load accounts", ErrUnavailable)
	}
	if len(rows) != len(accountIDs) {
		return fmt.Errorf("%w: account is inactive, missing, or outside the workspace", ErrNotFound)
	}
	return nil
}

func (s *Service) requireOneAffected(ctx context.Context, result sql.Result, workspaceID, profileID string) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%w: inspect profile update", ErrUnavailable)
	}
	if rows == 1 {
		return nil
	}
	var revision int
	err = s.db.NewSelect().Model((*profileRow)(nil)).
		Column("revision").
		Where("id = ? AND workspace_id = ?", profileID, workspaceID).
		Scan(ctx, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("%w: inspect profile", ErrUnavailable)
	}
	return ErrRevisionConflict
}

func requiredID(value, field string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 128 {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidInput, field)
	}
	return value, nil
}

func uniqueIDs(values []string, field string) ([]string, error) {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		id, err := requiredID(value, field)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[id]; exists {
			return nil, fmt.Errorf("%w: %s must be unique", ErrInvalidInput, field)
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func writeError(err error, action string) error {
	if errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrRevisionConflict) || errors.Is(err, ErrDefaultRequired) {
		return err
	}
	if isUniqueViolation(err) {
		return fmt.Errorf("%w: profile name or default already exists", ErrConflict)
	}
	return fmt.Errorf("%w: %s", ErrUnavailable, action)
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") ||
		strings.Contains(message, "duplicate key") ||
		strings.Contains(message, "sqlstate 23505")
}
