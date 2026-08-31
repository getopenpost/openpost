package mediaanalysis

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAnalyzerDisabledMarksVideoPending(t *testing.T) {
	got := DisabledAnalyzer{}.AnalyzeFallback("video/mp4")

	require.Equal(t, AnalysisStatusPending, got.AnalysisStatus)
	require.Equal(t, "video", got.DominantType)
	require.Equal(t, "media analyzer is not configured", got.AnalysisError)
}
