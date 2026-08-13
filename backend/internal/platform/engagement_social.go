package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

func (m *MastodonAdapter) EngagementSupport() EngagementSupport {
	return EngagementSupport{Enabled: true, CanReply: true, CanDelete: true, CanLike: true}
}

func (m *MastodonAdapter) ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error) {
	body, err := DoRequest(ctx, http.MethodGet, m.instanceURL+"/api/v1/statuses/"+url.PathEscape(externalID)+"/context", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("fetching Mastodon replies: %w", err)
	}
	var response struct {
		Descendants []mastodonMessageStatus `json:"descendants"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding Mastodon replies: %w", err)
	}
	comments := make([]Comment, 0, len(response.Descendants))
	for _, status := range response.Descendants {
		attachments := make([]CommentAttachment, 0, len(status.MediaAttachments))
		for _, attachment := range status.MediaAttachments {
			attachments = append(attachments, CommentAttachment{
				Type:      attachment.Type,
				URL:       attachment.URL,
				Thumbnail: attachment.PreviewURL,
				AltText:   attachment.Description,
			})
		}
		comments = append(comments, Comment{
			ID: status.ID, AuthorID: status.Account.ID, AuthorName: status.Account.DisplayName,
			AuthorHandle: prefixHandle(status.Account.Acct), AuthorAvatarURL: status.Account.Avatar,
			Text: mastodonPlainText(status.Content), CreatedAt: status.CreatedAt, UpdatedAt: status.EditedAt,
			Attachments: attachments, IsOurs: status.Account.ID == accountID, CanReply: true,
			CanDelete: status.Account.ID == accountID, CanLike: !status.Favourited,
			CanUnlike: status.Favourited, Liked: status.Favourited, LikeStateKnown: true,
		})
	}
	return comments, nil
}

func (m *MastodonAdapter) ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error) {
	result, err := m.Publish(ctx, accessToken, accountID, &PublishRequest{Content: message, ReplyToID: commentID})
	return result.ExternalID, err
}

func (m *MastodonAdapter) HideComment(context.Context, string, string, string) error {
	return fmt.Errorf("mastodon hide reply: %w", ErrUnsupportedCommentAction)
}

func (m *MastodonAdapter) DeleteComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := DoRequest(ctx, http.MethodDelete, m.instanceURL+"/api/v1/statuses/"+url.PathEscape(commentID), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	return err
}

func (m *MastodonAdapter) LikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := DoRequest(ctx, http.MethodPost, m.instanceURL+"/api/v1/statuses/"+url.PathEscape(commentID)+"/favourite", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	return err
}

func (m *MastodonAdapter) UnlikeComment(ctx context.Context, accessToken, _ string, commentID string) error {
	_, err := DoRequest(ctx, http.MethodPost, m.instanceURL+"/api/v1/statuses/"+url.PathEscape(commentID)+"/unfavourite", nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	return err
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
	body, err := DoRequest(ctx, http.MethodGet, b.pdsURL+"/xrpc/app.bsky.feed.getPostThread?"+query.Encode(), nil, map[string]string{
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
			replyRef, _ := json.Marshal(map[string]any{
				"uri": reply.Post.URI, "cid": reply.Post.CID,
				"_root": map[string]string{"uri": reference.URI, "cid": reference.CID},
			})
			parentID := ""
			if reply.Post.Record.Reply != nil {
				parentID = reply.Post.Record.Reply.Parent.URI
			}
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
	_, err := DoJSON(ctx, http.MethodPost, b.pdsURL+"/xrpc/com.atproto.repo.deleteRecord", map[string]string{
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
	query := url.Values{
		"query":        {"conversation_id:" + externalID},
		"tweet.fields": {"author_id,created_at,conversation_id,in_reply_to_user_id,referenced_tweets,attachments"},
		"expansions":   {"author_id,attachments.media_keys"},
		"user.fields":  {"username,name,profile_image_url"},
		"media.fields": {"media_key,type,url,preview_image_url,alt_text"},
		"max_results":  {"100"},
	}
	body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, x.apiURL("/2/tweets/search/recent")+"?"+query.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("fetching X replies: %w", err)
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
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding X replies: %w", err)
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
	return comments, nil
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
	if err := youtubeAPIError(response); err != nil {
		return nil, err
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
	var result struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				TopLevelComment youtubeComment `json:"topLevelComment"`
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
	appendComment := func(comment youtubeComment) {
		ours := comment.Snippet.AuthorChannelID.Value == accountID
		comments = append(comments, Comment{
			ID: comment.ID, ParentID: comment.Snippet.ParentID, ConversationID: externalID,
			AuthorID: comment.Snippet.AuthorChannelID.Value, AuthorName: comment.Snippet.AuthorDisplayName,
			AuthorAvatarURL: comment.Snippet.AuthorProfileImageURL, Text: comment.Snippet.TextDisplay,
			CreatedAt: comment.Snippet.PublishedAt, IsOurs: ours, Hidden: comment.Snippet.ModerationStatus == "rejected",
			CanReply: true, CanHide: true, CanDelete: ours,
		})
	}
	for _, thread := range result.Items {
		appendComment(thread.Snippet.TopLevelComment)
		for _, reply := range thread.Replies.Comments {
			appendComment(reply)
		}
	}
	sort.Slice(comments, func(a, b int) bool { return comments[a].CreatedAt > comments[b].CreatedAt })
	return comments, nil
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
