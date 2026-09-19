package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

func (m *MastodonAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true, CanLike: true}
}

func (m *MastodonAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	return compatListComments(ctx, m.compat.instanceURL, accessToken, accountID, externalID, "Mastodon")
}

func (m *MastodonAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	result, err := m.Publish(ctx, accessToken, accountID, &PublishRequest{Content: message, ReplyToID: commentID})
	return result.ExternalID, err
}

func (m *MastodonAdapter) HideComment(context.Context, string, string, string) error {
	return fmt.Errorf("mastodon hide reply: %w", ErrUnsupportedCommentAction)
}

func (m *MastodonAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	return compatDeleteComment(ctx, m.compat.instanceURL, accessToken, commentID, "mastodon")
}

func (m *MastodonAdapter) LikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	return compatFavouriteComment(ctx, m.compat.instanceURL, accessToken, commentID, "mastodon")
}

func (m *MastodonAdapter) UnlikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	return compatUnfavouriteComment(ctx, m.compat.instanceURL, accessToken, commentID, "mastodon")
}

type blueskyThreadNode struct {
	Post struct {
		URI    string `json:"uri"`
		CID    string `json:"cid"`
		Author struct {
			DID         string `json:"did"`
			Handle      string `json:"handle"`
			DisplayName string `json:"displayName"`
			Avatar      string `json:"avatar"`
		} `json:"author"`
		Record struct {
			Text      string `json:"text"`
			CreatedAt string `json:"createdAt"`
			Reply     *struct {
				Parent struct {
					URI string `json:"uri"`
				} `json:"parent"`
			} `json:"reply"`
		} `json:"record"`
	} `json:"post"`
	Replies []blueskyThreadNode `json:"replies"`
}

func (b *BlueskyAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true}
}

