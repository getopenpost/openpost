package platform

import "context"

// EngagementSupport describes a provider's normalized comment and reply capabilities.
type EngagementSupport struct {
	Enabled        bool
	RequiredScopes []string
	CanReply       bool
	CanHide        bool
	CanDelete      bool
	CanLike        bool
	Unavailable    string
}

// EngagementAdapter is the optional provider seam used by Engagement.
type EngagementAdapter interface {
	CommentAdapter
	EngagementSupport() EngagementSupport
}

// IncrementalCommentRequest identifies one bounded provider comment page. Cursors
// are opaque to callers and must never contain credentials or response bodies.
type IncrementalCommentRequest struct {
	SinceID   string
	NextToken string
	Limit     int
}

// IncrementalCommentPage is one commit-safe page of comments.
type IncrementalCommentPage struct {
	Comments  []Comment
	NextToken string
	HighestID string
}

// IncrementalCommentAdapter is an optional seam for providers that support a
// high-water mark and bounded continuation-token paging.
type IncrementalCommentAdapter interface {
	ListCommentPage(ctx context.Context, accessToken, accountID, externalID string, request IncrementalCommentRequest) (IncrementalCommentPage, error)
}
