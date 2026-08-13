package usernames

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUsernameValidationAndSuggestions(t *testing.T) {
	t.Parallel()

	require.NoError(t, Validate("rodrgds"))
	require.Error(t, Validate("Open Post"))
	require.Error(t, Validate("admin"))
	require.Equal(t, "rodrigo-dias", Suggest("Rodrigo Dias", "rodrigo@example.com"))
	require.Equal(t, "rodrigo-dias-abc123", Candidate("rodrigo-dias", "abc12345", 1))
}
