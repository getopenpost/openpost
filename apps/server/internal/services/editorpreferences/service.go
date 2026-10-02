package editorpreferences

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const observationLifetime = 90 * 24 * time.Hour

var ErrConflict = errors.New("this record changed; reload before saving")
var ErrUnavailable = errors.New("editor preference or style is unavailable")
var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$`)

type Preference struct {
	bun.BaseModel     `bun:"table:editor_preferences"`
	ID                string    `bun:"id,pk" json:"id,omitempty"`
	WorkspaceID       string    `json:"workspace_id,omitempty"`
	OwnerID           string    `json:"-"`
	ProjectID         string    `json:"project_id"`
	EditorKind        string    `json:"editor_kind" enum:"video,image,both"`
	Context           string    `json:"context" maxLength:"100"`
	Rule              string    `json:"rule" minLength:"1" maxLength:"1000"`
	SourceInstruction string    `json:"source_instruction" minLength:"1" maxLength:"1000"`
	Enabled           bool      `json:"enabled"`
	Revision          int       `json:"revision,omitempty"`
	UpdatedAt         time.Time `json:"updated_at,omitempty"`
}

type TextStyle struct {
	FontFamily  string  `json:"font_family,omitempty" maxLength:"128"`
	FontAssetID string  `json:"font_asset_id,omitempty" maxLength:"200"`
	FontSize    float64 `json:"font_size,omitempty" minimum:"0" maximum:"1000"`
	Color       string  `json:"color,omitempty"`
	Align       string  `json:"align,omitempty" enum:"left,center,right,"`
}
type LibraryReference struct {
	ID      string `json:"id,omitempty"`
	Version string `json:"version,omitempty"`
	Role    string `json:"role" maxLength:"100"`
}
type StyleDefinition struct {
	Typography      TextStyle          `json:"typography"`
	Captions        TextStyle          `json:"captions"`
	Palette         []string           `json:"palette" maxItems:"8" nullable:"false"`
	Guidance        []string           `json:"guidance" maxItems:"12" nullable:"false"`
	Library         []LibraryReference `json:"library" maxItems:"12" nullable:"false"`
	SourceProjectID string             `json:"source_project_id,omitempty"`
	SourceRevision  string             `json:"source_revision,omitempty"`
	Interpretations []string           `json:"interpretations" maxItems:"8" nullable:"false"`
}
type Style struct {
	bun.BaseModel     `bun:"table:editor_styles"`
	ID                string          `bun:"id,pk" json:"id,omitempty"`
	Version           int             `bun:",pk" json:"version,omitempty"`
	WorkspaceID       string          `json:"workspace_id,omitempty"`
	OwnerID           string          `json:"-"`
	Name              string          `json:"name" maxLength:"100"`
	EditorKind        string          `json:"editor_kind" enum:"video,image,both"`
	Context           string          `json:"context" maxLength:"100"`
	DefinitionJSON    string          `json:"-"`
	Definition        StyleDefinition `bun:"-" json:"definition"`
	SourceInstruction string          `json:"source_instruction" maxLength:"1000"`
	CreatedAt         time.Time       `json:"created_at,omitempty"`
	Shared            bool            `bun:"-" json:"shared,omitempty"`
	Archived          bool            `json:"archived,omitempty"`
	BuiltIn           bool            `bun:"-" json:"built_in,omitempty"`
}
type Favorite struct {
	bun.BaseModel `bun:"table:editor_library_favorites"`
	WorkspaceID   string    `bun:",pk" json:"-"`
	UserID        string    `bun:",pk" json:"-"`
	EntryID       string    `bun:",pk" json:"entry_id"`
	EntryName     string    `json:"entry_name"`
	EditorKind    string    `json:"editor_kind"`
	DeviceLocal   bool      `json:"device_local"`
	Favorite      bool      `json:"favorite"`
	UpdatedAt     time.Time `json:"updated_at,omitempty"`
}
type choice struct {
	bun.BaseModel `bun:"table:editor_library_choices"`
	WorkspaceID   string `bun:",pk"`
	UserID        string `bun:",pk"`
	ProjectID     string `bun:",pk"`
	Context       string `bun:",pk"`
	EntryID       string `bun:",pk"`
	EntryName     string
	EditorKind    string
	LastUsedAt    time.Time
}
type settings struct {
	bun.BaseModel `bun:"table:editor_learning_settings"`
	WorkspaceID   string `bun:",pk"`
	UserID        string `bun:",pk"`
	Enabled       bool
}
type Suggestion struct {
	EntryID    string    `json:"entry_id"`
	EntryName  string    `json:"entry_name"`
	Context    string    `json:"context"`
	Projects   int       `json:"projects"`
	LastUsedAt time.Time `json:"last_used_at"`
}
type Context struct {
	Preferences     []Preference `json:"preferences"`
	Styles          []Style      `json:"styles"`
	Favorites       []Favorite   `json:"favorites"`
	Suggestions     []Suggestion `json:"suggestions"`
	LearningEnabled bool         `json:"learning_enabled"`
}
type Service struct{ db *bun.DB }

func NewService(db *bun.DB) *Service { return &Service{db: db} }
func validKind(kind string) bool     { return kind == "video" || kind == "image" || kind == "both" }

func (s *Service) Context(ctx context.Context, workspaceID, userID, projectID, kind, contentContext string) (Context, error) {
	result := Context{Preferences: []Preference{}, Styles: []Style{}, Favorites: []Favorite{}, Suggestions: []Suggestion{}, LearningEnabled: true}
	err := s.db.NewSelect().Model(&result.Preferences).Where("workspace_id = ? AND (owner_id = ? OR (owner_id = '' AND project_id = ? AND project_id <> ''))", workspaceID, userID, projectID).Where("editor_kind IN (?, 'both')", kind).Where("context = '' OR context = ? OR ? = '*'", contentContext, contentContext).Order("updated_at DESC").Limit(100).Scan(ctx)
	if err != nil {
		return result, err
	}
	var styles = []Style{}
	err = s.db.NewSelect().Model(&styles).Where("workspace_id = ? AND owner_id IN (?, '')", workspaceID, userID).Where("editor_kind IN (?, 'both')", kind).Where("context = '' OR context = ? OR ? = '*'", contentContext, contentContext).Where("archived = FALSE").Where("version = (SELECT MAX(v.version) FROM editor_styles AS v WHERE v.id = style.id)").Order("name ASC").Limit(50).Scan(ctx)
	if err != nil {
		return result, err
	}
	for _, style := range styles {
		if err := json.Unmarshal([]byte(style.DefinitionJSON), &style.Definition); err != nil {
			return result, err
		}
		style.Shared = style.OwnerID == ""
		result.Styles = append(result.Styles, style)
	}
	result.Styles = append(BuiltInStyles(), result.Styles...)
	if err = s.db.NewSelect().Model(&result.Favorites).Where("workspace_id = ? AND user_id = ? AND editor_kind = ?", workspaceID, userID, kind).Order("updated_at DESC").Limit(100).Scan(ctx); err != nil {
		return result, err
	}
	setting := settings{}
	err = s.db.NewSelect().Model(&setting).Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	if err == nil {
		result.LearningEnabled = setting.Enabled
	}
	_, err = s.db.NewDelete().Model((*choice)(nil)).Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Where("last_used_at < ?", time.Now().UTC().Add(-observationLifetime)).Exec(ctx)
	if err != nil {
		return result, err
	}
	if !result.LearningEnabled {
		return result, nil
	}
	err = s.db.NewSelect().Model((*choice)(nil)).ColumnExpr("entry_id, MAX(entry_name) AS entry_name, context, COUNT(DISTINCT project_id) AS projects, MAX(last_used_at) AS last_used_at").Where("workspace_id = ? AND user_id = ? AND editor_kind = ?", workspaceID, userID, kind).Where("context = '' OR context = ? OR ? = '*'", contentContext, contentContext).Group("entry_id", "context").Having("COUNT(DISTINCT project_id) >= 3").OrderExpr("MAX(last_used_at) DESC").Limit(10).Scan(ctx, &result.Suggestions)
	return result, err
}

func (s *Service) SavePreference(ctx context.Context, workspaceID, userID string, p Preference, expected int) (Preference, error) {
	if !validKind(p.EditorKind) || strings.TrimSpace(p.Rule) == "" || len(p.Rule) > 1000 || strings.TrimSpace(p.SourceInstruction) == "" || len(p.SourceInstruction) > 1000 || len(p.Context) > 100 {
		return p, errors.New("provide a bounded explicit editing instruction")
	}
	p.WorkspaceID = workspaceID
	p.OwnerID = userID
	if p.ProjectID != "" {
		p.OwnerID = ""
	}
	p.UpdatedAt = time.Now().UTC()
	p.Revision = expected + 1
	if expected == 0 {
		p.ID = uuid.NewString()
		_, err := s.db.NewInsert().Model(&p).Exec(ctx)
		return p, err
	}
	result, err := s.db.NewUpdate().Model(&p).Column("context", "rule", "source_instruction", "enabled", "revision", "updated_at").Where("id = ? AND workspace_id = ? AND owner_id = ? AND project_id = ? AND editor_kind = ? AND revision = ?", p.ID, workspaceID, p.OwnerID, p.ProjectID, p.EditorKind, expected).Exec(ctx)
	if err != nil {
		return p, err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return p, ErrConflict
	}
	return p, nil
}
func (s *Service) RemovePreference(ctx context.Context, workspaceID, userID, projectID, id string, revision int) error {
	owner := userID
	if projectID != "" {
		owner = ""
	}
	result, err := s.db.NewDelete().Model((*Preference)(nil)).Where("id = ? AND workspace_id = ? AND owner_id = ? AND project_id = ? AND revision = ?", id, workspaceID, owner, projectID, revision).Exec(ctx)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ErrConflict
	}
	return nil
}

func validateTextStyle(t TextStyle) error {
	if len(t.FontFamily) > 128 || len(t.FontAssetID) > 200 || (t.FontAssetID != "" && t.FontFamily == "") || t.FontSize < 0 || t.FontSize > 1000 || (t.Color != "" && !hexColor.MatchString(t.Color)) || (t.Align != "" && t.Align != "left" && t.Align != "center" && t.Align != "right") {
		return errors.New("invalid text style")
	}
	return nil
}

func (ref LibraryReference) validate() error {
	if ref.ID == "" || ref.Version == "" || len(ref.ID) > 200 || len(ref.Version) > 100 || len(ref.Role) > 100 {
		return errors.New("library references need an exact identity and version")
	}
	return nil
}

func validateDefinition(d StyleDefinition) error {
	if len(d.Palette) > 8 || len(d.Guidance) > 12 || len(d.Library) > 12 || len(d.Interpretations) > 8 {
		return errors.New("style is too large")
	}
	for _, c := range d.Palette {
		if !hexColor.MatchString(c) {
			return errors.New("palette colors must be hex colors")
		}
	}
	for _, t := range []TextStyle{d.Typography, d.Captions} {
		if err := validateTextStyle(t); err != nil {
			return err
		}
	}
	for _, list := range [][]string{d.Guidance, d.Interpretations} {
		for _, text := range list {
			if len(text) > 1000 {
				return errors.New("style instruction is too long")
			}
		}
	}
	for _, ref := range d.Library {
		if err := ref.validate(); err != nil {
			return err
		}
	}
	return nil
}
func prepareStyle(style *Style) error {
	if !validKind(style.EditorKind) || strings.TrimSpace(style.Name) == "" || len(style.Name) > 100 || len(style.Context) > 100 || len(style.SourceInstruction) > 1000 || strings.TrimSpace(style.SourceInstruction) == "" {
		return errors.New("provide a named style and its explicit save instruction")
	}
	if err := validateDefinition(style.Definition); err != nil {
		return err
	}
	if style.Definition.Palette == nil {
		style.Definition.Palette = []string{}
	}
	if style.Definition.Guidance == nil {
		style.Definition.Guidance = []string{}
	}
	if style.Definition.Library == nil {
		style.Definition.Library = []LibraryReference{}
	}
	if style.Definition.Interpretations == nil {
		style.Definition.Interpretations = []string{}
	}
	return nil
}

func (s *Service) SaveStyle(ctx context.Context, workspaceID, userID string, style Style, expected int) (Style, error) {
	if err := prepareStyle(&style); err != nil {
		return style, err
	}
	style.BuiltIn = false
	style.Archived = false
	style.WorkspaceID = workspaceID
	style.OwnerID = userID
	if style.Shared {
		style.OwnerID = ""
	}
	style.Version = expected + 1
	style.CreatedAt = time.Now().UTC()
	encoded, err := json.Marshal(style.Definition)
	if err != nil {
		return style, err
	}
	style.DefinitionJSON = string(encoded)
	if expected == 0 {
		style.ID = uuid.NewString()
		_, err = s.db.NewInsert().Model(&style).Exec(ctx)
		return style, err
	}
	var previous Style
	if err = s.db.NewSelect().Model(&previous).Where("id = ? AND version = ? AND workspace_id = ? AND owner_id = ?", style.ID, expected, workspaceID, style.OwnerID).Scan(ctx); err != nil {
		return style, ErrUnavailable
	}
	var latest int
	if err = s.db.NewSelect().Model((*Style)(nil)).ColumnExpr("MAX(version)").Where("id = ?", style.ID).Scan(ctx, &latest); err != nil {
		return style, err
	}
	if latest != expected {
		return style, ErrConflict
	}
	if _, err = s.db.NewInsert().Model(&style).Exec(ctx); err != nil {
		return style, ErrConflict
	}
	return style, nil
}
func (s *Service) Style(ctx context.Context, workspaceID, userID, id string, version int) (Style, error) {
	for _, style := range BuiltInStyles() {
		if style.ID == id && (version == 0 || version == 1) {
			return style, nil
		}
	}
	style := Style{}
	query := s.db.NewSelect().Model(&style).Where("id = ? AND workspace_id = ? AND owner_id IN (?, '')", id, workspaceID, userID)
	if version > 0 {
		query = query.Where("version = ?", version)
	} else {
		query = query.Order("version DESC").Limit(1)
	}
	if err := query.Scan(ctx); err != nil {
		return style, ErrUnavailable
	}
	if err := json.Unmarshal([]byte(style.DefinitionJSON), &style.Definition); err != nil {
		return style, err
	}
	style.Shared = style.OwnerID == ""
	return style, nil
}

type LearningChange struct {
	Enabled   bool
	Reset     bool
	ProjectID string
}

func (s *Service) SetLearning(ctx context.Context, workspaceID, userID string, change LearningChange) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		setting := settings{WorkspaceID: workspaceID, UserID: userID, Enabled: change.Enabled}
		if _, err := tx.NewInsert().Model(&setting).On("CONFLICT (workspace_id, user_id) DO UPDATE").Set("enabled = EXCLUDED.enabled").Exec(ctx); err != nil {
			return err
		}
		if change.Reset {
			query := tx.NewDelete().Model((*choice)(nil)).Where("workspace_id = ? AND user_id = ?", workspaceID, userID)
			if change.ProjectID != "" {
				query = query.Where("project_id = ?", change.ProjectID)
			}
			_, err := query.Exec(ctx)
			return err
		}
		return nil
	})
}
func (s *Service) RecordChoice(ctx context.Context, workspaceID, userID, projectID, contentContext, entryID, entryName, kind string) error {
	if projectID == "" || entryID == "" || len(entryID) > 200 || len(entryName) > 200 || len(contentContext) > 100 || !validKind(kind) {
		return errors.New("invalid library choice")
	}
	setting := settings{}
	err := s.db.NewSelect().Model(&setting).Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && !setting.Enabled {
		return nil
	}
	entry := choice{WorkspaceID: workspaceID, UserID: userID, ProjectID: projectID, Context: contentContext, EntryID: entryID, EntryName: entryName, EditorKind: kind, LastUsedAt: time.Now().UTC()}
	_, err = s.db.NewInsert().Model(&entry).On("CONFLICT (workspace_id, user_id, project_id, context, entry_id) DO UPDATE").Set("last_used_at = EXCLUDED.last_used_at, entry_name = EXCLUDED.entry_name").Exec(ctx)
	return err
}
func (s *Service) Favorite(ctx context.Context, workspaceID, userID string, entry Favorite) error {
	if entry.EntryID == "" || len(entry.EntryID) > 200 || len(entry.EntryName) > 200 || !validKind(entry.EditorKind) {
		return errors.New("invalid favorite")
	}
	entry.WorkspaceID = workspaceID
	entry.UserID = userID
	entry.UpdatedAt = time.Now().UTC()
	_, err := s.db.NewInsert().Model(&entry).On("CONFLICT (workspace_id, user_id, entry_id) DO UPDATE").Set("entry_name = EXCLUDED.entry_name, editor_kind = EXCLUDED.editor_kind, device_local = EXCLUDED.device_local, favorite = EXCLUDED.favorite, updated_at = EXCLUDED.updated_at").Exec(ctx)
	return err
}
func BuiltInStyles() []Style {
	styles := make([]Style, 0, 5)
	for _, item := range []struct {
		id, name, context string
		guidance          []string
	}{
		{"clean-demo", "Clean demo", "demo", []string{"Keep the product readable. Use restrained transitions and motion.", "Preserve explanation and avoid obscuring controls."}},
		{"talking-head", "Talking head", "talking head", []string{"Use readable captions and cuts that preserve speech meaning.", "Keep the speaker's face visible."}},
		{"fast-short", "Fast short", "short", []string{"Use concise pacing while preserving qualifications and source meaning.", "Prioritize readable text and deliberate emphasis."}},
		{"calm-explainer", "Calm explainer", "tutorial", []string{"Preserve pauses around explanations. Use restrained captions and motion."}},
		{"announcement", "Product announcement", "announcement", []string{"Make the product name, announcement and call to action clear.", "Use brand assets where available."}},
	} {
		styles = append(styles, Style{ID: "builtin:" + item.id, Version: 1, Name: item.name, EditorKind: "both", Context: item.context, BuiltIn: true, Shared: true, Definition: StyleDefinition{Guidance: item.guidance, Palette: []string{}, Library: []LibraryReference{}, Interpretations: []string{}}, SourceInstruction: fmt.Sprintf("OpenPost %s starting style", item.name)})
	}
	return styles
}

func (s *Service) ArchiveStyle(ctx context.Context, workspaceID, userID, id string, expected int, archived bool) error {
	style, err := s.Style(ctx, workspaceID, userID, id, 0)
	if err != nil || style.BuiltIn {
		return ErrUnavailable
	}
	if style.Version != expected {
		return ErrConflict
	}
	result, err := s.db.NewUpdate().Model((*Style)(nil)).Set("archived = ?", archived).Where("id = ? AND workspace_id = ? AND owner_id = ? AND version = ?", id, workspaceID, style.OwnerID, expected).Where("version = (SELECT MAX(v.version) FROM editor_styles AS v WHERE v.id = style.id)").Exec(ctx)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ErrConflict
	}
	return nil
}

func (s *Service) Preference(ctx context.Context, workspaceID, userID, projectID, id string) (Preference, error) {
	owner := userID
	if projectID != "" {
		owner = ""
	}
	p := Preference{}
	err := s.db.NewSelect().Model(&p).Where("id = ? AND workspace_id = ? AND owner_id = ? AND project_id = ?", id, workspaceID, owner, projectID).Scan(ctx)
	if err != nil {
		return p, ErrUnavailable
	}
	return p, nil
}
