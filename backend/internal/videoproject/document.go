package videoproject

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

const (
	SchemaVersion       = 1
	TicksPerSecond      = int64(1_000_000)
	MaxDurationUS       = int64(2 * 60 * 60 * 1_000_000)
	MaxSources          = 250
	MaxTimelineItems    = 2_000
	MaxCaptionCues      = 5_000
	MaxVisualTracks     = 4
	MaxAudioTracks      = 8
	MaxCaptionTracks    = 2
	MaxDocumentBytes    = 5 * 1024 * 1024
	defaultProjectTitle = "Untitled video"
)

var (
	hexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{3,8}$`)
	sha256Pattern   = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

type Timebase struct {
	TicksPerSecond int64 `json:"ticks_per_second" enum:"1000000"`
	FPSNumerator   int   `json:"fps_numerator" enum:"24,25,30,50,60"`
	FPSDenominator int   `json:"fps_denominator" enum:"1,1001"`
}

type SourceLocator struct {
	Type    string `json:"type" enum:"local-opfs,openpost-media"`
	Path    string `json:"path,omitempty"`
	MediaID string `json:"media_id,omitempty"`
}

type StockMediaProvenance struct {
	Provider        string `json:"provider"`
	ExternalID      string `json:"external_id"`
	SourceURL       string `json:"source_url"`
	CreatorName     string `json:"creator_name"`
	CreatorURL      string `json:"creator_url"`
	LicenseName     string `json:"license_name"`
	LicenseURL      string `json:"license_url"`
	AttributionText string `json:"attribution_text"`
}

type Source struct {
	ID           string                `json:"id"`
	Kind         string                `json:"kind" enum:"video,audio,image,recording-screen,recording-camera,recording-microphone,recording-system-audio"`
	Locator      SourceLocator         `json:"locator"`
	OriginalName string                `json:"original_name"`
	MIMEType     string                `json:"mime_type"`
	SizeBytes    int64                 `json:"size_bytes"`
	DurationUS   int64                 `json:"duration_us"`
	Width        int                   `json:"width"`
	Height       int                   `json:"height"`
	Rotation     int                   `json:"rotation"`
	VideoCodec   string                `json:"video_codec,omitempty"`
	AudioCodec   string                `json:"audio_codec,omitempty"`
	ContentHash  string                `json:"content_hash,omitempty"`
	Provenance   *StockMediaProvenance `json:"provenance,omitempty"`
}

type NumericKeyframe struct {
	TimeUS int64   `json:"time_us"`
	Value  float64 `json:"value"`
	Easing string  `json:"easing" enum:"hold,linear,ease-in,ease-out,ease-in-out,focus-spring"`
}

type CropRectangle struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type VideoPresentation struct {
	PositionX     float64                      `json:"position_x"`
	PositionY     float64                      `json:"position_y"`
	Scale         float64                      `json:"scale"`
	Rotation      float64                      `json:"rotation"`
	Opacity       float64                      `json:"opacity"`
	Crop          CropRectangle                `json:"crop"`
	FlipX         bool                         `json:"flip_x"`
	FlipY         bool                         `json:"flip_y"`
	CornerRadius  float64                      `json:"corner_radius"`
	BorderWidth   float64                      `json:"border_width"`
	BorderColor   string                       `json:"border_color"`
	ShadowBlur    float64                      `json:"shadow_blur"`
	ShadowOpacity float64                      `json:"shadow_opacity"`
	Background    string                       `json:"background_color"`
	Keyframes     map[string][]NumericKeyframe `json:"keyframes,omitempty"`
}

type VideoPresentationOverride struct {
	PositionX     *float64                     `json:"position_x,omitempty"`
	PositionY     *float64                     `json:"position_y,omitempty"`
	Scale         *float64                     `json:"scale,omitempty"`
	Rotation      *float64                     `json:"rotation,omitempty"`
	Opacity       *float64                     `json:"opacity,omitempty"`
	Crop          *CropRectangle               `json:"crop,omitempty"`
	FlipX         *bool                        `json:"flip_x,omitempty"`
	FlipY         *bool                        `json:"flip_y,omitempty"`
	CornerRadius  *float64                     `json:"corner_radius,omitempty"`
	BorderWidth   *float64                     `json:"border_width,omitempty"`
	BorderColor   string                       `json:"border_color,omitempty"`
	ShadowBlur    *float64                     `json:"shadow_blur,omitempty"`
	ShadowOpacity *float64                     `json:"shadow_opacity,omitempty"`
	Background    string                       `json:"background_color,omitempty"`
	Visible       *bool                        `json:"visible,omitempty"`
	Keyframes     map[string][]NumericKeyframe `json:"keyframes,omitempty"`
}

type ClipAudioSettings struct {
	Muted           bool              `json:"muted"`
	GainDB          float64           `json:"gain_db"`
	GainDBKeyframes []NumericKeyframe `json:"gain_db_keyframes,omitempty"`
	FadeInUS        int64             `json:"fade_in_us"`
	FadeOutUS       int64             `json:"fade_out_us"`
	DuckOthers      bool              `json:"duck_others"`
}

type VideoEffect struct {
	Type      string            `json:"type" enum:"exposure,contrast,saturation,temperature,tint,blur,vignette"`
	Value     float64           `json:"value"`
	Keyframes []NumericKeyframe `json:"keyframes,omitempty"`
}

type Transition struct {
	Type       string `json:"type" enum:"cut,cross-dissolve,dip-black,dip-white,slide,push,zoom-blur"`
	DurationUS int64  `json:"duration_us"`
	Easing     string `json:"easing" enum:"hold,linear,ease-in,ease-out,ease-in-out,focus-spring"`
}

type PrimarySequenceClip struct {
	Kind             string                               `json:"kind,omitempty" enum:"clip,gap"`
	ID               string                               `json:"id"`
	DurationUS       int64                                `json:"duration_us,omitempty"`
	SourceID         string                               `json:"source_id"`
	Mode             string                               `json:"mode" enum:"source,freeze"`
	SourceInUS       int64                                `json:"source_in_us"`
	SourceOutUS      int64                                `json:"source_out_us"`
	FreezeDurationUS int64                                `json:"freeze_duration_us,omitempty"`
	Speed            float64                              `json:"speed"`
	Video            VideoPresentation                    `json:"video"`
	Audio            ClipAudioSettings                    `json:"audio"`
	Effects          []VideoEffect                        `json:"effects"`
	TransitionIn     *Transition                          `json:"transition_in,omitempty"`
	TransitionOut    *Transition                          `json:"transition_out,omitempty"`
	VariantOverrides map[string]VideoPresentationOverride `json:"variant_overrides,omitempty"`
}

type VisualTrackItem struct {
	ID               string                                `json:"id"`
	Type             string                                `json:"type" enum:"media,camera,text,shape,annotation"`
	TimelineStartUS  int64                                 `json:"timeline_start_us"`
	DurationUS       int64                                 `json:"duration_us"`
	Visible          bool                                  `json:"visible"`
	SourceID         string                                `json:"source_id,omitempty"`
	SourceInUS       int64                                 `json:"source_in_us,omitempty"`
	Speed            float64                               `json:"speed,omitempty"`
	Text             string                                `json:"text,omitempty"`
	Presentation     VideoPresentation                     `json:"presentation"`
	Style            *TextStyle                            `json:"style,omitempty"`
	Shape            *ShapeStyle                           `json:"shape,omitempty"`
	VariantOverrides map[string]VisualPresentationOverride `json:"variant_overrides,omitempty"`
}

type TextStyle struct {
	FontFamily      string  `json:"font_family"`
	FontSize        float64 `json:"font_size"`
	FontWeight      int     `json:"font_weight"`
	Color           string  `json:"color"`
	Align           string  `json:"align" enum:"left,center,right"`
	BackgroundColor string  `json:"background_color"`
	OutlineColor    string  `json:"outline_color"`
	OutlineWidth    float64 `json:"outline_width"`
	ShadowBlur      float64 `json:"shadow_blur"`
	Animation       string  `json:"animation" enum:"none,fade,rise,pop,typewriter"`
}

type ShapeStyle struct {
	Kind        string  `json:"kind" enum:"rectangle,ellipse,arrow,highlight,click-pulse,redaction,progress"`
	Fill        string  `json:"fill"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"stroke_width"`
	Blur        float64 `json:"blur"`
}

type VisualPresentationOverride struct {
	Visible      *bool                      `json:"visible,omitempty"`
	Presentation *VideoPresentationOverride `json:"presentation,omitempty"`
}

type VisualTrack struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Locked bool              `json:"locked"`
	Hidden bool              `json:"hidden"`
	Items  []VisualTrackItem `json:"items"`
}

type AudioTrackItem struct {
	ID              string            `json:"id"`
	SourceID        string            `json:"source_id"`
	TimelineStartUS int64             `json:"timeline_start_us"`
	SourceInUS      int64             `json:"source_in_us"`
	DurationUS      int64             `json:"duration_us"`
	Speed           float64           `json:"speed"`
	GainDB          float64           `json:"gain_db"`
	GainDBKeyframes []NumericKeyframe `json:"gain_db_keyframes,omitempty"`
	FadeInUS        int64             `json:"fade_in_us"`
	FadeOutUS       int64             `json:"fade_out_us"`
	Muted           bool              `json:"muted"`
	DuckOthers      bool              `json:"duck_others"`
}

type AudioTrack struct {
	ID    string           `json:"id"`
	Name  string           `json:"name"`
	Role  string           `json:"role" enum:"voice,music,system,effects,other"`
	Muted bool             `json:"muted"`
	Items []AudioTrackItem `json:"items"`
}

type CaptionWord struct {
	Text       string   `json:"text"`
	StartUS    int64    `json:"start_us"`
	EndUS      int64    `json:"end_us"`
	Confidence *float64 `json:"confidence,omitempty"`
	Emphasis   bool     `json:"emphasis,omitempty"`
}

type CaptionCue struct {
	ID             string        `json:"id"`
	StartUS        int64         `json:"start_us"`
	EndUS          int64         `json:"end_us"`
	Text           string        `json:"text"`
	Words          []CaptionWord `json:"words"`
	Speaker        string        `json:"speaker,omitempty"`
	ReviewRequired bool          `json:"review_required,omitempty"`
}

type CaptionStyle struct {
	Preset          string `json:"preset" enum:"clean,bold,karaoke,boxed"`
	FontFamily      string `json:"font_family"`
	FontSize        int    `json:"font_size"`
	FontWeight      int    `json:"font_weight"`
	Color           string `json:"color"`
	EmphasisColor   string `json:"emphasis_color"`
	BackgroundColor string `json:"background_color"`
	Position        string `json:"position" enum:"top,middle,bottom"`
	MaxLines        int    `json:"max_lines" minimum:"1" maximum:"3"`
}

type CaptionTrack struct {
	ID               string                          `json:"id"`
	Name             string                          `json:"name"`
	Language         string                          `json:"language"`
	Visible          bool                            `json:"visible"`
	Style            CaptionStyle                    `json:"style"`
	Cues             []CaptionCue                    `json:"cues"`
	VariantOverrides map[string]CaptionStyleOverride `json:"variant_overrides,omitempty"`
}

type CaptionStyleOverride struct {
	Preset          string `json:"preset,omitempty" enum:"clean,bold,karaoke,boxed"`
	FontFamily      string `json:"font_family,omitempty"`
	FontSize        *int   `json:"font_size,omitempty"`
	FontWeight      *int   `json:"font_weight,omitempty"`
	Color           string `json:"color,omitempty"`
	EmphasisColor   string `json:"emphasis_color,omitempty"`
	BackgroundColor string `json:"background_color,omitempty"`
	Position        string `json:"position,omitempty" enum:"top,middle,bottom"`
	MaxLines        *int   `json:"max_lines,omitempty" minimum:"1" maximum:"3"`
}

type VideoVariant struct {
	ID       string `json:"id" enum:"portrait,feed-portrait,square,landscape"`
	Name     string `json:"name"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	SafeArea struct {
		Top    int `json:"top"`
		Right  int `json:"right"`
		Bottom int `json:"bottom"`
		Left   int `json:"left"`
	} `json:"safe_area"`
	BackgroundColor string `json:"background_color"`
}

