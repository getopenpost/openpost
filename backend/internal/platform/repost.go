package platform

import "context"

// RepostRequest identifies the provider-owned post to reshare. Adapters must
// perform a native provider repost; creating a copied post is not equivalent.
type RepostRequest struct {
	SourceAccountID   string
	SourceInstanceURL string
	ExternalID        string
	ExternalURL       string
}

type RepostResult struct {
	ExternalID  string
	ExternalURL string
}

// RepostAdapter is an optional capability. Keeping it out of Adapter lets
// providers without a native repost API remain valid publishing adapters.
type RepostAdapter interface {
	Repost(ctx context.Context, accessToken, targetAccountID string, req RepostRequest) (RepostResult, error)
}
