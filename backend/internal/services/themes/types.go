// Package themes owns Organization theme manifests, immutable publication,
// Workspace inheritance, and complete runtime resolution.
package themes

import (
	"errors"
	"time"
)

const (
	ManifestSchemaVersion = 1
)

var (
	ErrUnavailable       = errors.New("themes are unavailable")
	ErrInvalidInput      = errors.New("invalid theme input")
	ErrInvalidManifest   = errors.New("invalid theme manifest")
	ErrNotFound          = errors.New("theme not found")
	ErrInaccessible      = errors.New("theme is inaccessible")
	ErrConflict          = errors.New("theme conflicts with existing state")
	ErrRevisionConflict  = errors.New("theme revision changed")
	ErrAssignmentLocked  = errors.New("workspace theme assignment is locked")
	ErrThemeInUse        = errors.New("theme is assigned or is the organization default")
	ErrUnsupportedScheme = errors.New("theme does not support the requested color scheme")
	ErrInvalidAsset      = errors.New("invalid theme asset")
)

type ColorScheme string

const (
	SchemeLight ColorScheme = "light"
	SchemeDark  ColorScheme = "dark"
)

type ReferenceKind string

const (
	ReferenceBuiltIn ReferenceKind = "built_in"
	ReferenceCustom  ReferenceKind = "custom"
)

type ThemeReference struct {
	Kind    ReferenceKind `json:"kind" enum:"built_in,custom"`
	ID      string        `json:"id"`
	Version int           `json:"version" minimum:"1"`
}

type ThemeColorTokens struct {
	Brand                   string `json:"brand"`
	BrandInk                string `json:"brandInk"`
	Workspace               string `json:"workspace"`
	WorkspaceInk            string `json:"workspaceInk"`
	Canvas                  string `json:"canvas"`
	Ink                     string `json:"ink"`
	Surface                 string `json:"surface"`
	SurfaceRaised           string `json:"surfaceRaised"`
	SurfaceSunken           string `json:"surfaceSunken"`
	MutedInk                string `json:"mutedInk"`
	Border                  string `json:"border"`
	Input                   string `json:"input"`
	Focus                   string `json:"focus"`
	Selection               string `json:"selection"`
	SelectionInk            string `json:"selectionInk"`
	Caret                   string `json:"caret"`
	Link                    string `json:"link"`
	Danger                  string `json:"danger"`
	DangerInk               string `json:"dangerInk"`
	Success                 string `json:"success"`
	SuccessInk              string `json:"successInk"`
	Warning                 string `json:"warning"`
	WarningInk              string `json:"warningInk"`
	Info                    string `json:"info"`
	InfoInk                 string `json:"infoInk"`
	ActionFocal             string `json:"actionFocal"`
	ActionFocalInk          string `json:"actionFocalInk"`
	ActionFocalHover        string `json:"actionFocalHover"`
	ActionFocalActive       string `json:"actionFocalActive"`
	ActionPrimary           string `json:"actionPrimary"`
	ActionPrimaryInk        string `json:"actionPrimaryInk"`
	ActionPrimaryHover      string `json:"actionPrimaryHover"`
	ActionPrimaryActive     string `json:"actionPrimaryActive"`
	ActionOrdinary          string `json:"actionOrdinary"`
	ActionOrdinaryInk       string `json:"actionOrdinaryInk"`
	ActionOrdinaryBorder    string `json:"actionOrdinaryBorder"`
	ActionOrdinaryHover     string `json:"actionOrdinaryHover"`
	ActionOrdinaryActive    string `json:"actionOrdinaryActive"`
	ActionQuiet             string `json:"actionQuiet"`
	ActionQuietInk          string `json:"actionQuietInk"`
	ActionQuietHover        string `json:"actionQuietHover"`
	ActionQuietActive       string `json:"actionQuietActive"`
	ActionDestructive       string `json:"actionDestructive"`
	ActionDestructiveInk    string `json:"actionDestructiveInk"`
	ActionDestructiveHover  string `json:"actionDestructiveHover"`
	ActionDestructiveActive string `json:"actionDestructiveActive"`
	ActionLink              string `json:"actionLink"`
	ActionLinkHover         string `json:"actionLinkHover"`
	Disabled                string `json:"disabled"`
	DisabledInk             string `json:"disabledInk"`
	Field                   string `json:"field"`
	FieldInk                string `json:"fieldInk"`
	FieldBorder             string `json:"fieldBorder"`
	FieldHover              string `json:"fieldHover"`
	FieldFocus              string `json:"fieldFocus"`
	FieldDisabled           string `json:"fieldDisabled"`
	FieldDisabledInk        string `json:"fieldDisabledInk"`
	CardHover               string `json:"cardHover"`
	NavigationHover         string `json:"navigationHover"`
	NavigationActive        string `json:"navigationActive"`
	NavigationActiveInk     string `json:"navigationActiveInk"`
	Sidebar                 string `json:"sidebar"`
	SidebarInk              string `json:"sidebarInk"`
	SidebarActive           string `json:"sidebarActive"`
	SidebarActiveInk        string `json:"sidebarActiveInk"`
	SidebarBorder           string `json:"sidebarBorder"`
	Chrome                  string `json:"chrome"`
	ChromeInk               string `json:"chromeInk"`
	BrowserSurface          string `json:"browserSurface"`
	BrowserChrome           string `json:"browserChrome"`
	Overlay                 string `json:"overlay"`
	Scrim                   string `json:"scrim"`
	Chart1                  string `json:"chart1"`
	Chart2                  string `json:"chart2"`
	Chart3                  string `json:"chart3"`
	Chart4                  string `json:"chart4"`
	Chart5                  string `json:"chart5"`
}