type TimelineMarker struct {
	ID     string `json:"id"`
	TimeUS int64  `json:"time_us"`
	Label  string `json:"label"`
	Color  string `json:"color"`
}

type ExportFrameRate struct {
	Numerator   int `json:"numerator"`
	Denominator int `json:"denominator"`
}

type ExportDefaults struct {
	VariantIDs            []string        `json:"variant_ids"`
	Format                string          `json:"format" enum:"mp4,webm"`
	VideoCodec            string          `json:"video_codec" enum:"avc,vp9"`
	AudioCodec            string          `json:"audio_codec" enum:"aac,opus"`
	FrameRate             ExportFrameRate `json:"frame_rate"`
	VideoBitrate          int             `json:"video_bitrate"`
	AudioBitrate          int             `json:"audio_bitrate"`
	LoudnessNormalization bool            `json:"loudness_normalization"`
}

type Document struct {
	SchemaVersion   int                   `json:"schema_version"`
	EditingMode     string                `json:"editing_mode,omitempty" enum:"quick-cut,editor"`
	Title           string                `json:"title"`
	Timebase        Timebase              `json:"timebase"`
	Sources         map[string]Source     `json:"sources"`
	PrimarySequence []PrimarySequenceClip `json:"primary_sequence"`
	VisualTracks    []VisualTrack         `json:"visual_tracks"`
	AudioTracks     []AudioTrack          `json:"audio_tracks"`
	CaptionTracks   []CaptionTrack        `json:"caption_tracks"`
	Variants        []VideoVariant        `json:"variants"`
	Markers         []TimelineMarker      `json:"markers"`
	ExportDefaults  ExportDefaults        `json:"export_defaults"`
}

