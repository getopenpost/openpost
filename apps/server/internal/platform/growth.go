package platform

import "context"

// GrowthCandidate is a provider-neutral discovery result used by the
// federated growth feature. It carries only the fields the service needs
// to rank and render candidates without persisting provider data.
type GrowthCandidate struct {
	RemoteID       string
	Handle         string
	DisplayName    string
	Bio            string
	AvatarURL      string
	ProfileURL     string
	FollowersCount int
	FollowingCount int

	MutualCount  int
	Mutuals      []GrowthMutualProfile
	MutualsExact bool

	FollowedBy bool // candidate follows viewer
	Following  bool // viewer follows candidate

	Signals []string
}

// GrowthMutualProfile is a small sample of a candidate's mutual
// connections with the viewer.
type GrowthMutualProfile struct {
	RemoteID    string
	Handle      string
	DisplayName string
	AvatarURL   string
}

// GrowthDiscoveryInput drives provider discovery. AccessToken is the
// viewer credential, ViewerID is the remote account ID, Limit is the
// requested result count after normalization.
type GrowthDiscoveryInput struct {
	AccessToken string
	ViewerID    string
	Limit       int
}

// GrowthFollowResult normalizes provider follow state so the service can
// distinguish confirmed following from a pending follow request.
type GrowthFollowResult struct {
	ProviderState     string // "following" or "requested"
	ProviderReference string // record URI or relationship identifier
}

// GrowthDiscoverer is an optional capability for providers that support
// candidate discovery.
type GrowthDiscoverer interface {
	DiscoverGrowthCandidates(ctx context.Context, input GrowthDiscoveryInput) ([]GrowthCandidate, error)
}

// GrowthFollower is an optional capability for providers that support
// following a candidate. ViewerID is included even when the provider
// does not require it so callers have one uniform seam.
type GrowthFollower interface {
	FollowGrowthCandidate(ctx context.Context, accessToken, viewerID, candidateID string) (GrowthFollowResult, error)
}
