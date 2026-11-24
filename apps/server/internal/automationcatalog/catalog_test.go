package automationcatalog

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCatalogFailsClosedForUnknownOperations(t *testing.T) {
	t.Parallel()

	_, ok := Lookup("delete-organization")
	require.False(t, ok)
}
