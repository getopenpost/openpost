package memes

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
)

const builtinCatalogManifest = "catalog/catalog.json"

// builtinCatalogFS holds the exact pinned template snapshot. Keeping assets in
// the Go binary gives hosted and self-hosted installs the same catalog without
// a network dependency or a second asset service.
//
//go:embed catalog
var builtinCatalogFS embed.FS

type builtinManifest struct {
	SchemaVersion    int                       `json:"schema_version"`
	SourceRepository string                    `json:"source_repository"`
	SourceCommit     string                    `json:"source_commit"`
	SourceCommitDate string                    `json:"source_commit_date"`
	TemplateCount    int                       `json:"template_count"`
	Templates        []builtinTemplateManifest `json:"templates"`
}

type builtinTemplateManifest struct {
	ID             string                `json:"id"`
	Name           string                `json:"name"`
	SourceURL      string                `json:"source_url"`
	Keywords       []string              `json:"keywords"`
	Example        []string              `json:"example"`
	Text           []builtinTextField    `json:"text"`
	Overlay        []builtinOverlayField `json:"overlay"`
	Styles         []string              `json:"styles"`
	Assets         []string              `json:"assets"`
	DefaultAsset   string                `json:"default_asset"`
	AnimatedAsset  string                `json:"animated_asset"`
	ThumbnailAsset string                `json:"thumbnail_asset"`
	AssetSHA256    string                `json:"asset_sha256"`
	Semantic       TemplateSemantic      `json:"-"`
}

type builtinTextField struct {
	Style   string  `json:"style"`
	Color   string  `json:"color"`
	Font    string  `json:"font"`
	AnchorX float64 `json:"anchor_x"`
	AnchorY float64 `json:"anchor_y"`
	Angle   float64 `json:"angle"`
	ScaleX  float64 `json:"scale_x"`
	ScaleY  float64 `json:"scale_y"`
	Align   string  `json:"align"`
	Start   float64 `json:"start"`
	Stop    float64 `json:"stop"`
}

type builtinOverlayField struct {
	CenterX float64 `json:"center_x"`
	CenterY float64 `json:"center_y"`
	Angle   float64 `json:"angle"`
	Scale   float64 `json:"scale"`
	Start   float64 `json:"start"`
	Stop    float64 `json:"stop"`
}

type builtinSemanticRecord struct {
	ID           string   `json:"id"`
	Visual       string   `json:"visual"`
	Meaning      string   `json:"meaning"`
	Mechanism    string   `json:"mechanism"`
	CaptionRoles []string `json:"caption_roles"`
	Tags         []string `json:"tags"`
}

// BuiltinProvider renders the pinned OpenPost catalog entirely in-process.
// Its state is immutable after construction and safe for concurrent use.
type BuiltinProvider struct {
	files       fs.FS
	manifest    builtinManifest
	byID        map[string]builtinTemplateManifest
	templates   []Template
	refreshedAt time.Time
	fonts       map[string]*sfnt.Font
}

func NewBuiltinProvider() (*BuiltinProvider, error) {
	data, err := builtinCatalogFS.ReadFile(builtinCatalogManifest)
	if err != nil {
		return nil, fmt.Errorf("load built-in meme catalog: %w", err)
	}
	var manifest builtinManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("decode built-in meme catalog: %w", err)
	}
	if manifest.SchemaVersion != 1 || manifest.TemplateCount != len(manifest.Templates) || len(manifest.Templates) == 0 {
		return nil, fmt.Errorf("built-in meme catalog metadata is invalid")
	}
	refreshedAt, err := time.Parse(time.RFC3339, manifest.SourceCommitDate)
	if err != nil {
		return nil, fmt.Errorf("decode built-in meme catalog date: %w", err)
	}
	semantics, err := loadBuiltinSemantics(builtinCatalogFS)
	if err != nil {
		return nil, err
	}
	fonts, err := loadBuiltinFonts(builtinCatalogFS)
	if err != nil {
		return nil, err
	}

	provider := &BuiltinProvider{
		files: builtinCatalogFS, manifest: manifest,
		byID:        make(map[string]builtinTemplateManifest, len(manifest.Templates)),
		templates:   make([]Template, 0, len(manifest.Templates)),
		refreshedAt: refreshedAt.UTC(), fonts: fonts,
	}
	for _, source := range manifest.Templates {
		if err := validateBuiltinTemplate(source); err != nil {
			return nil, err
		}
		semantic, ok := semantics[source.ID]
		if !ok {
			semantic = fallbackBuiltinSemantic(source)
		}
		if len(semantic.CaptionRoles) != len(source.Text) {
			return nil, fmt.Errorf("built-in meme template %q has mismatched semantic roles", source.ID)
		}
		source.Semantic = semantic
		provider.byID[source.ID] = source
		template := Template{
			ID: source.ID, Name: source.Name, Lines: len(source.Text), Overlays: len(source.Overlay),
			Styles:    append([]string(nil), source.Styles...),
			Example:   TemplateExample{Text: append([]string(nil), source.Example...)},
			SourceURL: source.SourceURL, Keywords: append([]string(nil), source.Keywords...),
			Animated: source.AnimatedAsset != "", Semantic: cloneTemplateSemantic(semantic),
		}
		template.SearchTerms, template.searchText = buildSearchMetadata(template)
		provider.templates = append(provider.templates, template)
	}
	sort.SliceStable(provider.templates, func(left, right int) bool {
		leftName := normalizeSearchValue(provider.templates[left].Name)
		rightName := normalizeSearchValue(provider.templates[right].Name)
		if leftName != rightName {
			return leftName < rightName
		}
		return provider.templates[left].ID < provider.templates[right].ID
	})
	return provider, nil
}