func (b *BlueskyAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	var reference struct {
		URI string `json:"uri"`
		CID string `json:"cid"`
	}
	if err := json.Unmarshal([]byte(externalID), &reference); err != nil || reference.URI == "" {
		return nil, fmt.Errorf("bluesky post reference is invalid")
	}
	query := url.Values{"uri": {reference.URI}, "depth": {"100"}, "parentHeight": {"0"}}
	body, err := b.doRequest(ctx, http.MethodGet, b.pdsURL+"/xrpc/app.bsky.feed.getPostThread?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("fetching Bluesky replies: %w", err)
	}
	var response struct {
		Thread blueskyThreadNode `json:"thread"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding Bluesky replies: %w", err)
	}
	comments := make([]Comment, 0)
	var walk func(blueskyThreadNode)
	walk = func(node blueskyThreadNode) {
		for _, reply := range node.Replies {
			// Blocked and not-found thread entries carry no post to show or reply to.
			if reply.Post.URI == "" {
				continue
			}
			replyRef, _ := json.Marshal(map[string]any{
				"uri": reply.Post.URI, "cid": reply.Post.CID,
				"_root": map[string]string{"uri": reference.URI, "cid": reference.CID},
			})
			// Use the same encoding as the parent comment's ID so nested
			// replies can be matched to the comment they answer.
			parentRef, _ := json.Marshal(map[string]any{
				"uri": node.Post.URI, "cid": node.Post.CID,
				"_root": map[string]string{"uri": reference.URI, "cid": reference.CID},
			})
			parentID := string(parentRef)
			comments = append(comments, Comment{
				ID: string(replyRef), ParentID: parentID, ConversationID: reference.URI,
				AuthorID: reply.Post.Author.DID, AuthorName: reply.Post.Author.DisplayName,
				AuthorHandle: prefixHandle(reply.Post.Author.Handle), AuthorAvatarURL: reply.Post.Author.Avatar,
				Text: reply.Post.Record.Text, CreatedAt: reply.Post.Record.CreatedAt,
				IsOurs: reply.Post.Author.DID == accountID, CanReply: true, CanDelete: reply.Post.Author.DID == accountID,
			})
			walk(reply)
		}
	}
	walk(response.Thread)
	return comments, nil
}

func (b *BlueskyAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	result, err := b.Publish(ctx, accessToken, accountID, &PublishRequest{Content: message, ReplyToID: commentID})
	return result.ExternalID, err
}

func (b *BlueskyAdapter) HideComment(context.Context, string, string, string) error {
	return fmt.Errorf("bluesky hide reply: %w", ErrUnsupportedCommentAction)
}

func (b *BlueskyAdapter) DeleteComment(ctx context.Context, accessToken, accountID, commentID string) error {
	var reference struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal([]byte(commentID), &reference); err != nil || reference.URI == "" {
		return fmt.Errorf("bluesky reply reference is invalid")
	}
	parts := strings.Split(reference.URI, "/")
	rkey := parts[len(parts)-1]
	_, err := b.doJSON(ctx, http.MethodPost, b.pdsURL+"/xrpc/com.atproto.repo.deleteRecord", map[string]string{
		"repo": accountID, "collection": "app.bsky.feed.post", "rkey": rkey,
	}, map[string]string{headerAuthorization: bearerPrefix + accessToken})
	return err
}

func (x *XAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{
		Enabled: true, CanReply: true, CanDelete: true, CanLike: true,
		Unavailable: "X recent search collects replies from the provider's current search window.",
	}
}

func (x *XAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	page, err := x.ListCommentPage(ctx, accessToken, accountID, externalID, IncrementalCommentRequest{Limit: 100})
	return page.Comments, err
}

//nolint:gocyclo // One bounded page maps X query cursors, expansions, attachments, and safe provider errors.
func (x *XAdapter) ListCommentPage(
	ctx context.Context,
	accessToken, accountID, externalID string,
	request IncrementalCommentRequest,
) (IncrementalCommentPage, error) {
	limit := request.Limit
	if limit < 10 || limit > 100 {
		limit = 100
	}
	query := url.Values{
		"query":        {"conversation_id:" + externalID},
		"tweet.fields": {"author_id,created_at,conversation_id,in_reply_to_user_id,referenced_tweets,attachments"},
		"expansions":   {"author_id,attachments.media_keys"},
		"user.fields":  {"username,name,profile_image_url"},
		"media.fields": {"media_key,type,url,preview_image_url,alt_text"},
		"max_results":  {fmt.Sprintf("%d", limit)},
	}
	if sinceID := strings.TrimSpace(request.SinceID); sinceID != "" {
		query.Set("since_id", sinceID)
	}
	if nextToken := strings.TrimSpace(request.NextToken); nextToken != "" {
		query.Set("next_token", nextToken)
	}
	body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, x.apiURL("/2/tweets/search/recent")+"?"+query.Encode(), nil, nil)
	if err != nil {
		var providerErr *HTTPError
		if errors.As(err, &providerErr) && providerErr.StatusCode == http.StatusPaymentRequired {
			providerErr.Code = "credits_depleted"
			providerErr.RetryAfter = 24 * time.Hour
		}
		return IncrementalCommentPage{}, fmt.Errorf("fetching X replies: %w", err)
	}
	var response struct {
		Data []struct {
			ID             string `json:"id"`
			Text           string `json:"text"`
			AuthorID       string `json:"author_id"`
			CreatedAt      string `json:"created_at"`
			ConversationID string `json:"conversation_id"`
			Attachments    struct {
				MediaKeys []string `json:"media_keys"`
			} `json:"attachments"`
			ReferencedTweets []struct {
				Type string `json:"type"`
				ID   string `json:"id"`
			} `json:"referenced_tweets"`
		} `json:"data"`
		Includes struct {
			Users []struct {
				ID              string `json:"id"`
				Username        string `json:"username"`
				Name            string `json:"name"`
				ProfileImageURL string `json:"profile_image_url"`
			} `json:"users"`
			Media []struct {
				MediaKey        string `json:"media_key"`
				Type            string `json:"type"`
				URL             string `json:"url"`
				PreviewImageURL string `json:"preview_image_url"`
				AltText         string `json:"alt_text"`
			} `json:"media"`
		} `json:"includes"`
		Meta struct {
			NewestID  string `json:"newest_id"`
			NextToken string `json:"next_token"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return IncrementalCommentPage{}, fmt.Errorf("decoding X replies: %w", err)
	}
	users := map[string]struct{ Username, Name, Avatar string }{}
	for _, user := range response.Includes.Users {
		users[user.ID] = struct{ Username, Name, Avatar string }{user.Username, user.Name, user.ProfileImageURL}
	}
	media := make(map[string]CommentAttachment, len(response.Includes.Media))
	for _, item := range response.Includes.Media {
		media[item.MediaKey] = CommentAttachment{
			Type: item.Type, URL: item.URL, Thumbnail: item.PreviewImageURL, AltText: item.AltText,
		}
	}
	comments := make([]Comment, 0, len(response.Data))
	for _, tweet := range response.Data {
		if tweet.ID == externalID {
			continue
		}
		user := users[tweet.AuthorID]
		parentID := ""
		for _, reference := range tweet.ReferencedTweets {
			if reference.Type == "replied_to" {
				parentID = reference.ID
				break
			}
		}
		attachments := make([]CommentAttachment, 0, len(tweet.Attachments.MediaKeys))
		for _, mediaKey := range tweet.Attachments.MediaKeys {
			if item, ok := media[mediaKey]; ok {
				attachments = append(attachments, item)
			}
		}
		comments = append(comments, Comment{
			ID: tweet.ID, ParentID: parentID, ConversationID: tweet.ConversationID, AuthorID: tweet.AuthorID,
			AuthorName: user.Name, AuthorHandle: prefixHandle(user.Username), AuthorAvatarURL: user.Avatar,
			Text: tweet.Text, CreatedAt: tweet.CreatedAt, IsOurs: tweet.AuthorID == accountID,
			Attachments: attachments, CanReply: true, CanDelete: tweet.AuthorID == accountID,
			CanLike: true, CanUnlike: true,
		})
	}
	return IncrementalCommentPage{
		Comments: comments, NextToken: strings.TrimSpace(response.Meta.NextToken), HighestID: strings.TrimSpace(response.Meta.NewestID),
	}, nil
}

