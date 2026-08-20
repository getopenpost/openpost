package growth

import (
	"math"
	"sort"
	"strings"

	"github.com/openpost/backend/internal/platform"
)

type scoredCandidate struct {
	candidate platform.GrowthCandidate
	score     float64
}

// ScoreCandidate computes deterministic score per spec:
// 55% mutual log-saturated near 8, 20% provider evidence, 15% reciprocity with spam penalty, 10% profile quality, plus bonus for follows_viewer.
func ScoreCandidate(c platform.GrowthCandidate) float64 {
	// Mutual evidence: log saturated near 8 mutuals
	mutualNorm := 0.0
	if c.MutualCount > 0 {
		mutualNorm = math.Log1p(float64(c.MutualCount)) / math.Log1p(8)
		if mutualNorm > 1.15 {
			mutualNorm = 1.15
		}
		if mutualNorm > 1 {
			// soft saturation: diminishing returns beyond 8
			mutualNorm = 1 + (mutualNorm-1)*0.3
		}
	}
	mutualScore := mutualNorm * 55

	// Provider evidence
	providerScore := providerEvidenceScore(c.Signals) * 20

	// Reciprocity
	reciprocityScore := reciprocityScore(c.FollowersCount, c.FollowingCount) * 15

	// Profile quality
	qualityScore := profileQualityScore(c) * 10

	total := mutualScore + providerScore + reciprocityScore + qualityScore

	// Strong bonus when candidate follows viewer and viewer does not follow them
	if c.FollowedBy && !c.Following {
		total += 12
	}

	// Clamp 0-100 but bonus may exceed; allow up to 112 but cap at 100? Keep raw for ranking then clamp 0-100
	if total > 100 {
		total = 100
	}
	if total < 0 {
		total = 0
	}
	// Round to 2 decimals for stable sorting
	total = math.Round(total*100) / 100
	return total
}

func providerEvidenceScore(signals []string) float64 {
	if len(signals) == 0 {
		return 0
	}
	max := 0.0
	for _, s := range signals {
		norm := strings.ToLower(strings.TrimSpace(s))
		var v float64
		switch norm {
		case "friends_of_friends", "friend_of_friend":
			v = 1.0
		case "similar_to_recently_followed", "similar", "similar_to_recent":
			v = 0.75
		case "most_interactions", "interactions", "most_interacted":
			v = 0.6
		case "suggestion", "suggested":
			v = 0.4
		case "most_followed", "popular", "trending":
			v = 0.2
		default:
			// unknown signals contribute minimal
			v = 0.15
		}
		if v > max {
			max = v
		}
	}
	return max
}

func reciprocityScore(followers, following int) float64 {
	if followers < 0 {
		followers = 0
	}
	if following < 0 {
		following = 0
	}
	// Balanced following-to-followers relationship is ideal.
	// Celebrity (followers>>following) and mass-follow (following>>followers) are both penalized.
	// Use log-ratio gaussian centered at 0 (balanced). Smooth, no discontinuity.
	a := float64(followers + 1)
	b := float64(following + 1)
	logRatio := math.Log(a / b) // 0 balanced, positive celebrity, negative mass-follow
	sigma := 1.2
	score := math.Exp(-(logRatio * logRatio) / (2 * sigma * sigma))
	// Slight boost for reasonable absolute scale: very tiny accounts slightly less attractive
	// but do not reintroduce celebrity bias. Scale adjustment is small.
	if followers < 5 && following < 5 {
		score *= 0.85
	}
	if score < 0 {
		score = 0
	}
	if score > 1 {
		score = 1
	}
	return score
}

func profileQualityScore(c platform.GrowthCandidate) float64 {
	score := 0.0
	if strings.TrimSpace(c.DisplayName) != "" {
		score += 0.25
	}
	if strings.TrimSpace(c.Bio) != "" && len([]rune(strings.TrimSpace(c.Bio))) > 10 {
		score += 0.35
	} else if strings.TrimSpace(c.Bio) != "" {
		score += 0.15
	}
	if strings.TrimSpace(c.AvatarURL) != "" {
		score += 0.25
	}
	if strings.TrimSpace(c.Handle) != "" {
		score += 0.15
	}
	if score > 1 {
		score = 1
	}
	return score
}

// RankCandidates scores and sorts candidates deterministically.
func RankCandidates(cands []platform.GrowthCandidate) []platform.GrowthCandidate {
	scored := make([]scoredCandidate, 0, len(cands))
	for _, c := range cands {
		scored = append(scored, scoredCandidate{candidate: c, score: ScoreCandidate(c)})
	}
	sortScoredCandidates(scored)
	out := make([]platform.GrowthCandidate, 0, len(scored))
	for _, s := range scored {
		out = append(out, s.candidate)
	}
	return out
}

func scoreRanked(cands []platform.GrowthCandidate) []scoredCandidate {
	scored := make([]scoredCandidate, 0, len(cands))
	for _, c := range cands {
		scored = append(scored, scoredCandidate{candidate: c, score: ScoreCandidate(c)})
	}
	sortScoredCandidates(scored)
	return scored
}

func sortScoredCandidates(scored []scoredCandidate) {
	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		if scored[i].candidate.MutualCount != scored[j].candidate.MutualCount {
			return scored[i].candidate.MutualCount > scored[j].candidate.MutualCount
		}
		hi := strings.ToLower(strings.TrimSpace(scored[i].candidate.Handle))
		hj := strings.ToLower(strings.TrimSpace(scored[j].candidate.Handle))
		if hi != hj {
			return hi < hj
		}
		return scored[i].candidate.RemoteID < scored[j].candidate.RemoteID
	})
}
