package memes

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStyleBuiltinTextDefaultCapitalization(t *testing.T) {
	t.Parallel()

	require.Equal(t, "Hello world", styleBuiltinText("hello world", "default"))
	require.Equal(t, "Hello WORLD", styleBuiltinText("Hello WORLD", "default"), "mixed case should not be forced")
}

func TestMockBuiltinTextDeterministicAndBiased(t *testing.T) {
	t.Parallel()

	first := mockBuiltinText("these are words")
	second := mockBuiltinText("these are words")
	require.Equal(t, first, second, "mock must be deterministic with seed 0")
	require.NotEqual(t, "ThEsE aRe WoRdS", first, "mock should not be simple alternating - should be biased random")
	// Verify that mock touches letters and preserves spaces
	require.Contains(t, first, " ")
	require.NotEqual(t, "these are words", first)
	// Check another deterministic input
	require.Equal(t, mockBuiltinText("hello world"), mockBuiltinText("hello world"))
}

func TestBuiltinMaxGIFFramesIsTwenty(t *testing.T) {
	t.Parallel()

	require.Equal(t, 20, builtinMaxGIFFrames)
	cases := []int{21, 40, 100, 60, 25}
	for _, total := range cases {
		frames := selectedBuiltinGIFFrames(total)
		require.Len(t, frames, builtinMaxGIFFrames, "total %d should yield exactly %d frames", total, builtinMaxGIFFrames)
		require.Equal(t, 0, frames[0], "total %d first frame", total)
		require.Equal(t, total-1, frames[len(frames)-1], "total %d last frame", total)
		for i := 1; i < len(frames); i++ {
			require.Greater(t, frames[i], frames[i-1], "frames must be strictly increasing for total %d", total)
		}
	}
	frames2 := selectedBuiltinGIFFrames(10)
	require.Len(t, frames2, 10)
	framesExact := selectedBuiltinGIFFrames(20)
	require.Len(t, framesExact, 20)
}