func (p *BuiltinProvider) Key() string { return BuiltinProviderKey }

func (p *BuiltinProvider) Available() bool { return p != nil && len(p.templates) > 0 }

func (p *BuiltinProvider) Health(context.Context) (Health, error) {
	if !p.Available() {
		return Health{}, ErrDisabled
	}
	return Health{
		Available: true, Ready: true, CatalogCached: true,
		TemplateCount: len(p.templates), RefreshedAt: p.refreshedAt,
	}, nil
}

func (p *BuiltinProvider) Templates(context.Context) (Catalog, error) {
	if !p.Available() {
		return Catalog{}, ErrDisabled
	}
	return Catalog{Templates: cloneTemplates(p.templates), RefreshedAt: p.refreshedAt}, nil
}

func (p *BuiltinProvider) Search(_ context.Context, query string, limit int) (Catalog, error) {
	if !p.Available() {
		return Catalog{}, ErrDisabled
	}
	if limit < 1 {
		return Catalog{}, ErrInvalidRequest
	}
	return Catalog{Templates: searchTemplates(p.templates, query, limit), RefreshedAt: p.refreshedAt}, nil
}

func (p *BuiltinProvider) TemplateImage(_ context.Context, templateID string) (RenderedImage, error) {
	template, ok := p.byID[strings.TrimSpace(templateID)]
	if !ok {
		return RenderedImage{}, ErrNotFound
	}
	data, err := fs.ReadFile(p.files, "catalog/"+template.ThumbnailAsset)
	if err != nil {
		return RenderedImage{}, &ProviderError{Kind: ErrorKindInvalidResponse, Operation: "thumbnail", Cause: err}
	}
	return RenderedImage{Data: data, MIMEType: "image/jpeg", Extension: "jpg", TemplateID: template.ID}, nil
}

func loadBuiltinSemantics(files fs.FS) (map[string]TemplateSemantic, error) {
	data, err := fs.ReadFile(files, "catalog/semantics.json")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]TemplateSemantic{}, nil
		}
		return nil, fmt.Errorf("load built-in meme semantics: %w", err)
	}
	var records []builtinSemanticRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("decode built-in meme semantics: %w", err)
	}
	result := make(map[string]TemplateSemantic, len(records))
	for _, record := range records {
		if record.ID == "" || utf8.RuneCountInString(record.Visual) > 180 || utf8.RuneCountInString(record.Meaning) > 220 ||
			len(record.CaptionRoles) == 0 || len(record.Tags) < 2 || len(record.Tags) > 6 {
			return nil, fmt.Errorf("built-in meme semantic record %q is invalid", record.ID)
		}
		if _, exists := result[record.ID]; exists {
			return nil, fmt.Errorf("built-in meme semantic record %q is duplicated", record.ID)
		}
		result[record.ID] = TemplateSemantic{
			Visual: strings.TrimSpace(record.Visual), Meaning: strings.TrimSpace(record.Meaning),
			Mechanism:    strings.TrimSpace(record.Mechanism),
			CaptionRoles: append([]string(nil), record.CaptionRoles...), Tags: append([]string(nil), record.Tags...),
		}
	}
	return result, nil
}

func validateBuiltinTemplate(template builtinTemplateManifest) error {
	if template.ID == "" || template.Name == "" || strings.HasPrefix(template.ID, "_") ||
		len(template.Text) < 1 || len(template.Text) > 16 || template.DefaultAsset == "" || template.ThumbnailAsset == "" {
		return fmt.Errorf("built-in meme template %q is invalid", template.ID)
	}
	for _, field := range template.Text {
		if field.ScaleX <= 0 || field.ScaleY <= 0 || field.ScaleX > 1.5 || field.ScaleY > 1.5 ||
			field.AnchorX < -0.1 || field.AnchorX > 1 || field.AnchorY < -0.1 || field.AnchorY > 1 ||
			field.AnchorX+field.ScaleX > 1.5 || field.AnchorY+field.ScaleY > 1.5 {
			return fmt.Errorf("built-in meme template %q has an invalid caption area", template.ID)
		}
	}
	return nil
}

