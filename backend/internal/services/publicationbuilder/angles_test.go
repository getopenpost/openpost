package publicationbuilder

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/openpost/backend/internal/ai"
	"github.com/stretchr/testify/require"
)

func TestPlanAnglesReturnsBuildSafeDirections(t *testing.T) {
	t.Parallel()

	angles := make([]map[string]any, 0, len(requiredAngleIDs))
	for _, id := range requiredAngleIDs {
		angles = append(angles, map[string]any{
			"id":               id,
			"label":            "Direct technical note",
			"hook":             "The launch removed a limit that users kept hitting.",
			"thesis":           strings.Repeat("t", 699) + "\n",
			"approach":         "\t" + strings.Repeat("a", 699),
			"objective":        "authority",
			"desired_reaction": "Understand why the change matters",
			"evidence":         "Use the documented before and after behavior.",
			"media": map[string]any{
				"treatment":  "none",
				"role":       "none",
				"brief":      strings.Repeat("m", MaxDirectionMediaPreferenceCharacters),
				"source_ref": "",
			},
		})
	}
	payload, err := json.Marshal(map[string]any{"angles": angles})
	require.NoError(t, err)

	service, err := New(generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: string(payload)}, nil
	}), Config{Model: "test-model"})
	require.NoError(t, err)

	planned, err := service.PlanAngles(t.Context(), AngleInput{
		Idea: "Explain the launch",
		Destinations: []Destination{{
			AccountID: "account-1",
			Platform:  "linkedin",
			Label:     "LinkedIn",
		}},
	})
	require.NoError(t, err)
	require.Len(t, planned, len(requiredAngleIDs))

	for _, angle := range planned {
		direction := angle.BuildDirection
		require.Equal(t, "authority", direction.Outcome)
		require.Equal(t, strings.Repeat("t", 699)+" "+strings.Repeat("a", 699), direction.Angle)
		require.Equal(t, strings.Repeat("m", MaxDirectionMediaPreferenceCharacters), direction.MediaPreference)
		require.LessOrEqual(t, utf8.RuneCountInString(direction.Angle), MaxDirectionAngleCharacters)
		require.LessOrEqual(t, utf8.RuneCountInString(direction.Outcome), MaxDirectionOutcomeCharacters)
		require.LessOrEqual(t, utf8.RuneCountInString(direction.MediaPreference), MaxDirectionMediaPreferenceCharacters)
		require.False(t, strings.ContainsFunc(direction.Angle, unicode.IsControl))
		require.False(t, strings.ContainsFunc(direction.MediaPreference, unicode.IsControl))
	}
}
