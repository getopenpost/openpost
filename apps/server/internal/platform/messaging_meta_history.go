package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
)

type metaMessageView struct {
	ID          string `json:"id"`
	Message     string `json:"message"`
	CreatedTime string `json:"created_time"`
	From        struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
	} `json:"from"`
	Attachments struct {
		Data []struct {
			MimeType string `json:"mime_type"`
			Name     string `json:"name"`
			Image    struct {
				URL string `json:"url"`
				Src string `json:"src"`
			} `json:"image_data"`
			Video struct {
				URL string `json:"url"`
			} `json:"video_data"`
			FileURL string `json:"file_url"`
		} `json:"data"`
	} `json:"attachments"`
	// Shared posts and story replies or mentions come back as separate fields
	// with an empty message, not as attachments.
	Shares struct {
		Data []struct {
			URL  string `json:"url"`
			Link string `json:"link"`
			Name string `json:"name"`
		} `json:"data"`
	} `json:"shares"`
	Story struct {
		Mention struct {
			Link string `json:"link"`
		} `json:"mention"`
		ReplyTo struct {
			Link string `json:"link"`
		} `json:"reply_to"`
	} `json:"story"`
}

// metaMessageFields is shared by the conversation and history reads. Shared
// posts and story replies or mentions arrive in their own fields beside a
// message without text, so they must be requested to show any content.
const metaMessageFields = "id,from,message,created_time,attachments,shares,story"

func (m metaMessageView) provider(accountID string) ProviderMessage {
	// Graph returns offsets without a colon, such as 2026-10-26T21:01:00+0000.
	at := ProviderTime(m.CreatedTime)
	direction := "inbound"
	if m.From.ID == accountID {
		direction = "outbound"
	}
	result := ProviderMessage{ID: m.ID, Direction: direction, AuthorRemoteID: m.From.ID, Body: m.Message, RemoteCreatedAt: at}
	for _, attachment := range m.Attachments.Data {
		// Graph puts the image URL in image_data.url and often omits mime_type.
		image := firstNonEmptyString(attachment.Image.URL, attachment.Image.Src)
		remote := firstNonEmptyString(image, attachment.Video.URL, attachment.FileURL)
		if remote == "" {
			continue
		}
		kind := metaAttachmentType(attachment.MimeType)
		if attachment.MimeType == "" && image != "" {
			kind = "image"
		} else if attachment.MimeType == "" && attachment.Video.URL != "" {
			kind = "video"
		}
		result.Attachments = append(result.Attachments, MessageAttachment{Type: kind, URL: remote, Name: attachment.Name, MimeType: attachment.MimeType})
	}
	for _, share := range m.Shares.Data {
		// Graph documents a share's url; some platforms and older payloads
		// return link instead.
		link := firstNonEmptyString(share.URL, share.Link)
		if link != "" {
			result.Attachments = append(result.Attachments, MessageAttachment{Type: "share", URL: link, Name: share.Name})
		}
	}
	if m.Story.Mention.Link != "" {
		result.Attachments = append(result.Attachments, MessageAttachment{Type: "story_mention", URL: m.Story.Mention.Link})
	}
	if m.Story.ReplyTo.Link != "" {
		result.Attachments = append(result.Attachments, MessageAttachment{Type: "story_reply", URL: m.Story.ReplyTo.Link})
	}
	return result
}

func (f *FacebookAdapter) FetchMessageHistory(ctx context.Context, token string, input FetchMessageHistoryRequest) (FetchMessageHistoryResult, error) {
	return (metaMessagingAdapter{graphURL: f.graphURL}).history(ctx, token, input)
}
func (i *InstagramAdapter) FetchMessageHistory(ctx context.Context, token string, input FetchMessageHistoryRequest) (FetchMessageHistoryResult, error) {
	return i.messagingAdapter().history(ctx, token, input)
}

func (m metaMessagingAdapter) history(ctx context.Context, token string, input FetchMessageHistoryRequest) (FetchMessageHistoryResult, error) {
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	query := url.Values{"limit": {fmt.Sprint(limit)}, "fields": {metaMessageFields}}
	if input.Cursor != "" {
		query.Set("after", input.Cursor)
	}
	body, err := DoRequest(ctx, http.MethodGet, m.graphURL(url.PathEscape(input.ConversationID)+"/messages")+"?"+query.Encode(), nil, map[string]string{headerAuthorization: bearerPrefix + token})
	if err != nil {
		return FetchMessageHistoryResult{}, err
	}
	var response struct {
		Data   []metaMessageView `json:"data"`
		Paging struct {
			Next    string `json:"next"`
			Cursors struct {
				After string `json:"after"`
			} `json:"cursors"`
		} `json:"paging"`
	}
	if err = json.Unmarshal(body, &response); err != nil {
		return FetchMessageHistoryResult{}, fmt.Errorf("decoding Meta history: %w", err)
	}
	result := FetchMessageHistoryResult{}
	if response.Paging.Next != "" {
		result.NextCursor = response.Paging.Cursors.After
	}
	for _, message := range response.Data {
		if message.ID != "" {
			result.Messages = append(result.Messages, message.provider(input.AccountID))
		}
	}
	sort.SliceStable(result.Messages, func(i, j int) bool {
		return result.Messages[i].RemoteCreatedAt.Before(result.Messages[j].RemoteCreatedAt)
	})
	return result, nil
}
