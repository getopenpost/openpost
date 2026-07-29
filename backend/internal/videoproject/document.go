package videoproject

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
)

const (
	SchemaVersion       = 1
	TicksPerSecond      = int64(1_000_000)
	MaxDurationUS       = int64(20 * 60 * 1_000_000)
	MaxSources          = 250
	MaxTimelineItems    = 2_000
	MaxCaptionCues      = 5_000
	MaxVisualTracks     = 4
	MaxAudioTracks      = 8
	MaxCaptionTracks    = 2
	MaxDocumentBytes    = 5 * 1024 * 1024
	defaultProjectTitle = "Untitled video"
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
	Muted      bool    `json:"muted"`
	GainDB     float64 `json:"gain_db"`
	FadeInUS   int64   `json:"fade_in_us"`
	FadeOutUS  int64   `json:"fade_out_us"`
	DuckOthers bool    `json:"duck_others"`
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
	ID               string                               `json:"id"`
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
	ID               string                    `json:"id"`
	Type             string                    `json:"type" enum:"media,camera,text,shape,annotation"`
	TimelineStartUS  int64                     `json:"timeline_start_us"`
	DurationUS       int64                     `json:"duration_us"`
	Visible          bool                      `json:"visible"`
	SourceID         string                    `json:"source_id,omitempty"`
	SourceInUS       int64                     `json:"source_in_us,omitempty"`
	Speed            float64                   `json:"speed,omitempty"`
	Text             string                    `json:"text,omitempty"`
	Presentation     VideoPresentation         `json:"presentation"`
	Style            map[string]any            `json:"style,omitempty"`
	Shape            map[string]any            `json:"shape,omitempty"`
	VariantOverrides map[string]map[string]any `json:"variant_overrides,omitempty"`
}

type VisualTrack struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Locked bool              `json:"locked"`
	Hidden bool              `json:"hidden"`
	Items  []VisualTrackItem `json:"items"`
}

type AudioTrackItem struct {
	ID              string  `json:"id"`
	SourceID        string  `json:"source_id"`
	TimelineStartUS int64   `json:"timeline_start_us"`
	SourceInUS      int64   `json:"source_in_us"`
	DurationUS      int64   `json:"duration_us"`
	Speed           float64 `json:"speed"`
	GainDB          float64 `json:"gain_db"`
	FadeInUS        int64   `json:"fade_in_us"`
	FadeOutUS       int64   `json:"fade_out_us"`
	Muted           bool    `json:"muted"`
	DuckOthers      bool    `json:"duck_others"`
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
	ID               string                    `json:"id"`
	Name             string                    `json:"name"`
	Language         string                    `json:"language"`
	Visible          bool                      `json:"visible"`
	Style            CaptionStyle              `json:"style"`
	Cues             []CaptionCue              `json:"cues"`
	VariantOverrides map[string]map[string]any `json:"variant_overrides,omitempty"`
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

type ExportDefaults struct {
	VariantIDs []string `json:"variant_ids"`
	Format     string   `json:"format" enum:"mp4,webm"`
	VideoCodec string   `json:"video_codec" enum:"avc,vp9"`
	AudioCodec string   `json:"audio_codec" enum:"aac,opus"`
	FrameRate  struct {
		Numerator   int `json:"numerator"`
		Denominator int `json:"denominator"`
	} `json:"frame_rate"`
	VideoBitrate          int  `json:"video_bitrate"`
	AudioBitrate          int  `json:"audio_bitrate"`
	LoudnessNormalization bool `json:"loudness_normalization"`
}

type Document struct {
	SchemaVersion   int                   `json:"schema_version"`
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

func (d *Document) Normalize() {
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
		return fmt.Errorf("project duration cannot exceed 20 minutes")
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

func validateProjectMetadata(document Document) error {
	if document.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported Video Studio schema version")
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

func validatePrimaryClips(document Document) (int, error) {
	clipIDs := map[string]struct{}{}
	for _, clip := range document.PrimarySequence {
		if _, exists := clipIDs[clip.ID]; clip.ID == "" || exists {
			return 0, fmt.Errorf("primary clip IDs must be unique")
		}
		clipIDs[clip.ID] = struct{}{}
		if _, exists := document.Sources[clip.SourceID]; !exists {
			return 0, fmt.Errorf("primary clip %q references a missing source", clip.ID)
		}
		if clip.Speed < 0.25 || clip.Speed > 4 || math.IsNaN(clip.Speed) || math.IsInf(clip.Speed, 0) {
			return 0, fmt.Errorf("clip speed must be between 0.25x and 4x")
		}
		if clipDurationUS(clip) <= 0 {
			return 0, fmt.Errorf("primary clips must have a positive duration")
		}
	}
	return len(document.PrimarySequence), nil
}

func validateVisualItems(document Document) (int, error) {
	count := 0
	for _, track := range document.VisualTracks {
		count += len(track.Items)
		for _, item := range track.Items {
			if item.DurationUS <= 0 || item.TimelineStartUS < 0 {
				return 0, fmt.Errorf("visual timeline ranges must be positive")
			}
			if item.SourceID != "" {
				if _, exists := document.Sources[item.SourceID]; !exists {
					return 0, fmt.Errorf("visual item %q references a missing source", item.ID)
				}
			}
		}
	}
	return count, nil
}

func validateAudioItems(document Document) (int, error) {
	count := 0
	for _, track := range document.AudioTracks {
		count += len(track.Items)
		for _, item := range track.Items {
			if _, exists := document.Sources[item.SourceID]; !exists {
				return 0, fmt.Errorf("audio item %q references a missing source", item.ID)
			}
			if item.DurationUS <= 0 || item.TimelineStartUS < 0 {
				return 0, fmt.Errorf("audio timeline ranges must be positive")
			}
		}
	}
	return count, nil
}

func validateCaptionCues(tracks []CaptionTrack) error {
	count := 0
	for _, track := range tracks {
		count += len(track.Cues)
		for _, cue := range track.Cues {
			if cue.EndUS <= cue.StartUS || cue.StartUS < 0 {
				return fmt.Errorf("caption cue ranges must be positive")
			}
		}
	}
	if count > MaxCaptionCues {
		return fmt.Errorf("a project can contain up to %d caption cues", MaxCaptionCues)
	}
	return nil
}

func validateVariants(variants []VideoVariant) error {
	expected := map[string]bool{
		"portrait": false, "feed-portrait": false, "square": false, "landscape": false,
	}
	for _, variant := range variants {
		seen, valid := expected[variant.ID]
		if !valid || seen {
			return fmt.Errorf("project variants must contain each supported format exactly once")
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
		duration := clipDurationUS(clip)
		var overlap int64
		if index > 0 {
			previous := document.PrimarySequence[index-1]
			requested := transitionDuration(previous.TransitionOut)
			if current := transitionDuration(clip.TransitionIn); current > requested {
				requested = current
			}
			overlap = minInt64(requested, clipDurationUS(previous)/2, duration/2)
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
	for sourceID, source := range document.Sources {
		if source.Locator.Type == "openpost-media" && source.Locator.MediaID != "" {
			result[sourceID] = source.Locator.MediaID
		}
	}
	return result
}

func StableMediaIDs(document Document) []string {
	references := MediaReferences(document)
	result := make([]string, 0, len(references))
	for _, mediaID := range references {
		result = append(result, mediaID)
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

func transitionDuration(transition *Transition) int64 {
	if transition == nil || transition.DurationUS < 0 {
		return 0
	}
	return transition.DurationUS
}

func oneOfInt(value int, allowed ...int) bool {
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
