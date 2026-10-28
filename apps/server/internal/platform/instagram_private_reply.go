package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// PrivateCommentReplyAdapter is deliberately separate from SendMessage: a
// comment opens one private reply, not a normal outbound messaging window.
type PrivateCommentReplyAdapter interface {
	ReplyPrivatelyToComment(context.Context, string, string, string, string) (string, error)
}

func (i *InstagramAdapter) ReplyPrivatelyToComment(ctx context.Context, token, accountID, commentID, message string) (string, error) {
	message = strings.TrimSpace(message)
	if accountID == "" || commentID == "" || message == "" || len(message) > 1000 {
		return "", errors.New("private Instagram replies require an account, comment and up to 1000 bytes of text")
	}
	body, err := DoJSON(ctx, http.MethodPost, i.graphURL(accountID+"/messages"), map[string]any{"recipient": map[string]string{"comment_id": commentID}, "message": map[string]string{"text": message}}, map[string]string{"Authorization": "Bearer " + token})
	if err != nil {
		return "", err
	}
	var response struct {
		MessageID string `json:"message_id"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", err
	}
	if response.MessageID == "" {
		return "", errors.New("the private reply was not confirmed by Instagram; inspect the outcome before sending again")
	}
	return response.MessageID, nil
}

// InstagramWebhookCommentReader hydrates signed comment events for media that
// was published outside OpenPost, using the same canonical Inbox identity.
type InstagramWebhookCommentReader interface {
	ReadWebhookComment(context.Context, string, string, string, string) (Comment, string, error)
}

func (i *InstagramAdapter) ReadWebhookComment(ctx context.Context, token, accountID, commentID, mediaID string) (Comment, string, error) {
	data, err := DoRequest(ctx, http.MethodGet, i.graphURL(commentID)+"?fields=id,text,timestamp,username,from,parent_id,hidden", nil, map[string]string{"Authorization": "Bearer " + token})
	if err != nil {
		return Comment{}, "", err
	}
	var remote instagramGraphComment
	if err := json.Unmarshal(data, &remote); err != nil {
		return Comment{}, "", err
	}
	if remote.ID != commentID || remote.Timestamp == "" {
		return Comment{}, "", errors.New("comment identity or creation time is unavailable from Instagram")
	}
	// Fetch the media independently to retain its permanent link. The signed
	// callback already binds mediaID to the receiving professional account.
	data, err = DoRequest(ctx, http.MethodGet, i.graphURL(mediaID)+"?fields=id,permalink,media_product_type", nil, map[string]string{"Authorization": "Bearer " + token})
	if err != nil {
		return Comment{}, "", err
	}
	var media struct {
		ID        string `json:"id"`
		Permalink string `json:"permalink"`
		Product   string `json:"media_product_type"`
	}
	if err := json.Unmarshal(data, &media); err != nil {
		return Comment{}, "", err
	}
	if media.ID != mediaID || strings.EqualFold(media.Product, "LIVE") {
		return Comment{}, "", errors.New("this Instagram media cannot receive a comment campaign")
	}
	comment := instagramCommentFromGraph(remote, accountID, "")
	comment.ConversationID = mediaID
	return comment, media.Permalink, nil
}