func (x *XAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	result, err := x.Publish(ctx, accessToken, accountID, &PublishRequest{Content: message, ReplyToID: commentID})
	return result.ExternalID, err
}

func (x *XAdapter) HideComment(context.Context, string, string, string) error {
	return fmt.Errorf("x hide reply: %w", ErrUnsupportedCommentAction)
}

func (x *XAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := x.doSignedRequest(ctx, accessToken, http.MethodDelete, x.apiURL("/2/tweets/")+url.PathEscape(commentID), nil, nil)
	return err
}

func (x *XAdapter) LikeComment(ctx context.Context, accessToken, accountID, commentID string) error {
	body, err := json.Marshal(map[string]string{"tweet_id": commentID})
	if err != nil {
		return err
	}
	_, err = x.doSignedRequest(ctx, accessToken, http.MethodPost, x.apiURL("/2/users/")+url.PathEscape(accountID)+"/likes", bytes.NewReader(body), map[string]string{
		headerContentType: contentTypeJSON,
	})
	return err
}

func (x *XAdapter) UnlikeComment(ctx context.Context, accessToken, accountID, commentID string) error {
	_, err := x.doSignedRequest(ctx, accessToken, http.MethodDelete, x.apiURL("/2/users/")+url.PathEscape(accountID)+"/likes/"+url.PathEscape(commentID), nil, nil)
	return err
}

func (y *YouTubeAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{
		Enabled: true, CanReply: true, CanHide: true, CanDelete: true,
		RequiredScopes: []string{"https://www.googleapis.com/auth/youtube"},
	}
}

type youtubeComment struct {
	ID      string `json:"id"`
	Snippet struct {
		AuthorDisplayName     string `json:"authorDisplayName"`
		AuthorProfileImageURL string `json:"authorProfileImageUrl"`
		AuthorChannelID       struct {
			Value string `json:"value"`
		} `json:"authorChannelId"`
		TextDisplay      string `json:"textDisplay"`
		PublishedAt      string `json:"publishedAt"`
		ParentID         string `json:"parentId"`
		ModerationStatus string `json:"moderationStatus"`
	} `json:"snippet"`
}

func youtubeCommentAsEngagement(comment youtubeComment, accountID, videoID string) Comment {
	ours := comment.Snippet.AuthorChannelID.Value == accountID
	return Comment{
		ID: comment.ID, ParentID: comment.Snippet.ParentID, ConversationID: videoID,
		AuthorID: comment.Snippet.AuthorChannelID.Value, AuthorName: comment.Snippet.AuthorDisplayName,
		AuthorAvatarURL: comment.Snippet.AuthorProfileImageURL, Text: comment.Snippet.TextDisplay,
		CreatedAt: comment.Snippet.PublishedAt, IsOurs: ours, Hidden: comment.Snippet.ModerationStatus == "rejected",
		CanReply: true, CanHide: true, CanDelete: ours,
	}
}

func listYouTubeCommentReplies(ctx context.Context, accessToken, parentID string) ([]youtubeComment, error) {
	query := url.Values{
		"part": {"snippet"}, "parentId": {parentID}, "maxResults": {"100"},
		"textFormat": {"plainText"},
	}
	response, err := doYouTubeRequest(ctx, http.MethodGet, youtubeAPIBaseURL+"/comments?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, err
	}
	if err := youtubeCommentReadError(response); err != nil {
		return nil, err
	}
	var result struct {
		Items []youtubeComment `json:"items"`
	}
	if err := json.Unmarshal(response.body, &result); err != nil {
		return nil, fmt.Errorf("decoding YouTube comment replies: %w", err)
	}
	return result.Items, nil
}