func (d *Document) UnmarshalJSON(data []byte) error {
	type documentAlias Document
	var parsed documentAlias
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&parsed); err != nil {
		return err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return err
	}
	*d = Document(parsed)
	return nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("project document contains trailing JSON values")
		}
		return err
	}
	return nil
}

func (d *Document) Normalize() {
	if d.EditingMode == "studio" {
		d.EditingMode = "editor"
	}
	if d.EditingMode == "" {
		d.EditingMode = "editor"
	}
	d.Title = strings.TrimSpace(d.Title)
	if d.Title == "" {
		d.Title = defaultProjectTitle
	}
	if d.Sources == nil {
		d.Sources = map[string]Source{}
	}
	if d.PrimarySequence == nil {
		d.PrimarySequence = []PrimarySequenceClip{}
	}
	if d.VisualTracks == nil {
		d.VisualTracks = []VisualTrack{}
	}
	if d.AudioTracks == nil {
		d.AudioTracks = []AudioTrack{}
	}
	if d.CaptionTracks == nil {
		d.CaptionTracks = []CaptionTrack{}
	}
	if d.Variants == nil {
		d.Variants = []VideoVariant{}
	}
	if d.Markers == nil {
		d.Markers = []TimelineMarker{}
	}
}

func Validate(document Document, cloud bool) error {
	document.Normalize()
	if err := validateProjectMetadata(document); err != nil {
		return err
	}
	if err := validateSources(document.Sources, cloud); err != nil {
		return err
	}
	if err := validateTrackLimits(document); err != nil {
		return err
	}
	if err := validateTimelineItems(document); err != nil {
		return err
	}
	if err := validateVariants(document.Variants); err != nil {
		return err
	}
	if DurationUS(document) > MaxDurationUS {
		return fmt.Errorf("project duration cannot exceed 2 hours")
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("project cannot be serialized")
	}
	if len(encoded) > MaxDocumentBytes {
		return fmt.Errorf("project document cannot exceed 5 MiB")
	}
	return nil
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateProjectMetadata(document Document) error {
	if document.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported OpenPost Video Editor schema version")
	}
	if !oneOfString(document.EditingMode, "quick-cut", "editor") {
		return fmt.Errorf("project editing mode is invalid")
	}
	if len(document.Title) > 200 {
		return fmt.Errorf("project title cannot exceed 200 characters")
	}
	if document.Timebase.TicksPerSecond != TicksPerSecond {
		return fmt.Errorf("project timebase must use integer microseconds")
	}
	if !oneOfInt(document.Timebase.FPSNumerator, 24, 25, 30, 50, 60) ||
		!oneOfInt(document.Timebase.FPSDenominator, 1, 1001) {
		return fmt.Errorf("project frame rate is not supported")
	}
	if !oneOfString(document.ExportDefaults.Format, "mp4", "webm") ||
		!oneOfString(document.ExportDefaults.VideoCodec, "avc", "vp9") ||
		!oneOfString(document.ExportDefaults.AudioCodec, "aac", "opus") ||
		document.ExportDefaults.VideoBitrate <= 0 || document.ExportDefaults.AudioBitrate <= 0 ||
		!oneOfInt(document.ExportDefaults.FrameRate.Numerator, 24, 25, 30, 50, 60) ||
		!oneOfInt(document.ExportDefaults.FrameRate.Denominator, 1, 1001) {
		return fmt.Errorf("project export defaults are invalid")
	}
	variantIDs := map[string]struct{}{}
	for _, variantID := range document.ExportDefaults.VariantIDs {
		if !oneOfString(variantID, "portrait", "feed-portrait", "square", "landscape") {
			return fmt.Errorf("project export variant is invalid")
		}
		if _, exists := variantIDs[variantID]; exists {
			return fmt.Errorf("project export variants must be unique")
		}
		variantIDs[variantID] = struct{}{}
	}
	return nil
}

