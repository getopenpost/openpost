package memes

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateCaptionUsesVisibleCharacterLimit(t *testing.T) {
	t.Parallel()

	require.NoError(t, ValidateCaption(strings.Repeat("😀", MaxCaptionCharacters)))
	require.ErrorIs(t, ValidateCaption(strings.Repeat("😀", MaxCaptionCharacters+1)), ErrInvalidRequest)
	require.ErrorIs(t, ValidateCaption("safe\x00looking"), ErrInvalidRequest)
	require.NoError(t, ValidateCaption("first line\nsecond line"))
}