type ThemeProtectedEditorTokens struct {
	EditorCanvas       string `json:"editorCanvas"`
	EditorPanel        string `json:"editorPanel"`
	EditorControl      string `json:"editorControl"`
	EditorControlHover string `json:"editorControlHover"`
	EditorBorder       string `json:"editorBorder"`
	EditorMuted        string `json:"editorMuted"`
	EditorText         string `json:"editorText"`
	EditorFocus        string `json:"editorFocus"`
	EditorFocusBorder  string `json:"editorFocusBorder"`
	TimelineTrack      string `json:"timelineTrack"`
	TimelineClip       string `json:"timelineClip"`
	TimelineWaveform   string `json:"timelineWaveform"`
	TimelinePlayhead   string `json:"timelinePlayhead"`
	TimelineSelection  string `json:"timelineSelection"`
	CanvasPasteboard   string `json:"canvasPasteboard"`
	CanvasGrid         string `json:"canvasGrid"`
	CanvasHandle       string `json:"canvasHandle"`
	CanvasSelection    string `json:"canvasSelection"`
	CanvasSafeArea     string `json:"canvasSafeArea"`
	ProtectedGlyph     string `json:"protectedGlyph"`
}

type ThemeTypographyRoleTokens struct {
	Family     string   `json:"family"`
	Fallbacks  []string `json:"fallbacks" nullable:"false"`
	Weight     int      `json:"weight" minimum:"100" maximum:"900"`
	Size       string   `json:"size"`
	LineHeight string   `json:"lineHeight"`
	Tracking   string   `json:"tracking"`
}

type ThemeTypographyTokens struct {
	Display  ThemeTypographyRoleTokens `json:"display"`
	Title    ThemeTypographyRoleTokens `json:"title"`
	Body     ThemeTypographyRoleTokens `json:"body"`
	Label    ThemeTypographyRoleTokens `json:"label"`
	Metadata ThemeTypographyRoleTokens `json:"metadata"`
	Code     ThemeTypographyRoleTokens `json:"code"`
}

