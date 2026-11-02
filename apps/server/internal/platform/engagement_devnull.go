package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const devNullCommentRequestLimit = 100

func (d *DevNullAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true}
}

type devNullCommentAuthor struct {
	ID        string `json:"id"`
	Handle    string `json:"handle"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// The public web replies endpoint returns serialized Commit models, rather
// than the device API's CommitResource. Both current author profiles and the
// previous user relation are accepted while the upstream rollout settles.
type devNullCommentCommit struct {
	ID           string               `json:"id"`
	ParentID     string               `json:"parent_id"`
	Body         string               `json:"body"`
	CreatedAt    string               `json:"created_at"`
	UpdatedAt    string               `json:"updated_at"`
	DeletedAt    string               `json:"deleted_at"`
	RepliesCount int                  `json:"replies_count"`
	Author       devNullCommentAuthor `json:"author"`
	User         devNullCommentAuthor `json:"user"`
	Images       []struct {
		URL         string `json:"url"`
		Description string `json:"description"`
	} `json:"images"`
}

// ListComments collects the public, approved replies and quotes shown beneath
// a commit. Cursor values stay opaque; upstream URLs are never followed.
// One budget covers pagination and descendants, and exhaustion fails the sync
// instead of allowing a partial collection to be recorded as complete.
func (d *DevNullAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	username, _, err := splitDevNullCredential(accessToken)
	if err != nil {
		return nil, err
	}
	root := d.analyticsCommitID(externalID)
	if root == "" {
		return nil, fmt.Errorf("dev/null comment collection requires a commit UUID or link")
	}
	queue := []string{root}
	queued := map[string]bool{root: true}
	seen := map[string]bool{}
	comments := make([]Comment, 0)
	requests := 0
	for len(queue) > 0 {
		parent := queue[0]
		queue = queue[1:]
		commits, err := d.listDevNullReplies(ctx, parent, &requests)
		if err != nil {
			return nil, err
		}
		for _, commit := range commits {
			id := d.analyticsCommitID(commit.ID)
			if id == "" || id == root {
				return nil, fmt.Errorf("dev/null answered with an invalid reply ID")
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			comments = append(comments, commit.comment(username, accountID, parent, root))
			if commit.RepliesCount > 0 && !queued[id] {
				queued[id] = true
				queue = append(queue, id)
			}
		}
	}
	return comments, nil
}

// listDevNullReplies reads every page for one parent within the shared budget.
func (d *DevNullAdapter) listDevNullReplies(ctx context.Context, parent string, requests *int) ([]devNullCommentCommit, error) {
	var commits []devNullCommentCommit
	cursor := ""
	cursors := map[string]bool{}
	for {
		if *requests >= devNullCommentRequestLimit {
			return nil, fmt.Errorf("dev/null comment collection exceeded its request limit")
		}
		(*requests)++
		query := url.Values{"limit": {"50"}}
		if cursor != "" {
			query.Set("cursor", cursor)
		}
		body, err := DoRequest(ctx, http.MethodGet, d.BaseURL()+"/commits/"+url.PathEscape(parent)+"/replies?"+query.Encode(), nil, map[string]string{"Accept": contentTypeJSON})
		if err != nil {
			return nil, fmt.Errorf("dev/null comment collection: %w", normalizeDevNullError(err))
		}
		var page struct {
			Data        []devNullCommentCommit `json:"data"`
			NextCursor  string                 `json:"next_cursor"`
			NextPageURL string                 `json:"next_page_url"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("decoding dev/null replies: %w", err)
		}
		if page.Data == nil || len(page.Data) > 50 {
			return nil, fmt.Errorf("dev/null answered with an invalid replies page")
		}
		if page.NextPageURL != "" && page.NextCursor == "" {
			return nil, fmt.Errorf("dev/null replies continuation is missing its cursor")
		}

		commits = append(commits, page.Data...)
		if page.NextCursor == "" {
			break
		}
		if cursors[page.NextCursor] {
			return nil, fmt.Errorf("dev/null repeated a replies cursor")
		}
		cursors[page.NextCursor] = true
		cursor = page.NextCursor
	}
	return commits, nil
}

func (c devNullCommentCommit) comment(username, accountID, parent, root string) Comment {
	author := c.Author
	if author.Handle == "" {
		author = c.User
	}
	comment := Comment{
		ID: c.ID, ParentID: firstNonEmptyString(c.ParentID, parent), ConversationID: root,
		AuthorID: author.ID, AuthorName: firstNonEmptyString(author.Name, author.Handle),
		AuthorHandle: author.Handle, AuthorAvatarURL: author.AvatarURL,
		Text: c.Body, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		Deleted: c.DeletedAt != "", CanReply: c.DeletedAt == "",
		IsOurs: (author.ID != "" && author.ID == accountID) || (author.Handle != "" && strings.EqualFold(author.Handle, username)),
	}
	if comment.Deleted {
		// A tombstone must never resurrect a deleted author's text or images.
		return Comment{ID: c.ID, ParentID: comment.ParentID, ConversationID: root, Deleted: true}
	}
	for _, image := range c.Images {
		if image.URL != "" {
			comment.Attachments = append(comment.Attachments, CommentAttachment{Type: "image", URL: image.URL, AltText: image.Description})
		}
	}
	return comment
}

func (d *DevNullAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	parent := d.analyticsCommitID(commentID)
	if parent == "" {
		return "", fmt.Errorf("dev/null replies require a commit UUID or link")
	}
	result, err := d.Publish(ctx, accessToken, accountID, &PublishRequest{Content: message, ReplyToID: parent})
	return result.ExternalID, err
}

func (d *DevNullAdapter) HideComment(context.Context, string, string, string) error {
	return fmt.Errorf("dev/null hide reply: %w", ErrUnsupportedCommentAction)
}

func (d *DevNullAdapter) DeleteComment(context.Context, string, string, string) error {
	return fmt.Errorf("dev/null delete reply: %w", ErrUnsupportedCommentAction)
}

var _ EngagementAdapter = (*DevNullAdapter)(nil)
