package publicationbuilder

import "strings"

type platformPolicy struct {
	Platform   string
	Objectives []string
	Archetypes []string
	Guidance   string
}

var platformPolicies = map[string]platformPolicy{
	"linkedin": {
		Platform:   "linkedin",
		Objectives: []string{"reach", "comments", "reposts", "authority", "trust"},
		Archetypes: []string{"artifact_led", "thesis_led", "lesson", "announcement"},
		Guidance:   "Choose artifact-led or thesis-led. Open with exact tension, change, contradiction, confession, or proof. Make the pre-expansion preview useful. Use media only for proof, punchline, portability, authenticity, or novelty. Never add decorative AI art by default.",
	},
	"x": {
		Platform:   "x",
		Objectives: []string{"shares", "conversation", "follows", "clicks"},
		Archetypes: []string{"artifact_joke", "product_demo", "technical_opinion", "analogy", "taxonomy", "explainer"},
		Guidance:   "Remove dead setup. Prefer exact artifacts, interfaces, commands, results, and demos. Make the subject and useful point clear enough to stand alone before any link. Keep current references at zero unless the source supplies them. Do not hide a needed link in an automatic reply, imitate fixed ranking weights, or turn an algorithm window into a posting rule. Do not polish away natural rhythm or force a joke. A thread must earn every extra segment.",
	},
	"mastodon": {
		Platform:   "mastodon",
		Objectives: []string{"boosts", "hashtag_discovery", "conversation", "clicks"},
		Archetypes: []string{"community_note", "technical_update", "source_share", "discussion"},
		Guidance:   "Write as a useful member of a technical community. Links are welcome. Use zero to three precise hashtags. Inherit visibility and provider settings. Do not add a content warning to an ordinary technical post and never promise instance-wide compatibility.",
	},
	"bluesky": {
		Platform:   "bluesky",
		Objectives: []string{"following", "discover", "custom_feed", "conversation", "clicks"},
		Archetypes: []string{"expert_take", "primary_source", "technical_note", "discussion"},
		Guidance:   "Prefer primary sources and subject knowledge. Use only feed signals supplied in the source. Avoid copied X bait, generic replies, dunking, and fake curiosity. Keep feed eligibility warnings separate from publishability.",
	},
	"threads": {
		Platform:   "threads",
		Objectives: []string{"conversation", "community_growth", "follows", "clicks", "cross_meta_reach"},
		Archetypes: []string{"conversation_starter", "original_take", "media_context", "lesson"},
		Guidance:   "Use original Threads wording. Add useful written context around media. A reply path must be a real tension a person may sincerely answer. Follow-up notes are advice for the author, never automatic replies.",
	},
}

func policyFor(platform string) (platformPolicy, bool) {
	policy, ok := platformPolicies[strings.ToLower(strings.TrimSpace(platform))]
	return policy, ok
}
