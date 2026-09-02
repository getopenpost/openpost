package themes

import (
	"encoding/binary"
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

func TestDecodeWOFF2RejectsDeclaredSFNTSizeThatDoesNotMatchDirectory(t *testing.T) {
	content := append([]byte(nil), realWOFF2(t)...)
	declared := binary.BigEndian.Uint32(content[16:20])
	binary.BigEndian.PutUint32(content[16:20], declared+4)

	_, err := decodeWOFF2Tables(content)
	require.Error(t, err)
	require.ErrorContains(t, err, "declared SFNT size")
}
