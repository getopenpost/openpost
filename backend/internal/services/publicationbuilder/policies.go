package publicationbuilder

import "strings"

type platformPolicy struct {
	Platform     string   `json:"platform"`
	Native       bool     `json:"native"`
	Objectives   []string `json:"objectives"`
	Archetypes   []string `json:"archetypes"`
	Distribution string   `json:"distribution_model"`
	Writing      string   `json:"writing_model"`
	Media        string   `json:"media_model"`
	Safety       string   `json:"safety_model"`
}

var platformPolicies = map[string]platformPolicy{
	"linkedin": {
		Platform:   "linkedin",
		Native:     true,
		Objectives: []string{"reach", "comments", "reposts", "authority", "trust"},
		Archetypes: []string{
			"artifact_led", "thesis_led", "artifact_meme", "deadpan_screenshot", "corporate_parody", "personal_reversal",
			"contrarian_take", "community_ritual", "brand_manifesto", "timely_values_story",
			"trend_parody", "lesson", "announcement",
		},
		Distribution: "The visible opening lines decide whether someone expands the post. Pick one dominant reaction and one idea. Optimize explicitly for reach, comments, reposts, authority, or trust instead of blending all five.",
		Writing:      "Start with an exact tension, change, contradiction, confession, or proof. Do not begin with topic-setting filler. Put the hook and important claim in the pre-expansion preview. Use concrete numbers, artifacts, decisions, and consequences. A long post must repay the opening with evidence or experience. Questions must be specific enough that a real person could answer them. Preserve the Voice Profile's casing, punctuation, sentence length, technical depth, humor tolerance, and formality.",
		Media:        "Choose no visual or give the visual one job: proof, punchline, portability, authenticity, or novelty. Prefer real screenshots, diffs, interfaces, charts, collages, or branded statement cards. State crop priorities and text that must stay readable. Generated visuals need a precise job and must never be decorative by default. Do not explain a visual punchline in the text.",
		Safety:       "Do not turn one anecdote into an industry fact. Label parody and fictional artifacts clearly. Do not force a generic LinkedIn persona, a vague engagement question, an unnecessary CTA on a meme, or categorical certainty that the source does not support.",
	},
	"x": {
		Platform:   "x",
		Native:     true,
		Objectives: []string{"shares", "conversation", "follows", "clicks"},
		Archetypes: []string{
			"artifact_joke", "product_demo", "technical_opinion", "analogy", "taxonomy",
			"principle", "explainer", "announcement",
		},
		Distribution: "Treat personalized ranking and recommendation eligibility as separate systems. The post must be useful on its own before any link. A direct link is valid when the post earns attention; never hide a required link in an automatic first reply. Topic consistency can help the network place the author, but do not convert ranking windows, action weights, or posting frequency into universal rules.",
		Writing:      "Remove dead setup. Lead with the exact artifact, command, result, product behavior, or opinion. Use compact natural language and keep the useful point clear. A joke must work without an explanation. Use a current reference only when supplied evidence establishes its meaning and freshness. A thread must earn every extra segment. Preserve rough edges that belong to the Voice Profile instead of polishing the post into generic creator copy.",
		Media:        "Prefer real artifacts, interfaces, screenshots, diffs, diagrams, and short product demos. Use an annotated screenshot only when the annotation adds information. Generated conceptual art should be rare. The media role must be proof, punchline, demo, or necessary context.",
		Safety:       "Do not invent current references, secret ranking scores, premium reach multipliers, fixed action weights, golden-window claims, or a virality score. Do not force a joke, add generic reply bait, or copy a LinkedIn opening. Keep visibility or safety risks separate from writing advice.",
	},
	"mastodon": {
		Platform:   "mastodon",
		Native:     true,
		Objectives: []string{"boosts", "hashtag_discovery", "conversation", "clicks"},
		Archetypes: []string{
			"community_note", "technical_update", "source_share", "release_note", "discussion",
		},
		Distribution: "Mastodon distribution is federated. Followers, local and federated timelines, precise hashtags, boosts, visibility, and instance rules matter more than one global ranking model. Direct links are normal. Use zero to three precise hashtags when they improve discovery.",
		Writing:      "Write as a useful member of a technical community. Give enough context, use exact terminology, link to the primary source, and invite discussion only when there is a real question. Prefer informative release notes, source shares, and community updates over virality theater.",
		Media:        "Use source artifacts when they help someone understand or verify the post. Request useful alt text for every meaningful image. Do not add visual bait or media that contributes nothing to the discussion.",
		Safety:       "Preserve the connected account's visibility, content-warning, quote, and provider settings. Do not add a content warning to an ordinary technical post. Warn when instance rules, trend eligibility, quote behavior, or remote-instance visibility cannot be known. Never promise network-wide compatibility or discovery.",
	},
	"bluesky": {
		Platform:   "bluesky",
		Native:     true,
		Objectives: []string{"following", "discover", "target_feed", "reposts", "quotes", "conversation", "follows", "clicks"},
		Archetypes: []string{
			"expert_take", "primary_source", "technical_note", "feed_targeted", "discussion",
		},
		Distribution: "Bluesky has Following, Discover, and many custom feeds rather than one universal algorithm. Feed triggers are part of the content contract only when supplied context names the feed and its current signals. Primary sources, reposts, quotes, follows, labels, and viewer settings affect different paths.",
		Writing:      "Write compact expert commentary with clear source attribution. Use current community language only when the source or Voice Profile supplies it. Make the point useful outside one feed. Prefer a direct technical note, primary-source explanation, or specific discussion prompt over copied X bait.",
		Media:        "Prefer primary-source images, diagrams, code, and product artifacts. Explain why the asset matters. Do not add a generic image to chase Discover.",
		Safety:       "Keep publishability, moderation labels, viewer visibility, Discover eligibility, and custom-feed eligibility separate. Do not claim a post targets or qualifies for a feed without an exact supplied signal. Avoid generic auto-reply energy, fake curiosity, dunking, and unverified community references.",
	},
	"threads": {
		Platform:   "threads",
		Native:     true,
		Objectives: []string{"conversation", "community_growth", "follows", "clicks", "cross_meta_reach"},
		Archetypes: []string{
			"specific_argument", "builder_question", "media_context", "original_take", "lesson", "current_reference",
		},
		Distribution: "Threads rewards original platform-native posts, topic and community relevance, useful context around media, and conversations that continue after publishing. Recommendation eligibility and cross-Meta reach are separate from basic publishability.",
		Writing:      "Use casual public-conversation language around one specific tension. Give readers an easy sincere reply path, not a forced engagement question. Write original Threads wording rather than resizing an X post. Use a current reference only when supplied evidence makes it relevant. Follow-up notes may suggest how the author can take part after publishing, but never generate automatic replies.",
		Media:        "A visual needs written context that explains the proof, demo, punchline, or trade-off. Prefer before-and-after artifacts, product demos, and images that support the conversation. Do not leave media to carry an unstated claim.",
		Safety:       "Do not assume a topic, community, recommendation status, or cross-Meta eligibility that OpenPost did not supply. Do not copy an X punchline, ask a generic question, or recommend reply automation. Keep policy warnings separate from the draft.",
	},
}

