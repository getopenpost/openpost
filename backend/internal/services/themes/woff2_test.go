package themes

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrepareNativeFontDerivativeRejectsVariableFacesAndProducesValidatedSFNT(t *testing.T) {
	content := realWOFF2(t)
	tables, err := decodeWOFF2Tables(content)
	require.NoError(t, err)
	tables["fvar"] = []byte{0, 1}
	err = validateWOFF2Metadata(tables, "Roboto", 400, "normal")
	require.ErrorIs(t, err, ErrInvalidAsset)
	require.ErrorContains(t, err, "variable")

	derivative, err := prepareNativeFontDerivative(content, "Roboto", 400, "normal")
	require.NoError(t, err)
	require.Equal(t, "ttf", derivative.Format)
	require.Equal(t, "font/ttf", derivative.MediaType)
	require.NotEmpty(t, derivative.Content)
	require.LessOrEqual(t, len(derivative.Content), maxDecodedThemeFontBytes)
	require.Len(t, derivative.ChecksumSHA256, 64)
	require.NoError(t, validateSFNTDerivative(derivative.Content, derivative.Format, "Roboto", 400, "normal"))
}