type ThemeSpacingTokens struct {
	Density              string `json:"density" enum:"compact,comfortable,spacious"`
	Base                 string `json:"base"`
	ControlHeight        string `json:"controlHeight"`
	CompactControlHeight string `json:"compactControlHeight"`
	TouchTarget          string `json:"touchTarget"`
	PageGutter           string `json:"pageGutter"`
	SectionGap           string `json:"sectionGap"`
	ComponentGap         string `json:"componentGap"`
}

type ThemeCornerTokens struct {
	Radius      string `json:"radius"`
	RadiusSM    string `json:"radiusSm"`
	RadiusMD    string `json:"radiusMd"`
	RadiusLG    string `json:"radiusLg"`
	RadiusMedia string `json:"radiusMedia"`
	RadiusPill  string `json:"radiusPill"`
	BorderWidth string `json:"borderWidth"`
	BorderStyle string `json:"borderStyle" enum:"solid,dashed"`
}

type ThemeElevationTokens struct {
	Card        string `json:"card"`
	Popover     string `json:"popover"`
	Dialog      string `json:"dialog"`
	FocalAction string `json:"focalAction"`
}

type ThemeMotionRecipe struct {
	Duration string  `json:"duration"`
	Easing   string  `json:"easing"`
	Distance string  `json:"distance"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
}

type ThemeMotionTokens struct {
	Press          ThemeMotionRecipe `json:"press"`
	Hover          ThemeMotionRecipe `json:"hover"`
	Selection      ThemeMotionRecipe `json:"selection"`
	Entry          ThemeMotionRecipe `json:"entry"`
	Exit           ThemeMotionRecipe `json:"exit"`
	Loading        ThemeMotionRecipe `json:"loading"`
	PageTransition ThemeMotionRecipe `json:"pageTransition"`
	ReducedMotion  string            `json:"reducedMotion" enum:"instant,crossfade"`
}

type ThemeShellTokens struct {
	ContentMaxWidth        string `json:"contentMaxWidth"`
	SidebarWidth           string `json:"sidebarWidth"`
	HeaderHeight           string `json:"headerHeight"`
	MobileNavigationHeight string `json:"mobileNavigationHeight"`
	CanvasTreatment        string `json:"canvasTreatment" enum:"plain,paper,playful,garden,study,tactile,precision"`
}

type ThemeComponentRecipes struct {
	Button       string `json:"button" enum:"solid,tonal,outlined,precise,pill"`
	Link         string `json:"link" enum:"underlined,subtle,plain"`
	Tabs         string `json:"tabs" enum:"underline,pill,segmented"`
	Navigation   string `json:"navigation" enum:"quiet,tonal,outlined"`
	Input        string `json:"input" enum:"filled,outlined,underlined"`
	Select       string `json:"select" enum:"filled,outlined,underlined"`
	Card         string `json:"card" enum:"flat,outlined,paper,lifted"`
	Container    string `json:"container" enum:"flat,outlined,tinted"`
	Table        string `json:"table" enum:"ruled,striped,plain"`
	List         string `json:"list" enum:"divided,spaced,plain"`
	Badge        string `json:"badge" enum:"solid,tonal,outlined"`
	Chip         string `json:"chip" enum:"solid,tonal,outlined"`
	Dialog       string `json:"dialog" enum:"flat,outlined,elevated"`
	Popover      string `json:"popover" enum:"flat,outlined,elevated"`
	Toast        string `json:"toast" enum:"flat,outlined,elevated"`
	Switch       string `json:"switch" enum:"solid,tonal,outlined"`
	Checkbox     string `json:"checkbox" enum:"solid,tonal,outlined"`
	Radio        string `json:"radio" enum:"solid,tonal,outlined"`
	Toolbar      string `json:"toolbar" enum:"flat,outlined,floating"`
	Pagination   string `json:"pagination" enum:"quiet,outlined,pill"`
	EmptyState   string `json:"emptyState" enum:"plain,illustrated,framed"`
	LoadingState string `json:"loadingState" enum:"spinner,pulse,skeleton"`
	EditorChrome string `json:"editorChrome" enum:"neutral,compact,precision"`
	Decoration   string `json:"decoration" enum:"none,editorial,playful,botanical,study,tactile,precision"`
}

type ThemeSchemeManifest struct {
	Colors          ThemeColorTokens           `json:"colors"`
	ProtectedEditor ThemeProtectedEditorTokens `json:"protectedEditor"`
	Typography      ThemeTypographyTokens      `json:"typography"`
	Spacing         ThemeSpacingTokens         `json:"spacing"`
	Shape           ThemeCornerTokens          `json:"shape"`
	Elevation       ThemeElevationTokens       `json:"elevation"`
	Motion          ThemeMotionTokens          `json:"motion"`
	Shell           ThemeShellTokens           `json:"shell"`
	Components      ThemeComponentRecipes      `json:"components"`
}

type IconPack string

const (
	IconLucide           IconPack = "lucide"
	IconHeroiconsOutline IconPack = "heroicons-outline"
	IconHeroiconsSolid   IconPack = "heroicons-solid"
	IconPhosphor         IconPack = "phosphor"
	IconTabler           IconPack = "tabler"
)

type ThemeFontFace struct {
	ID        string `json:"id"`
	Family    string `json:"family"`
	SourceURL string `json:"sourceUrl"`
	Format    string `json:"format" enum:"woff2"`
	Weight    int    `json:"weight" minimum:"100" maximum:"900"`
	Style     string `json:"style" enum:"normal,italic"`
	Display   string `json:"display" enum:"swap,fallback,optional"`
}

type NativeFontDerivative struct {
	SourceURL string `json:"sourceUrl"`
	Format    string `json:"format" enum:"ttf,otf"`
	Identity  string `json:"identity"`
}

// ThemeRuntimeFontFace is the resolved font contract. Stored manifests use
// ThemeFontFace and cannot provide server-owned native derivatives.
type ThemeRuntimeFontFace struct {
	ID               string               `json:"id"`
	Family           string               `json:"family"`
	SourceURL        string               `json:"sourceUrl"`
	Format           string               `json:"format" enum:"woff2"`
	Weight           int                  `json:"weight" minimum:"100" maximum:"900"`
	Style            string               `json:"style" enum:"normal,italic"`
	Display          string               `json:"display" enum:"swap,fallback,optional"`
	NativeDerivative NativeFontDerivative `json:"nativeDerivative"`
}

type ThemeAsset struct {
	ID        string `json:"id"`
	Slot      string `json:"slot" enum:"background-texture,sidebar-decoration,header-decoration,empty-state-illustration,loading-illustration"`
	SourceURL string `json:"sourceUrl"`
	MimeType  string `json:"mimeType" enum:"image/png,image/jpeg,image/webp,image/avif"`
	Alt       string `json:"alt,omitempty"`
}

type ThemeSchemes struct {
	Light *ThemeSchemeManifest `json:"light,omitempty"`
	Dark  *ThemeSchemeManifest `json:"dark,omitempty"`
}

func (s ThemeSchemes) For(scheme ColorScheme) *ThemeSchemeManifest {
	if scheme == SchemeDark {
		return s.Dark
	}
	return s.Light
}

type ThemeManifest struct {
	SchemaVersion    int             `json:"schemaVersion" enum:"1"`
	ID               string          `json:"id"`
	Revision         string          `json:"revision"`
	Name             string          `json:"name"`
	Description      string          `json:"description"`
	IconPack         IconPack        `json:"iconPack" enum:"lucide,heroicons-outline,heroicons-solid,phosphor,tabler"`
	SupportedSchemes []ColorScheme   `json:"supportedSchemes" enum:"light,dark" nullable:"false"`
	Schemes          ThemeSchemes    `json:"schemes"`
	Fonts            []ThemeFontFace `json:"fonts" nullable:"false"`
	Assets           []ThemeAsset    `json:"assets" nullable:"false"`
}

// ThemeRuntimeManifest is the published preview contract. It mirrors the
// stored family manifest but enriches font resources with server-owned native
// derivatives for mobile.
type ThemeRuntimeManifest struct {
	SchemaVersion    int                    `json:"schemaVersion" enum:"1"`
	ID               string                 `json:"id"`
	Revision         string                 `json:"revision"`
	Name             string                 `json:"name"`
	Description      string                 `json:"description"`
	IconPack         IconPack               `json:"iconPack" enum:"lucide,heroicons-outline,heroicons-solid,phosphor,tabler"`
	SupportedSchemes []ColorScheme          `json:"supportedSchemes" enum:"light,dark" nullable:"false"`
	Schemes          ThemeSchemes           `json:"schemes"`
	Fonts            []ThemeRuntimeFontFace `json:"fonts" nullable:"false"`
	Assets           []ThemeAsset           `json:"assets" nullable:"false"`
}

type BuiltInFamily = ThemeManifest
type SchemeManifests = ThemeSchemes

type PublishedRevision struct {
	ThemeID        string        `json:"theme_id"`
	Revision       int           `json:"revision"`
	SourceRevision *int          `json:"source_revision,omitempty"`
	Manifest       ThemeManifest `json:"manifest"`
	PublishedBy    string        `json:"published_by"`
	PublishedAt    time.Time     `json:"published_at"`
}

type PublishedRevisionPage struct {
	Items      []PublishedRevision `json:"items" nullable:"false"`
	NextCursor string              `json:"next_cursor,omitempty"`
}

type ThemeSummary struct {
	Reference              ThemeReference `json:"reference"`
	OrganizationID         string         `json:"organization_id,omitempty"`
	Name                   string         `json:"name"`
	Description            string         `json:"description"`
	IconPack               IconPack       `json:"icon_pack" enum:"lucide,heroicons-outline,heroicons-solid,phosphor,tabler"`
	BuiltIn                bool           `json:"built_in"`
	DraftRevision          int            `json:"draft_revision,omitempty"`
	PublishedRevision      int            `json:"published_revision,omitempty"`
	SupportedSchemes       []ColorScheme  `json:"supported_schemes" enum:"light,dark" nullable:"false"`
	IsOrganizationDefault  bool           `json:"is_organization_default"`
	AssignedWorkspaceCount int            `json:"assigned_workspace_count"`
	CreatedAt              time.Time      `json:"created_at,omitempty"`
	UpdatedAt              time.Time      `json:"updated_at,omitempty"`
}

type ThemeSummaryPage struct {
	Items      []ThemeSummary `json:"items" nullable:"false"`
	NextCursor string         `json:"next_cursor,omitempty"`
}

type Theme struct {
	Summary ThemeSummary       `json:"summary"`
	Draft   *ThemeDraft        `json:"draft,omitempty"`
	Latest  *PublishedRevision `json:"latest_published,omitempty"`
}

type PublishedThemeCatalogItem struct {
	Summary  ThemeSummary         `json:"summary"`
	Manifest ThemeRuntimeManifest `json:"manifest"`
}

type ThemeDraft struct {
	ThemeID   string        `json:"theme_id"`
	Revision  int           `json:"revision"`
	Manifest  ThemeManifest `json:"manifest"`
	UpdatedBy string        `json:"updated_by"`
	UpdatedAt time.Time     `json:"updated_at"`
}

type Selection struct {
	OrganizationID string         `json:"organization_id"`
	WorkspaceID    string         `json:"workspace_id"`
	Reference      ThemeReference `json:"reference"`
	Locked         bool           `json:"locked"`
	Inherited      bool           `json:"inherited"`
}

type FallbackReason string

// Several distinct failure modes share the "missing-theme" wire string on
// purpose: resolving a theme must not reveal whether an inaccessible
// reference is missing, unpublished, or forbidden (non-enumeration). The
// internal enum keeps the distinction for server logs and metrics.
const (
	FallbackNone              FallbackReason = ""
	FallbackMissing           FallbackReason = "missing-theme"
	FallbackUnpublished       FallbackReason = "missing-theme"
	FallbackInaccessible      FallbackReason = "missing-theme"
	FallbackInvalidReference  FallbackReason = "missing-theme"
	FallbackInvalidManifest   FallbackReason = "invalid-manifest"
	FallbackUnsafeResource    FallbackReason = "unsafe-resource"
	FallbackUnsupportedScheme FallbackReason = "unsupported-scheme"
	FallbackResourceFailed    FallbackReason = "resource-failed"
)

type ResolutionSource string

const (
	ResolutionBuiltIn      ResolutionSource = "builtin"
	ResolutionOrganization ResolutionSource = "organization"
	ResolutionFallback     ResolutionSource = "fallback"
)

type ResolvedTheme struct {
	ID              string                 `json:"id"`
	Revision        string                 `json:"revision"`
	Name            string                 `json:"name"`
	IconPack        IconPack               `json:"iconPack" enum:"lucide,heroicons-outline,heroicons-solid,phosphor,tabler"`
	Source          ResolutionSource       `json:"source" enum:"builtin,organization,fallback"`
	RequestedScheme ColorScheme            `json:"requestedScheme" enum:"light,dark"`
	Scheme          ColorScheme            `json:"scheme" enum:"light,dark"`
	Manifest        ThemeSchemeManifest    `json:"manifest"`
	Fonts           []ThemeRuntimeFontFace `json:"fonts" nullable:"false"`
	Assets          []ThemeAsset           `json:"assets" nullable:"false"`
	FallbackReason  FallbackReason         `json:"fallbackReason,omitempty" enum:"missing-theme,invalid-manifest,unsafe-resource,unsupported-scheme,resource-failed"`
	CacheIdentity   string                 `json:"-"`
	organizationID  string
}

type ThemeSettings struct {
	OrganizationID        string          `json:"organization_id"`
	WorkspaceID           string          `json:"workspace_id"`
	OrganizationDefault   ThemeReference  `json:"organization_default"`
	WorkspaceSelection    *ThemeReference `json:"workspace_selection,omitempty"`
	AssignmentsLocked     bool            `json:"assignments_locked"`
	EffectiveSelection    ThemeReference  `json:"effective_selection"`
	CanManageWorkspace    bool            `json:"can_manage_workspace"`
	CanManageOrganization bool            `json:"can_manage_organization"`
}

type OrganizationThemeSettings struct {
	OrganizationID    string         `json:"organization_id"`
	DefaultReference  ThemeReference `json:"default_reference"`
	AssignmentsLocked bool           `json:"assignments_locked"`
}

type ThemeAssetKind string

const (
	AssetFont         ThemeAssetKind = "font"
	AssetBackground   ThemeAssetKind = "background"
	AssetTexture      ThemeAssetKind = "texture"
	AssetIllustration ThemeAssetKind = "illustration"
)

type ThemeAssetRecord struct {
	ID                  string         `json:"id"`
	OrganizationID      string         `json:"organization_id"`
	Kind                ThemeAssetKind `json:"kind" enum:"font,background,texture,illustration"`
	Name                string         `json:"name"`
	MediaType           string         `json:"media_type" enum:"font/woff2,image/png,image/jpeg,image/webp,image/avif"`
	ObjectKey           string         `json:"-"`
	URL                 string         `json:"url,omitempty"`
	SizeBytes           int64          `json:"size_bytes"`
	Width               int            `json:"width,omitempty"`
	Height              int            `json:"height,omitempty"`
	ChecksumSHA256      string         `json:"checksum_sha256"`
	FontFamily          string         `json:"font_family,omitempty"`
	FontStyle           string         `json:"font_style,omitempty" enum:"normal,italic"`
	FontWeight          int            `json:"font_weight,omitempty"`
	LicenseAcknowledged bool           `json:"license_acknowledged,omitempty"`
	CreatedBy           string         `json:"created_by"`
	CreatedAt           time.Time      `json:"created_at"`
}

type ThemeAssetPage struct {
	Items      []ThemeAssetRecord `json:"items" nullable:"false"`
	NextCursor string             `json:"next_cursor,omitempty"`
}
