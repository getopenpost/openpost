package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type metaMessagingAdapter struct {
	graphURL      func(string) string
	platformParam string
	requiredScope string
	instagram     bool
}

func (f *FacebookAdapter) MessagingSupport() MessagingSupport {
	return MessagingSupport{
		Enabled: true, CanSend: true, RequiresOptIn: true, ReplyWindow: 24 * time.Hour,
		RequiredScopes: []string{"pages_messaging", "pages_manage_metadata"}, ConversationModel: "page_message",
		Unavailable: "Facebook Page messages require pages_messaging and pages_manage_metadata advanced access and a Page token.",
	}
}

func (f *FacebookAdapter) FetchMessages(ctx context.Context, token string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	return metaMessagingAdapter{graphURL: f.graphURL, platformParam: "messenger", requiredScope: "pages_messaging"}.
		fetch(ctx, token, input)
}

func (f *FacebookAdapter) SendMessage(ctx context.Context, token string, input SendMessageRequest) (SendMessageResult, error) {
	return metaMessagingAdapter{graphURL: f.graphURL, platformParam: "messenger", requiredScope: "pages_messaging"}.
		send(ctx, token, input)
}

func (i *InstagramAdapter) MessagingSupport() MessagingSupport {
	if i.instagramLogin {
		return MessagingSupport{
			Enabled: true, CanSend: true, RequiresOptIn: true, ReplyWindow: 24 * time.Hour,
			RequiredScopes: []string{"instagram_business_basic", "instagram_business_manage_messages"}, ConversationModel: "professional_message",
			Unavailable: "Instagram messages require approved Instagram Login permissions. A person must message the professional account first.",
		}
	}
	return MessagingSupport{
		Enabled: true, CanSend: true, RequiresOptIn: true, ReplyWindow: 24 * time.Hour,
		RequiredScopes: []string{"instagram_basic", "instagram_manage_messages", "pages_manage_metadata"}, ConversationModel: "professional_message",
		Unavailable: "Instagram messages require instagram_basic, instagram_manage_messages, and pages_manage_metadata, and a Meta app owned by a verified business. A person must message the professional account first.",
	}
}

func (i *InstagramAdapter) FetchMessages(ctx context.Context, token string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	return i.messagingAdapter().
		fetch(ctx, token, input)
}

func (i *InstagramAdapter) SendMessage(ctx context.Context, token string, input SendMessageRequest) (SendMessageResult, error) {
	return i.messagingAdapter().
		send(ctx, token, input)
}

func (i *InstagramAdapter) messagingAdapter() metaMessagingAdapter {
	param := "instagram"
	if i.instagramLogin {
		param = ""
	}
	return metaMessagingAdapter{graphURL: i.graphURL, platformParam: param, requiredScope: i.instagramScope("instagram_manage_messages"), instagram: true}
}

func (m metaMessagingAdapter) conversationsQuery(token, cursor string) url.Values {
	query := url.Values{
		"platform":     {m.platformParam},
		"fields":       {"participants,updated_time,messages.limit(100){" + metaMessageFields + "}"},
		"limit":        {"50"},
		"access_token": {token},
	}
	if m.platformParam == "" {
		query.Del("platform")
	}
	if cursor != "" {
		query.Set("after", cursor)
	}
	return query
}

func (m metaMessagingAdapter) fetch(ctx context.Context, token string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	query := m.conversationsQuery(token, input.Cursor)
	body, err := DoRequest(ctx, http.MethodGet, m.graphURL(input.AccountID+"/conversations")+"?"+query.Encode(), nil, nil)
	if err != nil {
		return FetchMessagesResult{}, fmt.Errorf("fetching Meta conversations: %w", err)
	}
	var response struct {
		Data []struct {
			ID           string `json:"id"`
			UpdatedTime  string `json:"updated_time"`
			Participants struct {
				Data []struct {
					ID       string `json:"id"`
					Name     string `json:"name"`
					Username string `json:"username"`
				} `json:"data"`
			} `json:"participants"`
			Messages struct {
				Data []metaMessageView `json:"data"`
			} `json:"messages"`
		} `json:"data"`
		Paging struct {
			Next    string `json:"next"`
			Cursors struct {
				After string `json:"after"`
			} `json:"cursors"`
		} `json:"paging"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return FetchMessagesResult{}, fmt.Errorf("decoding Meta conversations: %w", err)
	}
	if response.Error.Message != "" {
		return FetchMessagesResult{}, fmt.Errorf("meta messages: %s", response.Error.Message)
	}
	result := FetchMessagesResult{}
	if response.Paging.Next != "" {
		result.NextCursor = response.Paging.Cursors.After
	}
	for _, remote := range response.Data {
		var counterpart struct{ ID, Name, Username string }
		for _, participant := range remote.Participants.Data {
			if participant.ID != input.AccountID {
				counterpart = struct{ ID, Name, Username string }{participant.ID, participant.Name, participant.Username}
				break
			}
		}
		messages := make([]ProviderMessage, 0, len(remote.Messages.Data))
		var latestInbound time.Time
		for _, item := range remote.Messages.Data {
			createdAt := ProviderTime(item.CreatedTime)
			if item.From.ID != input.AccountID && createdAt.After(latestInbound) {
				latestInbound = createdAt
			}
			messages = append(messages, item.provider(input.AccountID))
		}
		sort.Slice(messages, func(a, b int) bool { return messages[a].RemoteCreatedAt.Before(messages[b].RemoteCreatedAt) })
		updatedAt := ProviderTime(remote.UpdatedTime)
		preview := ""
		lastID := ""
		if len(messages) > 0 {
			last := messages[len(messages)-1]
			updatedAt, preview, lastID = last.RemoteCreatedAt, last.Body, last.ID
		}
		window := time.Time{}
		if !latestInbound.IsZero() {
			window = latestInbound.Add(24 * time.Hour)
		}
		result.Conversations = append(result.Conversations, ProviderConversation{
			ID: remote.ID, CounterpartRemoteID: counterpart.ID,
			CounterpartName:   firstNonEmptyString(counterpart.Name, counterpart.Username),
			CounterpartHandle: prefixHandle(counterpart.Username),
			LastMessageAt:     updatedAt, LastMessagePreview: preview, LastRemoteMessageID: lastID,
			ReplyWindowExpiresAt: window, Messages: messages,
		})
	}
	return result, nil
}

func (m metaMessagingAdapter) send(ctx context.Context, token string, input SendMessageRequest) (SendMessageResult, error) {
	payload := map[string]any{
		"recipient":    map[string]string{"id": input.CounterpartRemoteID},
		"message":      map[string]string{"text": strings.TrimSpace(input.Body)},
		"access_token": token,
	}
	if !m.instagram {
		payload["messaging_type"] = "RESPONSE"
	}
	body, err := DoJSON(ctx, http.MethodPost, m.graphURL(input.AccountID+"/messages"), payload, nil)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("sending Meta message: %w", err)
	}
	var response struct {
		MessageID string `json:"message_id"`
		Error     struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return SendMessageResult{}, fmt.Errorf("decoding Meta sent message: %w", err)
	}
	if response.Error.Message != "" {
		return SendMessageResult{}, fmt.Errorf("meta messages: %s", response.Error.Message)
	}
	return SendMessageResult{RemoteMessageID: response.MessageID, CreatedAt: time.Now().UTC()}, nil
}

func metaAttachmentType(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	default:
		return "file"
	}
}
