package publicprofiles

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParsePreservesHistoricalAllFieldsDefault(t *testing.T) {
	for _, raw := range []string{"", "[]", "  []  "} {
		visibility := Parse(raw)
		require.Equal(t, SupportedFields(), visibility.Fields())
	}
}

func TestNormalizeCanHideEveryOptionalField(t *testing.T) {
	raw, fields, err := Normalize(nil)
	require.NoError(t, err)
	require.Equal(t, `["username"]`, raw)
	require.Empty(t, fields)
	require.Empty(t, Parse(raw).Fields())
}

func TestNormalizeUsesStableOrderAndDeduplicates(t *testing.T) {
	raw, fields, err := Normalize([]string{FieldPlan, FieldAvatar, FieldPlan})
	require.NoError(t, err)
	require.Equal(t, []string{FieldAvatar, FieldPlan}, fields)
	require.Equal(t, `["username","avatar","plan"]`, raw)
	require.Equal(t, fields, Parse(raw).Fields())
}

func TestVisibilityFailsClosedForMalformedOrUnknownPolicies(t *testing.T) {
	for _, raw := range []string{`{"activity":true}`, `["avatar","email"]`, `null`} {
		require.Empty(t, Parse(raw).Fields(), raw)
	}
}

func TestNormalizeRejectsUnknownFields(t *testing.T) {
	_, _, err := Normalize([]string{"email"})
	require.ErrorIs(t, err, ErrUnsupportedField)
}