func loadBuiltinFonts(files fs.FS) (map[string]*sfnt.Font, error) {
	paths := map[string]string{
		"thick":    "TitilliumWeb-Black.ttf",
		"thin":     "TitilliumWeb-SemiBold.ttf",
		"comic":    "Kalam-Regular.ttf",
		"notosans": "NotoSans-Bold.ttf",
		"he":       "NotoSansHebrew-Bold.ttf",
		"impact":   "Impact.ttf",
		"segoe":    "Segoe UI Bold.ttf",
		"jp":       "HG-Mincho-B.ttc",
		"tahoma":   "Tahoma-Bold.ttf",
		"microflf": "MicroFLF-Bold.ttf",
	}
	result := make(map[string]*sfnt.Font, len(paths))
	for name, filename := range paths {
		data, err := fs.ReadFile(files, "catalog/fonts/"+filename)
		if err != nil {
			return nil, fmt.Errorf("load built-in meme font %s: %w", name, err)
		}
		var parsed *sfnt.Font
		if strings.HasSuffix(strings.ToLower(filename), ".ttc") {
			collection, parseErr := opentype.ParseCollection(data)
			if parseErr != nil {
				return nil, fmt.Errorf("parse built-in meme font %s: %w", name, parseErr)
			}
			if collection.NumFonts() == 0 {
				return nil, fmt.Errorf("built-in meme font %s has no fonts", name)
			}
			font, parseErr := collection.Font(0)
			if parseErr != nil {
				return nil, fmt.Errorf("parse built-in meme font %s: %w", name, parseErr)
			}
			parsed = font
		} else {
			parsedFont, parseErr := opentype.Parse(data)
			if parseErr != nil {
				return nil, fmt.Errorf("parse built-in meme font %s: %w", name, parseErr)
			}
			parsed = parsedFont
		}
		result[name] = parsed
	}
	return result, nil
}

func fallbackBuiltinSemantic(template builtinTemplateManifest) TemplateSemantic {
	roles := make([]string, 0, len(template.Text))
	positions := make([]string, 0, len(template.Text))
	for index, field := range template.Text {
		position := builtinFieldPosition(field)
		positions = append(positions, position)
		role := "joke beat in the " + position + " area"
		if index == 0 && len(template.Text) > 1 {
			role = "setup or subject in the " + position + " area"
		} else if index == len(template.Text)-1 && len(template.Text) > 1 {
			role = "payoff or contrast in the " + position + " area"
		}
		roles = append(roles, role)
	}
	mechanism := "reaction"
	if len(template.Text) == 2 {
		mechanism = "setup_payoff"
	} else if len(template.Text) > 2 {
		mechanism = "ordered_visual_sequence"
	}
	tags := make([]string, 0, 6)
	for _, value := range append(append([]string(nil), template.Keywords...), strings.Fields(normalizeSearchValue(template.Name))...) {
		value = normalizeSearchValue(value)
		if value == "" || containsString(tags, value) {
			continue
		}
		tags = append(tags, value)
		if len(tags) == 6 {
			break
		}
	}
	for len(tags) < 2 {
		tags = append(tags, []string{"reaction", "comparison"}[len(tags)])
	}
	return TemplateSemantic{
		Visual:    fmt.Sprintf("%s, with caption areas at %s.", template.Name, strings.Join(positions, ", ")),
		Meaning:   fmt.Sprintf("Use the familiar %s format as an ordered visual joke; keep each line tied to its pictured area.", template.Name),
		Mechanism: mechanism, CaptionRoles: roles, Tags: tags,
	}
}

func builtinFieldPosition(field builtinTextField) string {
	vertical := "middle"
	if field.AnchorY < 0.3 {
		vertical = "upper"
	} else if field.AnchorY >= 0.62 {
		vertical = "lower"
	}
	horizontal := "center"
	if field.AnchorX < 0.22 && field.ScaleX < 0.75 {
		horizontal = "left"
	} else if field.AnchorX >= 0.55 {
		horizontal = "right"
	}
	return vertical + "-" + horizontal
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func cloneTemplateSemantic(source TemplateSemantic) TemplateSemantic {
	source.CaptionRoles = append([]string(nil), source.CaptionRoles...)
	source.Tags = append([]string(nil), source.Tags...)
	return source
}
