package themes

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
)

type Actor struct {
	UserID                string
	SessionID             string
	TokenID               string
	ClientID              string
	CredentialWorkspaceID string
}

var errStoredManifest = errors.New("stored theme manifest is invalid")

type themeRow struct {
	bun.BaseModel           `bun:"table:organization_themes"`
	ID                      string    `bun:"id,pk"`
	OrganizationID          string    `bun:"organization_id,notnull"`
	Name                    string    `bun:"name,notnull"`
	NormalizedName          string    `bun:"normalized_name,notnull"`
	LatestPublishedRevision int       `bun:"latest_published_revision,notnull"`
	CreatedBy               string    `bun:"created_by,notnull"`
	CreatedAt               time.Time `bun:"created_at,notnull"`
	UpdatedAt               time.Time `bun:"updated_at,notnull"`
}

type draftRow struct {
	bun.BaseModel  `bun:"table:organization_theme_drafts"`
	ThemeID        string    `bun:"theme_id,pk"`
	OrganizationID string    `bun:"organization_id,notnull"`
	Revision       int       `bun:"revision,notnull"`
	Name           string    `bun:"name,notnull"`
	ManifestJSON   string    `bun:"manifest_json,notnull"`
	UpdatedBy      string    `bun:"updated_by,notnull"`
	UpdatedAt      time.Time `bun:"updated_at,notnull"`
}

type revisionRow struct {
	bun.BaseModel  `bun:"table:organization_theme_revisions"`
	ThemeID        string    `bun:"theme_id,pk"`
	OrganizationID string    `bun:"organization_id,notnull"`
	Revision       int       `bun:"revision,pk"`
	Name           string    `bun:"name,notnull"`
	ManifestJSON   string    `bun:"manifest_json,notnull"`
	PublishedBy    string    `bun:"published_by,notnull"`
	PublishedAt    time.Time `bun:"published_at,notnull"`
	SourceRevision *int      `bun:"source_revision,nullzero"`
}

type settingsRow struct {
	bun.BaseModel           `bun:"table:organization_theme_settings"`
	OrganizationID          string    `bun:"organization_id,pk"`
	DefaultReferenceKind    string    `bun:"default_reference_kind,notnull"`
	DefaultReferenceID      string    `bun:"default_reference_id,notnull"`
	DefaultReferenceVersion int       `bun:"default_reference_version,notnull"`
	AssignmentsLocked       bool      `bun:"assignments_locked,notnull"`
	UpdatedBy               string    `bun:"updated_by,notnull"`
	UpdatedAt               time.Time `bun:"updated_at,notnull"`
}

type assignmentRow struct {
	bun.BaseModel    `bun:"table:workspace_theme_assignments"`
	WorkspaceID      string    `bun:"workspace_id,pk"`
	OrganizationID   string    `bun:"organization_id,notnull"`
	ReferenceKind    string    `bun:"reference_kind,notnull"`
	ReferenceID      string    `bun:"reference_id,notnull"`
	ReferenceVersion int       `bun:"reference_version,notnull"`
	UpdatedBy        string    `bun:"updated_by,notnull"`
	UpdatedAt        time.Time `bun:"updated_at,notnull"`
}

type CreateInput struct {
	OrganizationID     string
	Name               string
	Manifest           ThemeManifest
	DuplicateBuiltInID string
}

type UpdateDraftInput struct {
	OrganizationID   string
	ExpectedRevision int
	Name             string
	Manifest         ThemeManifest
}

type PublishInput struct {
	OrganizationID            string
	ExpectedDraftRevision     int
	ExpectedPublishedRevision int
}

type RollbackInput struct {
	OrganizationID            string
	SourceRevision            int
	ExpectedDraftRevision     int
	ExpectedPublishedRevision int
}

type DeleteInput struct {
	OrganizationID string
}

type OrganizationSettingsInput struct {
	OrganizationID    string
	DefaultReference  ThemeReference
	AssignmentsLocked bool
}

type WorkspaceAssignmentInput struct {
	WorkspaceID string
	Reference   *ThemeReference
}

type Service struct {
	db       *bun.DB
	storage  mediastore.BlobStorage
	resolver *resolver
	now      func() time.Time
	newID    func() string
}

func New(db *bun.DB) *Service {
	service := &Service{db: db, now: func() time.Time { return time.Now().UTC() }, newID: uuid.NewString}
	service.resolver = newResolver(service)
	return service
}

func (s *Service) ListBuiltIns() []BuiltInFamily {
	all := BuiltIns()
	result := make([]BuiltInFamily, 0, len(builtInOrder))
	for _, id := range builtInOrder {
		result = append(result, all[id])
	}
	return result
}
