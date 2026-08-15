package usernames

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUsernameValidation(t *testing.T) {
	t.Parallel()

	require.NoError(t, Validate("rodgds"))
	require.NoError(t, Validate("rodrigo-dias"))
	require.NoError(t, Validate("rodrigo_dias"))
	require.NoError(t, Validate("r99"))

	for _, candidate := range []string{"Open Post", "admin", "-lead", "lead-", "_lead", "lead_", "r", ""} {
		require.Error(t, Validate(candidate), candidate)
	}
}

func TestUsernameSuggestion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		display  string
		email    string
		expected string
	}{
		{name: "plain display name", display: "Rodrigo Dias", email: "rodrigo@example.com", expected: "rodrigo-dias"},
		{name: "email fallback with separator handling", display: "  ", email: "Ana.Maria@example.com", expected: "ana-maria"},
		{name: "email fallback for empty display", display: "", email: "joao@example.com", expected: "joao"},
		{name: "reserved word falls back", display: "Admin", email: "someone@example.com", expected: "user"},
		{name: "punctuation and casing normalization", display: "Ana & Maria", email: "a@example.com", expected: "ana-maria"},
		{name: "single letter falls back", display: "A", email: "a@example.com", expected: "user"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.expected, Suggest(test.display, test.email))
		})
	}
}

func TestUsernameCandidate(t *testing.T) {
	t.Parallel()

	require.Equal(t, "rodrigo-dias", Candidate("rodrigo-dias", "abc12345", 0))
	require.Equal(t, "rodrigo-dias-abc123", Candidate("rodrigo-dias", "abc12345", 1))
	require.Equal(t, "rodrigo-dias-abc1232", Candidate("rodrigo-dias", "abc12345", 2))
	// A stable ID with no usable characters falls back to a numeric suffix.
	require.Equal(t, "rodrigo-dias-2", Candidate("rodrigo-dias", "###", 1))
	require.Equal(t, "rodrigo-dias-3", Candidate("rodrigo-dias", "###", 2))
}

func TestUsernameCandidateFitsWithinMaxLength(t *testing.T) {
	t.Parallel()

	for _, base := range []string{"a", "ab", "short-name", strings.Repeat("a", MaxLength)} {
		for attempt := 0; attempt < 4; attempt++ {
			candidate := Candidate(base, "abcdefghij", attempt)
			require.LessOrEqual(t, len(candidate), MaxLength, candidate)
			if attempt == 0 {
				require.Equal(t, base, candidate)
				continue
			}
			require.NoError(t, Validate(candidate), candidate)
		}
	}
}
