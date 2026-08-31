package publicationbuilder

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNativePlatformPromptsCarryDistinctResearchBackedRules(t *testing.T) {
	tests := []struct {
		platform string
		contains []string
	}{
		{
			platform: "linkedin",
			contains: []string{"pre-expansion preview", "proof, punchline, portability, authenticity, or novelty", "one anecdote into an industry fact"},
		},
		{
			platform: "x",
			contains: []string{"automatic first reply", "A thread must earn every extra segment", "premium reach multipliers", "virality score"},
		},
		{
			platform: "mastodon",
			contains: []string{"distribution is federated", "zero to three precise hashtags", "content warning to an ordinary technical post", "alt text"},
		},
		{
			platform: "bluesky",
			contains: []string{"many custom feeds", "clear source attribution", "custom-feed eligibility", "copied X bait"},
		},
		{
			platform: "threads",
			contains: []string{"easy sincere reply path", "original Threads wording", "never generate automatic replies", "cross-Meta reach"},
		},
	}

	for _, test := range tests {
		t.Run(test.platform, func(t *testing.T) {
			policy, ok := policyFor(test.platform)
			require.True(t, ok)
			prompt := adapterSystemPrompt(policy)
			for _, expected := range test.contains {
				require.Contains(t, prompt, expected)
			}
			require.Contains(t, prompt, "Plain-language audit")
			require.Contains(t, prompt, "supported, user_asserted, opinion, parody, needs_verification")
			require.Contains(t, prompt, "exact useful opening")
		})
	}
}

func TestDirectorAndReviewerReceiveTheExactPlatformPolicies(t *testing.T) {
	input := BuildInput{
		Idea: "I removed fifteen thousand lines and the product became easier to use.",
		Destinations: []Destination{
			{AccountID: "linkedin-1", Platform: "linkedin"},
			{AccountID: "x-1", Platform: "x"},
		},
	}
	director, err := directorPrompt(input, input.Destinations)
	require.NoError(t, err)
	require.Contains(t, director, `"platform_policies":[{"platform":"linkedin"`)
	require.Contains(t, director, `"platform":"x"`)

	reviewer, err := reviewerPrompt(input, DirectorPlan{}, []DestinationPlan{
		{AccountID: "linkedin-1", Platform: "linkedin"},
		{AccountID: "x-1", Platform: "x"},
	})
	require.NoError(t, err)
	require.Contains(t, reviewer, `"platform_policies":[{"platform":"linkedin"`)
	require.Contains(t, reviewer, `"platform":"x"`)
	require.Contains(t, reviewerSystemPrompt, "reads like another platform with a new character limit")
	require.Contains(t, reviewerSystemPrompt, "Do not reject or flag a user assertion")
	require.Contains(t, reviewerSystemPrompt, "invented by the generator")
	require.NotContains(t, reviewerSystemPrompt, "Reject unsupported certainty")
	require.Contains(t, directorSystemPrompt, "Treat uncited facts supplied by the user as user_asserted")
}