func (y *YouTubeAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	query := url.Values{
		"part": {"snippet,replies"}, "videoId": {externalID}, "maxResults": {"100"},
		"textFormat": {"plainText"}, "order": {"time"},
	}
	response, err := doYouTubeRequest(ctx, http.MethodGet, youtubeAPIBaseURL+"/commentThreads?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, err
	}
	if err := youtubeCommentReadError(response); err != nil {
		return nil, err
	}
	var result struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				TopLevelComment youtubeComment `json:"topLevelComment"`
				TotalReplyCount int            `json:"totalReplyCount"`
			} `json:"snippet"`
			Replies struct {
				Comments []youtubeComment `json:"comments"`
			} `json:"replies"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.body, &result); err != nil {
		return nil, fmt.Errorf("decoding YouTube comments: %w", err)
	}
	comments := make([]Comment, 0)
	for _, thread := range result.Items {
		comments = append(comments, youtubeCommentAsEngagement(thread.Snippet.TopLevelComment, accountID, externalID))
		replies := thread.Replies.Comments
		// replies.comments is a subset unless its length equals totalReplyCount.
		if parentID := thread.Snippet.TopLevelComment.ID; thread.Snippet.TotalReplyCount > len(replies) && parentID != "" {
			full, err := listYouTubeCommentReplies(ctx, accessToken, parentID)
			if err != nil {
				return nil, err
			}
			replies = full
		}
		for _, reply := range replies {
			comments = append(comments, youtubeCommentAsEngagement(reply, accountID, externalID))
		}
	}
	sort.Slice(comments, func(a, b int) bool { return comments[a].CreatedAt > comments[b].CreatedAt })
	return comments, nil
}

// youtubeCommentReadError keeps YouTube's 403 reasons that are not
// authorization failures from being reported as a revoked grant: comments
// turned off on the video, and an exhausted daily quota.
func youtubeCommentReadError(response *youtubeHTTPResponse) error {
	err := youtubeAPIError(response)
	var providerErr *HTTPError
	if response.statusCode != http.StatusForbidden || !errors.As(err, &providerErr) {
		return err
	}
	reason := strings.TrimSpace(youtubeErrorReason(response.body))
	if !safeProviderCode.MatchString(reason) {
		return err
	}
	normalizedReason := strings.ToLower(reason)
	switch {
	case normalizedReason == "commentsdisabled":
		providerErr.StatusCode = http.StatusNotFound
		providerErr.Code = reason
	case strings.Contains(normalizedReason, "quota") || strings.Contains(normalizedReason, "ratelimit") || strings.Contains(normalizedReason, "dailylimit"):
		providerErr.StatusCode = http.StatusTooManyRequests
		providerErr.Code = reason
	}
	return err
}

func (y *YouTubeAdapter) ReplyToComment(ctx context.Context, accessToken, _ string, commentID, message string) (string, error) {
	payload, _ := json.Marshal(map[string]any{
		"snippet": map[string]string{"parentId": commentID, "textOriginal": strings.TrimSpace(message)},
	})
	response, err := doYouTubeRequest(ctx, http.MethodPost, youtubeAPIBaseURL+"/comments?part=snippet", bytes.NewReader(payload), map[string]string{
		headerAuthorization: bearerPrefix + accessToken, headerContentType: contentTypeJSON,
	})
	if err != nil {
		return "", err
	}
	if err := youtubeAPIError(response); err != nil {
		return "", err
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.body, &result); err != nil {
		return "", err
	}
	return result.ID, nil
}

func (y *YouTubeAdapter) HideComment(ctx context.Context, accessToken, _ string, commentID string) error {
	query := url.Values{"id": {commentID}, "moderationStatus": {"rejected"}, "banAuthor": {"false"}}
	response, err := doYouTubeRequest(ctx, http.MethodPost, youtubeAPIBaseURL+"/comments/setModerationStatus?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return err
	}
	return youtubeAPIError(response)
}

func (y *YouTubeAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	query := url.Values{"id": {commentID}}
	response, err := doYouTubeRequest(ctx, http.MethodDelete, youtubeAPIBaseURL+"/comments?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return err
	}
	return youtubeAPIError(response)
}
