package videoproject

import (
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
				Crop: CropRectangle{Width: 1, Height: 1},
			},
			Effects: []VideoEffect{},
		}},
		VisualTracks:  []VisualTrack{},
		AudioTracks:   []AudioTrack{},
		CaptionTracks: []CaptionTrack{},
		Variants: []VideoVariant{
			{ID: "portrait", Width: 1080, Height: 1920},
			{ID: "feed-portrait", Width: 1080, Height: 1350},
			{ID: "square", Width: 1080, Height: 1080},
			{ID: "landscape", Width: 1920, Height: 1080},
		},
		Markers: []TimelineMarker{},
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
