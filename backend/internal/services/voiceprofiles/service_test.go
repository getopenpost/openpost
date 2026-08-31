package voiceprofiles

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestProfileLifecycleKeepsOneRevisionedDefault(t *testing.T) {
	service, db := newVoiceProfileTestService(t)

	first, err := service.Create(t.Context(), CreateInput{
		WorkspaceID: "workspace-1", CreatedByID: "user-1", Name: " Rodrigo ",
		Definition: Definition{Traits: []string{"Direct", "direct", "Technical"}},
	})
	require.NoError(t, err)
	require.True(t, first.IsDefault, "the first profile must become the default")
	require.Equal(t, "Rodrigo", first.Name)
	require.Equal(t, []string{"Direct", "Technical"}, first.Definition.Traits)

	company, err := service.Create(t.Context(), CreateInput{
		WorkspaceID: "workspace-1", CreatedByID: "user-1", Name: "OpenPost",
		Definition: Definition{
			IdentitySummary: " Product voice ", PreferredLanguage: " English (Portugal) ",
			ForbiddenPhrases: []string{"Game changer"},
		},
	})
	require.NoError(t, err)
	require.False(t, company.IsDefault)
	require.Equal(t, "English (Portugal)", company.Definition.PreferredLanguage)

	listed, err := service.List(t.Context(), "workspace-1")
	require.NoError(t, err)
	require.Equal(t, []string{first.ID, company.ID}, []string{listed[0].ID, listed[1].ID})

	company, err = service.Update(t.Context(), company.ID, UpdateInput{
		WorkspaceID: "workspace-1", ExpectedRevision: company.Revision, Name: "OpenPost company",
		Definition: Definition{IdentitySummary: "Clear product updates", Humor: "Dry when it helps"},
	})
	require.NoError(t, err)
	require.Equal(t, 2, company.Revision)

	_, err = service.Update(t.Context(), company.ID, UpdateInput{
		WorkspaceID: "workspace-1", ExpectedRevision: 1, Name: "Stale edit",
	})
	require.ErrorIs(t, err, ErrRevisionConflict)

	company, err = service.SetDefault(t.Context(), company.ID, SetDefaultInput{
		WorkspaceID: "workspace-1", ExpectedRevision: company.Revision,
	})
	require.NoError(t, err)
	require.True(t, company.IsDefault)
	require.Equal(t, 3, company.Revision)

	first, err = service.Get(t.Context(), "workspace-1", first.ID)
	require.NoError(t, err)
	require.False(t, first.IsDefault)
	require.Equal(t, 2, first.Revision, "losing default status is a revisioned change")

	err = service.Delete(t.Context(), company.ID, DeleteInput{
		WorkspaceID: "workspace-1", ExpectedRevision: company.Revision,
	})
	require.ErrorIs(t, err, ErrDefaultRequired)

	err = service.Delete(t.Context(), first.ID, DeleteInput{
		WorkspaceID: "workspace-1", ExpectedRevision: first.Revision,
	})
	require.NoError(t, err)
	_, err = service.Get(t.Context(), "workspace-1", first.ID)
	require.ErrorIs(t, err, ErrNotFound)

	count, err := db.NewSelect().Model((*profileRow)(nil)).Where("workspace_id = ? AND is_default = ?", "workspace-1", true).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestAccountAssignmentAndResolutionRespectWorkspaceAndPrecedence(t *testing.T) {
	service, db := newVoiceProfileTestService(t)
	seedVoiceAccounts(t, db)
	personal, err := service.Create(t.Context(), CreateInput{WorkspaceID: "workspace-1", Name: "Personal"})
	require.NoError(t, err)
	company, err := service.Create(t.Context(), CreateInput{WorkspaceID: "workspace-1", Name: "Company"})
	require.NoError(t, err)

	effective, err := service.AssignAccount(t.Context(), AssignmentInput{
		WorkspaceID: "workspace-1", AccountID: "account-2", VoiceProfileID: company.ID,
	})
	require.NoError(t, err)
	require.Equal(t, ResolutionAccountOverride, effective.Source)
	require.Equal(t, company.ID, effective.Profile.ID)

	resolved, err := service.Resolve(t.Context(), ResolveInput{
		WorkspaceID: "workspace-1", AccountIDs: []string{"account-2", "account-1"},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"account-2", "account-1"}, []string{resolved[0].AccountID, resolved[1].AccountID})
	require.Equal(t, ResolutionAccountOverride, resolved[0].Source)
	require.Equal(t, company.ID, resolved[0].Profile.ID)
	require.Equal(t, ResolutionWorkspaceDefault, resolved[1].Source)
	require.Equal(t, personal.ID, resolved[1].Profile.ID)

	resolved, err = service.Resolve(t.Context(), ResolveInput{
		WorkspaceID: "workspace-1", AccountIDs: []string{"account-2", "account-1"},
		PublicationVoiceProfileID: personal.ID,
	})
	require.NoError(t, err)
	for _, item := range resolved {
		require.Equal(t, ResolutionPublicationOverride, item.Source)
		require.Equal(t, personal.ID, item.Profile.ID)
	}

	// Assigning the default stores no redundant override.
	effective, err = service.AssignAccount(t.Context(), AssignmentInput{
		WorkspaceID: "workspace-1", AccountID: "account-2", VoiceProfileID: personal.ID,
	})
	require.NoError(t, err)
	require.Equal(t, ResolutionWorkspaceDefault, effective.Source)
	assignmentCount, err := db.NewSelect().Model((*assignmentRow)(nil)).Where("social_account_id = ?", "account-2").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, assignmentCount)

	_, err = service.AssignAccount(t.Context(), AssignmentInput{
		WorkspaceID: "workspace-1", AccountID: "outside-account", VoiceProfileID: company.ID,
	})
	require.ErrorIs(t, err, ErrNotFound)
	_, err = service.AssignAccount(t.Context(), AssignmentInput{
		WorkspaceID: "workspace-1", AccountID: "inactive-account", VoiceProfileID: company.ID,
	})
	require.ErrorIs(t, err, ErrNotFound)
	_, err = service.Resolve(t.Context(), ResolveInput{
		WorkspaceID: "workspace-1", AccountIDs: []string{"account-1", "account-1"},
	})
	require.ErrorIs(t, err, ErrInvalidInput)
}

