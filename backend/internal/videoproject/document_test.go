package videoproject

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func validDocument() Document {
	document := Document{
		SchemaVersion: 1,
		Title:         "Launch",
		Timebase: Timebase{
			TicksPerSecond: TicksPerSecond,
			FPSNumerator:   30,
			FPSDenominator: 1,
		},
		Sources: map[string]Source{
			"source": {
				ID: "source", Kind: "video",
				Locator:      SourceLocator{Type: "openpost-media", MediaID: "media-1"},
				OriginalName: "source.mp4", MIMEType: "video/mp4", SizeBytes: 100,
				DurationUS: 10_000_000, Width: 1920, Height: 1080,
			},
		},
		PrimarySequence: []PrimarySequenceClip{{
			ID: "clip", SourceID: "source", Mode: "source",
			SourceInUS: 0, SourceOutUS: 10_000_000, Speed: 1,
			Video: VideoPresentation{
				PositionX: 0.5, PositionY: 0.5, Scale: 1, Opacity: 1,
				Crop:        CropRectangle{Width: 1, Height: 1},
				BorderColor: "#000000", Background: "#000000",
			},
			Audio:   ClipAudioSettings{GainDB: 0},
			Effects: []VideoEffect{},
		}},
		VisualTracks:  []VisualTrack{},
		AudioTracks:   []AudioTrack{},
		CaptionTracks: []CaptionTrack{},
		Variants: []VideoVariant{
			{ID: "portrait", Name: "Portrait", Width: 1080, Height: 1920, BackgroundColor: "#000000"},
			{ID: "feed-portrait", Name: "Feed portrait", Width: 1080, Height: 1350, BackgroundColor: "#000000"},
			{ID: "square", Name: "Square", Width: 1080, Height: 1080, BackgroundColor: "#000000"},
			{ID: "landscape", Name: "Landscape", Width: 1920, Height: 1080, BackgroundColor: "#000000"},
		},
		Markers: []TimelineMarker{},
		ExportDefaults: ExportDefaults{
			VariantIDs: []string{"portrait"},
			Format:     "mp4", VideoCodec: "avc", AudioCodec: "aac",
			FrameRate:    ExportFrameRate{Numerator: 30, Denominator: 1},
			VideoBitrate: 8_000_000, AudioBitrate: 128_000,
		},
	}
	return document
}

func TestValidateCloudDocumentAndDuration(t *testing.T) {
	t.Parallel()
	document := validDocument()
	require.NoError(t, Validate(document, true))
	require.Equal(t, int64(10_000_000), DurationUS(document))
	require.Equal(t, map[string]string{"source": "media-1"}, MediaReferences(document))
}

func TestValidateEditingModeAndTwoHourLimit(t *testing.T) {
	t.Parallel()
	document := validDocument()
	document.EditingMode = "quick-cut"
	source := document.Sources["source"]
	source.DurationUS = 60 * 60 * 1_000_000
	document.Sources["source"] = source
	document.PrimarySequence[0].SourceOutUS = source.DurationUS
	require.NoError(t, Validate(document, true))

	document.EditingMode = "unknown"
	require.ErrorContains(t, Validate(document, true), "editing mode")
	document.EditingMode = "editor"
	source.DurationUS = 60*60*1_000_000 + 1
	document.Sources["source"] = source
	document.PrimarySequence[0].SourceOutUS = source.DurationUS
	second := document.PrimarySequence[0]
	second.ID = "clip-2"
	document.PrimarySequence = append(document.PrimarySequence, second)
	require.ErrorContains(t, Validate(document, true), "2 hours")
}

func TestValidateRejectsLocalSourcesInCloudDocument(t *testing.T) {
	t.Parallel()
	document := validDocument()
	source := document.Sources["source"]
	source.Locator = SourceLocator{Type: "local-opfs", Path: "projects/local/source.mp4"}
	document.Sources["source"] = source
	require.ErrorContains(t, Validate(document, true), "synced OpenPost media")
	require.NoError(t, Validate(document, false))
}

func TestDurationBoundsTransitionOverlap(t *testing.T) {
	t.Parallel()
	document := validDocument()
	second := document.PrimarySequence[0]
	second.ID = "clip-2"
	second.SourceInUS = 0
	second.SourceOutUS = 2_000_000
	second.TransitionIn = &Transition{Type: "cross-dissolve", DurationUS: 8_000_000, Easing: "linear"}
	document.PrimarySequence = append(document.PrimarySequence, second)
	require.Equal(t, int64(11_000_000), DurationUS(document))
}

func TestDocumentJSONRejectsUnknownNestedFields(t *testing.T) {
	t.Parallel()
	encoded, err := json.Marshal(validDocument())
	require.NoError(t, err)
	withUnknown := strings.Replace(
		string(encoded),
		`"position_x":0.5`,
		`"position_x":0.5,"surprise":true`,
		1,
	)
	var document Document
	require.ErrorContains(t, json.Unmarshal([]byte(withUnknown), &document), "unknown field")
}

func TestValidateSupportsExplicitPrimaryGap(t *testing.T) {
	t.Parallel()
	document := validDocument()
	document.PrimarySequence = append([]PrimarySequenceClip{{
		ID: "gap", Kind: "gap", DurationUS: 2_000_000,
	}}, document.PrimarySequence...)
	require.NoError(t, Validate(document, true))
	require.Equal(t, int64(12_000_000), DurationUS(document))
}
