package mediaanalysis

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFakeAnalyzerReturnsConfiguredResult(t *testing.T) {
	analyzer := FakeAnalyzer{Result: Result{
		Width:           1080,
		Height:          1920,
		DurationMS:      62_000,
		FrameRate:       29.97,
		PosterMIMEType:  "image/jpeg",
		PosterContent:   []byte("poster"),
		AnalysisStatus:  AnalysisStatusReady,
		AnalysisError:   "",
		DominantType:    "video",
		AspectRatio:     "9:16",
		ThumbnailObject: "poster-video.jpg",
	}}

	got, err := analyzer.Analyze(context.Background(), Input{Filename: "clip.mp4", MIMEType: "video/mp4"})

	require.NoError(t, err)
	require.Equal(t, 1080, got.Width)
	require.Equal(t, int64(62_000), got.DurationMS)
	require.InDelta(t, 29.97, got.FrameRate, 0.01)
	require.Equal(t, []byte("poster"), got.PosterContent)
	require.Equal(t, AnalysisStatusReady, got.AnalysisStatus)
}

func TestAnalyzerDisabledMarksVideoPending(t *testing.T) {
	got := DisabledAnalyzer{}.AnalyzeFallback("video/mp4")

	require.Equal(t, AnalysisStatusPending, got.AnalysisStatus)
	require.Equal(t, "video", got.DominantType)
	require.Equal(t, "media analyzer is not configured", got.AnalysisError)
}
