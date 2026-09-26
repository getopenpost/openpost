package platform

import (
	"context"
	"fmt"
	"strings"
)

// FirstCommentSettingKey is the pipeline setting shared by every provider
// that supports a post-success follow-up comment.
const FirstCommentSettingKey = "first_comment"

// SupportsFirstComment reports whether a provider exposes the follow-up
// comment setting. Capability-gated: only listed providers declare it.
func SupportsFirstComment(provider string) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerLinkedIn, providerFacebook, providerInstagram, providerYouTube:
		return true
	default:
		return false
	}
}

// FirstCommentMessage extracts the configured follow-up comment. Empty means
// no child operation is required.
func FirstCommentMessage(provider string, settings map[string]interface{}) string {
	if !SupportsFirstComment(provider) {
		return ""
	}
	return settingString(settings, FirstCommentSettingKey)
}

// FirstCommentPoster posts a top-level comment on an already-published post.
// It is a post-success child operation: callers must persist the parent
// before calling it and must never republish the parent when it fails.
type FirstCommentPoster interface {
	PostFirstComment(ctx context.Context, accessToken, accountID, externalID, message string) (string, error)
}

func requireFirstComment(message, externalID string) (string, string, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return "", "", fmt.Errorf("first comment requires message text")
	}
	if strings.TrimSpace(externalID) == "" {
		return "", "", fmt.Errorf("first comment requires a published post id")
	}
	return message, strings.TrimSpace(externalID), nil
}

// PostFirstComment publishes a top-level comment on a Facebook Page post.
func (f *FacebookAdapter) PostFirstComment(ctx context.Context, accessToken, _, externalID, message string) (string, error) {
	message, target, err := requireFirstComment(message, externalID)
	if err != nil {
		return "", err
	}
	return f.publishCommentReply(ctx, accessToken, target, message)
}

// PostFirstComment publishes a top-level comment on a LinkedIn post.
func (l *LinkedInAdapter) PostFirstComment(ctx context.Context, accessToken, accountID, externalID, message string) (string, error) {
	message, target, err := requireFirstComment(message, externalID)
	if err != nil {
		return "", err
	}
	return l.postComment(ctx, accessToken, linkedInAuthorURN(accountID), target, message)
}

// PostFirstComment publishes a top-level comment on Instagram media.
func (i *InstagramAdapter) PostFirstComment(ctx context.Context, accessToken, _, externalID, message string) (string, error) {
	message, target, err := requireFirstComment(message, externalID)
	if err != nil {
		return "", err
	}
	return i.publishTopLevelComment(ctx, accessToken, target, message)
}
