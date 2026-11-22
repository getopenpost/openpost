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

func TestBuildRepairsNativeYouTubeTextBeforeReturningDraft(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name, title, description, feedback string
		review                             bool
	}{
		{"missing title", "", "A real demo.", "Title is required", false},
		{"long title", strings.Repeat("a", 101), "A real demo.", "Title is too long", false},
		{"title characters", "<demo>", "A real demo.", "titles cannot contain", false},
		{"description bytes", "The demo", strings.Repeat("界", 1700), "5000 bytes", false},
		{"review replacement title", strings.Repeat("a", 101), "A real demo.", "Title is too long", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			adapterCalls, reviewCalls := 0, 0
			valid := SegmentPlan{Body: "A real demo.", Title: "The demo", Description: "A real demo."}
			invalid := SegmentPlan{Body: valid.Body, Title: scenario.title, Description: scenario.description}
			service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
				var output any
				switch request.ResponseSchema.Name {
				case "openpost_publication_direction":
					output = DirectorPlan{CanonicalText: valid.Body, FactualKernel: []string{valid.Body}, Thesis: "Show the demo", Outcome: "clarity", Audience: "founders", Angle: "show the real interaction", Route: "artifact_led", Media: MediaPlan{Treatment: "none", Role: "none", Brief: "No shared visual."}, Destinations: []DestinationDecision{{AccountID: "channel", Include: true, Reason: "A real demo."}}}
				case "openpost_destination_rendition":
					adapterCalls++
					segment := valid
					if !scenario.review && adapterCalls == 1 {
						segment = invalid
					}
					if adapterCalls == 2 {
						require.Contains(t, request.UserPrompt, scenario.feedback)
					}
					output = DestinationPlan{AccountID: "channel", Objective: "clarity", Archetype: "straight_adaptation", OutputProfile: "youtube.video", Preview: valid.Body, Segments: []SegmentPlan{segment}, Media: MediaPlan{Treatment: "attach_video", Role: "demo", Brief: "Attach the real demo."}}
				case "openpost_publication_review":
					reviewCalls++
					output = reviewResult{Approved: true}
					if scenario.review && reviewCalls == 1 {
						output = reviewResult{Replacements: []reviewReplacement{{AccountID: "channel", Segments: []SegmentPlan{invalid}}}}
					}
					if scenario.review && reviewCalls == 2 {
						require.Contains(t, request.UserPrompt, scenario.feedback)
					}
				default:
					t.Fatalf("unexpected generation stage %s", request.ResponseSchema.Name)
				}
				data, err := json.Marshal(output)
				require.NoError(t, err)
				return ai.GenerateResult{Text: string(data)}, nil
			}), Config{Model: "synthetic-model"})
			require.NoError(t, err)
			result, err := service.Build(t.Context(), BuildInput{Idea: valid.Body, Destinations: []Destination{{AccountID: "channel", Platform: "youtube", AllowedOutputProfiles: []OutputProfile{{Key: "youtube.video", TextLimit: 5000, MaxSegments: 1, MediaMaxCount: 1, AllowedMIMEs: []string{"video/*"}}}}}})
			require.NoError(t, err)
			require.Equal(t, valid, result.Destinations[0].Segments[0])
			if scenario.review {
				// The invalid replacement is repaired at review, without regenerating the draft.
				require.Equal(t, 1, adapterCalls)
				require.Equal(t, 2, reviewCalls)
			} else {
				require.Equal(t, 2, adapterCalls)
				require.Equal(t, 1, reviewCalls)
			}
		})
	}
}