func policyFor(platform string) (platformPolicy, bool) {
	key := strings.ToLower(strings.TrimSpace(platform))
	if key == "" {
		return platformPolicy{}, false
	}
	if policy, ok := platformPolicies[key]; ok {
		return policy, true
	}
	return platformPolicy{
		Platform:     key,
		Native:       false,
		Objectives:   []string{"clarity"},
		Archetypes:   []string{"straight_adaptation"},
		Distribution: "OpenPost has no platform-specific creative model for this destination. Produce a conservative publishable adaptation and do not claim it is optimized for reach or recommendations.",
		Writing:      "Preserve the factual kernel, thesis, voice, and useful context. Fit the connected account's current output limits without inventing platform conventions, hashtags, engagement prompts, or algorithm advice.",
		Media:        "Keep existing media and recommend new media only when it is necessary proof or context. Do not add decorative generated media.",
		Safety:       "Label this as a basic adaptation. If a safe adaptation would change the meaning or require unknown provider behavior, keep the current text and warn that it was not adapted.",
	}, true
}

func policyContexts(platforms []string) []platformPolicy {
	contexts := make([]platformPolicy, 0, len(platforms))
	seen := make(map[string]struct{}, len(platforms))
	for _, platform := range platforms {
		key := strings.ToLower(strings.TrimSpace(platform))
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		policy, ok := policyFor(key)
		if !ok {
			continue
		}
		seen[key] = struct{}{}
		contexts = append(contexts, policy)
	}
	return contexts
}
