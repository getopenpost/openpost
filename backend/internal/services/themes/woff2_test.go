package themes

import (
	"encoding/binary"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDecodeWOFF2RejectsDeclaredSFNTSizeThatDoesNotMatchDirectory(t *testing.T) {
	content := append([]byte(nil), realWOFF2(t)...)
	declared := binary.BigEndian.Uint32(content[16:20])
	binary.BigEndian.PutUint32(content[16:20], declared+4)

	_, err := decodeWOFF2Tables(content)
	require.Error(t, err)
	require.ErrorContains(t, err, "declared SFNT size")
}
