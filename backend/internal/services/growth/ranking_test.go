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

func TestReciprocityBalancedBeatsCelebrityAndMassFollow(t *testing.T) {
	t.Parallel()
	base := platform.GrowthCandidate{RemoteID: "base", Handle: "h", MutualCount: 2, Signals: []string{"friends_of_friends"}, DisplayName: "Test", Bio: "bio with enough length", AvatarURL: "https://cdn.test/a.jpg"}
	balanced := base
	balanced.Handle = "balanced"
	balanced.FollowersCount = 500
	balanced.FollowingCount = 520
	celebrity := base
	celebrity.Handle = "celebrity"
	celebrity.FollowersCount = 50000
	celebrity.FollowingCount = 20
	massFollow := base
	massFollow.Handle = "massfollow"
	massFollow.FollowersCount = 50
	massFollow.FollowingCount = 5000
	sBal := ScoreCandidate(balanced)
	sCeleb := ScoreCandidate(celebrity)
	sMass := ScoreCandidate(massFollow)
	require.Greater(t, sBal, sCeleb, "balanced should beat celebrity when graph evidence equal")
	require.Greater(t, sBal, sMass, "balanced should beat mass-follow when graph evidence equal")
	// graph evidence remains dominant: high mutual beats balanced reciprocity
	highMutualCelebrity := celebrity
	highMutualCelebrity.MutualCount = 8
	highMutualCelebrity.FollowedBy = true
	lowMutualBalanced := balanced
	lowMutualBalanced.MutualCount = 0
	require.Greater(t, ScoreCandidate(highMutualCelebrity), ScoreCandidate(lowMutualBalanced), "graph evidence should remain dominant over reciprocity")
}

func TestReciprocitySmoothNoDiscontinuity(t *testing.T) {
	t.Parallel()
	// Small changes in following count should not cause large jumps
	c1 := platform.GrowthCandidate{RemoteID: "1", Handle: "h", MutualCount: 1, Signals: []string{"suggestion"}, FollowersCount: 100, FollowingCount: 100}
	c2 := platform.GrowthCandidate{RemoteID: "1", Handle: "h", MutualCount: 1, Signals: []string{"suggestion"}, FollowersCount: 100, FollowingCount: 105}
	diff := ScoreCandidate(c1) - ScoreCandidate(c2)
	if diff < 0 {
		diff = -diff
	}
	require.Less(t, diff, 2.0, "smooth reciprocity should not have brittle discontinuity")
}
