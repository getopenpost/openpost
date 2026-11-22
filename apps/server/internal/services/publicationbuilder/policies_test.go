package publicationbuilder

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNativeTextPoliciesAvoidUnsupportedPerformanceRules(t *testing.T) {
	t.Parallel()
	mastodon, ok := policyFor("mastodon")
	require.True(t, ok)
	require.True(t, mastodon.Native)
	require.Contains(t, mastodon.Distribution, "no single global ranking model or universal hashtag count")
	require.NotContains(t, mastodon.Distribution, "zero to three")

	threads, ok := policyFor("threads")
	require.True(t, ok)
	require.True(t, threads.Native)
	require.Contains(t, threads.Distribution, "do not claim a guaranteed reward")
	require.Contains(t, threads.Writing, "platform-specific rewriting is optional")
	require.NotContains(t, threads.Distribution, "Threads rewards")
}

func TestGenerationContextKeepsMediaGuidanceCapabilityGatedAndFallbackConservative(t *testing.T) {
	t.Parallel()
	destinations := []Destination{
		{AccountID: "linkedin", Platform: "linkedin", AllowedOutputProfiles: []OutputProfile{{Key: "linkedin.post", TextLimit: 3000, MaxSegments: 1}}},
		{AccountID: "youtube", Platform: "youtube", AllowedOutputProfiles: []OutputProfile{{Key: "youtube.video", TextLimit: 5000, MaxSegments: 1, MediaMaxCount: 1, AllowedMIMEs: []string{"video/*"}}}},
	}
	context := generationContextFor(BuildInput{Idea: "Show the supported workflow."}, destinations)
	require.Len(t, context.PlatformPolicies, 2)
	require.True(t, context.PlatformPolicies[0].Native)
	require.False(t, context.PlatformPolicies[1].Native)
	require.Equal(t, []string{"clarity"}, context.PlatformPolicies[1].Objectives)
	require.Equal(t, []string{"straight_adaptation"}, context.PlatformPolicies[1].Archetypes)

	prompt, err := directorPrompt(BuildInput{Idea: "Show the supported workflow."}, destinations)
	require.NoError(t, err)
	require.Contains(t, prompt, `"platform":"youtube"`)
	require.Contains(t, prompt, `"native":false`)
	require.Contains(t, prompt, `"key":"youtube.video"`)
	require.Contains(t, generationRules, "Gate the medium against the selected account output profile")
	require.Contains(t, generationRules, "a caption is not a video")
	require.Contains(t, generationRules, "explicit upload treatment")
	require.Contains(t, context.PlatformPolicies[1].Distribution, "conservative publishable adaptation")
}