func validateSources(sources map[string]Source, cloud bool) error {
	if len(sources) > MaxSources {
		return fmt.Errorf("a project can contain up to %d sources", MaxSources)
	}
	for sourceID, source := range sources {
		if err := validateSource(sourceID, source, cloud); err != nil {
			return err
		}
	}
	return nil
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateSource(sourceID string, source Source, cloud bool) error {
	if strings.TrimSpace(sourceID) == "" || source.ID != sourceID {
		return fmt.Errorf("source keys and IDs must match")
	}
	if source.SizeBytes < 0 || source.DurationUS < 0 || source.DurationUS > MaxDurationUS ||
		source.Width < 0 || source.Height < 0 {
		return fmt.Errorf("source %q metadata is invalid", sourceID)
	}
	if strings.TrimSpace(source.MIMEType) == "" {
		return fmt.Errorf("source %q MIME type is required", sourceID)
	}
	if strings.TrimSpace(source.OriginalName) == "" || len(source.OriginalName) > 500 ||
		!oneOfString(source.Kind,
			"video", "audio", "image", "recording-screen", "recording-camera",
			"recording-microphone", "recording-system-audio") ||
		source.Rotation < -360 || source.Rotation > 360 ||
		(source.ContentHash != "" && !sha256Pattern.MatchString(source.ContentHash)) {
		return fmt.Errorf("source %q metadata is invalid", sourceID)
	}
	switch source.Locator.Type {
	case "local-opfs":
		if strings.TrimSpace(source.Locator.Path) == "" || source.Locator.MediaID != "" {
			return fmt.Errorf("source %q local locator is invalid", sourceID)
		}
	case "openpost-media":
		if strings.TrimSpace(source.Locator.MediaID) == "" || source.Locator.Path != "" {
			return fmt.Errorf("source %q media locator is invalid", sourceID)
		}
	default:
		return fmt.Errorf("source %q locator type is invalid", sourceID)
	}
	if cloud && (source.Locator.Type != "openpost-media" || strings.TrimSpace(source.Locator.MediaID) == "") {
		return fmt.Errorf("cloud projects can reference only synced OpenPost media")
	}
	if source.Provenance != nil {
		return validateProvenance(sourceID, *source.Provenance)
	}
	return nil
}

func validateProvenance(sourceID string, provenance StockMediaProvenance) error {
	if strings.TrimSpace(provenance.Provider) == "" || len(provenance.Provider) > 40 ||
		strings.TrimSpace(provenance.ExternalID) == "" || len(provenance.ExternalID) > 160 ||
		len(provenance.CreatorName) > 300 || len(provenance.AttributionText) > 1_000 ||
		len(provenance.LicenseName) > 200 {
		return fmt.Errorf("source %q stock provenance is invalid", sourceID)
	}
	for _, value := range []string{
		provenance.SourceURL,
		provenance.CreatorURL,
		provenance.LicenseURL,
	} {
		parsed, err := url.Parse(strings.TrimSpace(value))
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return fmt.Errorf("source %q stock provenance URLs must use HTTPS", sourceID)
		}
	}
	return nil
}

// ValidateStockMediaProvenance validates provenance supplied independently of a
// complete project document, such as during a stock-media upload.
func ValidateStockMediaProvenance(provenance StockMediaProvenance) error {
	return validateProvenance("stock import", provenance)
}

func validateTrackLimits(document Document) error {
	if len(document.VisualTracks) > MaxVisualTracks {
		return fmt.Errorf("a project can contain up to four visual overlay tracks")
	}
	if len(document.AudioTracks) > MaxAudioTracks {
		return fmt.Errorf("a project can contain up to eight audio tracks")
	}
	if len(document.CaptionTracks) > MaxCaptionTracks {
		return fmt.Errorf("a project can contain up to two caption tracks")
	}
	return nil
}