func TestDefinitionValidationBoundsAndRejectsCorruptStoredJSON(t *testing.T) {
	service, db := newVoiceProfileTestService(t)
	_, err := service.Create(t.Context(), CreateInput{
		WorkspaceID: "workspace-1", Name: "Too much",
		Definition: Definition{IdentitySummary: strings.Repeat("x", maxIdentityCharacters+1)},
	})
	require.ErrorIs(t, err, ErrInvalidInput)
	_, err = service.Create(t.Context(), CreateInput{
		WorkspaceID: "workspace-1", Name: "Too much language",
		Definition: Definition{PreferredLanguage: strings.Repeat("x", maxLanguageCharacters+1)},
	})
	require.ErrorIs(t, err, ErrInvalidInput)

	profile, err := service.Create(t.Context(), CreateInput{
		WorkspaceID: "workspace-1", Name: "Valid",
		Definition: Definition{Examples: []Example{{Text: "A representative post"}}},
	})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*profileRow)(nil)).
		Set("definition_json = ?", `{"identity_summary":"valid","unknown":true}`).
		Where("id = ?", profile.ID).
		Exec(t.Context())
	require.NoError(t, err)
	_, err = service.Get(t.Context(), "workspace-1", profile.ID)
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestSeedDefaultIsDeterministicAndIdempotent(t *testing.T) {
	_, db := newVoiceProfileTestService(t)
	now := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	first, err := SeedDefault(t.Context(), db, DefaultSeed{
		WorkspaceID: "workspace-seed", CreatedByID: "user-1", Name: "Rodrigo", Now: now,
	})
	require.NoError(t, err)
	second, err := SeedDefault(t.Context(), db, DefaultSeed{
		WorkspaceID: "workspace-seed", CreatedByID: "user-2", Name: "Ignored", Now: now.Add(time.Hour),
	})
	require.NoError(t, err)
	require.Equal(t, "default:workspace-seed", first.ID)
	require.Equal(t, first.ID, second.ID)
	require.Equal(t, "Rodrigo", second.Name)
}

func newVoiceProfileTestService(t *testing.T) (*Service, *bun.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	sqlDB, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createVoiceProfileTestTables(t, db)

	service := New(db)
	now := time.Date(2026, time.August, 23, 10, 0, 0, 0, time.UTC)
	service.now = func() time.Time {
		now = now.Add(time.Second)
		return now
	}
	sequence := 0
	service.newID = func() string {
		sequence++
		return fmt.Sprintf("profile-%d", sequence)
	}
	return service, db
}

func createVoiceProfileTestTables(t *testing.T, db *bun.DB) {
	t.Helper()
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`CREATE TABLE social_accounts (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT true
		)`,
		`CREATE UNIQUE INDEX social_accounts_owner_idx ON social_accounts (id, workspace_id)`,
		`CREATE TABLE voice_profiles (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT false,
			revision INTEGER NOT NULL DEFAULT 1,
			schema_version INTEGER NOT NULL DEFAULT 1,
			definition_json TEXT NOT NULL DEFAULT '{}',
			created_by_id TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			UNIQUE (id, workspace_id),
			UNIQUE (workspace_id, normalized_name)
		)`,
		`CREATE UNIQUE INDEX voice_profiles_default_idx ON voice_profiles (workspace_id) WHERE is_default = true`,
		`CREATE TABLE voice_profile_account_assignments (
			social_account_id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			voice_profile_id TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE,
			FOREIGN KEY (voice_profile_id, workspace_id) REFERENCES voice_profiles(id, workspace_id) ON DELETE CASCADE
		)`,
	}
	for _, statement := range statements {
		_, err := db.ExecContext(context.Background(), statement)
		require.NoError(t, err)
	}
}

func seedVoiceAccounts(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `INSERT INTO social_accounts (id, workspace_id, is_active) VALUES
		('account-1', 'workspace-1', true),
		('account-2', 'workspace-1', true),
		('outside-account', 'workspace-2', true),
		('inactive-account', 'workspace-1', false)`)
	require.NoError(t, err)
}
