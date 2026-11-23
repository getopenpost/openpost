package publicationbuilder

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/stretchr/testify/require"
)

func TestBuildUsesAccountSnapshotTextLimit(t *testing.T) {
	t.Parallel()
	body := strings.Repeat("a", 600)
	adapterCalls := 0
	service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		var output any
		switch request.ResponseSchema.Name {
		case "openpost_publication_direction":
			output = DirectorPlan{CanonicalText: body, FactualKernel: []string{body}, Thesis: "Explain the update", Outcome: "shares", Audience: "founders", Angle: "describe the change", Route: "thesis_led", Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}, Destinations: []DestinationDecision{{AccountID: "account", Include: true, Reason: "A supported update."}}}
		case "openpost_destination_rendition":
			adapterCalls++
			output = DestinationPlan{AccountID: "account", Objective: "boosts", Archetype: "technical_update", OutputProfile: "mastodon.post", Preview: "A product update.", Segments: []SegmentPlan{{Body: body}}, Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}}
		case "openpost_publication_review":
			output = reviewResult{Approved: true}
		default:
			t.Fatalf("unexpected generation stage %s", request.ResponseSchema.Name)
		}
		data, err := json.Marshal(output)
		require.NoError(t, err)
		return ai.GenerateResult{Text: string(data)}, nil
	}), Config{Model: "synthetic-model"})
	require.NoError(t, err)
	result, err := service.Build(t.Context(), BuildInput{Idea: body, Destinations: []Destination{{AccountID: "account", Platform: "mastodon", AllowedOutputProfiles: []OutputProfile{{Key: "mastodon.post", TextLimit: 1000, MaxSegments: 1}}}}})
	require.NoError(t, err, "the saved account limit must govern native text validation")
	require.Equal(t, body, result.Destinations[0].Segments[0].Body)
	require.Equal(t, 1, adapterCalls, "valid account-expanded text must not be rewritten")
}