func validateTimelineItems(document Document) error {
	itemCount, err := validatePrimaryClips(document)
	if err != nil {
		return err
	}
	visualCount, err := validateVisualItems(document)
	if err != nil {
		return err
	}
	audioCount, err := validateAudioItems(document)
	if err != nil {
		return err
	}
	if itemCount+visualCount+audioCount > MaxTimelineItems {
		return fmt.Errorf("a project can contain up to %d non-caption timeline items", MaxTimelineItems)
	}
	return validateCaptionCues(document.CaptionTracks)
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validatePrimaryClips(document Document) (int, error) {
	clipIDs := map[string]struct{}{}
	for index, clip := range document.PrimarySequence {
		if _, exists := clipIDs[clip.ID]; clip.ID == "" || exists {
			return 0, fmt.Errorf("primary item IDs must be unique")
		}
		clipIDs[clip.ID] = struct{}{}
		if clip.Kind == "gap" {
			if clip.DurationUS <= 0 {
				return 0, fmt.Errorf("primary gaps must have a positive duration")
			}
			continue
		}
		if clip.Kind != "" && clip.Kind != "clip" {
			return 0, fmt.Errorf("primary item kind is invalid")
		}
		if _, exists := document.Sources[clip.SourceID]; !exists {
			return 0, fmt.Errorf("primary clip %q references a missing source", clip.ID)
		}
		if !oneOfString(clip.Mode, "source", "freeze") ||
			clip.SourceInUS < 0 || clip.SourceOutUS < clip.SourceInUS ||
			(clip.Mode == "freeze" && clip.FreezeDurationUS <= 0) {
			return 0, fmt.Errorf("primary clip %q source range is invalid", clip.ID)
		}
		if clip.Speed < 0.25 || clip.Speed > 4 || math.IsNaN(clip.Speed) || math.IsInf(clip.Speed, 0) {
			return 0, fmt.Errorf("clip speed must be between 0.25x and 4x")
		}
		if err := validatePresentation(clip.Video); err != nil {
			return 0, fmt.Errorf("primary clip %q: %w", clip.ID, err)
		}
		if err := validateClipAudio(clip.Audio); err != nil {
			return 0, fmt.Errorf("primary clip %q: %w", clip.ID, err)
		}
		for _, effect := range clip.Effects {
			if !oneOfString(effect.Type,
				"exposure", "contrast", "saturation", "temperature", "tint", "blur", "vignette") ||
				!finiteRange(effect.Value, -100, 100) {
				return 0, fmt.Errorf("primary clip %q effect is invalid", clip.ID)
			}
			if len(effect.Keyframes) > 0 && effect.Type != "blur" {
				return 0, fmt.Errorf("primary clip %q keyframes an unsupported effect", clip.ID)
			}
			if err := validateKeyframes(effect.Keyframes); err != nil {
				return 0, fmt.Errorf("primary clip %q effect keyframes: %w", clip.ID, err)
			}
		}
		if err := validateTransition(clip.TransitionIn); err != nil {
			return 0, fmt.Errorf("primary clip %q transition: %w", clip.ID, err)
		}
		if err := validateTransition(clip.TransitionOut); err != nil {
			return 0, fmt.Errorf("primary clip %q transition: %w", clip.ID, err)
		}
		for variantID, override := range clip.VariantOverrides {
			if !oneOfString(variantID, "portrait", "feed-portrait", "square", "landscape") {
				return 0, fmt.Errorf("primary clip %q variant override is invalid", clip.ID)
			}
			if err := validatePresentationOverride(override); err != nil {
				return 0, fmt.Errorf("primary clip %q variant override: %w", clip.ID, err)
			}
		}
		if clipDurationUS(clip) <= 0 {
			return 0, fmt.Errorf("primary clips must have a positive duration")
		}
		if index > 0 {
			previous := document.PrimarySequence[index-1]
			if previous.Kind != "gap" {
				requested := maxInt64(
					transitionDuration(previous.TransitionOut),
					transitionDuration(clip.TransitionIn),
				)
				maximum := minInt64(clipDurationUS(previous)/2, clipDurationUS(clip)/2)
				if requested > maximum {
					return 0, fmt.Errorf("transition exceeds the adjacent clip overlap")
				}
			}
		}
	}
	return len(document.PrimarySequence), nil
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateVisualItems(document Document) (int, error) {
	count := 0
	trackIDs := map[string]struct{}{}
	itemIDs := map[string]struct{}{}
	for _, track := range document.VisualTracks {
		if _, exists := trackIDs[track.ID]; track.ID == "" || exists || strings.TrimSpace(track.Name) == "" {
			return 0, fmt.Errorf("visual track IDs must be unique and names are required")
		}
		trackIDs[track.ID] = struct{}{}
		count += len(track.Items)
		for _, item := range track.Items {
			if _, exists := itemIDs[item.ID]; item.ID == "" || exists {
				return 0, fmt.Errorf("visual item IDs must be unique")
			}
			itemIDs[item.ID] = struct{}{}
			if item.DurationUS <= 0 || item.TimelineStartUS < 0 {
				return 0, fmt.Errorf("visual timeline ranges must be positive")
			}
			if !oneOfString(item.Type, "media", "camera", "text", "shape", "annotation") {
				return 0, fmt.Errorf("visual item %q type is invalid", item.ID)
			}
			if item.Type == "media" || item.Type == "camera" {
				if _, exists := document.Sources[item.SourceID]; !exists {
					return 0, fmt.Errorf("visual item %q references a missing source", item.ID)
				}
				if item.SourceInUS < 0 || !finiteRange(item.Speed, 0.25, 4) {
					return 0, fmt.Errorf("visual item %q source timing is invalid", item.ID)
				}
			} else if item.SourceID != "" {
				return 0, fmt.Errorf("visual item %q cannot reference a source", item.ID)
			}
			if item.Type == "text" {
				if item.Style == nil || len(item.Text) > 20_000 || !validateTextStyle(*item.Style) {
					return 0, fmt.Errorf("visual text item %q is invalid", item.ID)
				}
			}
			if item.Type == "shape" || item.Type == "annotation" {
				if item.Shape == nil || !validateShapeStyle(*item.Shape) {
					return 0, fmt.Errorf("visual shape item %q is invalid", item.ID)
				}
			}
			if err := validatePresentation(item.Presentation); err != nil {
				return 0, fmt.Errorf("visual item %q: %w", item.ID, err)
			}
			for variantID, override := range item.VariantOverrides {
				if !oneOfString(variantID, "portrait", "feed-portrait", "square", "landscape") {
					return 0, fmt.Errorf("visual item %q variant override is invalid", item.ID)
				}
				if override.Presentation != nil {
					if err := validatePresentationOverride(*override.Presentation); err != nil {
						return 0, fmt.Errorf("visual item %q variant override: %w", item.ID, err)
					}
				}
			}
		}
	}
	return count, nil
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateAudioItems(document Document) (int, error) {
	count := 0
	trackIDs := map[string]struct{}{}
	itemIDs := map[string]struct{}{}
	for _, track := range document.AudioTracks {
		if _, exists := trackIDs[track.ID]; track.ID == "" || exists ||
			strings.TrimSpace(track.Name) == "" ||
			!oneOfString(track.Role, "voice", "music", "system", "effects", "other") {
			return 0, fmt.Errorf("audio track settings are invalid")
		}
		trackIDs[track.ID] = struct{}{}
		count += len(track.Items)
		for _, item := range track.Items {
			if _, exists := itemIDs[item.ID]; item.ID == "" || exists {
				return 0, fmt.Errorf("audio item IDs must be unique")
			}
			itemIDs[item.ID] = struct{}{}
			if _, exists := document.Sources[item.SourceID]; !exists {
				return 0, fmt.Errorf("audio item %q references a missing source", item.ID)
			}
			if item.DurationUS <= 0 || item.TimelineStartUS < 0 {
				return 0, fmt.Errorf("audio timeline ranges must be positive")
			}
			if item.SourceInUS < 0 || !finiteRange(item.Speed, 0.25, 4) ||
				!finiteRange(item.GainDB, -96, 24) ||
				item.FadeInUS < 0 || item.FadeOutUS < 0 ||
				validateKeyframes(item.GainDBKeyframes) != nil {
				return 0, fmt.Errorf("audio item %q settings are invalid", item.ID)
			}
		}
	}
	return count, nil
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateCaptionCues(tracks []CaptionTrack) error {
	count := 0
	trackIDs := map[string]struct{}{}
	cueIDs := map[string]struct{}{}
	for _, track := range tracks {
		if _, exists := trackIDs[track.ID]; track.ID == "" || exists ||
			strings.TrimSpace(track.Name) == "" || strings.TrimSpace(track.Language) == "" ||
			!validateCaptionStyle(track.Style, false) {
			return fmt.Errorf("caption track settings are invalid")
		}
		trackIDs[track.ID] = struct{}{}
		for variantID, override := range track.VariantOverrides {
			if !oneOfString(variantID, "portrait", "feed-portrait", "square", "landscape") ||
				!validateCaptionStyleOverride(override) {
				return fmt.Errorf("caption track variant override is invalid")
			}
		}
		count += len(track.Cues)
		for _, cue := range track.Cues {
			if _, exists := cueIDs[cue.ID]; cue.ID == "" || exists || len(cue.Text) > 20_000 ||
				len(cue.Speaker) > 200 {
				return fmt.Errorf("caption cue is invalid")
			}
			cueIDs[cue.ID] = struct{}{}
			if cue.EndUS <= cue.StartUS || cue.StartUS < 0 {
				return fmt.Errorf("caption cue ranges must be positive")
			}
			for _, word := range cue.Words {
				if strings.TrimSpace(word.Text) == "" || word.EndUS <= word.StartUS ||
					word.StartUS < 0 ||
					(word.Confidence != nil && !finiteRange(*word.Confidence, 0, 1)) {
					return fmt.Errorf("caption word timing or confidence is invalid")
				}
			}
		}
	}
	if count > MaxCaptionCues {
		return fmt.Errorf("a project can contain up to %d caption cues", MaxCaptionCues)
	}
	return nil
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateVariants(variants []VideoVariant) error {
	expected := map[string]bool{
		"portrait": false, "feed-portrait": false, "square": false, "landscape": false,
	}
	for _, variant := range variants {
		seen, valid := expected[variant.ID]
		if !valid || seen {
			return fmt.Errorf("project variants must contain each supported format exactly once")
		}
		if strings.TrimSpace(variant.Name) == "" ||
			variant.Width <= 0 || variant.Width > 1920 ||
			variant.Height <= 0 || variant.Height > 1920 ||
			variant.SafeArea.Top < 0 || variant.SafeArea.Right < 0 ||
			variant.SafeArea.Bottom < 0 || variant.SafeArea.Left < 0 ||
			variant.SafeArea.Left+variant.SafeArea.Right >= variant.Width ||
			variant.SafeArea.Top+variant.SafeArea.Bottom >= variant.Height ||
			!hexColorPattern.MatchString(variant.BackgroundColor) {
			return fmt.Errorf("project variant %q settings are invalid", variant.ID)
		}
		expected[variant.ID] = true
	}
	for _, found := range expected {
		if !found {
			return fmt.Errorf("project must include all four social variants")
		}
	}
	return nil
}

func DurationUS(document Document) int64 {
	var cursor int64
	for index, clip := range document.PrimarySequence {
		duration := primaryItemDurationUS(clip)
		var overlap int64
		if index > 0 && clip.Kind != "gap" {
			previous := document.PrimarySequence[index-1]
			if previous.Kind == "gap" {
				cursor += duration
				continue
			}
			requested := transitionDuration(previous.TransitionOut)
			if current := transitionDuration(clip.TransitionIn); current > requested {
				requested = current
			}
			overlap = minInt64(requested, primaryItemDurationUS(previous)/2, duration/2)
		}
		cursor = maxInt64(0, cursor-overlap) + duration
	}
	end := cursor
	for _, track := range document.VisualTracks {
		for _, item := range track.Items {
			end = maxInt64(end, item.TimelineStartUS+item.DurationUS)
		}
	}
	for _, track := range document.AudioTracks {
		for _, item := range track.Items {
			end = maxInt64(end, item.TimelineStartUS+item.DurationUS)
		}
	}
	for _, track := range document.CaptionTracks {
		for _, cue := range track.Cues {
			end = maxInt64(end, cue.EndUS)
		}
	}
	return end
}

func MediaReferences(document Document) map[string]string {
	result := make(map[string]string, len(document.Sources))
	for _, sourceID := range ReferencedSourceIDs(document) {
		source := document.Sources[sourceID]
		if source.Locator.Type == "openpost-media" && source.Locator.MediaID != "" {
			result[sourceID] = source.Locator.MediaID
		}
	}
	return result
}

func ReferencedSourceIDs(document Document) []string {
	references := map[string]struct{}{}
	for _, item := range document.PrimarySequence {
		if item.Kind != "gap" && item.SourceID != "" {
			references[item.SourceID] = struct{}{}
		}
	}
	for _, track := range document.VisualTracks {
		for _, item := range track.Items {
			if item.SourceID != "" {
				references[item.SourceID] = struct{}{}
			}
		}
	}
	for _, track := range document.AudioTracks {
		for _, item := range track.Items {
			if item.SourceID != "" {
				references[item.SourceID] = struct{}{}
			}
		}
	}
	result := make([]string, 0, len(references))
	for sourceID := range references {
		if _, exists := document.Sources[sourceID]; exists {
			result = append(result, sourceID)
		}
	}
	sort.Strings(result)
	return result
}

func clipDurationUS(clip PrimarySequenceClip) int64 {
	if clip.Mode == "freeze" {
		return clip.FreezeDurationUS
	}
	if clip.Mode != "source" || clip.SourceOutUS <= clip.SourceInUS || clip.Speed <= 0 {
		return 0
	}
	return int64(math.Round(float64(clip.SourceOutUS-clip.SourceInUS) / clip.Speed))
}

func primaryItemDurationUS(item PrimarySequenceClip) int64 {
	if item.Kind == "gap" {
		return item.DurationUS
	}
	return clipDurationUS(item)
}

func transitionDuration(transition *Transition) int64 {
	if transition == nil || transition.DurationUS < 0 {
		return 0
	}
	return transition.DurationUS
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validatePresentation(presentation VideoPresentation) error {
	if !finiteRange(presentation.PositionX, -10, 10) ||
		!finiteRange(presentation.PositionY, -10, 10) ||
		!finiteRange(presentation.Scale, 0.01, 100) ||
		!finiteRange(presentation.Rotation, -36_000, 36_000) ||
		!finiteRange(presentation.Opacity, 0, 1) ||
		!finiteRange(presentation.CornerRadius, 0, 10_000) ||
		!finiteRange(presentation.BorderWidth, 0, 1_000) ||
		!finiteRange(presentation.ShadowBlur, 0, 1_000) ||
		!finiteRange(presentation.ShadowOpacity, 0, 1) ||
		!validCrop(presentation.Crop) ||
		!hexColorPattern.MatchString(presentation.BorderColor) ||
		!hexColorPattern.MatchString(presentation.Background) {
		return fmt.Errorf("video presentation is invalid")
	}
	allowedKeyframes := map[string]bool{
		"position_x": true, "position_y": true, "scale": true, "rotation": true,
		"opacity": true, "crop_x": true, "crop_y": true, "crop_width": true, "crop_height": true,
	}
	for property, keyframes := range presentation.Keyframes {
		if !allowedKeyframes[property] {
			return fmt.Errorf("video presentation keyframe property is invalid")
		}
		if err := validateKeyframes(keyframes); err != nil {
			return err
		}
	}
	return nil
}

func validatePresentationOverride(override VideoPresentationOverride) error {
	for _, candidate := range []struct {
		value        *float64
		minimum, max float64
	}{
		{override.PositionX, -10, 10}, {override.PositionY, -10, 10},
		{override.Scale, 0.01, 100}, {override.Rotation, -36_000, 36_000},
		{override.Opacity, 0, 1}, {override.CornerRadius, 0, 10_000},
		{override.BorderWidth, 0, 1_000}, {override.ShadowBlur, 0, 1_000},
		{override.ShadowOpacity, 0, 1},
	} {
		if candidate.value != nil && !finiteRange(*candidate.value, candidate.minimum, candidate.max) {
			return fmt.Errorf("video presentation override is out of range")
		}
	}
	if override.Crop != nil && !validCrop(*override.Crop) {
		return fmt.Errorf("video presentation crop override is invalid")
	}
	if override.BorderColor != "" && !hexColorPattern.MatchString(override.BorderColor) {
		return fmt.Errorf("video presentation border color is invalid")
	}
	if override.Background != "" && !hexColorPattern.MatchString(override.Background) {
		return fmt.Errorf("video presentation background is invalid")
	}
	allowedKeyframes := map[string]bool{
		"position_x": true, "position_y": true, "scale": true, "rotation": true,
		"opacity": true, "crop_x": true, "crop_y": true, "crop_width": true, "crop_height": true,
	}
	for property, keyframes := range override.Keyframes {
		if !allowedKeyframes[property] {
			return fmt.Errorf("video presentation override keyframe property is invalid")
		}
		if err := validateKeyframes(keyframes); err != nil {
			return err
		}
	}
	return nil
}

func validateClipAudio(audio ClipAudioSettings) error {
	if !finiteRange(audio.GainDB, -96, 24) || audio.FadeInUS < 0 || audio.FadeOutUS < 0 {
		return fmt.Errorf("clip audio settings are invalid")
	}
	return validateKeyframes(audio.GainDBKeyframes)
}

func validateKeyframes(keyframes []NumericKeyframe) error {
	var previous int64 = -1
	for _, keyframe := range keyframes {
		if keyframe.TimeUS <= previous || !finiteRange(keyframe.Value, -1_000_000, 1_000_000) ||
			!oneOfString(keyframe.Easing,
				"hold", "linear", "ease-in", "ease-out", "ease-in-out", "focus-spring") {
			return fmt.Errorf("numeric keyframes are invalid")
		}
		previous = keyframe.TimeUS
	}
	return nil
}

func validateTransition(transition *Transition) error {
	if transition == nil {
		return nil
	}
	if !oneOfString(transition.Type,
		"cut", "cross-dissolve", "dip-black", "dip-white", "slide", "push", "zoom-blur") ||
		transition.DurationUS < 0 ||
		!oneOfString(transition.Easing,
			"hold", "linear", "ease-in", "ease-out", "ease-in-out", "focus-spring") {
		return fmt.Errorf("transition settings are invalid")
	}
	return nil
}

func validateTextStyle(style TextStyle) bool {
	return strings.TrimSpace(style.FontFamily) != "" &&
		finiteRange(style.FontSize, 1, 1_000) &&
		style.FontWeight >= 100 && style.FontWeight <= 1_000 &&
		hexColorPattern.MatchString(style.Color) &&
		hexColorPattern.MatchString(style.BackgroundColor) &&
		hexColorPattern.MatchString(style.OutlineColor) &&
		finiteRange(style.OutlineWidth, 0, 100) &&
		finiteRange(style.ShadowBlur, 0, 1_000) &&
		oneOfString(style.Align, "left", "center", "right") &&
		oneOfString(style.Animation, "none", "fade", "rise", "pop", "typewriter")
}

func validateShapeStyle(style ShapeStyle) bool {
	return oneOfString(style.Kind,
		"rectangle", "ellipse", "arrow", "highlight", "click-pulse", "redaction", "progress") &&
		hexColorPattern.MatchString(style.Fill) &&
		hexColorPattern.MatchString(style.Stroke) &&
		finiteRange(style.StrokeWidth, 0, 1_000) &&
		finiteRange(style.Blur, 0, 1_000)
}

func validateCaptionStyle(style CaptionStyle, _ bool) bool {
	return oneOfString(style.Preset, "clean", "bold", "karaoke", "boxed") &&
		strings.TrimSpace(style.FontFamily) != "" &&
		style.FontSize >= 1 && style.FontSize <= 1_000 &&
		style.FontWeight >= 100 && style.FontWeight <= 1_000 &&
		hexColorPattern.MatchString(style.Color) &&
		hexColorPattern.MatchString(style.EmphasisColor) &&
		hexColorPattern.MatchString(style.BackgroundColor) &&
		oneOfString(style.Position, "top", "middle", "bottom") &&
		style.MaxLines >= 1 && style.MaxLines <= 3
}

//nolint:gocyclo // This is a direct, auditable mirror of the persisted schema constraints.
func validateCaptionStyleOverride(style CaptionStyleOverride) bool {
	return (style.Preset == "" || oneOfString(style.Preset, "clean", "bold", "karaoke", "boxed")) &&
		(style.FontSize == nil || (*style.FontSize >= 1 && *style.FontSize <= 1_000)) &&
		(style.FontWeight == nil || (*style.FontWeight >= 100 && *style.FontWeight <= 1_000)) &&
		(style.Color == "" || hexColorPattern.MatchString(style.Color)) &&
		(style.EmphasisColor == "" || hexColorPattern.MatchString(style.EmphasisColor)) &&
		(style.BackgroundColor == "" || hexColorPattern.MatchString(style.BackgroundColor)) &&
		(style.Position == "" || oneOfString(style.Position, "top", "middle", "bottom")) &&
		(style.MaxLines == nil || (*style.MaxLines >= 1 && *style.MaxLines <= 3))
}

func validCrop(crop CropRectangle) bool {
	return finiteRange(crop.X, 0, 1) && finiteRange(crop.Y, 0, 1) &&
		finiteRange(crop.Width, math.SmallestNonzeroFloat64, 1) &&
		finiteRange(crop.Height, math.SmallestNonzeroFloat64, 1) &&
		crop.X+crop.Width <= 1.000001 && crop.Y+crop.Height <= 1.000001
}

func finiteRange(value, minimum, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= maximum
}

func oneOfInt(value int, allowed ...int) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func oneOfString(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func minInt64(values ...int64) int64 {
	result := values[0]
	for _, value := range values[1:] {
		if value < result {
			result = value
		}
	}
	return result
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
