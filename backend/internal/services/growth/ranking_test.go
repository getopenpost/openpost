package growth

import (
	"testing"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestRankingOrderAndMassFollowPenalty(t *testing.T) {
	t.Parallel()
	cands := []platform.GrowthCandidate{
		{RemoteID: "1", Handle: "alice", MutualCount: 8, Signals: []string{"friends_of_friends"}, FollowersCount: 100, FollowingCount: 100, DisplayName: "Alice", Bio: "hello world bio", AvatarURL: "https://cdn.test/a.jpg", FollowedBy: true},
		{RemoteID: "2", Handle: "bob", MutualCount: 0, Signals: []string{"most_followed"}, FollowersCount: 10, FollowingCount: 5000, DisplayName: "", Bio: "", AvatarURL: ""},
		{RemoteID: "3", Handle: "carol", MutualCount: 2, Signals: []string{"suggestion"}, FollowersCount: 50, FollowingCount: 60, DisplayName: "Carol", Bio: "bio", AvatarURL: "https://cdn.test/c.jpg"},
	}
	ranked := RankCandidates(cands)
	require.Equal(t, "alice", ranked[0].Handle, "mutual evidence should dominate")
	require.Equal(t, "carol", ranked[1].Handle)
	require.Equal(t, "bob", ranked[2].Handle, "mass follow spam should be penalized to bottom")

	// Verify deterministic tie-breakers
	tie := []platform.GrowthCandidate{
		{RemoteID: "b", Handle: "zzz", MutualCount: 1, Signals: []string{"suggestion"}, FollowersCount: 10, FollowingCount: 10},
		{RemoteID: "a", Handle: "aaa", MutualCount: 1, Signals: []string{"suggestion"}, FollowersCount: 10, FollowingCount: 10},
	}
	rankedTie := RankCandidates(tie)
	require.Equal(t, "aaa", rankedTie[0].Handle)
	require.Equal(t, "a", rankedTie[0].RemoteID)
}

func TestScoreDeterministicAndLogSaturated(t *testing.T) {
	t.Parallel()
	c1 := platform.GrowthCandidate{RemoteID: "1", Handle: "h", MutualCount: 8, Signals: []string{"friends_of_friends"}, FollowersCount: 100, FollowingCount: 50}
	c2 := platform.GrowthCandidate{RemoteID: "1", Handle: "h", MutualCount: 16, Signals: []string{"friends_of_friends"}, FollowersCount: 100, FollowingCount: 50}
	s1 := ScoreCandidate(c1)
	s2 := ScoreCandidate(c2)
	require.Greater(t, s2, s1)
	// saturated: 8 vs 16 difference should be small (<5 points)
	require.Less(t, s2-s1, 5.0)

	// Bonus for follows_viewer
	c3 := platform.GrowthCandidate{RemoteID: "1", Handle: "h", MutualCount: 0, Signals: []string{"suggestion"}, FollowersCount: 10, FollowingCount: 10, FollowedBy: true, Following: false}
	c4 := platform.GrowthCandidate{RemoteID: "1", Handle: "h", MutualCount: 0, Signals: []string{"suggestion"}, FollowersCount: 10, FollowingCount: 10, FollowedBy: false}
	require.Greater(t, ScoreCandidate(c3), ScoreCandidate(c4))
}
